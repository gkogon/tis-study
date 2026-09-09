/**
 * The home-page opener's traffic world: a 5×5 street grid with 13
 * signalized intersections, a car-following model with two-phase signal
 * control, and the corner-lot site the study is about. Pure TypeScript —
 * no DOM at construction time — so `scripts/check-study-alive-sim.mjs`
 * can run it headless under plain node. `draw()` is the only method that
 * touches a canvas context.
 *
 * Units are unlabeled world units (roughly feet at the scale drawn).
 * Speeds, headways and the LOS delay bands are the engine's own rules:
 * saturation headway ≈ 2 s, control-delay LOS A ≤10 s … F >80 s.
 */

export const NS: number[] = [-1000, -500, 0, 500, 1000]; // x of north–south streets
export const EW: number[] = [-800, -400, 0, 400, 800]; // y of east–west streets
const SIGNAL_KEYS = [
  "0,-800", "0,-400", "0,0", "0,400", "0,800",
  "-1000,0", "-500,0", "500,0", "1000,0",
  "500,400", "-500,-400", "500,-400", "-500,400",
];
export const SIGNAL_COUNT = SIGNAL_KEYS.length;

const CAR_L = 14;
const CAR_W = 7;
const VMAX = 44;
const ACC = 7;
const BRAKE = 13;
const GAP = 7;
/** Tunable dynamics. headwayS is the desired time headway behind the car ahead — it sets saturation flow (≈ 1 / (headwayS + 0.5 s)). */
export const TUNING = { headwayS: 1.8 };

export const SITE = { x0: 60, y0: -260, x1: 260, y1: -60, cx: 160, cy: -160 };
export const BUILD_H = 70;

export type Los = "A" | "B" | "C" | "D" | "E" | "F";
export type Approach = "NB" | "SB" | "EB" | "WB";
export const LOS_COLORS: Record<Los, string> = {
  A: "#22C55E", B: "#22C55E", C: "#EAB308", D: "#F59E0B", E: "#EF4444", F: "#DC2626",
};

export function losForDelay(d: number): Los {
  return d <= 10 ? "A" : d <= 20 ? "B" : d <= 35 ? "C" : d <= 55 ? "D" : d <= 80 ? "E" : "F";
}

type Car = { s: number; v: number; proj: boolean; sig: Signal | null; wait: number; sl: number; tint: number };
type Group = { ax: 0 | 1; li: number; dir: 1 | -1; cars: Car[]; base: number };
type Signal = {
  key: string; x: number; y: number; C: number; gNS: number; off: number;
  delays: number[]; counts: Record<Approach, number[]>; delay: number; los: Los; q: Record<Approach, number>;
};
type Phase = "NS" | "NSy" | "AR" | "EW" | "EWy";
type Block = { x: number; y: number; w: number; h: number; t: number };

export type Camera = { x: number; y: number; s: number };
export type SceneState = { P: number; buildH: number; pinDrop: number };
export type CenterMetrics = {
  nb: number; sb: number; eb: number; wb: number; delay: number; los: Los;
  atEF: number; worstDelay: number;
};

/** road half-width and lane-centre offset; index 2 is the arterial on both axes */
const hw = (li: number): number => (li === 2 ? 34 : 26);
const lane = (li: number): number => (li === 2 ? 16 : 12);

export function ease(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function approachName(ax: 0 | 1, dir: 1 | -1): Approach {
  return ax === 0 ? (dir === 1 ? "SB" : "NB") : dir === 1 ? "EB" : "WB";
}

function makeBlocks(): Block[] {
  const blocks: Block[] = [];
  let s = 11;
  const r = (): number => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const x0 = (NS[i] ?? 0) + hw(i) + 22, x1 = (NS[i + 1] ?? 0) - hw(i + 1) - 22;
      const y0 = (EW[j] ?? 0) + hw(j) + 22, y1 = (EW[j + 1] ?? 0) - hw(j + 1) - 22;
      let x = x0;
      while (x < x1 - 40) {
        const w = Math.min(x1 - x, 60 + r() * 120);
        let y = y0;
        while (y < y1 - 40) {
          const h = Math.min(y1 - y, 50 + r() * 110);
          const isSiteBlock = i === 2 && j === 1; // NE quadrant of the centre: the parcel lives here
          if (!isSiteBlock && r() > 0.18) blocks.push({ x: x + 6, y: y + 6, w: w - 12, h: h - 12, t: r() });
          y += h + 10;
        }
        x += w + 12;
      }
    }
  }
  return blocks;
}

/** Camera for a scroll progress P in [0, 1] on a viewport vw×vh. */
export function cameraFor(P: number, vw: number, vh: number): Camera {
  const s1 = Math.max(0.85, Math.min(2.1, Math.min(vw * 0.5, vh * 0.75) / 250));
  const s2 = Math.max(0.36, Math.min(1.15, Math.min(vw * 0.52, vh * 0.8) / 560));
  const s3 = Math.max(vw < 860 ? 0.17 : 0.22, Math.min(vw * 0.6, vh * 0.86) / 2300);
  const F1: [number, number] = [SITE.cx, SITE.cy];
  const F2: [number, number] = [80, -70];
  const F3: [number, number] = [40, -20];
  if (P < 0.3) return { x: F1[0], y: F1[1], s: s1 };
  if (P < 0.42) {
    const t = ease((P - 0.3) / 0.12);
    return { x: lerp(F1[0], F2[0], t), y: lerp(F1[1], F2[1], t), s: Math.exp(lerp(Math.log(s1), Math.log(s2), t)) };
  }
  if (P < 0.6) return { x: F2[0], y: F2[1], s: s2 };
  if (P < 0.72) {
    const t = ease((P - 0.6) / 0.12);
    return { x: lerp(F2[0], F3[0], t), y: lerp(F2[1], F3[1], t), s: Math.exp(lerp(Math.log(s2), Math.log(s3), t)) };
  }
  return { x: F3[0], y: F3[1], s: s3 };
}

export class StudySim {
  readonly sigs: Signal[];
  readonly center: Signal;
  private readonly sigByKey: Map<string, Signal>;
  private readonly groups: Group[];
  private readonly blocks: Block[];
  simT = 0;
  demand = 0.55;
  projMul = 0;
  private seed = 7;

  constructor() {
    this.sigs = SIGNAL_KEYS.map((key, i) => {
      const [xs, ys] = key.split(",");
      return {
        key, x: Number(xs), y: Number(ys), C: 90, gNS: 0.45, off: (i * 23) % 90, delays: [],
        counts: { NB: [], SB: [], EB: [], WB: [] }, delay: 0, los: "A" as Los, q: { NB: 0, SB: 0, EB: 0, WB: 0 },
      };
    });
    this.sigByKey = new Map(this.sigs.map((s) => [s.key, s]));
    const center = this.sigByKey.get("0,0");
    if (!center) throw new Error("centre signal missing");
    this.center = center;
    this.groups = [];
    for (const ax of [0, 1] as const) {
      for (let li = 0; li < 5; li++) {
        for (const dir of [1, -1] as const) {
          this.groups.push({ ax, li, dir, cars: [], base: li === 2 ? (ax === 0 ? 0.21 : 0.17) : 0.06 });
        }
      }
    }
    this.blocks = makeBlocks();
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private group(ax: 0 | 1, li: number, dir: 1 | -1): Group {
    const g = this.groups[ax * 10 + li * 2 + (dir === 1 ? 0 : 1)];
    if (!g) throw new Error("bad group");
    return g;
  }

  private phase(sig: Signal, t: number): Phase {
    const u = (t + sig.off) % sig.C, g = sig.gNS * sig.C;
    if (u < g - 5) return "NS";
    if (u < g - 1) return "NSy";
    if (u < g) return "AR";
    if (u < sig.C - 5) return "EW";
    if (u < sig.C - 1) return "EWy";
    return "AR";
  }

  private light(sig: Signal, ax: 0 | 1, t: number): "G" | "Y" | "R" {
    const p = this.phase(sig, t);
    if (ax === 0) return p === "NS" ? "G" : p === "NSy" ? "Y" : "R";
    return p === "EW" ? "G" : p === "EWy" ? "Y" : "R";
  }

  private spawn(g: Group, s: number, proj: boolean): boolean {
    for (const c of g.cars) if (Math.abs(c.s - s) < CAR_L + GAP + 30) return false;
    g.cars.push({ s, v: proj ? 12 : VMAX * (0.7 + 0.3 * this.rnd()), proj, sig: null, wait: 0, sl: 0, tint: 0.75 + 0.25 * this.rnd() });
    return true;
  }

  /** Switch the centre signal between the screening default and the timing computed from its counts. */
  retimeCenter(computed: boolean): void {
    this.center.C = computed ? 104 : 90;
    this.center.gNS = computed ? 0.52 : 0.45;
  }

  carCount(): { total: number; project: number } {
    let total = 0, project = 0;
    for (const g of this.groups) for (const c of g.cars) { total++; if (c.proj) project++; }
    return { total, project };
  }

  vph(sig: Signal, ap: Approach): number {
    return Math.round(sig.counts[ap].length * 12);
  }

  metrics(): CenterMetrics {
    let atEF = 0, worstDelay = 0;
    for (const s of this.sigs) {
      if (s.los === "E" || s.los === "F") atEF++;
      if (s.delay > worstDelay) worstDelay = s.delay;
    }
    const c = this.center;
    return { nb: this.vph(c, "NB"), sb: this.vph(c, "SB"), eb: this.vph(c, "EB"), wb: this.vph(c, "WB"), delay: c.delay, los: c.los, atEF, worstDelay };
  }

  step(dt: number): void {
    this.simT += dt;
    const t = this.simT;
    for (const g of this.groups) {
      const mult = g.li === 2 ? 1.12 : 1;
      if (this.rnd() < g.base * this.demand * mult * dt) this.spawn(g, g.ax === 0 ? -2300 * g.dir : -2500 * g.dir, false);
    }
    if (this.projMul > 0) {
      const r = 0.055 * this.projMul * Math.max(this.demand, 0.45) * dt;
      if (this.rnd() < r) this.spawn(this.group(1, 2, -1), 200, true);
      if (this.rnd() < r * 0.6) this.spawn(this.group(1, 2, 1), 230, true);
      if (this.rnd() < r * 0.7) this.spawn(this.group(0, 2, -1), -200, true);
      if (this.rnd() < r * 0.5) this.spawn(this.group(0, 2, 1), -230, true);
    }
    for (const g of this.groups) {
      const { ax, li, dir } = g;
      const cross = ax === 0 ? EW : NS;
      g.cars.sort((a, b) => dir * (b.s - a.s)); // leader first
      for (let i = 0; i < g.cars.length; i++) {
        const c = g.cars[i];
        if (!c) continue;
        let d = Infinity;
        const ahead = i > 0 ? g.cars[i - 1] : undefined;
        if (ahead) d = Math.min(d, dir * (ahead.s - c.s) - CAR_L - GAP - c.v * TUNING.headwayS);
        let bestK = -1, bestSl = 0, bestD = Infinity;
        for (let k = 0; k < 5; k++) {
          const cc = cross[k] ?? 0;
          const sl = cc - dir * (hw(k) + 8), dd = dir * (sl - c.s);
          if (dd > -4 && dd < bestD) { bestD = dd; bestK = k; bestSl = sl; }
        }
        if (bestK >= 0) {
          const cc = cross[bestK] ?? 0;
          const key = ax === 0 ? `${NS[li] ?? 0},${cc}` : `${cc},${NS[li] ?? 0}`;
          const sig = this.sigByKey.get(key);
          if (sig) {
            if (c.sig !== sig && bestD > 0 && bestD < 700) { c.sig = sig; c.wait = 0; c.sl = bestSl; }
            const st = this.light(sig, ax, t);
            const mustStop = st === "R" || (st === "Y" && bestD > 28);
            if (mustStop && bestD > -2) d = Math.min(d, bestD);
          }
        }
        let vt = VMAX;
        if (d < Infinity) vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * BRAKE * (d - 1))));
        if (vt > c.v) c.v = Math.min(vt, c.v + ACC * dt); else c.v = Math.max(vt, c.v - BRAKE * dt);
        if (d <= 1) c.v = 0;
        if (c.sig && c.v < 12) c.wait += dt; // crawling in a queue is delay too
        c.s += dir * c.v * dt;
        if (c.sig && dir * (c.s - c.sl) > 0) {
          const sig = c.sig;
          sig.delays.push(c.wait);
          if (sig.delays.length > 28) sig.delays.shift();
          sig.counts[approachName(ax, dir)].push(t);
          c.sig = null;
          c.wait = 0;
        }
      }
      g.cars = g.cars.filter((c) => Math.abs(c.s) < 2600);
    }
    for (const sig of this.sigs) {
      const n = sig.delays.length;
      const avg = n ? sig.delays.reduce((a, b) => a + b, 0) / n : 0;
      sig.delay += (avg - sig.delay) * Math.min(1, dt * 0.15);
      sig.los = losForDelay(sig.delay);
      for (const ap of ["NB", "SB", "EB", "WB"] as const) {
        const arr = sig.counts[ap];
        while (arr.length && t - (arr[0] ?? 0) > 300) arr.shift();
      }
      sig.q = { NB: 0, SB: 0, EB: 0, WB: 0 };
    }
    for (const g of this.groups) {
      for (const c of g.cars) {
        if (c.sig && c.v < 3) {
          const ap = approachName(g.ax, g.dir), L = Math.abs(c.sl - c.s) + CAR_L;
          if (L > c.sig.q[ap]) c.sig.q[ap] = L;
        }
      }
    }
  }

  // ------------------------------------------------------------------ draw
  private static li(sig: Signal, axis: 0 | 1): number {
    return axis === 0 ? NS.indexOf(sig.x) : EW.indexOf(sig.y);
  }

  draw(ctx: CanvasRenderingContext2D, vw: number, vh: number, dpr: number, cam: Camera, st: SceneState): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0B1220";
    ctx.fillRect(0, 0, vw, vh);
    const wide = vw >= 860;
    const cx = wide ? vw * 0.5 + Math.min(220, vw * 0.16) : vw * 0.5;
    const cy = wide ? vh * 0.5 : vh * 0.4;
    const S = cam.s;
    ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * (cx - cam.x * S), dpr * (cy - cam.y * S));
    const P = st.P, act3 = P >= 0.62;

    ctx.fillStyle = "#121B2C";
    for (const b of this.blocks) ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (const b of this.blocks) if (b.t > 0.5) ctx.fillRect(b.x, b.y, b.w, 6);

    ctx.fillStyle = "#1B2536";
    for (let i = 0; i < 5; i++) ctx.fillRect((NS[i] ?? 0) - hw(i), -2700, hw(i) * 2, 5400);
    for (let j = 0; j < 5; j++) ctx.fillRect(-2700, (EW[j] ?? 0) - hw(j), 5400, hw(j) * 2);
    ctx.strokeStyle = "#2B3A52";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([18, 22]);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) { ctx.moveTo(NS[i] ?? 0, -2700); ctx.lineTo(NS[i] ?? 0, 2700); }
    for (let j = 0; j < 5; j++) { ctx.moveTo(-2700, EW[j] ?? 0); ctx.lineTo(2700, EW[j] ?? 0); }
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const x = NS[i] ?? 0, y = EW[j] ?? 0;
        ctx.fillStyle = "#1B2536";
        ctx.fillRect(x - hw(i), y - hw(j), hw(i) * 2, hw(j) * 2);
        if (this.sigByKey.has(`${x},${y}`)) {
          ctx.fillStyle = "#3B4C66";
          ctx.fillRect(x - hw(i), y - hw(j) - 9, hw(i), 3);
          ctx.fillRect(x, y + hw(j) + 6, hw(i), 3);
          ctx.fillRect(x - hw(i) - 9, y, 3, hw(j));
          ctx.fillRect(x + hw(i) + 6, y - hw(j), 3, hw(j));
        }
      }
    }

    if (P > 0.64) {
      ctx.strokeStyle = `rgba(59,130,246,${(0.55 * ease((P - 0.64) / 0.1)).toFixed(3)})`;
      ctx.lineWidth = 2 / S;
      ctx.setLineDash([10 / S, 10 / S]);
      ctx.beginPath();
      ctx.arc(SITE.cx, SITE.cy, 1180 * ease((P - 0.64) / 0.14), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const sig of this.sigs) {
      ctx.fillStyle = `rgba(239,68,68,${act3 ? 0.42 : 0.28})`;
      const i = StudySim.li(sig, 0), j = StudySim.li(sig, 1), lw = lane(2) * 1.5;
      if (sig.q.SB > 0) ctx.fillRect(sig.x - lane(i) - lw / 2, sig.y - hw(j) - 8 - sig.q.SB, lw, sig.q.SB);
      if (sig.q.NB > 0) ctx.fillRect(sig.x + lane(i) - lw / 2, sig.y + hw(j) + 8, lw, sig.q.NB);
      if (sig.q.EB > 0) ctx.fillRect(sig.x - hw(i) - 8 - sig.q.EB, sig.y + lane(j) - lw / 2, sig.q.EB, lw);
      if (sig.q.WB > 0) ctx.fillRect(sig.x + hw(i) + 8, sig.y - lane(j) - lw / 2, sig.q.WB, lw);
    }

    this.drawSite(ctx, cam, st);

    for (const g of this.groups) {
      const { ax, li, dir } = g, off = lane(li);
      for (const c of g.cars) {
        let x: number, y: number, w: number, h: number;
        if (ax === 0) { x = (NS[li] ?? 0) - dir * off; y = c.s; w = CAR_W; h = CAR_L; }
        else { x = c.s; y = (EW[li] ?? 0) + dir * off; w = CAR_L; h = CAR_W; }
        if (c.proj) {
          ctx.fillStyle = "rgba(59,130,246,0.28)";
          ctx.fillRect(x - w / 2 - 5, y - h / 2 - 5, w + 10, h + 10);
          ctx.fillStyle = "#60A5FA";
        } else {
          ctx.fillStyle = `rgba(220,227,238,${c.tint.toFixed(2)})`;
        }
        ctx.fillRect(x - w / 2, y - h / 2, w, h);
        ctx.fillStyle = "#FBBF24";
        if (ax === 0) { const fy = y + dir * (h / 2 - 1); ctx.fillRect(x - 3, fy - 1, 2, 2); ctx.fillRect(x + 1, fy - 1, 2, 2); }
        else { const fx = x + dir * (w / 2 - 1); ctx.fillRect(fx - 1, y - 3, 2, 2); ctx.fillRect(fx - 1, y + 1, 2, 2); }
      }
    }

    for (const sig of this.sigs) {
      const ph = this.phase(sig, this.simT);
      const nsG = ph === "NS" || ph === "NSy", ewG = ph === "EW" || ph === "EWy";
      const i = StudySim.li(sig, 0), j = StudySim.li(sig, 1), r = 3.2;
      const nsCol = nsG ? (ph === "NSy" ? "#FBBF24" : "#22C55E") : "#EF4444";
      const ewCol = ewG ? (ph === "EWy" ? "#FBBF24" : "#22C55E") : "#EF4444";
      this.dot(ctx, sig.x - hw(i) + 6, sig.y - hw(j) + 6, r, nsCol);
      this.dot(ctx, sig.x + hw(i) - 6, sig.y + hw(j) - 6, r, nsCol);
      this.dot(ctx, sig.x + hw(i) - 6, sig.y - hw(j) + 6, r, ewCol);
      this.dot(ctx, sig.x - hw(i) + 6, sig.y + hw(j) - 6, r, ewCol);
      const show = sig === this.center
        ? ease((P - 0.44) / 0.06) * (P < 0.6 ? 1 : ease((P - 0.74) / 0.05))
        : ease((P - 0.74) / 0.06);
      if (show > 0.01) {
        const bw = 24 / S, bh = 24 / S, bx = sig.x + hw(i) + 10, by = sig.y - hw(j) - 10 - bh;
        ctx.globalAlpha = show;
        ctx.fillStyle = LOS_COLORS[sig.los];
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = "#0B1220";
        ctx.font = `700 ${15 / S}px "JetBrains Mono", Menlo, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sig.los, bx + bw / 2, by + bh / 2 + 1 / S);
        ctx.globalAlpha = 1;
      }
    }
  }

  private dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawSite(ctx: CanvasRenderingContext2D, cam: Camera, st: SceneState): void {
    const { x0, y0, x1, y1 } = SITE, h = st.buildH;
    ctx.fillStyle = h > 0 ? "#141E31" : "#101827";
    ctx.fillRect(x0 - 10, y0 - 10, x1 - x0 + 20, y1 - y0 + 20);
    ctx.strokeStyle = `rgba(251,191,36,${(0.9 - 0.7 * Math.min(1, h / BUILD_H)).toFixed(2)})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(x0 - 10, y0 - 10, x1 - x0 + 20, y1 - y0 + 20);
    ctx.setLineDash([]);
    ctx.fillStyle = "#1B2536";
    ctx.fillRect(SITE.cx - 12, y1 + 10, 24, -hw(2) - (y1 + 10));
    if (h > 0.5) {
      const ox = -0.3 * h, oy = -0.45 * h;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.moveTo(x1, y0); ctx.lineTo(x1 + 0.35 * h, y0 + 0.5 * h); ctx.lineTo(x1 + 0.35 * h, y1 + 0.5 * h);
      ctx.lineTo(x0 + 0.35 * h, y1 + 0.5 * h); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#1E2A3F";
      ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1 + ox, y1 + oy); ctx.lineTo(x1 + ox, y0 + oy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#26344C";
      ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1 + ox, y1 + oy); ctx.lineTo(x0 + ox, y1 + oy); ctx.closePath(); ctx.fill();
      const rows = Math.floor(h / 9), glow = Math.min(1, h / BUILD_H);
      ctx.fillStyle = `rgba(253,230,138,${(0.55 * glow).toFixed(2)})`;
      for (let r = 0; r < rows; r++) {
        const tt = (r + 0.5) / (h / 9);
        for (let k = 0; k < 9; k++) {
          const u = (k + 0.5) / 9;
          ctx.fillRect(x0 + u * (x1 - x0) + ox * tt - 3, y1 + oy * tt - 2, 6, 3);
        }
      }
      ctx.fillStyle = "#34435E";
      ctx.fillRect(x0 + ox, y0 + oy, x1 - x0, y1 - y0);
      ctx.strokeStyle = "#4B5B78";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + ox, y0 + oy, x1 - x0, y1 - y0);
      ctx.fillStyle = "#2C3A52";
      ctx.fillRect(x0 + ox + 30, y0 + oy + 30, 70, 50);
      ctx.fillRect(x0 + ox + 120, y0 + oy + 90, 50, 60);
      if (h > 40) {
        ctx.globalAlpha = Math.min(1, (h - 40) / 20);
        ctx.fillStyle = "#F1F5F9";
        ctx.font = `600 ${Math.max(11, 13 / Math.max(0.6, cam.s))}px "JetBrains Mono", Menlo, monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText("PEACHTREE MULTIFAMILY · 240 DU", x0 + ox, y0 + oy - 8);
        ctx.globalAlpha = 1;
      }
    }
    if (st.pinDrop > 0) {
      const dy = (1 - ease(st.pinDrop)) * 260;
      const a = Math.min(1, st.pinDrop * 3) * (1 - Math.min(1, h / 30));
      if (a > 0) {
        ctx.globalAlpha = a;
        ctx.fillStyle = "#FBBF24";
        ctx.beginPath();
        ctx.arc(SITE.cx, SITE.cy - 34 - dy, 14, Math.PI * 0.75, Math.PI * 2.25);
        ctx.lineTo(SITE.cx, SITE.cy - dy);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#0B1220";
        ctx.beginPath();
        ctx.arc(SITE.cx, SITE.cy - 34 - dy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
}
