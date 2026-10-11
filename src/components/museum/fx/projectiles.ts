// What flies: a wobbling glob of paint (stretched along its path, a few
// droplets trailing it), a tumbling egg or a paintball (a small glossy
// gelatin sphere, drawn stretched along its path at speed), food (a slice
// of pizza spinning flat like a frisbee, a tumbling burger, an ice cream
// turning over) or a dart (point first, rolling slowly about its length),
// each on a ballistic arc solved to land exactly on the aimed point at a
// chosen time.

import * as THREE from "three";
import { dartFlightGeometry, dartMetalGeometry } from "./darts";
import { BURGER_STACK, CONE, FLAVOURS, pieceGeometry, scoopGeometry, type Piece } from "./food";

/** What lands as a splat. */
export type SplatKind = "paint" | "egg" | "ball" | "pizza" | "burger" | "icecream";
export type ProjectileKind = SplatKind | "dart";

/** Gentler than real gravity: a readable arc over a few metres. */
export const ARC_G = new THREE.Vector3(0, -6.5, 0);
/** A paintball barely drops over a room's width. */
const BALL_G = new THREE.Vector3(0, -5.5, 0);
const BALL_R = 0.0087;

interface Flight {
  kind: ProjectileKind;
  g: THREE.Vector3;
  p0: THREE.Vector3;
  v0: THREE.Vector3;
  T: number;
  t: number;
  obj: THREE.Object3D;
  parts: THREE.Mesh[];
  axis: THREE.Vector3;
  phase: number;
  onLand: (vel: THREE.Vector3) => void;
}

function eggGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 bottom … 1 top
    const a = t * Math.PI;
    const y = -Math.cos(a) * 0.028;
    // narrower toward the top (the pointed end)
    const r = Math.sin(a) * 0.021 * (1 - 0.13 * (t - 0.5) * 2 * (t > 0.5 ? 1 : 0.4));
    pts.push(new THREE.Vector2(Math.max(0, r), y));
  }
  const g = new THREE.LatheGeometry(pts, 28);
  g.computeVertexNormals();
  return g;
}

const _v = new THREE.Vector3();
const _h = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const TRAIL = 4;
/** The ice cream in flight: the cone's middle and the scoop's base, from the pair's middle. */
const CONE_Y = -0.03;
const SCOOP_Y = CONE.L / 2 - 0.006 + CONE_Y;

export class ProjectileSystem {
  readonly group = new THREE.Group();
  private flights: Flight[] = [];
  private readonly blobGeo = new THREE.IcosahedronGeometry(1, 3);
  private readonly ballGeo = new THREE.SphereGeometry(1, 16, 12);
  private readonly ballMats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly eggGeo = eggGeometry();
  private readonly eggMat = new THREE.MeshStandardMaterial({ color: "#efe3cf", roughness: 0.48, metalness: 0 });
  private readonly paintMats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly foodGeos = new Map<Piece, THREE.BufferGeometry>();
  private readonly scoopGeos = FLAVOURS.map(scoopGeometry);
  private readonly foodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  private readonly dartMetalGeo = dartMetalGeometry();
  private readonly dartFlightGeo = dartFlightGeometry();
  private readonly dartMetalMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.3 });
  private readonly flightMats = new Map<string, THREE.MeshStandardMaterial>();

  /** render layer for everything that flies */
  layer = 0;

  constructor() {
    this.group.name = "fx-projectiles";
    this.group.userData.fxIgnore = true;
  }

  private paintMat(hex: string): THREE.MeshStandardMaterial {
    let m = this.paintMats.get(hex);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.14, metalness: 0 });
      m.name = "fx-glob";
      this.paintMats.set(hex, m);
    }
    return m;
  }

  private ballMat(hex: string): THREE.MeshStandardMaterial {
    let m = this.ballMats.get(hex);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.18, metalness: 0 });
      m.name = "fx-ball";
      this.ballMats.set(hex, m);
    }
    return m;
  }

  private food(p: Piece): THREE.BufferGeometry {
    let g = this.foodGeos.get(p);
    if (!g) {
      g = pieceGeometry(p);
      this.foodGeos.set(p, g);
    }
    return g;
  }

  private flightMat(hex: string): THREE.MeshStandardMaterial {
    let m = this.flightMats.get(hex);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ vertexColors: true, color: hex, metalness: 0, roughness: 0.5, side: THREE.DoubleSide });
      m.name = "fx-dart-flight";
      this.flightMats.set(hex, m);
    }
    return m;
  }

  /** Meshes for every material used, so a warm-up compile can see them. */
  warmupObjects(): THREE.Object3D[] {
    const blob = new THREE.Mesh(this.blobGeo, this.paintMat("#ffffff"));
    const egg = new THREE.Mesh(this.eggGeo, this.eggMat);
    const ball = new THREE.Mesh(this.ballGeo, this.ballMat("#ffffff"));
    const food = new THREE.Mesh(this.food("slice"), this.foodMat);
    const metal = new THREE.Mesh(this.dartMetalGeo, this.dartMetalMat);
    const flight = new THREE.Mesh(this.dartFlightGeo, this.flightMat("#ffffff"));
    return [blob, egg, ball, food, metal, flight];
  }

  get active(): boolean {
    return this.flights.length > 0;
  }

  /**
   * Launch from `from` to land on `to` after `T` seconds. `look`: the paint,
   * the ball's fill or the dart's flights (a colour), or the ice cream's
   * flavour (its id). onLand receives the velocity at impact.
   */
  launch(kind: ProjectileKind, from: THREE.Vector3, to: THREE.Vector3, T: number, look: string, onLand: (vel: THREE.Vector3) => void): void {
    const g = kind === "ball" ? BALL_G : ARC_G;
    const v0 = to.clone().sub(from).divideScalar(T).addScaledVector(g, -0.5 * T);
    const obj = new THREE.Group();
    const parts: THREE.Mesh[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.userData.fxIgnore = true;
      parts.push(m);
      obj.add(m);
    };
    if (kind === "paint") {
      const mat = this.paintMat(look);
      for (let i = 0; i <= TRAIL; i++) add(this.blobGeo, mat);
    } else if (kind === "ball") add(this.ballGeo, this.ballMat(look));
    else if (kind === "egg") add(this.eggGeo, this.eggMat);
    else if (kind === "pizza") add(this.food("slice"), this.foodMat);
    else if (kind === "burger") for (const s of BURGER_STACK) add(this.food(s.piece), this.foodMat, s.y);
    else if (kind === "icecream") {
      add(this.food("cone"), this.foodMat, CONE_Y);
      add(this.scoopGeos[Math.max(0, FLAVOURS.findIndex((f) => f.id === look))], this.foodMat, SCOOP_Y);
    } else {
      add(this.dartMetalGeo, this.dartMetalMat);
      add(this.dartFlightGeo, this.flightMat(look));
    }
    obj.userData.fxIgnore = true;
    obj.traverse((o) => o.layers.set(this.layer));
    this.group.add(obj);
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const f: Flight = { kind, g, p0: from.clone(), v0, T, t: 0, obj, parts, axis, phase: Math.random() * 6, onLand };
    this.place(f, 0);
    this.flights.push(f);
  }

  private at(f: Flight, t: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(f.p0).addScaledVector(f.v0, t).addScaledVector(f.g, 0.5 * t * t);
  }

  private place(f: Flight, t: number): void {
    const vel = _v.copy(f.v0).addScaledVector(f.g, t);
    if (f.kind === "pizza") {
      // flat like a frisbee, the cheese tilted back toward the thrower, spinning, its tilt wavering
      this.at(f, t, f.obj.position);
      _h.set(-vel.x, 0, -vel.z);
      if (_h.lengthSq() < 1e-6) _h.set(0, 0, 1);
      _h.normalize().multiplyScalar(0.6).addScaledVector(_UP, 0.8).addScaledVector(f.axis, 0.18 * Math.sin((t + f.phase) * 9)).normalize();
      f.obj.quaternion.setFromUnitVectors(_Z, _h).multiply(_q.setFromAxisAngle(_Z, (t + f.phase) * 16));
      return;
    }
    if (f.kind === "dart") {
      // point first along its path
      this.at(f, t, f.obj.position);
      f.obj.quaternion.setFromUnitVectors(_UP, vel.normalize()).multiply(_q.setFromAxisAngle(_UP, (t + f.phase) * 20));
      return;
    }
    if (f.kind === "burger" || f.kind === "icecream") {
      // heavier: a slower tumble than an egg's
      this.at(f, t, f.obj.position);
      f.obj.quaternion.setFromAxisAngle(f.axis, (t + f.phase) * (f.kind === "burger" ? 9 : 7));
      return;
    }
    if (f.kind === "ball") {
      // drawn as it would smear over a frame: stretched along its path
      const m = f.parts[0];
      this.at(f, t, m.position);
      const sp = vel.length();
      m.quaternion.setFromUnitVectors(_UP, vel.clone().normalize());
      m.scale.set(BALL_R, BALL_R + Math.min(0.09, sp * 0.0045), BALL_R);
      return;
    }
    if (f.kind === "paint") {
      _q.setFromUnitVectors(_UP, vel.clone().normalize());
      const w = Math.sin((t + f.phase) * 38);
      const w2 = Math.sin((t + f.phase) * 27 + 1.3);
      f.parts.forEach((m, i) => {
        const lag = i * (0.012 + 0.006 * Math.sin(f.phase * 3 + i));
        this.at(f, Math.max(0, t - lag), m.position);
        m.quaternion.copy(_q);
        if (i === 0) {
          // the glob: stretched along its path, breathing as it wobbles
          const r = 0.03;
          m.scale.set(r * (0.82 + 0.1 * w2), r * (1.9 + 0.25 * w), r * (0.78 - 0.08 * w));
        } else {
          const r = 0.013 * Math.pow(0.68, i - 1) * (0.85 + 0.3 * Math.sin(f.phase * 7 + i * 2.1));
          m.scale.set(r, r * (2.2 + 0.4 * w2), r);
          m.visible = t > lag;
        }
      });
    } else {
      const m = f.parts[0];
      this.at(f, t, m.position);
      m.quaternion.setFromAxisAngle(f.axis, (t + f.phase) * 13);
      m.scale.setScalar(1);
    }
  }

  /** Advance; returns true while anything is in the air. */
  update(dt: number): boolean {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      if (f.t >= f.T) {
        this.flights.splice(i, 1);
        this.group.remove(f.obj);
        f.onLand(f.v0.clone().addScaledVector(f.g, f.T));
        continue;
      }
      this.place(f, f.t);
    }
    return this.flights.length > 0;
  }

  clear(): void {
    for (const f of this.flights) this.group.remove(f.obj);
    this.flights = [];
  }

  dispose(): void {
    this.clear();
    this.blobGeo.dispose();
    this.ballGeo.dispose();
    this.eggGeo.dispose();
    this.eggMat.dispose();
    this.paintMats.forEach((m) => m.dispose());
    this.ballMats.forEach((m) => m.dispose());
    this.foodGeos.forEach((g) => g.dispose());
    this.scoopGeos.forEach((g) => g.dispose());
    this.foodMat.dispose();
    this.dartMetalGeo.dispose();
    this.dartFlightGeo.dispose();
    this.dartMetalMat.dispose();
    this.flightMats.forEach((m) => m.dispose());
  }
}
