// Thrown paint, eggs and paintballs, as 2-D implicit shapes in "splat space": metres on
// the hit surface, origin at the impact point, +x to the surface's right,
// +y DOWN (along gravity on a wall). A shape is a smooth union of
// primitives (an irregular main body, crown fingers, satellite droplets,
// spray streaks, shell flakes) evaluated as a signed distance field, then
// turned into coverage + thickness: thin at the meniscus, a raised rim where
// the crown sheet piled up, pooled unevenly inside.
//
// The same shape rasterizes into any receiver (a painting's overlay, a
// decal cell on the wall) at that receiver's resolution, so a splat that
// lands across a frame edge continues seamlessly onto the frame and wall.

import { clamp, fbm, gauss, rng, smin, smoothstep, vnoise, type Rng } from "./noise";
import { acquireLayer, releaseLayer, type Layer, type PaintSurface, type Rect } from "./surface";

export type RGB = [number, number, number];

/** Where a splat lands on a surface: splat metres → surface pixels. */
export interface Receiver {
  surface: PaintSurface;
  /** pixel position of the splat origin (may lie outside the surface) */
  ox: number;
  oy: number;
  /** pixels per metre along x and y */
  sx: number;
  sy: number;
  /** the pixels this receiver may write */
  clip: Rect;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// ------------------------------------------------------------ primitives

const BODY = 0;
const CAPSULE = 1;
const ELLIPSE = 2;
const POLY = 3;

interface BodyPrim {
  k: typeof BODY;
  cx: number;
  cy: number;
  ca: number; // rotation of the elongation axis
  sa: number;
  ex: number; // stretch along / across
  ey: number;
  table: Float32Array; // radius by angle (body frame, after un-stretch)
  rmax: number;
}
interface CapsulePrim {
  k: typeof CAPSULE;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  ra: number;
  rb: number;
}
interface EllipsePrim {
  k: typeof ELLIPSE;
  cx: number;
  cy: number;
  ca: number;
  sa: number;
  rx: number;
  ry: number;
}
interface PolyPrim {
  k: typeof POLY;
  pts: number[]; // x0,y0,x1,y1,...
}
type Prim = BodyPrim | CapsulePrim | EllipsePrim | PolyPrim;

const TABLE_N = 720;

function primBounds(p: Prim): Bounds {
  switch (p.k) {
    case BODY: {
      const r = p.rmax * Math.max(p.ex, p.ey);
      return { x0: p.cx - r, y0: p.cy - r, x1: p.cx + r, y1: p.cy + r };
    }
    case CAPSULE:
      return {
        x0: Math.min(p.ax - p.ra, p.bx - p.rb),
        y0: Math.min(p.ay - p.ra, p.by - p.rb),
        x1: Math.max(p.ax + p.ra, p.bx + p.rb),
        y1: Math.max(p.ay + p.ra, p.by + p.rb),
      };
    case ELLIPSE: {
      const r = Math.max(p.rx, p.ry);
      return { x0: p.cx - r, y0: p.cy - r, x1: p.cx + r, y1: p.cy + r };
    }
    case POLY: {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < p.pts.length; i += 2) {
        x0 = Math.min(x0, p.pts[i]);
        x1 = Math.max(x1, p.pts[i]);
        y0 = Math.min(y0, p.pts[i + 1]);
        y1 = Math.max(y1, p.pts[i + 1]);
      }
      return { x0, y0, x1, y1 };
    }
  }
}

function primSdf(p: Prim, x: number, y: number): number {
  switch (p.k) {
    case BODY: {
      const dx = x - p.cx;
      const dy = y - p.cy;
      const u = (dx * p.ca + dy * p.sa) / p.ex;
      const v = (-dx * p.sa + dy * p.ca) / p.ey;
      const rho = Math.sqrt(u * u + v * v);
      let a = Math.atan2(v, u) * (TABLE_N / (2 * Math.PI));
      if (a < 0) a += TABLE_N;
      const i0 = a | 0;
      const f = a - i0;
      const t = p.table;
      const r = t[i0 % TABLE_N] * (1 - f) + t[(i0 + 1) % TABLE_N] * f;
      return (rho - r) * Math.min(p.ex, p.ey);
    }
    case CAPSULE: {
      const bax = p.bx - p.ax;
      const bay = p.by - p.ay;
      const pax = x - p.ax;
      const pay = y - p.ay;
      const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay || 1e-12), 0, 1);
      const qx = pax - bax * h;
      const qy = pay - bay * h;
      return Math.sqrt(qx * qx + qy * qy) - (p.ra + (p.rb - p.ra) * h);
    }
    case ELLIPSE: {
      const dx = x - p.cx;
      const dy = y - p.cy;
      const u = (dx * p.ca + dy * p.sa) / p.rx;
      const v = (-dx * p.sa + dy * p.ca) / p.ry;
      return (Math.sqrt(u * u + v * v) - 1) * Math.min(p.rx, p.ry);
    }
    case POLY: {
      // iq's polygon SDF
      const v = p.pts;
      const n = v.length / 2;
      let d = (x - v[0]) ** 2 + (y - v[1]) ** 2;
      let s = 1;
      for (let i = 0, j = n - 1; i < n; j = i, i++) {
        const ex = v[j * 2] - v[i * 2];
        const ey = v[j * 2 + 1] - v[i * 2 + 1];
        const wx = x - v[i * 2];
        const wy = y - v[i * 2 + 1];
        const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey || 1e-12), 0, 1);
        const bx = wx - ex * h;
        const by = wy - ey * h;
        d = Math.min(d, bx * bx + by * by);
        const c1 = y >= v[i * 2 + 1];
        const c2 = y < v[j * 2 + 1];
        const c3 = ex * wy > ey * wx;
        if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
      }
      return s * Math.sqrt(d);
    }
  }
}

// ----------------------------------------------------------------- shape

export interface Shape {
  prims: Prim[];
  /** smooth-union radius (m): necks between nearby droplets and the body */
  k: number;
  color: RGB;
  /** optional second colour toward the deep interior (yolk centre) */
  core?: RGB;
  coreDepth?: number;
  /** plateau thickness, 0..1 (× THICK_M) */
  tMax: number;
  /** meniscus: distance (m) over which thickness ramps up from the edge */
  lambda: number;
  /** a raised rim this far inside the edge (m), its width and relative height */
  rimAt: number;
  rimW: number;
  rimAmp: number;
  /** pooling: relative thickness variation and its feature size (m) */
  pool: number;
  poolSize: number;
  /** on a wall paint slumps: thicker toward the bottom by up to this much */
  sag?: number;
  sagSize?: number;
  /** a spherical-cap profile of this radius (m) instead of the meniscus: domed drops, a yolk */
  cap?: number;
  /** paint thrown outward from the impact: thinner in the middle, piled toward the rim */
  centre?: { x: number; y: number; r: number; thin: number };
  /** radial flow ridges around the impact (relative amplitude, ridges per turn) */
  flow?: { x: number; y: number; amp: number; n: number };
  /** surface ripple: relative amplitude and feature size (m) — what catches the light */
  detail?: { amp: number; size: number };
  /** opacity scale (egg white is a nearly clear film) */
  alpha: number;
  /** thin-film opacity floor: very thin spatter lets a little through */
  thinAlpha: number;
  glaze: number;
  seed: number;
}

function shapeBounds(s: Shape): Bounds {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of s.prims) {
    const q = primBounds(p);
    b.x0 = Math.min(b.x0, q.x0);
    b.y0 = Math.min(b.y0, q.y0);
    b.x1 = Math.max(b.x1, q.x1);
    b.y1 = Math.max(b.y1, q.y1);
  }
  return b;
}

/** Signed distance of the whole shape at one point (slow path; for probing). */
export function shapeSdf(s: Shape, x: number, y: number): number {
  let d = 1;
  for (const p of s.prims) d = smin(d, primSdf(p, x, y), s.k);
  return d;
}

let distBuf = new Float32Array(0);

function pixelRect(b: Bounds, rcv: Receiver, pad: number): Rect | null {
  const r = {
    x0: Math.floor(rcv.ox + b.x0 * rcv.sx) - pad,
    y0: Math.floor(rcv.oy + b.y0 * rcv.sy) - pad,
    x1: Math.ceil(rcv.ox + b.x1 * rcv.sx) + pad,
    y1: Math.ceil(rcv.oy + b.y1 * rcv.sy) + pad,
  };
  const c = rcv.clip;
  const out = {
    x0: Math.max(r.x0, c.x0),
    y0: Math.max(r.y0, c.y0),
    x1: Math.min(r.x1, c.x1),
    y1: Math.min(r.y1, c.y1),
  };
  return out.x1 > out.x0 && out.y1 > out.y0 ? out : null;
}

/** Pixel bounds a shape would touch in a receiver (null: none). */
export function shapePixelRect(s: Shape, rcv: Receiver): Rect | null {
  const b = shapeBounds(s);
  return pixelRect({ x0: b.x0 - s.k, y0: b.y0 - s.k, x1: b.x1 + s.k, y1: b.y1 + s.k }, rcv, 2);
}

/**
 * Rasterize a shape into a receiver as a Layer (caller composites and
 * releases it). Null when the shape misses the receiver.
 */
export function rasterizeShape(s: Shape, rcv: Receiver): Layer | null {
  const rect = shapePixelRect(s, rcv);
  if (!rect) return null;
  const W = rect.x1 - rect.x0;
  const H = rect.y1 - rect.y0;
  const n = W * H;
  if (distBuf.length < n) distBuf = new Float32Array(Math.ceil(n * 1.25));
  const D = distBuf;
  D.fill(1, 0, n);
  const isx = 1 / rcv.sx;
  const isy = 1 / rcv.sy;

  // stamp every primitive over its own bounds (cost ∝ total primitive area)
  for (const p of s.prims) {
    const pb = primBounds(p);
    const pr = pixelRect({ x0: pb.x0 - s.k, y0: pb.y0 - s.k, x1: pb.x1 + s.k, y1: pb.y1 + s.k }, rcv, 2);
    if (!pr) continue;
    const x0 = Math.max(pr.x0, rect.x0);
    const x1 = Math.min(pr.x1, rect.x1);
    const y0 = Math.max(pr.y0, rect.y0);
    const y1 = Math.min(pr.y1, rect.y1);
    for (let py = y0; py < y1; py++) {
      const sy = (py + 0.5 - rcv.oy) * isy;
      let j = (py - rect.y0) * W + (x0 - rect.x0);
      for (let px = x0; px < x1; px++, j++) {
        const d = primSdf(p, (px + 0.5 - rcv.ox) * isx, sy);
        const cur = D[j];
        D[j] = d < cur - s.k ? d : smin(cur, d, s.k);
      }
    }
  }

  const L = acquireLayer().reset(rect, true);
  L.glaze = s.glaze;
  const pxPerM = 0.5 * (rcv.sx + rcv.sy);
  const [r0, g0, b0] = s.color;
  const core = s.core;
  const coreDepth = s.coreDepth ?? 0.01;
  const poolF = 1 / s.poolSize;
  const sag = s.sag ?? 0;
  const sagSize = s.sagSize ?? 0.1;
  const cap = s.cap ?? 0;
  const cen = s.centre;
  const flow = s.flow;
  const det = s.detail;
  const TAU = Math.PI * 2;
  for (let py = rect.y0; py < rect.y1; py++) {
    const sy = (py + 0.5 - rcv.oy) * isy;
    let j = (py - rect.y0) * W;
    for (let px = rect.x0; px < rect.x1; px++, j++) {
      const d = D[j];
      const edge = clamp(0.5 - d * pxPerM, 0, 1);
      if (edge <= 0) continue;
      const sx = (px + 0.5 - rcv.ox) * isx;
      const depth = Math.max(0, -d);
      let th: number;
      if (cap > 0) {
        const u = Math.min(1, depth / cap);
        th = Math.sqrt(u * (2 - u));
      } else th = 1 - Math.exp(-depth / s.lambda);
      if (s.rimAmp > 0) {
        const q = (depth - s.rimAt) / s.rimW;
        th += s.rimAmp * Math.exp(-q * q);
      }
      if (cen) {
        const dx = (sx - cen.x) / cen.r;
        const dy = (sy - cen.y) / cen.r;
        th *= 1 - cen.thin * Math.exp(-(dx * dx + dy * dy));
      }
      if (flow) {
        // ridges radiating from the impact (blended across the angle seam)
        const fx = sx - flow.x;
        const fy = sy - flow.y;
        const dist = Math.sqrt(fx * fx + fy * fy);
        // wandering, not ruled: the angle is warped by position
        let a = Math.atan2(fy, fx) + 0.6 * (vnoise(sx * 45, sy * 45, s.seed + 23) - 0.5);
        if (a < 0) a += TAU;
        if (a >= TAU) a -= TAU;
        const rr = dist * 22;
        const f = flow.n / TAU;
        let n = vnoise(a * f, rr, s.seed + 17);
        if (a > TAU - 0.4) n += (vnoise((a - TAU) * f, rr, s.seed + 17) - n) * smoothstep(TAU - 0.4, TAU, a);
        th *= 1 + flow.amp * (2 * n - 1) * smoothstep(0, 0.03, dist);
      }
      if (s.pool > 0) th *= 1 + s.pool * (2 * fbm(sx * poolF, sy * poolF, s.seed, 2) - 1);
      if (det) {
        const q = 1 / det.size;
        th *= 1 + det.amp * (1.4 * vnoise(sx * q, sy * q, s.seed + 29) + 0.6 * vnoise(sx * q * 2.7, sy * q * 2.7, s.seed + 31) - 1);
      }
      if (sag) th *= 1 + sag * clamp(sy / sagSize, -0.6, 1);
      th = Math.max(0, th) * s.tMax;
      const tEdge = th * edge;
      const opaque = clamp(s.thinAlpha + (1 - s.thinAlpha) * (th / (0.3 * s.tMax + 1e-6)), 0, 1);
      L.a[j] = edge * opaque * s.alpha;
      L.f[j] = edge;
      L.t[j] = tEdge;
      // thicker paint reads a touch deeper in tone
      const shade = 1 - 0.1 * clamp(th / (s.tMax + 1e-6), 0, 1.5);
      let r = r0;
      let g = g0;
      let b = b0;
      if (core) {
        const c = smoothstep(0, coreDepth, depth);
        r = r + (core[0] - r) * c;
        g = g + (core[1] - g) * c;
        b = b + (core[2] - b) * c;
      }
      L.rgb[j * 3] = r * shade;
      L.rgb[j * 3 + 1] = g * shade;
      L.rgb[j * 3 + 2] = b * shade;
    }
  }
  return L;
}

/** Composite a static shape into a receiver's surface (base + shown). */
export function stampShape(s: Shape, rcv: Receiver, now: number): void {
  const L = rasterizeShape(s, rcv);
  if (!L) return;
  rcv.surface.addStatic(L, now);
  releaseLayer(L);
}

// --------------------------------------------------------------- drips

/** A run of paint (or a sliding yolk) growing down the surface. */
export interface DripSpec {
  /** start (m, splat space): a little inside the body's lower edge */
  x: number;
  y: number;
  /** trail width at the start (m) */
  w: number;
  /** final length (m) */
  len: number;
  /** growth time constant (s): len(t) = len·(1 − e^(−t/τ)) */
  tau: number;
  delay: number;
  /** bead radius at the tip (m) */
  bead: number;
  color: RGB;
  beadColor?: RGB;
  beadCore?: RGB;
  tMax: number;
  alpha: number;
  glaze: number;
  /** trail opacity (yolk smears are streaky and partial) */
  trailAlpha: number;
  trailStreak: number;
  /** sideways wander amplitude (m) */
  wobble: number;
  /** the trail flares up into the splat it leaves (paint); a yolk starts clean */
  flare?: boolean;
  /** bead height / width (a paint bead hangs, a yolk is rounder) */
  beadStretch?: number;
  /** the bead is a dome (an intact yolk), not a flat-topped bead */
  beadCap?: boolean;
  seed: number;
}

/** Everything a throw leaves behind on one surface plane. */
export interface SplatPlan {
  shapes: Shape[];
  drips: DripSpec[];
  /** metres, including the full length of every drip */
  extent: Bounds;
  /** egg: a brown one (its shell bits and shards match) */
  brown?: boolean;
}

function planExtent(shapes: Shape[], drips: DripSpec[]): Bounds {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const s of shapes) {
    const q = shapeBounds(s);
    b.x0 = Math.min(b.x0, q.x0 - s.k);
    b.y0 = Math.min(b.y0, q.y0 - s.k);
    b.x1 = Math.max(b.x1, q.x1 + s.k);
    b.y1 = Math.max(b.y1, q.y1 + s.k);
  }
  for (const d of drips) {
    const r = Math.max(d.w, d.bead * 1.4) + d.wobble;
    b.x0 = Math.min(b.x0, d.x - r);
    b.x1 = Math.max(b.x1, d.x + r);
    b.y0 = Math.min(b.y0, d.y - d.w);
    b.y1 = Math.max(b.y1, d.y + d.len + d.bead * 1.5);
  }
  return b;
}

// ------------------------------------------------------------- builders

function bodyTable(
  r: Rng,
  R: number,
  harmonics: { from: number; to: number; amp: number; fall: number },
  lobes: { n: number; amp: number; width: number },
  bays: { n: number; amp: number; width: number },
): { table: Float32Array; rmax: number } {
  const t = new Float32Array(TABLE_N);
  const amps: number[] = [];
  const phs: number[] = [];
  for (let k = harmonics.from; k <= harmonics.to; k++) {
    amps.push((harmonics.amp * (0.4 + 0.6 * r())) / Math.pow(k / harmonics.from, harmonics.fall));
    phs.push(r() * Math.PI * 2);
  }
  const lob = Array.from({ length: lobes.n }, () => ({ at: r() * Math.PI * 2, a: lobes.amp * (0.5 + r()), w: lobes.width * (0.6 + 0.8 * r()) }));
  const bay = Array.from({ length: bays.n }, () => ({ at: r() * Math.PI * 2, a: bays.amp * (0.5 + r()), w: bays.width * (0.6 + 0.8 * r()) }));
  let rmax = 0;
  for (let i = 0; i < TABLE_N; i++) {
    const phi = (i / TABLE_N) * Math.PI * 2;
    let v = 1;
    for (let k = 0; k < amps.length; k++) v += amps[k] * Math.cos((harmonics.from + k) * phi + phs[k]);
    for (const l of lob) {
      let d = Math.abs(phi - l.at);
      d = Math.min(d, Math.PI * 2 - d);
      v += l.a * Math.exp(-((d / l.w) ** 2));
    }
    for (const l of bay) {
      let d = Math.abs(phi - l.at);
      d = Math.min(d, Math.PI * 2 - d);
      v -= l.a * Math.exp(-((d / l.w) ** 2));
    }
    t[i] = R * Math.max(0.45, v);
    rmax = Math.max(rmax, t[i]);
  }
  return { table: t, rmax };
}

/** Body boundary radius along a world-space angle (approximate, for placing fingers). */
function bodyRadiusAt(b: BodyPrim, phi: number): number {
  // direction in body frame, un-stretched
  const cx = Math.cos(phi);
  const cy = Math.sin(phi);
  const u = (cx * b.ca + cy * b.sa) / b.ex;
  const v = (-cx * b.sa + cy * b.ca) / b.ey;
  const len = Math.hypot(u, v);
  let a = Math.atan2(v, u) * (TABLE_N / (2 * Math.PI));
  if (a < 0) a += TABLE_N;
  return b.table[Math.round(a) % TABLE_N] / len;
}

/** Sample an angle biased toward `theta` by `bias` (0: uniform). */
function biasedAngle(r: Rng, theta: number, bias: number): number {
  if (r() < bias) return theta + gauss(r) * 1.1;
  return r() * Math.PI * 2;
}

function ellipseAlong(cx: number, cy: number, ang: number, along: number, across: number): EllipsePrim {
  return { k: ELLIPSE, cx, cy, ca: Math.cos(ang), sa: Math.sin(ang), rx: along, ry: across };
}

/** Lowest point (largest y) of a shape at abscissa x, staying `margin` inside it. */
function bottomAt(s: Shape, x: number, yFrom: number, yTo: number, margin: number): number | null {
  let last: number | null = null;
  const step = 0.0015;
  for (let y = yFrom; y <= yTo; y += step) {
    if (shapeSdf(s, x, y) < -margin) last = y;
  }
  return last;
}

export interface PaintThrow {
  seed: number;
  /** main body radius (m) */
  radius: number;
  /** impact direction along the surface (splat space, unit) */
  dirX: number;
  dirY: number;
  /** 0 head-on … 1 grazing */
  oblique: number;
  /** the surface is wall-like: paint runs */
  vertical: boolean;
  color: RGB;
  /** 0..1 how much paint (drips, satellite count) */
  amount: number;
}

export function buildPaintSplat(p: PaintThrow): SplatPlan {
  const r = rng(p.seed);
  const R = p.radius;
  const e = clamp(p.oblique, 0, 0.85);
  const theta = Math.atan2(p.dirY, p.dirX);
  // a thrown cupful is never round: some stretch of its own, plus the angle of attack
  const own = r() * Math.PI * 2;
  const ownS = 0.1 + 0.18 * r();
  const ax = Math.cos(theta) * e * 1.6 + Math.cos(own) * ownS;
  const ay = Math.sin(theta) * e * 1.6 + Math.sin(own) * ownS;
  const stretch = Math.hypot(ax, ay);
  const sAng = Math.atan2(ay, ax);
  const prims: Prim[] = [];

  const { table, rmax } = bodyTable(
    r,
    R,
    { from: 2, to: 40, amp: 0.075, fall: 0.75 },
    { n: 4 + Math.floor(r() * 6), amp: 0.17, width: 0.11 },
    { n: 3 + Math.floor(r() * 4), amp: 0.15, width: 0.14 },
  );
  const body: BodyPrim = {
    k: BODY,
    cx: Math.cos(theta) * R * 0.22 * e,
    cy: Math.sin(theta) * R * 0.22 * e,
    ca: Math.cos(sAng),
    sa: Math.sin(sAng),
    ex: 1 + 0.5 * stretch,
    ey: 1 - 0.12 * stretch,
    table,
    rmax,
  };
  prims.push(body);
  // a cupful rarely lands as one mass: lumps that merged with the body
  const nLumps = 1 + Math.floor(r() * 3);
  for (let i = 0; i < nLumps; i++) {
    if (r() > 0.8) continue;
    const a = r() * Math.PI * 2;
    const d = bodyRadiusAt(body, a) * (0.5 + 0.35 * r());
    const t2 = bodyTable(
      r,
      R * (0.26 + 0.26 * r()),
      { from: 2, to: 20, amp: 0.1, fall: 0.8 },
      { n: 3, amp: 0.16, width: 0.12 },
      { n: 1, amp: 0.12, width: 0.15 },
    );
    prims.push({ k: BODY, cx: body.cx + Math.cos(a) * d, cy: body.cy + Math.sin(a) * d, ca: 1, sa: 0, ex: 1, ey: 1, table: t2.table, rmax: t2.rmax });
  }

  /** A two-segment tapered jet leaving the rim, slightly bent. */
  const jet = (phi: number, len: number, ra: number, rb: number, bend: number) => {
    const rb0 = bodyRadiusAt(body, phi);
    const a0 = phi + gauss(r) * 0.18;
    const sx0 = body.cx + Math.cos(phi) * rb0 * 0.8;
    const sy0 = body.cy + Math.sin(phi) * rb0 * 0.8;
    const l1 = len * (0.45 + 0.2 * r());
    const mx = sx0 + Math.cos(a0) * l1;
    const my = sy0 + Math.sin(a0) * l1;
    const rm = ra + (rb - ra) * 0.55;
    prims.push({ k: CAPSULE, ax: sx0, ay: sy0, bx: mx, by: my, ra, rb: rm });
    const a1 = a0 + bend;
    const ex = mx + Math.cos(a1) * (len - l1);
    const ey = my + Math.sin(a1) * (len - l1);
    prims.push({ k: CAPSULE, ax: mx, ay: my, bx: ex, by: ey, ra: rm, rb });
    return { ex, ey, ang: a1 };
  };

  // crown: short fingers of very uneven length scalloping the rim, most
  // ending in a bulb where surface tension gathered the paint
  const ncrown = Math.round(10 + 14 * r());
  for (let i = 0; i < ncrown; i++) {
    const phi = biasedAngle(r, theta, e * 0.5);
    const down = Math.max(0, Math.cos(phi - theta));
    const len = R * (0.03 + 0.22 * r() * r()) * (1 + 1.4 * e * down);
    const ra = R * (0.015 + 0.035 * r());
    const rb = ra * (0.45 + 0.3 * r());
    const t = jet(phi, len + bodyRadiusAt(body, phi) * 0.2, ra, rb, gauss(r) * 0.25);
    const rd = rb * (1.2 + 0.6 * r());
    const g = r() < 0.45 ? rd * (1.2 + 2.5 * r()) : rd * 0.3;
    prims.push(ellipseAlong(t.ex + Math.cos(t.ang) * g, t.ey + Math.sin(t.ang) * g, t.ang, rd * 1.25, rd));
  }
  // longer jets that broke into beads
  const njet = Math.round(4 + 7 * r());
  for (let i = 0; i < njet; i++) {
    const phi = biasedAngle(r, theta, e * 0.6);
    const down = Math.max(0, Math.cos(phi - theta));
    const len = R * (0.22 + 0.55 * Math.pow(r(), 1.3)) * (1 + 1.8 * e * down);
    const ra = R * (0.018 + 0.03 * r());
    const t = jet(phi, len + bodyRadiusAt(body, phi) * 0.2, ra, ra * 0.4, gauss(r) * 0.3);
    let dist = ra * (0.6 + 1.5 * r());
    let rr = ra * (0.5 + 0.5 * r());
    const m = 1 + Math.floor(r() * 3);
    for (let k = 0; k < m; k++) {
      prims.push(ellipseAlong(t.ex + Math.cos(t.ang) * dist, t.ey + Math.sin(t.ang) * dist, t.ang + gauss(r) * 0.2, rr * (1.2 + 0.6 * r()), rr));
      dist += rr * (2.2 + 3.5 * r());
      rr *= 0.5 + 0.3 * r();
    }
  }
  // spray: rays of small elongated droplets flung from the rim
  const nl = Math.round(3 + 5 * r() + e * 8);
  for (let i = 0; i < nl; i++) {
    const phi = biasedAngle(r, theta, 0.3 + e * 0.5);
    const rb0 = bodyRadiusAt(body, phi);
    let dist = rb0 * (1.05 + 0.1 * r());
    let rd = 0.0012 + 0.0022 * r();
    const m = 3 + Math.floor(r() * 6);
    for (let k = 0; k < m && rd > 0.0003; k++) {
      const a = phi + gauss(r) * 0.04;
      prims.push(ellipseAlong(body.cx + Math.cos(a) * dist, body.cy + Math.sin(a) * dist, a, rd * (1.6 + 1.4 * r() + 2 * e), rd));
      dist += rd * (3 + 5 * r()) * (1 + e);
      rd *= 0.72 + 0.2 * r();
    }
  }

  // satellite droplets thrown clear of the body: elongated along their flight,
  // the narrow tail pointing the way they were going
  const ns = Math.round((50 + 80 * r()) * (0.6 + 0.6 * p.amount));
  for (let i = 0; i < ns; i++) {
    const phi = biasedAngle(r, theta, e * 0.65);
    const down = Math.max(0, Math.cos(phi - theta));
    const reach = 1.04 + 0.65 * -Math.log(1 - r() * 0.97) * (1 + 1.6 * e * down);
    const rb0 = bodyRadiusAt(body, phi);
    const dist = rb0 * reach;
    const rd = (R * 0.03 * (0.15 + 1.3 * r() * r() * r())) / (1 + 0.6 * (reach - 1));
    const aspect = 1 + (reach - 1) * 0.6 * r() + 1.2 * e * down;
    const ang = phi + gauss(r) * 0.12;
    const cx = body.cx + Math.cos(phi) * dist;
    const cy = body.cy + Math.sin(phi) * dist;
    prims.push(ellipseAlong(cx, cy, ang, rd * aspect, rd));
    if (rd > 0.0008 && r() < 0.6) {
      const tl = rd * aspect * (0.8 + 1.6 * r());
      prims.push({
        k: CAPSULE,
        ax: cx,
        ay: cy,
        bx: cx + Math.cos(ang) * (rd * aspect + tl),
        by: cy + Math.sin(ang) * (rd * aspect + tl),
        ra: rd * 0.55,
        rb: rd * 0.12,
      });
    }
    if (r() < 0.15) {
      // cast-off: a smaller drop beyond the tail
      const td = rd * aspect * (2.4 + 1.5 * r());
      prims.push(ellipseAlong(cx + Math.cos(ang) * td, cy + Math.sin(ang) * td, ang, rd * 0.45, rd * 0.36));
    }
  }

  // fine mist
  const nm = Math.round(80 + 100 * r());
  for (let i = 0; i < nm; i++) {
    const phi = biasedAngle(r, theta, e * 0.5);
    const dist = R * (1.0 + 1.5 * r() * r() * (1 + e));
    const rd = 0.0003 + 0.0008 * r();
    prims.push(ellipseAlong(body.cx + Math.cos(phi) * dist, body.cy + Math.sin(phi) * dist, phi, rd * (1 + r()), rd));
  }

  const shape: Shape = {
    prims,
    k: 0.0026,
    color: p.color,
    tMax: 0.24 + 0.08 * p.amount,
    lambda: 0.0011,
    rimAt: 0.0035,
    rimW: 0.0032,
    rimAmp: 0.45,
    pool: 0.16,
    poolSize: 0.06,
    centre: { x: body.cx * 0.5, y: body.cy * 0.5, r: R * 0.6, thin: 0.38 },
    flow: { x: body.cx * 0.5, y: body.cy * 0.5, amp: 0.1, n: 56 },
    detail: { amp: 0.2, size: 0.006 },
    sag: p.vertical ? 0.35 : 0,
    sagSize: R,
    alpha: 1,
    thinAlpha: 0.72,
    glaze: 0,
    seed: p.seed,
  };

  const drips: DripSpec[] = [];
  if (p.vertical) {
    const nd = clamp(Math.round((1.5 + 5.5 * p.amount) * (0.55 + 0.9 * r())), 2, 10);
    const used: number[] = [];
    for (let i = 0; i < nd * 4 && drips.length < nd; i++) {
      const x = body.cx + gauss(r) * R * 1.1;
      const w = R * (0.03 + 0.05 * r() * r()) * (0.75 + 0.5 * p.amount);
      if (used.some((u) => Math.abs(u - x) < w * 1.8)) continue;
      const y = bottomAt(shape, x, body.cy - R * 0.2, body.cy + R * 2.6, w * 0.9);
      if (y === null) continue;
      used.push(x);
      drips.push(paintDrip(r, x, y - w * 0.4, w, R, p.amount, p.color, p.seed));
    }
  }
  return { shapes: [shape], drips, extent: planExtent([shape], drips) };
}

function paintDrip(r: Rng, x: number, y: number, w: number, R: number, amount: number, color: RGB, seed: number): DripSpec {
  const len = R * (0.3 + 2.6 * Math.pow(r(), 2.1)) * (0.55 + 0.8 * amount);
  return {
    x,
    y,
    w,
    len,
    tau: 0.7 + 1.6 * r() + len * 3,
    delay: 0.1 + 0.55 * r(),
    bead: w * (0.62 + 0.18 * r()),
    color,
    tMax: 0.3,
    alpha: 1,
    glaze: 0,
    trailAlpha: 1,
    trailStreak: 0,
    wobble: w * (0.15 + 0.35 * r()),
    seed: (seed ^ Math.floor(r() * 0x7fffffff)) >>> 0,
  };
}

// ---------------------------------------------------------------- eggs

export interface EggThrow {
  seed: number;
  dirX: number;
  dirY: number;
  oblique: number;
  vertical: boolean;
}

const ALBUMEN: RGB = [226, 206, 140];
const ALBUMEN_THICK: RGB = [236, 226, 196];
const YOLK: RGB = [246, 170, 18];
const YOLK_CORE: RGB = [230, 118, 8];
const YOLK_TINT: RGB = [240, 186, 50];
const SHELL: RGB = [242, 234, 218];
const SHELL_BROWN: RGB = [206, 152, 104];

export function buildEggSplat(p: EggThrow): SplatPlan {
  const r = rng(p.seed);
  const e = clamp(p.oblique, 0, 0.8);
  const theta = Math.atan2(p.dirY, p.dirX);
  const ca = Math.cos(theta);
  const sa = Math.sin(theta);
  const R = 0.05 + 0.022 * r();
  const shapes: Shape[] = [];

  // egg white: a viscous, lobed pool with a few fat fingers
  const { table, rmax } = bodyTable(
    r,
    R,
    { from: 2, to: 9, amp: 0.12, fall: 0.9 },
    { n: 3 + Math.floor(r() * 3), amp: 0.3, width: 0.32 },
    { n: 1 + Math.floor(r() * 2), amp: 0.16, width: 0.3 },
  );
  const body: BodyPrim = { k: BODY, cx: ca * R * 0.2 * e, cy: sa * R * 0.2 * e, ca, sa, ex: 1 + 0.6 * e, ey: 1 - 0.12 * e, table, rmax };
  const white: Prim[] = [body];
  const nf = 3 + Math.floor(r() * 4);
  for (let i = 0; i < nf; i++) {
    const phi = biasedAngle(r, theta, 0.3 + e * 0.5);
    const rb0 = bodyRadiusAt(body, phi);
    const len = R * (0.2 + 0.45 * r()) * (1 + e);
    const ra = R * (0.12 + 0.1 * r());
    const sx0 = body.cx + Math.cos(phi) * rb0 * 0.7;
    const sy0 = body.cy + Math.sin(phi) * rb0 * 0.7;
    const ex = sx0 + Math.cos(phi) * len;
    const ey = sy0 + Math.sin(phi) * len;
    white.push({ k: CAPSULE, ax: sx0, ay: sy0, bx: ex, by: ey, ra, rb: ra * 0.55 });
  }
  const nsat = 6 + Math.floor(r() * 10);
  for (let i = 0; i < nsat; i++) {
    const phi = biasedAngle(r, theta, e * 0.6);
    const dist = bodyRadiusAt(body, phi) * (1.1 + 0.6 * r());
    const rd = R * (0.04 + 0.08 * r() * r());
    white.push(ellipseAlong(body.cx + Math.cos(phi) * dist, body.cy + Math.sin(phi) * dist, phi, rd * (1.2 + r()), rd));
  }
  shapes.push({
    prims: white,
    k: 0.006,
    color: ALBUMEN,
    tMax: 0.4,
    lambda: 0.003,
    rimAt: 0.003,
    rimW: 0.0045,
    rimAmp: 0.4,
    pool: 0.3,
    poolSize: 0.035,
    detail: { amp: 0.35, size: 0.006 },
    alpha: 0.1,
    thinAlpha: 1,
    glaze: 1,
    seed: p.seed + 1,
  });

  // the yolk sits a little downstream of the impact
  const yx = body.cx + ca * R * 0.18 * (0.5 + e) + gauss(r) * R * 0.15;
  const yy = body.cy + sa * R * 0.18 * (0.5 + e) + gauss(r) * R * 0.15;
  const broken = r() < 0.62;
  const yr = broken ? 0.016 + 0.006 * r() : 0.0135 + 0.0025 * r();

  // thick white hugging the yolk
  shapes.push({
    prims: [ellipseAlong(yx, yy, r() * 6.28, yr * (2.1 + 0.5 * r()), yr * (1.7 + 0.4 * r()))],
    k: 0.004,
    color: ALBUMEN_THICK,
    tMax: 0.6,
    lambda: 0.006,
    rimAt: 0,
    rimW: 1,
    rimAmp: 0,
    pool: 0.2,
    poolSize: 0.02,
    detail: { amp: 0.25, size: 0.005 },
    alpha: 0.035,
    thinAlpha: 1,
    glaze: 1,
    seed: p.seed + 2,
  });

  // flakes of shell caught in the white
  const nbits = 3 + Math.floor(r() * 5);
  const bits: Prim[] = [];
  for (let i = 0; i < nbits; i++) {
    const a = r() * Math.PI * 2;
    const d = R * (0.25 + 0.75 * r());
    const size = 0.0025 + 0.0055 * r();
    bits.push({ k: POLY, pts: shardOutline(r, body.cx + Math.cos(a) * d, body.cy + Math.sin(a) * d, size) });
  }
  const brown = r() < 0.35;

  const drips: DripSpec[] = [];
  if (broken) {
    // the yolk burst: a glossy, irregular orange pool, a faint yellow cloud
    // bleeding into the white round it
    const tint = bodyTable(r, yr * 1.7, { from: 2, to: 10, amp: 0.16, fall: 0.8 }, { n: 3, amp: 0.3, width: 0.3 }, { n: 1, amp: 0.2, width: 0.3 });
    shapes.push({
      prims: [{ k: BODY, cx: yx + gauss(r) * 0.005, cy: yy + 0.004, ca: 1, sa: 0, ex: 1.1, ey: 1.2, table: tint.table, rmax: tint.rmax }],
      k: 0.004,
      color: YOLK_TINT,
      tMax: 0,
      lambda: 0.01,
      rimAt: 0,
      rimW: 1,
      rimAmp: 0,
      pool: 0,
      poolSize: 1,
      alpha: 0.22,
      thinAlpha: 1,
      glaze: 0.6,
      seed: p.seed + 3,
    });
    shapes.push(yolkShape(r, yx, yy, yr, true, p.seed + 5));
    if (p.vertical) {
      // runs of yolk, slow and thick
      const nd = 1 + Math.floor(r() * 3);
      for (let i = 0; i < nd; i++) {
        const w = yr * (0.35 + 0.3 * r());
        const x = yx + (i - (nd - 1) / 2) * yr * 0.9 + gauss(r) * yr * 0.2;
        const len = 0.025 + 0.07 * Math.pow(r(), 1.3);
        drips.push({
          x,
          y: yy + yr * 0.55,
          w,
          len,
          tau: 2.2 + 2.2 * r() + len * 20,
          delay: 0.2 + 0.6 * r(),
          bead: w * (0.75 + 0.2 * r()),
          color: YOLK,
          beadColor: YOLK,
          beadCore: YOLK_CORE,
          tMax: 0.5,
          alpha: 1,
          glaze: 0.35,
          trailAlpha: 0.95,
          trailStreak: 0.15,
          wobble: w * 0.25,
          seed: p.seed + 20 + i,
        });
      }
    }
  } else if (p.vertical) {
    // the yolk held: a dome sliding slowly down, smearing a little behind it
    drips.push({
      x: yx,
      y: yy,
      w: yr * 2,
      len: 0.008 + 0.022 * r(),
      tau: 2.8 + 2.5 * r(),
      delay: 0.15 + 0.25 * r(),
      bead: yr,
      color: YOLK_TINT,
      beadColor: YOLK,
      beadCore: YOLK_CORE,
      tMax: 0.95,
      alpha: 1,
      glaze: 0.35,
      trailAlpha: 0.16,
      trailStreak: 0.6,
      wobble: 0.002,
      flare: false,
      beadStretch: 1.04,
      beadCap: true,
      seed: p.seed + 7,
    });
  } else {
    shapes.push(yolkShape(r, yx, yy, yr, false, p.seed + 5));
  }
  if (p.vertical) {
    // egg white runs: wide, slow, clear
    const whiteShape = shapes[0];
    const nd = 2 + Math.floor(r() * 3);
    const used: number[] = [yx];
    for (let i = 0; i < nd * 4 && drips.length < nd + 3; i++) {
      const x = body.cx + gauss(r) * R * 1.1;
      const w = 0.007 + 0.007 * r();
      if (used.some((u) => Math.abs(u - x) < w * 2)) continue;
      const y = bottomAt(whiteShape, x, body.cy - R * 0.3, body.cy + R * 2.4, w * 0.5);
      if (y === null) continue;
      used.push(x);
      const len = 0.05 + 0.22 * Math.pow(r(), 1.4);
      drips.push({
        x,
        y: y - w * 0.4,
        w,
        len,
        tau: 1.8 + 1.8 * r() + len * 5,
        delay: 0.25 + 0.9 * r(),
        bead: w * (0.75 + 0.2 * r()),
        color: ALBUMEN,
        tMax: 0.26,
        alpha: 0.07,
        glaze: 1,
        trailAlpha: 1,
        trailStreak: 0,
        wobble: w * 0.3,
        seed: p.seed + 11 + i,
      });
    }
  }
  shapes.push({
    prims: bits,
    k: 0,
    color: brown ? SHELL_BROWN : SHELL,
    tMax: 0.13,
    lambda: 0.0003,
    rimAt: 0,
    rimW: 1,
    rimAmp: 0,
    pool: 0,
    poolSize: 1,
    alpha: 1,
    thinAlpha: 1,
    glaze: 0,
    seed: p.seed + 4,
  });
  return { shapes, drips, extent: planExtent(shapes, drips), brown };
}

/** A jagged little polygon: a flake of shell (elong > 1: a sliver). */
function shardOutline(r: Rng, cx: number, cy: number, size: number, elong = 1): number[] {
  const nv = 4 + Math.floor(r() * 3);
  const pts: number[] = [];
  const rot = r() * Math.PI * 2;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let k = 0; k < nv; k++) {
    const ang = (k / nv) * Math.PI * 2 + gauss(r) * 0.35;
    const rr = size * (0.55 + 0.6 * r());
    const lx = Math.cos(ang) * rr * elong;
    const ly = Math.sin(ang) * rr;
    pts.push(cx + lx * c - ly * s, cy + lx * s + ly * c);
  }
  return pts;
}

function yolkShape(r: Rng, x: number, y: number, rad: number, broken: boolean, seed: number): Shape {
  const { table, rmax } = bodyTable(
    r,
    broken ? rad * 1.35 : rad,
    { from: 2, to: broken ? 9 : 6, amp: broken ? 0.12 : 0.03, fall: 1 },
    { n: broken ? 3 : 0, amp: 0.3, width: 0.35 },
    { n: broken ? 1 : 0, amp: 0.18, width: 0.35 },
  );
  return {
    prims: [{ k: BODY, cx: x, cy: y, ca: 1, sa: 0, ex: 1, ey: 1, table, rmax }],
    k: 0.002,
    color: YOLK,
    core: YOLK_CORE,
    coreDepth: rad * 0.8,
    tMax: broken ? 0.5 : 0.95,
    lambda: rad * 0.3,
    cap: broken ? 0 : rad,
    rimAt: broken ? rad * 0.25 : 0,
    rimW: rad * 0.2,
    rimAmp: broken ? 0.25 : 0,
    pool: broken ? 0.12 : 0.04,
    poolSize: 0.012,
    alpha: 1,
    thinAlpha: 1,
    glaze: 0.35,
    seed,
  };
}

// ----------------------------------------------------------- paintballs

export interface BallHit {
  seed: number;
  dirX: number;
  dirY: number;
  oblique: number;
  vertical: boolean;
  /** the fill */
  color: RGB;
  /** the gelatin shell */
  shell: RGB;
}

/**
 * A paintball bursting: a crisp, near-round mark (stretched into a teardrop
 * on a glancing hit), fine rays and a ring of spatter thrown out sideways,
 * a sliver or two of the shell skin stuck in the fill, short runs below.
 */
export function buildPaintballSplat(p: BallHit): SplatPlan {
  const r = rng(p.seed);
  const e = clamp(p.oblique, 0, 0.9);
  const theta = Math.atan2(p.dirY, p.dirX);
  const R = 0.016 + 0.008 * r();
  const prims: Prim[] = [];
  const { table, rmax } = bodyTable(r, R, { from: 3, to: 34, amp: 0.035, fall: 0.6 }, { n: 2, amp: 0.06, width: 0.2 }, { n: 1, amp: 0.05, width: 0.25 });
  const body: BodyPrim = {
    k: BODY,
    cx: Math.cos(theta) * R * 0.6 * e,
    cy: Math.sin(theta) * R * 0.6 * e,
    ca: Math.cos(theta),
    sa: Math.sin(theta),
    ex: 1 + 1.5 * e,
    ey: 1 - 0.15 * e,
    table,
    rmax,
  };
  prims.push(body);
  // rays: the fill squirting out sideways as the shell splits
  const nr = 10 + Math.floor(r() * 14);
  for (let i = 0; i < nr; i++) {
    const phi = biasedAngle(r, theta, 0.15 + e * 0.6);
    const down = Math.max(0, Math.cos(phi - theta));
    const rb0 = bodyRadiusAt(body, phi);
    const len = R * (0.2 + 1.0 * r() * r()) * (1 + 2.2 * e * down);
    const ra = R * (0.025 + 0.035 * r());
    const sx = body.cx + Math.cos(phi) * rb0 * 0.85;
    const sy = body.cy + Math.sin(phi) * rb0 * 0.85;
    const ang = phi + gauss(r) * 0.05;
    const ex = sx + Math.cos(ang) * len;
    const ey = sy + Math.sin(ang) * len;
    prims.push({ k: CAPSULE, ax: sx, ay: sy, bx: ex, by: ey, ra, rb: ra * (0.2 + 0.25 * r()) });
    if (r() < 0.5) {
      const rd = ra * (0.5 + 0.5 * r());
      const g = rd * (1.5 + 3 * r());
      prims.push(ellipseAlong(ex + Math.cos(ang) * g, ey + Math.sin(ang) * g, ang, rd * 1.4, rd));
    }
  }
  // the ring of fine spatter
  const ns = 60 + Math.floor(r() * 90);
  for (let i = 0; i < ns; i++) {
    const phi = biasedAngle(r, theta, 0.1 + e * 0.6);
    const down = Math.max(0, Math.cos(phi - theta));
    const dist = R * (1.5 + 1.8 * Math.pow(r(), 0.7)) * (1 + 1.6 * e * down);
    const rd = 0.0003 + 0.0011 * r() * r();
    const ang = phi + gauss(r) * 0.1;
    prims.push(ellipseAlong(body.cx + Math.cos(phi) * dist, body.cy + Math.sin(phi) * dist, ang, rd * (1.2 + 1.5 * r() + 2 * e * down), rd));
  }
  const fill: Shape = {
    prims,
    k: 0.0011,
    color: p.color,
    tMax: 0.16,
    lambda: 0.0005,
    rimAt: 0.0016,
    rimW: 0.0014,
    rimAmp: 0.35,
    pool: 0.1,
    poolSize: 0.02,
    centre: { x: body.cx, y: body.cy, r: R * 0.55, thin: 0.25 },
    flow: { x: body.cx, y: body.cy, amp: 0.12, n: 40 },
    detail: { amp: 0.12, size: 0.003 },
    sag: p.vertical ? 0.2 : 0,
    sagSize: R,
    alpha: 1,
    thinAlpha: 0.85,
    glaze: 0,
    seed: p.seed,
  };
  // shell skin: thin curved slivers lying in the fill
  const skin: Prim[] = [];
  const nk = 1 + Math.floor(r() * 3);
  for (let i = 0; i < nk; i++) {
    const a = r() * Math.PI * 2;
    const d = R * (0.2 + 0.7 * r());
    skin.push({ k: POLY, pts: shardOutline(r, body.cx + Math.cos(a) * d, body.cy + Math.sin(a) * d, 0.0014 + 0.0012 * r(), 2.2 + r()) });
  }
  const shell: Shape = {
    prims: skin,
    k: 0,
    color: p.shell,
    tMax: 0.1,
    lambda: 0.0003,
    rimAt: 0,
    rimW: 1,
    rimAmp: 0,
    pool: 0,
    poolSize: 1,
    alpha: 0.92,
    thinAlpha: 1,
    glaze: 0.5,
    seed: p.seed + 3,
  };
  const drips: DripSpec[] = [];
  if (p.vertical) {
    const nd = 1 + Math.floor(r() * 3);
    for (let i = 0; i < nd; i++) {
      const x = body.cx + gauss(r) * R * 0.9;
      const w = 0.002 + 0.0022 * r();
      const y = bottomAt(fill, x, body.cy - R * 0.3, body.cy + R * 2.5, w * 0.8);
      if (y === null) continue;
      const len = 0.008 + 0.03 * Math.pow(r(), 1.5);
      drips.push({
        x,
        y: y - w * 0.4,
        w,
        len,
        tau: 0.5 + 0.7 * r() + len * 10,
        delay: 0.15 + 0.4 * r(),
        bead: w * (0.65 + 0.2 * r()),
        color: p.color,
        tMax: 0.2,
        alpha: 1,
        glaze: 0,
        trailAlpha: 1,
        trailStreak: 0,
        wobble: w * 0.2,
        seed: p.seed + 40 + i,
      });
    }
  }
  return { shapes: [fill, shell], drips, extent: planExtent([fill, shell], drips) };
}
