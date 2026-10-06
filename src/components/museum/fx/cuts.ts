// A blade's marks. Everything is painted in splat space (metres on the
// surface, +y down) into a Receiver, like the paint, so a slash running off
// a painting onto its frame lands on every surface it crosses.
//
//   canvas — a tear: the canvas splits open along the stroke (it springs
//            apart over a few frames under its own tension), the dark gap
//            behind it, a fringe of cut threads at different lengths, the
//            raw linen edge, curled lips (lit on one side, in shadow on the
//            other), short cracks across them where the paint film broke,
//            a few threads still bridging the gap. Crossing cuts simply cut
//            again.
//   others — a scored gouge: bare plaster, gesso and red bole under the
//            gold, fresh wood, with chipped shoulders and skips where the
//            edge bounced.

import { clamp, hash2, smoothstep, vnoise } from "./noise";
import { acquireLayer, releaseLayer, type Layer, type LiveItem, type Rect, type Target } from "./surface";
import type { Bounds, Receiver, RGB } from "./splat";

export type SurfaceKind = "canvas" | "plaster" | "gilt" | "wood" | "stone";

const LINEN: RGB = [206, 192, 160];
/** the back of an old canvas: duller, browner */
const LINEN_BACK: RGB = [168, 148, 112];
const GROUND: RGB = [232, 226, 210];
const GAP_EDGE: RGB = [70, 60, 50];
const SOOT: RGB = [38, 34, 32];
const CRACK: RGB = [28, 22, 18];

const PLASTER: { bare: RGB; deep: RGB } = { bare: [242, 238, 230], deep: [150, 146, 140] };
const STONE: { bare: RGB; deep: RGB } = { bare: [196, 194, 188], deep: [110, 108, 104] };
const BOLE: RGB = [148, 62, 40];
const GESSO: RGB = [232, 224, 205];
const WOOD_FRESH: RGB = [212, 170, 118];
const WOOD_DEEP: RGB = [92, 60, 34];

// ---------------------------------------------------------------- helpers

/** A layer over the pixels `b` (metres) covers in a receiver, null if none. */
function layerFor(rcv: Receiver, b: Bounds, pad = 2): Layer | null {
  const r = {
    x0: Math.max(rcv.clip.x0, Math.floor(rcv.ox + b.x0 * rcv.sx) - pad),
    y0: Math.max(rcv.clip.y0, Math.floor(rcv.oy + b.y0 * rcv.sy) - pad),
    x1: Math.min(rcv.clip.x1, Math.ceil(rcv.ox + b.x1 * rcv.sx) + pad),
    y1: Math.min(rcv.clip.y1, Math.ceil(rcv.oy + b.y1 * rcv.sy) + pad),
  };
  if (r.x1 <= r.x0 || r.y1 <= r.y0) return null;
  const L = acquireLayer().reset(r, true);
  L.wet = -1;
  L.holes = true;
  return L;
}

function put(L: Layer, j: number, c: RGB, a: number): void {
  // "over" inside the layer itself
  const A = L.a[j];
  const na = a + A * (1 - a);
  if (na <= 0) return;
  const w = a / na;
  L.rgb[j * 3] = L.rgb[j * 3] * (1 - w) + c[0] * w;
  L.rgb[j * 3 + 1] = L.rgb[j * 3 + 1] * (1 - w) + c[1] * w;
  L.rgb[j * 3 + 2] = L.rgb[j * 3 + 2] * (1 - w) + c[2] * w;
  L.a[j] = na;
  L.f[j] = na;
}

// ----------------------------------------------------------------- blades

/** A blade stroke in splat space (metres). */
export interface CutSpec {
  seed: number;
  kind: SurfaceKind;
  pts: { x: number; y: number }[];
}

export function cutExtent(c: CutSpec): Bounds {
  const m = c.kind === "canvas" ? 0.034 : 0.01;
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of c.pts) {
    b.x0 = Math.min(b.x0, p.x - m);
    b.y0 = Math.min(b.y0, p.y - m);
    b.x1 = Math.max(b.x1, p.x + m);
    b.y1 = Math.max(b.y1, p.y + m);
  }
  return b;
}

interface CutGeom {
  segs: { ax: number; ay: number; bx: number; by: number; s0: number; len: number; nx: number; ny: number }[];
  total: number;
}

function cutGeom(pts: { x: number; y: number }[]): CutGeom {
  const segs: CutGeom["segs"] = [];
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-5) continue;
    segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, s0: s, len, nx: -(b.y - a.y) / len, ny: (b.x - a.x) / len });
    s += len;
  }
  return { segs, total: s };
}

/**
 * A torn cut through a canvas, rasterized for `opening` 0..1 (the canvas
 * springs apart under its own tension). Pixels are owned by the nearest
 * segment, so the stroke can be drawn in chunks without double-blending.
 *
 * The gap is a long lens, widest mid-cut and wider the longer the cut. The
 * lower flap droops forward a little, showing a strip of its raw linen back
 * in shadow; the upper edge shows only the cut threads. Along both edges
 * the paint film has cracked and chipped down to the white ground.
 */
function cutCanvasLayer(rcv: Receiver, c: CutSpec, g: CutGeom, segFrom: number, segTo: number, opening: number, box: Bounds): Layer | null {
  const L = layerFor(rcv, box, 1);
  if (!L) return null;
  const seed = c.seed;
  const total = g.total || 1e-6;
  const Gmax = clamp(total * 0.012, 0.0035, 0.011) * (0.8 + 0.4 * ((seed % 97) / 97)); // widest half-gap (m)
  const lip = 0.006;
  const isx = 1 / rcv.sx;
  const isy = 1 / rcv.sy;
  const px1 = 0.5 * (isx + isy);
  const THREAD = 0.0008; // thread pitch of a painter's linen (m)
  for (let py = L.y0; py < L.y0 + L.h; py++) {
    const y = (py + 0.5 - rcv.oy) * isy;
    let j = (py - L.y0) * L.w;
    for (let px = L.x0; px < L.x0 + L.w; px++, j++) {
      const x = (px + 0.5 - rcv.ox) * isx;
      // nearest segment overall (ownership), with arclength and side
      let best = Infinity;
      let bi = -1;
      let bs = 0;
      let side = 0;
      let ny = 0;
      for (let i = 0; i < g.segs.length; i++) {
        const s = g.segs[i];
        const dx = s.bx - s.ax;
        const dy = s.by - s.ay;
        const h = clamp(((x - s.ax) * dx + (y - s.ay) * dy) / (s.len * s.len), 0, 1);
        const qx = x - s.ax - dx * h;
        const qy = y - s.ay - dy * h;
        const d = qx * qx + qy * qy;
        if (d < best) {
          best = d;
          bi = i;
          bs = s.s0 + h * s.len;
          side = qx * s.nx + qy * s.ny;
          ny = s.ny;
        }
      }
      if (bi < segFrom || bi >= segTo) continue;
      const dist = Math.sqrt(best);
      if (dist > Gmax * 1.6 + lip + px1 * 2) continue;
      const u = bs / total;
      // the gap: widest mid-stroke, closing at both ends, wandering
      const env = Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), 0.5);
      const open = smoothstep(0.02, 0.25, env * opening);
      const half = Gmax * opening * env * (0.7 + 0.45 * vnoise(bs * 40, 0.5, seed));
      // each side tears on its own: a wavering line, and a fringe of cut
      // threads ending at different lengths
      const sideK = side >= 0 ? 1 : -1;
      // this side hangs below the cut (splat +y is down): its flap droops
      const below = smoothstep(0.15, 0.7, sideK * ny);
      const wave = 0.0005 * (2 * vnoise(bs * 900, sideK * 3, seed) - 1);
      const thread = Math.floor(bs / THREAD);
      const fringe = 0.0009 * Math.pow(hash2(thread, sideK, seed), 2) * open;
      const edge = Math.max(0, half + (wave - fringe) * env);
      const d = dist - edge; // < 0 in the gap
      const bevel = Math.max(px1 * 1.1, 0.0009) * smoothstep(0, 0.4, env);
      let hole = clamp(-d / (bevel + 1e-6) + 0.1, 0, 1);
      if (d < 0 && hole < 1) put(L, j, GAP_EDGE, 0.85 * (1 - hole));
      // threads still bridging the gap here and there
      const tq = vnoise(bs * 260, 7.5, seed);
      if (tq > 0.78 && hole > 0) {
        const phase = (bs * 830) % 1;
        const w = clamp(1 - Math.abs(phase - 0.5) / 0.16, 0, 1) * smoothstep(0.78, 0.84, tq);
        if (w > 0) {
          put(L, j, LINEN, 0.9 * w);
          hole *= 1 - w;
        }
      }
      L.hole[j] = hole * smoothstep(0, 0.05, opening);
      if (d < 0) continue;
      // the drooping flap: a strip of the canvas's raw back, in its own shadow
      const flapW = half * 0.55 * below;
      if (d < flapW) {
        const k = d / Math.max(flapW, 1e-6);
        const tone = 0.55 + 0.3 * k + 0.12 * hash2(thread, 9, seed);
        put(L, j, [LINEN_BACK[0] * tone, LINEN_BACK[1] * tone, LINEN_BACK[2] * tone], 0.95 * open);
        L.t[j] = (0.75 - 0.25 * k) * open;
        continue;
      }
      const dd = d - flapW;
      // the raw cut edge: linen and white ground where the paint film broke
      const rawW = Math.max(px1 * 1.4, 0.0012) * (0.7 + 0.6 * hash2(thread, sideK + 5, seed));
      if (dd < rawW) put(L, j, below > 0.5 ? LINEN : GROUND, 0.9 * (1 - dd / rawW) * open);
      // chips of paint lost along the edge, down to the ground
      const chip = vnoise(bs * 380, sideK * 5 + 11, seed);
      if (dd < 0.0035 * chip * chip && chip > 0.55) put(L, j, GROUND, 0.9 * open);
      // curled lips: the cut canvas lifts toward the gap (the flap more)
      if (dd < lip) {
        const k = 1 - dd / lip;
        L.t[j] = (0.45 + 0.35 * below) * k * k * env * opening;
        put(L, j, SOOT, (0.06 + 0.14 * below) * k * env * opening);
        // short cracks across the lip where the paint film broke
        const cr = Math.abs(((bs * 140 + vnoise(bs * 40, sideK, seed) * 2) % 1) - 0.5);
        if (cr < 0.04 && k > 0.25) put(L, j, CRACK, 0.5 * env);
      }
    }
  }
  return L;
}

/** A scored gouge on a hard surface (wall, frame, bench, floor). */
function gougeLayer(rcv: Receiver, c: CutSpec, g: CutGeom, segFrom: number, segTo: number, box: Bounds): Layer | null {
  const L = layerFor(rcv, box, 1);
  if (!L) return null;
  const seed = c.seed;
  const pal: RGB = c.kind === "gilt" ? GESSO : c.kind === "wood" ? WOOD_FRESH : c.kind === "stone" ? STONE.bare : PLASTER.bare;
  const deep: RGB = c.kind === "gilt" ? BOLE : c.kind === "wood" ? WOOD_DEEP : c.kind === "stone" ? STONE.deep : PLASTER.deep;
  const W = 0.0012 + 0.0012 * ((seed % 89) / 89);
  const isx = 1 / rcv.sx;
  const isy = 1 / rcv.sy;
  const px1 = 0.5 * (isx + isy);
  const total = g.total || 1e-6;
  for (let py = L.y0; py < L.y0 + L.h; py++) {
    const y = (py + 0.5 - rcv.oy) * isy;
    let j = (py - L.y0) * L.w;
    for (let px = L.x0; px < L.x0 + L.w; px++, j++) {
      const x = (px + 0.5 - rcv.ox) * isx;
      let best = Infinity;
      let bi = -1;
      let bs = 0;
      for (let i = 0; i < g.segs.length; i++) {
        const s = g.segs[i];
        const dx = s.bx - s.ax;
        const dy = s.by - s.ay;
        const h = clamp(((x - s.ax) * dx + (y - s.ay) * dy) / (s.len * s.len), 0, 1);
        const qx = x - s.ax - dx * h;
        const qy = y - s.ay - dy * h;
        const d = qx * qx + qy * qy;
        if (d < best) {
          best = d;
          bi = i;
          bs = s.s0 + h * s.len;
        }
      }
      if (bi < segFrom || bi >= segTo) continue;
      const dist = Math.sqrt(best);
      const env = Math.pow(Math.sin(Math.PI * clamp(bs / total, 0, 1)), 0.35);
      // skips where the blade bounced off
      const bite = smoothstep(0.25, 0.4, vnoise(bs * 60, 3, seed));
      const half = W * env * (0.6 + 0.6 * vnoise(bs * 500, 1, seed)) * bite;
      const d = dist - half;
      if (d > px1 * 1.5 + 0.0008) continue;
      const cov = clamp(0.5 - d / px1, 0, 1);
      const k = clamp(dist / (half + 1e-6), 0, 1);
      const c2: RGB = [deep[0] + (pal[0] - deep[0]) * k, deep[1] + (pal[1] - deep[1]) * k, deep[2] + (pal[2] - deep[2]) * k];
      put(L, j, c2, cov);
      L.t[j] = 0.25 * k * cov;
      // chipped shoulders
      if (d > 0 && d < 0.0008) put(L, j, pal, 0.4 * (1 - d / 0.0008) * hash2(px, py, seed) * bite);
    }
  }
  return L;
}

const CHUNK_SEGS = 6;

/** Static gouge(s) along a blade stroke on a hard surface. */
export function stampGouge(rcv: Receiver, c: CutSpec, now: number): void {
  const g = cutGeom(c.pts);
  for (let i = 0; i < g.segs.length; i += CHUNK_SEGS) {
    const box = chunkBox(g, i, Math.min(g.segs.length, i + CHUNK_SEGS), 0.006);
    const L = gougeLayer(rcv, c, g, i, i + CHUNK_SEGS, box);
    if (!L) continue;
    L.wet = -1;
    rcv.surface.addStatic(L, now, false);
    releaseLayer(L);
  }
}

function chunkBox(g: CutGeom, from: number, to: number, m: number): Bounds {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = from; i < to; i++) {
    const s = g.segs[i];
    b.x0 = Math.min(b.x0, s.ax - m, s.bx - m);
    b.y0 = Math.min(b.y0, s.ay - m, s.by - m);
    b.x1 = Math.max(b.x1, s.ax + m, s.bx + m);
    b.y1 = Math.max(b.y1, s.ay + m, s.by + m);
  }
  return b;
}

/** A canvas cut that springs open over a few frames (live, in chunks). */
export class CutRun {
  readonly spec: CutSpec;
  private readonly g: CutGeom;
  opening = 0;
  done = false;
  private t = 0;
  readonly views: LiveItem[] = [];

  constructor(spec: CutSpec) {
    this.spec = spec;
    this.g = cutGeom(spec.pts);
  }

  get empty(): boolean {
    return this.g.segs.length === 0;
  }

  step(dt: number): void {
    if (this.done) return;
    this.t += dt;
    const p = clamp(this.t / 0.32, 0, 1);
    this.opening = 1 - Math.pow(1 - p, 3);
    if (p >= 1) this.done = true;
    for (const v of this.views) {
      v.changed = true;
      v.done = this.done;
    }
  }

  /** Live chunks for one receiver. */
  viewsFor(rcv: Receiver): LiveItem[] {
    const out: LiveItem[] = [];
    const g = this.g;
    for (let i = 0; i < g.segs.length; i += CHUNK_SEGS) {
      const to = Math.min(g.segs.length, i + CHUNK_SEGS);
      const box = chunkBox(g, i, to, 0.032);
      const px = {
        x0: Math.max(rcv.clip.x0, Math.floor(rcv.ox + box.x0 * rcv.sx) - 1),
        y0: Math.max(rcv.clip.y0, Math.floor(rcv.oy + box.y0 * rcv.sy) - 1),
        x1: Math.min(rcv.clip.x1, Math.ceil(rcv.ox + box.x1 * rcv.sx) + 1),
        y1: Math.min(rcv.clip.y1, Math.ceil(rcv.oy + box.y1 * rcv.sy) + 1),
      };
      if (px.x1 <= px.x0 || px.y1 <= px.y0) continue;
      const run = this;
      const view: LiveItem = {
        changed: true,
        done: false,
        bounds: () => px,
        maxBounds: () => px,
        draw(clip: Rect, target: Target) {
          const L = cutCanvasLayer(rcv, run.spec, run.g, i, to, run.opening, box);
          if (!L) return;
          rcv.surface.blendLayer(L, target, clip);
          releaseLayer(L);
        },
      };
      out.push(view);
      this.views.push(view);
    }
    return out;
  }
}
