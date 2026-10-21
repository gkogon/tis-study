/**
 * The Pittsburgh sample study's opener: the home page's scroll-driven
 * "study, built as you scroll" (study-alive-hero.tsx), told with THIS
 * study's report.
 *
 * A pinned full-viewport canvas runs `lib/pittsburgh-alive-sim.ts` — the
 * study's own road network (/api/roads, the live map's request) and its 36
 * signals at their own coordinates, each running its own computed cycle —
 * while scroll progress drives the camera and the narration in three acts:
 *
 *   1. the site: the shopping center goes up and its trips come with it —
 *      daily, PM peak gross, pass-by and mode-share credits, net new;
 *   2. the signal: one McKnight Road signal (lib/pittsburgh-study.ts
 *      FEATURED_SIGNAL_ID), its loaded approaches Existing → No-Build →
 *      Build, its computed cycle and splits, delay and LOS;
 *   3. the study area at the PM peak: every signal lights up by No-Build
 *      LOS, then shifts to Build; the grade drops are ringed and counted;
 *      project trips spread from the site;
 *
 * and lands on the report (the metric strip is the page's own header just
 * below). Every number in the HUD is a field of `openerStory(payload)` —
 * nothing is typed here, and check:pittsburgh-study-private pins that. The
 * traffic itself is illustrative and the HUD says so.
 *
 * Text is real DOM; the canvas is decorative and aria-hidden. Live values
 * are written to refs, so nothing re-renders per frame; the loop only runs
 * while the scene is on screen. Deliberately dark in both themes, like the
 * home opener. With prefers-reduced-motion there is no pinned scroll and no
 * animation: one still frame of the study area and the three acts' final
 * values as cards.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import type { RoadSegment } from "@/lib/study-map-sim";
import { PghAliveSim, flyCamera, zoomCamera, ease, LOS_COLORS, type Camera, type SceneState, type Los } from "@/lib/pittsburgh-alive-sim";
import { openerStory, fmtInt, STATE_NAME, type OpenerStory, type PittsburghSamplePayload } from "@/lib/pittsburgh-study";

const SIM_SPEED = 6;
const AREA_SPEED = 12;

const ON = ["opacity-100", "translate-y-0", "pointer-events-auto"];
const OFF = ["opacity-0", "translate-y-3", "pointer-events-none"];
function actFor(P: number): number {
  return P < 0.3 ? 0 : P < 0.61 ? 1 : P < 0.905 ? 2 : 3;
}

type Refs = Record<string, HTMLElement | null>;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const fmt1 = (n: number) => n.toFixed(1);
const fmt2 = (n: number) => n.toFixed(2);
const fmtVph = (n: number) => fmtInt(n);

function sceneInput(payload: PittsburghSamplePayload, story: OpenerStory) {
  const r = payload.report;
  const tg = r.tripGeneration;
  // The illustrative footprint: the GLA as one square floor plate.
  const footprintFt = tg.unitShort === "ksf" ? Math.sqrt(tg.size * 1000) : Math.sqrt(Math.max(1, tg.size) * 1000);
  return {
    site: { lat: r.request.latitude, lon: r.request.longitude },
    radiusMi: r.studyRadiusMi,
    rows: r.affectedIntersections,
    featuredId: story.signal?.id ?? null,
    footprintFt,
    pmIn: story.site.pmIn,
    pmOut: story.site.pmOut,
  };
}

/** The three framings: the site, the featured signal, the study area. */
function framings(sim: PghAliveSim, vw: number, vh: number): [Camera, Camera, Camera] {
  const wide = vw >= PghAliveSim.WIDE_PX;
  const availW = wide ? vw - 470 : vw;
  const availH = wide ? vh : vh * 0.5;
  const f = sim.featured;
  const sb = sim.site;
  const site: Camera = { x: sb.cx, y: sb.cy, s: Math.min(availW * 0.52, availH * 0.5) / (sb.px1 - sb.px0) };
  const signal: Camera = f ? { x: f.x, y: f.y, s: Math.min(availW, availH * 1.2) / 1250 } : site;
  // the whole study radius inside the viewport, clear of the site header
  const area: Camera = { x: 0, y: 0, s: Math.min(availW * 0.94, (availH - 90) * 0.96) / (2 * sim.radiusFt) };
  return [site, signal, area];
}

function cameraFor(P: number, c: [Camera, Camera, Camera], vw: number, vh: number): Camera {
  const [A, B, C] = c;
  if (P < 0.27) return A;
  if (P < 0.37) return flyCamera(A, B, (P - 0.27) / 0.1, vw, vh);
  if (P < 0.6) return B;
  if (P < 0.7) return zoomCamera(B, C, (P - 0.6) / 0.1);
  return C;
}

export function PittsburghAliveOpener({ payload, loadRoads }: { payload: PittsburghSamplePayload; loadRoads: () => Promise<RoadSegment[]> }) {
  const story = useMemo(() => openerStory(payload), [payload]);
  const [reduced] = useState(prefersReducedMotion);
  return (
    <div className="bg-[#0B1220] text-slate-50" data-testid="pgh-opener">
      <Intro payload={payload} story={story} reduced={reduced} />
      {reduced
        ? <OpenerStatic payload={payload} story={story} loadRoads={loadRoads} />
        : <OpenerScroll payload={payload} story={story} loadRoads={loadRoads} />}
    </div>
  );
}

const eyebrow = "font-mono text-[11px] leading-4 tracking-[0.18em] uppercase text-[#8A9BB5] flex items-center gap-2.5";

function Intro({ payload, story, reduced }: { payload: PittsburghSamplePayload; story: OpenerStory; reduced: boolean }) {
  const s = story.site;
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-7 flex flex-col gap-4">
      <div className={`${eyebrow} flex-wrap`}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" aria-hidden />
        <span>Traffic impact study</span><span aria-hidden>·</span><span>Sample study</span><span aria-hidden>·</span>
        <span>{payload.regionName}, {STATE_NAME}</span>
      </div>
      <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.04] max-w-[16ch] text-balance">{payload.projectName}</h1>
      <p className="text-lg sm:text-xl text-[#8A9BB5] leading-relaxed max-w-2xl">
        A {s.sizeLabel} shopping center on the McKnight Road corridor, opening in {story.area.openingYear}.{" "}
        {reduced
          ? <>The site, one McKnight Road signal, then all {story.area.signals} signals in the {story.area.radiusMi}-mile study area — every number below is the saved report's.</>
          : <>Keep scrolling: the site goes up, one McKnight Road signal is timed, then all {story.area.signals} signals in the {story.area.radiusMi}-mile study area run the PM peak. Every number on screen is the saved report's.</>}
      </p>
    </div>
  );
}

function Cell({ label, big, span, children, refKey, bind }: { label: string; big?: boolean; span?: number; children: ReactNode; refKey?: string; bind?: (k: string) => (n: HTMLElement | null) => void }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : undefined} ref={refKey && bind ? bind(refKey) : undefined}>
      <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-[#5B6B85]">{label}</div>
      <div className={`font-mono font-semibold tabular-nums leading-[1.1] mt-1 ${big ? "text-[24px] md:text-[32px]" : "text-[17px] md:text-[20px]"}`}>{children}</div>
    </div>
  );
}
const Unit = ({ children }: { children: ReactNode }) => <small className="text-[11px] text-[#8A9BB5] font-normal ml-1">{children}</small>;

function LosChip({ los, refKey, bind }: { los: string; refKey?: string; bind?: (k: string) => (n: HTMLElement | null) => void }) {
  return (
    <span
      ref={refKey && bind ? bind(refKey) : undefined}
      className="inline-flex items-center justify-center w-[26px] h-[26px] rounded font-mono font-bold text-[13px] align-middle transition-opacity duration-300"
      style={{ background: LOS_COLORS[(los as Los)] ?? "#94a3b8", color: los === "F" ? "#fff" : "#0B1220" }}
    >
      {los}
    </span>
  );
}

// ---------------------------------------------------------------------------
// the scroll-driven scene
// ---------------------------------------------------------------------------

function OpenerScroll({ payload, story, loadRoads }: { payload: PittsburghSamplePayload; story: OpenerStory; loadRoads: () => Promise<RoadSegment[]> }) {
  const sceneRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const refs = useRef<Refs>({});
  const bind = (key: string) => (node: HTMLElement | null) => { refs.current[key] = node; };
  const sg = story.signal;
  const site = story.site;
  const area = story.area;

  useEffect(() => {
    const canvas = canvasRef.current, scene = sceneRef.current;
    if (!canvas || !scene) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const el = refs.current;
    const sim = new PghAliveSim(sceneInput(payload, story));
    let dead = false, roadsAt: number | null = null;
    loadRoads().then((segs) => {
      if (dead) return;
      // Off the input path: the routing graph and ~170 routes take a few tens of ms.
      setTimeout(() => {
        if (dead) return;
        sim.setRoads(segs);
        sim.demand = 0.85; sim.projMul = 0;
        for (let i = 0; i < 600; i++) sim.step(0.4); // warm: the first frame already has traffic
        roadsAt = performance.now();
      }, 0);
    }).catch(() => { /* no network: the scene draws signals and the site only */ });

    const siteLabel = `${site.projectName} · ${site.sizeLabel}`.toUpperCase();
    const featuredLabel = sg ? sg.name.toUpperCase() : "";
    const st: SceneState = {
      pinDrop: 0, build: 0, featured: 0, losReveal: 0, losMix: 0, ring: 0, roads: 0,
      siteLabel, siteMarker: "SITE", featuredLabel,
    };
    let vw = 0, vh = 0, dpr = 1, cams = framings(sim, 1, 1);
    function resize() {
      // 1.5× is sharp on a retina screen and a screen share, at ~half the fill of 2×
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      vw = canvas!.clientWidth; vh = canvas!.clientHeight;
      canvas!.width = Math.round(vw * dpr); canvas!.height = Math.round(vh * dpr);
      cams = framings(sim, vw, vh);
      // On a phone the HUD already names the site and the signal; long canvas labels would run off the edge.
      const wide = vw >= PghAliveSim.WIDE_PX;
      st.siteLabel = wide ? siteLabel : "";
      st.featuredLabel = wide ? featuredLabel : "";
    }
    resize();
    window.addEventListener("resize", resize);

    const text = (key: string, value: string) => { const n = el[key]; if (n && n.textContent !== value) n.textContent = value; };
    // opacity as the browser normalises it ("1", "0.35"), so an unchanged value is never rewritten
    const show = (key: string, on: number) => { const n = el[key]; if (n) { const v = String(Math.round(on * 100) / 100); if (n.style.opacity !== v) n.style.opacity = v; } };
    const acts = [0, 1, 2, 3].map((i) => el[`act${i}`]);
    const rails = [0, 1, 2, 3].map((i) => el[`rail${i}`]);
    let P = 0, lastAct = -1, last = performance.now(), raf = 0;


    function hud() {
      // act 1 — the site
      st.pinDrop = Math.min(1, P / 0.05 + 0.2);
      st.build = ease((P - 0.04) / 0.12);
      sim.projMul = ease((P - 0.2) / 0.06);
      const daily = ease((P - 0.05) / 0.08);
      const gross = ease((P - 0.08) / 0.06);
      const pb = ease((P - 0.13) / 0.035);
      const na = ease((P - 0.16) / 0.035);
      const net = ease((P - 0.19) / 0.045);
      text("daily", fmtInt(site.dailyTrips * daily));
      text("gross", fmtInt(site.pmGross * gross));
      text("passby", `−${fmtInt(site.pmPassBy * pb)}`); show("rowPassby", pb > 0 ? 0.35 + 0.65 * pb : 0);
      text("nonauto", `−${fmtInt(site.pmNonAuto * na)}`); show("rowNonauto", na > 0 ? 0.35 + 0.65 * na : 0);
      text("net", fmtInt(site.pmNet * net)); show("rowNet", net > 0 ? 0.35 + 0.65 * net : 0);
      // act 2 — the signal
      st.featured = ease((P - 0.33) / 0.04) * (P < 0.62 ? 1 : 1 - ease((P - 0.62) / 0.05));
      if (sg) {
        const e = ease((P - 0.37) / 0.06), nb = ease((P - 0.43) / 0.04), b = ease((P - 0.5) / 0.05);
        sg.approaches.forEach((a, i) => {
          text(`ex${i}`, fmtVph(a.existing * e));
          text(`nb${i}`, fmtVph(a.noBuild * nb));
          text(`b${i}`, fmtVph(a.noBuild + (a.build - a.noBuild) * b));
          show(`nbc${i}`, nb > 0 ? 0.3 + 0.7 * nb : 0.15);
          show(`bc${i}`, b > 0 ? 0.3 + 0.7 * b : 0.15);
          show(`add${i}`, b);
        });
        show("hNb", nb > 0 ? 1 : 0.35); show("hB", b > 0 ? 1 : 0.35);
        show("timing", P >= 0.46 ? 1 : 0.2);
        show("dEx", P >= 0.4 ? 1 : 0.15); show("dNb", P >= 0.45 ? 1 : 0.15); show("dB", P >= 0.53 ? 1 : 0.15);
      }
      // act 3 — the study area
      st.ring = ease((P - 0.62) / 0.08);
      st.losReveal = ease((P - 0.66) / 0.07);
      st.losMix = ease((P - 0.75) / 0.08);
      text("sigs", String(Math.round(area.signals * st.losReveal)));
      const mixed = st.losMix >= 0.5;
      text("efFrom", String(area.ef.noBuild));
      text("efTo", String(Math.round(area.ef.noBuild + (area.ef.build - area.ef.noBuild) * ease((P - 0.77) / 0.05))));
      show("efTo", P >= 0.75 ? 1 : 0.2);
      text("drops", String(Math.round(area.losDrops * ease((P - 0.77) / 0.05))));
      text("scen", mixed ? `Build ${area.openingYear}` : `No-Build ${area.openingYear}`);
      sim.demand = P >= 0.6 ? 1 : 0.85;
      const act = actFor(P);
      if (act !== lastAct) {
        acts.forEach((a, i) => { if (!a) return; a.classList.remove(...(i === act ? OFF : ON)); a.classList.add(...(i === act ? ON : OFF)); });
        rails.forEach((r, i) => { if (!r) return; r.classList.toggle("text-amber-400", i === act); r.classList.toggle("text-[#5B6B85]", i !== act); });
        lastAct = act;
      }
      const hint = el.hint; if (hint) hint.style.opacity = P < 0.03 ? "1" : "0";
      const dimmer = el.dimmer; if (dimmer) dimmer.style.background = act === 3 ? "rgba(11,18,32,0.55)" : "rgba(11,18,32,0)";
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      const dtReal = Math.min(0.05, (now - last) / 1000);
      last = now;
      const r = scene!.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return; // off screen (belt and braces under the observer)
      const total = scene!.offsetHeight - window.innerHeight;
      P = Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
      hud();
      st.roads = roadsAt === null ? 0 : Math.min(1, (now - roadsAt) / 600);
      const speed = P >= 0.62 ? AREA_SPEED : SIM_SPEED;
      if (roadsAt !== null) sim.step(dtReal * speed);
      sim.draw(ctx!, vw, vh, dpr, cameraFor(P, cams, vw, vh), st);
    }
    // Only run while the scene is on screen: it starts at once (the opener
    // is the top of the page) and the observer stops and restarts it.
    let running = false;
    const start = () => { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); };
    const stop = () => { running = false; cancelAnimationFrame(raf); };
    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) start(); else stop(); })
      : null;
    io?.observe(scene);
    start();
    return () => { dead = true; stop(); io?.disconnect(); window.removeEventListener("resize", resize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  const actBase = "flex flex-col gap-3.5 transition-[opacity,transform] duration-300 ease-out opacity-0 translate-y-3 pointer-events-none motion-reduce:transition-none";
  const data = "grid gap-x-5 gap-y-3 border-t border-white/15 pt-3.5";
  const tag = (t: string) => <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-amber-400">{t}</span>;

  return (
    <section ref={sceneRef} className="relative h-[600vh] max-md:h-[470vh]" aria-label="The study, built as you scroll" data-testid="pgh-opener-scroll">
      <div className="sticky top-0 h-screen overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" aria-hidden />
        <div aria-hidden className="absolute inset-0 pointer-events-none bg-[linear-gradient(90deg,rgba(11,18,32,.94)_0%,rgba(11,18,32,.78)_28%,rgba(11,18,32,0)_48%)] max-md:bg-[linear-gradient(0deg,rgba(11,18,32,.97)_0%,rgba(11,18,32,.86)_44%,rgba(11,18,32,0)_64%)]" />
        <div ref={bind("dimmer")} aria-hidden className="absolute inset-0 pointer-events-none transition-colors duration-500" />

        <div className="absolute inset-x-0 bottom-0 md:inset-y-0 md:left-0 md:w-[460px] p-5 md:p-6 pointer-events-none">
          <div className="grid md:absolute md:left-6 md:right-6 md:top-1/2 md:-translate-y-1/2">
            {/* every act shares one grid cell so they overlap; only the active one is visible */}
            <div ref={bind("act0")} className={`${actBase} [grid-area:1/1] self-end md:self-center`} data-testid="pgh-opener-act-site">
              <div className={eyebrow}><span className="text-amber-400 font-semibold tracking-[0.06em]">01</span> The site</div>
              <h2 className="text-[26px] md:text-[38px] leading-[1.05] font-bold">The site goes up.</h2>
              <p className="text-[15px] text-[#8A9BB5] max-w-[44ch] max-md:hidden">
                Land Use {site.landUseCode}, {site.landUseName.toLowerCase()}, {site.sizeLabel}. The trips come with the building, at {site.pmRate} PM-peak trips per {site.rateUnit}{site.rateSource ? ` (${site.rateSource})` : ""}.
              </p>
              <div className={`${data} grid-cols-2`}>
                <Cell label="Daily trips" big><span ref={bind("daily")}>0</span></Cell>
                <Cell label="PM peak hour" big><span ref={bind("gross")}>0</span><Unit>gross</Unit></Cell>
              </div>
              <div className="border-t border-white/15 pt-3 font-mono text-[13px] tabular-nums space-y-1.5">
                <div ref={bind("rowPassby")} className="flex justify-between gap-4 opacity-0"><span className="text-[#8A9BB5]">Pass-by credit ({site.passByPct}%)</span><span ref={bind("passby")}>0</span></div>
                <div ref={bind("rowNonauto")} className="flex justify-between gap-4 opacity-0"><span className="text-[#8A9BB5]">Transit, walk, bike ({fmt1(100 - site.autoSharePct)}%)</span><span ref={bind("nonauto")}>0</span></div>
                <div ref={bind("rowNet")} className="flex justify-between gap-4 opacity-0 text-[15px] font-semibold text-blue-300">
                  <span>Net new vehicle trips</span>
                  <span><span ref={bind("net")}>0</span><small className="text-[11px] text-[#8A9BB5] font-normal ml-1.5">{fmtInt(site.pmIn)} in / {fmtInt(site.pmOut)} out</small></span>
                </div>
              </div>
            </div>

            <div ref={bind("act1")} className={`${actBase} [grid-area:1/1] self-end md:self-center`} data-testid="pgh-opener-act-signal">
              {sg ? (
                <>
                  <div className={eyebrow}><span className="text-amber-400 font-semibold tracking-[0.06em]">02</span> The signal · {fmt2(sg.distanceMi)} mi {sg.compass} of the site</div>
                  <h2 className="text-[24px] md:text-[34px] leading-[1.08] font-bold">{sg.name}</h2>
                  <p className="text-[15px] text-[#8A9BB5] max-w-[44ch] max-md:hidden">
                    Each loaded approach gets its volume, is grown to {area.openingYear}, then takes the project's trips. The cycle is computed from the No-Build volumes and held fixed for Build.
                  </p>
                  <table className="w-full border-t border-white/15 font-mono text-[13px] md:text-[14px] tabular-nums">
                    <thead>
                      <tr className="text-[10px] tracking-[0.12em] uppercase text-[#5B6B85]">
                        <th className="text-left font-normal pt-3 pb-1.5 align-bottom">Approach<span className="block">vph</span></th>
                        <th className="text-right font-normal pt-3 pb-1.5 align-bottom">Existing<span className="block">{area.existingYear}</span></th>
                        <th ref={bind("hNb")} className="text-right font-normal pt-3 pb-1.5 align-bottom opacity-40">No-Build<span className="block">{area.openingYear}</span></th>
                        <th ref={bind("hB")} className="text-right font-normal pt-3 pb-1.5 align-bottom opacity-40">Build<span className="block">{area.openingYear}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sg.approaches.map((a, i) => (
                        <tr key={a.dir} className="border-t border-white/10">
                          <td className="py-1.5 pr-2">
                            <span className="font-semibold">{a.dir}</span>
                            {a.source && <span className="block text-[9.5px] tracking-[0.06em] uppercase text-[#5B6B85] leading-tight">{a.source}</span>}
                          </td>
                          <td className="py-1.5 text-right"><span ref={bind(`ex${i}`)}>0</span></td>
                          <td ref={bind(`nbc${i}`)} className="py-1.5 text-right opacity-20"><span ref={bind(`nb${i}`)}>0</span></td>
                          <td ref={bind(`bc${i}`)} className="py-1.5 text-right opacity-20">
                            <span ref={bind(`b${i}`)}>0</span>
                            {a.added > 0 && <span ref={bind(`add${i}`)} className="block text-[10.5px] text-blue-300 opacity-0">+{fmtInt(a.added)} project</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div ref={bind("timing")} className="border-t border-white/15 pt-3 opacity-20 transition-opacity duration-300">
                    <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-[#5B6B85] flex items-center gap-2">Signal timing {tag("computed from volumes")}</div>
                    <div className="font-mono font-semibold tabular-nums text-[16px] md:text-[18px] mt-1">Cycle {sg.cycleSec} s · NS g/C {fmt2(sg.gNs)} · EW g/C {fmt2(sg.gEw)}</div>
                  </div>
                  <div className="border-t border-white/15 pt-3">
                    <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-[#5B6B85]">Control delay · level of service</div>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 font-mono tabular-nums">
                      {(["existing", "noBuild", "build"] as const).map((k, i) => (
                        <div key={k} ref={bind(["dEx", "dNb", "dB"][i]!)} className="opacity-15 transition-opacity duration-300 flex items-center gap-2">
                          <LosChip los={sg.los[k]} />
                          <span className="text-[15px] md:text-[17px] font-semibold">{fmt1(sg.delay[k])}<small className="text-[10px] text-[#8A9BB5] font-normal ml-0.5">s</small></span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-2 font-mono text-[9.5px] tracking-[0.1em] uppercase text-[#5B6B85]">
                      <span>Existing</span><span>No-Build</span><span>Build</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className={eyebrow}>The signal</div>
              )}
            </div>

            <div ref={bind("act2")} className={`${actBase} [grid-area:1/1] self-end md:self-center`} data-testid="pgh-opener-act-area">
              <div className={eyebrow}><span className="text-amber-400 font-semibold tracking-[0.06em]">03</span> The study area · weekday PM peak hour</div>
              <h2 className="text-[26px] md:text-[38px] leading-[1.05] font-bold">Then every signal within {area.radiusMi} miles.</h2>
              <p className="text-[15px] text-[#8A9BB5] max-w-[44ch] max-md:hidden">
                Background growth to {area.openingYear}, then the project's {fmtInt(area.netPmTrips)} net new PM-peak trips assigned outward from the site. Grades slip where the trips land — ringed on the map.
              </p>
              <div className={`${data} grid-cols-3`}>
                <Cell label="Signals" big><span ref={bind("sigs")}>0</span></Cell>
                <Cell label="Drop a grade" big><span ref={bind("drops")} className="text-amber-400">0</span></Cell>
                <Cell label="At LOS E / F" big>
                  <span className="text-[#8A9BB5]" ref={bind("efFrom")}>0</span>
                  <span className="text-[#5B6B85] text-[0.6em] mx-1">→</span>
                  <span ref={bind("efTo")} className="text-red-400">0</span>
                </Cell>
              </div>
              <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-[#8A9BB5]">Showing <span ref={bind("scen")} className="text-slate-50">No-Build</span> · E/F No-Build → Build</div>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 font-mono text-[10px] tracking-[0.08em] uppercase text-[#5B6B85]">
                <span><i className="inline-block w-2.5 h-1.5 rounded-sm align-middle mr-1.5 bg-[#DCE3EE]" />Background traffic</span>
                <span><i className="inline-block w-2.5 h-1.5 rounded-sm align-middle mr-1.5 bg-blue-500" />Project trips</span>
                <span><i className="inline-block w-2.5 h-1.5 rounded-sm align-middle mr-1.5 bg-red-500/70" />Queue</span>
                <span><i className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1.5 border border-slate-200" />Grade drop</span>
              </div>
            </div>

            <div ref={bind("act3")} className={`${actBase} [grid-area:1/1] self-end md:self-center`} data-testid="pgh-opener-act-report">
              <div className={eyebrow}><span className="text-amber-400 font-semibold tracking-[0.06em]">TIS</span> Screening report · complete</div>
              <h2 className="text-[26px] md:text-[38px] leading-[1.05] font-bold">That is the study.</h2>
              <p className="text-[15px] text-[#8A9BB5] max-w-[44ch]">
                Trip generation, distribution and assignment, every signal's delay and LOS before and after, queues, mitigation candidates and the method — section by section, below.
              </p>
              <div className="flex flex-wrap gap-2.5 pt-1">
                <a href="#study-glance" className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-slate-50 text-slate-900 hover:bg-white transition-colors">
                  Read the report <ArrowDown className="w-4 h-4" />
                </a>
                <a href="#live" className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg border border-white/25 hover:border-white/50 transition-colors">
                  Watch a signal live
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="hidden md:flex absolute right-6 top-1/2 -translate-y-1/2 flex-col gap-4 font-mono text-[10px] tracking-[0.12em] uppercase pointer-events-none" aria-hidden>
          {["01 Site", "02 Signal", "03 Study area", "Report"].map((label, i) => (
            <div key={label} ref={bind(`rail${i}`)} className={`flex items-center justify-end gap-2.5 transition-colors duration-300 ${i === 0 ? "text-amber-400" : "text-[#5B6B85]"}`}>
              {label}<span className="w-1.5 h-1.5 rounded-full bg-current" />
            </div>
          ))}
        </div>

        <div className="absolute right-4 md:right-6 bottom-3 md:bottom-4 max-md:top-20 max-md:bottom-auto text-right font-mono text-[9.5px] md:text-[10px] tracking-[0.08em] uppercase text-[#5B6B85] pointer-events-none max-w-[60%]" data-testid="pgh-opener-illustrative">
          Illustrative scene; numbers from the study · road network © OpenStreetMap contributors
        </div>

        <div ref={bind("hint")} className="absolute left-1/2 bottom-10 -translate-x-1/2 hidden md:flex items-center gap-2.5 font-mono text-[11px] tracking-[0.14em] uppercase text-[#8A9BB5] transition-opacity duration-500 pointer-events-none">
          Scroll to build the study
          <span className="inline-block w-px h-6 bg-[#8A9BB5]" aria-hidden />
          <a href="#study-glance" className="pointer-events-auto underline underline-offset-4 hover:text-slate-50">Skip</a>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// reduced motion: one still frame + the three acts' final values
// ---------------------------------------------------------------------------

function OpenerStatic({ payload, story, loadRoads }: { payload: PittsburghSamplePayload; story: OpenerStory; loadRoads: () => Promise<RoadSegment[]> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sg = story.signal, site = story.site, area = story.area;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sim = new PghAliveSim(sceneInput(payload, story));
    let dead = false, hasRoads = false;
    const st: SceneState = { pinDrop: 0, build: 1, featured: 1, losReveal: 1, losMix: 1, ring: 1, roads: 0, siteLabel: "", siteMarker: "SITE", featuredLabel: sg ? sg.name.toUpperCase() : "" };
    const paint = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vw = canvas.clientWidth, vh = canvas.clientHeight;
      if (!vw || !vh) return;
      canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
      st.roads = hasRoads ? 1 : 0;
      st.featuredLabel = vw >= PghAliveSim.WIDE_PX && sg ? sg.name.toUpperCase() : "";
      // the study area, centred (the HUD is below the frame here, not beside it)
      const s = (Math.min(vw, vh) * 0.88) / (2 * sim.radiusFt);
      const [fx, fy] = PghAliveSim.focus(vw, vh);
      const S = s;
      sim.draw(ctx, vw, vh, dpr, { x: (fx - vw / 2) / S, y: (fy - vh / 2) / S, s: S }, st);
    };
    paint();
    loadRoads().then((segs) => { if (dead) return; sim.setRoads(segs); sim.flows = []; hasRoads = true; paint(); }).catch(() => {});
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(paint) : null;
    ro?.observe(canvas);
    return () => { dead = true; ro?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  const card = "rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3";
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-12 space-y-5" data-testid="pgh-opener-static">
      <figure className="space-y-2">
        <div className="rounded-xl overflow-hidden border border-white/10">
          <canvas ref={canvasRef} className="block w-full h-[360px] sm:h-[460px]" aria-hidden />
        </div>
        <figcaption className="text-right font-mono text-[10px] tracking-[0.08em] uppercase text-[#5B6B85]" data-testid="pgh-opener-illustrative">
          Build {area.openingYear} LOS, grade drops ringed · Illustrative scene; numbers from the study · road network © OpenStreetMap contributors
        </figcaption>
      </figure>
      <div className="grid gap-4 md:grid-cols-3">
        <div className={card}>
          <div className={eyebrow}><span className="text-amber-400 font-semibold">01</span> The site</div>
          <div className="grid grid-cols-2 gap-3">
            <Cell label="Daily trips" big>{fmtInt(site.dailyTrips)}</Cell>
            <Cell label="PM peak hour" big>{fmtInt(site.pmGross)}<Unit>gross</Unit></Cell>
          </div>
          <div className="font-mono text-[13px] tabular-nums space-y-1 border-t border-white/15 pt-3">
            <div className="flex justify-between"><span className="text-[#8A9BB5]">Pass-by credit ({site.passByPct}%)</span><span>−{fmtInt(site.pmPassBy)}</span></div>
            <div className="flex justify-between"><span className="text-[#8A9BB5]">Transit, walk, bike ({fmt1(100 - site.autoSharePct)}%)</span><span>−{fmtInt(site.pmNonAuto)}</span></div>
            <div className="flex justify-between font-semibold text-blue-300"><span>Net new vehicle trips</span><span>{fmtInt(site.pmNet)}</span></div>
          </div>
        </div>
        {sg && (
          <div className={card}>
            <div className={eyebrow}><span className="text-amber-400 font-semibold">02</span> The signal</div>
            <div className="text-lg font-bold leading-snug">{sg.name}</div>
            <div className="font-mono text-[13px] tabular-nums space-y-1">
              {sg.approaches.map((a) => (
                <div key={a.dir} className="flex justify-between gap-3"><span className="font-semibold">{a.dir}</span><span>{fmtVph(a.existing)} → {fmtVph(a.noBuild)} → {fmtVph(a.build)} vph</span></div>
              ))}
            </div>
            <div className="font-mono text-[13px] border-t border-white/15 pt-3">Cycle {sg.cycleSec} s · NS g/C {fmt2(sg.gNs)} · EW g/C {fmt2(sg.gEw)}</div>
            <div className="flex items-center gap-2 font-mono text-[13px]">
              <LosChip los={sg.los.existing} /> {fmt1(sg.delay.existing)} → <LosChip los={sg.los.noBuild} /> {fmt1(sg.delay.noBuild)} → <LosChip los={sg.los.build} /> {fmt1(sg.delay.build)} s
            </div>
          </div>
        )}
        <div className={card}>
          <div className={eyebrow}><span className="text-amber-400 font-semibold">03</span> The study area</div>
          <div className="grid grid-cols-3 gap-3">
            <Cell label="Signals" big>{area.signals}</Cell>
            <Cell label="Drop a grade" big><span className="text-amber-400">{area.losDrops}</span></Cell>
            <Cell label="LOS E / F" big><span className="text-[#8A9BB5]">{area.ef.noBuild}</span><span className="text-[#5B6B85] text-[0.6em] mx-1">→</span><span className="text-red-400">{area.ef.build}</span></Cell>
          </div>
          <p className="text-[13px] text-[#8A9BB5]">No-Build → Build, {area.openingYear}, weekday PM peak hour; {fmtInt(area.netPmTrips)} net new project trips assigned.</p>
        </div>
      </div>
    </div>
  );
}
