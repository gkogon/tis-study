// Live Atlanta weather pulled from Open-Meteo's free public forecast API.
//
// Open-Meteo (https://open-meteo.com) is keyless and operator-funded; their
// terms allow non-commercial production use up to 10k req/day per IP. We pull
// once every 10 minutes, server-side, and reuse the result across all callers
// — well within the limit even at high traffic.
//
// We classify the live conditions into one of the four weather buckets the
// prediction model already understands ({clear, light_rain, heavy_rain, snow})
// so the live forecast can be plugged straight into predictDay() without any
// schema changes.

import { logger } from "./logger";

// City Hall coordinates — representative of the Atlanta metro forecast.
const ATL_LAT = 33.749;
const ATL_LON = -84.388;
const WX_TTL_MS = 10 * 60_000;

export type WeatherCondition = "clear" | "light_rain" | "heavy_rain" | "snow";

export type LiveWeather = {
  fetchedAt: string;
  source: string;
  cached: boolean;
  cacheAgeSeconds: number;
  condition: WeatherCondition;
  // Plain-English summary derived from the WMO code (e.g. "Overcast").
  summary: string;
  // Current-conditions snapshot
  temperatureF: number | null;
  precipitationInPerHr: number | null;
  windMph: number | null;
  weatherCode: number | null;
  // 24-hour outlook keyed by local hour-of-day in America/New_York.
  // hourly[h] = predicted weather classification for that hour.
  hourly: Array<{
    hour: number;
    condition: WeatherCondition;
    summary: string;
    precipitationInPerHr: number;
    weatherCode: number;
  }>;
};

// WMO weather interpretation codes
// https://open-meteo.com/en/docs#weather_variable_documentation
function describeWmo(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code === 51 || code === 53 || code === 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code === 61) return "Light rain";
  if (code === 63) return "Moderate rain";
  if (code === 65) return "Heavy rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code === 71) return "Light snow";
  if (code === 73) return "Moderate snow";
  if (code === 75) return "Heavy snow";
  if (code === 77) return "Snow grains";
  if (code === 80) return "Rain showers";
  if (code === 81) return "Heavy rain showers";
  if (code === 82) return "Violent rain showers";
  if (code === 85) return "Snow showers";
  if (code === 86) return "Heavy snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm with hail";
  return `Unknown (${code})`;
}

// Map a WMO code + measured precipitation rate (in/hr) to one of the four
// weather buckets the prediction model accepts. Threshold tuning notes:
//   * Open-Meteo reports precipitation in mm; we convert to inches (× 0.0394).
//   * NWS calls > 0.30 in/hr "heavy rain"; we use 0.15 in/hr to capture the
//     conditions that materially slow Atlanta-metro traffic without setting
//     the bar so high that summer pop-up showers go uncounted.
function classifyWmo(code: number, precipInPerHr: number): WeatherCondition {
  // Snow / ice family
  if (
    code === 71 || code === 73 || code === 75 || code === 77 ||
    code === 85 || code === 86 ||
    code === 56 || code === 57 || code === 66 || code === 67
  ) {
    return "snow";
  }
  // Thunderstorms — treat as heavy rain regardless of measured rate (lightning
  // and brief downpours dominate driving behaviour).
  if (code === 95 || code === 96 || code === 99) return "heavy_rain";
  // Heavy / violent rain showers
  if (code === 65 || code === 82) return "heavy_rain";
  // Light-to-moderate rain — bucket by measured rate.
  if (
    code === 51 || code === 53 || code === 55 ||
    code === 61 || code === 63 ||
    code === 80 || code === 81
  ) {
    return precipInPerHr >= 0.15 ? "heavy_rain" : "light_rain";
  }
  // No precipitation reported, but heavy measured rain (rare desync between
  // code and measurement) — trust the measurement.
  if (precipInPerHr >= 0.15) return "heavy_rain";
  if (precipInPerHr >= 0.02) return "light_rain";
  return "clear";
}

type OpenMeteoResp = {
  current?: {
    time: string;
    temperature_2m?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  hourly?: {
    time: string[];
    precipitation: number[];
    weather_code: number[];
  };
};

let cache: { at: number; data: LiveWeather } | null = null;
let inflight: Promise<LiveWeather> | null = null;

export async function getLiveWeather(force = false): Promise<LiveWeather> {
  if (!force && cache) {
    const ageMs = Date.now() - cache.at;
    if (ageMs < WX_TTL_MS) {
      return { ...cache.data, cached: true, cacheAgeSeconds: Math.round(ageMs / 1000) };
    }
  }
  if (inflight) return inflight;
  inflight = (async (): Promise<LiveWeather> => {
    try {
      return await refreshWeather();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function refreshWeather(): Promise<LiveWeather> {
  const startedAt = Date.now();
  const params = new URLSearchParams({
    latitude: String(ATL_LAT),
    longitude: String(ATL_LON),
    current: "temperature_2m,precipitation,weather_code,wind_speed_10m",
    hourly: "precipitation,weather_code",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "America/New_York",
    forecast_days: "1",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  let resp: OpenMeteoResp;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "atlanta-traffic-analyzer/1.0 (live-weather)",
        "Accept": "application/json",
      },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} from open-meteo`);
    resp = (await r.json()) as OpenMeteoResp;
  } finally {
    clearTimeout(timer);
  }

  const cur: NonNullable<OpenMeteoResp["current"]> | Record<string, never> =
    resp.current ?? {};
  const curCode = "weather_code" in cur && typeof cur.weather_code === "number"
    ? cur.weather_code : 0;
  const curPrecip = "precipitation" in cur && typeof cur.precipitation === "number"
    ? cur.precipitation : 0;
  const condition = classifyWmo(curCode, curPrecip);

  const hourly: LiveWeather["hourly"] = [];
  if (resp.hourly?.time && resp.hourly.weather_code && resp.hourly.precipitation) {
    for (let i = 0; i < resp.hourly.time.length && i < 24; i++) {
      const t = resp.hourly.time[i]!;
      // ISO without TZ offset — open-meteo emits local time when timezone is set.
      const hourMatch = /T(\d{2}):/.exec(t);
      const hour = hourMatch ? Number(hourMatch[1]) : i;
      const code = resp.hourly.weather_code[i] ?? 0;
      const p = resp.hourly.precipitation[i] ?? 0;
      hourly.push({
        hour,
        condition: classifyWmo(code, p),
        summary: describeWmo(code),
        precipitationInPerHr: Math.round(p * 1000) / 1000,
        weatherCode: code,
      });
    }
  }

  const data: LiveWeather = {
    fetchedAt: new Date(startedAt).toISOString(),
    source: "Open-Meteo (api.open-meteo.com)",
    cached: false,
    cacheAgeSeconds: 0,
    condition,
    summary: describeWmo(curCode),
    temperatureF: "temperature_2m" in cur && typeof cur.temperature_2m === "number"
      ? Math.round(cur.temperature_2m * 10) / 10 : null,
    precipitationInPerHr: Math.round(curPrecip * 1000) / 1000,
    windMph: "wind_speed_10m" in cur && typeof cur.wind_speed_10m === "number"
      ? Math.round(cur.wind_speed_10m * 10) / 10 : null,
    weatherCode: curCode,
    hourly,
  };
  cache = { at: startedAt, data };
  logger.info(
    { condition, tempF: data.temperatureF, code: curCode, ms: Date.now() - startedAt },
    "weather: refreshed",
  );
  return data;
}

// Synchronous read of last cached weather; null if never fetched. Used by
// other libs that don't want to incur a network round-trip themselves.
export function peekWeather(): LiveWeather | null {
  if (!cache) return null;
  const ageMs = Date.now() - cache.at;
  return { ...cache.data, cached: true, cacheAgeSeconds: Math.round(ageMs / 1000) };
}
