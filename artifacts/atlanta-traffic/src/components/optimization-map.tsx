import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap, LayersControl, LayerGroup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  IntersectionChange,
  useGetRoadNetwork,
  getGetRoadNetworkQueryKey,
} from "@workspace/api-client-react";

interface OptimizationMapProps {
  changes: IntersectionChange[];
  isDark?: boolean;
}

const IMPROVEMENT_BUCKETS = [
  { id: "major", label: "Major drop (≥20 pts)", color: "#009118", min: 20 },
  { id: "moderate", label: "Moderate drop (10–20)", color: "#5BAE3D", min: 10 },
  { id: "minor", label: "Minor drop (1–10)", color: "#A8D8A8", min: 1 },
  { id: "none", label: "No change", color: "#9CA3AF", min: 0 },
  { id: "worse", label: "Got worse (rare)", color: "#A60808", min: -Infinity },
];

function bucketFor(delta: number) {
  if (delta < 0) return IMPROVEMENT_BUCKETS[4]!;
  if (delta < 1) return IMPROVEMENT_BUCKETS[3]!;
  if (delta < 10) return IMPROVEMENT_BUCKETS[2]!;
  if (delta < 20) return IMPROVEMENT_BUCKETS[1]!;
  return IMPROVEMENT_BUCKETS[0]!;
}

const ROAD_STYLES = [
  { name: "Interstate / Motorway", color: "#E55934", weight: 2.4, opacity: 0.85 },
  { name: "US / State Highway",    color: "#F4A261", weight: 1.9, opacity: 0.8  },
  { name: "Primary Arterial",      color: "#FFC857", weight: 1.4, opacity: 0.65 },
  { name: "Secondary Arterial",    color: "#9CC4E4", weight: 0.9, opacity: 0.55 },
];

const ROAD_STYLES_DARK = [
  { name: "Interstate / Motorway", color: "#FF7A5C", weight: 2.4, opacity: 0.9 },
  { name: "US / State Highway",    color: "#FFB36E", weight: 1.9, opacity: 0.85 },
  { name: "Primary Arterial",      color: "#FFD876", weight: 1.4, opacity: 0.7 },
  { name: "Secondary Arterial",    color: "#5C8FB5", weight: 0.9, opacity: 0.55 },
];

type RoadWay = [number, Array<[number, number]>] | [number, string, Array<[number, number]>];

function MapBounds({ count }: { count: number }) {
  const map = useMap();
  useEffect(() => {
    if (count > 0) map.setView([33.79, -84.39], 11);
  }, [count, map]);
  return null;
}

function RoadLayer({
  classedWays,
  classCode,
  isDark,
}: {
  classedWays: Array<Array<[number, number]>>;
  classCode: number;
  isDark: boolean;
}) {
  const style = (isDark ? ROAD_STYLES_DARK : ROAD_STYLES)[classCode]!;
  if (classedWays.length === 0) return null;
  return (
    <Polyline
      positions={classedWays}
      pathOptions={{
        color: style.color,
        weight: style.weight,
        opacity: style.opacity,
        interactive: false,
      }}
    />
  );
}

function diffBadge(before: number, after: number, suffix = "s") {
  const delta = after - before;
  const sign = delta > 0 ? "+" : "";
  const color = delta > 0 ? "#009118" : delta < 0 ? "#A60808" : "#6B7280";
  return (
    <span style={{ color, fontWeight: 600 }}>
      {sign}
      {delta}
      {suffix}
    </span>
  );
}

export function OptimizationMap({ changes, isDark }: OptimizationMapProps) {
  const tileUrl = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  const attribution = isDark
    ? '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; OpenStreetMap'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  const { data: roadNetwork } = useGetRoadNetwork({
    query: {
      queryKey: getGetRoadNetworkQueryKey(),
      staleTime: Infinity,
      gcTime: Infinity,
    },
  });

  const waysByClass = useMemo(() => {
    const buckets: Array<Array<Array<[number, number]>>> = [[], [], [], []];
    const list = (roadNetwork?.ways ?? []) as RoadWay[];
    for (const w of list) {
      const cls = w[0];
      if (cls < 0 || cls > 3) continue;
      const coords = (w.length === 3 ? w[2] : w[1]) as Array<[number, number]>;
      buckets[cls]!.push(coords);
    }
    return buckets;
  }, [roadNetwork]);

  const styles = isDark ? ROAD_STYLES_DARK : ROAD_STYLES;
  const [showLegend, setShowLegend] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Pre-compute bucket per signal once.
  const enrichedChanges = useMemo(
    () =>
      changes.map((c) => ({ ...c, bucket: bucketFor(c.scoreBefore - c.scoreAfter) })),
    [changes],
  );

  const filtered = useMemo(
    () =>
      activeFilter
        ? enrichedChanges.filter((c) => c.bucket.id === activeFilter)
        : enrichedChanges,
    [enrichedChanges, activeFilter],
  );

  const bucketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of enrichedChanges) {
      counts[c.bucket.id] = (counts[c.bucket.id] ?? 0) + 1;
    }
    return counts;
  }, [enrichedChanges]);

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[33.79, -84.39]}
        zoom={11}
        style={{ height: "100%", width: "100%", zIndex: 1 }}
        zoomControl={false}
        preferCanvas={true}
      >
        <TileLayer attribution={attribution} url={tileUrl} />
        <MapBounds count={filtered.length} />

        <LayersControl position="topright" collapsed={false}>
          <LayersControl.Overlay checked name="Interstates / Motorways">
            <LayerGroup>
              <RoadLayer classedWays={waysByClass[0]!} classCode={0} isDark={!!isDark} />
            </LayerGroup>
          </LayersControl.Overlay>
          <LayersControl.Overlay checked name="US / State Highways">
            <LayerGroup>
              <RoadLayer classedWays={waysByClass[1]!} classCode={1} isDark={!!isDark} />
            </LayerGroup>
          </LayersControl.Overlay>
          <LayersControl.Overlay name="Primary Arterials">
            <LayerGroup>
              <RoadLayer classedWays={waysByClass[2]!} classCode={2} isDark={!!isDark} />
            </LayerGroup>
          </LayersControl.Overlay>
          <LayersControl.Overlay name="Secondary Arterials">
            <LayerGroup>
              <RoadLayer classedWays={waysByClass[3]!} classCode={3} isDark={!!isDark} />
            </LayerGroup>
          </LayersControl.Overlay>
        </LayersControl>

        {filtered.map((c) => {
          const radius = Math.max(2.5, Math.min(9, c.totalVolume / 320));
          const scoreDelta = c.scoreBefore - c.scoreAfter;
          const vcDelta = c.worstVcBefore - c.worstVcAfter;
          const cycleDelta = c.cycleLengthAfter - c.cycleLengthBefore;
          const nsDelta = c.nsGreenAfter - c.nsGreenBefore;
          const ewDelta = c.ewGreenAfter - c.ewGreenBefore;
          const plDelta = c.protectedLeftAfter - c.protectedLeftBefore;
          const movementChanged = c.worstMovementBefore !== c.worstMovementAfter;

          return (
            <CircleMarker
              key={c.id}
              center={[c.latitude, c.longitude]}
              radius={radius}
              pathOptions={{
                fillColor: c.bucket.color,
                fillOpacity: 0.78,
                color: isDark ? "#111" : "#fff",
                weight: 0.5,
              }}
            >
              <Popup className="custom-popup">
                <div className="p-1 min-w-[260px]">
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                      style={{ backgroundColor: c.bucket.color, color: "#fff" }}
                    >
                      {c.bucket.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] mb-3 pb-2 border-b">
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Severity</span>
                      <span className="font-medium capitalize">
                        {c.severityBefore} → {c.severityAfter}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Score</span>
                      <span className="font-medium">
                        {c.scoreBefore} → {c.scoreAfter}{" "}
                        <span style={{ color: scoreDelta > 0 ? "#009118" : "#6B7280" }}>
                          ({scoreDelta > 0 ? "−" : ""}
                          {Math.abs(scoreDelta).toFixed(0)})
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Worst v/c</span>
                      <span className="font-medium">
                        {c.worstVcBefore.toFixed(2)} → {c.worstVcAfter.toFixed(2)}{" "}
                        <span style={{ color: vcDelta > 0 ? "#009118" : "#6B7280" }}>
                          ({vcDelta > 0 ? "−" : "+"}
                          {Math.abs(vcDelta).toFixed(2)})
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Bottleneck</span>
                      <span className="font-medium" style={{ color: movementChanged ? "#009118" : undefined }}>
                        {movementChanged
                          ? `${c.worstMovementBefore} → ${c.worstMovementAfter}`
                          : c.worstMovementAfter}
                      </span>
                    </div>
                  </div>

                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                    Signal Timing Changes
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">N/S Green</span>
                      <span>
                        {c.nsGreenBefore}→{c.nsGreenAfter}s {diffBadge(c.nsGreenBefore, c.nsGreenAfter)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">E/W Green</span>
                      <span>
                        {c.ewGreenBefore}→{c.ewGreenAfter}s {diffBadge(c.ewGreenBefore, c.ewGreenAfter)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Prot. Left</span>
                      <span>
                        {c.protectedLeftBefore}→{c.protectedLeftAfter}s {diffBadge(c.protectedLeftBefore, c.protectedLeftAfter)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Cycle</span>
                      <span>
                        {c.cycleLengthBefore}→{c.cycleLengthAfter}s {diffBadge(c.cycleLengthBefore, c.cycleLengthAfter)}
                      </span>
                    </div>
                  </div>

                  {nsDelta === 0 && ewDelta === 0 && plDelta === 0 && cycleDelta === 0 && (
                    <p className="text-[10px] text-muted-foreground mt-2 italic">
                      Signal already operating well — no timing change applied.
                    </p>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Filter legend overlay */}
      <div
        className="absolute bottom-2 left-2 z-[400] rounded-md border bg-background/90 backdrop-blur px-3 py-2 text-xs shadow-md max-w-[230px]"
        style={{ pointerEvents: "auto" }}
      >
        <button
          onClick={() => setShowLegend(!showLegend)}
          className="flex w-full items-center justify-between font-semibold mb-1"
          aria-label="Toggle legend"
        >
          Improvement
          <span className="text-muted-foreground text-[10px]">{showLegend ? "▾" : "▸"}</span>
        </button>
        {showLegend && (
          <>
            <p className="text-[10px] text-muted-foreground mb-1.5 leading-tight">
              Click a band to filter. Click again to reset.
            </p>
            {IMPROVEMENT_BUCKETS.map((b) => {
              const active = activeFilter === b.id;
              const count = bucketCounts[b.id] ?? 0;
              return (
                <button
                  key={b.id}
                  onClick={() => setActiveFilter(active ? null : b.id)}
                  className={`flex items-center gap-2 w-full leading-tight py-0.5 px-1 rounded text-left ${
                    active ? "bg-muted" : "hover:bg-muted/50"
                  }`}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: b.color,
                      flexShrink: 0,
                    }}
                  />
                  <span className="text-[11px] flex-1">{b.label}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {count.toLocaleString()}
                  </span>
                </button>
              );
            })}
            <div className="mt-2 pt-2 border-t">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Roads
              </div>
              {styles.map((s, i) => (
                <div key={i} className="flex items-center gap-2 leading-tight">
                  <span
                    style={{
                      display: "inline-block",
                      width: 18,
                      height: Math.max(2, s.weight),
                      background: s.color,
                      opacity: s.opacity,
                    }}
                  />
                  <span className="text-[11px]">{s.name}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
