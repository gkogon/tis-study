import { useState } from "react";

function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-surface-200/60">
      <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
        <a href="#" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M3 12h18M3 17h18"/><circle cx="7" cy="7" r="1.5" fill="white"/><circle cx="14" cy="12" r="1.5" fill="white"/><circle cx="10" cy="17" r="1.5" fill="white"/></svg>
          </div>
          <span className="font-display text-xl text-surface-900">Atlanta TIS</span>
        </a>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-surface-600">
          <a href="#features" className="hover:text-brand-600 transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-brand-600 transition-colors">How It Works</a>
          <a href="#pricing" className="hover:text-brand-600 transition-colors">Pricing</a>
          <a href="#contact" className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-sm shadow-brand-600/20">
            Get Started
          </a>
        </div>
        <button onClick={() => setOpen(!open)} className="md:hidden p-2 rounded-lg hover:bg-surface-100 transition-colors" aria-label="Toggle menu">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={open ? "M6 6l12 12M6 18L18 6" : "M4 8h16M4 16h16"} /></svg>
        </button>
      </div>
      {open && (
        <div className="md:hidden border-t border-surface-200/60 bg-white px-6 py-4 space-y-3 text-sm font-medium text-surface-600">
          <a href="#features" onClick={() => setOpen(false)} className="block py-2">Features</a>
          <a href="#how-it-works" onClick={() => setOpen(false)} className="block py-2">How It Works</a>
          <a href="#pricing" onClick={() => setOpen(false)} className="block py-2">Pricing</a>
          <a href="#contact" onClick={() => setOpen(false)} className="block py-2 text-brand-600 font-semibold">Get Started</a>
        </div>
      )}
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-gradient-to-br from-brand-100/60 via-brand-50/30 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-gradient-to-tl from-brand-200/30 to-transparent rounded-full blur-3xl" />
      </div>
      <div className="max-w-6xl mx-auto px-6">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-50 border border-brand-200/60 text-brand-700 text-xs font-semibold tracking-wide uppercase mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Atlanta Metro Coverage
          </div>
          <h1 className="font-display text-5xl md:text-7xl leading-[1.05] text-surface-900 mb-6">
            Save 40+ hours
            <br />
            <span className="text-brand-600">per traffic study.</span>
          </h1>
          <p className="text-lg md:text-xl text-surface-500 leading-relaxed max-w-xl mb-10">
            We monitor 7,393 traffic lights and 104 million daily vehicles across Atlanta. Our TIS generator turns that data into PE-ready reports in 60 seconds — saving your firm thousands per study in engineer salary and billable time.
          </p>
          <div className="flex flex-col sm:flex-row items-start gap-4">
            <a href="#contact" className="inline-flex items-center gap-2 px-7 py-3.5 rounded-lg bg-brand-600 text-white font-semibold text-sm hover:bg-brand-700 transition-all shadow-lg shadow-brand-600/25 hover:shadow-brand-600/35 hover:-translate-y-0.5">
              Start 14-Day Free Trial
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
            <a href="#features" className="inline-flex items-center gap-2 px-7 py-3.5 rounded-lg border border-surface-300 text-surface-700 font-semibold text-sm hover:border-surface-400 hover:bg-white transition-all">
              See How It Works
            </a>
          </div>
        </div>
        <div className="mt-16 md:mt-20 relative">
          <div className="absolute -inset-4 bg-gradient-to-b from-brand-600/5 to-brand-600/0 rounded-2xl blur-xl" />
          <div className="relative rounded-xl overflow-hidden border border-surface-200 shadow-2xl shadow-surface-900/10 bg-white">
            <div className="flex items-center gap-2 px-4 py-3 bg-surface-50 border-b border-surface-200">
              <span className="w-3 h-3 rounded-full bg-red-400/70" />
              <span className="w-3 h-3 rounded-full bg-amber-400/70" />
              <span className="w-3 h-3 rounded-full bg-green-400/70" />
              <span className="ml-3 text-xs text-surface-400 font-medium">Atlanta TIS Generator</span>
            </div>
            <img src="/screenshots/full-top.jpg" alt="Atlanta TIS Generator — full dashboard interface showing intersection analysis" className="w-full" loading="eager" />
          </div>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
    ),
    title: "ITE Trip Generation",
    desc: "13+ land-use codes with ITE 11th Ed. rates. Multi-period analysis across AM, PM, Saturday, and daily totals with pass-by and internal-capture credits.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
    ),
    title: "HCM Level of Service",
    desc: "Full HCM 6th Ed. signalized-intersection analysis with v/c ratio, control delay, LOS grade, and 95th-percentile queue per approach direction.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1118 0z"/><circle cx="12" cy="10" r="3"/></svg>
    ),
    title: "Interactive Impact Map",
    desc: "Leaflet-powered map color-coded by post-build LOS. Click any intersection for delay change, added trips, and mitigation recommendations.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>
    ),
    title: "Monte-Carlo Sensitivity",
    desc: "100-iteration stochastic analysis reports P10/P50/P90 of worst-case delay and probability of any LOS drop. Built-in ±15% confidence band.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
    ),
    title: "White-Labeled PDFs",
    desc: "Cover page with your firm's logo, PE stamp, and signature block. Methodology appendix and limitations page on every report — ready for print.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    ),
    title: "Citation System",
    desc: "Every figure linked to its source — HCM 6th Ed., ITE Trip Gen 11th Ed., MUTCD. Your PE signs with confidence knowing every number is traceable.",
  },
];

function Features() {
  return (
    <section id="features" className="py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-brand-600 uppercase tracking-wide mb-3">What Powers the Savings</p>
          <h2 className="font-display text-4xl md:text-5xl text-surface-900 mb-4">Every feature replaces hours of manual work</h2>
          <p className="text-surface-500 text-lg max-w-2xl mx-auto">Each capability below is a task your engineers currently do by hand. The generator handles all of them in a single 60-second run.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f, i) => (
            <div key={i} className="group p-7 rounded-xl border border-surface-200 bg-white hover:border-brand-200 hover:shadow-lg hover:shadow-brand-600/5 transition-all duration-300">
              <div className="w-11 h-11 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600 mb-5 group-hover:bg-brand-100 transition-colors">{f.icon}</div>
              <h3 className="font-semibold text-surface-900 text-lg mb-2">{f.title}</h3>
              <p className="text-surface-500 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Screenshots() {
  return (
    <section className="py-24 md:py-32 bg-surface-900 text-white overflow-hidden">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-brand-400 uppercase tracking-wide mb-3">See What You Skip</p>
          <h2 className="font-display text-4xl md:text-5xl mb-4">The work the generator does for you</h2>
          <p className="text-surface-400 text-lg max-w-2xl mx-auto">Turning-movement analysis, intersection LOS grading, optimization recommendations, and report assembly — all handled in seconds from live-monitored Atlanta data.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-8">
            <div className="rounded-xl overflow-hidden border border-white/10 shadow-2xl">
              <div className="px-5 py-3 bg-white/5 border-b border-white/10">
                <span className="text-xs font-medium text-surface-400">Instant LOS analysis across 7,393 signals</span>
              </div>
              <img src="/screenshots/after-optimization.jpg" alt="Automated intersection LOS analysis from monitored traffic light data" className="w-full" loading="lazy" />
            </div>
            <div className="rounded-xl overflow-hidden border border-white/10 shadow-2xl">
              <div className="px-5 py-3 bg-white/5 border-b border-white/10">
                <span className="text-xs font-medium text-surface-400">Impact map powered by 104M+ daily vehicle observations</span>
              </div>
              <img src="/screenshots/improvement-map.jpg" alt="Interactive map showing impact analysis from real-time vehicle tracking data" className="w-full" loading="lazy" />
            </div>
          </div>
          <div className="space-y-8">
            <div className="rounded-xl overflow-hidden border border-white/10 shadow-2xl">
              <div className="px-5 py-3 bg-white/5 border-b border-white/10">
                <span className="text-xs font-medium text-surface-400">Per-intersection detail from 2.5M turning movements/hr</span>
              </div>
              <img src="/screenshots/drawer-with-optimization.jpg" alt="Detailed per-intersection breakdown derived from turning movement data" className="w-full" loading="lazy" />
            </div>
            <div className="rounded-xl overflow-hidden border border-white/10 shadow-2xl">
              <div className="px-5 py-3 bg-white/5 border-b border-white/10">
                <span className="text-xs font-medium text-surface-400">Before/after comparison — hours of manual work, done instantly</span>
              </div>
              <img src="/screenshots/after-optimization-2.jpg" alt="Automated before/after optimization comparison replacing hours of manual analysis" className="w-full" loading="lazy" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { num: "01", title: "Enter project details", desc: "Select a land-use type, set the project size, location, and study radius. Use a project template or configure from scratch." },
  { num: "02", title: "Generate the study", desc: "The engine calculates trip generation, approach splits, HCM delay, and intersection LOS. Monte-Carlo sensitivity runs in the background." },
  { num: "03", title: "Review and print", desc: "Review the interactive map and tables, then print a white-labeled PDF with cover page, methodology appendix, and limitations disclosure." },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-brand-600 uppercase tracking-wide mb-3">Process</p>
          <h2 className="font-display text-4xl md:text-5xl text-surface-900 mb-4">Three steps. Under a minute.</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {STEPS.map((s) => (
            <div key={s.num} className="relative">
              <span className="font-display text-6xl text-brand-100 select-none">{s.num}</span>
              <h3 className="font-semibold text-surface-900 text-lg mt-2 mb-2">{s.title}</h3>
              <p className="text-surface-500 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const TIERS = [
  {
    name: "Solo",
    price: "$199",
    period: "/month",
    desc: "For individual engineers or practice leads evaluating the platform.",
    features: ["Up to 10 studies per month", "All land-use types", "Full HCM & ITE analysis", "Monte-Carlo sensitivity", "Standard PDF export", "Email support"],
    cta: "Start Free Trial",
    highlight: false,
  },
  {
    name: "Practice",
    price: "$1,500",
    period: "/month",
    desc: "For mid-sized firms running 4–30+ studies per month.",
    features: ["Unlimited studies", "Multi-seat workspaces", "Firm branding & PE stamp", "Project & client folders", "Audit log", "Priority onboarding call", "Bluebeam-ready output"],
    cta: "Start Free Trial",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For large firms needing SSO, SLA, and API access.",
    features: ["Everything in Practice", "SSO / SAML", "Dedicated onboarding", "Custom rate limits", "API access for integrations", "Private deployment option", "Dedicated support SLA"],
    cta: "Contact Sales",
    highlight: false,
  },
];

function Pricing() {
  return (
    <section id="pricing" className="py-24 md:py-32 bg-surface-50">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-brand-600 uppercase tracking-wide mb-3">Pricing</p>
          <h2 className="font-display text-4xl md:text-5xl text-surface-900 mb-4">Plans that scale with your practice</h2>
          <p className="text-surface-500 text-lg">14-day free trial on all plans. No credit card required.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`rounded-xl p-8 ${
                t.highlight
                  ? "bg-surface-900 text-white border-2 border-brand-500 shadow-2xl shadow-brand-600/15 relative"
                  : "bg-white border border-surface-200"
              }`}
            >
              {t.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-brand-600 text-white text-xs font-semibold">Most Popular</span>
              )}
              <h3 className={`font-semibold text-lg mb-1 ${t.highlight ? "text-white" : "text-surface-900"}`}>{t.name}</h3>
              <p className={`text-sm mb-6 ${t.highlight ? "text-surface-400" : "text-surface-500"}`}>{t.desc}</p>
              <div className="flex items-baseline gap-1 mb-8">
                <span className={`font-display text-4xl ${t.highlight ? "text-white" : "text-surface-900"}`}>{t.price}</span>
                {t.period && <span className={`text-sm ${t.highlight ? "text-surface-400" : "text-surface-500"}`}>{t.period}</span>}
              </div>
              <ul className="space-y-3 mb-8">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <svg className={`w-4 h-4 mt-0.5 flex-shrink-0 ${t.highlight ? "text-brand-400" : "text-brand-600"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                    <span className={t.highlight ? "text-surface-300" : "text-surface-600"}>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href="#contact"
                className={`block text-center py-3 rounded-lg font-semibold text-sm transition-all ${
                  t.highlight
                    ? "bg-brand-600 text-white hover:bg-brand-500 shadow-lg shadow-brand-600/30"
                    : "border border-surface-300 text-surface-700 hover:border-surface-400 hover:bg-surface-50"
                }`}
              >
                {t.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className="py-16 border-y border-surface-200 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <p className="text-center text-xs font-semibold text-surface-400 uppercase tracking-widest mb-8">Built on real Atlanta traffic data we monitor every day</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: "7,393", label: "Traffic lights monitored" },
            { value: "104M+", label: "Daily vehicles tracked" },
            { value: "2.5M+", label: "Turning movements / hr" },
            { value: "60s", label: "To generate a full TIS" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="font-display text-3xl md:text-4xl text-brand-600 mb-1">{s.value}</div>
              <div className="text-sm text-surface-500">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ForFirms() {
  const savings = [
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      ),
      metric: "40–60 hrs",
      label: "Time saved per study",
      desc: "A manual screening-level TIS requires 40–60 hours of data lookup, HCM calculations, and report formatting. The generator does it in under a minute using live data from 7,393 monitored signals.",
      color: "bg-blue-50 text-blue-600",
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
      ),
      metric: "$2,100+",
      label: "Cost saved per study",
      desc: "At typical junior-engineer billing rates (~$35–55/hr), each automated study eliminates $2,100–$3,300 in labor costs — with data drawn from 104 million daily vehicle observations.",
      color: "bg-green-50 text-green-600",
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
      ),
      metric: "$25K+",
      label: "Annual salary recaptured",
      desc: "A firm running 10 studies per month frees up 400–600 hours of junior engineer time annually — the equivalent of redirecting $25,000+ in salary toward higher-value billable work.",
      color: "bg-amber-50 text-amber-600",
    },
  ];

  return (
    <section className="py-24 md:py-32">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-brand-600 uppercase tracking-wide mb-3">The ROI</p>
          <h2 className="font-display text-4xl md:text-5xl text-surface-900 mb-4 leading-tight">Time, money, and salary — saved on every study</h2>
          <p className="text-surface-500 text-lg max-w-2xl mx-auto">
            We track 2.5 million turning movements per hour across 7,393 Atlanta signals. That data powers instant TIS generation — so your engineers don't have to do it manually.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          {savings.map((s) => (
            <div key={s.label} className="relative p-8 rounded-xl border border-surface-200 bg-white hover:shadow-lg hover:shadow-brand-600/5 transition-all duration-300">
              <div className={`w-14 h-14 rounded-xl ${s.color} flex items-center justify-center mb-6`}>{s.icon}</div>
              <div className="font-display text-4xl text-surface-900 mb-1">{s.metric}</div>
              <div className="text-sm font-semibold text-brand-600 uppercase tracking-wide mb-3">{s.label}</div>
              <p className="text-surface-500 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
        <div className="rounded-2xl bg-surface-50 border border-surface-200 p-8 md:p-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <h3 className="font-display text-2xl md:text-3xl text-surface-900 mb-4">How the numbers add up</h3>
              <div className="space-y-4 text-sm text-surface-600 leading-relaxed">
                <p>A typical Atlanta-area engineering firm runs 8–15 screening-level traffic studies per month. Each one traditionally involves a junior engineer spending days pulling turning-movement counts, running HCM delay calculations, and assembling the final report.</p>
                <p>Our generator draws on real-time data from <strong className="text-surface-900">7,393 monitored traffic lights</strong> and <strong className="text-surface-900">104 million daily vehicle observations</strong> to produce that same deliverable in 60 seconds — complete with ITE trip generation, HCM LOS analysis, and traceable citations.</p>
                <p>For a 10-study-per-month firm, that's <strong className="text-surface-900">400–600 hours</strong> and <strong className="text-surface-900">$21,000–$33,000</strong> in labor costs returned to your practice every year.</p>
              </div>
            </div>
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-br from-brand-100/40 to-brand-50/20 rounded-2xl blur-xl" />
              <div className="relative rounded-xl overflow-hidden border border-surface-200 shadow-2xl bg-white">
                <img src="/screenshots/after-optimization.jpg" alt="Results dashboard showing before/after LOS grades" className="w-full" loading="lazy" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ContactForm() {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          organization: data.organization,
          role: data.role,
          studiesPerMonth: data.studiesPerMonth ? Number(data.studiesPerMonth) : undefined,
          tierInterest: data.tierInterest,
          message: data.message,
          website: data.website,
          source: "landing_page",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Something went wrong");
      }

      setStatus("success");
      form.reset();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }

  return (
    <section id="contact" className="py-24 md:py-32 bg-surface-900">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          <div className="text-white">
            <p className="text-sm font-semibold text-brand-400 uppercase tracking-wide mb-3">Start Saving</p>
            <h2 className="font-display text-4xl md:text-5xl mb-6 leading-tight">See the savings for your firm</h2>
            <p className="text-surface-400 text-lg leading-relaxed mb-10">
              No credit card required. Run a real study on your first day and see how much time and money your firm can save with automated TIS generation.
            </p>
            <div className="space-y-6">
              {[
                { q: "What happens after the trial?", a: "Choose a plan or walk away. No surprise charges and no lock-in." },
                { q: "Can I white-label reports immediately?", a: "Yes — firm branding is available from day one of the trial on Practice and Enterprise tiers." },
                { q: "What area does this cover?", a: "The Atlanta MSA, including all signalized intersections. Coverage expanding quarterly." },
              ].map((faq) => (
                <div key={faq.q}>
                  <div className="font-semibold text-white text-sm mb-1">{faq.q}</div>
                  <div className="text-sm text-surface-400">{faq.a}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl p-8 shadow-2xl">
            {status === "success" ? (
              <div className="text-center py-12">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                </div>
                <h3 className="font-display text-2xl text-surface-900 mb-2">Request received</h3>
                <p className="text-surface-500">We'll reach out within one business day to set up your trial.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <h3 className="font-display text-2xl text-surface-900 mb-1">Request a trial</h3>
                <p className="text-sm text-surface-500 mb-4">Fill out the form and we'll get you set up.</p>
                <div className="hidden" aria-hidden="true">
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Name *</label>
                    <input name="name" required className="w-full px-4 py-2.5 rounded-lg border border-surface-300 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all" placeholder="Jordan Reeves" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Work email *</label>
                    <input name="email" type="email" required className="w-full px-4 py-2.5 rounded-lg border border-surface-300 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all" placeholder="jordan@example.com" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Organization</label>
                    <input name="organization" className="w-full px-4 py-2.5 rounded-lg border border-surface-300 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all" placeholder="Croy Engineering" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Role</label>
                    <input name="role" className="w-full px-4 py-2.5 rounded-lg border border-surface-300 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all" placeholder="Senior Traffic Engineer" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Studies per month</label>
                    <select name="studiesPerMonth" className="w-full px-4 py-2.5 rounded-lg border border-surface-300 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all bg-white text-surface-700">
                      <option value="">Select range</option>
                      <option value="3">1–3</option>
                      <option value="10">4–10</option>
                      <option value="25">11–25</option>
                      <option value="50">26–50</option>
                      <option value="100">50+</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Plan interest</label>
                    <select name="tierInterest" className="w-full px-4 py-2.5 rounded-lg border border-surface-300 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all bg-white text-surface-700">
                      <option value="">Select plan</option>
                      <option value="solo">Solo — $199/mo</option>
                      <option value="practice">Practice — $1,500/mo</option>
                      <option value="enterprise">Enterprise — Custom</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">Message</label>
                  <textarea name="message" rows={3} className="w-full px-4 py-2.5 rounded-lg border border-surface-300 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all resize-none" placeholder="Tell us about your firm and how you'd use the tool..." />
                </div>
                {status === "error" && (
                  <div className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-lg">{errorMsg}</div>
                )}
                <button
                  type="submit"
                  disabled={status === "submitting"}
                  className="w-full py-3 rounded-lg bg-brand-600 text-white font-semibold text-sm hover:bg-brand-700 transition-all shadow-lg shadow-brand-600/25 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {status === "submitting" ? "Submitting..." : "Request Trial Access"}
                </button>
                <p className="text-xs text-surface-400 text-center">No credit card required. We'll respond within one business day.</p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-surface-900 border-t border-white/5 py-12">
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-brand-600 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M3 12h18M3 17h18"/></svg>
          </div>
          <span className="font-display text-lg text-white">Atlanta TIS</span>
        </div>
        <div className="flex items-center gap-8 text-sm text-surface-400">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          <a href="#contact" className="hover:text-white transition-colors">Contact</a>
        </div>
        <p className="text-xs text-surface-500">Atlanta TIS. All rights reserved.</p>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <>
      <Nav />
      <Hero />
      <Stats />
      <Features />
      <ForFirms />
      <HowItWorks />
      <Screenshots />
      <Pricing />
      <ContactForm />
      <Footer />
    </>
  );
}
