import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetLiveTrafficFlow,
  getGetLiveTrafficFlowQueryKey,
  useGetAccidentRisk,
  getGetAccidentRiskQueryKey,
  useGetLiveHotspotFixes,
  getGetLiveHotspotFixesQueryKey,
  useGetPredictionAccuracy,
  getGetPredictionAccuracyQueryKey,
  useGetDmsSpeeds,
  getGetDmsSpeedsQueryKey,
  useGetGdotAlerts,
  getGetGdotAlertsQueryKey,
  type LiveTrafficSegment,
  type LiveTrafficFlow,
  type LiveIncident,
  type LiveHotspotFix,
  type AccuracyReport,
  type DmsSpeedReading,
  type DmsSpeedBundle,
  type GdotAlert,
  type GdotAlertsBundle,
} from "@workspace/api-client-react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Tooltip as LeafletTooltip,
  CircleMarker,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft, Activity, RefreshCw, AlertTriangle, Sun, Cloud, CloudRain,
  CloudSnow, Info, MapPin, Radio, Ban, Skull, Wrench, Crosshair, Loader2,
  Target, TrendingUp, Gauge, Megaphone,
} from "lucide-react";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";

function dmsIcon(speedMph: number): L.DivIcon {
  const color =
    speedMph >= 55 ? "#16a34a" :
    speedMph >= 40 ? "#ca8a04" :
    speedMph >= 25 ? "#ea580c" : "#dc2626";
  return L.divIcon({
    className: "",
    iconSize: [42, 22],
    iconAnchor: [21, 11],
    html: `<div style="
      background:${color};color:#fff;font-size:11px;font-weight:700;
      padding:1px 5px;border-radius:4px;white-space:nowrap;
      box-shadow:0 1px 3px rgba(0,0,0,.35);text-align:center;
      line-height:18px;letter-spacing:-.3px;
    ">${Math.round(speedMph)} mph</div>`,
  });
}

// Apple-Maps-style palette.
const LEVEL_COLORS: Record<string, string> = {
  free:   "#34c759", // green
  light:  "#ffcc00", // yellow
  heavy:  "#ff9500", // orange
  severe: "#ff3b30", // red
  closed: "#1a1a1a", // near-black
};

const LEVEL_LABELS: Record<string, string> = {
  free:   "Free flow",
  light:  "Light",
  heavy:  "Heavy",
  severe: "Severe",
  closed: "Closed",
};

const ROAD_CLASS_LABEL = ["Motorway", "Trunk", "Primary", "Secondary"];

function weatherIcon(c: "clear" | "light_rain" | "heavy_rain" | "snow") {
  if (c === "snow") return CloudSnow;
  if (c === "heavy_rain") return CloudRain;
  if (c === "light_rain") return Cloud;
  return Sun;
}

// Convert a flat [lat0,lon0,lat1,lon1,...] polyline into Leaflet's nested
// [[lat,lon],...] form. Memoized at the segment level via useMemo above.
function unflatten(polyline: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < polyline.length; i += 2) {
    out.push([polyline[i]!, polyline[i + 1]!]);
  }
  return out;
}

// Sort levels in render order so "free" is drawn first and "severe"/"closed"
// sit on top — important when polylines overlap at intersections.
const RENDER_ORDER: LiveTrafficSegment["level"][] = ["free", "light", "heavy", "severe", "closed"];

// Render thickness by class: highways thicker than primaries.
function weightFor(rc: number, level: LiveTrafficSegment["level"]): number {
  const base = rc === 0 ? 4.5 : rc === 1 ? 3.5 : rc === 2 ? 2.5 : 1.8;
  // Bump severe/closed slightly so they pop visually.
  if (level === "severe" || level === "closed") return base + 0.7;
  return base;
}

// Pre-computed renderable form: each segment carries its already-unflattened
// LatLng tuple list AND a stable pathOptions object so React-Leaflet sees the
// same array+object identity across any cosmetic parent re-render.
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

export default function LiveTraffic() {
  const flowQ = useGetLiveTrafficFlow<LiveTrafficFlow>(
    { classes: "0,1,2" },
    {
      query: {
        queryKey: getGetLiveTrafficFlowQueryKey({ classes: "0,1,2" }),
        refetchInterval: 60_000,
        staleTime: 30_000,
      },
    },
  );
  const flow: LiveTrafficFlow | undefined = flowQ.data;
  const errored = flowQ.isError;

  // Group + pre-unflatten polylines + pre-build pathOptions exactly once per
  // fetched payload. This keeps the map subtree's prop identity stable across
  // any unrelated parent re-renders, so React.memo can fully short-circuit it.
  const grouped = useMemo(() => {
    if (!flow) return null;
    const buckets: Record<string, RenderSegment[]> = {
      free: [], light: [], heavy: [], severe: [], closed: [],
    };
    for (const s of flow.segments) {
      const positions = unflatten(s.polyline);
      const pathOptions = {
        color: LEVEL_COLORS[s.level]!,
        weight: weightFor(s.rc, s.level),
        opacity: s.level === "free" ? 0.55 : 0.9,
        dashArray: s.level === "closed" ? "6,4" : undefined,
        lineCap: "round" as const,
        lineJoin: "round" as const,
      };
      (buckets[s.level] ?? buckets.free)!.push({ ...s, positions, pathOptions });
    }
    return buckets;
  }, [flow]);

  // Top trouble spots = severe + closed with highest score, named ones preferred.
  const trouble = useMemo(() => {
    if (!flow) return [] as LiveTrafficSegment[];
    return flow.segments
      .filter((s) => s.level === "severe" || s.level === "closed")
      .sort((a, b) => {
        // Closed first, then highest score, then named ones.
        const ca = a.level === "closed" ? 1 : 0;
        const cb = b.level === "closed" ? 1 : 0;
        if (ca !== cb) return cb - ca;
        if (b.score !== a.score) return b.score - a.score;
        return (b.name ? 1 : 0) - (a.name ? 1 : 0);
      })
      .slice(0, 12);
  }, [flow]);

  // Stable incidents reference for the memoized map. flow.incidents is already
  // a stable reference per fetched payload, but defaulting to a static empty
  // array avoids triggering memo invalidation when flow is undefined → defined.
  const incidents = flow?.incidents ?? EMPTY_INCIDENTS;

  // ---- Crash-hotspot overlay (lazily fetched when the user toggles it on) ----
  const [showHotspots, setShowHotspots] = useState(false);
  const accidentQ = useGetAccidentRisk({
    query: {
      // queryKey is required by TanStack v5 even though orval's wrapper
      // defaults it at runtime; supply it explicitly to satisfy the types.
      queryKey: getGetAccidentRiskQueryKey(),
      enabled: showHotspots,
      staleTime: 5 * 60_000, // dataset is static per server boot
    },
  });
  // Show only the worst 150 crash hotspots (severe tier, ranked by
  // severityScore which weights fatals + serious injuries above raw count).
  // Showing the full ~4.4k high+severe signals turned the map into a sea of
  // red dots; capping at 150 keeps the densest crash corridors readable.
  const HOTSPOT_LIMIT = 150;
  const hotspots = useMemo<HotspotMarker[]>(() => {
    if (!showHotspots || !accidentQ.data?.perSignal) return EMPTY_HOTSPOTS;
    const severeOnly = accidentQ.data.perSignal.filter(
      (s) => s.riskTier === "severe",
    );
    severeOnly.sort((a, b) => b.severityScore - a.severityScore);
    return severeOnly.slice(0, HOTSPOT_LIMIT).map((s) => ({
      id: s.id,
      lat: s.latitude,
      lon: s.longitude,
      crashes: s.crashes,
      fatal: s.fatal,
      seriousInjuries: s.seriousInjuries,
      // Already filtered to "severe" above; the API type union includes
      // none/low/moderate/high/severe so TS can't narrow it for us.
      tier: "severe" as const,
      name: s.name,
    }));
  }, [showHotspots, accidentQ.data]);

  // ---- Suggested signal-timing fixes (lazily fetched when the user opens it) ----
  const [showFixes, setShowFixes] = useState(false);
  const fixesQ = useGetLiveHotspotFixes({
    query: {
      queryKey: getGetLiveHotspotFixesQueryKey(),
      enabled: showFixes,
      refetchInterval: showFixes ? 60_000 : undefined,
      staleTime: 30_000,
    },
  });

  // ---- Prediction accuracy (always on; lightweight) ----
  // Refetches every 90s to track the rolling hit-rate as new live incidents
  // come in throughout the day; tells the user how much to trust the colors
  // they're looking at right now.
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
  const accuracy = accuracyQ.data;

  // ---- DMS speed markers (lazily fetched when the user toggles them on) ----
  const [showDms, setShowDms] = useState(false);
  const dmsQ = useGetDmsSpeeds<DmsSpeedBundle>({
    query: {
      queryKey: getGetDmsSpeedsQueryKey(),
      enabled: showDms,
      refetchInterval: showDms ? 90_000 : undefined,
      staleTime: 60_000,
    },
  });
  const dmsReadings = useMemo<DmsSpeedReading[]>(() => {
    if (!showDms || !dmsQ.data?.speedReadings) return EMPTY_DMS;
    return dmsQ.data.speedReadings;
  }, [showDms, dmsQ.data]);

  // ---- GDOT metro alerts (always fetched; lightweight, 5min cache) ----
  const alertsQ = useGetGdotAlerts<GdotAlertsBundle>({
    query: {
      queryKey: getGetGdotAlertsQueryKey(),
      refetchInterval: 5 * 60_000,
      staleTime: 4 * 60_000,
    },
  });
  const alerts = alertsQ.data?.alerts ?? EMPTY_ALERTS;

  // Focused signal: clicking a fix card flies the map to that intersection
  // and renders a crosshair overlay so the operator can spot it instantly.
  const [focused, setFocused] = useState<FocusPoint | null>(null);
  const focusOnFix = useCallback((fix: LiveHotspotFix) => {
    setFocused({
      id: fix.intersectionId,
      lat: fix.latitude,
      lon: fix.longitude,
      label: fix.intersectionName,
    });
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 mb-5">
          <div>
            <Link
              href="/"
              data-testid="link-back-dashboard"
              className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to dashboard
            </Link>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Activity className="w-7 h-7 text-emerald-500" />
              Live Atlanta Traffic
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Apple-Maps-style colors for the metro&apos;s motorways, trunks and primary
              arterials. Refreshed every 60 seconds.{" "}
              {flow && flow.dmsSpeedCount > 0
                ? `Highway segments near ${flow.dmsSpeedCount} DMS boards use measured speeds; all others are model-estimated.`
                : "Estimated congestion — see the footnote for sources and method."}
            </p>
          </div>
          <LiveStatusStrip flow={flow} loading={flowQ.isLoading} accuracy={accuracy} />
        </div>

        {/* Color legend + overlay toggles */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Legend counts={flow?.counts} />
          <OverlayToolbar
            showHotspots={showHotspots}
            setShowHotspots={setShowHotspots}
            hotspotCount={hotspots.length}
            hotspotsLoading={showHotspots && accidentQ.isLoading}
            hotspotsErrored={showHotspots && accidentQ.isError}
            showFixes={showFixes}
            setShowFixes={setShowFixes}
            fixesCount={fixesQ.data?.fixes.length ?? 0}
            fixesLoading={showFixes && fixesQ.isLoading}
            fixesErrored={showFixes && fixesQ.isError}
            showDms={showDms}
            setShowDms={setShowDms}
            dmsCount={dmsReadings.length}
            dmsLoading={showDms && dmsQ.isLoading}
            dmsErrored={showDms && dmsQ.isError}
          />
        </div>

        {/* Alerts banner */}
        {alerts.length > 0 && <AlertsBanner alerts={alerts} />}

        {/* Map + side panel */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(320px,1fr)] gap-5 mt-4">
          <Card className="overflow-hidden">
            <div className="h-[640px] w-full" data-testid="map-live-traffic">
              <TrafficMap
                grouped={grouped}
                incidents={incidents}
                hotspots={hotspots}
                focused={focused}
                dmsReadings={dmsReadings}
              />
            </div>
          </Card>

          <div className="flex flex-col gap-4">
            {showFixes && (
              <FixesPanel
                bundle={fixesQ.data}
                loading={fixesQ.isLoading}
                errored={fixesQ.isError}
                focusedId={focused?.id ?? null}
                onSelect={focusOnFix}
                onClose={() => setShowFixes(false)}
              />
            )}
            <AccuracyPanel
              accuracy={accuracy}
              loading={accuracyQ.isLoading}
              errored={accuracyQ.isError}
            />
            <CountsPanel flow={flow} loading={flowQ.isLoading} errored={errored} />
            <TroublePanel trouble={trouble} loading={flowQ.isLoading} errored={errored} hasFlow={!!flow} />
            <IncidentsPanel incidents={flow?.incidents ?? []} loading={flowQ.isLoading} errored={errored} hasFlow={!!flow} isV2={!!flow && flow.source.includes("v2")} />
          </div>
        </div>

        {/* Source note */}
        <Card className="mt-5">
          <CardContent className="py-4 text-[12.5px] text-muted-foreground flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              {flow?.sourceNote ??
                "Apple-Maps-style colors are estimated from live GDOT incidents and our per-signal stress model (weather, day-of-week, events, recent activity). They are not direct GPS speed measurements."}
              {flow && (
                <>
                  {" "}Source: <span className="font-medium">{flow.source}</span>.
                  Live as of {new Date(flow.fetchedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET.
                </>
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------- subcomponents ----------

// Stable empty arrays so memoized children don't re-render when their data is
// undefined → defined just because we'd otherwise pass a fresh `[]`.
const EMPTY_INCIDENTS: LiveIncident[] = [];
const EMPTY_HOTSPOTS: HotspotMarker[] = [];
const EMPTY_DMS: DmsSpeedReading[] = [];
const EMPTY_ALERTS: GdotAlert[] = [];

type HotspotMarker = {
  id: string;
  lat: number;
  lon: number;
  crashes: number;
  fatal: number;
  seriousInjuries: number;
  tier: "high" | "severe";
  name: string;
};

type FocusPoint = {
  id: string;
  lat: number;
  lon: number;
  label: string;
};

// Layered map architecture: each visual layer is its own memoized child of
// MapContainer. This way toggling the crash-hotspot overlay or focusing on a
// single fix does NOT invalidate the giant ~30k-polyline layer — only the
// affected sub-layer reconciles. The MapContainer itself is cheap to re-render
// (it adopts new children without re-instantiating the underlying Leaflet map).
function TrafficMap({
  grouped,
  incidents,
  hotspots,
  focused,
  dmsReadings,
}: {
  grouped: Record<string, RenderSegment[]> | null;
  incidents: LiveIncident[];
  hotspots: HotspotMarker[];
  focused: FocusPoint | null;
  dmsReadings: DmsSpeedReading[];
}) {
  return (
    <MapContainer
      center={[33.749, -84.388]}
      zoom={10}
      preferCanvas
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; OpenStreetMap, &copy; CARTO'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <PolylineLayer grouped={grouped} />
      <IncidentLayer incidents={incidents} />
      <HotspotLayer hotspots={hotspots} />
      <DmsLayer readings={dmsReadings} />
      <FocusOverlay focused={focused} />
      <FocusController focused={focused} />
    </MapContainer>
  );
}

const PolylineLayer = memo(function PolylineLayer({
  grouped,
}: {
  grouped: Record<string, RenderSegment[]> | null;
}) {
  if (!grouped) return null;
  return (
    <>
      {RENDER_ORDER.map((level) =>
        (grouped[level] ?? []).map((seg, i) => (
          <Polyline
            key={`${level}-${i}`}
            positions={seg.positions}
            pathOptions={seg.pathOptions}
          >
            <LeafletTooltip sticky direction="top" offset={[0, -2]}>
              <div className="text-xs">
                <div className="font-semibold">
                  {seg.name ?? ROAD_CLASS_LABEL[seg.rc] ?? "Road"}
                </div>
                <div className="text-muted-foreground">
                  {LEVEL_LABELS[level]} · score {seg.score.toFixed(0)} · {ROAD_CLASS_LABEL[seg.rc] ?? "road"}
                </div>
              </div>
            </LeafletTooltip>
          </Polyline>
        ))
      )}
    </>
  );
});

const IncidentLayer = memo(function IncidentLayer({
  incidents,
}: {
  incidents: LiveIncident[];
}) {
  return (
    <>
      {incidents.map((inc) => (
        <CircleMarker
          key={`inc-${inc.id}`}
          center={[inc.latitude, inc.longitude]}
          radius={inc.isFullClosure ? 7 : 5}
          pathOptions={{
            color: inc.isFullClosure ? "#1a1a1a" : "#ff3b30",
            fillColor: inc.isFullClosure ? "#1a1a1a" : "#ff3b30",
            fillOpacity: 0.85,
            weight: 2,
          }}
        >
          <LeafletTooltip direction="top" offset={[0, -4]}>
            <div className="text-xs max-w-[260px]">
              <div className="font-semibold flex items-center gap-1">
                {inc.isFullClosure ? <Ban className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                {inc.eventType || "Incident"}
                {inc.isFullClosure && <span className="text-red-600">· FULL CLOSURE</span>}
              </div>
              <div className="text-muted-foreground mt-0.5">{inc.roadway}</div>
              {inc.description && (
                <div className="mt-1 text-[11px]">{inc.description.slice(0, 200)}</div>
              )}
            </div>
          </LeafletTooltip>
        </CircleMarker>
      ))}
    </>
  );
});

const HotspotLayer = memo(function HotspotLayer({
  hotspots,
}: {
  hotspots: HotspotMarker[];
}) {
  return (
    <>
      {hotspots.map((h) => {
        // Radius scales with log(crashes); fatal-bearing intersections get a
        // distinct dark-red ring to call out life-safety priority.
        const radius = Math.min(11, 2.5 + Math.log10(Math.max(1, h.crashes)) * 2.2);
        const fill = h.tier === "severe" ? "#b91c1c" : "#dc2626"; // red-700 / red-600
        return (
          <CircleMarker
            key={`hot-${h.id}`}
            center={[h.lat, h.lon]}
            radius={radius}
            pathOptions={{
              color: h.fatal > 0 ? "#450a0a" : fill,   // red-950 ring on fatal
              fillColor: fill,
              fillOpacity: 0.45,
              weight: h.fatal > 0 ? 1.5 : 0.8,
            }}
          >
            <LeafletTooltip direction="top" offset={[0, -4]}>
              <div className="text-xs max-w-[260px]">
                <div className="font-semibold flex items-center gap-1">
                  {h.fatal > 0 ? (
                    <Skull className="w-3 h-3 text-red-700" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 text-red-600" />
                  )}
                  Crash hotspot · {h.tier.toUpperCase()}
                </div>
                <div className="text-muted-foreground mt-0.5">{h.name}</div>
                <div className="mt-1 text-[11px]">
                  <span className="font-medium">{h.crashes.toLocaleString()}</span> crashes
                  {h.fatal > 0 && (
                    <span className="text-red-700 font-medium"> · {h.fatal} fatal</span>
                  )}
                  {h.seriousInjuries > 0 && (
                    <span> · {h.seriousInjuries} serious-injury</span>
                  )}
                  <span className="text-muted-foreground"> (ARC 2019–2023)</span>
                </div>
              </div>
            </LeafletTooltip>
          </CircleMarker>
        );
      })}
    </>
  );
});

const DmsLayer = memo(function DmsLayer({
  readings,
}: {
  readings: DmsSpeedReading[];
}) {
  const icons = useMemo(
    () => readings.map((r) => ({ reading: r, icon: dmsIcon(r.speedMph) })),
    [readings],
  );
  if (icons.length === 0) return null;
  return (
    <>
      {icons.map(({ reading: r, icon }) => (
        <Marker
          key={`dms-${r.id}`}
          position={[r.latitude, r.longitude]}
          icon={icon}
        >
          <Popup>
            <div className="text-xs min-w-[180px]">
              <div className="font-semibold text-[13px] flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5" />
                {r.name}
              </div>
              <div className="text-muted-foreground mt-0.5">{r.roadway} {r.direction}</div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-lg font-bold" style={{
                  color: r.speedMph >= 55 ? "#16a34a" : r.speedMph >= 40 ? "#ca8a04" : r.speedMph >= 25 ? "#ea580c" : "#dc2626",
                }}>{Math.round(r.speedMph)}</span>
                <span className="text-muted-foreground">mph measured</span>
              </div>
              <div className="mt-1 text-[10.5px] text-muted-foreground italic truncate" title={r.rawMessage}>
                &ldquo;{r.rawMessage}&rdquo;
              </div>
              {r.lastUpdated && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Updated {new Date(r.lastUpdated).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET
                </div>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
});

function FocusOverlay({ focused }: { focused: FocusPoint | null }) {
  if (!focused) return null;
  return (
    <CircleMarker
      key={`focus-${focused.id}`}
      center={[focused.lat, focused.lon]}
      radius={14}
      pathOptions={{
        color: "#0ea5e9",          // sky-500
        fillColor: "#0ea5e9",
        fillOpacity: 0.15,
        weight: 3,
        dashArray: "4,4",
      }}
    >
      <LeafletTooltip permanent direction="top" offset={[0, -10]}>
        <div className="text-xs font-semibold">{focused.label}</div>
      </LeafletTooltip>
    </CircleMarker>
  );
}

// Imperative side-effect: when `focused` changes, fly the map there. Lives in
// its own component so the imperative call doesn't end up in a render path.
function FocusController({ focused }: { focused: FocusPoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (!focused) return;
    map.flyTo([focused.lat, focused.lon], Math.max(map.getZoom(), 15), {
      duration: 0.8,
    });
  }, [focused, map]);
  return null;
}

function AlertsBanner({ alerts }: { alerts: GdotAlert[] }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || alerts.length === 0) return null;
  const important = alerts.filter((a) => a.highImportance);
  const shown = important.length > 0 ? important : alerts.slice(0, 3);
  return (
    <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3" data-testid="alerts-banner">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <Megaphone className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
          <div className="space-y-1.5 min-w-0">
            <div className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">
              GDOT Metro Alerts ({alerts.length})
            </div>
            {shown.map((a) => (
              <p key={a.id} className="text-[12px] text-amber-900 dark:text-amber-200 leading-snug">
                {a.message}
                {a.notes && (
                  <span className="text-amber-700 dark:text-amber-400"> — {a.notes.slice(0, 200)}</span>
                )}
              </p>
            ))}
            {alerts.length > shown.length && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                +{alerts.length - shown.length} more alert{alerts.length - shown.length === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-[11px] text-amber-600 hover:text-amber-800 dark:hover:text-amber-300 px-2 h-6 rounded border border-amber-400/50 shrink-0"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function OverlayToolbar({
  showHotspots,
  setShowHotspots,
  hotspotCount,
  hotspotsLoading,
  hotspotsErrored,
  showFixes,
  setShowFixes,
  fixesCount,
  fixesLoading,
  fixesErrored,
  showDms,
  setShowDms,
  dmsCount,
  dmsLoading,
  dmsErrored,
}: {
  showHotspots: boolean;
  setShowHotspots: (v: boolean) => void;
  hotspotCount: number;
  hotspotsLoading: boolean;
  hotspotsErrored: boolean;
  showFixes: boolean;
  setShowFixes: (v: boolean) => void;
  fixesCount: number;
  fixesLoading: boolean;
  fixesErrored: boolean;
  showDms: boolean;
  setShowDms: (v: boolean) => void;
  dmsCount: number;
  dmsLoading: boolean;
  dmsErrored: boolean;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="overlay-toolbar">
      <label
        className="inline-flex items-center gap-2 text-[12px] font-medium px-3 h-9 rounded-md border border-border bg-card cursor-pointer hover:bg-accent"
        data-testid="toggle-hotspots"
      >
        <Switch
          checked={showHotspots}
          onCheckedChange={setShowHotspots}
          aria-label="Toggle crash hotspots overlay"
        />
        <Skull className="w-3.5 h-3.5 text-red-600" />
        <span>Crash hotspots</span>
        {hotspotsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        {hotspotsErrored && (
          <span className="text-red-600 text-[11px]">· feed error</span>
        )}
        {showHotspots && !hotspotsLoading && !hotspotsErrored && (
          <span className="text-muted-foreground">
            · {hotspotCount.toLocaleString()} shown
          </span>
        )}
      </label>
      <label
        className="inline-flex items-center gap-2 text-[12px] font-medium px-3 h-9 rounded-md border border-border bg-card cursor-pointer hover:bg-accent"
        data-testid="toggle-fixes"
      >
        <Switch
          checked={showFixes}
          onCheckedChange={setShowFixes}
          aria-label="Toggle suggested signal-timing fixes"
        />
        <Wrench className="w-3.5 h-3.5 text-emerald-600" />
        <span>Suggest signal fixes</span>
        {fixesLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        {fixesErrored && (
          <span className="text-red-600 text-[11px]">· compute error</span>
        )}
        {showFixes && !fixesLoading && !fixesErrored && (
          <span className="text-muted-foreground">· {fixesCount} fixes</span>
        )}
      </label>
      <label
        className="inline-flex items-center gap-2 text-[12px] font-medium px-3 h-9 rounded-md border border-border bg-card cursor-pointer hover:bg-accent"
        data-testid="toggle-dms"
      >
        <Switch
          checked={showDms}
          onCheckedChange={setShowDms}
          aria-label="Toggle DMS speed markers"
        />
        <Gauge className="w-3.5 h-3.5 text-blue-600" />
        <span>DMS speeds</span>
        {dmsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        {dmsErrored && (
          <span className="text-red-600 text-[11px]">· feed error</span>
        )}
        {showDms && !dmsLoading && !dmsErrored && (
          <span className="text-muted-foreground">· {dmsCount} boards</span>
        )}
      </label>
    </div>
  );
}

function FixesPanel({
  bundle,
  loading,
  errored,
  focusedId,
  onSelect,
  onClose,
}: {
  bundle:
    | {
        fetchedAt: string;
        currentHourLocal: number;
        hourLabel: string;
        totalCandidates: number;
        fixes: LiveHotspotFix[];
        note: string;
      }
    | undefined;
  loading: boolean;
  errored: boolean;
  focusedId: string | null;
  onSelect: (fix: LiveHotspotFix) => void;
  onClose: () => void;
}) {
  return (
    <Card data-testid="panel-fixes" className="border-emerald-500/40">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Wrench className="w-4 h-4 text-emerald-600" />
              Suggested signal fixes
            </CardTitle>
            <CardDescription>
              Crash-prone intersections that are congested right now, with
              concrete timing recommendations.
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-muted-foreground hover:text-foreground px-2 h-6 rounded border border-border"
            data-testid="button-close-fixes"
          >
            Hide
          </button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading && <Skeleton className="h-[300px] w-full" />}
        {!loading && errored && (
          <p className="text-[13px] text-red-600 dark:text-red-400 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            Could not compute hotspot fixes right now. This is not the same as
            &quot;no fixes&quot; — please retry shortly.
          </p>
        )}
        {!loading && !errored && bundle && (
          <>
            <div className="text-[11.5px] text-muted-foreground mb-2">
              {bundle.fixes.length} of {bundle.totalCandidates.toLocaleString()} crash-prone
              congested signals shown · {bundle.hourLabel} local
            </div>
            {bundle.fixes.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No crash-prone intersections are currently in heavy or worse
                congestion. Network is operating safely right now.
              </p>
            ) : (
              <ul className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {bundle.fixes.map((fix) => (
                  <FixCard
                    key={fix.intersectionId}
                    fix={fix}
                    selected={focusedId === fix.intersectionId}
                    onSelect={onSelect}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FixCard({
  fix,
  selected,
  onSelect,
}: {
  fix: LiveHotspotFix;
  selected: boolean;
  onSelect: (fix: LiveHotspotFix) => void;
}) {
  const phaseDelta = fix.suggestedPhaseSeconds - fix.currentPhaseSeconds;
  const cycleDelta = fix.suggestedCycleLength - fix.currentCycleLength;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(fix)}
        className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
          selected
            ? "border-sky-500 bg-sky-50 dark:bg-sky-950/30"
            : "border-border hover:bg-accent"
        }`}
        data-testid={`fix-card-${fix.intersectionId}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold truncate" title={fix.intersectionName}>
              {fix.intersectionName}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 h-4"
                style={{
                  borderColor: LEVEL_COLORS[fix.currentLevel],
                  color: LEVEL_COLORS[fix.currentLevel],
                }}
              >
                {fix.currentLevel.toUpperCase()} {fix.currentScore.toFixed(0)}
              </Badge>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 h-4 ${
                  fix.riskTier === "severe"
                    ? "border-red-700 text-red-700"
                    : "border-red-500 text-red-600"
                }`}
              >
                {fix.riskTier === "severe" ? "SEVERE CRASH" : "HIGH CRASH"}
              </Badge>
              {fix.fatal > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 h-4 border-red-900 text-red-900 dark:text-red-300"
                >
                  <Skull className="w-2.5 h-2.5 mr-0.5" /> {fix.fatal} fatal
                </Badge>
              )}
              {fix.hasNearbyIncident && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 h-4 border-orange-500 text-orange-600"
                >
                  LIVE INCIDENT
                </Badge>
              )}
            </div>
          </div>
          <Crosshair className="w-3.5 h-3.5 text-muted-foreground mt-1 shrink-0" />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 text-[11.5px]">
          <div className="rounded bg-muted/50 px-2 py-1">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
              {fix.targetPhase}
            </div>
            <div className="font-mono">
              <span className="text-muted-foreground">{fix.currentPhaseSeconds}s</span>
              <span className="mx-1">→</span>
              <span className="text-emerald-600 font-semibold">
                {fix.suggestedPhaseSeconds}s
              </span>
              {phaseDelta > 0 && (
                <span className="text-emerald-600 text-[10px]"> +{phaseDelta}s</span>
              )}
            </div>
          </div>
          <div className="rounded bg-muted/50 px-2 py-1">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
              Cycle length
            </div>
            <div className="font-mono">
              <span className="text-muted-foreground">{fix.currentCycleLength}s</span>
              <span className="mx-1">→</span>
              <span className="text-emerald-600 font-semibold">
                {fix.suggestedCycleLength}s
              </span>
              {cycleDelta > 0 && (
                <span className="text-emerald-600 text-[10px]"> +{cycleDelta}s</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-1">
          <span className="font-medium text-emerald-600">
            ≈ −{fix.estimatedDelayReductionSeconds.toFixed(1)}s avg delay
          </span>
          <span>·</span>
          <span>
            <span className="font-medium">{fix.crashes.toLocaleString()}</span> crashes (5y)
          </span>
        </div>
      </button>
    </li>
  );
}

function LiveStatusStrip({
  flow,
  loading,
  accuracy,
}: {
  flow: LiveTrafficFlow | undefined;
  loading: boolean;
  accuracy: AccuracyReport | undefined;
}) {
  // 5s "X seconds ago" tick lives HERE so only this strip re-renders. The
  // parent <LiveTraffic> component (which owns the giant memoized map) stays
  // unchanged across ticks. Without this isolation, every 5s tick would
  // walk the entire ~30k polyline subtree during reconciliation.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  if (loading || !flow) {
    return <Skeleton className="h-12 w-[420px]" />;
  }
  const fetchedAgoSec = Math.max(
    0,
    Math.floor((nowMs - new Date(flow.fetchedAt).getTime()) / 1000),
  );
  const W = weatherIcon(flow.weather);
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="status-strip">
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 h-7 rounded-md bg-muted">
        <W className="w-3.5 h-3.5" />
        {flow.weatherSummary}
      </span>
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 h-7 rounded-md bg-muted">
        <Activity className="w-3.5 h-3.5" />
        {flow.dayOfWeek} · {flow.hourLabel}
      </span>
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 h-7 rounded-md bg-muted">
        <AlertTriangle className="w-3.5 h-3.5" />
        {flow.activeIncidents} incidents
        {flow.fullClosures > 0 && <span className="text-red-600">· {flow.fullClosures} full</span>}
      </span>
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 h-7 rounded-md bg-muted">
        <Radio className={`w-3.5 h-3.5 ${fetchedAgoSec < 5 ? "text-emerald-500 animate-pulse" : ""}`} />
        {fetchedAgoSec < 5
          ? "Live"
          : fetchedAgoSec < 60
            ? `${fetchedAgoSec}s ago`
            : `${Math.floor(fetchedAgoSec / 60)}m ago`}
      </span>
      {flow.dmsSpeedCount > 0 && (
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 h-7 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-400">
          <Gauge className="w-3.5 h-3.5" />
          {flow.dmsSpeedCount} DMS measured
        </span>
      )}
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 h-7 rounded-md bg-muted">
        <RefreshCw className="w-3.5 h-3.5" />
        Auto-refresh 60s
      </span>
      {accuracy && <AccuracyChip accuracy={accuracy} />}
    </div>
  );
}

// Compact 7-day rolling-hit-rate chip wedged into the live status strip so
// users can tell at a glance how trustworthy today's predicted colors are.
// Falls back gracefully when the rolling history hasn't accumulated enough
// days yet (cold start).
function AccuracyChip({ accuracy }: { accuracy: AccuracyReport }) {
  const pct = accuracy.rollingHitRatePct;
  const tone = accuracyTone(pct);
  const haveHistory = accuracy.recentDays.length > 0;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 h-7 rounded-md ${tone.chip}`}
      title={
        haveHistory
          ? `Top-150 predicted-worst signals matched ${pct.toFixed(0)}% of actual incidents over the last ${accuracy.recentDays.length} day(s).`
          : "Rolling accuracy will appear once enough days have been observed."
      }
      data-testid="chip-accuracy"
    >
      <Target className="w-3.5 h-3.5" />
      {haveHistory ? (
        <>
          7d hit-rate <span className={tone.text}>{pct.toFixed(0)}%</span>
        </>
      ) : (
        <>Predictions: warming up</>
      )}
      {accuracy.upstreamDegraded && (
        <span className="text-amber-600 text-[10px]">· feed degraded</span>
      )}
    </span>
  );
}

// Thresholds intentionally generous: top-N=200 against ~13 daily incidents
// in a metro of 7,393 signals is a HARD problem (random-baseline hit-rate is
// ~2.7%), so anything north of ~10% is materially better than chance and
// north of ~25% is genuinely strong.
function accuracyTone(pct: number): { chip: string; text: string } {
  if (pct >= 25) {
    return {
      chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      text: "font-bold",
    };
  }
  if (pct >= 10) {
    return {
      chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
      text: "font-bold",
    };
  }
  return {
    chip: "bg-muted text-muted-foreground",
    text: "font-bold text-foreground",
  };
}

// Side-panel card with the rich prediction-accuracy breakdown: today's
// hits/precision so far, the 7-day rolling stats, a tiny day-by-day bar
// sparkline, and the count of signals currently being upweighted by the
// recent-activity feedback loop. Shows a clear amber warning when the GDOT
// 511 feed is degraded so users know today's stats are missing data.
function AccuracyPanel({
  accuracy,
  loading,
  errored,
}: {
  accuracy: AccuracyReport | undefined;
  loading: boolean;
  errored: boolean;
}) {
  if (loading && !accuracy) return <Skeleton className="h-[180px] w-full" />;
  if (errored || !accuracy) {
    return (
      <Card data-testid="panel-accuracy">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-600" />
            Prediction accuracy
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-[13px] text-red-600 dark:text-red-400 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            Accuracy stats are temporarily unavailable. The hit-rate calculation
            depends on the live incident feed; please retry shortly.
          </p>
        </CardContent>
      </Card>
    );
  }
  const today = accuracy.today;
  const hitTone = accuracyTone(accuracy.rollingHitRatePct);
  const precTone = accuracyTone(accuracy.rollingPrecisionPct);
  // Build the day-bar sparkline from oldest → newest so it reads left-to-right.
  // We cap at 7 days; recentDays is newest-first so reverse for the bar order.
  const sparkDays = [...accuracy.recentDays].reverse().slice(-7);
  const maxPct = Math.max(
    1,
    ...sparkDays.map((d) => d.hitRatePct),
    today?.hitRatePct ?? 0,
  );
  return (
    <Card data-testid="panel-accuracy" className="border-emerald-500/30">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-600" />
              Prediction accuracy
            </CardTitle>
            <CardDescription>
              Top-150 predicted-worst signals vs. signals that actually saw an
              incident
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {accuracy.upstreamDegraded && (
          <p className="text-[12px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5 bg-amber-500/10 rounded px-2 py-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            GDOT 511 feed degraded — today&apos;s snapshot was not persisted, so
            current numbers may understate true accuracy.
          </p>
        )}

        {/* Two big stats: rolling hit-rate and precision over the last 7 days */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              7d hit-rate
            </div>
            <div className={`text-2xl ${hitTone.text}`}>
              {accuracy.rollingHitRatePct.toFixed(0)}%
            </div>
            <div className="text-[10.5px] text-muted-foreground">
              of incidents fell on a top-150 signal
            </div>
          </div>
          <div className="rounded-md border border-border px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              7d precision
            </div>
            <div className={`text-2xl ${precTone.text}`}>
              {accuracy.rollingPrecisionPct.toFixed(0)}%
            </div>
            <div className="text-[10.5px] text-muted-foreground">
              of top-150 signals saw an incident
            </div>
          </div>
        </div>

        {/* Today's running tally */}
        {today && (
          <div className="text-[12px] flex items-baseline justify-between gap-2 border-t border-border pt-2">
            <div>
              <span className="text-muted-foreground">Today so far · </span>
              <span className="font-medium">
                {today.hits} of {today.actualIncidentTotal}
              </span>
              <span className="text-muted-foreground">
                {" "}({today.hitRatePct.toFixed(0)}%)
              </span>
            </div>
            <div className="text-[10.5px] text-muted-foreground">
              {today.actualIncidentTotal === 0
                ? "no incidents yet"
                : `${today.actualIncidentTotal} incident${today.actualIncidentTotal === 1 ? "" : "s"}`}
            </div>
          </div>
        )}

        {/* Day-by-day bar sparkline. We only render the bar chart when at
            least one day has a non-zero hit-rate — otherwise the bars
            collapse to a 1px sliver and the section reads as broken. */}
        {sparkDays.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> Daily hit-rate
              </span>
              <span className="normal-case tracking-normal">
                last {sparkDays.length} day{sparkDays.length === 1 ? "" : "s"}
              </span>
            </div>
            {sparkDays.every((d) => d.hitRatePct === 0) ? (
              <p className="text-[11.5px] text-muted-foreground" data-testid="accuracy-sparkline-empty">
                No top-150 hits yet over the last {sparkDays.length} day
                {sparkDays.length === 1 ? "" : "s"} — predictions are still
                training against live observations.
              </p>
            ) : (
              <div className="flex items-end gap-1 h-12" data-testid="accuracy-sparkline">
                {sparkDays.map((d) => {
                  const h = Math.max(4, (d.hitRatePct / maxPct) * 100);
                  const tone = accuracyTone(d.hitRatePct);
                  return (
                    <div
                      key={d.date}
                      className="flex-1 flex flex-col items-center justify-end"
                      title={`${d.date}: ${d.hits}/${d.actualIncidentTotal} incidents (${d.hitRatePct.toFixed(0)}% hit-rate)`}
                    >
                      <div
                        className={`w-full rounded-t-sm ${
                          tone.chip.includes("emerald")
                            ? "bg-emerald-500/70"
                            : tone.chip.includes("amber")
                              ? "bg-amber-500/70"
                              : "bg-muted-foreground/40"
                        }`}
                        style={{ height: `${h}%` }}
                      />
                      <div className="text-[9px] text-muted-foreground mt-0.5">
                        {d.date.slice(5)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Feedback-loop indicator */}
        {accuracy.recentActivitySignalCount > 0 && (
          <div className="text-[11px] text-muted-foreground flex items-start gap-1.5 border-t border-border pt-2">
            <Activity className="w-3 h-3 mt-0.5 shrink-0 text-emerald-600" />
            <span>
              <span className="font-medium text-foreground">
                {accuracy.recentActivitySignalCount.toLocaleString()}
              </span>{" "}
              signal{accuracy.recentActivitySignalCount === 1 ? "" : "s"} are being
              upweighted in real time by the 7-day recent-activity feedback loop.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Legend({ counts }: { counts?: { free: number; light: number; heavy: number; severe: number; closed: number } }) {
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="legend">
      {(["free", "light", "heavy", "severe", "closed"] as const).map((k) => (
        <div
          key={k}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 h-7 rounded-md border border-border"
        >
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ backgroundColor: LEVEL_COLORS[k] }}
          />
          {LEVEL_LABELS[k]}
          {counts && (
            <span className="text-muted-foreground">· {counts[k].toLocaleString()}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function CountsPanel({
  flow,
  loading,
  errored,
}: {
  flow: LiveTrafficFlow | undefined;
  loading: boolean;
  errored: boolean;
}) {
  if (loading) return <Skeleton className="h-[180px] w-full" />;
  if (errored || !flow) {
    return (
      <Card data-testid="panel-counts">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Network at a glance</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-[13px] text-red-600 dark:text-red-400 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            Live traffic data is temporarily unavailable. The map cannot show current
            congestion until the next refresh succeeds.
          </p>
        </CardContent>
      </Card>
    );
  }
  const total = flow.segments.length || 1;
  const slow = flow.counts.heavy + flow.counts.severe + flow.counts.closed;
  const slowPct = (slow / total) * 100;
  return (
    <Card data-testid="panel-counts">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Network at a glance</CardTitle>
        <CardDescription>
          {total.toLocaleString()} major road segments scored ·
          avg congestion {flow.avgCongestion.toFixed(1)}/100
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-[12px] text-muted-foreground mb-2">
          {slowPct.toFixed(1)}% of segments are heavy or worse right now
        </div>
        {/* Stacked bar */}
        <div className="flex h-3 w-full rounded-md overflow-hidden mb-3">
          {(["free", "light", "heavy", "severe", "closed"] as const).map((k) => {
            const w = (flow.counts[k] / total) * 100;
            if (w < 0.05) return null;
            return (
              <div
                key={k}
                style={{ width: `${w}%`, backgroundColor: LEVEL_COLORS[k] }}
                title={`${LEVEL_LABELS[k]}: ${flow.counts[k]} (${w.toFixed(1)}%)`}
              />
            );
          })}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {(["free", "light", "heavy", "severe", "closed"] as const).map((k) => (
            <div key={k} className="text-center">
              <div
                className="text-lg font-bold"
                style={{ color: LEVEL_COLORS[k] }}
              >
                {flow.counts[k].toLocaleString()}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {LEVEL_LABELS[k]}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TroublePanel({
  trouble,
  loading,
  errored,
  hasFlow,
}: {
  trouble: LiveTrafficSegment[];
  loading: boolean;
  errored: boolean;
  hasFlow: boolean;
}) {
  if (loading) return <Skeleton className="h-[260px] w-full" />;
  return (
    <Card data-testid="panel-trouble">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          Top trouble spots
        </CardTitle>
        <CardDescription>
          Severe and closed segments, sorted by impact
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {errored || !hasFlow ? (
          <p className="text-[13px] text-red-600 dark:text-red-400 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            Trouble-spot data is unavailable right now (live feed error). This is
            not the same as &quot;no incidents&quot; — please retry shortly.
          </p>
        ) : trouble.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No severe segments right now. Network looks clean.
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-[260px] overflow-y-auto">
            {trouble.map((s, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 text-[12.5px]"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: LEVEL_COLORS[s.level] }}
                  />
                  <span className="truncate" title={s.name ?? ""}>
                    {s.name ?? `${ROAD_CLASS_LABEL[s.rc] ?? "Road"} segment`}
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className="shrink-0 text-[10.5px] px-1.5 h-5"
                  style={{
                    borderColor: LEVEL_COLORS[s.level],
                    color: LEVEL_COLORS[s.level],
                  }}
                >
                  {s.level === "closed" ? "CLOSED" : s.score.toFixed(0)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function IncidentsPanel({
  incidents,
  loading,
  errored,
  hasFlow,
  isV2,
}: {
  incidents: LiveIncident[];
  loading: boolean;
  errored: boolean;
  hasFlow: boolean;
  isV2: boolean;
}) {
  if (loading) return <Skeleton className="h-[200px] w-full" />;
  return (
    <Card data-testid="panel-incidents">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="w-4 h-4 text-red-500" />
          Active incidents
        </CardTitle>
        <CardDescription>
          {isV2 ? "Live from GDOT 511 v2 Event API" : "Live from GDOT 511 NaviGAtor"}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {errored || !hasFlow ? (
          <p className="text-[13px] text-red-600 dark:text-red-400 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            Live incident feed is unavailable right now. This is not the same as
            &quot;no incidents&quot; — please retry shortly.
          </p>
        ) : incidents.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No active incidents reported in the metro right now.
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-[260px] overflow-y-auto">
            {incidents.map((inc) => (
              <li key={inc.id} className="text-[12.5px]">
                <div className="flex items-center gap-2">
                  {inc.isFullClosure ? (
                    <Ban className="w-3.5 h-3.5 text-black dark:text-white shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  )}
                  <span className="font-medium truncate flex-1" title={inc.roadway}>
                    {inc.roadway || inc.eventType || "Incident"}
                  </span>
                  {inc.isFullClosure && (
                    <Badge
                      variant="outline"
                      className="shrink-0 text-[10px] px-1.5 h-5 border-red-500 text-red-600"
                    >
                      CLOSED
                    </Badge>
                  )}
                </div>
                {inc.description && (
                  <div className="text-[11px] text-muted-foreground pl-5 truncate" title={inc.description}>
                    {inc.description}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
