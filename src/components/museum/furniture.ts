// The seating in the rooms, one set per room style: a bench down the middle of each room (visitors sit both
// ways, facing the side walls) and a piece against the walls (a pair of chairs, a settee, a chest bench) either
// side of the doors. Each set is modelled from primitives into three merged materials: upholstery, the frame
// (wood, lacquer, paint or steel) and an accent (gilt, brass, chrome, cane or black lacquer).
//
// Local coordinates: a bench is centred on the origin, long along z; a wall piece is centred on its footprint
// with the wall behind it at z = -depth / 2, facing +z. Metres; the floor is y = 0.

import * as THREE from "three";
import type { GeoBatch } from "./room-geometry";
import type { WallSeat } from "./layout";
import type { EraKey, GalleryTheme } from "./theme";

export type Part = "up" | "wood" | "metal";
type Batches = Record<Part, Pick<GeoBatch, "add" | "roundedBoxAt">>;
type V3 = [number, number, number];

const PI = Math.PI;

export interface FurnitureSet {
  /** What stands in the room, for the furniture study page. */
  name: string;
  /** Upholstery (velvet, leather, silk, felt). */
  up: { color: string; roughness: number };
  /** The frame: wood with grain, lacquer, painted wood or steel. */
  wood: { color: string; finish: "grain" | "lacquer" | "paint" | "steel" };
  /** Gilt, brass, chrome, bronze; or cane and black lacquer (metalness 0). */
  metal: { color: string; metalness: number; roughness: number };
  /** The centre bench: its footprint (across, along the hall) and how it is built. */
  bench: { size: [number, number]; build: (k: Kit, w: number, d: number) => void };
  /** The piece against the walls: how much wall it wants at most, its depth, and how it is built in the width
   *  the wall leaves. */
  wall: { width: number; depth: number; build: (k: Kit, width: number, depth: number) => void };
}

// ------------------------------------------------------------------- kit

/** Primitives placed in a piece's local frame, merged into the three batches. */
export class Kit {
  constructor(
    private out: Batches,
    private base: THREE.Matrix4
  ) {}

  /** A kit for a part of the piece moved (and turned about y) in its frame: one chair of a pair. */
  at(dx: number, dz: number, ry = 0): Kit {
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(dx, 0, dz);
    return new Kit(this.out, this.base.clone().multiply(m));
  }

  private place(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
    return new THREE.Matrix4()
      .compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(sx, sy, sz)
      )
      .premultiply(this.base);
  }

  /** A box centred at (x, y, z), rounded when r > 0, tilted about x by rx. */
  box(part: Part, w: number, h: number, d: number, x: number, y: number, z: number, r = 0, rx = 0, ry = 0): void {
    const m = this.place(x, y, z, rx, ry);
    if (r > 0) this.out[part].roundedBoxAt(w, h, d, r, r >= 0.03 ? 2 : 1, m);
    else this.out[part].add(new THREE.BoxGeometry(w, h, d), m);
  }

  /** An upright cylinder (frustum) standing at y0: radius rTop at the top, rBot at the foot. */
  post(part: Part, rTop: number, rBot: number, h: number, x: number, y0: number, z: number, seg = 10): void {
    this.out[part].add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1), this.place(x, y0 + h / 2, z));
  }

  /** A rod from a to b: radius r at a, r2 at b. */
  tube(part: Part, a: V3, b: V3, r: number, seg = 8, r2 = r): void {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const dir = B.clone().sub(A);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)).premultiply(this.base);
    this.out[part].add(new THREE.CylinderGeometry(r2, r, len, seg, 1), m);
  }

  /** A torus in the x-y plane (tilted about x by rx: PI / 2 lays it flat), stretched by sx, sy; `arc` from +x. */
  ring(part: Part, R: number, r: number, x: number, y: number, z: number, rx = 0, sx = 1, sy = 1, arc = 2 * PI, seg = 28): void {
    this.out[part].add(new THREE.TorusGeometry(R, r, 6, seg, arc), this.place(x, y, z, rx, 0, 0, sx, sy, 1));
  }

  ball(part: Part, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 10): void {
    this.out[part].add(new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.6))), this.place(x, y, z, 0, 0, 0, sx, sy, sz));
  }

  /** A flat round (or oval: sz) slab centred at (x, y, z); rx = PI / 2 stands it up facing +z. */
  disc(part: Part, r: number, h: number, x: number, y: number, z: number, rx = 0, sz = 1, seg = 28): void {
    this.out[part].add(new THREE.CylinderGeometry(r, r, h, seg, 1), this.place(x, y, z, rx, 0, 0, 1, 1, sz));
  }
}

// ---------------------------------------------------------------- pieces

/** A turned (baluster) leg from the floor to h: bun foot, shaft, knop, shaft, block. */
function turnedLeg(k: Kit, part: Part, x: number, z: number, h: number, r: number): void {
  k.ball(part, r * 1.25, x, r, z, 1, 0.8, 1, 8);
  k.post(part, r * 0.7, r * 0.95, h * 0.32, x, r * 1.6, z, 8);
  k.ball(part, r * 1.3, x, r * 2.2 + h * 0.32, z, 1, 0.75, 1, 8);
  k.post(part, r * 0.95, r * 0.7, Math.max(0.01, h * 0.56 - r * 2.8), x, r * 2.8 + h * 0.32, z, 8);
  k.box(part, r * 2.3, h * 0.12, r * 2.3, x, h * 0.94, z);
}

/** A cabriole leg: out at the knee, in at the ankle, a scroll foot; sx, sz point the knee outward. */
function cabriole(k: Kit, part: Part, x: number, z: number, h: number, sx: number, sz: number, r: number): void {
  const knee: V3 = [x + sx * 0.03, h * 0.7, z + sz * 0.03];
  const ankle: V3 = [x - sx * 0.012, 0.06, z - sz * 0.012];
  k.tube(part, knee, [x, h, z], r * 1.05, 8, r);
  k.ball(part, r * 1.05, ...knee, 1, 1, 1, 8);
  k.tube(part, ankle, knee, r * 0.55, 8, r * 1.05);
  k.ball(part, r * 0.95, x + sx * 0.002, 0.03, z + sz * 0.002, 1.25, 0.6, 1.25, 8);
}

/** A tapered, collared leg on a toupie foot under a die block (Louis XVI). */
function taperedLeg(k: Kit, part: Part, x: number, z: number, h: number, r: number): void {
  k.post(part, r * 0.6, r * 0.75, h * 0.06, x, 0, z);
  k.post(part, r, r * 0.55, h * 0.82, x, h * 0.06, z);
  k.post(part, r * 1.2, r * 1.2, 0.02, x, h * 0.8, z);
  k.box(part, r * 2.4, h * 0.12, r * 2.4, x, h * 0.94, z);
}

/** Two chairs against the wall, turned a little toward each other, or one where the wall is short. */
function pair(k: Kit, width: number, depth: number, chairW: number, chairD: number, chair: (k: Kit) => void): void {
  const z = -depth / 2 + chairD / 2 + 0.03;
  if (width + 1e-6 >= 2 * chairW + 0.3) {
    const x = Math.min(width / 2 - chairW / 2, chairW / 2 + 0.32);
    chair(k.at(-x, z, 0.1));
    chair(k.at(x, z, -0.1));
  } else {
    chair(k.at(0, z));
  }
}

// ----------------------------------------------------------------- chairs

function baroqueArmchair(k: Kit): void {
  k.box("up", 0.6, 0.11, 0.54, 0, 0.45, 0.03, 0.04);
  k.box("metal", 0.64, 0.07, 0.58, 0, 0.37, 0.02, 0.012);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) turnedLeg(k, "metal", sx * 0.27, sz * 0.24, 0.34, 0.024);
  for (const sx of [-1, 1]) k.box("metal", 0.028, 0.028, 0.48, sx * 0.27, 0.1, 0);
  k.box("metal", 0.54, 0.028, 0.028, 0, 0.1, 0);
  // a velvet back in a gilt frame, leaning back a little
  k.box("up", 0.52, 0.62, 0.07, 0, 0.86, -0.25, 0.03, -0.1);
  for (const sx of [-1, 1]) k.tube("metal", [sx * 0.28, 0.4, -0.25], [sx * 0.28, 1.2, -0.33], 0.022);
  k.box("metal", 0.62, 0.06, 0.05, 0, 1.2, -0.33, 0.015, -0.1);
  k.ball("metal", 0.05, 0, 1.25, -0.335, 1.6, 0.8, 0.6);
  // scrolled gilt arms with velvet pads
  for (const sx of [-1, 1]) {
    k.tube("metal", [sx * 0.3, 0.41, 0.25], [sx * 0.31, 0.66, 0.23], 0.02);
    k.tube("metal", [sx * 0.31, 0.66, 0.25], [sx * 0.3, 0.68, -0.24], 0.021);
    k.ball("metal", 0.03, sx * 0.31, 0.665, 0.26);
    k.box("up", 0.06, 0.03, 0.26, sx * 0.305, 0.695, 0, 0.012);
  }
}

function spanishChair(k: Kit): void {
  k.box("up", 0.5, 0.035, 0.46, 0, 0.465, 0.02, 0.01);
  k.box("wood", 0.5, 0.05, 0.46, 0, 0.425, 0.02);
  for (const sx of [-1, 1]) {
    turnedLeg(k, "wood", sx * 0.22, 0.21, 0.42, 0.024);
    k.tube("wood", [sx * 0.22, 0, -0.2], [sx * 0.22, 1.04, -0.25], 0.024);
    k.ball("metal", 0.03, sx * 0.22, 1.075, -0.252);
    k.box("wood", 0.03, 0.03, 0.4, sx * 0.22, 0.1, 0);
  }
  // a leather back nailed with brass bands
  k.box("up", 0.42, 0.34, 0.018, 0, 0.8, -0.236, 0, -0.05);
  for (const y of [0.63, 0.97]) k.box("metal", 0.42, 0.014, 0.026, 0, y, -0.236 - (y - 0.8) * 0.05, 0, -0.05);
  k.box("wood", 0.44, 0.09, 0.026, 0, 0.17, 0.21, 0.006);
}

function medallionChair(k: Kit): void {
  k.box("up", 0.5, 0.1, 0.46, 0, 0.45, 0.03, 0.04);
  k.box("metal", 0.52, 0.07, 0.48, 0, 0.37, 0.02, 0.012);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) taperedLeg(k, "metal", sx * 0.225, sz * 0.2, 0.34, 0.022);
  // the oval back: silk in a gilt ring on two short posts, a bow on top
  k.disc("up", 0.19, 0.05, 0, 0.86, -0.215, PI / 2, 1.3, 24);
  k.ring("metal", 0.2, 0.017, 0, 0.86, -0.215, 0, 1, 1.3);
  for (const sx of [-1, 1]) k.tube("metal", [sx * 0.2, 0.41, -0.2], [sx * 0.13, 0.67, -0.215], 0.018);
  k.ball("metal", 0.03, 0, 1.13, -0.215, 1.8, 0.9, 0.7);
}

function balloonChair(k: Kit): void {
  k.box("up", 0.46, 0.08, 0.42, 0, 0.46, 0.03, 0.035);
  k.box("wood", 0.46, 0.06, 0.42, 0, 0.4, 0.03, 0.01);
  for (const sx of [-1, 1]) {
    cabriole(k, "wood", sx * 0.2, 0.2, 0.37, sx, 1, 0.022);
    k.tube("wood", [sx * 0.19, 0, -0.26], [sx * 0.19, 0.43, -0.18], 0.02);
    k.tube("wood", [sx * 0.19, 0.43, -0.18], [sx * 0.17, 0.78, -0.215], 0.019);
  }
  // the balloon: a hoop over the uprights, a waist rail
  k.ring("wood", 0.18, 0.019, 0, 0.84, -0.22, -0.08, 1, 0.95);
  k.box("wood", 0.32, 0.03, 0.022, 0, 0.71, -0.205, 0.006);
}

function thonetChair(k: Kit): void {
  // (the accent here is cane)
  k.disc("metal", 0.2, 0.02, 0, 0.45, 0.03, 0, 1, 28);
  k.ring("wood", 0.205, 0.017, 0, 0.45, 0.03, PI / 2, 1, 1, 2 * PI, 32);
  for (const sx of [-1, 1]) {
    k.tube("wood", [sx * 0.19, 0, 0.24], [sx * 0.14, 0.44, 0.15], 0.016);
    k.tube("wood", [sx * 0.17, 0, -0.24], [sx * 0.15, 0.44, -0.12], 0.017);
    k.tube("wood", [sx * 0.15, 0.44, -0.12], [sx * 0.15, 0.9, -0.2], 0.016);
  }
  k.ring("wood", 0.15, 0.016, 0, 0.9, -0.2, -0.17, 1, 1, PI, 20);
  k.ring("wood", 0.1, 0.012, 0, 0.72, -0.17, -0.17, 1, 1.5, 2 * PI, 24);
  k.ring("wood", 0.25, 0.011, 0, 0.2, 0.007, PI / 2, 1, 1, 2 * PI, 32);
}

function kubus(k: Kit): void {
  k.box("up", 0.8, 0.4, 0.72, 0, 0.23, 0, 0.02);
  k.box("up", 0.56, 0.1, 0.54, 0, 0.48, 0.07, 0.025);
  k.box("up", 0.8, 0.32, 0.16, 0, 0.59, -0.28, 0.02);
  for (const sx of [-1, 1]) k.box("up", 0.12, 0.3, 0.56, sx * 0.34, 0.58, 0.08, 0.02);
  // the square quilting: welts standing a hair proud of the leather
  for (const y of [0.13, 0.23, 0.33]) k.box("up", 0.804, 0.01, 0.724, 0, y, 0);
  for (const x of [-0.27, -0.135, 0, 0.135, 0.27]) k.box("up", 0.01, 0.4, 0.726, x, 0.23, 0);
  for (const x of [-0.27, -0.135, 0, 0.135, 0.27]) k.box("up", 0.01, 0.32, 0.164, x, 0.59, -0.28);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box("wood", 0.05, 0.03, 0.05, sx * 0.36, 0.015, sz * 0.32);
}

function wassily(k: Kit): void {
  const r = 0.0125;
  for (const sx of [-1, 1]) {
    const x = sx * 0.34;
    k.tube("metal", [x, 0.012, 0.3], [x, 0.012, -0.3], r);
    k.tube("metal", [x, 0.012, 0.3], [x, 0.58, 0.3], r);
    k.tube("metal", [x, 0.58, 0.3], [x, 0.6, -0.26], r);
    k.tube("metal", [x, 0.012, -0.3], [x * 0.94, 0.84, -0.34], r);
    k.tube("metal", [x * 0.88, 0.42, 0.27], [x * 0.88, 0.37, -0.24], r);
    for (const p of [[x, 0.012, 0.3], [x, 0.58, 0.3], [x, 0.012, -0.3]] as V3[]) k.ball("metal", r, ...p, 1, 1, 1, 8);
    k.box("up", 0.008, 0.12, 0.5, x, 0.51, 0.02);
  }
  k.tube("metal", [-0.3, 0.42, 0.27], [0.3, 0.42, 0.27], r);
  k.tube("metal", [-0.32, 0.82, -0.335], [0.32, 0.82, -0.335], r);
  // leather straps: the seat sling, the back
  k.box("up", 0.6, 0.008, 0.52, 0, 0.395, 0.015, 0, -0.1);
  k.box("up", 0.62, 0.26, 0.008, 0, 0.66, -0.31, 0, -0.12);
}

function officialsHat(k: Kit): void {
  k.box("wood", 0.58, 0.05, 0.46, 0, 0.495, 0, 0.006);
  k.box("up", 0.5, 0.012, 0.38, 0, 0.522, 0);
  for (const sx of [-1, 1]) {
    const x = sx * 0.265;
    k.tube("wood", [x, 0, -0.21], [x * 0.95, 1.12, -0.26], 0.02);
    k.tube("wood", [x, 0, 0.21], [x, 0.72, 0.19], 0.018);
    k.tube("wood", [x, 0.72, 0.25], [x * 0.97, 0.74, -0.22], 0.016);
    k.box("wood", 0.025, 0.025, 0.4, x, 0.16, 0);
  }
  // the yoke, its ends running past the posts; an S-curved splat
  k.tube("wood", [-0.37, 1.12, -0.26], [0.37, 1.12, -0.26], 0.022);
  k.box("wood", 0.16, 0.58, 0.016, 0, 0.82, -0.235, 0, -0.08);
  k.box("wood", 0.56, 0.03, 0.05, 0, 0.09, 0.21);
  k.box("wood", 0.5, 0.05, 0.015, 0, 0.445, 0.225);
}

/** A tea-house bench (shōgi) long along z, with a red felt runner over it. */
function shogi(k: Kit, w: number, d: number): void {
  k.box("wood", w, 0.04, d, 0, 0.42, 0, 0.005);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box("wood", 0.05, 0.4, 0.05, sx * (w / 2 - 0.05), 0.2, sz * (d / 2 - 0.06));
  for (const sx of [-1, 1]) k.box("wood", 0.03, 0.05, d - 0.16, sx * (w / 2 - 0.05), 0.12, 0);
  for (const sx of [-1, 1]) k.box("metal", 0.012, 0.042, d, sx * (w / 2 - 0.006), 0.42, 0);
  k.box("up", w + 0.02, 0.008, d - 0.24, 0, 0.444, 0);
  for (const sx of [-1, 1]) k.box("up", 0.006, 0.12, d - 0.24, sx * (w / 2 + 0.01), 0.388, 0);
}

// --------------------------------------------------------------- the sets

const SACRED: FurnitureSet = {
  name: "Florentine walnut: a trestle bench and a cassapanca",
  up: { color: "#5b1f1b", roughness: 0.88 },
  wood: { color: "#4a3021", finish: "grain" },
  metal: { color: "#c9a14e", metalness: 1, roughness: 0.35 },
  bench: {
    size: [0.5, 1.8],
    build(k, w, d) {
      k.box("wood", w, 0.05, d, 0, 0.415, 0, 0.008);
      k.box("up", w - 0.05, 0.05, d - 0.1, 0, 0.462, 0, 0.02);
      for (const s of [-1, 1]) {
        const z = s * (d / 2 - 0.16);
        k.box("wood", w - 0.06, 0.33, 0.05, 0, 0.225, z);
        k.box("wood", w + 0.02, 0.06, 0.14, 0, 0.03, z, 0.01);
        k.box("wood", w - 0.02, 0.04, 0.09, 0, 0.37, z, 0.006);
      }
      k.box("wood", 0.06, 0.07, d - 0.32, 0, 0.13, 0, 0.008);
    },
  },
  wall: {
    width: 1.8,
    depth: 0.62,
    build(k, W, depth) {
      const zc = -depth / 2 + 0.3;
      k.box("wood", W + 0.04, 0.08, 0.56, 0, 0.04, zc, 0.006);
      k.box("wood", W, 0.36, 0.5, 0, 0.26, zc);
      const n = W > 1.3 ? 3 : 2;
      const pw = (W - 0.12 - (n - 1) * 0.06) / n;
      for (let i = 0; i < n; i++) k.box("wood", pw, 0.2, 0.025, -W / 2 + 0.06 + pw / 2 + i * (pw + 0.06), 0.26, zc + 0.255, 0.006);
      k.box("metal", W - 0.04, 0.012, 0.012, 0, 0.405, zc + 0.252);
      k.box("wood", W + 0.04, 0.035, 0.54, 0, 0.455, zc, 0.006);
      k.box("up", W - 0.14, 0.06, 0.42, 0, 0.5, zc + 0.03, 0.025);
      k.box("wood", W, 0.5, 0.05, 0, 0.72, zc - 0.225);
      k.box("wood", W + 0.06, 0.05, 0.1, 0, 0.995, zc - 0.215, 0.008);
      k.box("metal", W - 0.1, 0.014, 0.012, 0, 0.94, zc - 0.196);
      for (const s of [-1, 1]) k.box("wood", 0.06, 0.24, 0.5, s * (W / 2 - 0.03), 0.59, zc, 0.01);
    },
  },
};

const OLD_MASTER: FurnitureSet = {
  name: "Roman Baroque: a gilt banquette and armchairs in crimson velvet",
  up: { color: "#6e1a1d", roughness: 0.9 },
  wood: { color: "#3a2416", finish: "grain" },
  metal: { color: "#d4a94f", metalness: 1, roughness: 0.32 },
  bench: {
    size: [0.62, 1.9],
    build(k, w, d) {
      k.box("up", w, 0.12, d, 0, 0.42, 0, 0.05);
      k.box("metal", w + 0.02, 0.07, d + 0.02, 0, 0.33, 0, 0.015);
      for (const sx of [-1, 1]) for (const z of [-(d / 2 - 0.07), 0, d / 2 - 0.07]) turnedLeg(k, "metal", sx * (w / 2 - 0.06), z, 0.3, 0.026);
      for (const sx of [-1, 1]) k.box("metal", 0.03, 0.03, d - 0.14, sx * (w / 2 - 0.06), 0.1, 0);
      k.box("metal", w - 0.12, 0.03, 0.03, 0, 0.1, 0);
    },
  },
  wall: { width: 1.7, depth: 0.66, build: (k, width, depth) => pair(k, width, depth, 0.68, 0.62, baroqueArmchair) },
};

const NORTHERN: FurnitureSet = {
  name: "Dutch Golden Age: an oak bench and Spanish chairs in leather and brass",
  up: { color: "#4a2c1a", roughness: 0.55 },
  wood: { color: "#3b2a1a", finish: "grain" },
  metal: { color: "#b58f4c", metalness: 1, roughness: 0.38 },
  bench: {
    size: [0.55, 1.8],
    build(k, w, d) {
      k.box("up", w, 0.055, d, 0, 0.44, 0, 0.012);
      k.box("metal", w + 0.006, 0.014, d + 0.006, 0, 0.418, 0);
      k.box("wood", w - 0.04, 0.08, d - 0.04, 0, 0.37, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) turnedLeg(k, "wood", sx * (w / 2 - 0.05), sz * (d / 2 - 0.06), 0.33, 0.026);
      for (const sx of [-1, 1]) k.box("wood", 0.04, 0.04, d - 0.12, sx * (w / 2 - 0.05), 0.07, 0);
      for (const sz of [-1, 1]) k.box("wood", w - 0.1, 0.04, 0.04, 0, 0.07, sz * (d / 2 - 0.06));
    },
  },
  wall: { width: 1.5, depth: 0.56, build: (k, width, depth) => pair(k, width, depth, 0.56, 0.52, spanishChair) },
};

const EIGHTEENTH: FurnitureSet = {
  name: "Louis XVI: a gilt banquette and medallion chairs in ivory silk",
  up: { color: "#ddd0ae", roughness: 0.72 },
  wood: { color: "#e3dac6", finish: "paint" },
  metal: { color: "#d2a54e", metalness: 1, roughness: 0.3 },
  bench: {
    size: [0.5, 1.6],
    build(k, w, d) {
      k.box("up", w, 0.12, d, 0, 0.42, 0, 0.045);
      k.box("metal", w + 0.02, 0.07, d + 0.02, 0, 0.335, 0, 0.012);
      for (const sx of [-1, 1]) for (const z of [-(d / 2 - 0.06), 0, d / 2 - 0.06]) taperedLeg(k, "metal", sx * (w / 2 - 0.05), z, 0.3, 0.024);
    },
  },
  wall: { width: 1.5, depth: 0.56, build: (k, width, depth) => pair(k, width, depth, 0.54, 0.5, medallionChair) },
};

const NINETEENTH: FurnitureSet = {
  name: "Second Empire: a round borne and a Chesterfield settee in oxblood velvet",
  up: { color: "#5a1b17", roughness: 0.85 },
  wood: { color: "#2e1d13", finish: "grain" },
  metal: { color: "#9a7a45", metalness: 1, roughness: 0.42 },
  bench: {
    size: [1.5, 1.5],
    build(k, w) {
      const R = w / 2;
      k.post("wood", R - 0.04, R - 0.03, 0.06, 0, 0, 0, 40);
      k.post("up", R - 0.02, R - 0.05, 0.34, 0, 0.06, 0, 40);
      k.post("up", R - 0.08, R - 0.08, 0.07, 0, 0.4, 0, 40);
      k.ring("up", R - 0.08, 0.07, 0, 0.4, 0, PI / 2, 1, 1, 2 * PI, 48);
      // the back: a buttoned column, a roll, a bronze urn
      k.post("up", 0.25, 0.33, 0.5, 0, 0.44, 0, 28);
      k.ring("up", 0.24, 0.05, 0, 0.94, 0, PI / 2, 1, 1, 2 * PI, 28);
      k.post("up", 0.24, 0.24, 0.05, 0, 0.92, 0, 28);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * 2 * PI;
        for (const [y, r, o] of [[0.6, 0.302, 0], [0.8, 0.276, PI / 10]] as const) {
          k.ball("wood", 0.011, Math.cos(a + o) * r, y, Math.sin(a + o) * r, 1, 1, 1, 6);
        }
      }
      k.post("metal", 0.07, 0.11, 0.1, 0, 0.97, 0, 16);
      k.ball("metal", 0.13, 0, 1.13, 0, 1, 0.85, 1, 16);
      k.post("metal", 0.1, 0.06, 0.06, 0, 1.22, 0, 16);
    },
  },
  wall: {
    width: 1.8,
    depth: 0.82,
    build(k, W, depth) {
      const zc = -depth / 2 + 0.41;
      k.box("up", W - 0.02, 0.3, 0.76, 0, 0.25, zc, 0.05);
      k.box("up", W - 0.4, 0.12, 0.58, 0, 0.45, zc + 0.07, 0.05);
      k.box("up", W - 0.02, 0.38, 0.2, 0, 0.6, zc - 0.28, 0.06);
      k.tube("up", [-W / 2 + 0.04, 0.79, zc - 0.29], [W / 2 - 0.04, 0.79, zc - 0.29], 0.09, 16);
      for (const s of [-1, 1]) {
        const x = s * (W / 2 - 0.1);
        k.box("up", 0.2, 0.36, 0.76, x, 0.46, zc, 0.06);
        k.tube("up", [x, 0.66, zc - 0.38], [x, 0.66, zc + 0.39], 0.11, 16);
        for (const sz of [-1, 1]) k.ball("wood", 0.045, x, 0.04, zc + sz * 0.33, 1, 0.9, 1);
      }
      // deep buttoning across the back
      const n = Math.floor((W - 0.5) / 0.14);
      for (let i = 0; i <= n; i++) {
        const x = -((n * 0.14) / 2) + i * 0.14;
        k.ball("wood", 0.011, x, i % 2 ? 0.58 : 0.7, zc - 0.178, 1, 1, 1, 6);
      }
    },
  },
};

const VICTORIAN: FurnitureSet = {
  name: "Victorian: a buttoned ottoman and balloon-back chairs in plum velvet",
  up: { color: "#4e2236", roughness: 0.86 },
  wood: { color: "#3a1e14", finish: "grain" },
  metal: { color: "#b38d4e", metalness: 1, roughness: 0.4 },
  bench: {
    size: [0.62, 1.7],
    build(k, w, d) {
      k.box("up", w, 0.2, d, 0, 0.36, 0, 0.07);
      k.box("up", w + 0.012, 0.05, d + 0.012, 0, 0.285, 0, 0.012);
      for (let i = 0; i < 5; i++) {
        for (const sx of [-1, 1]) k.ball("wood", 0.011, sx * w * 0.2, 0.46, -d * 0.36 + (i * d * 0.72) / 4 + (sx > 0 ? d * 0.09 : 0), 1, 0.7, 1, 6);
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) turnedLeg(k, "wood", sx * (w / 2 - 0.07), sz * (d / 2 - 0.08), 0.26, 0.028);
    },
  },
  wall: { width: 1.4, depth: 0.52, build: (k, width, depth) => pair(k, width, depth, 0.48, 0.48, balloonChair) },
};

const IMPRESSIONIST: FurnitureSet = {
  name: "Paris 1870: a leather bench and Thonet bentwood chairs",
  up: { color: "#3b2a22", roughness: 0.5 },
  wood: { color: "#2b1b12", finish: "grain" },
  metal: { color: "#c8a66c", metalness: 0, roughness: 0.78 },
  bench: {
    size: [0.62, 1.9],
    build(k, w, d) {
      k.box("up", w, 0.11, d, 0, 0.405, 0, 0.04);
      k.box("wood", w - 0.03, 0.075, d - 0.03, 0, 0.33, 0, 0.01);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const x = sx * (w / 2 - 0.055);
          const z = sz * (d / 2 - 0.055);
          k.post("wood", 0.026, 0.018, 0.3, x, 0, z, 12);
          k.post("wood", 0.024, 0.026, 0.035, x, 0, z, 12);
        }
      for (const sx of [-1, 1]) k.box("wood", 0.03, 0.03, d - 0.14, sx * (w / 2 - 0.055), 0.12, 0, 0.008);
    },
  },
  wall: { width: 1.3, depth: 0.56, build: (k, width, depth) => pair(k, width, depth, 0.44, 0.52, thonetChair) },
};

const SECESSION: FurnitureSet = {
  name: "Vienna 1900: a lacquered slat bench with gold squares and Kubus armchairs",
  up: { color: "#191715", roughness: 0.42 },
  wood: { color: "#121110", finish: "lacquer" },
  metal: { color: "#c9a24a", metalness: 1, roughness: 0.3 },
  bench: {
    size: [0.5, 1.8],
    build(k, w, d) {
      const n = 5;
      const sw = (w - 0.04) / n;
      for (let i = 0; i < n; i++) k.box("wood", sw - 0.014, 0.03, d, -w / 2 + 0.02 + sw * (i + 0.5), 0.445, 0, 0.004);
      for (const sx of [-1, 1]) k.box("wood", 0.04, 0.07, d, sx * (w / 2 - 0.02), 0.395, 0);
      for (const sz of [-1, 1]) k.box("wood", w, 0.07, 0.04, 0, 0.395, sz * (d / 2 - 0.02));
      for (const sx of [-1, 1])
        for (const z of [-(d / 2 - 0.03), 0, d / 2 - 0.03]) {
          k.box("wood", 0.045, 0.36, 0.045, sx * (w / 2 - 0.03), 0.18, z);
          k.box("metal", 0.006, 0.03, 0.03, sx * (w / 2 - 0.03 + 0.024), 0.31, z);
        }
      for (let z = -d / 2 + 0.15; z <= d / 2 - 0.149; z += 0.15) {
        for (const sx of [-1, 1]) k.box("metal", 0.006, 0.026, 0.026, sx * (w / 2 + 0.001), 0.395, z);
      }
    },
  },
  wall: { width: 1.9, depth: 0.76, build: (k, width, depth) => pair(k, width, depth, 0.8, 0.72, kubus) },
};

const EARLY_MODERN: FurnitureSet = {
  name: "Bauhaus: a Barcelona daybed and Wassily chairs",
  up: { color: "#1c1a18", roughness: 0.45 },
  wood: { color: "#3a2a1e", finish: "grain" },
  metal: { color: "#d8dadc", metalness: 1, roughness: 0.18 },
  bench: {
    size: [0.75, 1.9],
    build(k, w, d) {
      k.box("up", w, 0.11, d, 0, 0.41, 0, 0.035);
      for (let z = -d / 2 + 0.19; z < d / 2 - 0.1; z += 0.19) k.box("up", w + 0.004, 0.112, 0.012, 0, 0.41, z);
      k.box("wood", w - 0.04, 0.05, d - 0.04, 0, 0.33, 0, 0.006);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.post("metal", 0.019, 0.019, 0.305, sx * (w / 2 - 0.1), 0, sz * (d / 2 - 0.12), 12);
    },
  },
  wall: { width: 1.9, depth: 0.74, build: (k, width, depth) => pair(k, width, depth, 0.78, 0.7, wassily) },
};

const POSTWAR: FurnitureSet = {
  name: "White cube: a solid oak bench and a low sofa on steel legs",
  up: { color: "#3b3b3d", roughness: 0.92 },
  wood: { color: "#b49a78", finish: "grain" },
  metal: { color: "#c9ccce", metalness: 1, roughness: 0.25 },
  bench: {
    size: [0.62, 1.9],
    build(k, w, d) {
      k.box("wood", w, 0.065, d, 0, 0.4075, 0, 0.008);
      for (const sz of [-1, 1]) k.box("wood", w - 0.08, 0.375, 0.065, 0, 0.1875, sz * (d / 2 - 0.28), 0.006);
    },
  },
  wall: {
    width: 1.9,
    depth: 0.76,
    build(k, W, depth) {
      const zc = -depth / 2 + 0.37;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.post("metal", 0.011, 0.011, 0.2, sx * (W / 2 - 0.06), 0, zc + sz * 0.3, 8);
      k.box("metal", W - 0.04, 0.02, 0.68, 0, 0.21, zc);
      k.box("up", W, 0.15, 0.72, 0, 0.295, zc, 0.012);
      const n = W > 1.5 ? 3 : 2;
      const cw = (W - 0.24) / n;
      for (let i = 0; i < n; i++) k.box("up", cw - 0.01, 0.1, 0.56, -W / 2 + 0.12 + cw * (i + 0.5), 0.42, zc + 0.07, 0.02);
      k.box("up", W, 0.32, 0.14, 0, 0.53, zc - 0.29, 0.012);
      for (const sx of [-1, 1]) k.box("up", 0.12, 0.32, 0.72, sx * (W / 2 - 0.06), 0.53, zc, 0.012);
    },
  },
};

const EAST_ASIAN: FurnitureSet = {
  name: "Ming: a huanghuali bench and official's hat chairs",
  up: { color: "#8a6a42", roughness: 0.8 },
  wood: { color: "#6a3e22", finish: "grain" },
  metal: { color: "#b08a50", metalness: 1, roughness: 0.4 },
  bench: {
    size: [0.45, 1.7],
    build(k, w, d) {
      k.box("wood", w, 0.045, d, 0, 0.4575, 0, 0.008);
      k.box("wood", w - 0.04, 0.025, d - 0.04, 0, 0.4225, 0);
      for (const sx of [-1, 1]) k.box("wood", 0.022, 0.06, d - 0.04, sx * (w / 2 - 0.011), 0.38, 0);
      for (const sz of [-1, 1]) k.box("wood", w - 0.04, 0.06, 0.022, 0, 0.38, sz * (d / 2 - 0.011));
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const x = sx * (w / 2 - 0.03);
          const z = sz * (d / 2 - 0.05);
          k.box("wood", 0.045, 0.36, 0.045, x, 0.2, z);
          k.box("wood", 0.05, 0.03, 0.05, x + sx * 0.008, 0.015, z + sz * 0.008, 0.006);
        }
      for (const sx of [-1, 1]) k.box("wood", 0.022, 0.03, d - 0.14, sx * (w / 2 - 0.03), 0.13, 0);
    },
  },
  wall: { width: 1.5, depth: 0.54, build: (k, width, depth) => pair(k, width, depth, 0.6, 0.5, officialsHat) },
};

const PRINT_ROOM: FurnitureSet = {
  name: "Edo tea house: hinoki benches under red felt",
  up: { color: "#9b2a24", roughness: 0.95 },
  wood: { color: "#b8956a", finish: "grain" },
  metal: { color: "#1c1b19", metalness: 0, roughness: 0.55 },
  bench: { size: [0.55, 1.8], build: shogi },
  wall: {
    width: 1.7,
    depth: 0.6,
    build: (k, width, depth) => shogi(k.at(0, -depth / 2 + 0.3, PI / 2), 0.55, width),
  },
};

const COURT_MINIATURE: FurnitureSet = {
  name: "Mughal court: low divans with bolsters in ruby velvet",
  up: { color: "#7c2131", roughness: 0.82 },
  wood: { color: "#2a1a12", finish: "grain" },
  metal: { color: "#c49a4c", metalness: 1, roughness: 0.35 },
  bench: {
    size: [0.75, 1.7],
    build(k, w, d) {
      k.box("wood", w, 0.18, d, 0, 0.12, 0, 0.012);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.post("wood", 0.035, 0.025, 0.03, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05));
      k.box("metal", w + 0.004, 0.015, d + 0.004, 0, 0.2, 0);
      k.box("up", w - 0.02, 0.15, d - 0.02, 0, 0.285, 0, 0.05);
      for (const sz of [-1, 1]) {
        const z = sz * (d / 2 - 0.12);
        k.tube("up", [-w / 2 + 0.05, 0.44, z], [w / 2 - 0.05, 0.44, z], 0.085, 16);
        for (const sx of [-1, 1]) k.ball("metal", 0.03, sx * (w / 2 - 0.045), 0.44, z);
      }
    },
  },
  wall: {
    width: 1.9,
    depth: 0.82,
    build(k, W, depth) {
      const zc = -depth / 2 + 0.4;
      k.box("wood", W, 0.2, 0.78, 0, 0.13, zc, 0.012);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.post("wood", 0.035, 0.025, 0.03, sx * (W / 2 - 0.05), 0, zc + sz * 0.34);
      k.box("metal", W + 0.004, 0.015, 0.784, 0, 0.22, zc);
      k.box("up", W - 0.02, 0.14, 0.76, 0, 0.3, zc, 0.05);
      const n = Math.max(2, Math.round((W - 0.3) / 0.55));
      const cw = (W - 0.3) / n;
      for (let i = 0; i < n; i++) k.box("up", cw - 0.03, 0.42, 0.15, -W / 2 + 0.15 + cw * (i + 0.5), 0.56, zc - 0.29, 0.07, -0.2);
      for (const sx of [-1, 1]) {
        const x = sx * (W / 2 - 0.1);
        k.tube("up", [x, 0.46, zc - 0.3], [x, 0.46, zc + 0.32], 0.09, 16);
        k.ball("metal", 0.03, x, 0.46, zc + 0.335);
      }
    },
  },
};

/** A museum bench of today: a leather cushion on a slim steel frame, long along z. */
function steelBench(k: Kit, w: number, d: number): void {
  k.box("up", w, 0.09, d, 0, 0.385, 0, 0.03);
  k.box("wood", w - 0.06, 0.03, d - 0.06, 0, 0.325, 0, 0.006);
  for (const sz of [-1, 1]) {
    const z = sz * (d / 2 - 0.12);
    k.box("wood", w - 0.1, 0.022, 0.03, 0, 0.011, z, 0.006);
    for (const sx of [-1, 1]) k.box("wood", 0.022, 0.32, 0.03, sx * (w / 2 - 0.06), 0.17, z, 0.006);
  }
}

const MUSEUM: FurnitureSet = {
  name: "A museum of today: leather benches on steel",
  up: { color: "#2b2826", roughness: 0.45 },
  wood: { color: "#b9bcbf", finish: "steel" },
  metal: { color: "#c8cbcd", metalness: 1, roughness: 0.25 },
  bench: { size: [0.62, 2.1], build: steelBench },
  wall: { width: 1.8, depth: 0.6, build: (k, width, depth) => steelBench(k.at(0, -depth / 2 + 0.31, PI / 2), 0.55, width) },
};

/** Each room style's furniture (theme.ts THEMES). */
export const FURNITURE: Record<EraKey, FurnitureSet> = {
  sacred: SACRED,
  "old-master": OLD_MASTER,
  northern: NORTHERN,
  eighteenth: EIGHTEENTH,
  nineteenth: NINETEENTH,
  victorian: VICTORIAN,
  impressionist: IMPRESSIONIST,
  secession: SECESSION,
  "early-modern": EARLY_MODERN,
  postwar: POSTWAR,
  "east-asian": EAST_ASIAN,
  "print-room": PRINT_ROOM,
  "court-miniature": COURT_MINIATURE,
  museum: MUSEUM,
};

export function furnitureOf(theme: Pick<GalleryTheme, "era">): FurnitureSet {
  return FURNITURE[theme.era] ?? NINETEENTH;
}

/** A centre bench at (x, z), footprint w × d, into the batches. */
export function buildBench(set: FurnitureSet, out: Batches, x: number, z: number, w: number, d: number): void {
  set.bench.build(new Kit(out, new THREE.Matrix4().makeTranslation(x, 0, z)), w, d);
}

/** A seat against a wall, facing into the room. */
export function buildWallSeat(set: FurnitureSet, out: Batches, seat: WallSeat): void {
  const m = new THREE.Matrix4().makeRotationY(seat.facing === 1 ? 0 : PI).setPosition(seat.position[0], 0, seat.position[1]);
  set.wall.build(new Kit(out, m), seat.size[0], seat.size[1]);
}
