/**
 * Hourly (major, minor) volume pairs against the warrant threshold the
 * engine actually applied.
 *
 * The server (tis-api-server/src/lib/warrants.ts) is a screening tier:
 * each warrant is one pair of anchors — Table 4C-1 for 1A, Table 4C-2
 * for 1B, the Fig. 4C-3 inflection point for Warrant 3 (warrants.ts:36-63)
 * and 80% of 1A / 1B for Warrant 7 (warrants.ts:219-220) — and an hour
 * counts when major ≥ anchor AND minor ≥ anchor (warrants.ts:264-277).
 * So the "curve" is a step, and it is drawn as the step; nothing here is
 * interpolated from the published smooth curve.
 *
 * Every mark comes from the report payload: the thresholds are the
 * per-hour majorThreshold / minorThreshold the server returned (already
 * 70%-reduced when that applied) and the points are its hourBreakdown.
 * Points reveal one per 120 ms in hour order while the counter ticks;
 * with prefers-reduced-motion everything renders at its final state.
 */
import { useEffect, useRef, useState } from "react";
import type { WarrantOutcome } from "./warrants-report";

const H = 280;
const PAD = { l: 58, r: 16, t: 22, b: 40 };
const REVEAL_MS = 120;
const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

function niceCeil(v: number): number {
  if (!(v > 0)) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (NICE.find((n) => n >= m - 1e-9) ?? 10) * p;
}

function ticks(max: number): number[] {
  const raw = max / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const hh = (h: number): string => `${String(h).padStart(2, "0")}:00`;

export function WarrantCurveChart({ warrants, reductionApplied }: { warrants: WarrantOutcome[]; reductionApplied: boolean }) {
  const [selectedId, setSelectedId] = useState<WarrantOutcome["id"]>(
    () => (warrants.find((w) => w.id === "3") ?? warrants[0])?.id ?? "3",
  );
  const selected = warrants.find((w) => w.id === selectedId) ?? warrants[0];
  const n = selected?.hourBreakdown.length ?? 0;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [revealed, setRevealed] = useState(() => (prefersReducedMotion() ? n : 0));

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(320, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (prefersReducedMotion()) { setRevealed(n); return; }
    setRevealed(0);
    // elapsed-time driven, so a throttled background tab catches up rather than crawling
    const start = performance.now();
    let raf = 0, shown = 0;
    const tick = (now: number) => {
      const next = Math.min(n, Math.floor((now - start) / REVEAL_MS));
      if (next !== shown) { shown = next; setRevealed(next); }
      if (shown < n) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedId, n]);

  if (!selected || n === 0) return null;
  const hours = selected.hourBreakdown;
  const corner = { major: hours[0].majorThreshold, minor: hours[0].minorThreshold };
  const others = warrants
    .filter((w) => w.id !== selected.id && w.hourBreakdown.length > 0)
    .map((w) => ({ id: w.id, major: w.hourBreakdown[0].majorThreshold, minor: w.hourBreakdown[0].minorThreshold }));
  const xMax = niceCeil(Math.max(corner.major, ...others.map((o) => o.major), ...hours.map((h) => h.majorVolume)) * 1.08);
  const yMax = niceCeil(Math.max(corner.minor, ...others.map((o) => o.minor), ...hours.map((h) => h.minorVolume)) * 1.12);
  const X = (v: number): number => PAD.l + (v / xMax) * (width - PAD.l - PAD.r);
  const Y = (v: number): number => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const shown = Math.min(revealed, n);
  const satisfied = hours.slice(0, shown).filter((h) => h.bothMet).length;
  const peakIdx = hours.reduce((best, h, i) => (h.majorVolume > hours[best].majorVolume ? i : best), 0);
  const peak = hours[peakIdx];
  const req = selected.hoursRequired;
  const cornerRight = X(corner.major) > width * 0.55;
  const met = satisfied >= req;

  return (
    <div ref={wrapRef} className="border rounded-lg p-4 space-y-3" data-testid="chart-warrant-curve">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-semibold">Hourly volumes against the warrant threshold</h3>
          <div className="text-xs text-muted-foreground">
            Major-street total, both approaches, against the minor-street higher approach. An hour counts when both thresholds are met
            {reductionApplied ? " · 70% thresholds" : ""}.
          </div>
        </div>
        <div role="tablist" aria-label="Warrant" className="inline-flex rounded-md border overflow-hidden font-mono text-xs">
          {warrants.map((w) => (
            <button
              key={w.id}
              type="button"
              role="tab"
              aria-selected={w.id === selected.id}
              onClick={() => setSelectedId(w.id)}
              className={"px-2.5 py-1 " + (w.id === selected.id ? "bg-foreground text-background" : "hover:bg-accent")}
              data-testid={`tab-warrant-curve-${w.id}`}
            >
              W{w.id}
            </button>
          ))}
        </div>
      </div>

      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={`${selected.name}: ${selected.hoursSatisfied} of ${n} hours meet major ≥ ${corner.major} and minor ≥ ${corner.minor} vph; ${req} required.`}
        className="block font-mono text-[10px]"
      >
        <rect x={X(corner.major)} y={PAD.t} width={Math.max(0, X(xMax) - X(corner.major))} height={Math.max(0, Y(corner.minor) - PAD.t)} className="fill-green-500/10" />

        {ticks(xMax).map((v) => (
          <g key={`x${v}`}>
            <line x1={X(v)} x2={X(v)} y1={PAD.t} y2={H - PAD.b} className="stroke-border" />
            <text x={X(v)} y={H - PAD.b + 14} textAnchor="middle" className="fill-muted-foreground">{v}</text>
          </g>
        ))}
        {ticks(yMax).map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={width - PAD.r} y1={Y(v)} y2={Y(v)} className="stroke-border" />
            <text x={PAD.l - 6} y={Y(v) + 3} textAnchor="end" className="fill-muted-foreground">{v}</text>
          </g>
        ))}
        <text x={(PAD.l + width - PAD.r) / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground">major street · both approaches (vph)</text>
        <text transform={`translate(12 ${(PAD.t + H - PAD.b) / 2}) rotate(-90)`} textAnchor="middle" className="fill-muted-foreground">minor · higher approach (vph)</text>

        {others.map((o) => (
          <g key={o.id} className="stroke-muted-foreground/40">
            <polyline points={`${X(o.major)},${PAD.t} ${X(o.major)},${Y(o.minor)} ${X(xMax)},${Y(o.minor)}`} fill="none" strokeDasharray="3 3" />
            <text x={X(o.major) + 3} y={Y(o.minor) - 3} className="fill-muted-foreground/70" stroke="none">W{o.id}</text>
          </g>
        ))}

        <polyline
          points={`${X(corner.major)},${PAD.t} ${X(corner.major)},${Y(corner.minor)} ${X(xMax)},${Y(corner.minor)}`}
          fill="none"
          strokeWidth={1.5}
          className="stroke-green-600 dark:stroke-green-400"
        />
        <text
          x={cornerRight ? X(corner.major) - 6 : X(corner.major) + 6}
          y={PAD.t + 11}
          textAnchor={cornerRight ? "end" : "start"}
          className="fill-green-700 dark:fill-green-300"
        >
          W{selected.id} · major ≥ {corner.major} · minor ≥ {corner.minor}
        </text>

        {hours.map((h, i) => (
          <circle
            key={h.hour}
            cx={X(h.majorVolume)}
            cy={Y(h.minorVolume)}
            r={4.5}
            strokeWidth={1.5}
            className={(h.bothMet ? "fill-green-600 dark:fill-green-400" : "fill-muted-foreground/45") + " stroke-background transition-opacity duration-200 motion-reduce:transition-none"}
            style={{ opacity: i < shown ? 1 : 0 }}
          >
            <title>{`${hh(h.hour)} — major ${h.majorVolume} · minor ${h.minorVolume} vph · ${h.bothMet ? "satisfies" : "below threshold"}`}</title>
          </circle>
        ))}
        <text
          x={X(peak.majorVolume) > width * 0.75 ? X(peak.majorVolume) - 8 : X(peak.majorVolume) + 8}
          y={Y(peak.minorVolume) + 3}
          textAnchor={X(peak.majorVolume) > width * 0.75 ? "end" : "start"}
          className="fill-foreground transition-opacity duration-200 motion-reduce:transition-none"
          style={{ opacity: peakIdx < shown ? 1 : 0 }}
        >
          peak {hh(peak.hour)}
        </text>
      </svg>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="font-mono text-sm tabular-nums whitespace-nowrap">
          <span className={"font-semibold " + (met ? "text-green-700 dark:text-green-300" : "")}>{satisfied}</span> of {n} hours satisfy
          <span className="text-muted-foreground"> · {req} required</span>
        </div>
        <div className="relative flex-1 min-w-[160px] h-2 rounded bg-muted" aria-hidden>
          <div
            className={"h-full rounded transition-[width] duration-150 motion-reduce:transition-none " + (met ? "bg-green-600 dark:bg-green-400" : "bg-muted-foreground/50")}
            style={{ width: `${(satisfied / n) * 100}%` }}
          />
          <div className="absolute -top-1 -bottom-1 w-px bg-foreground" style={{ left: `${(req / n) * 100}%` }} />
          <div className="absolute top-3 font-mono text-[10px] text-muted-foreground whitespace-nowrap" style={{ left: `calc(${(req / n) * 100}% + 4px)` }}>
            required {req}
          </div>
        </div>
      </div>
    </div>
  );
}
