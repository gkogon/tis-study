import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetParkingSummary,
  useListParkingLots,
  useGetParkingLot,
  type ParkingLot,
  type ListParkingLotsArchetype,
} from "@workspace/api-client-react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip as LeafletTooltip,
  Marker,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  ArrowLeft, ParkingSquare, AlertTriangle, Zap, Clock, Building2, X, Car, Activity,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function fmtNum(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

function fmtPct(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(d)}%`;
}

function fmtEta(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (min === 0) return "FULL";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function colorForFill(pct: number): string {
  if (pct >= 99) return "#7c2d12"; // dark brown — full
  if (pct >= 90) return "#dc2626"; // red — near full
  if (pct >= 75) return "#ea580c"; // orange
  if (pct >= 50) return "#ca8a04"; // yellow
  if (pct >= 25) return "#16a34a"; // green
  return "#0ea5e9";                 // cyan — empty
}

function fillBand(pct: number): "FULL" | "NEAR_FULL" | "BUSY" | "MODERATE" | "OPEN" | "EMPTY" {
  if (pct >= 99) return "FULL";
  if (pct >= 90) return "NEAR_FULL";
  if (pct >= 75) return "BUSY";
  if (pct >= 50) return "MODERATE";
  if (pct >= 25) return "OPEN";
  return "EMPTY";
}

// Radius scaled to capacity, clamped so the smallest lots are still hoverable
// and the biggest decks don't dominate the map.
function radiusForCapacity(capacity: number): number {
  return Math.max(2.5, Math.min(10, 2.5 + Math.log10(Math.max(1, capacity)) * 2.2));
}

// ──────────────────────────────────────────────────────────────────────────
// venue surge marker
// ──────────────────────────────────────────────────────────────────────────

function venueIcon(): L.DivIcon {
  return L.divIcon({
    html: `<div style="
      width:22px;height:22px;border-radius:50%;
      background:radial-gradient(circle, #fbbf24 0%, #f59e0b 60%, #b45309 100%);
      border:2px solid #fff;box-shadow:0 0 12px rgba(245,158,11,.7);
      display:flex;align-items:center;justify-content:center;
      color:white;font-weight:700;font-size:13px;line-height:1;">⚡</div>`,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

// ──────────────────────────────────────────────────────────────────────────
// detail drawer
// ──────────────────────────────────────────────────────────────────────────

function LotDetailPanel({
  id,
  forceSurge,
  onClose,
}: {
  id: string;
  forceSurge: boolean;
  onClose: () => void;
}) {
  // Pass the demo-mode flag as a header so the detail value lines up with the
  // map/list snapshot. Header is the cleanest way to thread it without adding
  // a new query param to the spec (which currently triggers an orval
  // path+query name collision).
  //
  // Important: the generated react-query key is keyed only by the URL path,
  // so we MUST extend `queryKey` with `forceSurge` ourselves — otherwise
  // toggling demo-mode while the panel is open would return the stale value
  // for this lot from cache and disagree with the map/list snapshot.
  const q = useGetParkingLot(id, {
    request: { headers: { "X-Force-Surge": forceSurge ? "1" : "0" } },
    query: {
      queryKey: ["/api/atlanta/parking/lots", id, { forceSurge }] as const,
    },
  });
  if (q.isLoading || !q.data) {
    return (
      <div className="absolute top-4 right-4 z-[500] w-[360px] rounded-lg bg-card border shadow-xl p-4">
        <Skeleton className="h-6 w-2/3 mb-3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  const d = q.data;
  return (
    <div className="absolute top-4 right-4 z-[500] w-[380px] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg bg-card border shadow-xl">
      <div className="p-4 border-b sticky top-0 bg-card flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-sm leading-tight">
            {d.name || "Unnamed lot"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {d.kind} · {d.access} · {d.fee} · {d.archetype.replace(/_/g, " ")}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1 -m-1 rounded"
          aria-label="Close lot detail"
          data-testid="parking-detail-close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md p-2 text-center" style={{ background: colorForFill(d.fillPct) + "22" }}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Now</div>
            <div className="text-xl font-bold tabular-nums" style={{ color: colorForFill(d.fillPct) }}>{fmtPct(d.fillPct, 0)}</div>
          </div>
          <div className="rounded-md p-2 text-center bg-muted/50">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Free</div>
            <div className="text-xl font-bold tabular-nums">{d.spacesFree}</div>
            <div className="text-[10px] text-muted-foreground">of {d.capacity}</div>
          </div>
          <div className="rounded-md p-2 text-center bg-muted/50">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">ETA full</div>
            <div className="text-xl font-bold tabular-nums">{fmtEta(d.etaMinutes)}</div>
          </div>
        </div>

        {d.surgeFromVenue && (
          <div className="rounded-md p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <div className="text-[11px]">
              Event surge from <span className="font-semibold">{d.surgeFromVenue}</span>
            </div>
          </div>
        )}

        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 font-medium">
            Next 12 hours
          </div>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.hourly} margin={{ top: 5, right: 4, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={1} />
                <YAxis tick={{ fontSize: 9 }} domain={[0, 100]} />
                <RTooltip
                  contentStyle={{ fontSize: 11, padding: "4px 8px" }}
                  formatter={(v: number) => [`${v.toFixed(0)}%`, "Fill"]}
                />
                <ReferenceLine y={95} stroke="#dc2626" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="fillPct" stroke={colorForFill(d.fillPct)} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 font-medium">
            Why this number
          </div>
          <ul className="text-[11px] space-y-1">
            {d.drivers.map((line, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-muted-foreground">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        {d.nearestVenue && (
          <div className="text-[11px] text-muted-foreground border-t pt-2">
            Nearest venue:{" "}
            <span className="text-foreground font-medium">{d.nearestVenue.name}</span>
            {" — "}
            {d.nearestVenue.distanceKm.toFixed(2)} km
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// page
// ──────────────────────────────────────────────────────────────────────────

// Sandy Springs city center — fits all anchor venues + 469 lots in view at z13.
const SANDY_SPRINGS_CENTER: [number, number] = [33.9304, -84.3733];

export default function ParkingPage() {
  const [forceSurge, setForceSurge] = useState(false);
  const [archetypeFilter, setArchetypeFilter] = useState<string | null>(null);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);

  const summaryQ = useGetParkingSummary({ forceSurge });
  const lotsQ = useListParkingLots({
    forceSurge,
    archetype: (archetypeFilter ?? undefined) as ListParkingLotsArchetype | undefined,
  });


  const summary = summaryQ.data;
  const lots = useMemo(() => lotsQ.data ?? [], [lotsQ.data]);

  // Sandy Springs has only ~470 lots so we render every one of them. We still
  // sort by capacity so the largest decks paint last (drawn on top in Leaflet)
  // and aren't hidden behind tiny surface lots stacked at the same address.
  const visibleLots = useMemo(() => {
    return [...lots].sort((a, b) => a.capacity - b.capacity);
  }, [lots]);

  const bandCounts = useMemo(() => {
    const acc: Record<string, number> = { FULL: 0, NEAR_FULL: 0, BUSY: 0, MODERATE: 0, OPEN: 0, EMPTY: 0 };
    for (const l of lots) acc[fillBand(l.fillPct)]++;
    return acc;
  }, [lots]);

  // Pre-compute the "Most pressured lots" list so it isn't re-sorted every
  // render. With 13K+ records the sort is non-trivial, even if cheap relative
  // to map painting.
  const hottestLots = useMemo(() => {
    return [...lots]
      .filter((l) => l.capacity >= 30)
      .sort((a, b) => b.fillPct - a.fillPct || b.capacity - a.capacity)
      .slice(0, 8);
  }, [lots]);

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b bg-card/80 backdrop-blur sticky top-0 z-[600]">
        <div className="px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              data-testid="link-back-dashboard"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </Link>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2">
              <ParkingSquare className="w-5 h-5 text-sky-600" />
              <h1 className="text-base font-semibold">Sandy Springs Parking Pressure</h1>
              <Badge variant="secondary" className="text-[10px]">modeled · OSM inventory · named via OSM dining</Badge>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch
                checked={forceSurge}
                onCheckedChange={setForceSurge}
                data-testid="parking-force-surge"
              />
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-500" />
                Demo: force event surge
              </span>
            </label>
          </div>
        </div>

        {/* KPI strip */}
        <div className="px-4 pb-2 grid grid-cols-2 md:grid-cols-6 gap-2">
          <Kpi label="Lots tracked"     value={fmtNum(summary?.totalLots)}                icon={ParkingSquare} accent="sky" />
          <Kpi label="Total spaces"     value={fmtNum(summary?.totalCapacity)}            icon={Car}           accent="sky" />
          <Kpi label="Currently in use" value={fmtNum(summary?.occupiedSpaces)}           icon={Activity}      accent="emerald" sub={fmtPct(summary?.fillPct)} />
          <Kpi label="Full lots"        value={fmtNum(summary?.fullLots)}                 icon={AlertTriangle} accent="red" />
          <Kpi label="Near full"        value={fmtNum(summary?.nearFullLots)}             icon={Clock}         accent="amber" />
          <Kpi label="Active surges"    value={fmtNum(summary?.surgeEvents.length)}       icon={Zap}           accent="amber" />
        </div>
      </header>

      <div className="grid lg:grid-cols-[280px_1fr] gap-0 h-[calc(100vh-118px)]">
        {/* Sidebar */}
        <aside className="border-r bg-card/40 overflow-y-auto p-3 space-y-3">
          {/* Filter pills */}
          <Card>
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                Filter by archetype
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-1 grid grid-cols-2 gap-1.5">
              {[null, "commercial", "office", "event", "park_and_ride", "university", "airport", "mixed"].map((a) => {
                const active = archetypeFilter === a;
                const label = a === null ? "All" : a.replace(/_/g, " ");
                const count = a === null ? lots.length : (summary?.byArchetype[a]?.lots ?? 0);
                return (
                  <button
                    key={String(a)}
                    onClick={() => setArchetypeFilter(a)}
                    className={`text-[11px] capitalize px-2 py-1 rounded border text-left ${
                      active
                        ? "bg-sky-600 text-white border-sky-600"
                        : "bg-background hover:bg-muted border-border"
                    }`}
                    data-testid={`parking-archetype-${a ?? "all"}`}
                  >
                    <div className="font-medium">{label}</div>
                    <div className={`text-[10px] ${active ? "text-sky-50" : "text-muted-foreground"}`}>
                      {fmtNum(count)} lots
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* Fill-band legend with live counts */}
          <Card>
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                Fill bands (live)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-1 space-y-1">
              {(["FULL", "NEAR_FULL", "BUSY", "MODERATE", "OPEN", "EMPTY"] as const).map((band) => {
                const colorPct = { FULL: 100, NEAR_FULL: 92, BUSY: 80, MODERATE: 60, OPEN: 35, EMPTY: 10 }[band];
                return (
                  <div key={band} className="flex items-center gap-2 text-[11px]">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ background: colorForFill(colorPct) }}
                    />
                    <span className="capitalize flex-1">{band.toLowerCase().replace(/_/g, " ")}</span>
                    <span className="tabular-nums text-muted-foreground">{fmtNum(bandCounts[band])}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Active surges */}
          {summary && summary.surgeEvents.length > 0 && (
            <Card>
              <CardHeader className="p-3 pb-2">
                <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-500" />
                  Active surges
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-1 space-y-2">
                {summary.surgeEvents.map((s) => (
                  <div
                    key={s.venue}
                    className="text-[11px] p-2 rounded border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/60"
                  >
                    <div className="font-medium leading-tight flex items-center gap-1">
                      <Building2 className="w-3 h-3 text-amber-600" />
                      {s.venue}
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      {fmtNum(s.affectedLots)} lots · {fmtNum(s.affectedCapacity)} spaces ·{" "}
                      <span className="font-semibold" style={{ color: colorForFill(s.fillPct) }}>
                        {fmtPct(s.fillPct, 0)} full
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Top hot lots list */}
          <Card>
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                Most pressured lots
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-1 space-y-1">
              {hottestLots.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setSelectedLotId(l.id)}
                    className="w-full text-left text-[11px] p-1.5 rounded hover:bg-muted flex items-center gap-2"
                    data-testid={`parking-hot-${l.id}`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: colorForFill(l.fillPct) }}
                    />
                    <span className="flex-1 truncate">{l.name || `Lot #${l.id.slice(-5)}`}</span>
                    <span className="tabular-nums font-medium">{fmtPct(l.fillPct, 0)}</span>
                  </button>
              ))}
            </CardContent>
          </Card>

          {/* Source note */}
          {summary?.sourceNote && (
            <div className="text-[10px] text-muted-foreground leading-snug px-1">
              {summary.sourceNote}
            </div>
          )}
        </aside>

        {/* Map */}
        <main className="relative">
          {(summaryQ.isLoading || lotsQ.isLoading) && (
            <div className="absolute inset-0 z-[400] grid place-items-center bg-background/40 pointer-events-none">
              <div className="text-sm text-muted-foreground">Loading lots…</div>
            </div>
          )}
          <MapContainer
            center={SANDY_SPRINGS_CENTER}
            zoom={13}
            style={{ height: "100%", width: "100%" }}
            preferCanvas={true}
            scrollWheelZoom
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; OpenStreetMap, &copy; CARTO'
            />
            {visibleLots.map((l: ParkingLot) => (
              <CircleMarker
                key={l.id}
                center={[l.lat, l.lon]}
                radius={radiusForCapacity(l.capacity)}
                pathOptions={{
                  color: colorForFill(l.fillPct),
                  fillColor: colorForFill(l.fillPct),
                  fillOpacity: 0.65,
                  weight: 0.8,
                }}
                eventHandlers={{ click: () => setSelectedLotId(l.id) }}
              >
                <LeafletTooltip direction="top" offset={[0, -4]} opacity={0.95}>
                  <div className="text-xs">
                    <div className="font-semibold">{l.name || `Lot #${l.id.slice(-5)}`}</div>
                    <div>{fmtPct(l.fillPct, 0)} full · {l.spacesFree}/{l.capacity} free</div>
                    <div className="text-muted-foreground">ETA full: {fmtEta(l.etaMinutes)}</div>
                  </div>
                </LeafletTooltip>
              </CircleMarker>
            ))}
            {/* Surge venue markers on top */}
            {summary?.surgeEvents.map((s) => (
              <Marker key={s.venue} position={[s.lat, s.lon]} icon={venueIcon()}>
                <LeafletTooltip direction="top" offset={[0, -10]}>
                  <div className="text-xs">
                    <div className="font-semibold">{s.venue}</div>
                    <div>{s.affectedLots} lots surging — {fmtPct(s.fillPct, 0)} full</div>
                  </div>
                </LeafletTooltip>
              </Marker>
            ))}
          </MapContainer>

          {selectedLotId && (
            <LotDetailPanel
              id={selectedLotId}
              forceSurge={forceSurge}
              onClose={() => setSelectedLotId(null)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// KPI tile
// ──────────────────────────────────────────────────────────────────────────

function Kpi({
  label, value, sub, icon: Icon, accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof ParkingSquare;
  accent: "sky" | "emerald" | "amber" | "red";
}) {
  const map: Record<string, { bg: string; fg: string }> = {
    sky:     { bg: "bg-sky-50/60 dark:bg-sky-950/20 border-sky-300",         fg: "text-sky-600" },
    emerald: { bg: "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300", fg: "text-emerald-600" },
    amber:   { bg: "bg-amber-50/60 dark:bg-amber-950/20 border-amber-300",   fg: "text-amber-600" },
    red:     { bg: "bg-red-50/60 dark:bg-red-950/20 border-red-300",         fg: "text-red-600" },
  };
  const c = map[accent];
  return (
    <div className={`border-l-4 rounded-md px-2.5 py-1.5 ${c.bg}`}>
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-muted-foreground font-medium">
        <Icon className={`w-2.5 h-2.5 ${c.fg}`} />
        {label}
      </div>
      <div className="text-base font-bold tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
