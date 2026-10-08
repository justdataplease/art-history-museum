// The seating in the rooms. Every room style has its own pieces: benches and ottomans for the middle of a room,
// pieces that stand against a wall (a settee, a chest bench, two chairs and a small table) and armchairs, set
// alone at an angle in a corner or against a wall. Which pieces a room gets, where, at what angle and in which of
// the style's fabrics and woods is the layout's choice (layout.ts, furnish), seeded by the room's works: no two
// rooms alike, the same room furnished the same way on every visit.
//
// Each piece is modelled from primitives into three merged materials: upholstery (velvet, silk, leather, felt),
// the frame (wood with grain, lacquer, paint or steel) and an accent (gilt, brass, chrome; or cane and black
// lacquer). Colours are per vertex, so one material per part carries any number of fabrics and woods.
//
// Local coordinates: a piece is centred on its footprint and faces +z; a wall piece has the wall behind it at
// z = -depth / 2. Metres; the floor is y = 0.

import * as THREE from "three";
import type { GeoBatch } from "./room-geometry";
import type { FurnishSizes, Furnishing } from "./layout";
import type { EraKey, GalleryTheme } from "./theme";

export type Part = "up" | "wood" | "metal";
type Batches = Record<Part, Pick<GeoBatch, "add" | "roundedBoxAt">>;
type Tints = Record<Part, THREE.Color>;
type V3 = [number, number, number];

const PI = Math.PI;

export interface Piece {
  /** What it is, for the furniture study page. */
  name: string;
  /** Footprint facing +z: across (x) and deep (z). A wall piece's width is the most wall it wants. */
  size: [number, number];
  build: (k: Kit, w: number, d: number) => void;
}

export interface FurnitureSet {
  /** The style's furniture, for the furniture study page. */
  name: string;
  /** Upholstery: the fabrics a piece is covered in (one per piece), how matte, how much velvet sheen, and
   *  whether the cloth has a woven figure (damask, brocade) or is plain (velvet, leather, felt). */
  up: { colors: string[]; roughness: number; sheen: number; weave: "damask" | "plain" };
  /** The frame: its woods (or paints), and the finish: grain, lacquer, paint or steel. */
  wood: { colors: string[]; finish: "grain" | "lacquer" | "paint" | "steel" };
  /** Gilt, brass, chrome, bronze; or cane and black lacquer (metalness 0). */
  metal: { color: string; metalness: number; roughness: number };
  /** Down the middle of a room, long along z (size: across, along). The first is the usual one. */
  centre: Piece[];
  /** Against a wall. */
  wall: Piece[];
  /** Armchairs and chairs, set alone. */
  chairs: Piece[];
}

// ------------------------------------------------------------------- kit

/** Primitives placed in a piece's local frame, merged into the three batches in the piece's colours. */
export class Kit {
  constructor(
    private out: Batches,
    private base: THREE.Matrix4,
    private tints: Tints
  ) {}

  /** A kit for a part of the piece moved (and turned about y) in its frame: one chair of a pair. */
  at(dx: number, dz: number, ry = 0): Kit {
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(dx, 0, dz);
    return new Kit(this.out, this.base.clone().multiply(m), this.tints);
  }

  /** The same kit with another colour for one part (a second chair's fabric, a marble table top). */
  tinted(part: Part, color: string | THREE.Color): Kit {
    return new Kit(this.out, this.base, { ...this.tints, [part]: new THREE.Color(color) });
  }

  private place(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
    // yaw last: a panel leans back (x) in its own frame, then turns (y)
    return new THREE.Matrix4()
      .compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")),
        new THREE.Vector3(sx, sy, sz)
      )
      .premultiply(this.base);
  }

  private add(part: Part, g: THREE.BufferGeometry, m: THREE.Matrix4): void {
    this.out[part].add(g, m, this.tints[part]);
  }

  /** A box centred at (x, y, z), rounded when r > 0, leaning about x by rx, then turned about y by ry. */
  box(part: Part, w: number, h: number, d: number, x: number, y: number, z: number, r = 0, rx = 0, ry = 0, rz = 0): void {
    const m = this.place(x, y, z, rx, ry, rz);
    if (r > 0) this.out[part].roundedBoxAt(w, h, d, r, r >= 0.03 ? 2 : 1, m, this.tints[part]);
    else this.add(part, new THREE.BoxGeometry(w, h, d), m);
  }

  /** An upright cylinder (frustum) standing at y0: radius rTop at the top, rBot at the foot. */
  post(part: Part, rTop: number, rBot: number, h: number, x: number, y0: number, z: number, seg = 10): void {
    this.add(part, new THREE.CylinderGeometry(rTop, rBot, h, seg, 1), this.place(x, y0 + h / 2, z));
  }

  /** A rod from a to b: radius r at a, r2 at b. */
  tube(part: Part, a: V3, b: V3, r: number, seg = 8, r2 = r): void {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const dir = B.clone().sub(A);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)).premultiply(this.base);
    this.add(part, new THREE.CylinderGeometry(r2, r, len, seg, 1), m);
  }

  /** A smooth rod through the points (a carved top rail, a scrolled arm, a bentwood hoop), capped. */
  rail(part: Part, pts: V3[], r: number, seg = 12, caps = true): void {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, "centripetal");
    this.add(part, new THREE.TubeGeometry(curve, seg, r, 7, false), this.base.clone());
    if (caps) for (const p of [pts[0], pts[pts.length - 1]]) this.ball(part, r, ...p, 1, 1, 1, 7);
  }

  /** A torus in the x-y plane (tilted about x by rx: PI / 2 lays it flat), stretched by sx, sy; `arc` from +x. */
  ring(part: Part, R: number, r: number, x: number, y: number, z: number, rx = 0, sx = 1, sy = 1, arc = 2 * PI, seg = 28): void {
    this.add(part, new THREE.TorusGeometry(R, r, 6, seg, arc), this.place(x, y, z, rx, 0, 0, sx, sy, 1));
  }

  ball(part: Part, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 10): void {
    this.add(part, new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.6))), this.place(x, y, z, 0, 0, 0, sx, sy, sz));
  }

  /** A flat round (or oval: sz) slab centred at (x, y, z); rx = PI / 2 stands it up facing +z. */
  disc(part: Part, r: number, h: number, x: number, y: number, z: number, rx = 0, sz = 1, seg = 28): void {
    this.add(part, new THREE.CylinderGeometry(r, r, h, seg, 1), this.place(x, y, z, rx, 0, 0, 1, 1, sz));
  }

  /** A padded panel curved round (0, y, cz) at radius R, from angle a0 to a1 (0: straight behind, +x
   *  positive): n rounded segments h high and t thick, leaning back by `lean` (a tub chair's back). */
  arcPanel(part: Part, R: number, a0: number, a1: number, n: number, h: number, t: number, y: number, cz: number, lean = 0, r = 0.03): void {
    const step = (a1 - a0) / n;
    const w = 2 * R * Math.sin(Math.abs(step) / 2) + 0.035;
    for (let i = 0; i < n; i++) {
      const a = a0 + step * (i + 0.5);
      this.box(part, w, h, t, R * Math.sin(a), y, cz - R * Math.cos(a), r, lean, -a);
    }
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
  k.rail(part, [[x - sx * 0.006, 0.05, z - sz * 0.006], [x - sx * 0.01, h * 0.35, z - sz * 0.01], [x + sx * 0.022, h * 0.72, z + sz * 0.022], [x, h, z]], r, 10, false);
  k.ball(part, r * 1.05, x + sx * 0.004, 0.03, z + sz * 0.004, 1.3, 0.65, 1.3, 8);
  k.ball(part, r * 1.05, x, h, z, 1, 1, 1, 8);
}

/** A tapered, collared leg on a toupie foot under a die block (Louis XVI). */
function taperedLeg(k: Kit, part: Part, x: number, z: number, h: number, r: number): void {
  k.post(part, r * 0.6, r * 0.75, h * 0.06, x, 0, z);
  k.post(part, r, r * 0.55, h * 0.82, x, h * 0.06, z);
  k.post(part, r * 1.2, r * 1.2, 0.02, x, h * 0.8, z);
  k.box(part, r * 2.4, h * 0.12, r * 2.4, x, h * 0.94, z);
}

/** A back leg raking back from the seat rail to the floor. */
function rakedLeg(k: Kit, part: Part, x: number, z: number, h: number, r: number): void {
  k.tube(part, [x, 0, z - 0.05], [x, h, z], r * 0.8, 8, r);
}

/** A small round table on a turned stem and three feet (between two chairs). */
function gueridon(k: Kit, top: Part, stem: Part, r = 0.26, h = 0.68): void {
  k.disc(top, r, 0.035, 0, h, 0, 0, 1, 28);
  k.disc(stem, r + 0.012, 0.025, 0, h - 0.028, 0, 0, 1, 28);
  k.post(stem, 0.025, 0.035, h - 0.2, 0, 0.14, 0, 10);
  k.ball(stem, 0.05, 0, 0.16, 0, 1, 0.8, 1);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * 2 * PI + PI / 2;
    k.rail(stem, [[0, 0.16, 0], [Math.cos(a) * 0.13, 0.09, Math.sin(a) * 0.13], [Math.cos(a) * 0.22, 0.02, Math.sin(a) * 0.22]], 0.016, 8);
  }
}

/** Two chairs against the wall turned toward each other with a small table between; one where the wall is
 *  short. */
function pairWithTable(chair: (k: Kit) => void, chairW: number, chairD: number, table: (k: Kit) => void) {
  return (k: Kit, width: number, depth: number) => {
    const z = -depth / 2 + chairD / 2 + 0.05;
    if (width + 1e-6 >= 2 * chairW + 0.55) {
      const x = Math.min(width / 2 - chairW / 2, chairW / 2 + 0.38);
      chair(k.at(-x, z, 0.38));
      chair(k.at(x, z, -0.38));
      table(k.at(0, -depth / 2 + 0.3));
    } else {
      chair(k.at(0, z));
    }
  };
}

// ----------------------------------------------------------------- chairs

/** Roman Baroque: a gilt armchair in velvet, scrolled arms, a tall back with a crest. */
function baroqueArmchair(k: Kit): void {
  k.box("up", 0.6, 0.11, 0.54, 0, 0.45, 0.03, 0.04);
  k.box("metal", 0.64, 0.07, 0.58, 0, 0.37, 0.02, 0.012);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) turnedLeg(k, "metal", sx * 0.27, sz * 0.24, 0.34, 0.024);
  for (const sx of [-1, 1]) k.box("metal", 0.028, 0.028, 0.48, sx * 0.27, 0.1, 0);
  k.box("metal", 0.54, 0.028, 0.028, 0, 0.1, 0);
  // a velvet back in a gilt frame, leaning back a little
  k.box("up", 0.52, 0.62, 0.07, 0, 0.86, -0.25, 0.03, -0.1);
  for (const sx of [-1, 1]) k.tube("metal", [sx * 0.28, 0.4, -0.25], [sx * 0.28, 1.2, -0.33], 0.022);
  k.rail("metal", [[-0.3, 1.18, -0.33], [-0.12, 1.22, -0.335], [0, 1.27, -0.34], [0.12, 1.22, -0.335], [0.3, 1.18, -0.33]], 0.026, 14);
  k.ball("metal", 0.05, 0, 1.29, -0.34, 1.6, 0.8, 0.6);
  // scrolled gilt arms with velvet pads
  for (const sx of [-1, 1]) {
    k.rail("metal", [[sx * 0.28, 0.41, 0.25], [sx * 0.31, 0.56, 0.26], [sx * 0.31, 0.665, 0.22], [sx * 0.3, 0.68, 0.0], [sx * 0.29, 0.7, -0.27]], 0.021, 14);
    k.ball("metal", 0.032, sx * 0.315, 0.62, 0.275);
    k.box("up", 0.065, 0.03, 0.28, sx * 0.305, 0.7, -0.02, 0.012);
  }
}

/** A tall walnut sedia with velvet nailed in brass, scroll arms and H-stretchers (Italy, 17th century). */
function sedia(k: Kit): void {
  k.box("up", 0.54, 0.07, 0.48, 0, 0.47, 0.02, 0.02);
  k.box("wood", 0.58, 0.06, 0.52, 0, 0.415, 0.02);
  for (const sx of [-1, 1]) {
    k.box("wood", 0.045, 0.43, 0.045, sx * 0.265, 0.215, 0.24);
    k.tube("wood", [sx * 0.265, 0, -0.23], [sx * 0.265, 1.24, -0.27], 0.024);
    k.ball("wood", 0.035, sx * 0.265, 1.27, -0.27, 1, 1.3, 1);
    k.box("wood", 0.035, 0.05, 0.46, sx * 0.265, 0.12, 0.0);
    // flat scrolled arm on a baluster support
    k.box("wood", 0.06, 0.035, 0.52, sx * 0.275, 0.72, -0.01, 0.008);
    k.rail("wood", [[sx * 0.275, 0.735, 0.25], [sx * 0.28, 0.745, 0.29], [sx * 0.275, 0.7, 0.3]], 0.024, 6);
    k.tube("wood", [sx * 0.265, 0.44, 0.24], [sx * 0.27, 0.71, 0.24], 0.02);
  }
  k.box("wood", 0.5, 0.045, 0.035, 0, 0.12, 0.0);
  k.box("wood", 0.5, 0.12, 0.03, 0, 0.2, 0.25, 0.008);
  // velvet back panel with a nailed border, a carved crest rail
  k.box("up", 0.48, 0.52, 0.035, 0, 0.88, -0.255, 0.012, -0.03);
  for (const y of [0.63, 1.13]) k.box("metal", 0.48, 0.012, 0.04, 0, y, -0.255 - (y - 0.88) * 0.03, 0, -0.03);
  k.box("wood", 0.58, 0.08, 0.05, 0, 1.18, -0.27, 0.01);
}

/** Dantesca: an X-framed walnut armchair with a leather seat and back strap (Florence, 15th-16th century). */
function dantesca(k: Kit): void {
  for (const sx of [-1, 1]) {
    const x = sx * 0.29;
    // the side's two crescent legs, crossing under the seat
    k.rail("wood", [[x, 0.03, 0.28], [x, 0.24, 0.17], [x, 0.4, 0.0], [x, 0.56, -0.15], [x, 0.7, -0.24]], 0.024, 16);
    k.rail("wood", [[x, 0.03, -0.28], [x, 0.24, -0.17], [x, 0.4, 0.0], [x, 0.56, 0.15], [x, 0.66, 0.24]], 0.024, 16);
    k.box("wood", 0.05, 0.04, 0.64, x, 0.02, 0, 0.008);
    // the arm along the top, and a back post rising from it
    k.rail("wood", [[x, 0.67, 0.29], [x, 0.7, 0.05], [x, 0.71, -0.24]], 0.022, 8);
    k.ball("metal", 0.03, x, 0.675, 0.31);
    k.tube("wood", [x, 0.69, -0.24], [x * 0.97, 1.02, -0.3], 0.02);
    k.ball("metal", 0.03, x * 0.97, 1.045, -0.3);
  }
  k.box("wood", 0.58, 0.035, 0.035, 0, 0.4, 0.0);
  // leather sling seat with a cushion, and the back strap
  k.box("up", 0.56, 0.012, 0.4, 0, 0.415, 0.02, 0, 0.05);
  k.box("up", 0.5, 0.07, 0.4, 0, 0.455, 0.03, 0.03);
  k.box("up", 0.56, 0.22, 0.012, 0, 0.88, -0.28, 0, -0.18);
  for (const y of [0.78, 0.98]) k.box("metal", 0.56, 0.01, 0.016, 0, y, -0.28 + (y - 0.88) * 0.18);
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

/** The Dutch armchair: the Spanish chair with open arms on turned supports (17th century). */
function spanishArmchair(k: Kit): void {
  spanishChair(k);
  for (const sx of [-1, 1]) {
    k.box("wood", 0.05, 0.035, 0.46, sx * 0.255, 0.69, -0.0, 0.008);
    k.ball("wood", 0.03, sx * 0.255, 0.7, 0.24, 1.1, 0.8, 1.2);
    k.tube("wood", [sx * 0.235, 0.45, 0.21], [sx * 0.25, 0.68, 0.21], 0.02);
  }
}

/** Louis XV bergère: a carved show-wood frame (walnut, or gilt) on cabriole legs, closed padded arms, a deep
 *  cushion and a rounded back. */
function bergere(f: Part) {
  return (k: Kit): void => {
    k.box(f, 0.64, 0.08, 0.54, 0, 0.375, -0.01, 0.02);
    k.rail(f, [[-0.32, 0.37, 0.24], [-0.15, 0.355, 0.28], [0, 0.35, 0.285], [0.15, 0.355, 0.28], [0.32, 0.37, 0.24]], 0.028, 12, false);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cabriole(k, f, sx * 0.29, sz * 0.24, 0.35, sx, sz, 0.024);
    // a stuffed seat and a loose down cushion
    k.box("up", 0.6, 0.06, 0.54, 0, 0.44, 0.0, 0.025);
    k.box("up", 0.54, 0.1, 0.5, 0, 0.51, 0.03, 0.045);
    // the rounded back, in a carved frame that runs down into the arms
    k.arcPanel("up", 0.3, -1.05, 1.05, 6, 0.48, 0.08, 0.76, 0.02, -0.12, 0.03);
    const top: V3[] = [[-0.3, 0.79, -0.12]];
    for (let i = 0; i <= 6; i++) {
      const a = -1.05 + (2.1 * i) / 6;
      top.push([0.36 * Math.sin(a), 1.03 - 0.12 * (a / 1.05) ** 2, 0.0 - 0.36 * Math.cos(a)]);
    }
    top.push([0.3, 0.79, -0.12]);
    k.rail(f, top, 0.021, 24);
    for (const sx of [-1, 1]) {
      k.box("up", 0.07, 0.19, 0.36, sx * 0.29, 0.555, 0.03, 0.03);
      k.box("up", 0.085, 0.035, 0.26, sx * 0.297, 0.675, 0.03, 0.015);
      k.rail(f, [[sx * 0.3, 0.79, -0.12], [sx * 0.305, 0.68, -0.05], [sx * 0.312, 0.665, 0.17], [sx * 0.318, 0.6, 0.27], [sx * 0.29, 0.42, 0.25]], 0.02, 16);
    }
  };
}

/** Louis XVI fauteuil à la reine: a straight padded back in a moulded frame, padded arm rests, fluted legs;
 *  painted, or gilt under the Second Empire. */
function fauteuil(f: Part) {
  return (k: Kit): void => {
    k.box("up", 0.56, 0.1, 0.5, 0, 0.45, 0.02, 0.04);
    k.box(f, 0.6, 0.08, 0.54, 0, 0.37, 0.01, 0.012);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) taperedLeg(k, f, sx * 0.26, sz * 0.23, 0.34, 0.022);
    k.box("up", 0.46, 0.44, 0.06, 0, 0.82, -0.24, 0.025, -0.1);
    k.rail(f, [[-0.27, 1.04, -0.27], [-0.1, 1.07, -0.275], [0, 1.09, -0.278], [0.1, 1.07, -0.275], [0.27, 1.04, -0.27]], 0.022, 12);
    k.box(f, 0.5, 0.035, 0.05, 0, 0.6, -0.225, 0.01, -0.1);
    k.ball(f, 0.03, 0, 1.12, -0.28, 1.6, 0.9, 0.7);
    for (const sx of [-1, 1]) {
      k.tube(f, [sx * 0.26, 0.41, -0.22], [sx * 0.265, 1.04, -0.27], 0.022);
      k.ball(f, 0.026, sx * 0.265, 1.065, -0.272);
      k.rail(f, [[sx * 0.262, 0.41, 0.21], [sx * 0.275, 0.55, 0.2], [sx * 0.285, 0.66, 0.15]], 0.018, 8);
      k.rail(f, [[sx * 0.285, 0.665, 0.17], [sx * 0.285, 0.68, 0.0], [sx * 0.265, 0.7, -0.22]], 0.017, 10);
      k.box("up", 0.06, 0.03, 0.2, sx * 0.285, 0.695, -0.02, 0.012);
    }
  };
}

/** Louis XVI side chair: the oval back in a gilt ring. */
function medallionChair(k: Kit): void {
  k.box("up", 0.5, 0.1, 0.46, 0, 0.45, 0.03, 0.04);
  k.box("metal", 0.52, 0.07, 0.48, 0, 0.37, 0.02, 0.012);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) taperedLeg(k, "metal", sx * 0.225, sz * 0.2, 0.34, 0.022);
  k.disc("up", 0.19, 0.05, 0, 0.86, -0.215, PI / 2, 1.3, 24);
  k.ring("metal", 0.2, 0.017, 0, 0.86, -0.215, 0, 1, 1.3);
  for (const sx of [-1, 1]) k.tube("metal", [sx * 0.2, 0.41, -0.2], [sx * 0.13, 0.67, -0.215], 0.018);
  k.ball("metal", 0.03, 0, 1.13, -0.215, 1.8, 0.9, 0.7);
}

/** Georgian wing chair: fully upholstered, rolled arms, wings, mahogany cabriole legs. */
function wingback(k: Kit): void {
  k.box("up", 0.74, 0.2, 0.68, 0, 0.33, 0.02, 0.05);
  k.box("up", 0.54, 0.12, 0.58, 0, 0.48, 0.06, 0.05);
  k.box("up", 0.62, 0.8, 0.16, 0, 0.8, -0.27, 0.06, -0.08);
  k.rail("up", [[-0.31, 1.15, -0.31], [0, 1.23, -0.33], [0.31, 1.15, -0.31]], 0.06, 10);
  for (const sx of [-1, 1]) {
    k.box("up", 0.1, 0.22, 0.6, sx * 0.32, 0.54, 0.03, 0.04);
    k.tube("up", [sx * 0.335, 0.66, -0.2], [sx * 0.335, 0.66, 0.31], 0.065, 14);
    k.ball("up", 0.066, sx * 0.335, 0.66, 0.31, 1, 1, 0.5, 12);
    // the wing, flaring out from the back toward the arm
    k.box("up", 0.08, 0.52, 0.3, sx * 0.34, 0.93, -0.15, 0.04, 0, sx * 0.28);
    cabriole(k, "wood", sx * 0.31, 0.27, 0.23, sx, 1, 0.026);
    rakedLeg(k, "wood", sx * 0.3, -0.29, 0.23, 0.026);
  }
}

/** Napoleon III crapaud: low, fully upholstered and buttoned, a tub back running into the arms, a deep
 *  fringe hiding all but the feet. */
function crapaud(k: Kit): void {
  k.box("up", 0.66, 0.3, 0.62, 0, 0.23, 0.03, 0.08);
  k.box("up", 0.68, 0.08, 0.64, 0, 0.1, 0.03, 0.02);
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    k.box("up", 0.012, 0.09, 0.012, -0.32 + 0.64 * t, 0.06, 0.355, 0, 0.12);
  }
  k.box("up", 0.54, 0.1, 0.5, 0, 0.42, 0.07, 0.045);
  k.arcPanel("up", 0.31, -1.35, 1.35, 7, 0.46, 0.15, 0.6, 0.06, -0.12, 0.06);
  for (const sx of [-1, 1]) k.box("up", 0.12, 0.2, 0.36, sx * 0.29, 0.48, 0.12, 0.055);
  // buttons in a diamond, sunk into the back
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + (1.8 * i) / 4;
    for (const [y, dr] of [[0.56, 0], [0.7, 0.01]] as const) {
      if (y > 0.6 && i === 4) continue;
      const aa = y > 0.6 ? a + 0.225 : a;
      k.ball("wood", 0.012, (0.31 - 0.068 - dr) * Math.sin(aa), y, 0.06 - (0.31 - 0.068 - dr) * Math.cos(aa), 1, 1, 1, 6);
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.post("wood", 0.03, 0.022, 0.06, sx * 0.27, 0, 0.03 + sz * 0.24, 10);
}

/** Victorian spoon-back armchair: a buttoned balloon back, short padded arms, cabriole legs on castors. */
function spoonBack(k: Kit): void {
  k.box("up", 0.6, 0.12, 0.56, 0, 0.45, 0.02, 0.05);
  k.box("wood", 0.62, 0.07, 0.58, 0, 0.37, 0.02, 0.012);
  for (const sx of [-1, 1]) {
    cabriole(k, "wood", sx * 0.27, 0.25, 0.34, sx, 1, 0.024);
    rakedLeg(k, "wood", sx * 0.26, -0.24, 0.34, 0.024);
    k.ball("metal", 0.022, sx * 0.27, 0.02, 0.255);
  }
  k.disc("up", 0.26, 0.09, 0, 0.86, -0.25, PI / 2 - 0.12, 1.25, 28);
  k.ring("wood", 0.27, 0.018, 0, 0.86, -0.25, -0.12, 1, 1.25, 2 * PI, 36);
  k.ball("wood", 0.03, 0, 1.2, -0.29, 1.8, 1, 0.8);
  for (const [x, y] of [[0, 0.95], [-0.1, 0.86], [0.1, 0.86], [0, 0.77], [-0.1, 1.03], [0.1, 1.03], [0, 0.68]] as const) {
    k.ball("wood", 0.011, x, y, -0.2 - (y - 0.86) * 0.12, 1, 1, 1, 6);
  }
  for (const sx of [-1, 1]) {
    k.rail("wood", [[sx * 0.24, 0.62, -0.2], [sx * 0.29, 0.62, 0.0], [sx * 0.3, 0.6, 0.18], [sx * 0.28, 0.45, 0.24]], 0.019, 12);
    k.box("up", 0.07, 0.035, 0.26, sx * 0.29, 0.635, 0.0, 0.015);
  }
}

function balloonChair(k: Kit): void {
  k.box("up", 0.46, 0.08, 0.42, 0, 0.46, 0.03, 0.035);
  k.box("wood", 0.46, 0.06, 0.42, 0, 0.4, 0.03, 0.01);
  for (const sx of [-1, 1]) {
    cabriole(k, "wood", sx * 0.2, 0.2, 0.37, sx, 1, 0.022);
    k.tube("wood", [sx * 0.19, 0, -0.26], [sx * 0.19, 0.43, -0.18], 0.02);
    k.tube("wood", [sx * 0.19, 0.43, -0.18], [sx * 0.17, 0.78, -0.215], 0.019);
  }
  k.ring("wood", 0.18, 0.019, 0, 0.84, -0.22, -0.08, 1, 0.95);
  k.box("wood", 0.32, 0.03, 0.022, 0, 0.71, -0.205, 0.006);
}

/** The Voltaire armchair (Paris, 1850-1880): a tall padded back curved to the shoulders, a head roll, open
 *  show-wood arms, turned legs on castors. */
function voltaire(k: Kit): void {
  k.box("up", 0.58, 0.12, 0.54, 0, 0.45, 0.03, 0.05);
  k.box("wood", 0.6, 0.08, 0.56, 0, 0.37, 0.02, 0.012);
  for (const sx of [-1, 1]) {
    turnedLeg(k, "wood", sx * 0.26, 0.24, 0.34, 0.024);
    rakedLeg(k, "wood", sx * 0.26, -0.24, 0.34, 0.024);
  }
  k.arcPanel("up", 0.9, -0.3, 0.3, 3, 0.66, 0.1, 0.84, 0.62, -0.16, 0.04);
  k.rail("up", [[-0.26, 1.16, -0.33], [0, 1.2, -0.345], [0.26, 1.16, -0.33]], 0.05, 10);
  for (const sx of [-1, 1]) {
    k.rail("wood", [[sx * 0.27, 0.42, 0.24], [sx * 0.29, 0.58, 0.25], [sx * 0.3, 0.67, 0.19], [sx * 0.29, 0.68, 0.0], [sx * 0.27, 0.72, -0.2]], 0.022, 16);
    k.ball("wood", 0.034, sx * 0.302, 0.66, 0.23);
    k.box("up", 0.065, 0.03, 0.24, sx * 0.29, 0.7, -0.0, 0.012);
  }
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

/** A bentwood armchair: the Thonet chair with a bent hoop for arms. */
function thonetArmchair(k: Kit): void {
  thonetChair(k);
  k.rail("wood", [[-0.16, 0.42, 0.19], [-0.23, 0.6, 0.15], [-0.25, 0.66, -0.0], [-0.17, 0.68, -0.17], [0, 0.68, -0.22], [0.17, 0.68, -0.17], [0.25, 0.66, -0.0], [0.23, 0.6, 0.15], [0.16, 0.42, 0.19]], 0.014, 32, false);
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

/** An Art Deco club chair: deep, low, rounded arms in leather on a black plinth. */
function clubChair(k: Kit): void {
  k.box("wood", 0.78, 0.05, 0.8, 0, 0.025, 0, 0.01);
  k.box("up", 0.82, 0.32, 0.84, 0, 0.21, 0, 0.08);
  k.box("up", 0.56, 0.13, 0.62, 0, 0.43, 0.08, 0.055);
  k.box("up", 0.8, 0.44, 0.2, 0, 0.6, -0.32, 0.09, -0.1);
  for (const sx of [-1, 1]) {
    k.box("up", 0.16, 0.26, 0.82, sx * 0.33, 0.5, 0.0, 0.075);
    k.tube("up", [sx * 0.33, 0.62, -0.38], [sx * 0.33, 0.62, 0.38], 0.08, 16);
    k.ball("up", 0.08, sx * 0.33, 0.62, 0.38, 1, 1, 0.6, 14);
  }
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
  k.box("up", 0.6, 0.008, 0.52, 0, 0.395, 0.015, 0, -0.1);
  k.box("up", 0.62, 0.26, 0.008, 0, 0.66, -0.31, 0, -0.12);
}

/** Mies's Barcelona chair: two crossed steel curves a side, tufted leather cushions on straps. */
function barcelona(k: Kit): void {
  const r = 0.011;
  for (const sx of [-1, 1]) {
    const x = sx * 0.355;
    k.rail("metal", [[x, 0.005, 0.37], [x, 0.18, 0.27], [x, 0.36, 0.06], [x, 0.56, -0.2], [x, 0.78, -0.36]], r, 18);
    k.rail("metal", [[x, 0.005, -0.37], [x, 0.2, -0.24], [x, 0.36, 0.06], [x, 0.4, 0.3]], r, 14);
  }
  for (const [y, z] of [[0.38, 0.3], [0.33, -0.04], [0.76, -0.355]] as const) k.tube("metal", [-0.355, y, z], [0.355, y, z], r);
  k.box("up", 0.7, 0.1, 0.66, 0, 0.42, 0.02, 0.035, -0.07);
  k.box("up", 0.7, 0.6, 0.1, 0, 0.62, -0.26, 0.035, -0.42);
  // the tufting: welted squares across both cushions
  for (const x of [-0.175, 0, 0.175]) {
    k.box("up", 0.008, 0.104, 0.664, x, 0.42, 0.02, 0, -0.07);
    k.box("up", 0.008, 0.604, 0.104, x, 0.62, -0.26, 0, -0.42);
  }
  for (const z of [-0.14, 0.02, 0.18]) k.box("up", 0.704, 0.104, 0.008, 0, 0.42 + (0.02 - z) * 0.07, z, 0, -0.07);
}

/** A Danish teak armchair (1950s): a sculpted open frame, loose fabric cushions. */
function loungeChair(k: Kit): void {
  for (const sx of [-1, 1]) {
    const x = sx * 0.32;
    k.post("wood", 0.022, 0.016, 0.6, x, 0, 0.28, 10);
    k.tube("wood", [x, 0, -0.32], [x, 0.58, -0.27], 0.018, 10, 0.024);
    k.rail("wood", [[x, 0.6, 0.31], [x * 1.04, 0.62, 0.1], [x, 0.6, -0.15], [x * 0.96, 0.6, -0.28]], 0.024, 12);
    k.box("wood", 0.03, 0.04, 0.56, x, 0.3, 0.0, 0.006);
  }
  for (const z of [0.28, -0.25]) k.box("wood", 0.62, 0.04, 0.03, 0, 0.3, z, 0.006);
  k.tube("wood", [-0.31, 0.88, -0.37], [0.31, 0.88, -0.37], 0.02);
  k.box("up", 0.6, 0.11, 0.58, 0, 0.38, 0.02, 0.04, -0.06);
  k.box("up", 0.58, 0.48, 0.1, 0, 0.64, -0.3, 0.04, -0.28);
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
  k.tube("wood", [-0.37, 1.12, -0.26], [0.37, 1.12, -0.26], 0.022);
  k.box("wood", 0.16, 0.58, 0.016, 0, 0.82, -0.235, 0, -0.08);
  k.box("wood", 0.56, 0.03, 0.05, 0, 0.09, 0.21);
  k.box("wood", 0.5, 0.05, 0.015, 0, 0.445, 0.225);
}

/** A Ming horseshoe armchair (quanyi): one continuous rail from arm to arm round the back. */
function horseshoe(k: Kit): void {
  k.box("wood", 0.6, 0.05, 0.48, 0, 0.495, 0, 0.006);
  k.box("up", 0.52, 0.012, 0.4, 0, 0.522, 0);
  for (const sx of [-1, 1]) {
    const x = sx * 0.27;
    k.tube("wood", [x, 0, -0.21], [x, 0.74, -0.22], 0.02);
    k.tube("wood", [x, 0, 0.21], [x, 0.68, 0.2], 0.018);
    k.rail("wood", [[sx * 0.2, 0.52, 0.22], [sx * 0.26, 0.6, 0.21], [sx * 0.27, 0.68, 0.2]], 0.013, 8, false);
    k.box("wood", 0.025, 0.025, 0.4, x, 0.16, 0);
  }
  k.rail("wood", [[-0.35, 0.67, 0.27], [-0.3, 0.68, 0.18], [-0.28, 0.72, -0.08], [-0.2, 0.76, -0.23], [0, 0.78, -0.28], [0.2, 0.76, -0.23], [0.28, 0.72, -0.08], [0.3, 0.68, 0.18], [0.35, 0.67, 0.27]], 0.02, 40);
  k.box("wood", 0.15, 0.25, 0.016, 0, 0.65, -0.245, 0, -0.1);
  k.box("wood", 0.56, 0.03, 0.06, 0, 0.09, 0.21);
}

/** A mora: an Indian reed stool waisted like an hourglass, a cushion on top. */
function mora(k: Kit): void {
  k.post("metal", 0.12, 0.2, 0.2, 0, 0, 0, 20);
  k.post("metal", 0.21, 0.12, 0.2, 0, 0.2, 0, 20);
  for (const y of [0.005, 0.2, 0.395]) k.ring("wood", y === 0.2 ? 0.122 : y < 0.1 ? 0.2 : 0.21, 0.012, 0, y, 0, PI / 2, 1, 1, 2 * PI, 24);
  k.post("up", 0.21, 0.22, 0.09, 0, 0.4, 0, 24);
  k.ring("up", 0.2, 0.03, 0, 0.47, 0, PI / 2, 1, 1, 2 * PI, 24);
}

// --------------------------------------------------- settees and benches

/** A settee against the wall: a frame (gilt or wood) on legs, a padded seat and back, arms. */
function settee(f: Part, leg: "turned" | "tapered" | "cabriole") {
  return (k: Kit, W: number, depth: number): void => {
    const zc = -depth / 2 + 0.32;
    k.box(f, W - 0.04, 0.08, 0.56, 0, 0.37, zc, 0.012);
    const xs = [-(W / 2 - 0.08), W / 2 - 0.08];
    if (W > 1.5) xs.push(0);
    for (const x of xs)
      for (const sz of [-1, 1]) {
        const z = zc + sz * 0.23;
        if (leg === "turned") turnedLeg(k, f, x, z, 0.34, 0.024);
        else if (leg === "tapered") taperedLeg(k, f, x, z, 0.34, 0.022);
        else cabriole(k, f, x, z, 0.34, Math.sign(x) || 0, sz, 0.024);
      }
    k.box("up", W - 0.16, 0.12, 0.5, 0, 0.46, zc + 0.02, 0.045);
    k.box("up", W - 0.18, 0.46, 0.08, 0, 0.78, zc - 0.24, 0.03, -0.1);
    k.rail(f, [[-(W / 2 - 0.06), 0.98, zc - 0.26], [-(W / 4), 1.04, zc - 0.28], [0, 1.07, zc - 0.285], [W / 4, 1.04, zc - 0.28], [W / 2 - 0.06, 0.98, zc - 0.26]], 0.022, 20);
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.06);
      k.tube(f, [x, 0.41, zc - 0.25], [x, 0.98, zc - 0.26], 0.022);
      k.rail(f, [[x, 0.41, zc + 0.24], [x, 0.6, zc + 0.24], [x, 0.66, zc + 0.15], [x, 0.68, zc - 0.24]], 0.02, 12);
      k.box("up", 0.06, 0.03, 0.3, x, 0.685, zc - 0.03, 0.012);
    }
  };
}

/** A Chesterfield settee: rolled arms as high as the buttoned back, all leather or velvet. */
function chesterfield(k: Kit, W: number, depth: number): void {
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
  const n = Math.floor((W - 0.5) / 0.14);
  for (let i = 0; i <= n; i++) {
    const x = -((n * 0.14) / 2) + i * 0.14;
    k.ball("wood", 0.011, x, i % 2 ? 0.58 : 0.7, zc - 0.178, 1, 1, 1, 6);
  }
}

/** A banquette long along z: a padded top on a gilt (or wood) frame and turned legs. */
function banquette(f: Part) {
  return (k: Kit, w: number, d: number): void => {
    k.box("up", w, 0.12, d, 0, 0.42, 0, 0.05);
    k.box(f, w + 0.02, 0.07, d + 0.02, 0, 0.33, 0, 0.015);
    const zs = d > 1.4 ? [-(d / 2 - 0.07), 0, d / 2 - 0.07] : [-(d / 2 - 0.07), d / 2 - 0.07];
    for (const sx of [-1, 1]) for (const z of zs) turnedLeg(k, f, sx * (w / 2 - 0.06), z, 0.3, 0.026);
    for (const sx of [-1, 1]) k.box(f, 0.03, 0.03, d - 0.14, sx * (w / 2 - 0.06), 0.1, 0);
    k.box(f, w - 0.12, 0.03, 0.03, 0, 0.1, 0);
  };
}

/** A round borne: a buttoned velvet ottoman round a padded column crowned with a bronze urn (or a palm). */
function borne(k: Kit, w: number): void {
  const R = w / 2;
  k.post("wood", R - 0.04, R - 0.03, 0.06, 0, 0, 0, 40);
  k.post("up", R - 0.02, R - 0.05, 0.34, 0, 0.06, 0, 40);
  k.post("up", R - 0.08, R - 0.08, 0.07, 0, 0.4, 0, 40);
  k.ring("up", R - 0.08, 0.07, 0, 0.4, 0, PI / 2, 1, 1, 2 * PI, 48);
  // a fringe round the foot of the seat
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * 2 * PI;
    k.box("metal", 0.012, 0.08, 0.008, Math.cos(a) * (R - 0.012), 0.11, Math.sin(a) * (R - 0.012), 0, 0, -a + PI / 2);
  }
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

/** A wall piece made of a bench turned to run along the wall. */
const alongWall = (bench: (k: Kit, w: number, d: number) => void, deep: number) => (k: Kit, width: number, depth: number) =>
  bench(k.at(0, -depth / 2 + deep / 2 + 0.01, PI / 2), deep, width);

const piece = (name: string, size: [number, number], build: Piece["build"]): Piece => ({ name, size, build });
const chair = (name: string, size: [number, number], build: (k: Kit) => void): Piece => ({ name, size, build: (k) => build(k) });

// --------------------------------------------------------------- the sets

const SACRED: FurnitureSet = {
  name: "Florentine walnut: a trestle bench, a cassapanca, dantesca chairs",
  up: { colors: ["#5b1f1b", "#2f3b26", "#6e4a22", "#3a2a3e"], roughness: 0.86, sheen: 0.5, weave: "plain" },
  wood: { colors: ["#4a3021", "#3d2a1d", "#55382a"], finish: "grain" },
  metal: { color: "#c9a14e", metalness: 1, roughness: 0.35 },
  centre: [
    piece("trestle bench", [0.5, 1.8], (k, w, d) => {
      k.box("wood", w, 0.05, d, 0, 0.415, 0, 0.008);
      k.box("up", w - 0.05, 0.05, d - 0.1, 0, 0.462, 0, 0.02);
      for (const s of [-1, 1]) {
        const z = s * (d / 2 - 0.16);
        k.box("wood", w - 0.06, 0.33, 0.05, 0, 0.225, z);
        k.box("wood", w + 0.02, 0.06, 0.14, 0, 0.03, z, 0.01);
        k.box("wood", w - 0.02, 0.04, 0.09, 0, 0.37, z, 0.006);
      }
      k.box("wood", 0.06, 0.07, d - 0.32, 0, 0.13, 0, 0.008);
    }),
  ],
  wall: [
    piece("cassapanca", [1.8, 0.62], (k, W, depth) => {
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
    }),
  ],
  chairs: [chair("dantesca", [0.66, 0.66], dantesca), chair("sedia", [0.66, 0.6], sedia)],
};

const OLD_MASTER: FurnitureSet = {
  name: "Roman Baroque: gilt banquettes, armchairs and settees in velvet and damask",
  up: { colors: ["#6e1a1d", "#24402f", "#7d5a26", "#2a3550", "#5a1e3a"], roughness: 0.88, sheen: 0.7, weave: "damask" },
  wood: { colors: ["#3a2416", "#4a2c1c"], finish: "grain" },
  metal: { color: "#d4a94f", metalness: 1, roughness: 0.32 },
  centre: [piece("gilt banquette", [0.62, 1.9], banquette("metal"))],
  wall: [
    piece("two armchairs and a table", [2.1, 0.8], pairWithTable(baroqueArmchair, 0.68, 0.62, (k) => gueridon(k, "wood", "metal"))),
    piece("gilt settee", [1.9, 0.68], settee("metal", "turned")),
  ],
  chairs: [chair("Baroque armchair", [0.7, 0.66], baroqueArmchair), chair("sedia", [0.66, 0.6], sedia)],
};

const NORTHERN: FurnitureSet = {
  name: "Dutch Golden Age: an oak bench, Spanish chairs in leather and brass",
  up: { colors: ["#4a2c1a", "#5a2018", "#2c3a2a", "#3a2a20"], roughness: 0.55, sheen: 0.1, weave: "plain" },
  wood: { colors: ["#3b2a1a", "#2a1d14", "#4a3420"], finish: "grain" },
  metal: { color: "#b58f4c", metalness: 1, roughness: 0.38 },
  centre: [
    piece("oak bench", [0.55, 1.8], (k, w, d) => {
      k.box("up", w, 0.055, d, 0, 0.44, 0, 0.012);
      k.box("metal", w + 0.006, 0.014, d + 0.006, 0, 0.418, 0);
      k.box("wood", w - 0.04, 0.08, d - 0.04, 0, 0.37, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) turnedLeg(k, "wood", sx * (w / 2 - 0.05), sz * (d / 2 - 0.06), 0.33, 0.026);
      for (const sx of [-1, 1]) k.box("wood", 0.04, 0.04, d - 0.12, sx * (w / 2 - 0.05), 0.07, 0);
      for (const sz of [-1, 1]) k.box("wood", w - 0.1, 0.04, 0.04, 0, 0.07, sz * (d / 2 - 0.06));
    }),
  ],
  wall: [piece("two chairs and a table", [1.9, 0.62], pairWithTable(spanishChair, 0.52, 0.5, (k) => gueridon(k, "wood", "wood", 0.24, 0.7)))],
  chairs: [chair("Dutch armchair", [0.6, 0.56], spanishArmchair), chair("Spanish chair", [0.52, 0.5], spanishChair)],
};

const EIGHTEENTH: FurnitureSet = {
  name: "Louis XV and XVI: gilt banquettes, bergères, fauteuils and medallion chairs in silk",
  up: { colors: ["#ddd0ae", "#b9c8cf", "#b7c4a4", "#d8b5a8", "#dcc489"], roughness: 0.72, sheen: 0.35, weave: "damask" },
  wood: { colors: ["#e3dac6", "#d9d2c0", "#cfd5cf"], finish: "paint" },
  metal: { color: "#d2a54e", metalness: 1, roughness: 0.3 },
  centre: [
    piece("gilt banquette", [0.5, 1.6], (k, w, d) => {
      k.box("up", w, 0.12, d, 0, 0.42, 0, 0.045);
      k.box("metal", w + 0.02, 0.07, d + 0.02, 0, 0.335, 0, 0.012);
      for (const sx of [-1, 1]) for (const z of [-(d / 2 - 0.06), 0, d / 2 - 0.06]) taperedLeg(k, "metal", sx * (w / 2 - 0.05), z, 0.3, 0.024);
    }),
  ],
  wall: [
    piece("two chairs and a table", [1.8, 0.62], pairWithTable(medallionChair, 0.52, 0.5, (k) => gueridon(k.tinted("wood", "#e8e2d8"), "wood", "metal", 0.24, 0.7))),
    piece("canapé", [1.8, 0.66], settee("wood", "tapered")),
  ],
  chairs: [
    chair("bergère", [0.72, 0.7], bergere("wood")),
    chair("fauteuil à la reine", [0.64, 0.6], fauteuil("wood")),
    chair("gilt bergère", [0.72, 0.7], bergere("metal")),
  ],
};

const NINETEENTH: FurnitureSet = {
  name: "Second Empire: a round borne, crapauds, gilt fauteuils and a Chesterfield in velvet",
  up: { colors: ["#5a1b17", "#1f4a36", "#7e5e26", "#3d2240", "#20304a"], roughness: 0.85, sheen: 0.8, weave: "plain" },
  wood: { colors: ["#2e1d13", "#3a2216"], finish: "grain" },
  metal: { color: "#b08b4c", metalness: 1, roughness: 0.4 },
  centre: [piece("borne", [1.5, 1.5], borne), piece("banquette", [0.62, 1.8], banquette("wood"))],
  wall: [
    piece("Chesterfield", [1.8, 0.82], chesterfield),
    piece("two crapauds and a table", [2.1, 0.8], pairWithTable(crapaud, 0.72, 0.7, (k) => gueridon(k, "wood", "metal"))),
  ],
  chairs: [chair("crapaud", [0.72, 0.72], crapaud), chair("gilt fauteuil", [0.64, 0.6], fauteuil("metal"))],
};

const VICTORIAN: FurnitureSet = {
  name: "Victorian: a buttoned ottoman, spoon-back and wing chairs in plum, bottle green and mustard",
  up: { colors: ["#4e2236", "#24402e", "#7e6428", "#5e1c22", "#3a3550"], roughness: 0.86, sheen: 0.75, weave: "plain" },
  wood: { colors: ["#3a1e14", "#4a2416"], finish: "grain" },
  metal: { color: "#b38d4e", metalness: 1, roughness: 0.4 },
  centre: [
    piece("buttoned ottoman", [0.62, 1.7], (k, w, d) => {
      k.box("up", w, 0.2, d, 0, 0.36, 0, 0.07);
      k.box("up", w + 0.012, 0.05, d + 0.012, 0, 0.285, 0, 0.012);
      for (let i = 0; i < 5; i++) {
        for (const sx of [-1, 1]) k.ball("wood", 0.011, sx * w * 0.2, 0.46, -d * 0.36 + (i * d * 0.72) / 4 + (sx > 0 ? d * 0.09 : 0), 1, 0.7, 1, 6);
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) turnedLeg(k, "wood", sx * (w / 2 - 0.07), sz * (d / 2 - 0.08), 0.26, 0.028);
    }),
    piece("borne", [1.4, 1.4], borne),
  ],
  wall: [piece("two chairs and a table", [1.7, 0.6], pairWithTable(balloonChair, 0.48, 0.48, (k) => gueridon(k, "wood", "wood", 0.24, 0.7)))],
  chairs: [chair("spoon-back armchair", [0.66, 0.62], spoonBack), chair("wing chair", [0.82, 0.8], wingback)],
};

const IMPRESSIONIST: FurnitureSet = {
  name: "Paris 1870: a leather bench, Voltaire and crapaud armchairs, Thonet bentwood",
  up: { colors: ["#3b2a22", "#4a5a3a", "#2a3346", "#6b3a2a", "#6a2a2a"], roughness: 0.6, sheen: 0.45, weave: "plain" },
  wood: { colors: ["#2b1b12", "#3a2418", "#4a2c1a"], finish: "grain" },
  metal: { color: "#c8a66c", metalness: 0, roughness: 0.78 },
  centre: [
    piece("leather bench", [0.62, 1.9], (k, w, d) => {
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
    }),
  ],
  wall: [piece("two bentwood chairs and a table", [1.6, 0.6], pairWithTable(thonetArmchair, 0.52, 0.52, (k) => gueridon(k.tinted("wood", "#d8d2c8"), "wood", "metal", 0.3, 0.72)))],
  chairs: [chair("Voltaire armchair", [0.66, 0.66], voltaire), chair("crapaud", [0.72, 0.72], crapaud), chair("bentwood armchair", [0.56, 0.56], thonetArmchair)],
};

const SECESSION: FurnitureSet = {
  name: "Vienna 1900: a lacquered slat bench with gold squares, Kubus and club armchairs",
  up: { colors: ["#191715", "#2c2a26", "#4a3a2a", "#d8cfb8"], roughness: 0.45, sheen: 0.1, weave: "plain" },
  wood: { colors: ["#121110"], finish: "lacquer" },
  metal: { color: "#c9a24a", metalness: 1, roughness: 0.3 },
  centre: [
    piece("slat bench", [0.5, 1.8], (k, w, d) => {
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
    }),
  ],
  wall: [piece("two Kubus armchairs", [1.9, 0.76], pairWithTable(kubus, 0.8, 0.72, (k) => k.box("wood", 0.4, 0.5, 0.4, 0, 0.25, 0, 0.01)))],
  chairs: [chair("Kubus armchair", [0.8, 0.72], kubus), chair("club chair", [0.84, 0.86], clubChair)],
};

const EARLY_MODERN: FurnitureSet = {
  name: "Bauhaus: a Barcelona daybed, Barcelona, Wassily and club chairs",
  up: { colors: ["#1c1a18", "#6a3a1e", "#3a3836", "#7a5a3a"], roughness: 0.45, sheen: 0.05, weave: "plain" },
  wood: { colors: ["#3a2a1e", "#1c1a18"], finish: "grain" },
  metal: { color: "#d8dadc", metalness: 1, roughness: 0.18 },
  centre: [
    piece("Barcelona daybed", [0.75, 1.9], (k, w, d) => {
      k.box("up", w, 0.11, d, 0, 0.41, 0, 0.035);
      for (let z = -d / 2 + 0.19; z < d / 2 - 0.1; z += 0.19) k.box("up", w + 0.004, 0.112, 0.012, 0, 0.41, z);
      k.box("wood", w - 0.04, 0.05, d - 0.04, 0, 0.33, 0, 0.006);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.post("metal", 0.019, 0.019, 0.305, sx * (w / 2 - 0.1), 0, sz * (d / 2 - 0.12), 12);
    }),
  ],
  wall: [piece("two Wassily chairs", [1.9, 0.74], pairWithTable(wassily, 0.78, 0.7, (k) => k.post("metal", 0.25, 0.25, 0.02, 0, 0.52, 0, 28)))],
  chairs: [chair("Barcelona chair", [0.76, 0.78], barcelona), chair("Wassily chair", [0.78, 0.72], wassily), chair("club chair", [0.84, 0.86], clubChair)],
};

const POSTWAR: FurnitureSet = {
  name: "White cube: a solid oak bench, a low sofa, Danish teak armchairs",
  up: { colors: ["#3b3b3d", "#a8822a", "#2e5a5a", "#7a7a76", "#8a3a2a"], roughness: 0.92, sheen: 0.2, weave: "plain" },
  wood: { colors: ["#b49a78", "#8a5a3a", "#a07a52"], finish: "grain" },
  metal: { color: "#c9ccce", metalness: 1, roughness: 0.25 },
  centre: [
    piece("oak bench", [0.62, 1.9], (k, w, d) => {
      k.box("wood", w, 0.065, d, 0, 0.4075, 0, 0.008);
      for (const sz of [-1, 1]) k.box("wood", w - 0.08, 0.375, 0.065, 0, 0.1875, sz * (d / 2 - 0.28), 0.006);
    }),
  ],
  wall: [
    piece("low sofa", [1.9, 0.76], (k, W, depth) => {
      const zc = -depth / 2 + 0.37;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.post("metal", 0.011, 0.011, 0.2, sx * (W / 2 - 0.06), 0, zc + sz * 0.3, 8);
      k.box("metal", W - 0.04, 0.02, 0.68, 0, 0.21, zc);
      k.box("up", W, 0.15, 0.72, 0, 0.295, zc, 0.012);
      const n = W > 1.5 ? 3 : 2;
      const cw = (W - 0.24) / n;
      for (let i = 0; i < n; i++) k.box("up", cw - 0.01, 0.1, 0.56, -W / 2 + 0.12 + cw * (i + 0.5), 0.42, zc + 0.07, 0.02);
      k.box("up", W, 0.32, 0.14, 0, 0.53, zc - 0.29, 0.012);
      for (const sx of [-1, 1]) k.box("up", 0.12, 0.32, 0.72, sx * (W / 2 - 0.06), 0.53, zc, 0.012);
    }),
  ],
  chairs: [chair("teak armchair", [0.7, 0.72], loungeChair)],
};

const EAST_ASIAN: FurnitureSet = {
  name: "Ming: a huanghuali bench, official's hat and horseshoe armchairs",
  up: { colors: ["#8a6a42", "#5a2a20", "#2f3a2c"], roughness: 0.8, sheen: 0.2, weave: "plain" },
  wood: { colors: ["#6a3e22", "#5a3018", "#7a4a2a"], finish: "grain" },
  metal: { color: "#b08a50", metalness: 1, roughness: 0.4 },
  centre: [
    piece("huanghuali bench", [0.45, 1.7], (k, w, d) => {
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
    }),
  ],
  wall: [piece("two chairs and a table", [1.8, 0.56], pairWithTable(officialsHat, 0.6, 0.5, (k) => {
    k.box("wood", 0.42, 0.04, 0.42, 0, 0.7, 0, 0.006);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box("wood", 0.035, 0.68, 0.035, sx * 0.18, 0.34, sz * 0.18);
  }))],
  chairs: [chair("official's hat chair", [0.76, 0.56], officialsHat), chair("horseshoe armchair", [0.72, 0.6], horseshoe)],
};

const PRINT_ROOM: FurnitureSet = {
  name: "Edo tea house: hinoki benches under red felt",
  up: { colors: ["#9b2a24", "#7a2420", "#2a2a2a"], roughness: 0.95, sheen: 0.3, weave: "plain" },
  wood: { colors: ["#b8956a", "#a0805a"], finish: "grain" },
  metal: { color: "#1c1b19", metalness: 0, roughness: 0.55 },
  centre: [piece("shōgi", [0.55, 1.8], shogi)],
  wall: [piece("shōgi", [1.7, 0.6], alongWall(shogi, 0.55))],
  chairs: [],
};

const COURT_MINIATURE: FurnitureSet = {
  name: "Mughal court: low divans with bolsters, reed moras",
  up: { colors: ["#7c2131", "#1f4a3a", "#b07a28", "#2a2f5a"], roughness: 0.82, sheen: 0.7, weave: "damask" },
  wood: { colors: ["#2a1a12", "#3a2418"], finish: "grain" },
  metal: { color: "#c49a4c", metalness: 1, roughness: 0.35 },
  centre: [
    piece("divan", [0.75, 1.7], (k, w, d) => {
      k.box("wood", w, 0.18, d, 0, 0.12, 0, 0.012);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.post("wood", 0.035, 0.025, 0.03, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05));
      k.box("metal", w + 0.004, 0.015, d + 0.004, 0, 0.2, 0);
      k.box("up", w - 0.02, 0.15, d - 0.02, 0, 0.285, 0, 0.05);
      for (const sz of [-1, 1]) {
        const z = sz * (d / 2 - 0.12);
        k.tube("up", [-w / 2 + 0.05, 0.44, z], [w / 2 - 0.05, 0.44, z], 0.085, 16);
        for (const sx of [-1, 1]) k.ball("metal", 0.03, sx * (w / 2 - 0.045), 0.44, z);
      }
    }),
  ],
  wall: [
    piece("divan with cushions", [1.9, 0.82], (k, W, depth) => {
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
    }),
  ],
  chairs: [chair("mora", [0.46, 0.46], mora)],
};

const MUSEUM: FurnitureSet = {
  name: "A museum of today: leather benches on steel, upholstered armchairs",
  up: { colors: ["#2b2826", "#4a3a30", "#3a4048", "#5a4a38"], roughness: 0.5, sheen: 0.15, weave: "plain" },
  wood: { colors: ["#b9bcbf"], finish: "steel" },
  metal: { color: "#c8cbcd", metalness: 1, roughness: 0.25 },
  centre: [piece("steel bench", [0.62, 2.1], steelBench)],
  wall: [piece("steel bench", [1.8, 0.6], alongWall(steelBench, 0.55))],
  chairs: [chair("club chair", [0.84, 0.86], clubChair)],
};

// A palace gallery (the Louvre's Grande Galerie, the Rijksmuseum's Gallery of Honour) and a grand salon (the
// Louvre's red rooms): Second Empire seating, gilt and velvet, round bornes and long banquettes.
const PALACE: FurnitureSet = {
  name: "Palace gallery: velvet banquettes on gilt legs, round bornes, gilt fauteuils and bergères",
  up: { colors: ["#6a1c1c", "#5a1e2c", "#2a3a2c", "#7a5a2a"], roughness: 0.86, sheen: 0.8, weave: "plain" },
  wood: { colors: ["#3a2216", "#2e1d13"], finish: "grain" },
  metal: { color: "#d2a54e", metalness: 1, roughness: 0.3 },
  centre: [piece("gilt banquette", [0.66, 2.2], banquette("metal")), piece("borne", [1.6, 1.6], borne)],
  wall: [piece("gilt settee", [1.9, 0.68], settee("metal", "cabriole"))],
  chairs: [chair("gilt fauteuil", [0.64, 0.6], fauteuil("metal")), chair("gilt bergère", [0.72, 0.7], bergere("metal"))],
};

const SALON: FurnitureSet = {
  name: "Grand salon: round bornes, velvet banquettes, crapauds and gilt fauteuils",
  up: { colors: ["#5a1b17", "#3d2240", "#1f4a36", "#6e5226"], roughness: 0.86, sheen: 0.85, weave: "plain" },
  wood: { colors: ["#2e1d13"], finish: "grain" },
  metal: { color: "#c8a050", metalness: 1, roughness: 0.34 },
  centre: [piece("borne", [1.6, 1.6], borne), piece("velvet banquette", [0.66, 2.0], banquette("wood"))],
  wall: [piece("Chesterfield", [1.8, 0.82], chesterfield), piece("gilt settee", [1.9, 0.68], settee("metal", "turned"))],
  chairs: [chair("crapaud", [0.72, 0.72], crapaud), chair("gilt fauteuil", [0.64, 0.6], fauteuil("metal"))],
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
  palace: PALACE,
  salon: SALON,
};

export function furnitureOf(theme: Pick<GalleryTheme, "era">): FurnitureSet {
  return FURNITURE[theme.era] ?? NINETEENTH;
}

/** The footprints the layout arranges (layout.ts furnish). */
export function furnishSizes(set: FurnitureSet): FurnishSizes {
  return {
    centre: set.centre.map((p) => p.size),
    wall: set.wall.map((p) => p.size),
    chairs: set.chairs.map((p) => p.size),
  };
}

/** One of the style's colours for a piece: `tint` in [0, 1) picks it, `salt` decorrelates the parts. */
function pick(colors: string[], tint: number, salt: number): THREE.Color {
  const t = (tint * (1 + salt * 7.31) + salt * 0.37) % 1;
  return new THREE.Color(colors[Math.floor(t * colors.length) % colors.length]);
}

/** A piece of the layout's furnishing into the batches, in its colours. */
export function buildFurnishing(set: FurnitureSet, out: Batches, f: Furnishing): void {
  const list = f.kind === "centre" ? set.centre : f.kind === "wall" ? set.wall : set.chairs;
  const p = list[f.index];
  if (!p) return;
  const tints: Tints = {
    up: pick(set.up.colors, f.tint, 0),
    wood: pick(set.wood.colors, f.tint, 1),
    metal: new THREE.Color(set.metal.color),
  };
  const m = new THREE.Matrix4().makeRotationY(f.rotation).setPosition(f.position[0], 0, f.position[1]);
  p.build(new Kit(out, m, tints), f.size[0], f.size[1]);
}
