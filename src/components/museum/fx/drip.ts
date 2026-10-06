// A drip: paint running down from the lower edge of a splat. The trail
// narrows as the run gives up its paint; a bead rides the tip, swelling as
// the run slows, and the whole thing eases to a stop within a few seconds.
// A sliding yolk is the same thing with a big bead and a streaky trail.
//
// One DripRun is shared by every receiver its splat landed on; each gets a
// LiveItem view that rasterizes the run's current state into that surface.

import { clamp, smin, smoothstep, vnoise } from "./noise";
import { acquireLayer, releaseLayer, type LiveItem, type Rect, type Target } from "./surface";
import type { DripSpec, Receiver } from "./splat";

/** A run creeps to a stop: len·(1 − (1 − t/T)^EASE) over T = EASE·τ (same start speed as e^(−t/τ)). */
const EASE = 2.6;
/** Longest any run keeps moving (s): drips must not keep the canvas rendering for long. */
const MAX_RUN_S = 12;

export class DripRun {
  readonly spec: DripSpec;
  /** current length (m) */
  len = 0;
  private t = 0;
  done = false;
  readonly views: DripView[] = [];

  constructor(spec: DripSpec) {
    this.spec = spec;
  }

  /** Advance by dt seconds; true if the shape changed. */
  step(dt: number): boolean {
    if (this.done) return false;
    this.t += dt;
    const s = this.spec;
    const k = Math.max(0, this.t - s.delay);
    const T = Math.min(MAX_RUN_S, EASE * s.tau);
    const p = Math.min(1, k / T);
    const next = s.len * (1 - Math.pow(1 - p, EASE));
    const changed = Math.abs(next - this.len) > 1e-6 || k > 0;
    this.len = next;
    if (p >= 1) {
      this.len = s.len;
      this.done = true;
    }
    if (changed || this.done) {
      for (const v of this.views) {
        v.changed = true;
        v.done = this.done;
      }
    }
    return changed;
  }

  /** Fraction of the final length reached. */
  get progress(): number {
    return this.spec.len > 0 ? this.len / this.spec.len : 1;
  }

  view(rcv: Receiver): DripView {
    const v = new DripView(this, rcv);
    this.views.push(v);
    return v;
  }

  /** Centre-line x at splat-space y. */
  xAt(y: number): number {
    const s = this.spec;
    const dy = y - s.y;
    if (dy <= 0) return s.x;
    const ramp = smoothstep(0, s.w * 3, dy);
    return s.x + s.wobble * ramp * (2 * vnoise(dy / (s.w * 4 + 0.004), 0.5, s.seed) - 1);
  }

  /** Splat-space bounds of the current state (or of the finished run). */
  extent(final = false): { x0: number; y0: number; x1: number; y1: number } {
    const s = this.spec;
    const bead = final ? s.bead * 1.15 : this.beadR();
    const len = final ? s.len : this.len;
    const r = Math.max(s.w * 1.4, bead * 1.2) + s.wobble + 0.001;
    return { x0: s.x - r, y0: s.y - Math.max(s.w * 1.2, bead * 1.2), x1: s.x + r, y1: s.y + len + bead * 1.4 };
  }

  beadR(): number {
    // the bead fattens as the run slows and paint collects at its tip
    return this.spec.bead * (0.8 + 0.35 * smoothstep(0.2, 1, this.progress));
  }
}

export class DripView implements LiveItem {
  changed = true;
  done = false;
  private run: DripRun;

  constructor(run: DripRun, rcv: Receiver) {
    this.run = run;
    this.rcv = rcv;
  }

  readonly rcv: Receiver;

  bounds(): Rect | null {
    return this.toPixels(this.run.extent());
  }

  maxBounds(): Rect | null {
    return this.toPixels(this.run.extent(true));
  }

  private toPixels(e: { x0: number; y0: number; x1: number; y1: number }): Rect | null {
    const r = this.rcv;
    const out = {
      x0: Math.max(r.clip.x0, Math.floor(r.ox + e.x0 * r.sx) - 1),
      y0: Math.max(r.clip.y0, Math.floor(r.oy + e.y0 * r.sy) - 1),
      x1: Math.min(r.clip.x1, Math.ceil(r.ox + e.x1 * r.sx) + 1),
      y1: Math.min(r.clip.y1, Math.ceil(r.oy + e.y1 * r.sy) + 1),
    };
    return out.x1 > out.x0 && out.y1 > out.y0 ? out : null;
  }

  draw(clip: Rect, target: Target): void {
    const b = this.bounds();
    if (!b) return;
    const rect = {
      x0: Math.max(b.x0, clip.x0),
      y0: Math.max(b.y0, clip.y0),
      x1: Math.min(b.x1, clip.x1),
      y1: Math.min(b.y1, clip.y1),
    };
    if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) return;
    const run = this.run;
    const s = run.spec;
    const rcv = this.rcv;
    const surf = rcv.surface;
    const L = acquireLayer().reset(rect, true);
    L.glaze = s.glaze;
    L.thickMax = true;
    const isx = 1 / rcv.sx;
    const isy = 1 / rcv.sy;
    const pxPerM = 0.5 * (rcv.sx + rcv.sy);
    const len = run.len;
    const tipY = s.y + len;
    const bead = run.beadR();
    const beadCy = tipY - bead * 0.15;
    const beadCx = run.xAt(tipY);
    const flare = s.flare !== false;
    const top = flare ? s.y - s.w * 1.1 : s.y;
    const k = bead * 0.5;
    const trailColor = s.color;
    const beadColor = s.beadColor ?? s.color;
    const core = s.beadCore;
    const lam = s.flare === false ? bead * 0.45 : s.w * 0.32;
    const stretch = s.beadStretch ?? 1.18;
    // rounded top: the run starts as a cap inside the splat, never a hard edge
    const hwTop = 0.5 * s.w + (flare ? s.w * 0.55 : 0);
    for (let py = rect.y0; py < rect.y1; py++) {
      const y = (py + 0.5 - rcv.oy) * isy;
      const dy = y - s.y;
      const along = len > 0 ? clamp(dy / len, 0, 1) : 0;
      // trail half-width: flares into the splat above, thins toward the tip
      let hw = 0.5 * s.w * (1 - 0.42 * along);
      if (flare && dy < s.w * 2) hw += s.w * 0.55 * Math.exp(-Math.max(0, dy) / (s.w * 0.7));
      const xc = run.xAt(y);
      const vBot = y - tipY;
      const capY = y < top ? y - top : 0;
      let j = (py - rect.y0) * L.w;
      for (let px = rect.x0; px < rect.x1; px++, j++) {
        const x = (px + 0.5 - rcv.ox) * isx;
        const dTrail =
          capY < 0 ? Math.sqrt((x - s.x) * (x - s.x) + capY * capY) - hwTop : Math.max(Math.abs(x - xc) - hw, vBot);
        const bx = (x - beadCx) / bead;
        const by = (y - beadCy) / (bead * stretch);
        const dBead = (Math.sqrt(bx * bx + by * by) - 1) * bead;
        const d = smin(dTrail, dBead, k);
        const edge = clamp(0.5 - d * pxPerM, 0, 1);
        if (edge <= 0) continue;
        const depth = Math.max(0, -d);
        const inBead = clamp(1 - Math.max(0, dBead) / (bead * 0.6), 0, 1);
        let th = (1 - Math.exp(-depth / lam)) * s.tMax;
        if (s.beadCap && dBead < 0) {
          const u = Math.min(1, -dBead / bead);
          th = Math.max(th * 0.3, Math.sqrt(u * (2 - u)) * s.tMax);
        } else if (s.beadCap) th *= 0.3;
        let a = edge * s.alpha;
        if (s.trailAlpha < 1 && inBead < 1) {
          const streak = s.trailStreak > 0 ? 1 - s.trailStreak * vnoise((x - xc) * 900, dy * 40, s.seed) : 1;
          const ta = s.trailAlpha * streak;
          a *= ta + (1 - ta) * inBead;
        }
        L.a[j] = a;
        L.f[j] = edge;
        L.t[j] = th * edge;
        let cr = trailColor[0] + (beadColor[0] - trailColor[0]) * inBead;
        let cg = trailColor[1] + (beadColor[1] - trailColor[1]) * inBead;
        let cb = trailColor[2] + (beadColor[2] - trailColor[2]) * inBead;
        if (core && inBead > 0) {
          const c = smoothstep(0, bead * 0.8, -dBead) * inBead;
          cr += (core[0] - cr) * c;
          cg += (core[1] - cg) * c;
          cb += (core[2] - cb) * c;
        }
        const shade = 1 - 0.1 * clamp(th / (s.tMax + 1e-6), 0, 1);
        L.rgb[j * 3] = cr * shade;
        L.rgb[j * 3 + 1] = cg * shade;
        L.rgb[j * 3 + 2] = cb * shade;
      }
    }
    surf.blendLayer(L, target, clip);
    releaseLayer(L);
  }
}
