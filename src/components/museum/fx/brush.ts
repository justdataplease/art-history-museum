// A loaded brush dragged across a surface. The footprint is a row of
// bristles: stamped along the (smoothed) path they leave parallel tracks of
// varying strength and thickness — ridges of impasto, heavier at the stroke
// edges where the paint is pushed aside. The load runs down with distance;
// as it does, weaker bristles give out first and the rest break up over the
// canvas grain (dry brush). A faster stroke presses lighter: narrower and
// thinner. Bristles crossing wet paint pick some of it up, so strokes
// through a fresh splat smear and blend.
//
// Within one stroke, overlapping stamps must not pile up (the same bristle
// passing twice over a pixel is still one layer of paint), so the stroke
// tracks the strongest coverage / thickness it has laid at each pixel and
// composites only the increment.

import { clamp, hash2, rng, smoothstep, vnoise } from "./noise";
import { rectUnion, type PaintSurface, type Rect } from "./surface";
import type { RGB } from "./splat";

/** Where dry paint catches: the work's own relief, as a 0..1 map at half the surface's resolution. */
export interface Grain {
  w: number;
  h: number;
  data: Float32Array;
}

export interface BrushSpec {
  color: RGB;
  /** brush width (m) */
  width: number;
  /** metres of stroke the load lasts (e-folding distance) */
  reach: number;
  seed: number;
}

interface Bristle {
  off: number; // across the brush, -0.5..0.5 of the width
  r: number; // px
  load: number; // relative paint held
  thick: number; // thickness it lays down (0..1 units)
  give: number; // how early it runs dry (0..1)
  c: [number, number, number]; // colour it carries (picks up wet paint)
  start: number; // px of stroke before it touches (a splayed, ragged start)
  lift: number; // when it leaves the canvas as the brush lifts (0..1)
  id: number;
}

// One stroke at a time: the max-tracking buffers are shared and reused.
let bufA = new Float32Array(0);
let bufT = new Float32Array(0);
let bufW = 0;
let bufOwner: BrushStroke | null = null;

export class BrushStroke {
  /** surface pixels touched since the last takeChanged() */
  private changed: Rect | null = null;
  private readonly surf: PaintSurface;
  private readonly spec: BrushSpec;
  private readonly sx: number; // px per metre
  private readonly sy: number;
  private readonly bristles: Bristle[];
  private bbox: Rect | null = null;
  private pts: { x: number; y: number; t: number }[] = [];
  private lastMid: { x: number; y: number } | null = null;
  /** metres travelled on the surface */
  private dist = 0;
  private speed = 0;
  private readonly startLoad: number;
  private readonly seed: number;
  private readonly grain: Grain | null;
  ended = false;

  /** @param startLoad 1 for a freshly loaded brush, less when a drag continues onto another work */
  constructor(surf: PaintSurface, sx: number, sy: number, spec: BrushSpec, startLoad = 1, grain: Grain | null = null) {
    this.surf = surf;
    this.grain = grain;
    this.spec = spec;
    this.sx = sx;
    this.sy = sy;
    this.startLoad = startLoad;
    this.seed = spec.seed;
    const r = rng(spec.seed);
    const widthPx = spec.width * 0.5 * (sx + sy);
    // bristles clump into tufts a few millimetres apart: those are the grooves
    const n = Math.round(clamp(widthPx / 2.4, 8, 64));
    const c = spec.color;
    const spacing = widthPx / n;
    this.bristles = Array.from({ length: n }, (_, i) => {
      const off = ((i + 0.5) / n - 0.5) * (1 + 0.04 * (r() - 0.5)) + (r() - 0.5) * (0.9 / n);
      const edge = smoothstep(0.36, 0.5, Math.abs(off));
      const tone = 0.95 + 0.1 * r();
      return {
        off,
        // neighbours overlap: a loaded brush leaves a solid body of paint
        r: Math.max(0.65, spacing * (0.8 + 0.6 * r())),
        load: 0.75 + 0.4 * r(),
        thick: (0.1 + 0.16 * r()) * (1 + 0.9 * edge),
        give: r() * r(),
        c: [c[0] * tone, c[1] * tone, c[2] * tone],
        // the middle of the brush touches first: a rounded, ragged front
        start: widthPx * (0.22 * (1 - Math.sqrt(Math.max(0, 1 - 4 * off * off))) + 0.06 * r() * r()),
        lift: r(),
        id: i,
      };
    });
    if (bufOwner && bufOwner !== this) bufOwner.end();
    const npx = surf.w * surf.h;
    if (bufA.length < npx) {
      bufA = new Float32Array(npx);
      bufT = new Float32Array(npx);
    }
    bufW = surf.w;
    bufOwner = this;
  }

  get surface(): PaintSurface {
    return this.surf;
  }

  /** Paint left on the brush (0..1), to carry into a continued drag. */
  get load(): number {
    return this.startLoad * Math.exp(-this.dist / this.spec.reach);
  }

  /** Add a point in surface pixels (image rows downward); t in seconds. */
  add(x: number, y: number, t: number): void {
    if (this.ended) return;
    const prev = this.pts[this.pts.length - 1];
    if (prev && Math.hypot(x - prev.x, y - prev.y) < 0.75) return;
    if (prev) {
      const dm = Math.hypot((x - prev.x) / this.sx, (y - prev.y) / this.sy);
      const dt = Math.max(1e-3, t - prev.t);
      this.speed = this.speed * 0.6 + (dm / dt) * 0.4;
    }
    this.pts.push({ x, y, t });
    const n = this.pts.length;
    if (n === 1) {
      this.lastMid = { x, y };
      return;
    }
    // quadratic smoothing: mid(n-3,n-2) → mid(n-2,n-1), control at n-2
    const a = this.pts[n - 2];
    const mid = { x: (a.x + x) / 2, y: (a.y + y) / 2 };
    if (this.lastMid) this.curve(this.lastMid, a, mid);
    this.lastMid = mid;
    if (this.pts.length > 4) this.pts.shift();
  }

  /** Lift the brush: finish the last half segment and free the shared buffers. */
  end(): void {
    if (this.ended) return;
    const n = this.pts.length;
    if (n >= 2 && this.lastMid) {
      const last = this.pts[n - 1];
      this.curve(this.lastMid, { x: (this.lastMid.x + last.x) / 2, y: (this.lastMid.y + last.y) / 2 }, last);
      // the lift: bristles leave the canvas one by one over a short run
      const prev = this.pts[n - 2];
      const dx = last.x - prev.x;
      const dy = last.y - prev.y;
      const dl = Math.hypot(dx, dy);
      if (dl > 1e-3) {
        const tx = dx / dl;
        const ty = dy / dl;
        const run = this.spec.width * 0.5 * (this.sx + this.sy) * 0.45;
        const steps = Math.max(2, Math.ceil(run / 0.5));
        for (let k = 1; k <= steps; k++) {
          const f = k / steps;
          this.stamp(last.x + tx * run * f, last.y + ty * run * f, tx, ty, 1 - 0.5 * f, 1 - f);
        }
      }
    }
    this.ended = true;
    if (bufOwner === this) {
      const b = this.bbox;
      if (b) {
        for (let y = b.y0; y < b.y1; y++) {
          bufA.fill(0, y * bufW + b.x0, y * bufW + b.x1);
          bufT.fill(0, y * bufW + b.x0, y * bufW + b.x1);
        }
      }
      bufOwner = null;
    }
  }

  /** Pixels changed since the last call (the caller marks them dirty). */
  takeChanged(): Rect | null {
    const c = this.changed;
    this.changed = null;
    return c;
  }

  // ---------------------------------------------------------- painting

  private curve(p0: { x: number; y: number }, c: { x: number; y: number }, p1: { x: number; y: number }): void {
    const chord = Math.hypot(c.x - p0.x, c.y - p0.y) + Math.hypot(p1.x - c.x, p1.y - c.y);
    const steps = Math.max(1, Math.ceil(chord / 0.5));
    let px = p0.x;
    let py = p0.y;
    const wPx = this.spec.width * this.sx;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      const x = u * u * p0.x + 2 * u * t * c.x + t * t * p1.x;
      const y = u * u * p0.y + 2 * u * t * c.y + t * t * p1.y;
      const dx = x - px;
      const dy = y - py;
      const dl = Math.hypot(dx, dy);
      if (dl < 1e-4) continue;
      this.dist += Math.hypot(dx / this.sx, dy / this.sy);
      // heavier over the first half-width (the dab spreading)
      const press = 1 + 0.25 * Math.exp(-(this.dist * this.sx) / (0.6 * wPx));
      this.stamp(x, y, dx / dl, dy / dl, press);
      px = x;
      py = y;
    }
  }

  /** One footprint of every bristle at (x, y), the brush moving along (tx, ty). */
  private stamp(x: number, y: number, tx: number, ty: number, press: number, lift = 1): void {
    if (bufOwner !== this) return;
    const s = this.surf;
    const W = s.w;
    const H = s.h;
    const load = this.load;
    // fast strokes skim: narrower, lighter, thinner
    const fast = smoothstep(0.35, 2.2, this.speed);
    const widthPx = this.spec.width * 0.5 * (this.sx + this.sy) * (1 - 0.3 * fast);
    const nx = -ty;
    const ny = tx;
    const seed = this.seed;
    const grain = this.grain;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    const distPx = this.dist * 0.5 * (this.sx + this.sy);
    for (const b of this.bristles) {
      if (distPx < b.start || b.lift > lift) continue;
      // this bristle's share of what's left, weak ones giving out first
      const l = clamp(load * b.load * press - b.give * (1 - load) * 0.9, 0, 1.3) * (1 - 0.25 * fast);
      if (l < 0.03) continue;
      const cx = x + nx * b.off * widthPx;
      const cy = y + ny * b.off * widthPx;
      const rad = b.r;
      // pick up wet paint under the bristle
      const ix = cx | 0;
      const iy = cy | 0;
      if (ix >= 0 && iy >= 0 && ix < W && iy < H) {
        const i = (iy * W + ix) * 4;
        const k = 0.016 * s.mat[i + 1] * s.col[i + 3] * (1 / 65025);
        if (k > 0.001) {
          b.c[0] += (s.col[i] - b.c[0]) * k;
          b.c[1] += (s.col[i + 1] - b.c[1]) * k;
          b.c[2] += (s.col[i + 2] - b.c[2]) * k;
        }
      }
      const reach = rad + 0.5;
      const x0 = Math.max(0, Math.floor(cx - reach));
      const x1 = Math.min(W - 1, Math.ceil(cx + reach));
      const y0 = Math.max(0, Math.floor(cy - reach));
      const y1 = Math.min(H - 1, Math.ceil(cy + reach));
      if (x1 < x0 || y1 < y0) continue;
      // as it runs dry each bristle's track thins into long, broken runs
      // (correlated along the stroke, not dashes), and what is left catches
      // only the raised grain: streaks aligned with the brush's travel
      const dash = 0.7 * vnoise(distPx / (16 + 14 * b.give), b.id * 7.3, seed) + 0.3 * vnoise(distPx / 5, b.id * 3.1 + 40, seed);
      const cont = smoothstep(dash - 0.2, dash + 0.2, l * 1.75 - 0.1);
      if (cont <= 0.01) continue;
      const dry = l < 0.6;
      // a toe of paint where the loaded brush first touched down
      const toe = 1 + 0.9 * Math.exp(-distPx / (0.35 * widthPx + 1)) * this.startLoad;
      const tb = b.thick * Math.min(1, l * 1.3) * press * toe;
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = px + 0.5 - cx;
          const dy = py + 0.5 - cy;
          const dr = Math.sqrt(dx * dx + dy * dy);
          // the rim antialiased over a pixel: no stair-steps along the stroke's edge
          const rim = clamp(rad - dr + 0.5, 0, 1);
          if (rim <= 0) continue;
          const d2 = Math.min(1, (dr * dr) / (rad * rad));
          const prof = 1 - d2;
          let a = cont * (0.88 + 0.12 * prof) * rim;
          if (dry) {
            // stroke-aligned grain (long along the travel, a pixel or so
            // across), and the ridges of the paint underneath catching it
            const u = (px * tx + py * ty) / 9;
            const v = (py * tx - px * ty) / 1.15;
            let g = 0.8 * vnoise(u, v, seed) + 0.2 * hash2(px, py, seed);
            if (grain) {
              const gx = Math.min(grain.w - 1, px >> 1);
              const gy = Math.min(grain.h - 1, py >> 1);
              g = 0.45 * g + 0.55 * (1 - grain.data[gy * grain.w + gx]);
            }
            a *= smoothstep(g - 0.16, g + 0.16, l * 1.9);
          }
          if (a <= 0.01) continue;
          const t = tb * (0.3 + 0.7 * prof) * Math.min(1, a * 1.5);
          const i = py * W + px;
          const A = bufA[i];
          const T = bufT[i];
          const inc = a > A ? (a - A) / (1 - A + 1e-4) : 0;
          const tinc = t > T ? t - T : 0;
          if (inc <= 0.002 && tinc <= 0.002) continue;
          if (a > A) bufA[i] = a;
          if (t > T) bufT[i] = t;
          s.blendPixel(px, py, Math.min(1, inc), tinc, Math.min(1, inc), b.c[0], b.c[1], b.c[2], 1, 0);
        }
      }
      if (x0 < bx0) bx0 = x0;
      if (y0 < by0) by0 = y0;
      if (x1 > bx1) bx1 = x1;
      if (y1 > by1) by1 = y1;
    }
    if (bx1 < bx0) return;
    const r = { x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 };
    this.bbox = rectUnion(this.bbox, r);
    this.changed = rectUnion(this.changed, r);
  }
}
