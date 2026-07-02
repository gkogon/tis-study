import { useState } from "react";
import { MapContainer, TileLayer, Marker, Tooltip as LeafletTooltip, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Driveway, DrivewayAccessType, DrivewayMovements } from "@workspace/tis-api-client-react";

// Preset → allowed movements. Mirrors the server (driveways.ts) so the UI
// preview matches what the engine will enforce. "custom" is user-edited.
const PRESET_MOVEMENTS: Record<Exclude<DrivewayAccessType, "custom">, DrivewayMovements> = {
  full: { inLeft: true, inRight: true, outLeft: true, outRight: true },
  riro: { inLeft: false, inRight: true, outLeft: false, outRight: true },
  three_quarter: { inLeft: true, inRight: true, outLeft: false, outRight: true },
  entrance_only: { inLeft: true, inRight: true, outLeft: false, outRight: false },
  exit_only: { inLeft: false, inRight: false, outLeft: true, outRight: true },
};

const ACCESS_OPTIONS: { value: DrivewayAccessType; label: string }[] = [
  { value: "full", label: "Full access (all turns)" },
  { value: "riro", label: "Right-in / right-out" },
  { value: "three_quarter", label: "¾ access (RIRO + left-in)" },
  { value: "entrance_only", label: "Entrance only" },
  { value: "exit_only", label: "Exit only" },
  { value: "custom", label: "Custom…" },
];

const MOVEMENT_FIELDS: { key: keyof DrivewayMovements; label: string }[] = [
  { key: "inLeft", label: "Left in" },
  { key: "inRight", label: "Right in" },
  { key: "outLeft", label: "Left out" },
  { key: "outRight", label: "Right out" },
];

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function resolveMovements(accessType: DrivewayAccessType, movements: DrivewayMovements): DrivewayMovements {
  return accessType === "custom" ? movements : PRESET_MOVEMENTS[accessType];
}

function movementSummary(m: DrivewayMovements): string {
  const on = MOVEMENT_FIELDS.filter((f) => m[f.key]).map((f) => f.label);
  return on.length === 4 ? "All movements" : on.length === 0 ? "No movements" : on.join(", ");
}

function drivewayIcon(index: number): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="width:20px;height:20px;border-radius:4px;background:#F2A20C;border:2px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,0.4);color:#1a1a1a;font:600 11px/18px system-ui;text-align:center;">${String.fromCharCode(65 + index)}</div>`,
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

/** Emits click positions on the map so the parent can add a driveway there. */
function MapClickHandler({ onAdd }: { onAdd: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onAdd(round4(e.latlng.lat), round4(e.latlng.lng));
    },
  });
  return null;
}

export type DrivewayEditorProps = {
  site: { latitude: number; longitude: number };
  driveways: Driveway[];
  onChange: (driveways: Driveway[]) => void;
};

/**
 * Interactive editor for a site's driveways: auto-detect candidate access points
 * on the fronting streets, then click to add, drag to reposition, and set each
 * driveway's allowed turning movements (presets + custom). Driveways feed the
 * TIS request so their turn restrictions reroute trips and change intersection LOS.
 */
export function DrivewayEditor({ site, driveways, onChange }: DrivewayEditorProps) {
  const [detecting, setDetecting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const center: [number, number] = [site.latitude, site.longitude];

  function update(id: string, patch: Partial<Driveway>) {
    onChange(driveways.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }
  function remove(id: string) {
    onChange(driveways.filter((d) => d.id !== id));
  }
  function addAt(lat: number, lon: number) {
    if (driveways.length >= 12) {
      setNote("Up to 12 driveways.");
      return;
    }
    const letters = "ABCDEFGHIJKL";
    const id = `dw-manual-${Date.now()}-${driveways.length}`;
    onChange([
      ...driveways,
      { id, latitude: lat, longitude: lon, label: `Driveway ${letters[driveways.length] ?? driveways.length + 1}`,
        accessType: "full", movements: PRESET_MOVEMENTS.full },
    ]);
    setNote(null);
  }

  async function autoDetect() {
    setDetecting(true);
    setNote(null);
    try {
      const r = await fetch("/tis-api/demo/driveway-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: site.latitude, longitude: site.longitude }),
      });
      const data = (await r.json()) as { candidates?: Driveway[] };
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      if (candidates.length === 0) {
        setNote("No fronting streets detected here — click the map to place driveways manually.");
      } else {
        onChange(candidates.slice(0, 12));
        setNote(`Detected ${candidates.length} candidate access point${candidates.length === 1 ? "" : "s"} — drag to reposition or edit access below.`);
      }
    } catch {
      setNote("Auto-detect is unavailable — click the map to place driveways manually.");
    } finally {
      setDetecting(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Site driveways (optional)</span>
        <button
          type="button"
          onClick={() => void autoDetect()}
          disabled={detecting}
          className="text-xs rounded border px-2 py-1 hover:bg-muted disabled:opacity-50"
        >
          {detecting ? "Detecting…" : "Auto-detect driveways"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Turn restrictions here reroute project trips onto the network and change the affected intersections' LOS.
        Click the map to add a driveway; drag a marker to reposition.
      </p>

      <div style={{ height: 300, width: "100%" }} className="rounded overflow-hidden border">
        <MapContainer key={`${site.latitude},${site.longitude}`} center={center} zoom={16} style={{ height: "100%", width: "100%" }}>
          <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapClickHandler onAdd={addAt} />
          <Marker position={center} icon={siteIcon()}>
            <LeafletTooltip direction="top" offset={[0, -26]}>Site</LeafletTooltip>
          </Marker>
          {driveways.map((d, i) => (
            <Marker
              key={d.id}
              position={[d.latitude, d.longitude]}
              icon={drivewayIcon(i)}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  update(d.id, { latitude: round4(ll.lat), longitude: round4(ll.lng) });
                },
              }}
            >
              <LeafletTooltip direction="top" offset={[0, -12]}>{d.label ?? d.id}</LeafletTooltip>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {note && <p className="text-xs text-muted-foreground">{note}</p>}

      {driveways.length === 0 ? (
        <p className="text-xs text-muted-foreground">No driveways set — the study uses a single site access (unchanged).</p>
      ) : (
        <ul className="space-y-2">
          {driveways.map((d, i) => {
            const eff = resolveMovements(d.accessType, d.movements);
            return (
              <li key={d.id} className="rounded border p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded text-xs font-semibold" style={{ background: "#F2A20C", color: "#1a1a1a" }}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <input
                    className="flex-1 text-sm rounded border px-2 py-1"
                    value={d.label ?? ""}
                    onChange={(e) => update(d.id, { label: e.target.value })}
                    placeholder={`Driveway ${String.fromCharCode(65 + i)}`}
                  />
                  <button type="button" onClick={() => remove(d.id)} className="text-xs text-red-600 hover:underline px-1">
                    Remove
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-16">Access</label>
                  <select
                    className="flex-1 text-sm rounded border px-2 py-1 bg-background"
                    value={d.accessType}
                    onChange={(e) => {
                      const accessType = e.target.value as DrivewayAccessType;
                      const movements = accessType === "custom" ? resolveMovements(d.accessType, d.movements) : PRESET_MOVEMENTS[accessType];
                      update(d.id, { accessType, movements });
                    }}
                  >
                    {ACCESS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                {d.accessType === "custom" ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pl-16">
                    {MOVEMENT_FIELDS.map((f) => (
                      <label key={f.key} className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={!!d.movements[f.key]}
                          onChange={(e) => update(d.id, { movements: { ...d.movements, [f.key]: e.target.checked } })}
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground pl-16">Allowed: {movementSummary(eff)}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
