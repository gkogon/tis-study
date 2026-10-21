/**
 * /cities — every indexed metro on one dark map, lit in order of signal
 * count while a counter runs up to the total. Positions come from
 * `/tis-api/regions` (the engine's own region centroids); everything else
 * is the bundled coverage catalog. Click a metro to open its page.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { MapContainer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { METROS, TIER_A_AADT_CUTOFF, isFlagshipMetro, type MetroCoverage } from "../data/metro-coverage";
import { BasemapLayers } from "./basemap-layers";

type Pt = { m: MetroCoverage; lat: number; lon: number };

export function metroTone(m: MetroCoverage): { color: string; label: string } {
  const quality = m.aadtQuality ?? "measured";
  if (isFlagshipMetro(m)) return { color: "#FBBF24", label: "Flagship — live GDOT 511 incidents; volumes modeled, not counted" };
  if (quality === "measured" && m.aadtPct >= TIER_A_AADT_CUTOFF) return { color: "#22C55E", label: "Measured state-DOT AADT (Tier-A)" };
  if (quality === "measured" && m.aadtPct > 0) return { color: "#14B8A6", label: "Measured AADT, partial" };
  if (quality === "synthetic" && m.aadtPct > 0) return { color: "#F59E0B", label: "Synthesized from OSM road class" };
  return { color: "#94A3B8", label: "Road-class baseline only" };
}

const LEGEND: Array<{ color: string; label: string }> = [
  { color: "#FBBF24", label: "Flagship" },
  { color: "#22C55E", label: "Measured AADT · Tier-A" },
  { color: "#14B8A6", label: "Measured AADT · partial" },
  { color: "#F59E0B", label: "Synthesized (OSM class)" },
  { color: "#94A3B8", label: "Road-class baseline" },
];

export function MetroMap() {
  const [pts, setPts] = useState<Pt[] | null>(null);
  const [shown, setShown] = useState(0);
  const [, navigate] = useLocation();
  const reduced = useMemo(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/tis-api/regions")
      .then((r) => (r.ok ? r.json() : { regions: [] }))
      .then((d: { regions?: Array<{ code: string; lat: number; lon: number }> }) => {
        if (cancelled) return;
        const byCode = new Map((d.regions ?? []).map((r) => [r.code, r]));
        const list: Pt[] = [];
        for (const m of METROS) {
          const r = byCode.get(m.code);
          if (r && Number.isFinite(r.lat) && Number.isFinite(r.lon)) list.push({ m, lat: r.lat, lon: r.lon });
        }
        list.sort((a, b) => b.m.signals - a.m.signals);
        setPts(list);
      })
      .catch(() => { if (!cancelled) setPts([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!pts) return;
    if (reduced) { setShown(pts.length); return; }
    let i = 0;
    const t = setInterval(() => { i = Math.min(pts.length, i + 4); setShown(i); if (i >= pts.length) clearInterval(t); }, 24);
    return () => clearInterval(t);
  }, [pts, reduced]);

  const lit = useMemo(() => (pts ?? []).slice(0, shown).reduce((s, p) => s + p.m.signals, 0), [pts, shown]);
  if (pts && pts.length === 0) return null; // regions endpoint unreachable — the table below still stands

  return (
    <div className="space-y-3" data-testid="metro-map">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Every metro, coloured by what we know about its counts</div>
        <div className="font-mono text-sm tabular-nums">
          <span className="font-semibold text-foreground">{lit.toLocaleString()}</span>
          <span className="text-muted-foreground"> signals · {shown} of {pts?.length ?? 0} metros</span>
        </div>
      </div>
      <div className="h-[420px] rounded-lg overflow-hidden border bg-[#0B1220]">
        {pts && (
          <MapContainer center={[24, 8]} zoom={2} minZoom={2} maxZoom={12} scrollWheelZoom={false} worldCopyJump preferCanvas style={{ height: "100%", width: "100%", background: "#0B1220" }}>
            <BasemapLayers kind="dark" />
            {pts.slice(0, shown).map((p) => {
              const tone = metroTone(p.m);
              const r = Math.min(16, 3 + 2.2 * Math.sqrt(p.m.signals / 1000));
              return (
                <CircleMarker
                  key={p.m.code}
                  center={[p.lat, p.lon]}
                  radius={r}
                  pathOptions={{ color: tone.color, weight: p.m.code === "atlanta_metro" ? 2 : 1, fillColor: tone.color, fillOpacity: 0.55 }}
                  eventHandlers={{ click: () => navigate(`/cities/${p.m.slug}`) }}
                >
                  <LeafletTooltip direction="top" offset={[0, -r]}>
                    <div className="text-xs">
                      <div className="font-semibold">{p.m.shortName}, {p.m.state}</div>
                      <div className="font-mono text-[11px]">
                        {p.m.signals.toLocaleString()} signals · {p.m.aadtQuality === "modeled" ? "volumes modeled" : p.m.aadtPct > 0 ? `${p.m.aadtPct.toFixed(0)}% AADT` : "no AADT layer"}{p.m.liveSource ? ` · live: ${p.m.liveSource}` : ""}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{tone.label} · click to open</div>
                    </div>
                  </LeafletTooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: l.color }} />{l.label}</span>
        ))}
        <span className="ml-auto normal-case tracking-normal">Dot size ∝ √signals</span>
      </div>
    </div>
  );
}
