/**
 * /cities — public deep-dive of every metro the platform indexes.
 *
 * Structure mirrors a TIS report's coverage appendix: introduction,
 * roll-up stats, then a per-state table with every metro's signal count,
 * AADT source, and live-feed status. Anchors (#charlotte_metro) make it
 * easy to deep-link from email / docs / sales decks.
 */

import { Link } from "wouter";
import { SiteFooter } from "../components/site-footer";
import { Marker } from "../components/section-marker";
import { usePageMeta } from "../hooks/use-page-meta";
import {
  METROS,
  TIER_A_AADT_CUTOFF,
  TOTAL_METROS,
  TOTAL_SIGNALS,
  STATES_COVERED,
  type MetroCoverage,
} from "../data/metro-coverage";

const STATE_NAMES: Record<MetroCoverage["state"], string> = {
  GA: "Georgia",
  NC: "North Carolina",
  TN: "Tennessee",
  FL: "Florida",
  AL: "Alabama",
  SC: "South Carolina",
  VA: "Virginia",
  KY: "Kentucky",
  LA: "Louisiana",
  DC: "District of Columbia",
  MD: "Maryland",
  PA: "Pennsylvania",
  NY: "New York",
  MA: "Massachusetts",
  IL: "Illinois",
  MI: "Michigan",
  MN: "Minnesota",
  OH: "Ohio",
  IN: "Indiana",
  MO: "Missouri",
  WI: "Wisconsin",
  TX: "Texas",
  CA: "California",
  OR: "Oregon",
  WA: "Washington",
  NV: "Nevada",
  AZ: "Arizona",
  CO: "Colorado",
  UT: "Utah",
  NM: "New Mexico",
  CT: "Connecticut",
  RI: "Rhode Island",
  NH: "New Hampshire",
  VT: "Vermont",
  ME: "Maine",
  NJ: "New Jersey",
  WV: "West Virginia",
  MS: "Mississippi",
  AR: "Arkansas",
  OK: "Oklahoma",
  IA: "Iowa",
  NE: "Nebraska",
  KS: "Kansas",
  ND: "North Dakota",
  SD: "South Dakota",
  ID: "Idaho",
  MT: "Montana",
  WY: "Wyoming",
  AK: "Alaska",
  HI: "Hawaii",
  // Canadian provinces (Tier-8)
  ON: "Ontario",
  QC: "Québec",
  BC: "British Columbia",
  AB: "Alberta",
  MB: "Manitoba",
  NS: "Nova Scotia",
};

// Alphabetical by full state name. DC sorts under "D" (District of Columbia).
const STATE_ORDER: MetroCoverage["state"][] = (Object.keys(STATE_NAMES) as MetroCoverage["state"][])
  .sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b]));

export default function CitiesPage() {
  const tierACount = METROS.filter((m) => m.aadtPct >= TIER_A_AADT_CUTOFF || m.code === "atlanta_metro").length;

  usePageMeta({
    title: `Cities we cover — ${TOTAL_METROS} metros, ${TOTAL_SIGNALS.toLocaleString()} signals indexed`,
    description: `Simple Impact Studies indexes every signalized intersection in ${TOTAL_METROS} Southeast US metros across ${STATES_COVERED} states. HCM 6th, ITE 11th, MUTCD. ${tierACount} metros have measured state-DOT AADT calibration.`,
    canonical: "https://simpleimpactstudies.com/cities",
  });

  return (
    <div className="overflow-x-hidden">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-12 space-y-12">

        <header className="space-y-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Coverage appendix · {new Date().toISOString().slice(0, 10)}
          </div>
          <div className="h-px w-full bg-border" />
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05] text-slate-900 dark:text-slate-50">
            Every metro indexed.
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl leading-relaxed">
            Same TIS engine, same HCM / ITE / MUTCD math, every region below.
            Click any metro to jump to its detail row.
          </p>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 border-t border-b border-border py-6">
          <Stat label="Metros indexed" value={String(TOTAL_METROS)} />
          <Stat label="Signals indexed" value={TOTAL_SIGNALS.toLocaleString()} />
          <Stat label="States" value={String(STATES_COVERED)} />
          <Stat
            label="With measured AADT"
            value={String(tierACount)}
            sublabel={`≥ ${TIER_A_AADT_CUTOFF}% snap rate`}
          />
        </div>

        {/* Per-state table */}
        <section className="space-y-10">
          <Marker n="A" label="By state" />

          {STATE_ORDER.map((stateCode) => {
            const stateMetros = METROS.filter((m) => m.state === stateCode).sort(
              (a, b) => a.shortName.localeCompare(b.shortName),
            );
            if (stateMetros.length === 0) return null;
            const stateSignals = stateMetros.reduce((s, m) => s + m.signals, 0);

            return (
              <div key={stateCode} className="space-y-3">
                <div className="flex items-baseline justify-between border-b border-foreground/40 pb-2">
                  <h2 className="text-xl sm:text-2xl font-semibold text-foreground">
                    {STATE_NAMES[stateCode]}{" "}
                    <span className="font-mono text-sm text-muted-foreground font-normal">
                      · {stateCode}
                    </span>
                  </h2>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {stateMetros.length} metros · {stateSignals.toLocaleString()} signals
                  </span>
                </div>

                <div className="grid grid-cols-12 gap-3 sm:gap-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground border-b border-border">
                  <div className="col-span-4">Metro</div>
                  <div className="col-span-2 text-right">Signals</div>
                  <div className="col-span-2 text-right">Named</div>
                  <div className="col-span-2 text-right">AADT</div>
                  <div className="col-span-2 text-right">Live</div>
                </div>

                {stateMetros.map((m) => (
                  <CityRow key={m.code} m={m} />
                ))}
              </div>
            );
          })}
        </section>

        {/* Glossary / methodology footer */}
        <section className="space-y-4 border-t border-border pt-8">
          <Marker n="B" label="How to read this" />
          <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
            <Term
              label="Signals"
              body="Count of indexed signalized intersections in the metro. Derived from OpenStreetMap (Geofabrik daily snapshots) plus city-authoritative overlays where the local DOT publishes one (Charlotte CDOT, Miami-Dade County, Orlando ITS Devices, Raleigh Traffic Signals)."
            />
            <Term
              label="Named"
              body="Share of signals labeled with a real cross-street pair (e.g. 'Roswell Rd & Mt Vernon Hwy') vs. a fallback 'Signal #<id>'. Naming uses the bundled roads dataset plus city-authoritative tables when present."
            />
            <Term
              label="AADT"
              body="Share of signals snapped to a measured state-DOT Annual Average Daily Traffic count within 100–1000 m. The remainder uses a calibrated road-class baseline (motorway 2,500 vph through tertiary 700 vph), still HCM-compliant just not site-measured."
            />
            <Term
              label="Live"
              body="State-DOT real-time incident / closure feed wired into the analyzer. Charlotte and Raleigh-Durham use NCDOT TIMS; the FL metros use FDOT DIVAS; Louisville uses KYTC. Others fall back to engine-only outputs."
            />
          </dl>
        </section>

        <section className="border-t border-border pt-8">
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
            data-testid="link-demo-cta"
          >
            Run a study in any of these metros →
          </Link>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}

function CityRow({ m }: { m: MetroCoverage }) {
  const isFlagship = m.code === "atlanta_metro";
  const isTierA = m.aadtPct >= TIER_A_AADT_CUTOFF || isFlagship;
  return (
    <Link
      href={`/cities/${m.slug}`}
      id={m.code}
      className="block grid grid-cols-12 gap-3 sm:gap-4 py-3 border-b border-border/70 items-baseline hover:bg-accent/40 transition-colors scroll-mt-20 cursor-pointer"
      data-testid={`city-row-${m.code}`}
    >
      <div className="col-span-4">
        <div className="font-semibold text-sm sm:text-base text-foreground">
          {m.shortName}
          {isFlagship && (
            <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.15em] text-emerald-700 dark:text-emerald-400">
              Flagship
            </span>
          )}
          {!isFlagship && isTierA && (
            <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.15em] text-foreground/60">
              Tier-A
            </span>
          )}
        </div>
        {m.aadtSource && (
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate">
            {m.aadtSource}
          </div>
        )}
      </div>
      <div className="col-span-2 text-right font-mono text-sm sm:text-base text-foreground tabular-nums">
        {m.signals.toLocaleString()}
      </div>
      <div className="col-span-2 text-right font-mono text-sm tabular-nums text-muted-foreground">
        {m.namedPct.toFixed(1)}%
      </div>
      <div className="col-span-2 text-right font-mono text-sm tabular-nums">
        {m.aadtPct > 0 ? (
          <span className={isTierA ? "text-foreground font-semibold" : "text-muted-foreground"}>
            {m.aadtPct.toFixed(1)}%
          </span>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </div>
      <div className="col-span-2 text-right font-mono text-[11px] text-muted-foreground self-center">
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

function Stat({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div>
      <div className="font-mono text-2xl sm:text-3xl font-bold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      {sublabel && (
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">{sublabel}</div>
      )}
    </div>
  );
}

function Term({ label, body }: { label: string; body: string }) {
  return (
    <>
      <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/80">{label}</dt>
      <dd className="text-muted-foreground leading-relaxed">{body}</dd>
    </>
  );
}
