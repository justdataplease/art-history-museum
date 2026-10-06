// Picture-frame geometry: one swept moulding profile per frame, mitred at
// the corners, built as a single BufferGeometry (one draw call per frame).
//
// A profile is a 2-D section through the moulding, listed from the sight
// edge (inside, over the painting) to the outer edge and back down to the
// wall. Coordinates are in metres:
//   d — distance outward from the painting's edge (negative = over the canvas)
//   z — height above the wall surface
// Sweeping it around the canvas rectangle as nested rectangles puts every
// corner on the 45° diagonal, so the mitres are exact; each side keeps its
// own vertices so the mitre line stays crisp.

import * as THREE from "three";
import type { FrameStyle } from "./theme";
import { WALL_GAP } from "./layout";

/** Carved-ornament band a profile segment belongs to (normal-map rows). */
export const BAND_NONE = 0;
export const BAND_LEAF = 1; // leaf-and-dart on an ogee / cove
export const BAND_BEAD = 2; // pearl bead

interface PP {
  d: number;
  z: number;
  /** Antiquing: 1 = clean high point, lower = dirt/patina in recesses. */
  ao: number;
  /** Roughness multiplier: < 1 burnished, > 1 matte recess. */
  r: number;
  /** Hard crease at this point (no normal smoothing across it). */
  sharp?: boolean;
  band?: number;
  /** Bole (red clay under gilding) showing through on worn high points, 0..1. */
  bole?: number;
}

interface Profile {
  pts: PP[];
  /** Nominal moulding width the profile was drawn at (m). */
  nominalWidth: number;
  /** Height of the painted surface above the wall (m), at nominal scale. */
  canvasZ: number;
  /** Floater: depth of the stretched canvas box (m). */
  canvasDepth?: number;
  /** Floater geometry does not scale with frame width / work size. */
  fixedScale?: boolean;
}

// ---------------------------------------------------------------- helpers

const P = (d: number, z: number, ao = 1, r = 1, extra: Partial<PP> = {}): PP => ({ d, z, ao, r, ...extra });

/** Circular arc (centre cd,cz; radius r) from angle a0 to a1 in degrees, angle 0 = +d, 90 = +z. */
function arc(
  cd: number,
  cz: number,
  rad: number,
  a0: number,
  a1: number,
  n: number,
  shade: (t: number) => { ao: number; r: number; bole?: number },
  band = BAND_NONE,
): PP[] {
  const out: PP[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = THREE.MathUtils.degToRad(a0 + (a1 - a0) * t);
    const s = shade(t);
    out.push({ d: cd + rad * Math.cos(a), z: cz + rad * Math.sin(a), ao: s.ao, r: s.r, bole: s.bole, band });
  }
  return out;
}

/** Sampled curve between two points with a shape function for z. */
function curve(
  d0: number,
  z0: number,
  d1: number,
  z1: number,
  n: number,
  shape: (t: number) => number,
  shade: (t: number) => { ao: number; r: number; bole?: number },
  band = BAND_NONE,
): PP[] {
  const out: PP[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = shade(t);
    out.push({ d: d0 + (d1 - d0) * t, z: z0 + (z1 - z0) * shape(t), ao: s.ao, r: s.r, bole: s.bole, band });
  }
  return out;
}

/** Join point lists, dropping a duplicated join point. */
function join(...parts: (PP | PP[])[]): PP[] {
  const out: PP[] = [];
  for (const part of parts) {
    const list = Array.isArray(part) ? part : [part];
    for (const p of list) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.d - p.d) < 1e-6 && Math.abs(last.z - p.z) < 1e-6) {
        // keep the crease / band of whichever says so
        last.sharp = last.sharp || p.sharp;
        if (p.band && !last.band) last.band = p.band;
        continue;
      }
      out.push({ ...p });
    }
  }
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const bump = (t: number) => Math.sin(Math.PI * t);
const hi = (t: number) => ({ ao: 0.9 + 0.1 * bump(t), r: 1 - 0.45 * bump(t), bole: 0.6 * Math.pow(bump(t), 6) });
const recess = (t: number) => ({ ao: 0.9 - 0.32 * bump(t), r: 1 + 0.45 * bump(t) });

// --------------------------------------------------------------- profiles

// Italian/French 17th-c. carved frame: high outer torus, hollow cove,
// carved leaf ogee running down to a pearl bead and a narrow sight lip.
const BAROQUE: Profile = {
  nominalWidth: 0.13,
  canvasZ: 0.034,
  pts: join(
    P(-0.007, 0.026, 0.7, 1.1, { sharp: true }),
    P(-0.007, 0.042, 0.82, 1.0, { sharp: true }),
    arc(-0.0035, 0.042, 0.0035, 180, 0, 5, hi),
    P(0.0015, 0.04, 0.62, 1.35, { sharp: true }),
    arc(0.0075, 0.04, 0.0058, 180, 0, 7, (t) => ({ ao: 0.78 + 0.2 * bump(t), r: 0.85 }), BAND_BEAD),
    P(0.0145, 0.039, 0.55, 1.45, { sharp: true }),
    // carved leaf ogee rising toward the hollow
    curve(0.0145, 0.039, 0.05, 0.07, 9, smooth, (t) => ({ ao: 0.74 + 0.2 * t, r: 1.05 - 0.2 * t }), BAND_LEAF),
    P(0.05, 0.07, 0.95, 0.65, { sharp: true }),
    P(0.056, 0.07, 0.9, 0.7, { sharp: true }),
    // hollow cove (matte, dusty)
    curve(0.056, 0.07, 0.09, 0.074, 8, (t) => t, recess).map((p, i, a) => ({
      ...p,
      z: p.z - 0.011 * Math.sin((Math.PI * i) / (a.length - 1)),
    })),
    P(0.09, 0.074, 0.8, 1.0, { sharp: true }),
    // great outer torus — burnished crown that catches the spot
    arc(0.106, 0.073, 0.016, 172, 18, 12, hi),
    // small outer bead and the drop back to the wall
    P(0.124, 0.074, 0.72, 1.25, { sharp: true }),
    arc(0.127, 0.0705, 0.003, 120, 0, 4, (t) => ({ ao: 0.86, r: 0.8 })),
    P(0.13, 0.064, 0.8, 1.0),
    P(0.13, 0.0, 0.5, 1.2, { sharp: true }),
  ),
};

// Early-Renaissance cassetta / tabernacle moulding: a wide flat gilded frieze
// between a small sight moulding and a raised outer bead.
const TABERNACLE: Profile = {
  nominalWidth: 0.12,
  canvasZ: 0.026,
  pts: join(
    P(-0.006, 0.018, 0.7, 1.1, { sharp: true }),
    P(-0.006, 0.033, 0.82, 1.0, { sharp: true }),
    arc(-0.0025, 0.033, 0.0035, 180, 0, 5, hi),
    P(0.002, 0.03, 0.7, 1.2, { sharp: true }),
    arc(0.0065, 0.03, 0.0045, 180, 0, 6, (t) => ({ ao: 0.8 + 0.18 * bump(t), r: 0.85 }), BAND_BEAD),
    P(0.011, 0.0285, 0.6, 1.35, { sharp: true }),
    P(0.014, 0.027, 0.75, 1.1, { sharp: true }),
    // flat burnished frieze, very slightly dished
    curve(0.014, 0.027, 0.088, 0.027, 8, (t) => 0, (t) => ({ ao: 0.94 + 0.04 * bump(t), r: 0.72 })).map((p, i, a) => ({
      ...p,
      z: p.z - 0.0015 * Math.sin((Math.PI * i) / (a.length - 1)),
    })),
    P(0.088, 0.027, 0.68, 1.3, { sharp: true }),
    P(0.091, 0.033, 0.75, 1.15, { sharp: true }),
    // raised outer bead
    arc(0.1025, 0.039, 0.0115, 170, 10, 12, hi),
    P(0.115, 0.036, 0.7, 1.25, { sharp: true }),
    P(0.12, 0.034, 0.8, 1.0, { sharp: true }),
    P(0.12, 0.0, 0.5, 1.2, { sharp: true }),
  ),
};

// 19th-c. composition gilt frame: sight bead, deep hollow sweeping up to a
// rounded crown, stepped flat outer edge.
const GILT_SIMPLE: Profile = {
  nominalWidth: 0.1,
  canvasZ: 0.03,
  pts: join(
    P(-0.006, 0.022, 0.7, 1.1, { sharp: true }),
    P(-0.006, 0.037, 0.82, 1.0, { sharp: true }),
    arc(-0.0025, 0.037, 0.0035, 180, 0, 5, hi),
    P(0.0015, 0.035, 0.66, 1.25, { sharp: true }),
    arc(0.0058, 0.035, 0.0043, 180, 0, 6, (t) => ({ ao: 0.8 + 0.18 * bump(t), r: 0.85 }), BAND_BEAD),
    P(0.0101, 0.034, 0.6, 1.35, { sharp: true }),
    // deep hollow, steepening toward the crown
    curve(0.0101, 0.034, 0.05, 0.061, 9, (t) => t * t, (t) => ({ ao: 0.66 + 0.3 * t, r: 1.3 - 0.4 * t }), BAND_LEAF),
    // rounded crown
    curve(0.05, 0.061, 0.078, 0.059, 8, (t) => t, hi).map((p, i, a) => ({
      ...p,
      z: p.z + 0.0075 * Math.sin((Math.PI * i) / (a.length - 1)),
    })),
    P(0.079, 0.055, 0.7, 1.25, { sharp: true }),
    P(0.093, 0.054, 0.88, 0.9, { sharp: true }),
    arc(0.0955, 0.0515, 0.0025, 90, 0, 3, (t) => ({ ao: 0.9, r: 0.8 })),
    P(0.098, 0.047, 0.82, 1.0),
    P(0.098, 0.0, 0.5, 1.2, { sharp: true }),
  ),
};

// Plain hardwood moulding: sight face, a gentle bevel up to a softened
// outer arris, square back edge.
const WOOD: Profile = {
  nominalWidth: 0.05,
  canvasZ: 0.026,
  pts: join(
    P(-0.005, 0.017, 0.8, 1.0, { sharp: true }),
    P(-0.005, 0.031, 0.95, 1.0, { sharp: true }),
    P(-0.002, 0.034, 1.0, 0.95),
    curve(-0.002, 0.034, 0.044, 0.04, 6, (t) => t, (t) => ({ ao: 1, r: 1 })),
    arc(0.044, 0.036, 0.004, 90, 0, 4, (t) => ({ ao: 1, r: 0.9 })),
    P(0.048, 0.034, 0.95, 1.0),
    P(0.048, 0.0, 0.75, 1.0, { sharp: true }),
  ),
};

// Floater tray: the canvas (a 35 mm stretched box) floats in a dark tray with
// a 10 mm shadow gap. The tray floor runs under the canvas.
const FLOATER: Profile = {
  nominalWidth: 0.016,
  canvasZ: 0.039,
  canvasDepth: 0.035,
  fixedScale: true,
  pts: join(
    P(-0.03, 0.004, 0.5, 1.0, { sharp: true }),
    P(0.01, 0.004, 0.45, 1.0, { sharp: true }),
    P(0.01, 0.031, 0.8, 1.0, { sharp: true }),
    P(0.0105, 0.032, 1.0, 1.0),
    P(0.0155, 0.032, 1.0, 1.0),
    P(0.016, 0.0315, 1.0, 1.0, { sharp: true }),
    P(0.016, 0.0, 0.75, 1.0, { sharp: true }),
  ),
};

const PROFILES: Record<FrameStyle, Profile> = {
  baroque: BAROQUE,
  tabernacle: TABERNACLE,
  "gilt-simple": GILT_SIMPLE,
  wood: WOOD,
  floater: FLOATER,
};

// --------------------------------------------------------------- geometry

export interface FrameBuild {
  geometry: THREE.BufferGeometry;
  /** Local z (exhibit group space, wall at -WALL_GAP) of the painted surface. */
  canvasZ: number;
  /** Floater: depth of the stretched canvas box; 0 for framed works. */
  canvasDepth: number;
  /** How far the frame reaches beyond the canvas edge (m). */
  outer: number;
  /** Highest point of the frame above the wall (m). */
  depth: number;
}

/** Scale factor for a work's frame: big canvases get proportionally heavier mouldings. */
export function frameScale(w: number, h: number): number {
  return THREE.MathUtils.clamp(0.45 + 0.3 * Math.max(w, h), 0.55, 2.4);
}

/** A frame's dimensions without its geometry (exactly what buildFrame returns). */
export function frameMetrics(
  style: FrameStyle,
  w: number,
  h: number,
  width: number,
  maxOuter = Infinity,
): Omit<FrameBuild, "geometry"> {
  const prof = PROFILES[style] ?? GILT_SIMPLE;
  const k = prof.fixedScale ? 1 : frameScale(w, h);
  const sw = prof.fixedScale ? 1 : Math.max(0.4, width / prof.nominalWidth);
  const lastD = prof.pts[prof.pts.length - 1].d;
  const sd = Math.min(k * sw, maxOuter / lastD);
  const sz = k * Math.sqrt(sw);
  let depth = 0;
  for (const p of prof.pts) depth = Math.max(depth, p.z * sz);
  return {
    canvasZ: prof.canvasZ * sz - WALL_GAP,
    canvasDepth: (prof.canvasDepth ?? 0) * sz,
    outer: Math.max(0, lastD * sd),
    depth,
  };
}

/**
 * Sweep the style's profile around a w × h canvas.
 * `width` is the theme's moulding width in metres (ignored for floaters);
 * `maxOuter` caps the moulding at what the layout budgeted for.
 */
export function buildFrame(style: FrameStyle, w: number, h: number, width: number, maxOuter = Infinity): FrameBuild {
  const prof = PROFILES[style] ?? GILT_SIMPLE;
  const k = prof.fixedScale ? 1 : frameScale(w, h);
  const sw = prof.fixedScale ? 1 : Math.max(0.4, width / prof.nominalWidth);
  const lastD = prof.pts[prof.pts.length - 1].d;
  const sd = Math.min(k * sw, maxOuter / lastD); // across-moulding scale
  const sz = k * Math.sqrt(sw); // depth scale
  const pts = prof.pts.map((p) => ({ ...p, d: p.d * sd, z: p.z * sz }));
  const n = pts.length;

  // per-segment 2-D normals (−dz, dd): up/out of the material
  const segN: [number, number][] = [];
  const segLen: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dd = pts[i + 1].d - pts[i].d;
    const dz = pts[i + 1].z - pts[i].z;
    const len = Math.hypot(dd, dz);
    segLen.push(len);
    segN.push(len > 1e-9 ? [-dz / len, dd / len] : [0, 1]);
  }
  const pointNormal = (i: number, seg: number): [number, number] => {
    if (pts[i].sharp) return segN[seg];
    const a = segN[Math.max(0, i - 1)];
    const b = segN[Math.min(n - 2, i)];
    const x = a[0] + b[0];
    const y = a[1] + b[1];
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };

  // arc length along the profile, and band-local coordinate for carving
  const arcAt: number[] = [0];
  for (let i = 0; i < n - 1; i++) arcAt.push(arcAt[i] + segLen[i]);
  const segBand: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const b = pts[i].band ?? 0;
    segBand.push(b && (pts[i + 1].band ?? 0) === b ? b : BAND_NONE);
  }
  // runs of identical band → [start arc, end arc]
  const bandSpan: [number, number][] = segBand.map(() => [0, 1]);
  for (let i = 0; i < n - 1; ) {
    let j = i;
    while (j + 1 < n - 1 && segBand[j + 1] === segBand[i]) j++;
    for (let q = i; q <= j; q++) bandSpan[q] = [arcAt[i], arcAt[j + 1]];
    i = j + 1;
  }
  // texture rows: leaf band spans v 0..0.5, bead band v 0.5..1
  const bandV = (seg: number, at: number): number => {
    const [a, b] = bandSpan[seg];
    const t = b > a ? (at - a) / (b - a) : 0;
    if (segBand[seg] === BAND_LEAF) return t * 0.5;
    if (segBand[seg] === BAND_BEAD) return 0.5 + t * 0.5;
    return 0;
  };

  const zOff = -WALL_GAP;
  const hw = w / 2;
  const hh = h / 2;
  // CCW corners of the rectangle offset outward by d
  const corner = (c: number, d: number): [number, number] => {
    const sx = c === 0 || c === 3 ? -1 : 1;
    const sy = c === 0 || c === 1 ? -1 : 1;
    return [sx * (hw + d), sy * (hh + d)];
  };
  const outward: [number, number][] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const uv1: number[] = [];
  const col: number[] = [];
  const attr: number[] = [];
  const idx: number[] = [];
  const BOLE = [0.86, 0.5, 0.36]; // bole tint (relative to the gilding)

  const pushVert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, u1: number, v1: number, p: PP, carve: number) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    uv.push(u, v);
    uv1.push(u1, v1);
    const b = p.bole ?? 0;
    col.push(
      p.ao * (1 + (BOLE[0] - 1) * b),
      p.ao * (1 + (BOLE[1] - 1) * b) * 0.985,
      p.ao * (1 + (BOLE[2] - 1) * b) * 0.96,
    );
    attr.push(p.r, carve);
  };

  for (let s = 0; s < 4; s++) {
    const [ox, oy] = outward[s];
    for (let i = 0; i < n - 1; i++) {
      if (segLen[i] < 1e-7) continue;
      const base = pos.length / 3;
      const carve = segBand[i] === BAND_NONE ? 0 : 1;
      for (const [pi, at] of [
        [i, arcAt[i]],
        [i + 1, arcAt[i + 1]],
      ] as const) {
        const p = pts[pi];
        const [nd, nz] = pointNormal(pi, i);
        const a = corner(s, p.d);
        const b = corner((s + 1) % 4, p.d);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const v1 = bandV(i, at);
        const nx = ox * nd;
        const ny = oy * nd;
        // u runs along the rail in metres (u1 scaled so carving scales with the frame)
        pushVert(a[0], a[1], p.z + zOff, nx, ny, nz, 0, at, 0, v1, p, carve);
        pushVert(b[0], b[1], p.z + zOff, nx, ny, nz, len, at, len / sd, v1, p, carve);
      }
      // rows: base = A_i, base+1 = B_i, base+2 = A_i+1, base+3 = B_i+1
      idx.push(base, base + 2, base + 3, base, base + 3, base + 1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("uv1", new THREE.Float32BufferAttribute(uv1, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("aFrame", new THREE.Float32BufferAttribute(attr, 2));
  g.computeBoundingSphere();
  g.computeBoundingBox();

  let depth = 0;
  for (const p of pts) depth = Math.max(depth, p.z);
  return {
    geometry: g,
    canvasZ: prof.canvasZ * sz + zOff,
    canvasDepth: (prof.canvasDepth ?? 0) * sz,
    outer: Math.max(0, pts[n - 1].d),
    depth,
  };
}
