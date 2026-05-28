/**
 * /cities/:slug — per-metro detail page.
 *
 * One URL per indexed metro. Mirrors the in-product "coverage report"
 * structure: hero, top-line stats, data provenance, jurisdictional
 * copy, sibling metros for navigation, and a CTA back into the studies
 * workflow. The numbers are the same ones the engine actually serves;
 * this page is a transparency layer on top of the data pipeline.
 */

import { Link, useRoute } from "wouter";
import { ArrowRight, ArrowLeft, ExternalLink, MapPin } from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { Marker } from "../components/section-marker";
import { usePageMeta } from "../hooks/use-page-meta";
import {
  metroBySlug,
  siblingMetros,
  STATE_NAMES,
  TIER_A_AADT_CUTOFF,
  type MetroCoverage,
} from "../data/metro-coverage";
import NotFound from "./not-found";

export default function CityDetailPage() {
  const [match, params] = useRoute<{ slug: string }>("/cities/:slug");
  if (!match || !params) return <NotFound />;
  const m = metroBySlug(params.slug);
  if (!m) return <NotFound />;

  const isFlagship = m.code === "atlanta_metro";
  const isTierA = m.aadtPct >= TIER_A_AADT_CUTOFF || isFlagship;
  const siblings = siblingMetros(m);

  // SEO: every metro gets its own indexable title + description so a
  // search for "traffic impact study charlotte" hits this page directly
  // rather than the generic /cities appendix.
  const aadtPhrase = m.aadtPct >= TIER_A_AADT_CUTOFF
    ? ` ${m.aadtPct.toFixed(0)}% of intersections calibrated to measured ${m.aadtSource ?? "state-DOT"} traffic counts.`
    : m.aadtPct > 0
      ? ` ${m.aadtPct.toFixed(0)}% calibrated to state-DOT counts.`
      : "";
  usePageMeta({
    title: `Traffic impact studies in ${m.shortName}, ${m.state}`,
    description: `Defensible screening-level TIS, parking, signal-warrant, sight-distance, queuing and road-diet studies for ${m.longName}. ${m.signals.toLocaleString()} signalized intersections indexed.${aadtPhrase} HCM 6th, ITE 11th, MUTCD.`,
    canonical: `https://simpleimpactstudies.com/cities/${m.slug}`,
  });

  return (
    <div className="overflow-x-hidden">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-12 space-y-14">

        {/* Breadcrumb back-link */}
        <div>
          <Link
            href="/cities"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-back-cities"
          >
            <ArrowLeft className="w-3 h-3" /> Coverage appendix
          </Link>
        </div>

        {/* Hero */}
        <header className="space-y-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-3">
            <span>{STATE_NAMES[m.state]} · {m.state}</span>
            {isFlagship && (
              <span className="text-emerald-700 dark:text-emerald-400">· Flagship</span>
            )}
            {!isFlagship && isTierA && (
              <span className="text-foreground/70">· Tier-A coverage</span>
            )}
          </div>
          <div className="h-px w-full bg-border" />
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.05] text-slate-900 dark:text-slate-50">
            {m.shortName}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">
            {m.longName}
          </p>
        </header>

        {/* §01 Top-line numbers */}
        <section className="space-y-5">
          <Marker n="01" label="Coverage numbers" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 sm:gap-7 border-t border-b border-border py-7">
            <BigStat label="Signals indexed" value={m.signals.toLocaleString()} />
            <BigStat label="Named cross-streets" value={`${m.namedPct.toFixed(1)}%`} />
            <BigStat
              label="Measured AADT"
              value={m.aadtPct > 0 ? `${m.aadtPct.toFixed(1)}%` : "—"}
              tone={m.aadtPct >= 95 ? "good" : m.aadtPct >= 75 ? "ok" : m.aadtPct > 0 ? "weak" : "none"}
            />
            <BigStat
              label="Live data feed"
              value={m.liveSource ?? "—"}
              tone={m.liveSource ? "good" : "none"}
              small
            />
          </div>
        </section>

        {/* §02 Where the data comes from */}
        <section className="space-y-5">
          <Marker n="02" label="Data provenance" />
          <dl className="divide-y divide-border border-t border-b border-border">
            <Row label="Signal inventory">
              OpenStreetMap (Geofabrik daily PBF for {STATE_NAMES[m.state]}), filtered to
              the {m.longName} bounding box. {m.signals.toLocaleString()} signalized
              intersections indexed.
              {m.citySignalSource && (
                <>
                  <br />
                  <span className="text-foreground">City overlay:</span> {m.citySignalSource}
                </>
              )}
            </Row>
            <Row label="Road network">
              Geofabrik daily PBF, motorway through tertiary classes, named ways only.
              Drives cross-street resolution at serve time — that's how{" "}
              <span className="font-mono">{m.namedPct.toFixed(1)}%</span> of signals get
              a real "Street A & Street B" label.
            </Row>
            <Row label="AADT (vehicle volumes)">
              {m.aadtPct > 0 ? (
                <>
                  <span className="text-foreground">{m.aadtSource}</span>
                  {" — "}snapped to{" "}
                  <span className="font-mono">{m.aadtPct.toFixed(1)}%</span> of signals
                  within a tight spatial radius. The remainder use a calibrated road-class
                  baseline (motorway 2,500 vph → tertiary 700 vph).
                </>
              ) : (
                <>
                  No measured state-DOT AADT layer wired for this metro yet. Engine runs
                  on calibrated road-class baseline (motorway 2,500 vph → tertiary 700 vph).
                  When the state DOT publishes an AADT feature service, we'll snap.
                </>
              )}
            </Row>
            <Row label="Live incidents">
              {m.liveSource ? (
                <>
                  <span className="text-foreground">{m.liveSource}</span> — refreshed
                  every minute, scoped to {m.longName}.
                </>
              ) : (
                <>
                  No public real-time incident feed wired for the local state DOT. Engine
                  outputs remain valid; live monitoring SKU is degraded.
                </>
              )}
            </Row>
            <Row label="Zone labeling">
              {m.hasNeighborhoodPolygons ? (
                <>
                  Real neighborhood polygons loaded for the metro core (point-in-polygon
                  lookup). Suburbs outside city limits fall back to compass quadrants
                  (NW / NE / SW / SE).
                </>
              ) : (
                <>
                  Compass-quadrant zones (Central / NW / NE / SW / SE {m.shortName}). Real
                  polygon zones get loaded per metro as the city publishes them.
                </>
              )}
            </Row>
          </dl>
        </section>

        {/* §03 Jurisdiction */}
        <section className="space-y-5">
          <Marker n="03" label="Jurisdictional copy in reports" />
          <p className="text-sm text-muted-foreground max-w-2xl">
            These are the local authorities and code sections that get
            substituted into TIS PDFs for projects in {m.shortName} — language
            reviewers expect to see.
          </p>
          <dl className="space-y-4 border-t border-border pt-5">
            <KvRow label="Traffic engineering authority">{m.dotName}</KvRow>
            <KvRow label="Planning office">{m.planningOfficeName}</KvRow>
            <KvRow label="Parking citation">{m.parkingCodeCitation}</KvRow>
          </dl>
        </section>

        {/* §04 Sibling metros for navigation */}
        {siblings.length > 0 && (
          <section className="space-y-5">
            <Marker n="04" label={`Other metros in ${STATE_NAMES[m.state]}`} />
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 border-t border-border pt-4">
              {siblings.map((s) => (
                <Link
                  key={s.code}
                  href={`/cities/${s.slug}`}
                  className="group flex items-center justify-between py-2 border-b border-border/60 hover:border-foreground/30 transition-colors"
                  data-testid={`link-sibling-${s.slug}`}
                >
                  <span className="font-medium text-foreground group-hover:underline underline-offset-4">
                    {s.shortName}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {s.signals.toLocaleString()} signals · {s.aadtPct > 0 ? `${s.aadtPct.toFixed(0)}%` : "synth"}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="border-t border-border pt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
            data-testid="link-run-study"
          >
            Run a study in {m.shortName}
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/cities"
            className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
            data-testid="link-all-cities"
          >
            <MapPin className="w-3 h-3" /> All cities ({30})
          </Link>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}

function BigStat({ label, value, sublabel, tone, small }: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "good" | "ok" | "weak" | "none";
  small?: boolean;
}) {
  const toneClass =
    tone === "good" ? "text-emerald-700 dark:text-emerald-400"
    : tone === "ok" ? "text-foreground"
    : tone === "weak" ? "text-muted-foreground"
    : tone === "none" ? "text-muted-foreground/50"
    : "text-foreground";
  const sizeClass = small ? "text-base sm:text-lg" : "text-2xl sm:text-4xl";
  return (
    <div>
      <div className={`font-mono ${sizeClass} font-bold tabular-nums ${toneClass} leading-tight`}>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-6 py-4">
      <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/70">
        {label}
      </dt>
      <dd className="sm:col-span-3 text-sm text-muted-foreground leading-relaxed">
        {children}
      </dd>
    </div>
  );
}

function KvRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-1 sm:gap-6">
      <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/70">
        {label}
      </dt>
      <dd className="sm:col-span-3 text-sm text-foreground">{children}</dd>
    </div>
  );
}
