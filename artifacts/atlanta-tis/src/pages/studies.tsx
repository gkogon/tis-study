/**
 * Studies hub. Lists every study type the firm can run. Each card
 * routes to a study-specific generator page. New study types added
 * here as we ship them.
 */
import { Link } from "wouter";
import {
  ArrowRight, MapPin, ParkingCircle, ChevronRight, Lock, Building2,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

type Study = {
  id: string;
  href: string;
  title: string;
  blurb: string;
  icon: typeof MapPin;
  status: "live" | "coming-soon";
  citation: string;
};

const STUDIES: Study[] = [
  {
    id: "tis",
    href: "/tis",
    title: "Traffic Impact Study",
    blurb:
      "Screening-level TIS for a candidate site — ITE trip generation, signalized-intersection capacity, recommended mitigations.",
    icon: MapPin,
    status: "live",
    citation: "ITE 11th Ed. · HCM 6th Ed. · MUTCD",
  },
  {
    id: "parking",
    href: "/studies/parking",
    title: "Parking Demand Study",
    blurb:
      "Peak parking demand vs. local code minimum vs. proposed supply, with weekday/Saturday hourly profile.",
    icon: ParkingCircle,
    status: "live",
    citation: "ITE Parking Generation 5th Ed. · Atlanta Zoning Art. 10",
  },
  {
    id: "warrants",
    href: "/studies/warrants",
    title: "Signal Warrant Analysis",
    blurb:
      "MUTCD Chapter 4C — runs Warrants 1A, 1B, 3, and 7 against your candidate intersection's 24-hour volume profile and crash count.",
    icon: ChevronRight,
    status: "live",
    citation: "MUTCD 2009/2024 · Ch. 4C",
  },
  {
    id: "sight-distance",
    href: "/studies/sight-distance",
    title: "Sight Distance Analysis",
    blurb:
      "Stopping and Intersection Sight Distance per AASHTO Green Book, with maneuver-specific time-gap criteria and pass / marginal / fail verdicts.",
    icon: ChevronRight,
    status: "live",
    citation: "AASHTO Green Book 7th Ed.",
  },
  {
    id: "queuing",
    href: "/studies/queuing",
    title: "Queuing Analysis",
    blurb:
      "HCM Ch. 31 — 95th-percentile back-of-queue against the auxiliary-lane storage you have today.",
    icon: ChevronRight,
    status: "live",
    citation: "HCM 6th Ed. · Ch. 31",
  },
  {
    id: "road-diet",
    href: "/studies/road-diet",
    title: "Road-Diet Feasibility",
    blurb:
      "Screen a 4-to-3 or 5-to-3 lane conversion candidate against the FHWA 25,000 ADT threshold; safety + capacity + multimodal.",
    icon: ChevronRight,
    status: "live",
    citation: "FHWA-SA-14-028",
  },
];

export default function StudiesPage() {
  return (
    <div>
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-10">
        <header className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
            <Building2 className="w-3.5 h-3.5" />
            Studies
          </div>
          <h1 className="text-4xl font-bold leading-tight">
            What do you want to run?
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Each study type is a separate engine with its own input form and
            templated PDF. They all share your firm's project history and
            count against the same monthly study limit.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {STUDIES.map((s) => (
            <StudyCard key={s.id} study={s} />
          ))}
        </section>

        <section className="border rounded-xl p-6 bg-muted/30 space-y-2">
          <h2 className="text-lg font-semibold">Six studies, one firm account</h2>
          <p className="text-sm text-muted-foreground">
            Every study above is live. They share your firm account, the
            same project history, and the same monthly study limit — adding
            a study type is an upgrade in value per dollar, not a separate
            subscription. PDF export and post-build verification are
            shipping next.
          </p>
          <Link
            href="/for-firms"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline"
          >
            See the roadmap for engineering firms <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </section>
      </div>
      <SiteFooter />
    </div>
  );
}

function StudyCard({ study }: { study: Study }) {
  const Icon = study.icon;
  const live = study.status === "live";
  const inner = (
    <div
      className={
        "h-full border rounded-xl p-5 space-y-3 transition-colors " +
        (live
          ? "border-border bg-background hover:bg-accent/40 hover:border-blue-300"
          : "border-dashed border-border bg-muted/20 opacity-70 cursor-not-allowed")
      }
      data-testid={`card-study-${study.id}`}
    >
      <div className="flex items-center justify-between">
        <Icon className="w-6 h-6 text-blue-600" />
        {!live && (
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted-foreground/10">
            <Lock className="w-2.5 h-2.5 inline -mt-0.5 mr-1" />
            Coming soon
          </span>
        )}
      </div>
      <h3 className="text-lg font-semibold">{study.title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{study.blurb}</p>
      <div className="pt-1 text-xs text-muted-foreground">{study.citation}</div>
      {live && (
        <div className="pt-1 inline-flex items-center gap-1 text-sm font-medium text-blue-600">
          Run a study <ArrowRight className="w-3.5 h-3.5" />
        </div>
      )}
    </div>
  );
  return live ? <Link href={study.href}>{inner}</Link> : <div>{inner}</div>;
}
