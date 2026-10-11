// The spray can. Paint leaves the nozzle as a cone of fine droplets; where
// the cone meets a surface it lands around the axis with a gaussian spread:
// a dense, soft-edged core, and single larger droplets flung further out
// (the speckle of overspray). The can puts out a steady flow, so close up
// the same paint lands on a smaller spot (a tight, saturated line that soon
// runs) and from further back it is a wide, light mist; past a few metres
// little of it arrives at all. Lingering piles paint up: the stroke keeps
// track of where it has built up and, past a load, starts runs from the
// lower edge of the wet paint (the classic graffiti drip).
//
// The core is laid analytically: each frame the axis sweeps a segment (from
// where it was to where it is) and every pixel gets that segment's dose of
// a gaussian, so a line stays smooth however fast the can moves. Per-pixel
// grain keeps a light pass dusty. Droplets are drawn once a frame, in metres
// around the axis, and both are rasterized into every surface the cone
// covers (a work's overlay and the wall patch around it), so the mist
// crosses a frame edge unbroken. The work per frame is bounded: past the
// pixel budget a random share of the pixels is drawn, each with more paint.

import * as THREE from "three";
import { clamp, gauss, hash2, rng, smoothstep, type Rng } from "./noise";
import type { DripSpec, Receiver, RGB } from "./splat";
import { rectUnion, type Rect } from "./surface";

/** Paint the can puts out (m² of full cover a second) per metre of its nominal cone radius. */
const FLOW = 1.5;
/** The core's spread (σ) as a share of the cone's radius. */
const SPREAD = 0.42;
/** The core is laid out to this many σ, fading over its outer part (no ring where it stops). */
const REACH = 3;
/** Fresh spray paint is thin and matte: barely wet (wetness is what turns glossy). */
const WET = 0.2;
/** Thickness laid per unit of cover: the core's film, a droplet of speckle. */
const THICK = { core: 0.025, speck: 0.08 };
/** Share of the paint that arrives as speckle. */
const SPECK = 0.1;
/** Runs: cover (in full layers) before the first, then each next one after a little more. */
const RUN_AT = 6;
const RUN_EVERY = 2.2;
const RUNS_PER_SPOT = 6;
const MAX_DROPS = 512;
const MAX_SPOTS = 64;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

export interface SprayLimits {
  /** speckle droplets drawn per frame */
  dots: number;
  /** pixels touched per frame (over every surface the cone covers) */
  pixels: number;
  /** runs one stroke may start */
  runs: number;
}

export const SPRAY_LIMITS: Record<"high" | "low", SprayLimits> = {
  high: { dots: 400, pixels: 40_000, runs: 28 },
  low: { dots: 150, pixels: 11_000, runs: 12 },
};

/** Where this frame's mist lands: a receiver whose origin is on the cone's axis. */
export interface SprayTarget {
  rcv: Receiver;
  /** fade out toward the clip edge (a decal cell's border is not a real edge) */
  feather: boolean;
}

/** A place on the surface where paint is building up (world space). */
interface Spot {
  p: THREE.Vector3;
  load: number;
  next: number;
  runs: number;
}

/** Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
function erf(x: number): number {
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return x < 0 ? -y : y;
}

const _d = new THREE.Vector3();

export class SprayCan {
  readonly color: RGB;
  private readonly radius: number;
  private readonly flow: number;
  private readonly lim: SprayLimits;
  private readonly r: Rng;
  private readonly seed: number;
  private frame = 0;
  // this frame's speckle, metres around the axis
  private readonly dx = new Float32Array(MAX_DROPS);
  private readonly dy = new Float32Array(MAX_DROPS);
  private readonly dr = new Float32Array(MAX_DROPS);
  private readonly tone = new Float32Array(MAX_DROPS);
  private n = 0;
  private spots: Spot[] = [];
  private runs = 0;

  /** @param radius the cone's radius where it lands at arm's length (m) */
  constructor(color: RGB, radius: number, seed: number, lim: SprayLimits) {
    this.color = color;
    this.radius = radius;
    this.flow = FLOW * radius;
    this.lim = lim;
    this.seed = seed;
    this.r = rng(seed);
  }

  /** The core's spread (σ, m) on a surface `dist` metres away: the cone opens with distance. */
  sigma(dist: number): number {
    return this.radius * SPREAD * clamp(dist / 1.2, 0.5, 2.5);
  }

  /** How much of the paint reaches a surface `dist` metres away (it drifts off on the way). */
  carry(dist: number): number {
    return 1 - smoothstep(4.5, 9, dist);
  }

  /** Layers of cover a second on the axis. */
  peak(sigma: number): number {
    return this.flow / (2 * Math.PI * sigma * sigma);
  }

  /** How far from the axis paint lands (m): what a target must cover. */
  reach(sigma: number): number {
    return sigma * REACH;
  }

  /**
   * One frame of mist (`dt` seconds, already scaled by how much arrives),
   * the axis having swept here from `back` (m, splat space around the
   * current point; null: it did not move or just started). Returns the
   * pixels changed in each target (the caller marks them).
   */
  spray(targets: SprayTarget[], sigma: number, dt: number, back: { x: number; y: number } | null): (Rect | null)[] {
    this.frame++;
    if (dt <= 0 || targets.length === 0) return targets.map(() => null);
    const R = sigma * REACH;
    const bx = back?.x ?? 0;
    const by = back?.y ?? 0;
    // the core's footprint over every target, against the budget
    let px = 0;
    for (const t of targets) {
      const b = this.bounds(t.rcv, bx, by, R);
      if (b) px += (b.x1 - b.x0) * (b.y1 - b.y0);
    }
    const keep = Math.min(1, this.lim.pixels / Math.max(1, px));
    this.speckle(sigma, dt);
    const dose = (this.flow * dt * (1 - SPECK)) / (2 * Math.PI * sigma * sigma);
    return targets.map((t) => rectUnion(this.core(t, sigma, dose, bx, by, keep), this.lay(t)));
  }

  /**
   * Paint building up where the axis lingers (or passes again): returns the
   * runs to start now, in splat space around `at` (+y down the surface).
   */
  build(at: THREE.Vector3, right: THREE.Vector3, down: THREE.Vector3, sigma: number, dt: number): DripSpec[] {
    const dose = this.peak(sigma) * dt;
    const s2 = sigma * sigma;
    let nearest = Infinity;
    for (const s of this.spots) {
      const d2 = s.p.distanceToSquared(at);
      if (d2 < nearest) nearest = d2;
      if (d2 < 9 * s2) s.load += dose * Math.exp(-d2 / (2 * s2));
    }
    if (nearest > 0.25 * s2) {
      this.spots.push({ p: at.clone(), load: dose, next: RUN_AT, runs: 0 });
      if (this.spots.length > MAX_SPOTS) this.spots.shift();
    }
    const out: DripSpec[] = [];
    const r = this.r;
    for (const s of this.spots) {
      if (s.load < s.next || s.runs >= RUNS_PER_SPOT || this.runs >= this.lim.runs) continue;
      // each further run takes a little longer to gather
      s.next += RUN_EVERY * (1 + 0.5 * s.runs);
      _d.subVectors(s.p, at);
      // from the lower edge of the saturated paint (it widens as the load
      // grows), narrow, spread under it; later runs carry more
      const edge = sigma * Math.sqrt(2 * Math.log(Math.max(1.5, s.load / 2.5)));
      const across = clamp(gauss(r) * 2 * sigma, -0.85 * edge, 0.85 * edge);
      const w = clamp(0.1 * sigma + 0.002, 0.003, 0.008) * (0.8 + 0.4 * r());
      const len = clamp((0.04 + 0.16 * r() * r()) * (1 + 0.3 * s.runs) * clamp(sigma / 0.03, 0.6, 1.6), 0.02, 0.35);
      out.push({
        x: _d.dot(right) + across,
        y: _d.dot(down) + Math.sqrt(edge * edge - across * across) * (0.75 + 0.2 * r()),
        w,
        len,
        tau: 1 + 1.5 * r() + len * 8,
        delay: 0.05 + 0.2 * r(),
        bead: w * (0.7 + 0.15 * r()),
        color: this.color,
        tMax: 0.18,
        alpha: 1,
        glaze: 0,
        trailAlpha: 1,
        trailStreak: 0,
        wobble: w * (0.1 + 0.25 * r()),
        seed: (this.seed ^ Math.floor(r() * 0x7fffffff)) >>> 0,
      });
      s.runs++;
      this.runs++;
    }
    return out;
  }

  // -------------------------------------------------------------- core

  /** Pixels within `R` of the segment (bx, by) → (0, 0), on the target. */
  private bounds(rcv: Receiver, bx: number, by: number, R: number): Rect | null {
    const c = rcv.clip;
    const x0 = Math.max(c.x0, Math.floor(rcv.ox + (Math.min(bx, 0) - R) * rcv.sx));
    const x1 = Math.min(c.x1, Math.ceil(rcv.ox + (Math.max(bx, 0) + R) * rcv.sx));
    const y0 = Math.max(c.y0, Math.floor(rcv.oy + (Math.min(by, 0) - R) * rcv.sy));
    const y1 = Math.min(c.y1, Math.ceil(rcv.oy + (Math.max(by, 0) + R) * rcv.sy));
    return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
  }

  /** The gaussian swept along this frame's segment, laid into one target. */
  private core(t: SprayTarget, sigma: number, dose: number, bx: number, by: number, keep: number): Rect | null {
    const { rcv, feather } = t;
    const R = sigma * REACH;
    const b = this.bounds(rcv, bx, by, R);
    if (!b) return null;
    const s = rcv.surface;
    const c = rcv.clip;
    const isx = 1 / rcv.sx;
    const isy = 1 / rcv.sy;
    const L = Math.hypot(bx, by);
    // short moves are a point (the segment formula needs a length)
    const point = L < 0.2 * sigma;
    const ux = point ? 0 : -bx / L;
    const uy = point ? 0 : -by / L;
    const i2s = 1 / (2 * sigma * sigma);
    const ik = 1 / (Math.SQRT2 * sigma);
    const norm = point ? 1 : (SQRT_2PI * sigma) / (2 * L);
    const R2 = R * R;
    const fade = 1 / (0.55 * R2);
    const band = feather ? Math.max(4, 0.06 * (c.x1 - c.x0)) : 0;
    const d0 = dose / keep;
    const fseed = this.seed + this.frame * 7919;
    const [cr, cg, cb] = this.color;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (let py = b.y0; py < b.y1; py++) {
      const y = (py + 0.5 - rcv.oy) * isy;
      for (let px = b.x0; px < b.x1; px++) {
        // past the budget only a random share is drawn (with more paint);
        // the same draw is the grain that keeps a light pass dusty
        const h = hash2(px, py, fseed);
        if (h >= keep) continue;
        const x = (px + 0.5 - rcv.ox) * isx;
        let g: number;
        let r2: number;
        if (point) {
          r2 = x * x + y * y;
          if (r2 >= R2) continue;
          g = Math.exp(-r2 * i2s);
        } else {
          const wx = x - bx;
          const wy = y - by;
          const al = wx * ux + wy * uy;
          const dp2 = Math.max(0, wx * wx + wy * wy - al * al);
          r2 = dp2 + (al < 0 ? al * al : al > L ? (al - L) * (al - L) : 0);
          if (r2 >= R2) continue;
          g = Math.exp(-dp2 * i2s) * norm * (erf((L - al) * ik) + erf(al * ik));
        }
        // fade over the outer part of the reach
        const f = Math.min(1, (R2 - r2) * fade);
        let k = d0 * g * f * f * (3 - 2 * f) * (0.55 + (0.9 * h) / keep);
        if (band > 0) {
          const e = Math.min(px - c.x0, c.x1 - 1 - px, py - c.y0, c.y1 - 1 - py);
          if (e < band) k *= smoothstep(0, band, e);
        }
        if (k < 0.0015) continue;
        const a = k < 0.05 ? k : 1 - Math.exp(-k);
        s.blendPixel(px, py, a, a * THICK.core, a, cr, cg, cb, WET, 0);
        if (px < bx0) bx0 = px;
        if (px > bx1) bx1 = px;
        if (py < by0) by0 = py;
        if (py > by1) by1 = py;
      }
    }
    return bx1 < bx0 ? null : { x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 };
  }

  // ----------------------------------------------------------- speckle

  /** This frame's droplets: 0.35–1.1 mm (finer from a fine cap), opaque, flung past the core, a few much further. */
  private speckle(sigma: number, dt: number): void {
    const r = this.r;
    const k = clamp(0.75 + 0.25 * (this.radius / 0.07), 0.8, 1.25);
    const want = (this.flow * dt * SPECK) / (0.9 * Math.PI * 5.7e-7 * k * k);
    const count = Math.min(this.lim.dots, MAX_DROPS, Math.floor(want + r()));
    const spread = sigma * 1.6;
    this.n = 0;
    for (let i = 0; i < count; i++) {
      const rad = spread * Math.sqrt(-2 * Math.log(r() || 1e-9)) * (r() < 0.2 ? 1.9 : 1);
      const th = r() * Math.PI * 2;
      this.dx[i] = rad * Math.cos(th);
      this.dy[i] = rad * Math.sin(th);
      this.dr[i] = (0.00035 + 0.00075 * r()) * k;
      this.tone[i] = 0.94 + 0.12 * r();
      this.n++;
    }
  }

  /** Rasterize this frame's droplets into one target. */
  private lay(t: SprayTarget): Rect | null {
    const { rcv, feather } = t;
    const s = rcv.surface;
    const c = rcv.clip;
    const sx = rcv.sx;
    const sy = rcv.sy;
    const k = 0.5 * (sx + sy);
    const band = feather ? Math.max(4, 0.06 * (c.x1 - c.x0)) : 0;
    const [cr, cg, cb] = this.color;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const cx = rcv.ox + this.dx[i] * sx;
      const cy = rcv.oy + this.dy[i] * sy;
      let rp = this.dr[i] * k;
      let a = 0.9;
      // smaller than a pixel: the same paint spread over one
      if (rp < 0.6) {
        a *= (rp / 0.6) ** 2;
        rp = 0.6;
      }
      const x0 = Math.max(c.x0, Math.floor(cx - rp));
      const x1 = Math.min(c.x1 - 1, Math.floor(cx + rp));
      const y0 = Math.max(c.y0, Math.floor(cy - rp));
      const y1 = Math.min(c.y1 - 1, Math.floor(cy + rp));
      if (x1 < x0 || y1 < y0) continue;
      if (band > 0) {
        const e = Math.min(cx - c.x0, c.x1 - cx, cy - c.y0, c.y1 - cy);
        if (e < band) a *= smoothstep(0, band, e);
      }
      if (a < 0.01) continue;
      const tn = this.tone[i];
      const pr = Math.min(255, cr * tn);
      const pg = Math.min(255, cg * tn);
      const pb = Math.min(255, cb * tn);
      for (let py = y0; py <= y1; py++) {
        const ddy = py + 0.5 - cy;
        for (let px = x0; px <= x1; px++) {
          const ddx = px + 0.5 - cx;
          // crisp, antialiased over a pixel
          const cov = a * clamp(rp - Math.sqrt(ddx * ddx + ddy * ddy) + 0.5, 0, 1);
          if (cov < 0.01) continue;
          s.blendPixel(px, py, cov, cov * THICK.speck, cov, pr, pg, pb, WET, 0);
        }
      }
      if (x0 < bx0) bx0 = x0;
      if (y0 < by0) by0 = y0;
      if (x1 > bx1) bx1 = x1;
      if (y1 > by1) by1 = y1;
    }
    return bx1 < bx0 ? null : { x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 };
  }
}
