/**
 * Home-page opener: a traffic study, built as you scroll.
 *
 * A pinned full-viewport canvas runs the traffic world in
 * `lib/study-alive-sim.ts` while scroll progress drives the camera and
 * the narration in three acts — the site (the building goes up and the
 * trips come with it), the signal (live approach counts, then the cycle
 * is computed from them), and rush hour across the whole radius (queues,
 * LOS drops, project trips spreading from the driveway) — and lands on
 * the report's metric strip with the CTAs.
 *
 * Everything the reader sees as text is real DOM (the HUD); the canvas is
 * decorative and aria-hidden. Live numbers are written straight to refs
 * so nothing re-renders sixty times a second. The scene is deliberately
 * dark in both themes (it is an aerial at night); the page below returns
 * to the normal theme.
 */
import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { StudySim, cameraFor, ease, BUILD_H, LOS_COLORS, SIGNAL_COUNT, type Los } from "../lib/study-alive-sim";
import { TOTAL_METROS, TOTAL_SIGNALS } from "../data/metro-coverage";

/** simulated seconds per real second; rush hour runs as a time-lapse so the jams form while you watch */
const SIM_SPEED = 8;
const RUSH_SPEED = 16;
const REDUCED_SPEED = 3;
/** sample program the opener narrates — LU 221 at 6.0 trips/DU/day, 240 DU */
const DAILY_TRIPS = 1440;
const PM_TRIPS = 134;

const ON = ["opacity-100", "translate-y-0", "pointer-events-auto"];
const OFF = ["opacity-0", "translate-y-3", "pointer-events-none"];
function actFor(P: number): number {
  return P < 0.34 ? 0 : P < 0.64 ? 1 : P < 0.935 ? 2 : 3;
}

type Refs = Record<string, HTMLElement | null>;

function Cell({ label, big, span, children }: { label: string; big?: boolean; span?: number; children: React.ReactNode }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-[#5B6B85]">{label}</div>
      <div className={`font-mono font-semibold tabular-nums leading-[1.1] mt-1 ${big ? "text-[26px] md:text-[34px]" : "text-[18px] md:text-[22px]"}`}>{children}</div>
    </div>
  );
}
const Unit = ({ children }: { children: React.ReactNode }) => <small className="text-[11px] text-[#8A9BB5] font-normal ml-1">{children}</small>;

export function StudyAliveHero() {
  const sceneRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const refs = useRef<Refs>({});
  const bind = (key: string) => (node: HTMLElement | null) => { refs.current[key] = node; };

  useEffect(() => {
    const canvas = canvasRef.current, scene = sceneRef.current;
    if (!canvas || !scene) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const el = refs.current;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const sim = new StudySim();
    for (let i = 0; i < 1400; i++) sim.step(0.12); // warm up: the first frame already has traffic

    let vw = 0, vh = 0, dpr = 1;
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      vw = canvas!.clientWidth; vh = canvas!.clientHeight;
      canvas!.width = Math.round(vw * dpr); canvas!.height = Math.round(vh * dpr);
    }
    resize();
    window.addEventListener("resize", resize);

    const text = (key: string, value: string) => { const n = el[key]; if (n && n.textContent !== value) n.textContent = value; };
    const acts = [0, 1, 2, 3].map((i) => el[`act${i}`]);
    const rails = [0, 1, 2, 3].map((i) => el[`rail${i}`]);
    let P = 0, lastAct = -1, computed = false, tick = 0, last = performance.now(), raf = 0;

    function hud() {
      const pinDrop = Math.min(1, P / 0.06 + 0.15);
      const buildH = BUILD_H * ease((P - 0.09) / 0.19);
      sim.projMul = ease((P - 0.24) / 0.08);
      const trips = ease((P - 0.13) / 0.16);
      text("daily", Math.round(DAILY_TRIPS * trips).toLocaleString());
      text("pm", Math.round(PM_TRIPS * trips).toLocaleString());
      const act = actFor(P);
      if (act !== lastAct) {
        acts.forEach((a, i) => { if (!a) return; a.classList.remove(...(i === act ? OFF : ON)); a.classList.add(...(i === act ? ON : OFF)); });
        rails.forEach((r, i) => { if (!r) return; r.classList.toggle("text-amber-400", i === act); r.classList.toggle("text-[#5B6B85]", i !== act); });
        lastAct = act;
      }
      const hint = el.hint; if (hint) hint.style.opacity = P < 0.03 ? "1" : "0";
      const clock = el.clock; if (clock) clock.style.opacity = P >= 0.66 && P < 0.935 ? "1" : "0";
      const m = 120 * Math.min(1, Math.max(0, (P - 0.66) / 0.26));
      sim.demand = P >= 0.62 ? 0.45 + 0.9 * Math.exp(-Math.pow((m - 90) / 40, 2)) : 0.55;
      const hh = 4 + Math.floor(m / 60), mm = Math.floor(m % 60);
      text("clockT", `${hh}:${mm < 10 ? "0" : ""}${mm} PM`);
      if (!computed && P >= 0.52) {
        computed = true; sim.retimeCenter(true);
        text("cycle", "Cycle 104 s · NS g/C 0.52 · EW 0.38");
        el.cycleTag?.classList.remove("hidden"); el.cycleNote?.classList.add("hidden");
      } else if (computed && P < 0.5) {
        computed = false; sim.retimeCenter(false);
        text("cycle", "Cycle 90 s · g/C 0.45");
        el.cycleTag?.classList.add("hidden"); el.cycleNote?.classList.remove("hidden");
      }
      const dimmer = el.dimmer; if (dimmer) dimmer.style.background = act === 3 ? "rgba(11,18,32,0.55)" : "rgba(11,18,32,0)";
      return { P, buildH, pinDrop };
    }

    function liveNumbers() {
      const m = sim.metrics();
      text("nb", String(m.nb)); text("sb", String(m.sb)); text("eb", String(m.eb)); text("wb", String(m.wb));
      text("delay", m.delay.toFixed(1));
      const los = el.los;
      if (los) { text("los", m.los); los.style.background = LOS_COLORS[m.los as Los]; }
      text("ef", String(m.atEF)); text("ef2", String(m.atEF));
      text("worst", m.worstDelay.toFixed(0)); text("worst2", m.worstDelay.toFixed(0));
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      const dtReal = Math.min(0.05, (now - last) / 1000);
      last = now;
      const r = scene!.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return; // off-screen: idle
      const total = scene!.offsetHeight - window.innerHeight;
      P = Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
      const st = hud();
      const speed = reduced ? REDUCED_SPEED : P >= 0.66 ? RUSH_SPEED : SIM_SPEED;
      const dt = dtReal * speed;
      sim.step(dt * 0.5); sim.step(dt * 0.5);
      sim.draw(ctx!, vw, vh, dpr, cameraFor(P, vw, vh), st);
      if ((tick++ & 7) === 0) liveNumbers();
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  const eyebrow = "font-mono text-[11px] leading-4 tracking-[0.18em] uppercase text-[#8A9BB5] flex items-center gap-2.5";
  const actBase = "flex flex-col gap-3.5 transition-[opacity,transform] duration-300 ease-out opacity-0 translate-y-3 pointer-events-none motion-reduce:transition-none";
  const data = "grid gap-x-5 gap-y-3 border-t border-white/15 pt-3.5";

  return (
    <div className="bg-[#0B1220] text-slate-50" data-testid="hero-study-alive">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 sm:pt-16 pb-7 flex flex-col gap-4">
        <div className={eyebrow}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" aria-hidden />
          Live state-DOT data · {TOTAL_METROS} metros · {TOTAL_SIGNALS.toLocaleString()} signals indexed
        </div>
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-[60px] font-bold leading-[1.04] max-w-[14ch] text-balance">
          A screening TIS shouldn't take{" "}
          <span className="bg-amber-300 text-slate-900 box-decoration-clone px-1.5 -mx-0.5">a week.</span>
        </h1>
        <p className="text-lg sm:text-xl text-[#8A9BB5] leading-relaxed max-w-xl">
          Keep scrolling. This is one being built — the site, the signal, the whole radius at rush hour — the way the engine sees it, in about a minute.
        </p>
      </div>

      <section ref={sceneRef} className="relative h-[560vh]" aria-label="A traffic study, built as you scroll">
        <div className="sticky top-0 h-screen overflow-hidden">
          <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" aria-hidden />
          <div aria-hidden className="absolute inset-0 pointer-events-none bg-[linear-gradient(90deg,rgba(11,18,32,.92)_0%,rgba(11,18,32,.75)_26%,rgba(11,18,32,0)_48%)] max-md:bg-[linear-gradient(0deg,rgba(11,18,32,.95)_0%,rgba(11,18,32,.8)_38%,rgba(11,18,32,0)_62%)]" />
          <div ref={bind("dimmer")} aria-hidden className="absolute inset-0 pointer-events-none transition-colors duration-500" />

          <div className="absolute inset-x-0 bottom-0 md:inset-y-0 md:left-0 md:w-[440px] p-6 pointer-events-none">
            <div className="grid md:absolute md:left-6 md:right-6 md:top-1/2 md:-translate-y-1/2">
              {/* every act shares one grid cell so they overlap; only the active one is visible */}
              <div ref={bind("act0")} className={`${actBase} [grid-area:1/1] self-end md:self-center`}>
                <div className={eyebrow}><span className="text-amber-400 font-semibold tracking-[0.06em]">§00</span> The site</div>
                <h2 className="text-[28px] md:text-[40px] leading-[1.05] font-bold">Drop a pin.</h2>
                <p className="text-[15px] text-[#8A9BB5] max-w-[42ch]">Peachtree Multifamily — 240 dwelling units on the corner lot. The building goes up, and the trips come with it, from published public-data rates.</p>
                <div className={`${data} grid-cols-2`}>
                  <Cell label="Daily trips" big><span ref={bind("daily")}>0</span></Cell>
                  <Cell label="PM peak hour" big><span ref={bind("pm")}>0</span></Cell>
                  <Cell label="Rate basis" span={2}><span className="text-xs font-medium text-[#8A9BB5] font-sans">LU 221 Mid-Rise Apartment · 6.0 trips / DU / day · SANDAG 2002, corroborated by NHTS 2017</span></Cell>
                </div>
              </div>

              <div ref={bind("act1")} className={`${actBase} [grid-area:1/1] self-end md:self-center`}>
                <div className={eyebrow}><span className="text-amber-400 font-semibold tracking-[0.06em]">§01</span> The signal</div>
                <h2 className="text-[28px] md:text-[40px] leading-[1.05] font-bold">Every approach gets counted.</h2>
                <p className="text-[15px] text-[#8A9BB5] max-w-[42ch]">Live turning-movement counts at Peachtree &amp; 5th. Then the cycle is computed from those volumes — not left at a 90-second default.</p>
                <div className={`${data} grid-cols-4`}>
                  <Cell label="NB"><span ref={bind("nb")}>0</span><Unit>vph</Unit></Cell>
                  <Cell label="SB"><span ref={bind("sb")}>0</span><Unit>vph</Unit></Cell>
                  <Cell label="EB"><span ref={bind("eb")}>0</span><Unit>vph</Unit></Cell>
                  <Cell label="WB"><span ref={bind("wb")}>0</span><Unit>vph</Unit></Cell>
                </div>
                <div className={`${data} grid-cols-2`}>
                  <Cell label="Signal timing" span={2}>
                    <span className="text-[15px]" ref={bind("cycle")}>Cycle 90 s · g/C 0.45</span>
                    <small ref={bind("cycleNote")} className="text-[11px] text-[#8A9BB5] font-normal ml-1">screening default</small>
                    <span ref={bind("cycleTag")} className="hidden ml-2 align-middle font-mono text-[10px] tracking-[0.1em] uppercase px-2 py-0.5 rounded border border-amber-400/50 text-amber-400">computed from counts</span>
                  </Cell>
                  <Cell label="Control delay"><span ref={bind("delay")}>0</span><Unit>s / veh</Unit></Cell>
                  <Cell label="Level of service"><span ref={bind("los")} className="inline-flex items-center justify-center w-[30px] h-[30px] rounded font-mono font-bold text-[15px] text-[#0B1220] bg-emerald-500 align-middle">A</span></Cell>
                </div>
              </div>

              <div ref={bind("act2")} className={`${actBase} [grid-area:1/1] self-end md:self-center`}>
                <div className={eyebrow}><span className="text-amber-400 font-semibold tracking-[0.06em]">§02</span> Rush hour</div>
                <h2 className="text-[28px] md:text-[40px] leading-[1.05] font-bold">Then the whole radius, at 5:30.</h2>
                <p className="text-[15px] text-[#8A9BB5] max-w-[42ch]">Thirteen signals, background growth applied, project trips assigned outward from the site. Queues form, grades slip, and the study says exactly where.</p>
                <div className={`${data} grid-cols-3`}>
                  <Cell label="Signals" big>{SIGNAL_COUNT}</Cell>
                  <Cell label="At LOS E / F" big><span ref={bind("ef")} className="text-red-500">0</span></Cell>
                  <Cell label="Worst delay" big><span ref={bind("worst")}>0</span><Unit>s</Unit></Cell>
                </div>
                <div className="flex flex-wrap gap-3.5 font-mono text-[10px] tracking-[0.08em] uppercase text-[#5B6B85]">
                  <span><i className="inline-block w-2.5 h-1.5 rounded-sm align-middle mr-1.5 bg-[#DCE3EE]" />Background traffic</span>
                  <span><i className="inline-block w-2.5 h-1.5 rounded-sm align-middle mr-1.5 bg-blue-500" />Project trips</span>
                  <span><i className="inline-block w-2.5 h-1.5 rounded-sm align-middle mr-1.5 bg-red-500/70" />Queue</span>
                </div>
              </div>

              <div ref={bind("act3")} className={`${actBase} [grid-area:1/1] self-end md:self-center`}>
                <div className={eyebrow}><span className="text-amber-400 font-semibold tracking-[0.06em]">TIS</span> Screening report · complete</div>
                <h2 className="text-[28px] md:text-[40px] leading-[1.05] font-bold">That took about a minute.</h2>
                <p className="text-[15px] text-[#8A9BB5] max-w-[42ch]">Trip generation, distribution, every signal in the radius, delay and LOS before and after, mitigations, methodology — footnoted, PE-ready, as a PDF.</p>
                <div className={`${data} grid-cols-3`}>
                  <Cell label="Signals" big>{SIGNAL_COUNT}</Cell>
                  <Cell label="At LOS E / F" big><span ref={bind("ef2")} className="text-red-500">0</span></Cell>
                  <Cell label="Worst delay" big><span ref={bind("worst2")}>0</span><Unit>s</Unit></Cell>
                </div>
                <div className="flex flex-wrap gap-2.5 pt-1">
                  <Link href="/demo" className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-slate-50 text-slate-900 hover:bg-white transition-colors" data-testid="link-hero-demo">
                    Try a live demo <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                  <Link href="/signup?plan=growth" className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg border border-white/25 hover:border-white/50 transition-colors" data-testid="link-hero-trial">
                    Start 14-day trial
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div ref={bind("clock")} className="absolute right-4 md:right-6 top-20 text-right font-mono opacity-0 transition-opacity duration-300 pointer-events-none" aria-live="off">
            <div ref={bind("clockT")} className="text-[28px] md:text-[56px] font-semibold leading-none tracking-tight tabular-nums">4:00 PM</div>
            <div className="text-[10px] tracking-[0.16em] uppercase text-[#5B6B85] mt-1.5">Background + project · weekday</div>
          </div>

          <div className="hidden md:flex absolute right-6 top-1/2 -translate-y-1/2 flex-col gap-4 font-mono text-[10px] tracking-[0.12em] uppercase pointer-events-none" aria-hidden>
            {["00 Site", "01 Signal", "02 Rush hour", "Report"].map((label, i) => (
              <div key={label} ref={bind(`rail${i}`)} className={`flex items-center justify-end gap-2.5 transition-colors duration-300 ${i === 0 ? "text-amber-400" : "text-[#5B6B85]"}`}>
                {label}<span className="w-1.5 h-1.5 rounded-full bg-current" />
              </div>
            ))}
          </div>

          <div ref={bind("hint")} className="absolute left-1/2 bottom-6 -translate-x-1/2 hidden md:flex items-center gap-2.5 font-mono text-[11px] tracking-[0.14em] uppercase text-[#8A9BB5] transition-opacity duration-500 pointer-events-none">
            Scroll to build the study
            <span className="inline-block w-px h-6 bg-[#8A9BB5]" aria-hidden />
            <a href="#after-hero" className="pointer-events-auto underline underline-offset-4 hover:text-slate-50">Skip</a>
          </div>
        </div>
      </section>
    </div>
  );
}
