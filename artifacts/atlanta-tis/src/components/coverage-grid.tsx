/**
 * §04 Coverage — per-state dropdown index.
 *
 * Visual language continues the rest of the marketing site: numbered
 * report section header (§04), hairline rules between rows, mono numerals
 * for the big counts, no rounded cards / no glow / no gradients. Reads
 * like the front matter of a TIS report, not a SaaS landing page.
 *
 * Layout: 50 state rows, alphabetical (Alabama → Wyoming + DC). Each is a
 * collapsible row showing state name, metro count, total signals, and a
 * caret. Click to expand → indented metro rows for that state with the
 * same signal/AADT/live columns as the old Tier-A grid.
 *
 * Initial state: all collapsed — gives a scannable 50-row index. "Expand
 * all" toggle in the header.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Marker } from "./section-marker";
import { MetroSearch } from "./metro-search";
import {
  METROS,
  TOTAL_METROS,
  TOTAL_SIGNALS,
  US_STATES_COVERED,
  COUNTRIES_COVERED,
  CONTINENTS_COVERED,
  STATE_NAMES,
  TIER_A_AADT_CUTOFF,
  type MetroCoverage,
} from "../data/metro-coverage";

type StateGroup = {
  code: MetroCoverage["state"];
  name: string;
  metros: MetroCoverage[];
  signalsTotal: number;
  tierACount: number;
  liveCount: number;
};

function buildGroups(): StateGroup[] {
  const byState = new Map<MetroCoverage["state"], MetroCoverage[]>();
  for (const m of METROS) {
    const arr = byState.get(m.state) ?? [];
    arr.push(m);
    byState.set(m.state, arr);
  }
  const groups: StateGroup[] = [];
  for (const [code, metros] of byState.entries()) {
    // Within-state order: Tier-A first (AADT desc), then Tier-B alphabetical
    metros.sort((a, b) => {
      const aMeas = (a.aadtQuality ?? "measured") === "measured";
      const bMeas = (b.aadtQuality ?? "measured") === "measured";
      const aTierA = (a.aadtPct >= TIER_A_AADT_CUTOFF && aMeas) || a.code === "atlanta_metro";
      const bTierA = (b.aadtPct >= TIER_A_AADT_CUTOFF && bMeas) || b.code === "atlanta_metro";
      if (aTierA !== bTierA) return aTierA ? -1 : 1;
      if (aTierA) return b.aadtPct - a.aadtPct;
      return a.shortName.localeCompare(b.shortName);
    });
    groups.push({
      code,
      name: STATE_NAMES[code],
      metros,
      signalsTotal: metros.reduce((s, m) => s + m.signals, 0),
      tierACount: metros.filter((m) => (m.aadtPct >= TIER_A_AADT_CUTOFF && (m.aadtQuality ?? "measured") === "measured") || m.code === "atlanta_metro").length,
      liveCount: metros.filter((m) => m.liveSource != null).length,
    });
  }
  // Alphabetical by full state name
  groups.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}

export function CoverageGrid() {
  const groups = useMemo(buildGroups, []);
  const [openStates, setOpenStates] = useState<Set<string>>(new Set());

  const toggleState = (code: string): void => {
    setOpenStates((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const expandAll = (): void => {
    setOpenStates(new Set(groups.map((g) => g.code)));
  };
  const collapseAll = (): void => {
    setOpenStates(new Set());
  };
  const allOpen = openStates.size === groups.length;

  return (
    <section className="space-y-10" data-testid="coverage-grid">
      <Marker n="04" label="Coverage" />

      <header className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-end">
        <div className="lg:col-span-7 space-y-4">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-tight text-slate-900 dark:text-slate-50">
            One engine.{" "}
            <span className="font-mono text-foreground/90">{TOTAL_METROS}</span> metros
            across <span className="font-mono">{COUNTRIES_COVERED}</span> countries.
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl">
            Every signalized intersection in every metro we cover is indexed
            against the same engine — same HCM 6th, same ITE 11th rates, same
            MUTCD warrants. Pick a state below to see what's wired.
          </p>
        </div>

        <div className="lg:col-span-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:gap-x-6 border-t border-border pt-5">
            <Stat label="Metros" value={String(TOTAL_METROS)} sub={`${TOTAL_SIGNALS.toLocaleString()} signals indexed`} />
            <Stat label="Countries" value={String(COUNTRIES_COVERED)} sub={`Across ${CONTINENTS_COVERED} continents`} />
            <Stat label="US states + DC" value={String(US_STATES_COVERED)} sub="50 states + Washington DC" />
            <Stat label="Tier-A AADT" value={String(METROS.filter((m) => (m.aadtPct >= TIER_A_AADT_CUTOFF && (m.aadtQuality ?? "measured") === "measured") || m.code === "atlanta_metro").length)} sub="Measured state-DOT counts" />
          </div>
        </div>
      </header>

      <div className="space-y-3">
        <MetroSearch
          placeholder="Jump to a metro — try 'Phoenix', 'CA', 'Toronto', 'London'…"
          testid="metro-search-home"
        />
        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            §A · By state
          </div>
          <button
            type="button"
            onClick={allOpen ? collapseAll : expandAll}
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground underline decoration-dotted underline-offset-[6px] hover:no-underline"
            data-testid="toggle-expand-all"
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      <div className="-mt-6">
        {groups.map((g) => (
          <StateRow
            key={g.code}
            group={g}
            open={openStates.has(g.code)}
            onToggle={() => toggleState(g.code)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-4 pt-4 border-t border-border/60">
        <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
          AADT match = share of indexed signals snapped to a measured state-DOT
          traffic count within 100–1000 m. The remainder runs on a calibrated
          road-class baseline. Full methodology and data provenance per metro
          on the cities page.
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

function StateRow({
  group,
  open,
  onToggle,
}: {
  group: StateGroup;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-border" data-testid={`state-${group.code}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full grid grid-cols-12 gap-3 sm:gap-4 py-3 items-baseline text-left hover:bg-accent/40 transition-colors cursor-pointer"
        data-testid={`state-toggle-${group.code}`}
      >
        <div className="col-span-6 sm:col-span-5 flex items-baseline gap-3">
          <span
            aria-hidden
            className="font-mono text-[10px] text-muted-foreground inline-block w-3"
          >
            {open ? "−" : "+"}
          </span>
          <span className="font-semibold text-base sm:text-lg text-foreground">
            {group.name}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {group.code}
          </span>
        </div>
        <div className="col-span-2 sm:col-span-2 text-right font-mono text-xs sm:text-sm text-muted-foreground tabular-nums">
          {group.metros.length}{" "}
          <span className="hidden sm:inline">{group.metros.length === 1 ? "metro" : "metros"}</span>
        </div>
        <div className="col-span-2 sm:col-span-2 text-right font-mono text-xs sm:text-sm text-foreground tabular-nums">
          {group.signalsTotal.toLocaleString()}
        </div>
        <div className="col-span-1 sm:col-span-1 text-right font-mono text-[10px] sm:text-xs text-muted-foreground tabular-nums">
          {group.tierACount > 0 ? (
            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
              {group.tierACount}A
            </span>
          ) : (
            <span className="opacity-60">—</span>
          )}
        </div>
        <div className="col-span-1 sm:col-span-2 text-right font-mono text-[10px] sm:text-xs text-muted-foreground">
          {group.liveCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <span className="w-1 h-1 rounded-full bg-emerald-500" />
              {group.liveCount} <span className="hidden sm:inline">live</span>
            </span>
          ) : (
            <span className="opacity-60">—</span>
          )}
        </div>
      </button>

      {open && (
        <div className="pb-3" data-testid={`state-body-${group.code}`}>
          <div className="grid grid-cols-12 gap-3 sm:gap-4 py-2 pl-7 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground border-t border-border/40">
            <div className="col-span-5">Metro</div>
            <div className="col-span-2 text-right">Signals</div>
            <div className="col-span-2 text-right">AADT match</div>
            <div className="col-span-3 text-right">Live source</div>
          </div>
          {group.metros.map((m) => (
            <MetroRow key={m.code} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function MetroRow({ m }: { m: MetroCoverage }) {
  const isMeasuredAadt = (m.aadtQuality ?? "measured") === "measured";
  const tierA = (m.aadtPct >= TIER_A_AADT_CUTOFF && isMeasuredAadt) || m.code === "atlanta_metro";
  const isSynthetic = m.aadtQuality === "synthetic" && m.aadtPct > 0;
  return (
    <Link
      href={`/cities/${m.slug}`}
      className="block grid grid-cols-12 gap-3 sm:gap-4 py-2 pl-7 border-t border-border/30 items-baseline hover:bg-accent/40 transition-colors cursor-pointer"
      data-testid={`metro-row-${m.code}`}
    >
      <div className="col-span-5">
        <span className="text-sm text-foreground">{m.shortName}</span>
        {m.code === "atlanta_metro" && (
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.15em] text-emerald-700 dark:text-emerald-400">
            Flagship
          </span>
        )}
      </div>
      <div className="col-span-2 text-right font-mono text-sm text-foreground tabular-nums">
        {m.signals.toLocaleString()}
      </div>
      <div className="col-span-2 text-right font-mono text-sm tabular-nums">
        <AadtPct pct={m.aadtPct} tierA={tierA} synthetic={isSynthetic} />
      </div>
      <div className="col-span-3 text-right font-mono text-[11px] sm:text-xs text-muted-foreground self-center">
        {m.liveSource ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="truncate">{m.liveSource}</span>
          </span>
        ) : (
          <span className="opacity-60">—</span>
        )}
      </div>
    </Link>
  );
}

function AadtPct({ pct, tierA, synthetic }: { pct: number; tierA: boolean; synthetic?: boolean }) {
  if (synthetic) {
    return (
      <span
        className="text-muted-foreground/70 italic"
        title="Synthesized — not a measured count"
      >
        {pct.toFixed(1)}%<span className="text-[10px] not-italic"> †</span>
      </span>
    );
  }
  if (pct >= 95) return <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{pct.toFixed(1)}%</span>;
  if (tierA) return <span className="text-foreground font-semibold">{pct.toFixed(1)}%</span>;
  if (pct > 0) return <span className="text-muted-foreground">{pct.toFixed(1)}%</span>;
  return <span className="text-muted-foreground/60">—</span>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="font-mono text-2xl sm:text-3xl font-bold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      {sub && (
        <div className="mt-0.5 text-[10px] text-muted-foreground/70 leading-tight">
          {sub}
        </div>
      )}
    </div>
  );
}
