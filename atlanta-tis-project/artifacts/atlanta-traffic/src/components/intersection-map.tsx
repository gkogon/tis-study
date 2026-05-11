import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap, LayersControl, LayerGroup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  IntersectionSummary,
  useGetRoadNetwork,
  getGetRoadNetworkQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

interface IntersectionMapProps {
  intersections: IntersectionSummary[];
  onSelect: (id: string) => void;
  isDark?: boolean;
}

const SEVERITY_COLORS = {
  low: "#009118",
  moderate: "#eab308",
  high: "#795EFF",
  critical: "#A60808",
};

// Per-class road styling. Index matches the road-class code from the API.
const ROAD_STYLES = [
  { name: "Interstate / Motorway", color: "#E55934", weight: 2.4, opacity: 0.85 }, // 0 motorway
  { name: "US / State Highway",    color: "#F4A261", weight: 1.9, opacity: 0.8  }, // 1 trunk
  { name: "Primary Arterial",      color: "#FFC857", weight: 1.4, opacity: 0.65 }, // 2 primary
  { name: "Secondary Arterial",    color: "#9CC4E4", weight: 0.9, opacity: 0.55 }, // 3 secondary
];

const ROAD_STYLES_DARK = [
  { name: "Interstate / Motorway", color: "#FF7A5C", weight: 2.4, opacity: 0.9 },
  { name: "US / State Highway",    color: "#FFB36E", weight: 1.9, opacity: 0.85 },
  { name: "Primary Arterial",      color: "#FFD876", weight: 1.4, opacity: 0.7 },
  { name: "Secondary Arterial",    color: "#5C8FB5", weight: 0.9, opacity: 0.55 },
];

type RoadWay = [number, Array<[number, number]>] | [number, string, Array<[number, number]>];

function MapBounds({ intersections }: { intersections: IntersectionSummary[] }) {
  const map = useMap();
  useEffect(() => {
    if (intersections.length > 0) {
      map.setView([33.79, -84.39], 11);
    }
  }, [intersections, map]);
  return null;
}

// Render an entire road class as ONE multi-polyline. Leaflet's `<Polyline positions={...}>`
// accepts `LatLng[][]` for multi-segment lines, so 49K React components collapse to 4
// (one per class). This is a >100x reduction in reconciliation work.
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

export function IntersectionMap({ intersections, onSelect, isDark }: IntersectionMapProps) {
  const tileUrl = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  const attribution = isDark
    ? '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; OpenStreetMap'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  // Lazy fetch the 2.6MB road network — gzipped ~640KB on the wire, cached forever.
  const { data: roadNetwork } = useGetRoadNetwork({
    query: {
      queryKey: getGetRoadNetworkQueryKey(),
      staleTime: Infinity,
      gcTime: Infinity,
    },
  });

  // Bucket ways by class once. Each bucket is an array of LatLng[] (one entry per way),
  // suitable for handing to a single multi-polyline Leaflet layer.
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
        <MapBounds intersections={intersections} />

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

        {intersections.map((intersection) => {
          const radius = Math.max(2, Math.min(8, intersection.totalVolume / 350));
          const color =
            SEVERITY_COLORS[intersection.severity as keyof typeof SEVERITY_COLORS] || "#0079F2";

          return (
            <CircleMarker
              key={intersection.id}
              center={[intersection.latitude, intersection.longitude]}
              radius={radius}
              pathOptions={{
                fillColor: color,
                fillOpacity: 0.7,
                color: isDark ? "#111" : "#fff",
                weight: 0.5,
              }}
            >
              <Popup className="custom-popup">
                <div className="p-1 min-w-[220px]">
                  <h4 className="font-bold text-[14px] leading-tight mb-1">{intersection.name}</h4>
                  <p className="text-xs text-muted-foreground mb-2">
                    {intersection.zone}
                    {intersection.roadClass && intersection.roadClass !== "other" && (
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-muted text-[10px] uppercase tracking-wide font-medium">
                        {intersection.roadClass}
                      </span>
                    )}
                  </p>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3 text-xs">
                    <div>
                      <span className="text-muted-foreground block mb-0.5">Score</span>
                      <span className="font-semibold text-[14px]" style={{ color }}>
                        {intersection.inefficiencyScore}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-0.5">Avg Delay</span>
                      <span className="font-semibold text-[14px]">{intersection.avgDelaySeconds}s</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-0.5">Total Vol</span>
                      <span className="font-medium">{intersection.totalVolume.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block mb-0.5">Turns/hr</span>
                      <span className="font-medium">{intersection.turningVolume.toLocaleString()}</span>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    className="w-full h-8 text-xs"
                    onClick={() => onSelect(intersection.id)}
                  >
                    View Details
                  </Button>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Legend overlay */}
      <div
        className="absolute bottom-2 left-2 z-[400] rounded-md border bg-background/90 backdrop-blur px-3 py-2 text-xs shadow-md max-w-[200px]"
        style={{ pointerEvents: "auto" }}
      >
        <button
          onClick={() => setShowLegend(!showLegend)}
          className="flex w-full items-center justify-between font-semibold mb-1"
          aria-label="Toggle legend"
        >
          Legend
          <span className="text-muted-foreground text-[10px]">{showLegend ? "▾" : "▸"}</span>
        </button>
        {showLegend && (
          <>
            <div className="mb-2">
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
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Signal severity
              </div>
              {(["critical", "high", "moderate", "low"] as const).map((sev) => (
                <div key={sev} className="flex items-center gap-2 leading-tight">
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: SEVERITY_COLORS[sev],
                    }}
                  />
                  <span className="text-[11px] capitalize">{sev}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
