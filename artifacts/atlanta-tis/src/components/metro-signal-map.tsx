/**
 * /cities/:slug — the metro's real signal inventory, drawn from the same
 * analyzer endpoint the engine reads (`/api/intersections?regionCode=`),
 * one dot per signalized intersection, coloured by where its volume came
 * from and sized by peak-hour vph. Dots light in order of volume while a
 * counter runs; live DOT incidents pulse red where a feed is wired.
 *
 * A custom canvas overlay (not one Leaflet layer per signal): Atlanta has
 * ~8,000 signals and needs to redraw every frame during the reveal.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { MetroCoverage } from "../data/metro-coverage";
import { DARK_TILES, DARK_TILES_ATTRIBUTION } from "./metro-map";

export type Sig = { id: string; name: string; latitude: number; longitude: number; totalVolume: number; volumeSource?: string; volumeYear?: number };
type Incident = { id: string | number; road: string; condition: string; latitude: number; longitude: number; severity?: number };

const REVEAL_S = 2.6;

export function sourceTone(src?: string): { color: string; label: string } {
  if (!src) return { color: "#A5B4FC", label: "model-derived (flagship)" };
  if (src === "road_class_baseline") return { color: "#64748B", label: "road-class baseline" };
  if (src === "synthetic_osm_class") return { color: "#F59E0B", label: "synthesized · OSM class" };
  if (src.startsWith("fhwa")) return { color: "#14B8A6", label: "FHWA HPMS" };
  return { color: "#22C55E", label: `measured · ${src.toUpperCase()}` };
}

function normalizeIncidents(raw: unknown): Incident[] {
  const items: unknown[] = Array.isArray(raw) ? raw : (raw && typeof raw === "object" && Array.isArray((raw as { incidents?: unknown[] }).incidents)) ? (raw as { incidents: unknown[] }).incidents : [];
  const out: Incident[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const lat = Number(o["latitude"] ?? o["lat"]), lon = Number(o["longitude"] ?? o["lon"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    out.push({ id: String(o["id"] ?? out.length), road: String(o["road"] ?? o["roadway"] ?? o["title"] ?? "Incident"), condition: String(o["condition"] ?? o["incidentType"] ?? o["type"] ?? ""), latitude: lat, longitude: lon, severity: typeof o["severity"] === "number" ? (o["severity"] as number) : undefined });
  }
  return out;
}

/** Canvas overlay that draws the first `shownRef.current` signals plus pulsing incidents. */
function SignalsLayer({ sigs, incidents, shownRef, revealing, onHover }: {
  sigs: Sig[]; incidents: Incident[]; shownRef: React.MutableRefObject<number>; revealing: boolean;
  onHover: (h: { sig: Sig; x: number; y: number } | null) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const canvas = L.DomUtil.create("canvas", "leaflet-zoom-hide") as HTMLCanvasElement;
    canvas.style.position = "absolute";
    canvas.style.pointerEvents = "none";
    map.getPanes().overlayPane.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let raf = 0;
    const draw = () => {
      if (!ctx) return;
      const size = map.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(size.x * dpr)) { canvas.width = Math.round(size.x * dpr); canvas.height = Math.round(size.y * dpr); canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`; }
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      const n = Math.min(sigs.length, shownRef.current);
      const zoomBoost = Math.max(0.6, Math.min(1.8, (map.getZoom() - 9) * 0.25 + 1));
      for (let i = 0; i < n; i++) {
        const s = sigs[i]; if (!s) continue;
        const p = map.latLngToContainerPoint([s.latitude, s.longitude]);
        if (p.x < -6 || p.y < -6 || p.x > size.x + 6 || p.y > size.y + 6) continue;
        const r = (1.4 + Math.min(3.2, Math.sqrt(Math.max(0, s.totalVolume) / 900))) * zoomBoost;
        ctx.fillStyle = sourceTone(s.volumeSource).color;
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (incidents.length) {
        const t = performance.now() / 1000;
        for (const inc of incidents) {
          const p = map.latLngToContainerPoint([inc.latitude, inc.longitude]);
          const ph = (t * 0.8 + (typeof inc.id === "number" ? inc.id : 0) * 0.37) % 1;
          ctx.strokeStyle = `rgba(239,68,68,${(1 - ph).toFixed(2)})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, 6 + ph * 16, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = "#EF4444"; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
        }
      }
    };
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    const needsLoop = revealing || incidents.length > 0;
    if (needsLoop) raf = requestAnimationFrame(loop); else draw();
    map.on("move zoom viewreset resize", draw);
    const onMove = (e: L.LeafletMouseEvent) => {
      const n = Math.min(sigs.length, shownRef.current);
      let best: Sig | null = null, bestD = 10;
      for (let i = 0; i < n; i++) {
        const s = sigs[i]; if (!s) continue;
        const p = map.latLngToContainerPoint([s.latitude, s.longitude]);
        const d = Math.hypot(p.x - e.containerPoint.x, p.y - e.containerPoint.y);
        if (d < bestD) { bestD = d; best = s; }
      }
      onHover(best ? { sig: best, x: e.containerPoint.x, y: e.containerPoint.y } : null);
    };
    map.on("mousemove", onMove);
    map.on("mouseout", () => onHover(null));
    return () => { cancelAnimationFrame(raf); map.off("move zoom viewreset resize", draw); map.off("mousemove", onMove); canvas.remove(); };
  }, [map, sigs, incidents, revealing, shownRef, onHover]);
  return null;
}

export function MetroSignalMap({ metro }: { metro: MetroCoverage }) {
  const [sigs, setSigs] = useState<Sig[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [shown, setShown] = useState(0);
  const [revealing, setRevealing] = useState(true);
  const [hover, setHover] = useState<{ sig: Sig; x: number; y: number } | null>(null);
  const shownRef = useRef(0);
  const reduced = useMemo(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => {
    let cancelled = false;
    setSigs(null); setError(null); setShown(0); shownRef.current = 0; setRevealing(true); setIncidents([]);
    fetch(`/api/intersections?regionCode=${encodeURIComponent(metro.code)}`)
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as Sig[]; })
      .then((list) => {
        if (cancelled) return;
        const clean = (Array.isArray(list) ? list : []).filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
        clean.sort((a, b) => (b.totalVolume ?? 0) - (a.totalVolume ?? 0));
        setSigs(clean);
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "unavailable"); });
    if (metro.liveSource) {
      fetch(`/api/live-incidents?regionCode=${encodeURIComponent(metro.code)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((raw) => { if (!cancelled) setIncidents(normalizeIncidents(raw)); })
        .catch(() => { /* live feed is a bonus; the inventory stands on its own */ });
    }
    return () => { cancelled = true; };
  }, [metro.code, metro.liveSource]);

  // reveal: dots light in volume order over REVEAL_S seconds (eased), counter follows
  useEffect(() => {
    if (!sigs) return;
    const n = sigs.length;
    if (reduced || n === 0) { shownRef.current = n; setShown(n); setRevealing(false); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / 1000 / REVEAL_S);
      const e = u * u * (3 - 2 * u);
      const k = Math.round(n * e);
      shownRef.current = k; setShown(k);
      if (u < 1) raf = requestAnimationFrame(step); else setRevealing(false);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [sigs, reduced]);

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    if (!sigs || sigs.length === 0) return null;
    let s = 90, n = -90, w = 180, e = -180;
    for (const p of sigs) { s = Math.min(s, p.latitude); n = Math.max(n, p.latitude); w = Math.min(w, p.longitude); e = Math.max(e, p.longitude); }
    return [[s, w], [n, e]];
  }, [sigs]);

  const sourceCounts = useMemo(() => {
    const m = new Map<string, { color: string; label: string; n: number }>();
    for (const s of sigs ?? []) { const t = sourceTone(s.volumeSource); const k = t.label; const cur = m.get(k); if (cur) cur.n++; else m.set(k, { ...t, n: 1 }); }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [sigs]);

  return (
    <div className="space-y-3" data-testid="metro-signal-map">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="text-sm text-muted-foreground">
          {error ? `Inventory unavailable right now (${error}).` : sigs ? `Every signalized intersection the engine knows in ${metro.longName}, sized by peak-hour vph.` : "Loading the signal inventory…"}
        </div>
        <div className="font-mono text-sm tabular-nums">
          <span className="font-semibold text-foreground">{shown.toLocaleString()}</span>
          <span className="text-muted-foreground"> of {(sigs?.length ?? metro.signals).toLocaleString()} signals{incidents.length ? ` · ${incidents.length} live incident${incidents.length === 1 ? "" : "s"}` : ""}</span>
        </div>
      </div>
      <div className="relative h-[460px] rounded-lg overflow-hidden border bg-[#0B1220]">
        {sigs && bounds && (
          <MapContainer bounds={bounds} boundsOptions={{ padding: [24, 24] }} minZoom={7} maxZoom={17} scrollWheelZoom={false} style={{ height: "100%", width: "100%", background: "#0B1220" }}>
            <TileLayer url={DARK_TILES} attribution={DARK_TILES_ATTRIBUTION} subdomains="abcd" />
            <SignalsLayer sigs={sigs} incidents={incidents} shownRef={shownRef} revealing={revealing} onHover={setHover} />
          </MapContainer>
        )}
        {hover && (
          <div className="absolute z-[500] pointer-events-none rounded border border-white/15 bg-[#0F1729]/95 text-slate-50 px-2.5 py-2 text-xs shadow-lg max-w-[260px]" style={{ left: hover.x + 12, top: hover.y + 12 }} data-testid="tooltip-metro-signal">
            <div className="font-medium">{hover.sig.name}</div>
            <div className="font-mono text-[11px] text-slate-300 mt-0.5">
              {Math.round(hover.sig.totalVolume).toLocaleString()} vph peak · {sourceTone(hover.sig.volumeSource).label}{hover.sig.volumeYear ? ` ${hover.sig.volumeYear}` : ""}
            </div>
          </div>
        )}
      </div>
      {sourceCounts.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {sourceCounts.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.label} · {s.n.toLocaleString()}</span>
          ))}
          {incidents.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" />live incident · {metro.liveSource}</span>}
        </div>
      )}
    </div>
  );
}
