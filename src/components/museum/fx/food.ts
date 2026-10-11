// Food: how each looks in the air and on the floor (one vertex-coloured
// geometry per piece, kit.ts) and what it leaves on a surface (splat plans,
// rasterized like paint's, splat.ts):
//   - a slice of pizza: a sector of dough with a raised crust, cheese with
//     golden blisters, sauce showing at the crust, pepperoni. It lands face
//     first, so its print is a wedge of tomato and molten cheese with the
//     pepperoni stamped in where they were, sauce squeezed out at the cut
//     edges and strings of cheese running down;
//   - a burger: a sesame bun, a patty under a melted slice of cheese,
//     tomato, lettuce. It bursts into ketchup and a squiggle of mustard over
//     a greasy print, with bits of lettuce, sesame and sometimes a pickle;
//   - an ice cream: a waffle cone and one scoop (strawberry, vanilla,
//     chocolate or mint). A thick, round-shouldered dollop with fat, slow
//     melting runs and whatever was on top (sprinkles, chips, bits).
// The egg lives in splat.ts.

import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Kit, mix } from "./kit";
import { clamp, gauss, rng, smoothstep, vnoise, type Rng } from "./noise";
import {
  BODY,
  CAPSULE,
  POLY,
  biasedAngle,
  bodyRadiusAt,
  bodyTable,
  bottomAt,
  ellipseAlong,
  planExtent,
  shardOutline,
  type BodyPrim,
  type DripSpec,
  type Prim,
  type RGB,
  type Shape,
  type SplatPlan,
} from "./splat";

export type FoodKind = "pizza" | "burger" | "icecream";

/** Pieces that fly off and lie on the floor (debris.ts). */
export type Piece = "slice" | "bunTop" | "bunBottom" | "patty" | "tomato" | "lettuce" | "cone";

// ---------------------------------------------------------------- colours

const CHEESE: RGB = [250, 208, 98];
const CHEESE_GOLD: RGB = [222, 146, 50];
const CHEESE_MELT: RGB = [252, 204, 82];
const CHEESE_DEEP: RGB = [244, 168, 50];
const SAUCE: RGB = [178, 32, 18];
const SAUCE_DEEP: RGB = [140, 18, 10];
const SAUCE_BAKED: RGB = [176, 50, 24];
const DOUGH: RGB = [236, 206, 150];
const DOUGH_BAKED: RGB = [226, 190, 132];
const DOUGH_DARK: RGB = [150, 96, 48];
const CRUST: RGB = [224, 164, 86];
const CRUST_DARK: RGB = [188, 116, 46];
const CRUST_CHAR: RGB = [118, 68, 32];
const PEPPERONI: RGB = [196, 62, 42];
const PEPPERONI_RIM: RGB = [126, 26, 18];
const BUN: RGB = [172, 98, 40];
const BUN_EDGE: RGB = [224, 168, 98];
const CRUMB: RGB = [240, 218, 170];
const SESAME: RGB = [246, 230, 186];
const PATTY: RGB = [92, 52, 30];
const PATTY_CHAR: RGB = [56, 30, 18];
const CHEESE_SLICE: RGB = [246, 156, 22];
const TOMATO: RGB = [214, 38, 26];
const TOMATO_SEEDS: RGB = [240, 128, 92];
const LETTUCE: RGB = [86, 160, 44];
const LETTUCE_PALE: RGB = [196, 226, 128];
const KETCHUP: RGB = [192, 22, 16];
const KETCHUP_DEEP: RGB = [150, 10, 8];
const MUSTARD: RGB = [238, 184, 22];
const MUSTARD_DEEP: RGB = [222, 152, 10];
const GREASE: RGB = [214, 130, 48];
const WAFFLE: RGB = [226, 168, 94];
const WAFFLE_GROOVE: RGB = [172, 108, 50];
const WAFFLE_RIM: RGB = [196, 132, 64];

const RAINBOW: RGB[] = [
  [236, 52, 60],
  [252, 196, 36],
  [64, 150, 236],
  [108, 200, 84],
  [248, 246, 240],
  [236, 112, 196],
];

export interface Flavour {
  id: "strawberry" | "vanilla" | "chocolate" | "mint";
  cream: RGB;
  deep: RGB;
  /** sprinkles on top (colours), or none */
  sprinkles: RGB[] | null;
  /** chips / bits mixed in, and tiny specks (vanilla seeds) */
  bits: RGB | null;
  specks: RGB | null;
}

export const FLAVOURS: Flavour[] = [
  { id: "strawberry", cream: [246, 166, 186], deep: [228, 118, 146], sprinkles: null, bits: [192, 40, 76], specks: null },
  { id: "vanilla", cream: [250, 238, 204], deep: [238, 218, 168], sprinkles: RAINBOW, bits: null, specks: [72, 50, 30] },
  { id: "chocolate", cream: [112, 64, 38], deep: [80, 42, 24], sprinkles: [[250, 246, 236], [240, 128, 176], [252, 214, 90]], bits: null, specks: null },
  { id: "mint", cream: [180, 234, 202], deep: [140, 210, 170], sprinkles: null, bits: [56, 34, 22], specks: null },
];

/** The flavour of a throw (the same for its scoop and its splat). */
export function flavourOf(seed: number): Flavour {
  return FLAVOURS[(seed >>> 9) % FLAVOURS.length];
}

// ------------------------------------------------------------------ pizza

/** The slice: a sector of radius L (m) and half-angle A, centred on its centroid. */
export const SLICE = { L: 0.17, A: 0.36 };
/** From the centroid to the tip. */
const SLICE_C = (2 * SLICE.L * Math.sin(SLICE.A)) / (3 * SLICE.A);
/** Pepperoni: distance from the tip and angle off the slice's axis (the print puts them in the same places). */
const SLICE_PEPPERONI: [number, number][] = [
  [0.062, 0.04],
  [0.1, -0.2],
  [0.128, 0.16],
];
const PEP_R = 0.0145;

/** Which way the slice's tip points on the surface (splat space, rad; +y is down): mostly down a wall. */
export function sliceAngle(seed: number, vertical: boolean): number {
  const r = rng(seed ^ 0x2f6b4e1d);
  return vertical ? Math.PI / 2 + gauss(r) * 1.1 : r() * Math.PI * 2;
}

/** The slice, cheese up (+z), crust toward +y, the tip toward −y. */
function sliceGeometry(): THREE.BufferGeometry {
  const { L, A } = SLICE;
  const C = SLICE_C;
  const h = 0.003;
  const t0 = Math.PI / 2 - A;
  const k = new Kit();
  // the top: cheese, golden where it blistered, the sauce showing toward the crust
  const top = new THREE.RingGeometry(0.003, L - 0.004, 12, 8, t0, 2 * A);
  top.translate(0, -C, h);
  k.add(top, (p) => {
    const r = Math.hypot(p.x, p.y + C);
    const cheese = mix(CHEESE, CHEESE_GOLD, smoothstep(0.56, 0.82, vnoise(p.x * 80, p.y * 80, 11)));
    return mix(cheese, SAUCE_BAKED, smoothstep(L - 0.045, L - 0.018, r) * (0.55 + 0.45 * vnoise(p.x * 120, p.y * 120, 5)));
  });
  // the underside: pale baked dough, browned in spots
  const bot = new THREE.RingGeometry(0.003, L - 0.004, 10, 6, t0, 2 * A);
  bot.rotateY(Math.PI);
  bot.translate(0, -C, -h);
  k.add(bot, (p) => mix(DOUGH_BAKED, DOUGH_DARK, smoothstep(0.5, 0.85, vnoise(p.x * 90, p.y * 90, 3)) * 0.8));
  // the cut edges, facing out
  for (const th of [t0, t0 + 2 * A]) {
    const side = new THREE.PlaneGeometry(L - 0.004, 2 * h);
    side.rotateX(-Math.PI / 2);
    side.rotateZ(th === t0 ? th + Math.PI : th);
    side.translate((Math.cos(th) * (L - 0.004)) / 2, (Math.sin(th) * (L - 0.004)) / 2 - C, 0);
    k.add(side, DOUGH);
  }
  // the crust: browner on top, a few charred spots
  const crust = new THREE.TorusGeometry(L - 0.009, 0.0085, 7, 18, 2 * A);
  crust.scale(1, 1, 0.82);
  crust.rotateZ(t0);
  crust.translate(0, -C, 0.0015);
  k.add(crust, (p, n) => mix(mix(CRUST, CRUST_DARK, Math.max(0, n.z) * 0.75), CRUST_CHAR, smoothstep(0.72, 0.92, vnoise(p.x * 150, p.y * 150, 21)) * 0.6));
  for (const th of [t0, t0 + 2 * A]) {
    const cap = new THREE.SphereGeometry(0.0085, 7, 5);
    cap.scale(1, 1, 0.82);
    cap.translate(Math.cos(th) * (L - 0.009), Math.sin(th) * (L - 0.009) - C, 0.0015);
    k.add(cap, CRUST);
  }
  // pepperoni: darker toward the rim
  for (const [d, off] of SLICE_PEPPERONI) {
    const th = Math.PI / 2 + off;
    const cx = Math.cos(th) * d;
    const cy = Math.sin(th) * d - C;
    const disc = new THREE.CylinderGeometry(PEP_R, PEP_R, 0.0022, 14);
    disc.rotateX(Math.PI / 2);
    disc.translate(cx, cy, h + 0.0011);
    k.add(disc, (p, n) => (n.z > 0.5 ? mix(PEPPERONI, PEPPERONI_RIM, Math.hypot(p.x - cx, p.y - cy) / PEP_R) : PEPPERONI_RIM));
  }
  return k.build();
}

// ----------------------------------------------------------------- burger

const BUN_R = 0.05;
const BUN_H = 0.032;

/** The burger's parts, bottom to top: each centred on itself, and where it sits in the stack (m from its centre). */
export const BURGER_STACK: { piece: Piece; y: number }[] = [
  { piece: "bunBottom", y: -0.028 },
  { piece: "patty", y: -0.012 },
  { piece: "tomato", y: -0.002 },
  { piece: "lettuce", y: 0.002 },
  { piece: "bunTop", y: 0.02 },
];

function bunTopGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  const dome = new THREE.SphereGeometry(BUN_R, 20, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, BUN_H / BUN_R, 1);
  dome.translate(0, -BUN_H / 2, 0);
  k.add(dome, (p) => mix(BUN, BUN_EDGE, smoothstep(BUN_H * 0.1, -BUN_H * 0.45, p.y)));
  const base = new THREE.CircleGeometry(BUN_R, 20);
  base.rotateX(Math.PI / 2);
  base.translate(0, -BUN_H / 2, 0);
  k.add(base, CRUMB);
  // sesame, lying along the dome
  const r = rng(77);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 18; i++) {
    const th = r() * Math.PI * 2;
    const ph = 0.12 + 1.0 * Math.sqrt(r());
    const sx = Math.sin(ph) * Math.cos(th);
    const sy = Math.cos(ph);
    const sz = Math.sin(ph) * Math.sin(th);
    const nrm = new THREE.Vector3(sx / BUN_R, sy / BUN_H, sz / BUN_R).normalize();
    const seed = new THREE.SphereGeometry(1, 6, 4);
    seed.scale(0.0019, 0.0009, 0.0034);
    seed.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(up, r() * 6.28)));
    seed.translate(sx * BUN_R, sy * BUN_H - BUN_H / 2, sz * BUN_R);
    k.add(seed, SESAME);
  }
  return k.build();
}

function bunBottomGeometry(): THREE.BufferGeometry {
  return new Kit().add(new THREE.CylinderGeometry(0.049, 0.046, 0.018, 20), (p, n) => (n.y > 0.5 ? CRUMB : mix(BUN_EDGE, BUN, smoothstep(0.004, -0.009, p.y)))).build();
}

function pattyGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  // hand-formed: a lumpy edge, a little uneven in height
  const g = new THREE.CylinderGeometry(0.05, 0.05, 0.014, 22, 2);
  const P = g.getAttribute("position");
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i);
    const y = P.getY(i);
    const z = P.getZ(i);
    const a = Math.atan2(z, x);
    const s = 1 + 0.07 * (vnoise(Math.cos(a) * 3 + 5, Math.sin(a) * 3 + y * 60, 9) - 0.5);
    P.setXYZ(i, x * s, y * (1 + 0.2 * (vnoise(x * 60, z * 60, 4) - 0.5)), z * s);
  }
  g.computeVertexNormals();
  k.add(g, (p) => mix(PATTY, PATTY_CHAR, smoothstep(0.5, 0.8, vnoise(p.x * 120, p.z * 120 + p.y * 200, 13))));
  // the cheese: a square slice melted over it, corners drooping
  const ch = new THREE.PlaneGeometry(0.078, 0.078, 8, 8);
  ch.rotateX(-Math.PI / 2);
  ch.rotateY(0.5);
  const C = ch.getAttribute("position");
  for (let i = 0; i < C.count; i++) {
    const x = C.getX(i);
    const z = C.getZ(i);
    const rr = Math.hypot(x, z);
    C.setY(i, 0.0082 - Math.max(0, rr - 0.04) * 0.85);
  }
  ch.computeVertexNormals();
  k.add(ch, CHEESE_SLICE);
  return k.build();
}

function tomatoGeometry(): THREE.BufferGeometry {
  return new Kit()
    .add(new THREE.CylinderGeometry(0.041, 0.041, 0.006, 18), (p, n) =>
      Math.abs(n.y) > 0.5 ? mix(TOMATO_SEEDS, TOMATO, smoothstep(0.004, 0.036, Math.hypot(p.x, p.z))) : TOMATO,
    )
    .build();
}

function lettuceGeometry(): THREE.BufferGeometry {
  // a frilly leaf: a ruffled outline, waves growing toward the edge
  const g = new THREE.RingGeometry(0.002, 0.056, 32, 4);
  g.rotateX(-Math.PI / 2);
  const P = g.getAttribute("position");
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i);
    const z = P.getZ(i);
    const a = Math.atan2(z, x);
    const wave = Math.sin(a * 9 + 1.3) * 0.6 + Math.sin(a * 5 - 0.4) * 0.4;
    const e = 1 + 0.08 * wave;
    P.setXYZ(i, x * e, 0.0045 * wave * Math.pow(Math.hypot(x, z) / 0.056, 1.5), z * e);
  }
  g.computeVertexNormals();
  return new Kit().add(g, (p) => mix(LETTUCE_PALE, LETTUCE, smoothstep(0.008, 0.05, Math.hypot(p.x, p.z)))).build();
}

// --------------------------------------------------------------- ice cream

/** The waffle cone: length and rim radius (m); centred on its middle, the rim toward +y. */
export const CONE = { L: 0.115, R: 0.027 };

function coneGeometry(): THREE.BufferGeometry {
  const { L, R } = CONE;
  const NJ = 10;
  const NK = 18;
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: RGB[] = [];
  const v = (j: number, k: number) => {
    const a = (k / NK) * Math.PI * 2;
    const r = Math.max(0.0012, (R * j) / NJ);
    return [Math.cos(a) * r, -L / 2 + (L * j) / NJ, Math.sin(a) * r];
  };
  const n = (k: number) => new THREE.Vector3(Math.cos((k / NK) * Math.PI * 2), -R / L, Math.sin((k / NK) * Math.PI * 2)).normalize().toArray();
  for (let j = 0; j < NJ; j++) {
    for (let k = 0; k < NK; k++) {
      // the waffle: grooves along both diagonals, diamonds between
      const groove = (j + k) % 3 === 0 || (k - j + 3 * NJ) % 3 === 0;
      const c = groove ? WAFFLE_GROOVE : WAFFLE;
      for (const [jj, kk] of [
        [j, k],
        [j + 1, k],
        [j + 1, k + 1],
        [j, k],
        [j + 1, k + 1],
        [j, k + 1],
      ]) {
        pos.push(...v(jj, kk));
        nrm.push(...n(kk));
      }
      col.push(c, c);
    }
  }
  const k = new Kit().tris(pos, nrm, col);
  const rim = new THREE.TorusGeometry(R, 0.0034, 5, 22);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, L / 2, 0);
  return k.add(rim, WAFFLE_RIM).build();
}

/** A scoop of `f`, its base at y = 0. */
export function scoopGeometry(f: Flavour): THREE.BufferGeometry {
  const k = new Kit();
  const r = rng(FLAVOURS.indexOf(f) * 131 + 7);
  let ball: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.031, 2);
  ball.deleteAttribute("normal");
  ball.deleteAttribute("uv");
  ball = mergeVertices(ball);
  // scooped: lumpy, the bottom pressed flat where it sits in the cone
  const P = ball.getAttribute("position");
  const p = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i);
    const s = 1 + 0.08 * (vnoise(p.x * 90 + 3, p.y * 90 + p.z * 40, 17) - 0.5) + 0.04 * (vnoise(p.x * 220, p.z * 220, 19) - 0.5);
    p.multiplyScalar(s);
    if (p.y < -0.012) p.y = -0.012 + (p.y + 0.012) * 0.25;
    P.setXYZ(i, p.x, p.y + 0.015, p.z);
  }
  ball.computeVertexNormals();
  k.add(ball, (q) => mix(f.cream, f.deep, smoothstep(0.55, 0.9, vnoise(q.x * 140, q.y * 140 + q.z * 60, 23)) * 0.5));
  // the frilly skirt where the scoop meets the cone
  const skirt = new THREE.TorusGeometry(0.026, 0.0062, 6, 24);
  skirt.rotateX(Math.PI / 2);
  const S = skirt.getAttribute("position");
  for (let i = 0; i < S.count; i++) {
    const a = Math.atan2(S.getZ(i), S.getX(i));
    S.setY(i, S.getY(i) + 0.004 + 0.0018 * Math.sin(a * 7));
  }
  skirt.computeVertexNormals();
  k.add(skirt, f.cream);
  // what is on it: sprinkles, chips or bits
  const up = new THREE.Vector3(0, 1, 0);
  const n = f.sprinkles ? 24 : f.bits ? 9 : 0;
  for (let i = 0; i < n; i++) {
    const d = new THREE.Vector3(gauss(r), 0.6 + r(), gauss(r)).normalize();
    const at = d.clone().multiplyScalar(0.031).add(new THREE.Vector3(0, 0.015, 0));
    let g: THREE.BufferGeometry;
    let c: RGB;
    if (f.sprinkles) {
      g = new THREE.CylinderGeometry(0.0011, 0.0011, 0.0065, 5);
      // lying on the surface, any way round
      const t = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).cross(d).normalize();
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, t));
      c = f.sprinkles[Math.floor(r() * f.sprinkles.length)];
    } else {
      g = new THREE.IcosahedronGeometry(0.0032, 0);
      g.scale(1, 0.6, 1);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d));
      c = f.bits!;
    }
    g.translate(at.x, at.y, at.z);
    k.add(g, c);
  }
  return k.build();
}

/** A debris piece's geometry. */
export function pieceGeometry(p: Piece): THREE.BufferGeometry {
  switch (p) {
    case "slice":
      return sliceGeometry();
    case "bunTop":
      return bunTopGeometry();
    case "bunBottom":
      return bunBottomGeometry();
    case "patty":
      return pattyGeometry();
    case "tomato":
      return tomatoGeometry();
    case "lettuce":
      return lettuceGeometry();
    case "cone":
      return coneGeometry();
  }
}

// ----------------------------------------------------------------- splats

export interface FoodHit {
  seed: number;
  /** impact direction along the surface (splat space, unit) */
  dirX: number;
  dirY: number;
  /** 0 head-on … 1 grazing */
  oblique: number;
  /** the surface is wall-like: it runs */
  vertical: boolean;
  /** size of this one and how hard it lands (1 = typical) */
  scale: number;
}

/** Colours of the bits that fly off an impact (particles): sauce and cheese, lettuce and sesame, toppings and cone. */
export function flecks(kind: FoodKind, seed: number): RGB[] {
  if (kind === "pizza") return [SAUCE, SAUCE, CHEESE_MELT, [70, 92, 36]];
  if (kind === "burger") return [LETTUCE, LETTUCE_PALE, SESAME, SESAME, BUN_EDGE];
  const f = flavourOf(seed);
  return [...(f.sprinkles ?? (f.bits ? [f.bits] : [f.cream])), WAFFLE, WAFFLE_GROOVE];
}

export function buildFoodSplat(kind: FoodKind, p: FoodHit): SplatPlan {
  if (kind === "pizza") return buildPizzaSplat(p);
  if (kind === "burger") return buildBurgerSplat(p);
  return buildIceCreamSplat(p);
}

/** A shape with quiet defaults (no rim, no pooling, opaque). */
function shape(prims: Prim[], color: RGB, seed: number, o: Partial<Shape> = {}): Shape {
  return { prims, k: 0.003, color, tMax: 0.3, lambda: 0.0015, rimAt: 0, rimW: 1, rimAmp: 0, pool: 0, poolSize: 1, alpha: 1, thinAlpha: 1, glaze: 0, seed, ...o };
}

function blob(r: Rng, x: number, y: number, R: number, lobes = 3): BodyPrim {
  const t = bodyTable(r, R, { from: 2, to: 10, amp: 0.13, fall: 0.8 }, { n: lobes, amp: 0.25, width: 0.35 }, { n: 1, amp: 0.18, width: 0.35 });
  return { k: BODY, cx: x, cy: y, ca: 1, sa: 0, ex: 1, ey: 1, table: t.table, rmax: t.rmax };
}

/** A run with the shared look of food: a bead at its tip, its own colour. */
function run(r: Rng, x: number, y: number, w: number, len: number, color: RGB, o: Partial<DripSpec> & { seed: number }): DripSpec {
  return {
    x,
    y: y - w * 0.4,
    w,
    len,
    tau: 1.6 + 1.6 * r() + len * 8,
    delay: 0.2 + 0.7 * r(),
    bead: w * (0.75 + 0.2 * r()),
    color,
    tMax: 0.35,
    alpha: 1,
    glaze: 0.2,
    trailAlpha: 1,
    trailStreak: 0,
    wobble: w * 0.25,
    ...o,
  };
}

/** Runs from the lowest edge of `s`, spaced apart. */
function runsBelow(r: Rng, s: Shape, n: number, spread: number, cx: number, cy: number, make: (x: number, y: number) => DripSpec): DripSpec[] {
  const out: DripSpec[] = [];
  const used: number[] = [];
  for (let i = 0; i < n * 4 && out.length < n; i++) {
    const x = cx + gauss(r) * spread;
    if (used.some((u) => Math.abs(u - x) < 0.012)) continue;
    const y = bottomAt(s, x, cy - spread * 2, cy + spread * 3, 0.002);
    if (y === null) continue;
    used.push(x);
    out.push(make(x, y));
  }
  return out;
}

/**
 * Pizza: the slice's own wedge in sauce and cheese (it sticks face first
 * and peels off, revealing it), pepperoni where the slice had them, sauce
 * squeezed out along the cut edges and flung the way it was going, a
 * greasy halo, oregano, strings of cheese.
 */
function buildPizzaSplat(p: FoodHit): SplatPlan {
  const r = rng(p.seed);
  const S = p.scale;
  const e = clamp(p.oblique, 0, 0.8);
  const theta = Math.atan2(p.dirY, p.dirX);
  const a = sliceAngle(p.seed, p.vertical);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const L = SLICE.L * S;
  const A = SLICE.A;
  const C = SLICE_C * S;
  // a point of the slice by its distance from the tip and its angle off the axis
  // (the same mapping as the mesh, so the print lies under the slice)
  const at = (d: number, off: number): [number, number] => {
    const c = Math.cos(off);
    const s = Math.sin(off);
    return [ux * C - (ux * c - uy * s) * d, uy * C - (uy * c + ux * s) * d];
  };
  const shapes: Shape[] = [];

  // grease soaking out round it, fading at its edge
  const halo: Prim[] = [{ k: POLY, pts: [...at(-0.01 * S, 0), ...at(L + 0.006 * S, -A - 0.08), ...at(L + 0.014 * S, 0), ...at(L + 0.006 * S, A + 0.08)] }];
  shapes.push(shape(halo, GREASE, p.seed + 1, { k: 0.012, tMax: 0.02, alpha: 0.22, glaze: 0.55, lambda: 0.012, thinAlpha: 0 }));

  // sauce: the wedge (it stops short of the crust: bread leaves little)
  const wedge: number[] = [...at(0.006 * S, 0)];
  for (let i = 0; i <= 8; i++) wedge.push(...at(L - 0.02 * S, -A * 0.93 + (2 * A * 0.93 * i) / 8));
  const sauce: Prim[] = [{ k: POLY, pts: wedge }];
  const nOoze = 6 + Math.floor(r() * 5);
  for (let i = 0; i < nOoze; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const [x, y] = r() < 0.2 ? at(L - 0.016 * S, (r() * 2 - 1) * A * 0.8) : at((0.25 + 0.7 * r()) * L, side * A);
    sauce.push(blob(r, x, y, (0.007 + 0.011 * r()) * S, 2));
  }
  const nd = 16 + Math.floor(r() * 16);
  for (let i = 0; i < nd; i++) {
    const phi = biasedAngle(r, theta, 0.25 + e * 0.6);
    const reach = (0.075 + 0.03 * r() + 0.05 * -Math.log(1 - r() * 0.95) * (1 + e)) * S;
    const rd = (0.0014 + 0.0042 * r() * r()) * S;
    sauce.push(ellipseAlong(Math.cos(phi) * reach, Math.sin(phi) * reach, phi, rd * (1.3 + r() + 2 * e), rd));
  }
  const sauceShape = shape(sauce, SAUCE, p.seed + 2, {
    core: SAUCE_DEEP,
    coreDepth: 0.012,
    k: 0.004,
    tMax: 0.28,
    lambda: 0.002,
    rimAt: 0.003,
    rimW: 0.004,
    rimAmp: 0.2,
    pool: 0.25,
    poolSize: 0.02,
    detail: { amp: 0.35, size: 0.004 },
    thinAlpha: 0.8,
    glaze: 0.12,
  });
  shapes.push(sauceShape);

  // molten cheese in lobes over it, strings pulled out over the edges
  const cheese: Prim[] = [];
  const nb = 5 + Math.floor(r() * 3);
  for (let i = 0; i < nb; i++) {
    const d = (0.03 + 0.11 * Math.sqrt(r())) * S;
    const [x, y] = at(d, (r() * 2 - 1) * A * 0.72);
    cheese.push(blob(r, x, y, (0.009 + 0.012 * r()) * S * Math.min(1, 0.4 + d / L)));
  }
  const nStr = 2 + Math.floor(r() * 3);
  for (let i = 0; i < nStr; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const [x, y] = at((0.04 + 0.1 * r()) * S, side * A * 0.85);
    // pulled out across the cut edge, sagging as it goes
    let g = side * (Math.PI / 2 - 0.3) + gauss(r) * 0.4;
    let px = x;
    let py = y;
    let ra = 0.0024 * S;
    for (let k = 0; k < 2; k++) {
      const ox = -(ux * Math.cos(g) - uy * Math.sin(g));
      const oy = -(uy * Math.cos(g) + ux * Math.sin(g));
      const len = (0.006 + 0.01 * r()) * S;
      cheese.push({ k: CAPSULE, ax: px, ay: py, bx: px + ox * len, by: py + oy * len + len * 0.4, ra, rb: ra * 0.55 });
      px += ox * len;
      py += oy * len + len * 0.4;
      ra *= 0.55;
      g += side * 0.5;
    }
    if (r() < 0.5) cheese.push(ellipseAlong(px, py, 0, 0.0022 * S, 0.0018 * S));
  }
  const cheeseShape = shape(cheese, CHEESE_MELT, p.seed + 3, {
    core: CHEESE_DEEP,
    coreDepth: 0.007,
    k: 0.005,
    tMax: 0.4,
    lambda: 0.003,
    rimAt: 0.002,
    rimW: 0.003,
    rimAmp: 0.2,
    pool: 0.2,
    poolSize: 0.015,
    detail: { amp: 0.25, size: 0.005 },
    glaze: 0.3,
  });
  shapes.push(cheeseShape);
  // browned blisters
  const blisters: Prim[] = [];
  for (let i = 0; i < 6 + Math.floor(r() * 6); i++) {
    const [x, y] = at((0.04 + 0.1 * r()) * S, (r() * 2 - 1) * A * 0.6);
    blisters.push(ellipseAlong(x, y, r() * 3.14, (0.002 + 0.003 * r()) * S, (0.0015 + 0.002 * r()) * S));
  }
  shapes.push(shape(blisters, CHEESE_GOLD, p.seed + 4, { k: 0.002, tMax: 0.05, alpha: 0.55, glaze: 0.2 }));

  // the pepperoni, where the slice had them, cupped at the rim, flecked with fat
  const peps: Prim[] = [];
  const fat: Prim[] = [];
  for (const [d, off] of SLICE_PEPPERONI) {
    const [x, y] = at(d * S, off);
    peps.push(ellipseAlong(x, y, theta, PEP_R * S * (1 + 0.15 * e), PEP_R * S));
    for (let i = 0; i < 4; i++) {
      const fa = r() * Math.PI * 2;
      const fd = PEP_R * S * 0.7 * Math.sqrt(r());
      fat.push(ellipseAlong(x + Math.cos(fa) * fd, y + Math.sin(fa) * fd, r() * 3.14, 0.0016 * S, 0.0011 * S));
    }
  }
  shapes.push(
    shape(peps, PEPPERONI_RIM, p.seed + 5, { core: PEPPERONI, coreDepth: 0.006, k: 0, tMax: 0.32, lambda: 0.001, rimAt: 0.0016, rimW: 0.002, rimAmp: 0.45, glaze: 0.2 }),
    shape(fat, [230, 156, 126], p.seed + 6, { k: 0, tMax: 0.05, alpha: 0.7 }),
  );
  // oregano
  const herbs: Prim[] = [];
  for (let i = 0; i < 12; i++) {
    const [x, y] = at((0.02 + 0.13 * r()) * S, (r() * 2 - 1) * A * 0.85);
    herbs.push({ k: POLY, pts: shardOutline(r, x, y, (0.0011 + 0.0012 * r()) * S, 1.4) });
  }
  shapes.push(shape(herbs, [70, 92, 36], p.seed + 7, { k: 0, tMax: 0.04 }));

  let drips: DripSpec[] = [];
  if (p.vertical) {
    // strings of cheese, thin and wandering, a blob at the end
    drips = runsBelow(r, cheeseShape, 2 + Math.floor(r() * 3), 0.04 * S, 0, 0, (x, y) => {
      const w = (0.0025 + 0.003 * r()) * S;
      return run(r, x, y, w, (0.04 + 0.1 * Math.pow(r(), 1.2)) * S, CHEESE_MELT, {
        bead: w * (1.1 + 0.4 * r()),
        tMax: 0.35,
        glaze: 0.3,
        wobble: w * (0.5 + 0.8 * r()),
        seed: (p.seed + 20 + Math.floor(r() * 997)) >>> 0,
      });
    });
    drips.push(
      ...runsBelow(r, sauceShape, 1 + Math.floor(r() * 3), 0.05 * S, 0, 0, (x, y) =>
        run(r, x, y, (0.004 + 0.004 * r()) * S, (0.03 + 0.09 * Math.pow(r(), 1.4)) * S, SAUCE, { tMax: 0.3, glaze: 0.12, seed: (p.seed + 40 + Math.floor(r() * 997)) >>> 0 }),
      ),
    );
  }
  return { shapes, drips, extent: planExtent(shapes, drips) };
}

/**
 * Burger: a greasy print, a glossy lobed blob of ketchup with fat fingers
 * and spatter, a squiggle of mustard across it, torn lettuce, sesame seeds
 * and now and then a slice of pickle.
 */
function buildBurgerSplat(p: FoodHit): SplatPlan {
  const r = rng(p.seed);
  const S = p.scale;
  const e = clamp(p.oblique, 0, 0.8);
  const theta = Math.atan2(p.dirY, p.dirX);
  const ca = Math.cos(theta);
  const sa = Math.sin(theta);
  const R = (0.042 + 0.014 * r()) * S;
  const cx = ca * R * 0.15 * e;
  const cy = sa * R * 0.15 * e;
  const shapes: Shape[] = [];

  shapes.push(shape([blob(r, 0, 0, R * 1.2, 2)], [126, 78, 40], p.seed + 1, { k: 0.008, tMax: 0.03, alpha: 0.3, glaze: 0.5, lambda: 0.003 }));

  // ketchup
  const kt = bodyTable(r, R * 0.8, { from: 2, to: 14, amp: 0.1, fall: 0.8 }, { n: 3 + Math.floor(r() * 3), amp: 0.28, width: 0.25 }, { n: 2, amp: 0.18, width: 0.3 });
  const body: BodyPrim = { k: BODY, cx, cy, ca, sa, ex: 1 + 0.5 * e, ey: 1 - 0.1 * e, table: kt.table, rmax: kt.rmax };
  const ketchup: Prim[] = [body];
  const nf = 4 + Math.floor(r() * 5);
  for (let i = 0; i < nf; i++) {
    const phi = biasedAngle(r, theta, 0.3 + e * 0.5);
    const rb0 = bodyRadiusAt(body, phi);
    const ra = R * (0.06 + 0.07 * r());
    const len = R * (0.3 + 0.6 * r()) * (1 + e);
    const sx = cx + Math.cos(phi) * rb0 * 0.8;
    const sy = cy + Math.sin(phi) * rb0 * 0.8;
    const ex = sx + Math.cos(phi) * len;
    const ey = sy + Math.sin(phi) * len;
    ketchup.push({ k: CAPSULE, ax: sx, ay: sy, bx: ex, by: ey, ra, rb: ra * 0.5 });
    if (r() < 0.5) ketchup.push(ellipseAlong(ex + Math.cos(phi) * ra, ey + Math.sin(phi) * ra, phi, ra * 0.9, ra * 0.7));
  }
  const ns = 10 + Math.floor(r() * 12);
  for (let i = 0; i < ns; i++) {
    const phi = biasedAngle(r, theta, e * 0.6);
    const dist = bodyRadiusAt(body, phi) * (1.15 + 1.1 * r());
    const rd = R * (0.025 + 0.07 * r() * r());
    ketchup.push(ellipseAlong(cx + Math.cos(phi) * dist, cy + Math.sin(phi) * dist, phi, rd * (1.2 + r() + e), rd));
  }
  const ketchupShape = shape(ketchup, KETCHUP, p.seed + 2, {
    core: KETCHUP_DEEP,
    coreDepth: 0.008,
    k: 0.004,
    tMax: 0.4,
    lambda: 0.002,
    rimAt: 0.003,
    rimW: 0.004,
    rimAmp: 0.3,
    pool: 0.15,
    poolSize: 0.02,
    detail: { amp: 0.12, size: 0.006 },
    thinAlpha: 0.9,
    glaze: 0.35,
  });
  shapes.push(ketchupShape);

  // mustard: a wavy line across it, and a dollop at one end
  const mustard: Prim[] = [];
  const b = r() * Math.PI;
  const bx = Math.cos(b);
  const by = Math.sin(b);
  const waves = 2 + r();
  const pts: [number, number][] = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26 - 0.5;
    const wv = Math.sin(t * Math.PI * 2 * waves) * R * 0.22;
    pts.push([cx + bx * t * R * 1.7 - by * wv, cy + by * t * R * 1.7 + bx * wv]);
  }
  for (let i = 1; i < pts.length; i++) mustard.push({ k: CAPSULE, ax: pts[i - 1][0], ay: pts[i - 1][1], bx: pts[i][0], by: pts[i][1], ra: 0.003 * S, rb: 0.003 * S });
  const end = pts[r() < 0.5 ? 0 : pts.length - 1];
  mustard.push(blob(r, end[0], end[1], 0.006 * S, 2));
  const mustardShape = shape(mustard, MUSTARD, p.seed + 3, {
    core: MUSTARD_DEEP,
    coreDepth: 0.003,
    k: 0.003,
    tMax: 0.35,
    rimAt: 0.0015,
    rimW: 0.0015,
    rimAmp: 0.3,
    detail: { amp: 0.1, size: 0.004 },
    glaze: 0.25,
  });
  shapes.push(mustardShape);

  // torn lettuce, sesame
  const leaf: Prim[] = [];
  const pale: Prim[] = [];
  for (let i = 0; i < 3 + Math.floor(r() * 4); i++) {
    const la = r() * Math.PI * 2;
    const ld = R * (0.3 + 1.1 * r());
    (i % 3 === 2 ? pale : leaf).push({ k: POLY, pts: shardOutline(r, cx + Math.cos(la) * ld, cy + Math.sin(la) * ld, (0.006 + 0.008 * r()) * S, 1 + r()) });
  }
  shapes.push(shape(leaf, LETTUCE, p.seed + 4, { k: 0.001, tMax: 0.12 }), shape(pale, [150, 202, 90], p.seed + 5, { k: 0.001, tMax: 0.12 }));
  const seeds: Prim[] = [];
  for (let i = 0; i < 6 + Math.floor(r() * 9); i++) {
    const la = r() * Math.PI * 2;
    const ld = R * 1.25 * Math.sqrt(r());
    seeds.push(ellipseAlong(cx + Math.cos(la) * ld, cy + Math.sin(la) * ld, r() * 3.14, 0.0029 * S, 0.0016 * S));
  }
  shapes.push(shape(seeds, [240, 222, 170], p.seed + 6, { k: 0, tMax: 0.12, lambda: 0.0006 }));
  // a pickle: a green ring, paler inside, a ring of seeds
  if (r() < 0.4) {
    const la = r() * Math.PI * 2;
    const px = cx + Math.cos(la) * R * 0.6;
    const py = cy + Math.sin(la) * R * 0.6;
    const pr = 0.011 * S;
    const pips: Prim[] = [];
    for (let i = 0; i < 7; i++) {
      const q = (i / 7) * Math.PI * 2;
      pips.push(ellipseAlong(px + Math.cos(q) * pr * 0.42, py + Math.sin(q) * pr * 0.42, q, pr * 0.14, pr * 0.09));
    }
    shapes.push(
      shape([ellipseAlong(px, py, 0, pr, pr * 0.94)], [96, 122, 40], p.seed + 7, { k: 0, tMax: 0.2 }),
      shape([ellipseAlong(px, py, 0, pr * 0.74, pr * 0.7)], [168, 182, 84], p.seed + 8, { k: 0, tMax: 0.2 }),
      shape(pips, [214, 218, 160], p.seed + 9, { k: 0, tMax: 0.22 }),
    );
  }

  let drips: DripSpec[] = [];
  if (p.vertical) {
    drips = runsBelow(r, ketchupShape, 2 + Math.floor(r() * 2), R * 0.8, cx, cy, (x, y) => {
      const w = (0.006 + 0.005 * r()) * S;
      const len = (0.03 + 0.09 * Math.pow(r(), 1.3)) * S;
      return run(r, x, y, w, len, KETCHUP, { tau: 2 + 1.5 * r() + len * 10, tMax: 0.4, glaze: 0.35, seed: (p.seed + 20 + Math.floor(r() * 997)) >>> 0 });
    });
    if (r() < 0.6) {
      drips.push(
        ...runsBelow(r, mustardShape, 1, R * 0.6, cx, cy, (x, y) =>
          run(r, x, y, 0.0045 * S, (0.02 + 0.05 * r()) * S, MUSTARD, { tMax: 0.32, glaze: 0.25, seed: (p.seed + 40) >>> 0 }),
        ),
      );
    }
  }
  return { shapes, drips, extent: planExtent(shapes, drips) };
}

/**
 * Ice cream: a thick, domed dollop smeared the way it was going, clumps and
 * short fat fingers, a thin melted halo, its toppings, a crumb or two of
 * cone, and fat runs that take their time.
 */
function buildIceCreamSplat(p: FoodHit): SplatPlan {
  const f = flavourOf(p.seed);
  const r = rng(p.seed);
  const S = p.scale;
  const e = clamp(p.oblique, 0, 0.8);
  const theta = Math.atan2(p.dirY, p.dirX);
  const ca = Math.cos(theta);
  const sa = Math.sin(theta);
  const R = (0.036 + 0.012 * r()) * S;
  const shapes: Shape[] = [];
  const tb = bodyTable(r, R, { from: 2, to: 8, amp: 0.09, fall: 0.9 }, { n: 2 + Math.floor(r() * 3), amp: 0.22, width: 0.4 }, { n: 1, amp: 0.12, width: 0.4 });
  const body: BodyPrim = { k: BODY, cx: ca * R * 0.25 * e, cy: sa * R * 0.25 * e, ca, sa, ex: 1 + 0.7 * e, ey: 1 - 0.15 * e, table: tb.table, rmax: tb.rmax };

  // the melt round it
  shapes.push(shape([blob(r, body.cx, body.cy, R * 1.22, 3)], f.cream, p.seed + 1, { k: 0.006, tMax: 0.06, alpha: 0.5, glaze: 0.45, lambda: 0.002 }));

  const cream: Prim[] = [body];
  for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
    const phi = r() * Math.PI * 2;
    const d = bodyRadiusAt(body, phi) * (0.75 + 0.2 * r());
    cream.push(blob(r, body.cx + Math.cos(phi) * d, body.cy + Math.sin(phi) * d, R * (0.3 + 0.2 * r()), 2));
  }
  for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
    const phi = biasedAngle(r, theta, 0.3 + e * 0.5);
    const rb0 = bodyRadiusAt(body, phi);
    const ra = R * (0.12 + 0.08 * r());
    const len = R * (0.2 + 0.4 * r()) * (1 + e);
    const sx = body.cx + Math.cos(phi) * rb0 * 0.8;
    const sy = body.cy + Math.sin(phi) * rb0 * 0.8;
    cream.push({ k: CAPSULE, ax: sx, ay: sy, bx: sx + Math.cos(phi) * len, by: sy + Math.sin(phi) * len, ra, rb: ra * 0.7 });
  }
  for (let i = 0; i < 6 + Math.floor(r() * 7); i++) {
    const phi = biasedAngle(r, theta, e * 0.6);
    const dist = bodyRadiusAt(body, phi) * (1.15 + 0.85 * r());
    const rd = R * (0.04 + 0.08 * r() * r());
    cream.push(ellipseAlong(body.cx + Math.cos(phi) * dist, body.cy + Math.sin(phi) * dist, phi, rd * (1.1 + 0.6 * r() + e), rd));
  }
  const creamShape = shape(cream, f.cream, p.seed + 2, {
    core: f.deep,
    coreDepth: R * 0.9,
    k: 0.006,
    tMax: 0.8,
    cap: R * 0.55,
    lambda: 0.003,
    pool: 0.12,
    poolSize: 0.02,
    detail: { amp: 0.12, size: 0.007 },
    sag: p.vertical ? 0.25 : 0,
    sagSize: R,
    glaze: 0.3,
  });
  shapes.push(creamShape);

  // toppings, lying on the dollop
  const inside = (): [number, number] => {
    const q = r() * Math.PI * 2;
    const d = bodyRadiusAt(body, q) * 0.8 * Math.sqrt(r());
    return [body.cx + Math.cos(q) * d, body.cy + Math.sin(q) * d];
  };
  if (f.sprinkles) {
    f.sprinkles.forEach((c, ci) => {
      const prims: Prim[] = [];
      for (let i = 0; i < 2 + Math.floor(r() * 4); i++) {
        const [x, y] = inside();
        const q = r() * Math.PI;
        const l = 0.0028 * S;
        prims.push({ k: CAPSULE, ax: x - Math.cos(q) * l, ay: y - Math.sin(q) * l, bx: x + Math.cos(q) * l, by: y + Math.sin(q) * l, ra: 0.0011 * S, rb: 0.0011 * S });
      }
      shapes.push(shape(prims, c, p.seed + 10 + ci, { k: 0, tMax: 0.12, lambda: 0.0005 }));
    });
  }
  if (f.bits) {
    const prims: Prim[] = [];
    for (let i = 0; i < 6 + Math.floor(r() * 6); i++) {
      const [x, y] = inside();
      prims.push({ k: POLY, pts: shardOutline(r, x, y, (0.0022 + 0.0018 * r()) * S) });
    }
    shapes.push(shape(prims, f.bits, p.seed + 20, { k: 0.0008, tMax: 0.18 }));
  }
  if (f.specks) {
    const prims: Prim[] = [];
    for (let i = 0; i < 24 + Math.floor(r() * 20); i++) {
      const [x, y] = inside();
      const rd = (0.0004 + 0.0005 * r()) * S;
      prims.push(ellipseAlong(x, y, r() * 3.14, rd * 1.5, rd));
    }
    shapes.push(shape(prims, f.specks, p.seed + 21, { k: 0, tMax: 0, alpha: 0.8 }));
  }
  // crumbs of the cone
  const crumbs: Prim[] = [];
  for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
    const q = r() * Math.PI * 2;
    const d = R * (0.6 + 0.9 * r());
    crumbs.push({ k: POLY, pts: shardOutline(r, body.cx + Math.cos(q) * d, body.cy + Math.sin(q) * d, (0.002 + 0.002 * r()) * S) });
  }
  shapes.push(shape(crumbs, WAFFLE, p.seed + 22, { k: 0, tMax: 0.15 }));

  let drips: DripSpec[] = [];
  if (p.vertical) {
    // fat, slow melting runs (no thicker than the dollop's edge they leave from)
    drips = runsBelow(r, creamShape, 2 + Math.floor(r() * 3), R * 0.7, body.cx, body.cy, (x, y) => {
      const w = (0.009 + 0.007 * r()) * S;
      const len = (0.04 + 0.09 * Math.pow(r(), 1.2)) * S;
      return run(r, x, y, w, len, f.cream, {
        tau: 3.5 + 2.5 * r() + len * 12,
        delay: 0.4 + 1.0 * r(),
        bead: w * (0.85 + 0.15 * r()),
        tMax: 0.32,
        glaze: 0.3,
        wobble: w * 0.15,
        beadStretch: 1.1,
        seed: (p.seed + 30 + Math.floor(r() * 997)) >>> 0,
      });
    });
  }
  return { shapes, drips, extent: planExtent(shapes, drips) };
}
