// Continuous, data-driven weather multiplier for the prediction model.
//
// The original WEATHER_MULT was a 4-bucket lookup: clear=1.0, light_rain=1.08,
// heavy_rain=1.18, snow=1.45. That throws away a lot of signal — a 0.05 in/hr
// drizzle and a 0.14 in/hr downpour both became "light_rain" and got the same
// multiplier even though their effect on traffic differs by ~2x.
//
// This module computes a continuous multiplier from the actual measurements
// already returned by Open-Meteo (precipitation in/hr, wind mph, temperature F)
// plus the WMO weather code. It can be plugged in anywhere WEATHER_MULT was
// previously used.
//
// We also expose a forward-looking version that takes the per-hour outlook
// already in `LiveWeather.hourly[]` so predictDay() can compute a
// per-hour-of-day multiplier for tomorrow's forecast.

import type { LiveWeather, WeatherCondition } from "./atlanta-weather";

export type WeatherDetail = {
  precipitationInPerHr: number;
  windMph: number;
  temperatureF: number;
  weatherCode: number;
};

// Map an arbitrary weather measurement to a continuous traffic-stress
// multiplier. Returns 1.00 in dry, mild, calm conditions; up to ~1.55 in
// extreme weather. The shape is calibrated so the breakpoints match the
// old discrete buckets at their representative midpoints:
//   clear (0 in/hr) → 1.00
//   light rain (~0.05 in/hr, 60-80°F) → ~1.08
//   moderate rain (~0.10 in/hr) → ~1.13
//   heavy rain (~0.20 in/hr) → ~1.20
//   snow (any frozen precip) → ~1.45 (or higher with wind)
export function computeWeatherMultiplier(d: WeatherDetail): number {
  const code = d.weatherCode;
  const precip = Math.max(0, d.precipitationInPerHr);
  const wind = Math.max(0, d.windMph);
  const temp = d.temperatureF;

  // Snow / ice family — the dominant factor is frozen precipitation,
  // because Atlanta-metro drivers are particularly poor at it. Even trace
  // amounts trigger the 1.45+ surge.
  const isSnowCode =
    code === 71 || code === 73 || code === 75 || code === 77 ||
    code === 85 || code === 86 ||
    code === 56 || code === 57 || code === 66 || code === 67;
  if (isSnowCode || (temp <= 32 && precip >= 0.005)) {
    // Heavy snow (>0.10 in/hr melted equiv) pushes toward the cap.
    const snowBoost = Math.min(0.15, precip * 1.5);
    const windBoost = Math.min(0.05, wind / 400);
    return Math.min(1.65, 1.40 + snowBoost + windBoost);
  }

  // Thunderstorms — lightning + heavy bursts, treat as upper-end rain
  // regardless of measured rate.
  if (code === 95 || code === 96 || code === 99) {
    return Math.min(1.30, 1.20 + Math.min(0.05, precip * 0.5));
  }

  // Fog (codes 45, 48) — reduces visibility but rarely pours; small bump.
  if (code === 45 || code === 48) return 1.05;

  // Liquid precipitation — continuous curve calibrated against the old
  // discrete model:
  //   precip = 0       → 1.00 (clear)
  //   precip = 0.02    → 1.05 (drizzle)
  //   precip = 0.05    → 1.09 (light rain)
  //   precip = 0.10    → 1.14 (moderate rain)
  //   precip = 0.20    → 1.20 (heavy rain)
  //   precip = 0.40+   → 1.25 (downpour, asymptotic cap)
  let mult = 1.0;
  if (precip > 0) {
    // Diminishing-returns square-root curve. Calibrated so 0.10 in/hr ≈ 0.14
    // bump (matches the old "heavy_rain" bucket midpoint).
    mult = 1.0 + Math.min(0.25, 0.45 * Math.sqrt(precip));
  } else if (
    // No precip measured but the WMO code says rain — assume light rain.
    code === 51 || code === 53 || code === 55 ||
    code === 61 || code === 80
  ) {
    mult = 1.05;
  }

  // Wind on top — sustained winds >20 mph add a small extra stress
  // (debris, cross-wind on overpasses).
  if (wind > 20) {
    mult += Math.min(0.05, (wind - 20) / 200);
  }

  return Math.round(mult * 1000) / 1000;
}

// 24-element array (hour 0..23) of weather multipliers for the day,
// derived from `LiveWeather.hourly[]`. If hourly data is missing or short,
// fills the gap with the current-conditions multiplier. Used by predictDay()
// so tomorrow's forecast varies hour-by-hour with the weather outlook
// instead of using a single all-day multiplier.
export function computeHourlyWeatherMultipliers(wx: LiveWeather): number[] {
  const fallback = computeWeatherMultiplier({
    precipitationInPerHr: wx.precipitationInPerHr ?? 0,
    windMph: wx.windMph ?? 0,
    temperatureF: wx.temperatureF ?? 70,
    weatherCode: wx.weatherCode ?? 0,
  });
  const out = new Array<number>(24).fill(fallback);
  if (!wx.hourly?.length) return out;

  // Index hourly entries by their `hour` field (already in local Atlanta
  // time per atlanta-weather.ts).
  for (const h of wx.hourly) {
    if (!Number.isInteger(h.hour) || h.hour < 0 || h.hour > 23) continue;
    out[h.hour] = computeWeatherMultiplier({
      precipitationInPerHr: h.precipitationInPerHr,
      // Hourly outlook from open-meteo doesn't include hourly wind / temp
      // (we don't fetch those). Fall back to the current-conditions values
      // — over a 24h window this is a reasonable approximation.
      windMph: wx.windMph ?? 0,
      temperatureF: wx.temperatureF ?? 70,
      weatherCode: h.weatherCode,
    });
  }
  return out;
}

// Backwards-compatible helper: maps a `WeatherCondition` bucket to the
// representative midpoint multiplier. Used as a fallback path when no live
// detail is available (e.g. user-supplied scenario in tomorrow.tsx).
export function multiplierForCondition(c: WeatherCondition): number {
  switch (c) {
    case "clear": return 1.00;
    case "light_rain": return 1.09;
    case "heavy_rain": return 1.20;
    case "snow": return 1.45;
  }
}
