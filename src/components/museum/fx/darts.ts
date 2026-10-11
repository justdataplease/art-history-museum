// Darts: a steel point, a knurled tungsten barrel, a shaft and four
// flights in a classic colour (they come in sets of three). A dart flies
// point first (projectiles.ts) and sticks where it lands, a little way into
// the surface along its flight, the shaft shivering for a moment (a damped
// wobble about its point); it stays until the conservator draws it out.
// Two instanced meshes (the metal; shaft and flights tinted per dart) for
// all of them, drawing only as many as are stuck; when the quiver's worth
// is used up the oldest dart is pulled.

import * as THREE from "three";
import { Kit } from "./kit";
import { rng } from "./noise";
import { ellipseAlong, planExtent, type RGB, type Shape, type SplatPlan } from "./splat";

/** Flight colours, a set of three each. */
export const DART_COLORS = ["#d7262b", "#1f8a3b", "#2456c8", "#f2c418", "#1b1b1f", "#efeee8"];

const STEEL: RGB = [208, 212, 218];
const TUNGSTEN: RGB = [152, 154, 160];
const GROOVE: RGB = [86, 88, 94];
/** the shaft: dark, tinted by the flights' colour */
const SHAFT: RGB = [74, 74, 80];
/** How long a stuck dart shivers (s), and how fast the shiver dies (s). */
const WOBBLE_S = 0.8;
const WOBBLE_TAU = 0.17;

const Y = new THREE.Vector3(0, 1, 0);

/** The point and the barrel: the point at the origin, the dart along −y (it flies toward +y). */
export function dartMetalGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  const point = new THREE.ConeGeometry(0.00115, 0.03, 8, 1, true);
  point.translate(0, -0.015, 0);
  k.add(point, STEEL);
  // the barrel, from its back end up: tapered ends, grip rings between
  const prof: THREE.Vector2[] = [new THREE.Vector2(0.0012, -0.078), new THREE.Vector2(0.0018, -0.0778), new THREE.Vector2(0.003, -0.073)];
  for (let y = -0.07; y < -0.039; y += 0.003) {
    prof.push(new THREE.Vector2(0.0028, y), new THREE.Vector2(0.0028, y + 0.0008), new THREE.Vector2(0.0033, y + 0.001), new THREE.Vector2(0.0033, y + 0.0028));
  }
  prof.push(new THREE.Vector2(0.003, -0.036), new THREE.Vector2(0.0021, -0.032), new THREE.Vector2(0.0011, -0.03));
  k.add(new THREE.LatheGeometry(prof, 10), (p) => {
    const r = Math.hypot(p.x, p.z);
    return p.y < -0.038 && p.y > -0.071 && r < 0.003 ? GROOVE : TUNGSTEN;
  });
  return k.build();
}

/** The shaft and four flights (white: the instance colour or the material tints them). */
export function dartFlightGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  const shaft = new THREE.CylinderGeometry(0.0017, 0.0019, 0.036, 6);
  shaft.translate(0, -0.096, 0);
  k.add(shaft, SHAFT);
  const fin = new THREE.Shape([new THREE.Vector2(0.0016, -0.103), new THREE.Vector2(0.0165, -0.127), new THREE.Vector2(0.0165, -0.149), new THREE.Vector2(0.0016, -0.149)]);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.ShapeGeometry(fin);
    g.rotateY((i * Math.PI) / 2);
    k.add(g, [250, 250, 250]);
  }
  return k.build();
}

/** The mark under a dart's point: a small dark hole in a faint crushed ring (linen fibres on a canvas). */
export function buildPuncture(seed: number, dirX: number, dirY: number, oblique: number, canvas: boolean): SplatPlan {
  const r = rng(seed);
  const th = Math.atan2(dirY, dirX);
  const base = { k: 0, lambda: 0.0004, rimAt: 0, rimW: 1, rimAmp: 0, pool: 0, poolSize: 1, thinAlpha: 1, glaze: 0 };
  const ring: Shape = {
    ...base,
    prims: [ellipseAlong(0, 0, th, 0.0034 * (1 + oblique), 0.0031)],
    color: canvas ? [214, 200, 170] : [118, 110, 100],
    tMax: 0.02,
    alpha: 0.3 + 0.1 * r(),
    seed: seed + 1,
  };
  const hole: Shape = {
    ...base,
    prims: [ellipseAlong(0, 0, th, 0.0017 * (1 + 0.5 * oblique), 0.0015)],
    color: [24, 18, 14],
    tMax: 0,
    alpha: 0.92,
    seed: seed + 2,
  };
  const shapes = [ring, hole];
  return { shapes, drips: [], extent: planExtent(shapes, []) };
}

interface Dart {
  slot: number;
  tip: THREE.Vector3;
  q: THREE.Quaternion;
  /** the shiver: about this local axis (across the dart) */
  axis: THREE.Vector3;
  amp: number;
  /** rad/s */
  freq: number;
  t: number;
  /** when the conservator draws it out (s on the sequence clock) */
  seq: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class DartSystem {
  readonly group = new THREE.Group();
  private readonly metal: THREE.InstancedMesh;
  private readonly flights: THREE.InstancedMesh;
  private readonly cap: number;
  private darts: Dart[] = [];
  private seqT = -1;
  private seqDur = 1;

  /** `low`: fewer darts kept. */
  constructor(low = false) {
    this.cap = low ? 12 : 24;
    this.group.name = "fx-darts";
    this.group.userData.fxIgnore = true;
    const metal = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.3 });
    metal.name = "fx-dart-metal";
    const flight = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.5, side: THREE.DoubleSide });
    flight.name = "fx-dart-flight";
    this.metal = new THREE.InstancedMesh(dartMetalGeometry(), metal, this.cap);
    this.flights = new THREE.InstancedMesh(dartFlightGeometry(), flight, this.cap);
    for (const m of [this.metal, this.flights]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < this.cap; i++) m.setMatrixAt(i, _ZERO);
      m.count = 0;
      m.frustumCulled = false;
      m.userData.fxIgnore = true;
      this.group.add(m);
    }
    // the colour buffer exists from the start (its program is compiled with it)
    for (let i = 0; i < this.cap; i++) this.flights.setColorAt(i, _c.set(0xffffff));
  }

  /** A dart stuck with its point at `tip`, having flown along `dir` (unit), flights `hex`. */
  stick(tip: THREE.Vector3, dir: THREE.Vector3, hex: string, seed: number): void {
    const r = rng(seed);
    let slot = 0;
    if (this.darts.length >= this.cap) slot = this.darts.shift()!.slot;
    else while (this.darts.some((d) => d.slot === slot)) slot++;
    // turned any way about its length (the flights' cross falls where it falls)
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir).multiply(new THREE.Quaternion().setFromAxisAngle(Y, r() * Math.PI * 2));
    const a = r() * Math.PI * 2;
    this.darts.push({ slot, tip: tip.clone(), q, axis: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), amp: 0.09 + 0.07 * r(), freq: (7 + 3 * r()) * Math.PI * 2, t: 0, seq: 0 });
    this.flights.setColorAt(slot, _c.set(hex));
    this.flights.instanceColor!.needsUpdate = true;
    this.metal.count = this.flights.count = Math.max(this.metal.count, slot + 1);
  }

  get count(): number {
    return this.darts.length;
  }

  /** Advance; true while any dart is still shivering. */
  update(dt: number): boolean {
    let moving = false;
    for (const d of this.darts) {
      if (d.t >= WOBBLE_S) continue;
      d.t = Math.min(WOBBLE_S, d.t + dt);
      moving = true;
    }
    if (moving) this.writeMatrices();
    return moving;
  }

  /** The points (for ordering the clean-up). */
  positions(): THREE.Vector3[] {
    return this.darts.map((d) => d.tip);
  }

  /** Each dart's moment in the clean-up (by positions() index). */
  setSequence(seq: (i: number) => number, dur: number): void {
    this.darts.forEach((d, i) => (d.seq = seq(i)));
    this.seqDur = dur;
  }

  /** The conservator's clock (s; < 0: not running): each dart is drawn out, shrinking away, at its moment. */
  setClock(t: number): void {
    this.seqT = t;
    this.writeMatrices();
  }

  private writeMatrices(): void {
    for (const d of this.darts) {
      const k = this.seqT < 0 ? 1 : 1 - THREE.MathUtils.smoothstep(this.seqT, d.seq, d.seq + this.seqDur);
      const w = d.t < WOBBLE_S ? d.amp * Math.exp(-d.t / WOBBLE_TAU) * Math.sin(d.t * d.freq) : 0;
      _q.copy(d.q).multiply(_dq.setFromAxisAngle(d.axis, w));
      _p.copy(Y)
        .applyQuaternion(d.q)
        .multiplyScalar(-(1 - k) * 0.06)
        .add(d.tip);
      _m.compose(_p, _q, _s.setScalar(k));
      this.metal.setMatrixAt(d.slot, _m);
      this.flights.setMatrixAt(d.slot, _m);
    }
    this.metal.instanceMatrix.needsUpdate = true;
    this.flights.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.darts = [];
    for (const m of [this.metal, this.flights]) {
      for (let i = 0; i < this.cap; i++) m.setMatrixAt(i, _ZERO);
      m.instanceMatrix.needsUpdate = true;
      m.count = 0;
    }
    this.seqT = -1;
  }

  dispose(): void {
    for (const m of [this.metal, this.flights]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}
