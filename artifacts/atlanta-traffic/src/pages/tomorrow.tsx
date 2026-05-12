import { memo, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  usePredictDay,
  useGetLiveIncidents,
  useGetPredictionAccuracy,
  useGetLiveWeather,
  useGetTodayAccidentPredictions,
  useGetPredictedTrafficFlow,
  getGetLiveIncidentsQueryKey,
  getGetPredictionAccuracyQueryKey,
  getGetLiveWeatherQueryKey,
  getGetTodayAccidentPredictionsQueryKey,
  getGetPredictedTrafficFlowQueryKey,
  type AccidentRiskBundle,
  type PredictedSignal,
  type PreemptiveRecommendation,
  type SignalAccidentRisk,
  type LiveIncident,
  type AccidentHotspot,
  type LiveTrafficSegment,
  type PredictedCriticalSignal,
  type PredictedHourAggregate,
  type PredictedTrafficFlow,
} from "@workspace/api-client-react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  CircleMarker,
  Tooltip as LeafletTooltip,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, CalendarDays, CloudRain, Cloud, CloudSnow, Sun,
  Sparkles, AlertTriangle, MapPin, TrendingUp, Activity, Info,
  Radio, Target, RefreshCw, Thermometer, Wind, Flame,
} from "lucide-react";

// Map weather condition string to a Lucide icon for the live-weather chip.
function weatherIcon(c: "clear" | "light_rain" | "heavy_rain" | "snow") {
  if (c === "snow") return CloudSnow;
  if (c === "heavy_rain") return CloudRain;
  if (c === "light_rain") return Cloud;
  return Sun;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: "#009118",
  moderate: "#eab308",
  high: "#795EFF",
  critical: "#A60808",
};

const RISK_COLORS: Record<string, string> = {
  none: "#94a3b8",
  low: "#22c55e",
  moderate: "#eab308",
  high: "#f97316",
  severe: "#dc2626",
};


type Weather = "clear" | "light_rain" | "heavy_rain" | "snow";

const WEATHER_OPTIONS: Array<{ value: Weather; label: string; icon: typeof Sun }> = [
  { value: "clear", label: "Clear", icon: Sun },
  { value: "light_rain", label: "Light rain", icon: Cloud },
  { value: "heavy_rain", label: "Heavy rain", icon: CloudRain },
  { value: "snow", label: "Snow / ice", icon: CloudSnow },
];

const EVENT_TOGGLES: Array<{ key: keyof EventFlags; label: string; emoji: string }> = [
  { key: "falconsHome", label: "Falcons home", emoji: "🏈" },
  { key: "hawksHome", label: "Hawks home", emoji: "🏀" },
  { key: "bravesHome", label: "Braves home", emoji: "⚾" },
  { key: "gtFootball", label: "GT football", emoji: "🐝" },
  { key: "holiday", label: "Holiday", emoji: "🎉" },
  { key: "schoolDay", label: "School in session", emoji: "🎒" },
];

type EventFlags = {
  falconsHome?: boolean;
  hawksHome?: boolean;
  bravesHome?: boolean;
  gtFootball?: boolean;
  holiday?: boolean;
  schoolDay?: boolean;
};

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function hourLabel(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

const FLOW_LEVEL_COLORS: Record<string, string> = {
  free:   "#34c759",
  light:  "#ffcc00",
  heavy:  "#ff9500",
  severe: "#ff3b30",
  closed: "#1a1a1a",
};

const FLOW_LEVEL_LABELS: Record<string, string> = {
  free:   "Free flow",
  light:  "Light",
  heavy:  "Heavy",
  severe: "Severe",
  closed: "Closed",
};

const ROAD_CLASS_LABEL = ["Motorway", "Trunk", "Primary", "Secondary"];

const FLOW_RENDER_ORDER: LiveTrafficSegment["level"][] = ["free", "light", "heavy", "severe", "closed"];

function flowWeightFor(rc: number, level: LiveTrafficSegment["level"]): number {
  const base = rc === 0 ? 4.5 : rc === 1 ? 3.5 : rc === 2 ? 2.5 : 1.8;
  if (level === "severe" || level === "closed") return base + 0.7;
  return base;
}

function unflattenPolyline(polyline: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < polyline.length; i += 2) {
    out.push([polyline[i]!, polyline[i + 1]!]);
  }
  return out;
}

type RenderSegment = LiveTrafficSegment & {
  positions: [number, number][];
  pathOptions: {
    color: string;
    weight: number;
    opacity: number;
    dashArray?: string;
    lineCap: "round";
    lineJoin: "round";
  };
};

function criticalPinIcon(rank: number, color: string): L.DivIcon {
  const size = 28;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-weight:700;font-size:12px;font-family:ui-sans-serif,system-ui,sans-serif;
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);
      line-height:1;
    ">${rank}</div>`,
  });
}

const PredictedFlowMap = memo(function PredictedFlowMap({
  flow,
  criticalSignals,
}: {
  flow: PredictedTrafficFlow | undefined;
  criticalSignals: PredictedCriticalSignal[];
}) {
  const grouped = useMemo(() => {
    if (!flow) return null;
    const buckets: Record<string, RenderSegment[]> = {
      free: [], light: [], heavy: [], severe: [], closed: [],
    };
    for (const s of flow.segments) {
      const positions = unflattenPolyline(s.polyline);
      const pathOptions = {
        color: FLOW_LEVEL_COLORS[s.level]!,
        weight: flowWeightFor(s.rc, s.level),
        opacity: s.level === "free" ? 0.55 : 0.9,
        dashArray: s.level === "closed" ? "6,4" : undefined,
        lineCap: "round" as const,
        lineJoin: "round" as const,
      };
      (buckets[s.level] ?? buckets.free)!.push({ ...s, positions, pathOptions });
    }
    return buckets;
  }, [flow]);

  const icons = useMemo(
    () =>
      criticalSignals.map((cs, i) => {
        const color =
          cs.score >= 70 ? SEVERITY_COLORS.critical :
          cs.score >= 50 ? SEVERITY_COLORS.high : SEVERITY_COLORS.moderate;
        return { cs, icon: criticalPinIcon(i + 1, color) };
      }),
    [criticalSignals],
  );

  return (
    <MapContainer
      center={[33.79, -84.39]}
      zoom={11}
      scrollWheelZoom
      preferCanvas
      style={{ height: "560px", width: "100%", borderRadius: "8px" }}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap, &copy; CARTO'
      />
      {grouped && FLOW_RENDER_ORDER.map((level) =>
        (grouped[level] ?? []).map((seg, i) => (
          <Polyline
            key={`${level}-${i}`}
            positions={seg.positions}
            pathOptions={seg.pathOptions}
          >
            <LeafletTooltip sticky direction="top" offset={[0, -2]}>
              <div style={{ fontSize: 12 }}>
                <div style={{ fontWeight: 600 }}>
                  {seg.name ?? ROAD_CLASS_LABEL[seg.rc] ?? "Road"}
                </div>
                <div style={{ color: "#64748b" }}>
                  {FLOW_LEVEL_LABELS[level]} · predicted score {seg.score.toFixed(0)} · {ROAD_CLASS_LABEL[seg.rc] ?? "road"}
                </div>
              </div>
            </LeafletTooltip>
          </Polyline>
        ))
      )}
      {icons.map(({ cs, icon }, i) => (
        <Marker
          key={cs.id}
          position={[cs.lat, cs.lon]}
          icon={icon}
        >
          <LeafletTooltip direction="top" offset={[0, -16]}>
            <div style={{ maxWidth: 320 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                #{i + 1} · {cs.name}
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                {cs.roadClass} · predicted score{" "}
                <strong style={{ color: "#1a1a1a" }}>{cs.score.toFixed(1)}</strong>
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Severity: {cs.severity}
                {cs.crashRiskTier !== "none" && (
                  <span> · Crash tier:{" "}
                    <span style={{
                      background: RISK_COLORS[cs.crashRiskTier],
                      color: "#fff",
                      padding: "1px 6px",
                      borderRadius: 4,
                      fontWeight: 600,
                      fontSize: 11,
                    }}>{cs.crashRiskTier}</span>
                    {cs.crashSurgePct > 0 ? ` +${cs.crashSurgePct.toFixed(0)}%` : ""}
                  </span>
                )}
              </div>
            </div>
          </LeafletTooltip>
        </Marker>
      ))}
    </MapContainer>
  );
});

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      backgroundColor: "#fff", borderRadius: 6, padding: "8px 12px",
      border: "1px solid #e0e0e0", color: "#1a1a1a", fontSize: 13,
    }}>
      <div style={{ fontWeight: 500, marginBottom: 4 }}>{label}</div>
      {payload.map((e: any, i: number) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: e.color }} />
          <span>{e.name}</span>
          <span style={{ marginLeft: "auto", fontWeight: 600 }}>
            {typeof e.value === "number" ? e.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : e.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Tomorrow() {
  const [date, setDate] = useState<string>(tomorrowISO());
  const [weather, setWeather] = useState<Weather>("clear");
  const [events, setEvents] = useState<EventFlags>({ schoolDay: true });
  const [hour, setHour] = useState<number>(8);

  // Live conditions: refresh every 90s (matches the server-side cache TTL).
  // queryKey is supplied explicitly because TanStack v5 makes it required
  // even when orval's wrapper defaults it at runtime.
  const liveQ = useGetLiveIncidents({
    query: {
      queryKey: getGetLiveIncidentsQueryKey(),
      refetchInterval: 90_000,
      staleTime: 60_000,
    },
  });
  const accuracyQ = useGetPredictionAccuracy(
    { topN: 150 },
    {
      query: {
        queryKey: getGetPredictionAccuracyQueryKey({ topN: 150 }),
        refetchInterval: 90_000,
        staleTime: 60_000,
      },
    },
  );
  // Live Atlanta weather (Open-Meteo, no API key). Refreshes every 10min to
  // match the server-side cache. Drives both the chip on the live strip and
  // the today-accident-predictions card below.
  const weatherQ = useGetLiveWeather({
    query: {
      queryKey: getGetLiveWeatherQueryKey(),
      refetchInterval: 10 * 60_000,
      staleTime: 5 * 60_000,
    },
  });
  // Today's predicted accident hotspots. Refresh every 2min so the list
  // tracks the rolling current-hour cutoff.
  const hotspotsQ = useGetTodayAccidentPredictions(
    { topN: 20 },
    {
      query: {
        queryKey: getGetTodayAccidentPredictionsQueryKey({ topN: 20 }),
        refetchInterval: 2 * 60_000,
        staleTime: 60_000,
      },
    },
  );
  const liveIncidents: LiveIncident[] = liveQ.data?.incidents ?? [];
  const accuracy = accuracyQ.data;
  const liveWeather = weatherQ.data;
  const hotspots: AccidentHotspot[] = hotspotsQ.data?.hotspots ?? [];
  const liveAgeSec =
    liveQ.data?.fetchedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(liveQ.data.fetchedAt).getTime()) / 1000))
      : null;

  // Use a hand-rolled query with a cache-busting query string so any HTTP
  // caches that retained the pre-data-bake fallback response are bypassed
  // cleanly. (The shared proxy + browser cache had retained the original
  // long-cached fallback even after the dataset was baked.)
  const accidentQ = useQuery({
    queryKey: ["atlanta", "accident-risk", "v3"],
    queryFn: async (): Promise<{
      meta: AccidentRiskBundle["meta"];
      perSignal: SignalAccidentRisk[];
      hourly: number[];
      dow: number[];
    }> => {
      const r = await fetch(
        `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/atlanta/accident-risk?v=3`,
        { cache: "no-store" },
      );
      if (!r.ok) throw new Error(`accident-risk ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const predictMut = usePredictDay();

  // Auto-run prediction whenever inputs change.
  useEffect(() => {
    predictMut.mutate({ data: { date, weather, events } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, weather, JSON.stringify(events)]);

  const flowParams = useMemo(() => ({
    date,
    hour,
    weather,
    schoolDay: !!events.schoolDay,
    falconsHome: !!events.falconsHome,
    hawksHome: !!events.hawksHome,
    bravesHome: !!events.bravesHome,
    gtFootball: !!events.gtFootball,
    holiday: !!events.holiday,
    classes: "0,1,2",
  }), [date, hour, weather, JSON.stringify(events)]);

  const flowQ = useGetPredictedTrafficFlow(flowParams, {
    query: {
      queryKey: getGetPredictedTrafficFlowQueryKey(flowParams),
      staleTime: 60_000,
    },
  });
  const flow: PredictedTrafficFlow | undefined = flowQ.data;
  const flowCriticals: PredictedCriticalSignal[] = flow?.criticalSignals ?? [];

  const prediction = predictMut.data;
  const meta = prediction?.meta;
  const signals = prediction?.signals ?? [];
  const topWorst = prediction?.topWorst ?? [];
  const recs: PreemptiveRecommendation[] = prediction?.recommendations ?? [];

  const accidentMeta = accidentQ.data?.meta;

  const hourlyChart = useMemo(() => {
    return (prediction?.hourly ?? []).map((h) => ({
      hour: h.label,
      hourIdx: h.hour,
      avg: h.avgPredictedScore,
      critical: h.criticalCount,
      high: h.highCount,
      crashRisk: Math.round(h.crashLikelihoodFactor * 1000),
    }));
  }, [prediction]);

  // Accidents-by-hour from FARS — to display alongside the prediction chart
  const accidentsByHour = useMemo(() => {
    const arr = accidentQ.data?.hourly ?? [];
    const sum = arr.reduce((s, v) => s + v, 0) || 1;
    return arr.map((v, h) => ({ hour: hourLabel(h), pct: Math.round((v / sum) * 1000) / 10 }));
  }, [accidentQ.data]);

  const accidentsByDow = useMemo(() => {
    const arr = accidentQ.data?.dow ?? [];
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const sum = arr.reduce((s, v) => s + v, 0) || 1;
    return arr.map((v, i) => ({ day: labels[i]!, pct: Math.round((v / sum) * 1000) / 10 }));
  }, [accidentQ.data]);

  const isPredicting = predictMut.isPending;

  return (
    <div className="min-h-[100dvh] bg-background px-5 py-4 pt-[32px] pb-[64px] pl-[24px] pr-[24px]">
      <div className="max-w-[1600px] mx-auto">

        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="pt-2">
            <Link
              href="/"
              data-testid="link-back"
              className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to dashboard
            </Link>
            <h1 className="font-bold text-[32px] tracking-tight flex items-center gap-2">
              <Sparkles className="w-7 h-7 text-purple-600" />
              Predict Tomorrow's Traffic
            </h1>
            <p className="text-muted-foreground mt-1.5 text-[14px]">
              Per-signal next-day forecast fusing historical crash data, day-of-week & hour-of-day patterns,
              weather, and special-event multipliers.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[12px] text-muted-foreground shrink-0">Real data:</span>
              <span className="text-[12px] font-bold rounded px-2 py-0.5 bg-gray-200 text-gray-700">
                ARC Collisions 2019-2023
              </span>
              <span className="text-[12px] font-bold rounded px-2 py-0.5 bg-gray-200 text-gray-700">
                NHTSA FARS Georgia
              </span>
              {accidentMeta && accidentMeta.snappedCrashes > 0 && (
                <span className="text-[12px] text-muted-foreground">
                  · {accidentMeta.snappedCrashes.toLocaleString()} crashes snapped to {accidentMeta.signalsWithData.toLocaleString()} signals
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Live conditions strip — real-time scoreboard independent of the
            user's what-if scenario. Pulls today's actual incidents from the
            public GDOT 511 NaviGAtor feeds and compares against the model's
            top-N predicted-worst signals for today. */}
        <Card
          className="mb-5 border-orange-200 bg-orange-50/40 dark:border-orange-900/40 dark:bg-orange-950/20"
          data-testid="card-live-conditions"
        >
          <CardContent className="pt-5 pb-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2.5 shrink-0">
                <div className="relative">
                  <Radio className="w-5 h-5 text-orange-600" />
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                </div>
                <div>
                  <div className="text-[13px] font-semibold leading-tight">Live Atlanta conditions</div>
                  <div className="text-[11px] text-muted-foreground leading-tight">
                    GDOT 511 NaviGAtor public feed
                  </div>
                </div>
              </div>

              <div className="flex items-baseline gap-1.5">
                <span data-testid="text-live-count" className="text-[28px] font-bold tabular-nums text-orange-600 leading-none">
                  {liveQ.isPending ? "…" : liveIncidents.length}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  active metro incident{liveIncidents.length === 1 ? "" : "s"}
                </span>
              </div>

              {liveWeather && (() => {
                const WIcon = weatherIcon(liveWeather.condition);
                const tone =
                  liveWeather.condition === "snow" ? "text-sky-700 bg-sky-50 border-sky-200" :
                  liveWeather.condition === "heavy_rain" ? "text-blue-700 bg-blue-50 border-blue-200" :
                  liveWeather.condition === "light_rain" ? "text-cyan-700 bg-cyan-50 border-cyan-200" :
                  "text-amber-700 bg-amber-50 border-amber-200";
                return (
                  <div
                    data-testid="chip-live-weather"
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md border ${tone}`}
                    title={`${liveWeather.summary} — Open-Meteo, ${liveWeather.cached ? `cached ${liveWeather.cacheAgeSeconds}s` : "fresh"}`}
                  >
                    <WIcon className="w-4 h-4" />
                    <div className="flex flex-col leading-tight">
                      <span className="text-[12px] font-semibold">
                        {liveWeather.summary}
                        {liveWeather.temperatureF != null && (
                          <span className="ml-1 tabular-nums">{Math.round(liveWeather.temperatureF)}°F</span>
                        )}
                      </span>
                      <span className="text-[10px] opacity-75">
                        {liveWeather.precipitationInPerHr != null && liveWeather.precipitationInPerHr > 0
                          ? `${liveWeather.precipitationInPerHr.toFixed(2)}″/hr`
                          : "no precip"}
                        {liveWeather.windMph != null && ` · ${Math.round(liveWeather.windMph)} mph wind`}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {accuracy && !accuracy.upstreamDegraded && (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <Target className="w-4 h-4 text-purple-600 self-center" />
                    <span data-testid="text-hit-rate" className="text-[24px] font-bold tabular-nums text-purple-600 leading-none">
                      {accuracy.today?.hitRatePct?.toFixed(1) ?? "0.0"}%
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      hit rate today ({accuracy.today?.hits ?? 0}/{Object.keys(accuracy.today?.actualIncidentSignalCounts ?? {}).length} signals in top-{accuracy.today?.topNUsed ?? 150})
                    </span>
                  </div>

                  {accuracy.recentDays.length > 0 && (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[14px] font-semibold tabular-nums text-foreground">
                        {accuracy.rollingHitRatePct.toFixed(1)}%
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        7-day rolling avg
                      </span>
                    </div>
                  )}

                  {accuracy.recentActivitySignalCount > 0 && (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[14px] font-semibold tabular-nums text-foreground">
                        +{accuracy.recentActivitySignalCount}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        signals boosted by feedback loop
                      </span>
                    </div>
                  )}
                </>
              )}

              <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
                {liveAgeSec != null && (
                  <span data-testid="text-live-age">
                    Updated {liveAgeSec < 60 ? `${liveAgeSec}s` : `${Math.round(liveAgeSec / 60)}m`} ago
                  </span>
                )}
                <button
                  data-testid="btn-refresh-live"
                  onClick={() => { liveQ.refetch(); accuracyQ.refetch(); }}
                  disabled={liveQ.isFetching || accuracyQ.isFetching}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-input bg-background hover:bg-accent disabled:opacity-50 transition-colors"
                  title="Refresh now"
                >
                  <RefreshCw className={`w-3 h-3 ${liveQ.isFetching ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
            </div>

            {liveQ.isError && (
              <div className="mt-3 text-[12px] text-red-700 dark:text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Couldn't pull live conditions:{" "}
                {liveQ.error instanceof Error ? liveQ.error.message : String(liveQ.error)}
              </div>
            )}
            {accuracy?.upstreamDegraded && (
              <div
                data-testid="text-degraded-warning"
                className="mt-3 text-[12px] text-amber-700 dark:text-amber-400 flex items-center gap-1.5"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Live feed returned 0 incidents — accuracy snapshot for today is paused until the upstream recovers.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Today's predicted accident hotspots — top-N (signal × hour) most
            accident-likely combinations for the rest of today. Auto-uses
            live weather + the recent-activity feedback loop. */}
        <Card
          className="mb-5 border-red-200/60 dark:border-red-900/40"
          data-testid="card-today-hotspots"
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[16px]">
              <Flame className="w-5 h-5 text-red-600" />
              Today's predicted accident hotspots
              <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                top {hotspotsQ.data?.topN ?? 20}
              </Badge>
            </CardTitle>
            <CardDescription className="text-[12px]">
              Highest-likelihood (intersection × hour) combinations for the remainder of today
              {hotspotsQ.data && (
                <>
                  {" "}— driven by live weather (
                  <span className="font-medium">{hotspotsQ.data.weatherSummary}</span>
                  ), historical crash tier, and FARS hour-of-day distribution.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {hotspotsQ.isPending && (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            )}
            {hotspotsQ.isError && (
              <div className="text-[12px] text-red-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Could not compute today's predictions: {hotspotsQ.error instanceof Error ? hotspotsQ.error.message : String(hotspotsQ.error)}
              </div>
            )}
            {hotspots.length === 0 && !hotspotsQ.isPending && !hotspotsQ.isError && (
              <div className="text-[12px] text-muted-foreground py-2">
                No hours remain in today's window. Check back tomorrow morning for a fresh ranking.
              </div>
            )}
            {hotspots.length > 0 && (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-[12px]" data-testid="table-hotspots">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="px-2 py-2 font-medium w-8">#</th>
                      <th className="px-2 py-2 font-medium">Intersection</th>
                      <th className="px-2 py-2 font-medium w-20">Hour</th>
                      <th className="px-2 py-2 font-medium w-32">Likelihood</th>
                      <th className="px-2 py-2 font-medium w-24">Risk tier</th>
                      <th className="px-2 py-2 font-medium w-24 text-right">Hist. crashes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hotspots.map((h) => (
                      <tr
                        key={`${h.intersectionId}-${h.hour}`}
                        className="border-b last:border-b-0 hover:bg-muted/40 transition-colors"
                        data-testid={`row-hotspot-${h.rank}`}
                        title={h.rationale}
                      >
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{h.rank}</td>
                        <td className="px-2 py-1.5">
                          <Link
                            href={`/?signal=${encodeURIComponent(h.intersectionId)}`}
                            className="hover:underline text-foreground"
                          >
                            {h.intersectionName}
                          </Link>
                        </td>
                        <td className="px-2 py-1.5 tabular-nums font-medium">{h.hourLabel}</td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px] max-w-[100px]">
                              <div
                                className="h-full bg-red-500"
                                style={{ width: `${h.likelihood}%` }}
                              />
                            </div>
                            <span className="tabular-nums text-[11px] w-9 text-right">
                              {h.likelihood.toFixed(0)}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <span
                            className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide text-white"
                            style={{ backgroundColor: RISK_COLORS[h.crashRiskTier] }}
                          >
                            {h.crashRiskTier}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 tabular-nums text-right">{h.historicalCrashes.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center justify-between mt-2 px-2 text-[11px] text-muted-foreground">
                  <span>
                    {hotspotsQ.data?.includesPastHours ? "Including past hours" : `Filtered to hours ≥ ${hotspotsQ.data?.currentHourLocal ?? 0}:00`}
                  </span>
                  <span>
                    Updated {hotspotsQ.data?.generatedAt
                      ? new Date(hotspotsQ.data.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                      : "—"}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error banner — surface API failures explicitly so the page never
            renders silently empty when accident-risk or predict-day blow up. */}
        {(accidentQ.isError || predictMut.isError) && (
          <div
            data-testid="banner-error"
            className="mb-5 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-4 flex items-start gap-3"
          >
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-red-900 dark:text-red-100 text-[14px]">
                Could not load forecast data
              </div>
              <ul className="text-[12px] text-red-800 dark:text-red-200 mt-1 space-y-0.5">
                {accidentQ.isError && (
                  <li>
                    <span className="font-medium">Crash risk feed:</span>{" "}
                    {accidentQ.error instanceof Error ? accidentQ.error.message : String(accidentQ.error)}
                  </li>
                )}
                {predictMut.isError && (
                  <li>
                    <span className="font-medium">Prediction:</span>{" "}
                    {predictMut.error instanceof Error ? predictMut.error.message : String(predictMut.error)}
                  </li>
                )}
              </ul>
              <div className="mt-2 flex gap-2">
                <button
                  data-testid="btn-retry"
                  onClick={() => {
                    if (accidentQ.isError) accidentQ.refetch();
                    if (predictMut.isError) predictMut.mutate({ data: { date, weather, events } });
                  }}
                  className="text-[12px] px-3 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Controls */}
        <Card className="mb-5">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Date */}
              <div className="md:col-span-3">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground block mb-1.5">
                  <CalendarDays className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" /> Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  data-testid="input-date"
                  className="w-full px-3 py-2 text-[14px] border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-1"
                />
                {meta && (
                  <p className="text-[11px] text-muted-foreground mt-1">{meta.dayOfWeek}</p>
                )}
              </div>

              {/* Weather */}
              <div className="md:col-span-4">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground block mb-1.5">
                  Weather
                </label>
                <div className="flex gap-1">
                  {WEATHER_OPTIONS.map((w) => {
                    const Icon = w.icon;
                    const active = weather === w.value;
                    return (
                      <button
                        key={w.value}
                        data-testid={`btn-weather-${w.value}`}
                        onClick={() => setWeather(w.value)}
                        className={`flex flex-col items-center justify-center gap-1 py-2 flex-1 text-[11px] rounded-md border transition-colors ${
                          active
                            ? "border-purple-500 bg-purple-50 text-purple-900 dark:bg-purple-950 dark:text-purple-100"
                            : "border-input bg-background hover:bg-accent"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Events */}
              <div className="md:col-span-5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground block mb-1.5">
                  Special events
                </label>
                <div className="flex flex-wrap gap-1">
                  {EVENT_TOGGLES.map((ev) => {
                    const active = !!events[ev.key];
                    return (
                      <button
                        key={ev.key}
                        data-testid={`btn-event-${ev.key}`}
                        onClick={() => setEvents((p) => ({ ...p, [ev.key]: !p[ev.key] }))}
                        className={`px-2.5 py-1.5 text-[12px] rounded-md border transition-colors ${
                          active
                            ? "border-purple-500 bg-purple-50 text-purple-900 dark:bg-purple-950 dark:text-purple-100 font-medium"
                            : "border-input bg-background hover:bg-accent text-muted-foreground"
                        }`}
                      >
                        <span className="mr-1">{ev.emoji}</span>
                        {ev.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <KpiTile
            label="Critical signals"
            value={meta?.criticalCount}
            color="#A60808"
            loading={isPredicting}
            icon={<AlertTriangle className="w-4 h-4" />}
          />
          <KpiTile
            label="High-load signals"
            value={meta?.highCount}
            color="#795EFF"
            loading={isPredicting}
            icon={<TrendingUp className="w-4 h-4" />}
          />
          <KpiTile
            label="Avg peak score"
            value={meta?.avgPredictedScore}
            color="#0079F2"
            loading={isPredicting}
            icon={<Activity className="w-4 h-4" />}
          />
          <KpiTile
            label="Network peak hour"
            value={meta?.peakHourGlobal != null ? hourLabel(meta.peakHourGlobal) : undefined}
            color="#eab308"
            loading={isPredicting}
            icon={<MapPin className="w-4 h-4" />}
          />
          <KpiTile
            label="Day-of-week mult."
            value={meta?.dowMultiplier != null ? `${meta.dowMultiplier.toFixed(2)}×` : undefined}
            color="#009118"
            loading={isPredicting}
            icon={<CalendarDays className="w-4 h-4" />}
          />
        </div>

        {/* Predicted traffic flow map + hour slider */}
        <Card className="mb-5">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5" /> Predicted congestion map @ {hourLabel(hour)}
              </CardTitle>
              <CardDescription>
                Full road-network congestion forecast for {meta?.dayOfWeek ?? "the selected day"}.
                Drag the hour slider to see how predicted traffic evolves throughout the day.
                Numbered pins mark the top critical intersections (score ≥ 50).
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[12px] text-muted-foreground w-16 shrink-0">Hour:</span>
              <input
                type="range"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                data-testid="slider-hour"
                className="flex-1 accent-purple-600"
              />
              <span data-testid="text-hour-label" className="font-mono text-[14px] font-semibold w-16 text-right">{hourLabel(hour)}</span>
            </div>

            {flow && (
              <div className="flex items-center gap-4 mb-3 flex-wrap text-[12px]">
                <span className="text-muted-foreground font-medium">
                  {flow.segments.length.toLocaleString()} segments ·
                  avg score {flow.avgCongestion.toFixed(1)}
                </span>
                {(["severe", "heavy", "light", "free"] as const).map((lvl) => {
                  const cnt = flow.counts[lvl];
                  if (!cnt) return null;
                  return (
                    <span key={lvl} className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: FLOW_LEVEL_COLORS[lvl] }} />
                      {cnt.toLocaleString()} {FLOW_LEVEL_LABELS[lvl]}
                    </span>
                  );
                })}
                {flowQ.isFetching && (
                  <span className="text-muted-foreground italic">updating…</span>
                )}
              </div>
            )}

            {flowQ.isLoading ? (
              <Skeleton className="h-[560px] w-full rounded-md" />
            ) : flowQ.isError ? (
              <div className="h-[560px] rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 flex items-center justify-center">
                <div className="text-center">
                  <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                  <div className="text-[13px] text-red-700 dark:text-red-300">
                    Could not load predicted traffic flow
                  </div>
                  <button
                    onClick={() => flowQ.refetch()}
                    className="mt-2 text-[12px] px-3 py-1 rounded-md bg-red-600 text-white hover:bg-red-700"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : (
              <PredictedFlowMap flow={flow} criticalSignals={flowCriticals} />
            )}

            <div className="flex items-center gap-4 mt-3 flex-wrap text-[12px]">
              <span className="text-muted-foreground">Road congestion:</span>
              {(["free", "light", "heavy", "severe", "closed"] as const).map((lvl) => (
                <span key={lvl} className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: FLOW_LEVEL_COLORS[lvl] }} />
                  {FLOW_LEVEL_LABELS[lvl]}
                </span>
              ))}
              <span className="text-muted-foreground ml-2">Pins:</span>
              {(["critical", "high"] as const).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: SEVERITY_COLORS[s] }} />
                  {s}
                </span>
              ))}
            </div>

            {flow && flow.allHours.length > 0 && (
              <div className="mt-4">
                <div className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wide mb-2">
                  24-hour congestion timeline
                </div>
                <div className="flex gap-[2px] h-10">
                  {flow.allHours.map((h) => {
                    const maxScore = Math.max(...flow.allHours.map((x) => x.avgScore), 1);
                    const pct = Math.max(4, (h.avgScore / maxScore) * 100);
                    const color =
                      h.avgScore >= 40 ? FLOW_LEVEL_COLORS.severe :
                      h.avgScore >= 25 ? FLOW_LEVEL_COLORS.heavy :
                      h.avgScore >= 12 ? FLOW_LEVEL_COLORS.light : FLOW_LEVEL_COLORS.free;
                    const isSelected = h.hour === hour;
                    return (
                      <button
                        key={h.hour}
                        onClick={() => setHour(h.hour)}
                        className="flex-1 flex flex-col justify-end relative group"
                        title={`${h.label}: avg ${h.avgScore.toFixed(1)}, ${h.criticalCount} critical, ${h.highCount} high`}
                      >
                        <div
                          className="w-full rounded-t-sm transition-all"
                          style={{
                            height: `${pct}%`,
                            background: color,
                            opacity: isSelected ? 1 : 0.5,
                            outline: isSelected ? "2px solid #7c3aed" : "none",
                            outlineOffset: 1,
                          }}
                        />
                        {h.hour % 4 === 0 && (
                          <span className="text-[9px] text-muted-foreground text-center mt-0.5 leading-none">
                            {h.label}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hourly aggregates */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
          <Card>
            <CardHeader>
              <CardTitle>Network stress by hour</CardTitle>
              <CardDescription>
                Average predicted inefficiency score across all {signals.length.toLocaleString()} signals,
                with critical-band counts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isPredicting && !hourlyChart.length ? (
                <Skeleton className="h-[280px]" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={hourlyChart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={2} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <RTooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="avg"
                      name="Avg predicted score"
                      stroke="#0079F2"
                      fill="#0079F2"
                      fillOpacity={0.18}
                    />
                    <Area
                      type="monotone"
                      dataKey="critical"
                      name="Critical signals"
                      stroke="#A60808"
                      fill="#A60808"
                      fillOpacity={0.25}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Historical crash distribution</CardTitle>
              <CardDescription>
                Real FARS Georgia 2019-2023 fatal-crash share by hour of day & day of week — drives the
                "crash-likelihood factor" in the prediction model.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <p className="text-[11px] text-muted-foreground mb-1">By hour (% of fatal crashes)</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={accidentsByHour} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                      <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RTooltip content={<CustomTooltip />} />
                      <Bar dataKey="pct" name="Fatal crash %" fill="#dc2626" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1">By day of week (%)</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={accidentsByDow} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                      <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RTooltip content={<CustomTooltip />} />
                      <Bar dataKey="pct" name="Fatal crash %" fill="#f97316" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Top-30 worst predicted signals */}
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>Top 30 predicted-worst signals</CardTitle>
            <CardDescription>
              Sorted by predicted peak score for {meta?.dayOfWeek ?? "the selected day"}. Click a row to open it
              on the dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {isPredicting && !topWorst.length ? (
              <Skeleton className="h-[400px]" />
            ) : topWorst.length === 0 ? (
              <div data-testid="empty-top-worst" className="text-center py-12 text-[13px] text-muted-foreground">
                No predicted-worst signals available.
                {predictMut.isError ? " The prediction request failed — see the banner above." : ""}
              </div>
            ) : (
              <table className="w-full text-[13px]" data-testid="table-top-worst">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="text-left py-2 px-2">#</th>
                    <th className="text-left py-2 px-2">Signal</th>
                    <th className="text-right py-2 px-2">Baseline</th>
                    <th className="text-right py-2 px-2">Predicted peak</th>
                    <th className="text-right py-2 px-2">Δ</th>
                    <th className="text-center py-2 px-2">Peak hour</th>
                    <th className="text-center py-2 px-2">Severity</th>
                    <th className="text-center py-2 px-2">Crash tier</th>
                  </tr>
                </thead>
                <tbody>
                  {topWorst.map((s, i) => {
                    const delta = s.deltaVsBaseline;
                    return (
                      <tr
                        key={s.id}
                        data-testid={`row-worst-${i}`}
                        className="border-b border-border/40 hover:bg-accent/40 cursor-pointer"
                        onClick={() => {
                          window.location.href = `${import.meta.env.BASE_URL}?signal=${encodeURIComponent(s.id)}`;
                        }}
                      >
                        <td className="py-2 px-2 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="py-2 px-2">
                          <div className="font-medium truncate max-w-[420px]" title={s.name}>{s.name}</div>
                          <div className="text-[11px] text-muted-foreground">{s.roadClass}</div>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">{s.baselineScore.toFixed(1)}</td>
                        <td className="py-2 px-2 text-right tabular-nums font-semibold">{s.predictedPeakScore.toFixed(1)}</td>
                        <td className={`py-2 px-2 text-right tabular-nums ${delta > 0 ? "text-red-600" : delta < 0 ? "text-green-600" : "text-muted-foreground"}`}>
                          {delta > 0 ? "+" : ""}{delta.toFixed(1)}
                        </td>
                        <td className="py-2 px-2 text-center text-[12px] font-mono">{hourLabel(s.predictedPeakHour)}</td>
                        <td className="py-2 px-2 text-center">
                          <Badge style={{ backgroundColor: SEVERITY_COLORS[s.predictedSeverity], color: "#fff" }}>
                            {s.predictedSeverity}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-center">
                          {s.crashRiskTier === "none" ? (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          ) : (
                            <Badge style={{ backgroundColor: RISK_COLORS[s.crashRiskTier], color: "#fff" }}>
                              {s.crashRiskTier} {s.crashSurgePct > 0 ? `+${s.crashSurgePct.toFixed(0)}%` : ""}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Pre-emptive recommendations */}
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>Pre-emptive recommendations</CardTitle>
            <CardDescription>
              Signal-timing actions to load up before the predicted peak window.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isPredicting && !recs.length ? (
              <Skeleton className="h-[200px]" />
            ) : recs.length === 0 ? (
              <div data-testid="empty-recs" className="text-center py-8 text-[13px] text-muted-foreground">
                No pre-emptive recommendations for the selected scenario.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {recs.map((r, i) => (
                  <div
                    key={r.intersectionId}
                    data-testid={`card-rec-${i}`}
                    className="border border-border rounded-md p-3 bg-card hover:bg-accent/40 transition-colors cursor-pointer"
                    onClick={() => {
                      window.location.href = `${import.meta.env.BASE_URL}?signal=${encodeURIComponent(r.intersectionId)}`;
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="font-medium text-[13px] leading-tight truncate" title={r.intersectionName}>
                        {r.intersectionName}
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0 font-mono">
                        {hourLabel(r.predictedPeakHour)}
                      </Badge>
                    </div>
                    <div className="text-[12px] text-purple-700 dark:text-purple-300 font-medium mb-1.5 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      {r.action}
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-snug">{r.rationale}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Methodology */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[16px]">
              <Info className="w-4 h-4" /> How the forecast is built
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[13px] text-muted-foreground leading-relaxed space-y-2">
            <p>
              For each of the {signals.length.toLocaleString()} signalized intersections, hourly volume is scaled by
              <strong className="text-foreground"> shape(h) × dow × weather × event(corridor) </strong>
              and the resulting v/c ratio is fed back through the same Webster-delay scoring used on the dashboard.
            </p>
            <p>
              Weather multipliers: clear 1.00×, light rain 1.08×, heavy rain 1.18×, snow 1.45× (volume rises because
              speeds drop and effective capacity falls). Event corridors apply a radial boost around
              Mercedes-Benz Stadium, State Farm Arena, Truist Park, and Bobby Dodd Stadium during typical event windows.
            </p>
            <p>
              Crash-risk tiers are computed from <strong className="text-foreground">{accidentMeta?.snappedCrashes?.toLocaleString() ?? "—"} real crash records</strong>
              {" "}snapped within {accidentMeta?.snapRadiusMeters ?? 100}m of each signal (ARC Regional High Injury Network 2019-2023).
              Severe-tier signals get an additional +18% delay surge to capture the higher probability of a secondary
              incident on the predicted day.
            </p>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

function KpiTile({
  label, value, color, loading, icon,
}: {
  label: string;
  value: number | string | undefined;
  color: string;
  loading: boolean;
  icon: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-md p-3 bg-card">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      {loading || value == null ? (
        <Skeleton className="h-7 w-20 mt-1.5" />
      ) : (
        <div className="text-[24px] font-bold tabular-nums mt-1" style={{ color }}>
          {typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : value}
        </div>
      )}
    </div>
  );
}
