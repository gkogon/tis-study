import { useState } from "react";
import { MapContainer, TileLayer, Marker, Circle, Tooltip as LeafletTooltip, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ChevronDown, ChevronRight, Crosshair } from "lucide-react";
import type { TisRequestAdditionalStudyPointsItem } from "@workspace/tis-api-client-react";

// One free coordinate to force into the study. The engine snaps each to the
// nearest inventory signal within ~0.35 mi and analyzes it regardless of the
// study radius (see tis.ts / intersection-coverage.ts). Structurally identical
// to the generated request field so it feeds straight into TisRequest.
type StudyPoint = TisRequestAdditionalStudyPointsItem;

const MI_TO_M = 1609.344;
// Mirrors the additionalStudyPoints array max in the API schema so the UI
// never lets a user build a request the server would reject.
const MAX_POINTS = 60;

// The capacity engine reads coordinates at 4-decimal precision (~11 m); extra
// digits from a paste are noise. Match the rest of the form (tis.tsx round4).
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

// Great-circle distance in miles — lets the editor flag a forced point that
// already falls inside the study radius (redundant, harmless) versus one that
// genuinely extends the corridor beyond it (the reason this control exists).
function haversineMi(a: { latitude: number; longitude: number }, b: StudyPoint): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function pointIcon(index: number, outside: boolean): L.DivIcon {
  // Teal = beyond the radius (what this control is for); slate = already inside
  // the radius, so force-including it is redundant but harmless.
  const bg = outside ? "#0F766E" : "#94A3B8";
  return L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${bg};border:2px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,0.4);color:#fff;font:600 11px/18px system-ui;text-align:center;">${index + 1}</div>`,
  });
}

function siteIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:#0079F2;border:2px solid #fff;
      transform:rotate(-45deg) translate(3px,3px);box-shadow:0 2px 5px rgba(0,0,0,0.4);"></div>`,
  });
}

/** Emits click positions on the map so the parent can add a study point there. */
function MapClickHandler({ onAdd }: { onAdd: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onAdd(round4(e.latlng.lat), round4(e.latlng.lng));
    },
  });
  return null;
}

// Parse a paste of "lat, lon" lines. Accepts comma / whitespace / tab between
// the pair and newline or semicolon between rows, so an engineer can dump a
// scope list from a spreadsheet or email. Returns the parsed points plus the
// count of unreadable lines so the UI can own up to what it skipped.
function parseCoordPaste(text: string): { points: StudyPoint[]; bad: number } {
  const points: StudyPoint[] = [];
  let bad = 0;
  for (const rawLine of text.split(/[\n;]+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const nums = line.split(/[,\s]+/).filter(Boolean).map(Number);
    const lat = nums[0];
    const lon = nums[1];
    if (
      nums.length >= 2 &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180 &&
      !(lat === 0 && lon === 0)
    ) {
      points.push({ latitude: round4(lat), longitude: round4(lon) });
    } else {
      bad++;
    }
  }
  return { points, bad };
}

function parseIds(text: string): string[] {
  return text
    .split(/[\n,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupePoints(points: StudyPoint[]): StudyPoint[] {
  const seen = new Set<string>();
  const out: StudyPoint[] = [];
  for (const p of points) {
    const key = `${p.latitude},${p.longitude}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

export type StudyIntersectionsEditorProps = {
  site: { latitude: number; longitude: number };
  studyRadiusMi: number;
  points: StudyPoint[];
  signalIds: string[];
  onChange: (next: { points: StudyPoint[]; signalIds: string[] }) => void;
};

/**
 * Force-include specific study intersections that fall beyond the default
 * radius — corridor scoping. Caltran-style scopes are an agreed LIST of
 * intersections along an arterial (e.g. NW 7 Ave @ NW 79/81/103 St) that a
 * 0.5-mi radius would miss. The engineer hands that list to SIS two ways:
 * click each junction on the aerial (emits coordinates, the robust path since
 * many inventory signals have no name) or paste a "lat, lon" list. Every
 * entry is UNIONed with the radius set — purely additive and opt-in, so the
 * default "radius = full scope" behavior is unchanged when nothing is added.
 */
export function StudyIntersectionsEditor({
  site,
  studyRadiusMi,
  points,
  signalIds,
  onChange,
}: StudyIntersectionsEditorProps) {
  const [open, setOpen] = useState(false);
  const [basemap, setBasemap] = useState<"satellite" | "street">("satellite");
  const [coordText, setCoordText] = useState("");
  const [idText, setIdText] = useState("");
  const [showIds, setShowIds] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const center: [number, number] = [site.latitude, site.longitude];
  const radiusMeters = Math.max(studyRadiusMi, 0.05) * MI_TO_M;
  const count = points.length + signalIds.length;

  // Fit the map to the radius plus a corridor margin so junctions a mile or
  // more up the arterial are on screen without panning.
  const marginMi = Math.max(studyRadiusMi * 2.4, 1.2);
  const dLat = marginMi / 69;
  const dLon = marginMi / (69 * Math.max(0.2, Math.cos((site.latitude * Math.PI) / 180)));
  const bounds: [[number, number], [number, number]] = [
    [site.latitude - dLat, site.longitude - dLon],
    [site.latitude + dLat, site.longitude + dLon],
  ];

  function commit(nextPoints: StudyPoint[], nextIds: string[]) {
    onChange({
      points: dedupePoints(nextPoints).slice(0, MAX_POINTS),
      signalIds: Array.from(new Set(nextIds)),
    });
  }
  function addPoint(lat: number, lon: number) {
    if (points.length >= MAX_POINTS) {
      setNote(`Up to ${MAX_POINTS} forced intersections.`);
      return;
    }
    setNote(null);
    commit([...points, { latitude: lat, longitude: lon }], signalIds);
  }
  function updatePoint(index: number, lat: number, lon: number) {
    commit(
      points.map((p, i) => (i === index ? { latitude: lat, longitude: lon } : p)),
      signalIds,
    );
  }
  function removePoint(index: number) {
    commit(points.filter((_, i) => i !== index), signalIds);
  }
  function removeSignalId(id: string) {
    commit(points, signalIds.filter((s) => s !== id));
  }
  function importCoords() {
    const { points: parsed, bad } = parseCoordPaste(coordText);
    if (parsed.length === 0) {
      setNote(bad ? 'Couldn’t read any "lat, lon" lines.' : 'Paste one "lat, lon" per line.');
      return;
    }
    commit([...points, ...parsed], signalIds);
    setCoordText("");
    setNote(
      `Added ${parsed.length} coordinate${parsed.length === 1 ? "" : "s"}` +
        (bad ? ` · skipped ${bad} unreadable line${bad === 1 ? "" : "s"}` : "") +
        ".",
    );
  }
  function importIds() {
    const parsed = parseIds(idText);
    if (parsed.length === 0) {
      setNote("Paste one or more signal IDs.");
      return;
    }
    commit(points, [...signalIds, ...parsed]);
    setIdText("");
    setNote(`Added ${parsed.length} signal ID${parsed.length === 1 ? "" : "s"}.`);
  }
  function clearAll() {
    commit([], []);
    setNote(null);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        data-testid="button-toggle-force-include"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <Crosshair className="w-3.5 h-3.5" />
        Force-include study intersections (optional)
        {count > 0 && (
          <span
            className="ml-1 rounded bg-teal-700 px-1.5 py-0.5 text-[10px] font-semibold text-white"
            data-testid="badge-force-include-count"
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-3 pl-5">
          <p className="text-xs text-muted-foreground">
            Corridor scoping. Add specific intersections along an arterial that fall{" "}
            <em>beyond</em> the {studyRadiusMi}-mi radius and they'll be analyzed too — every entry is
            unioned with the radius set, so this only ever <em>adds</em> intersections. Click each junction
            on the aerial (each click drops a point snapped to the nearest signal), or paste a{" "}
            <span className="font-mono">lat, lon</span> list below.
          </p>

          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground mr-1">View:</span>
            <button
              type="button"
              onClick={() => setBasemap("satellite")}
              className={`rounded border px-2 py-0.5 ${basemap === "satellite" ? "bg-foreground text-background" : "hover:bg-muted"}`}
            >
              Satellite
            </button>
            <button
              type="button"
              onClick={() => setBasemap("street")}
              className={`rounded border px-2 py-0.5 ${basemap === "street" ? "bg-foreground text-background" : "hover:bg-muted"}`}
            >
              Street
            </button>
            <span className="ml-auto flex items-center gap-1 text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#0F766E" }} /> beyond radius
              <span className="inline-block w-2 h-2 rounded-full ml-2" style={{ background: "#94A3B8" }} /> in radius
            </span>
          </div>

          <div style={{ height: 380, width: "100%" }} className="rounded overflow-hidden border">
            <MapContainer
              key={`${site.latitude},${site.longitude},${studyRadiusMi}`}
              bounds={bounds}
              maxZoom={20}
              style={{ height: "100%", width: "100%" }}
            >
              {basemap === "satellite" ? (
                <>
                  <TileLayer
                    attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    maxNativeZoom={19}
                    maxZoom={20}
                  />
                  <TileLayer
                    attribution=""
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                    maxNativeZoom={19}
                    maxZoom={20}
                  />
                </>
              ) : (
                <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={20} />
              )}
              <Circle
                center={center}
                radius={radiusMeters}
                pathOptions={{ color: "#0079F2", weight: 1.5, dashArray: "5 5", fillOpacity: 0.05 }}
              />
              <MapClickHandler onAdd={addPoint} />
              <Marker position={center} icon={siteIcon()}>
                <LeafletTooltip direction="top" offset={[0, -26]}>
                  Site
                </LeafletTooltip>
              </Marker>
              {points.map((p, i) => {
                const outside = haversineMi(site, p) > studyRadiusMi;
                return (
                  <Marker
                    key={`${p.latitude},${p.longitude},${i}`}
                    position={[p.latitude, p.longitude]}
                    icon={pointIcon(i, outside)}
                    draggable
                    eventHandlers={{
                      dragend: (e) => {
                        const ll = (e.target as L.Marker).getLatLng();
                        updatePoint(i, round4(ll.lat), round4(ll.lng));
                      },
                    }}
                  >
                    <LeafletTooltip direction="top" offset={[0, -12]}>
                      {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                    </LeafletTooltip>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Paste coordinates
            </span>
            <textarea
              className="w-full text-sm font-mono rounded border bg-background px-2 py-1.5"
              rows={3}
              placeholder={"25.8607, -80.2101\n25.8712, -80.2103\n(one lat, lon per line)"}
              value={coordText}
              onChange={(e) => setCoordText(e.target.value)}
              data-testid="textarea-paste-coords"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={importCoords}
                className="text-xs rounded border px-2 py-1 hover:bg-muted"
                data-testid="button-add-coords"
              >
                Add coordinates
              </button>
              <button
                type="button"
                onClick={() => setShowIds((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground"
                data-testid="button-toggle-signal-ids"
              >
                {showIds ? "Hide" : "Have known signal IDs?"}
              </button>
            </div>
          </div>

          {showIds && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Signal IDs (advanced)
              </span>
              <p className="text-xs text-muted-foreground">
                Analyzer signal ids, matched exactly. Coordinates are usually more robust — many inventory
                signals have no stable id.
              </p>
              <textarea
                className="w-full text-sm font-mono rounded border bg-background px-2 py-1.5"
                rows={2}
                placeholder="sig-123, sig-456"
                value={idText}
                onChange={(e) => setIdText(e.target.value)}
                data-testid="textarea-paste-ids"
              />
              <button
                type="button"
                onClick={importIds}
                className="text-xs rounded border px-2 py-1 hover:bg-muted"
                data-testid="button-add-ids"
              >
                Add signal IDs
              </button>
            </div>
          )}

          {note && <p className="text-xs text-muted-foreground">{note}</p>}

          {count === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="text-force-include-empty">
              No forced intersections — the study analyzes every signal within the {studyRadiusMi}-mi radius
              (unchanged).
            </p>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Forced intersections ({count})
                </span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  data-testid="button-clear-force-include"
                >
                  Clear all
                </button>
              </div>
              <div className="border rounded overflow-hidden">
                <table className="w-full text-xs border-collapse">
                  <tbody>
                    {points.map((p, i) => {
                      const dMi = haversineMi(site, p);
                      const outside = dMi > studyRadiusMi;
                      return (
                        <tr key={`p-${i}`} className="border-b last:border-b-0" data-testid={`row-force-point-${i}`}>
                          <td className="px-2 py-1.5 w-8 text-center font-semibold tabular-nums text-muted-foreground">
                            {i + 1}
                          </td>
                          <td className="px-2 py-1.5 font-mono tabular-nums whitespace-nowrap">
                            {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                          </td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap">
                            <span className={outside ? "text-teal-700 font-medium" : "text-muted-foreground"}>
                              {dMi.toFixed(2)} mi {outside ? "· beyond radius" : "· in radius"}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 w-14 text-right">
                            <button
                              type="button"
                              onClick={() => removePoint(i)}
                              className="text-red-600 hover:underline"
                              data-testid={`button-remove-point-${i}`}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {signalIds.map((id) => (
                      <tr key={`id-${id}`} className="border-b last:border-b-0" data-testid={`row-force-id-${id}`}>
                        <td className="px-2 py-1.5 w-8 text-center text-muted-foreground">#</td>
                        <td className="px-2 py-1.5 font-mono" colSpan={2}>
                          {id}
                        </td>
                        <td className="px-2 py-1.5 w-14 text-right">
                          <button
                            type="button"
                            onClick={() => removeSignalId(id)}
                            className="text-red-600 hover:underline"
                            data-testid={`button-remove-id-${id}`}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
