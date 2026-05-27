/**
 * §04 Coverage — the per-metro index strip.
 *
 * Visual language continues the rest of the marketing site: numbered
 * report section header (§04), hairline rules between rows, mono numerals
 * for the big counts, no rounded cards / no glow / no gradients. Reads
 * like the front matter of a TIS report, not a SaaS landing page.
 *
 * Tier A (≥ 75% measured-AADT coverage, plus Atlanta as the flagship)
 * gets the full row treatment with the live-source badge. Tier B is
 * collapsed into a quieter "Also indexed" strip below — they're
 * fully-modeled in the engine but missing the calibrated AADT layer,
 * so it would be misleading to lead with them at the same volume.
 */

import { Link } from "wouter";
import { Marker } from "./section-marker";
import {
  METROS,
  TIER_A_METROS,
  TIER_B_METROS,
  TOTAL_METROS,
  TOTAL_SIGNALS,
  STATES_COVERED,
  STATE_NAMES,
  compareByStateThenAadt,
  type MetroCoverage,
} from "../data/metro-coverage";

export function CoverageGrid() {
  // Both tiers sort by full state name alphabetically, then by AADT% desc
  // within state. Atlanta still gets its flagship badge but sits under
  // Georgia rather than commanding row #1 — keeps the list scannable
  // by state, which is how customers actually look for their metro.
  const tierA = [...TIER_A_METROS].sort(compareByStateThenAadt);
  const tierB = [...TIER_B_METROS].sort(compareByStateThenAadt);

  return (
    <section className="space-y-10" data-testid="coverage-grid">
      <Marker n="04" label="Coverage" />

      <header className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-end">
        <div className="lg:col-span-7 space-y-4">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-tight text-slate-900 dark:text-slate-50">
            One engine.{" "}
            <span className="font-mono text-foreground/90">{TOTAL_METROS}</span> metros
            indexed across <span className="font-mono">{STATES_COVERED}</span> states.
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl">
            Every signalized intersection in every Southeast metro we cover is
            indexed against the same engine — same HCM 6th, same ITE 11th
            rates, same MUTCD warrants. The numbers below are real, not
            illustrative.
          </p>
        </div>

        <div className="lg:col-span-5">
          <div className="grid grid-cols-3 gap-4 sm:gap-6 border-t border-border pt-5">
            <Stat label="Signals indexed" value={TOTAL_SIGNALS.toLocaleString()} />
            <Stat label="Metros live" value={String(TOTAL_METROS)} />
            <Stat label="States" value={String(STATES_COVERED)} />
          </div>
        </div>
      </header>

      {/* Tier A: featured rows with full coverage stats + live source */}
      <div className="border-t border-border">
        <div className="grid grid-cols-12 gap-3 sm:gap-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground border-b border-border">
          <div className="col-span-4 sm:col-span-4">Metro</div>
          <div className="col-span-1 hidden sm:block">State</div>
          <div className="col-span-3 sm:col-span-2 text-right">Signals</div>
          <div className="col-span-3 sm:col-span-2 text-right">AADT match</div>
          <div className="col-span-2 sm:col-span-3 text-right">Live source</div>
        </div>

        {tierA.map((m) => (
          <MetroRow key={m.code} m={m} highlight />
        ))}
      </div>

      {/* Tier B: compact "also indexed" strip */}
      {tierB.length > 0 && (
        <div className="space-y-3 pt-6">
          <div className="flex items-baseline justify-between">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Also indexed
            </h3>
            <span className="font-mono text-[11px] text-muted-foreground">
              {tierB.length} metros · synthetic AADT pending state-DOT data
            </span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3">
            {tierB.map((m) => (
              <span
                key={m.code}
                className="font-mono text-sm text-foreground/80"
                data-testid={`tier-b-${m.code}`}
              >
                {m.shortName}{" "}
                <span className="text-muted-foreground">
                  · {m.state} · {m.signals.toLocaleString()}
                </span>
                {m.liveSource && (
                  <span
                    className="ml-1.5 inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"
                    title={`Live: ${m.liveSource}`}
                  >
                    <span className="w-1 h-1 rounded-full bg-emerald-500" />
                    <span className="text-[10px] uppercase tracking-[0.12em]">live</span>
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-4 pt-4 border-t border-border/60">
        <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
          AADT match = share of indexed signals snapped to a measured state-DOT
          traffic count within 100–1000 m. The remainder runs on a calibrated
          road-class baseline (motorway 2,500 vph → tertiary 700 vph). Full
          methodology and data provenance per metro on the cities page.
        </p>
        <Link
          href="/cities"
          className="font-mono text-xs uppercase tracking-[0.16em] text-foreground underline decoration-dotted underline-offset-[6px] hover:no-underline"
          data-testid="link-cities"
        >
          See all coverage →
        </Link>
      </div>
    </section>
  );
}

function MetroRow({ m, highlight }: { m: MetroCoverage; highlight?: boolean }) {
  return (
    <Link
      href={`/cities/${m.slug}`}
      className="block grid grid-cols-12 gap-3 sm:gap-4 py-3 border-b border-border/70 items-baseline hover:bg-accent/40 transition-colors cursor-pointer"
      data-testid={`metro-row-${m.code}`}
    >
      <div className="col-span-4 sm:col-span-4">
        <div className="font-semibold text-sm sm:text-base text-foreground group-hover:underline">
          {m.shortName}
          {m.code === "atlanta_metro" && (
            <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.15em] text-emerald-700 dark:text-emerald-400">
              Flagship
            </span>
          )}
        </div>
      </div>
      <div className="col-span-1 hidden sm:block font-mono text-xs text-muted-foreground self-center">
        {m.state}
      </div>
      <div className="col-span-3 sm:col-span-2 text-right font-mono text-sm sm:text-base text-foreground tabular-nums">
        {m.signals.toLocaleString()}
      </div>
      <div className="col-span-3 sm:col-span-2 text-right font-mono text-sm sm:text-base tabular-nums">
        <AadtPct pct={m.aadtPct} highlight={highlight} />
      </div>
      <div className="col-span-2 sm:col-span-3 text-right font-mono text-[11px] sm:text-xs text-muted-foreground self-center">
        {m.liveSource ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {m.liveSource}
          </span>
        ) : (
          <span className="opacity-60">—</span>
        )}
      </div>
    </Link>
  );
}

function AadtPct({ pct, highlight }: { pct: number; highlight?: boolean }) {
  if (pct >= 95) return <span className={highlight ? "text-emerald-700 dark:text-emerald-400 font-semibold" : ""}>{pct.toFixed(1)}%</span>;
  if (pct >= 75) return <span className={highlight ? "text-foreground font-semibold" : ""}>{pct.toFixed(1)}%</span>;
  if (pct > 0) return <span className="text-muted-foreground">{pct.toFixed(1)}%</span>;
  return <span className="text-muted-foreground/60">—</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-2xl sm:text-3xl font-bold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
