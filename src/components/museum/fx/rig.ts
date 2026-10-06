// What the visitor holds: a paintball marker or a sword, generic models
// built from three primitives (no real makes, no assets), held bottom-right
// of the view, with idle sway from looking round and walking, a little kick
// per shot, a sword swing with a faint motion trail, and a refill dip.
//
// The rig is placed in world space every frame from the camera's matrix
// (the camera is not in the scene graph), on the props layer: the main
// camera sees it, the floor reflection and raycasts do not. It is lit by
// the room (its environment and lamps) plus a faint self-light standing in
// for the fill light a first-person view would give it.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type HeldKind = "marker" | "sword";

const PROP_LAYER = 1;

// ------------------------------------------------------------------ models

type Part = { g: THREE.BufferGeometry; m: number };

function box(w: number, h: number, d: number, x: number, y: number, z: number, m: number, rx = 0, ry = 0, rz = 0): Part {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(x, y, z);
  return { g, m };
}

function cyl(r0: number, r1: number, h: number, x: number, y: number, z: number, m: number, rx = 0, rz = 0, seg = 16): Part {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg);
  g.rotateX(rx);
  g.rotateZ(rz);
  g.translate(x, y, z);
  return { g, m };
}

function sphere(r: number, x: number, y: number, z: number, m: number, sx = 1, sy = 1, sz = 1, seg = 16): Part {
  const g = new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.75));
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return { g, m };
}

/** Merge parts by material index into one geometry with groups (one mesh, one draw per material). */
function build(parts: Part[], materials: THREE.Material[]): THREE.Mesh {
  const byMat: THREE.BufferGeometry[] = [];
  for (let i = 0; i < materials.length; i++) {
    const gs = parts.filter((p) => p.m === i).map((p) => (p.g.index ? p.g.toNonIndexed() : p.g));
    for (const g of gs) {
      g.deleteAttribute("uv");
      if (!g.getAttribute("normal")) g.computeVertexNormals();
    }
    byMat.push(gs.length ? mergeGeometries(gs, false)! : new THREE.BufferGeometry());
  }
  const used = byMat.map((g, i) => ({ g, i })).filter((x) => x.g.getAttribute("position"));
  const merged = mergeGeometries(
    used.map((x) => x.g),
    true,
  )!;
  parts.forEach((p) => p.g.dispose());
  const mesh = new THREE.Mesh(
    merged,
    used.map((x) => materials[x.i]),
  );
  mesh.userData.fxIgnore = true;
  mesh.layers.set(PROP_LAYER);
  return mesh;
}

/**
 * A blade along +y: a lenticular section with a fuller (a groove) down each
 * face for most of its length, flat bevels to a crisp edge, a diamond
 * section toward the point. Flat-shaded: each facet catches the light on
 * its own, the edge bevel as a bright line.
 */
function bladeGeometry(len: number, base: number, thick: number): THREE.BufferGeometry {
  const st = [0, 0.1, 0.25, 0.45, 0.62, 0.72, 0.84, 0.93];
  const ring = (t: number): [number, number, number][] => {
    const w = base * (t < 0.84 ? 1 - 0.3 * (t / 0.84) : 0.7 * (1 - (t - 0.84) / 0.16) ** 0.75);
    const k = thick * (1 - 0.4 * t);
    const y = t * len;
    // the fuller runs out before the point
    const f = t < 0.62 ? 1 : t < 0.72 ? 1 - (t - 0.62) / 0.1 : 0;
    const half: [number, number][] = [
      [w, 0],
      [0.8 * w, 0.42 * k],
      [0.44 * w, k],
      [0.3 * w, 0.97 * k],
      [0, k * (1 - 0.42 * f)],
    ];
    const pts: [number, number, number][] = [];
    for (const [x, z] of half) pts.push([x, y, z]);
    for (let i = half.length - 2; i >= 0; i--) pts.push([-half[i][0], y, half[i][1]]);
    for (let i = 1; i < half.length; i++) pts.push([-half[i][0], y, -half[i][1]]);
    for (let i = half.length - 2; i >= 1; i--) pts.push([half[i][0], y, -half[i][1]]);
    return pts;
  };
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const rings = st.map(ring);
  const n = rings[0].length;
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i];
    const B = rings[i + 1];
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      tri(A[k], A[k2], B[k2]);
      tri(A[k], B[k2], B[k]);
    }
  }
  const tip = [0, len, 0];
  const E = rings[rings.length - 1];
  for (let k = 0; k < n; k++) tri(E[k], E[(k + 1) % n], tip);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

interface Model {
  mesh: THREE.Object3D;
  muzzle: THREE.Vector3; // local
  /** blade base / tip (local) */
  base?: THREE.Vector3;
  tip?: THREE.Vector3;
}

function makeModels(): { models: Record<HeldKind, Model>; materials: THREE.Material[] } {
  // a faint self-light stands in for the fill light a first-person view
  // would give its viewmodel (a uniform, not a new light: nothing recompiles)
  const fill = (hex: string, k: number) => ({ emissive: new THREE.Color(hex), emissiveIntensity: k });
  const steel = new THREE.MeshStandardMaterial({ color: "#e8ecf2", metalness: 1, roughness: 0.17, ...fill("#7a7672", 0.06), flatShading: true });
  const brass = new THREE.MeshStandardMaterial({ color: "#b48c46", metalness: 1, roughness: 0.32 });
  const leather = new THREE.MeshStandardMaterial({ color: "#3e2618", metalness: 0, roughness: 0.78, ...fill("#4a3424", 0.08) });
  const glove = new THREE.MeshStandardMaterial({ color: "#2a2420", metalness: 0, roughness: 0.8, ...fill("#4a3a30", 0.12) });
  const sleeve = new THREE.MeshStandardMaterial({ color: "#3a3f48", metalness: 0, roughness: 0.95, ...fill("#4a4e56", 0.12) });
  // recreational paintball gear: anodised colour, black rubber, a carbon tank
  const anod = new THREE.MeshStandardMaterial({ color: "#1f8fff", metalness: 0.75, roughness: 0.3, ...fill("#1a4a80", 0.12) });
  const accent = new THREE.MeshStandardMaterial({ color: "#ff3b2f", metalness: 0.7, roughness: 0.32, ...fill("#802018", 0.1) });
  const rubber = new THREE.MeshStandardMaterial({ color: "#1c1c1f", metalness: 0, roughness: 0.7, ...fill("#3a3a40", 0.1) });
  const tank = new THREE.MeshStandardMaterial({ color: "#2a2b2e", metalness: 0.35, roughness: 0.38, ...fill("#3a3a40", 0.08) });
  const chrome = new THREE.MeshStandardMaterial({ color: "#d8dadf", metalness: 1, roughness: 0.2 });
  const hopper = new THREE.MeshStandardMaterial({
    color: "#262a33",
    metalness: 0,
    roughness: 0.12,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    ...fill("#30343c", 0.1),
  });
  const balls = new THREE.MeshStandardMaterial({ color: "#ffd21f", metalness: 0, roughness: 0.25, ...fill("#806010", 0.15) });

  // ---- the sword
  const bladeLen = 0.74;
  const blade = bladeGeometry(bladeLen, 0.022, 0.0036);
  const swordParts: Part[] = [
    { g: blade, m: 0 },
    box(0.165, 0.014, 0.022, 0, -0.008, 0, 1), // cross guard
    sphere(0.011, 0.084, -0.008, 0, 1, 1, 1.3, 1, 10),
    sphere(0.011, -0.084, -0.008, 0, 1, 1, 1.3, 1, 10),
    box(0.03, 0.022, 0.026, 0, -0.004, 0, 1), // the guard's centre block
    cyl(0.0135, 0.0125, 0.12, 0, -0.076, 0, 2),
    cyl(0.024, 0.024, 0.014, 0, -0.146, 0, 1, Math.PI / 2, 0, 20), // wheel pommel
    sphere(0.008, 0, -0.146, 0.008, 1, 1, 1, 0.8, 10),
    sphere(0.008, 0, -0.146, -0.008, 1, 1, 1, 0.8, 10),
  ];
  for (let i = 0; i < 6; i++) {
    // the cord wrap of the grip
    swordParts.push({ g: new THREE.TorusGeometry(0.0138, 0.0021, 6, 16).rotateX(Math.PI / 2).rotateZ(0.12).translate(0, -0.026 - i * 0.019, 0), m: 2 });
  }
  // the hand on the grip, the sleeve down and back out of view
  swordParts.push(box(0.062, 0.085, 0.056, 0.004, -0.075, 0, 3));
  swordParts.push(box(0.022, 0.03, 0.045, -0.03, -0.05, 0.012, 3, 0, 0, 0.3));
  swordParts.push(cyl(0.034, 0.042, 0.34, 0.05, -0.24, 0.07, 4, 0.45, -0.35, 12));
  const sword = build(swordParts, [steel, brass, leather, glove, sleeve]);

  // ---- the paintball marker (barrel along −z)
  const rake = 0.3;
  const markerParts: Part[] = [
    box(0.03, 0.044, 0.19, 0, 0.03, -0.07, 0), // body
    box(0.031, 0.012, 0.15, 0, 0.056, -0.07, 0), // top rail
    cyl(0.0115, 0.0115, 0.27, 0, 0.03, -0.29, 2, Math.PI / 2), // barrel
    cyl(0.0135, 0.0135, 0.05, 0, 0.03, -0.185, 1, Math.PI / 2), // barrel collar
    cyl(0.0122, 0.0122, 0.012, 0, 0.03, -0.42, 1, Math.PI / 2), // muzzle ring
    box(0.032, 0.006, 0.05, 0, 0.012, -0.08, 1), // accent stripe
    cyl(0.014, 0.016, 0.05, 0, 0.074, -0.075, 2), // feed neck
    sphere(0.055, 0, 0.13, -0.07, 3, 0.8, 0.85, 1.15, 20), // the hopper
    cyl(0.026, 0.03, 0.009, 0, 0.173, -0.072, 2, 0, 0, 20), // hopper lid
    box(0.028, 0.1, 0.044, 0, -0.03, 0.03, 2, rake), // grip frame
    box(0.026, 0.07, 0.03, 0, -0.03, -0.075, 2, -0.12), // fore grip
    box(0.006, 0.004, 0.04, 0, 0.0, -0.02, 2), // trigger guard
    box(0.006, 0.02, 0.004, 0, 0.008, -0.04, 2),
    box(0.005, 0.016, 0.005, 0, 0.004, -0.008, 5, 0.3), // trigger
    cyl(0.03, 0.03, 0.2, 0, -0.005, 0.13, 6, Math.PI / 2, 0, 20), // the air tank
    sphere(0.03, 0, -0.005, 0.23, 6, 1, 1, 0.7, 20),
    cyl(0.022, 0.026, 0.035, 0, -0.005, 0.015, 5, Math.PI / 2), // regulator
    cyl(0.0305, 0.0305, 0.012, 0, -0.005, 0.04, 1, Math.PI / 2, 0, 20), // tank ring
    box(0.02, 0.02, 0.05, 0, 0.004, 0.06, 2), // adapter
  ];
  // a few balls showing through the hopper
  const B = 0.0087;
  const ballAt: [number, number, number][] = [
    [0, 0.098, -0.07],
    [0.016, 0.104, -0.052],
    [-0.017, 0.103, -0.088],
    [0.012, 0.109, -0.1],
    [-0.012, 0.11, -0.045],
    [0.0, 0.118, -0.03],
    [0.018, 0.12, -0.08],
    [-0.02, 0.12, -0.065],
  ];
  for (const [x, y, z] of ballAt) markerParts.push(sphere(B, x, y, z, 7, 1, 1, 1, 10));
  // the gloved hand round the grip, a sleeve running out of the frame
  markerParts.push(box(0.054, 0.07, 0.064, 0.002, -0.035, 0.035, 8, rake));
  markerParts.push(box(0.02, 0.022, 0.05, -0.024, -0.005, 0.005, 8, 0.1, 0.25));
  markerParts.push(box(0.016, 0.018, 0.034, 0, 0.004, -0.02, 8, 0.15));
  markerParts.push(cyl(0.032, 0.04, 0.34, 0.035, -0.155, 0.19, 9, 1.05, -0.25, 12));
  markerParts.push(cyl(0.036, 0.036, 0.04, 0.012, -0.07, 0.09, 8, 1.05, -0.25, 12));
  const marker = build(markerParts, [anod, accent, rubber, hopper, glove, chrome, tank, balls, glove, sleeve]);
  marker.renderOrder = 1;

  return {
    models: {
      marker: { mesh: marker, muzzle: new THREE.Vector3(0, 0.03, -0.43) },
      sword: {
        mesh: sword,
        muzzle: new THREE.Vector3(0, bladeLen, 0),
        base: new THREE.Vector3(0, 0.02, 0),
        tip: new THREE.Vector3(0, bladeLen, 0),
      },
    },
    materials: [steel, brass, leather, glove, sleeve, anod, accent, rubber, tank, chrome, hopper, balls],
  };
}

// ---------------------------------------------------------------- the rig

interface Pose {
  p: THREE.Vector3;
  q: THREE.Quaternion;
}
const pose = (x: number, y: number, z: number, rx: number, ry: number, rz: number): Pose => ({
  p: new THREE.Vector3(x, y, z),
  q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")),
});

const HOLD: Record<HeldKind, Pose> = {
  marker: pose(0.15, -0.17, -0.36, 0.03, 0.06, 0),
  sword: pose(0.21, -0.25, -0.4, -0.35, 0.2, 0.55),
};
const SWORD_KEYS: { t: number; pose: Pose }[] = [
  { t: 0, pose: HOLD.sword },
  { t: 0.07, pose: pose(0.27, -0.1, -0.33, 0.25, 0.3, 1.3) }, // wind-up, over the shoulder
  { t: 0.24, pose: pose(-0.2, -0.3, -0.44, -1.05, -0.25, -0.95) }, // through the cut
  { t: 0.55, pose: HOLD.sword },
];
const SWORD_THRUST = pose(0.05, -0.16, -0.5, -1.25, 0.05, 0.25);
export const SWORD_SWING_S = 0.55;
/** the part of the swing in which the edge is cutting */
export const SWORD_CUT = { from: 0.07, to: 0.24 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const _s = new THREE.Vector3(1, 1, 1);
const TRAIL = 12;

export class Rig {
  readonly group = new THREE.Group();
  private readonly models: Record<HeldKind, Model>;
  private readonly materials: THREE.Material[];
  private readonly trail: THREE.Mesh;
  private readonly trailPos = new Float32Array(TRAIL * 2 * 3);
  private readonly trailCol = new Float32Array(TRAIL * 2 * 3);
  private trailPts: { a: THREE.Vector3; b: THREE.Vector3; t: number }[] = [];
  private kind: HeldKind | null = null;
  private sway = new THREE.Vector2();
  private swayV = new THREE.Vector2();
  private bob = 0;
  private bobAmt = 0;
  private recoil = 0;
  private refillT: number | null = null;
  private refillDur = 1;
  private swingT: number | null = null;
  private thrust = 0;
  private thrusting = false;
  private prevQ = new THREE.Quaternion();
  private prevP = new THREE.Vector3();
  private hasPrev = false;
  private compact = false;
  private enabled = true;
  private raise = 0;
  private local = new THREE.Matrix4();

  constructor() {
    const { models, materials } = makeModels();
    this.models = models;
    this.materials = materials;
    this.group.name = "fx-held";
    this.group.userData.fxIgnore = true;
    this.group.matrixAutoUpdate = false;
    this.group.layers.set(PROP_LAYER);
    for (const k of Object.keys(models) as HeldKind[]) {
      const m = models[k].mesh;
      m.visible = false;
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute("color", new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    tg.setIndex(idx);
    this.trail = new THREE.Mesh(
      tg,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.trail.layers.set(PROP_LAYER);
    this.trail.userData.fxIgnore = true;
  }

  /** Objects to add to the scene (the trail lives in world space). */
  get objects(): THREE.Object3D[] {
    return [this.group, this.trail];
  }

  /** Meshes showing every material, for a warm-up compile. */
  warmup(on: boolean): void {
    for (const k of Object.keys(this.models) as HeldKind[]) this.models[k].mesh.visible = on || (k === this.kind && this.enabled);
    this.trail.visible = on;
  }

  get held(): HeldKind | null {
    return this.kind;
  }

  setHeld(k: HeldKind | null): void {
    if (k === this.kind) return;
    this.kind = k;
    for (const key of Object.keys(this.models) as HeldKind[]) this.models[key].mesh.visible = key === k && this.enabled;
    this.swingT = null;
    this.refillT = null;
    this.thrusting = false;
    this.recoil = 0;
    this.hasPrev = false;
    // drawn: come up from below
    this.raise = 1;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    for (const key of Object.keys(this.models) as HeldKind[]) this.models[key].mesh.visible = key === this.kind && on;
    if (!on) this.trail.visible = false;
  }

  /** Narrow / touch screens: smaller, further into the corner. */
  setCompact(on: boolean): void {
    this.compact = on;
  }

  /** The colour of the balls showing in the hopper. */
  setBallColor(hex: string): void {
    (this.materials[11] as THREE.MeshStandardMaterial).color.set(hex);
  }

  // -------------------------------------------------------------- actions

  fire(strength: number): void {
    this.recoil = Math.min(1.2, this.recoil + strength);
  }

  refill(dur: number): void {
    this.refillT = 0;
    this.refillDur = dur;
  }

  swing(): void {
    this.swingT = 0;
    this.trailPts = [];
  }

  get swingTime(): number | null {
    return this.swingT;
  }

  setThrust(on: boolean): void {
    this.thrusting = on;
    if (on) this.trailPts = [];
  }

  // ------------------------------------------------------------ queries

  /** World position of a local point of the current model (after the last update). */
  worldPoint(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const k = this.kind;
    if (!k) return out.set(0, 0, 0);
    return out.copy(local).applyMatrix4(this.models[k].mesh.matrixWorld);
  }

  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.kind ? this.worldPoint(this.models[this.kind].muzzle, out) : out;
  }

  // -------------------------------------------------------------- frame

  /** Place the rig for this frame; true while anything is still settling. */
  update(dt: number, camera: THREE.Camera): boolean {
    const k = this.kind;
    if (!k || !this.enabled) return false;
    camera.updateMatrixWorld();
    let busy = false;
    // ---- sway from looking around, bob from walking
    const q = camera.quaternion;
    const p = camera.position;
    if (this.hasPrev && dt > 0) {
      _q.copy(this.prevQ).invert().multiply(q);
      _e.setFromQuaternion(_q, "YXZ");
      const yawV = _e.y / dt;
      const pitchV = _e.x / dt;
      const tx = THREE.MathUtils.clamp(-yawV * 0.01, -0.035, 0.035);
      const ty = THREE.MathUtils.clamp(-pitchV * 0.01, -0.03, 0.03);
      // a soft spring: lags, overshoots a touch, settles
      this.swayV.x += ((tx - this.sway.x) * 120 - this.swayV.x * 14) * dt;
      this.swayV.y += ((ty - this.sway.y) * 120 - this.swayV.y * 14) * dt;
      this.sway.addScaledVector(this.swayV, dt);
      const speed = Math.hypot(p.x - this.prevP.x, p.z - this.prevP.z) / dt;
      const walk = Math.min(1, speed / 2.6);
      this.bobAmt += (walk - this.bobAmt) * Math.min(1, dt * 6);
      this.bob += dt * 8.5 * Math.max(0.2, this.bobAmt);
      if (Math.abs(this.sway.x) + Math.abs(this.sway.y) + Math.abs(this.swayV.x) + Math.abs(this.swayV.y) > 2e-4 || this.bobAmt > 0.01) busy = true;
    }
    this.prevQ.copy(q);
    this.prevP.copy(p);
    this.hasPrev = true;

    // ---- the pose
    let P = HOLD[k].p.clone();
    let Q = HOLD[k].q.clone();
    if (k === "sword") {
      if (this.swingT !== null) {
        this.swingT += dt;
        const t = this.swingT;
        let i = 0;
        while (i < SWORD_KEYS.length - 2 && t > SWORD_KEYS[i + 1].t) i++;
        const a = SWORD_KEYS[i];
        const b = SWORD_KEYS[i + 1];
        let u = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1);
        u = i === 1 ? u * u * (3 - 2 * u) : 1 - (1 - u) * (1 - u);
        P = a.pose.p.clone().lerp(b.pose.p, u);
        Q = a.pose.q.clone().slerp(b.pose.q, u);
        if (t >= SWORD_SWING_S) this.swingT = null;
        busy = true;
      }
      this.thrust += ((this.thrusting ? 1 : 0) - this.thrust) * Math.min(1, dt * 14);
      if (this.thrust > 0.002) {
        P.lerp(SWORD_THRUST.p, this.thrust);
        Q.slerp(SWORD_THRUST.q, this.thrust);
        if (Math.abs(this.thrust - (this.thrusting ? 1 : 0)) > 0.002) busy = true;
      }
    }
    if (this.raise > 0.001) {
      this.raise *= Math.exp(-dt * 9);
      busy = true;
    } else this.raise = 0;
    // a little kick back and up, springing home
    if (this.recoil > 0.001) {
      this.recoil *= Math.exp(-dt * 18);
      busy = true;
    } else this.recoil = 0;
    let dip = 0;
    let roll = 0;
    if (this.refillT !== null) {
      this.refillT += dt;
      const u = THREE.MathUtils.clamp(this.refillT / this.refillDur, 0, 1);
      const env = Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 0.8;
      dip = env * 0.07;
      roll = env * -0.55;
      if (u >= 1) this.refillT = null;
      busy = true;
    }
    const bobX = Math.sin(this.bob) * 0.006 * this.bobAmt;
    const bobY = -Math.abs(Math.cos(this.bob)) * 0.008 * this.bobAmt;
    P.x += this.sway.x + bobX;
    P.y += this.sway.y + bobY - dip - this.raise * 0.18;
    P.z += this.recoil * 0.02;
    if (this.compact) {
      P.x += 0.03;
      P.y -= 0.035;
    }
    _q2.setFromEuler(_e.set(this.recoil * 0.06 + this.raise * 0.5, 0, roll, "YXZ"));
    Q.multiply(_q2);
    const s = this.compact ? 0.82 : 1;
    this.local.compose(P, Q, _s.setScalar(s));
    _m.multiplyMatrices(camera.matrixWorld, this.local);
    this.group.matrix.identity();
    this.group.matrixWorld.identity();
    const mesh = this.models[k].mesh;
    mesh.matrix.copy(_m);
    mesh.matrixWorld.copy(_m);

    // ---- sword trail
    if (k === "sword" && (this.swingT !== null || this.thrust > 0.5)) {
      const m = this.models.sword;
      this.trailPts.unshift({ a: this.worldPoint(m.base!), b: this.worldPoint(m.tip!), t: 0 });
      if (this.trailPts.length > TRAIL) this.trailPts.length = TRAIL;
    }
    for (const t of this.trailPts) t.t += dt;
    this.trailPts = this.trailPts.filter((t) => t.t < 0.12);
    if (this.trailPts.length >= 2) {
      for (let i = 0; i < TRAIL; i++) {
        const tp = this.trailPts[Math.min(i, this.trailPts.length - 1)];
        // only the outer part of the blade leaves a visible smear
        const a = _v.copy(tp.a).lerp(tp.b, 0.45);
        this.trailPos.set([a.x, a.y, a.z, tp.b.x, tp.b.y, tp.b.z], i * 6);
        const f = i < this.trailPts.length ? (1 - i / TRAIL) * (1 - tp.t / 0.12) * 0.2 : 0;
        this.trailCol.set([f * 0.2, f * 0.2, f * 0.22, f, f, f * 1.05], i * 6);
      }
      (this.trail.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (this.trail.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
      this.trail.visible = true;
      busy = true;
    } else this.trail.visible = false;
    return busy;
  }

  dispose(): void {
    for (const k of Object.keys(this.models) as HeldKind[]) (this.models[k].mesh as THREE.Mesh).geometry.dispose();
    this.materials.forEach((m) => m.dispose());
    this.trail.geometry.dispose();
    (this.trail.material as THREE.Material).dispose();
  }
}
