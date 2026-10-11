// Food that does not stay on the wall: a slice of pizza that sticks face
// first, creeps down a little, peels off top first and drops; the bun,
// patty, tomato and lettuce of a burger bursting off; an empty cone falling
// away from its scoop. Each piece falls, bounces (a bun a little, a patty
// hardly, a leaf flutters), skids, turns flat (a cone onto its side) and
// lies on the floor on a soft contact shadow until the conservator takes
// it. Instanced per piece (and one instanced mesh for all the shadows), each
// drawing only as many instances as have been used: a few cheap draw calls
// however much food was thrown.

import * as THREE from "three";
import type { SplatFrame } from "./decals";
import { CONE, pieceGeometry, type Piece } from "./food";
import { gauss, rng } from "./noise";
import { shadowTexture } from "./shards";

const G = 9.81;
const PIECES: Piece[] = ["slice", "bunTop", "bunBottom", "patty", "tomato", "lettuce", "cone"];
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export type LandSound = "soft" | "bun" | "cone";

interface Kind {
  /** the local axis that ends up vertical (discs: their face; the slice), or level (`side`: a cone) */
  axis: THREE.Vector3;
  side: boolean;
  /** how far the lowest point lies from the centre along the axis and across it (m) */
  along: number;
  across: number;
  bounce: number;
  /** air drag (1/s) */
  drag: number;
  /** contact shadow (m): along the piece's local y, and across */
  shadow: [number, number];
  sound: LandSound | null;
}

const KINDS: Record<Piece, Kind> = {
  slice: { axis: Z, side: false, along: 0.009, across: 0.1, bounce: 0.06, drag: 0.9, shadow: [0.2, 0.15], sound: "soft" },
  bunTop: { axis: Y, side: false, along: 0.016, across: 0.05, bounce: 0.38, drag: 0.4, shadow: [0.12, 0.12], sound: "bun" },
  bunBottom: { axis: Y, side: false, along: 0.009, across: 0.049, bounce: 0.32, drag: 0.4, shadow: [0.11, 0.11], sound: "bun" },
  patty: { axis: Y, side: false, along: 0.008, across: 0.05, bounce: 0.1, drag: 0.3, shadow: [0.12, 0.12], sound: "soft" },
  tomato: { axis: Y, side: false, along: 0.003, across: 0.041, bounce: 0.08, drag: 0.7, shadow: [0.09, 0.09], sound: "soft" },
  // a leaf flutters down and hardly bounces
  lettuce: { axis: Y, side: false, along: 0.004, across: 0.056, bounce: 0.04, drag: 2.6, shadow: [0.11, 0.11], sound: null },
  cone: { axis: Y, side: true, along: CONE.L / 2, across: 0.0135, bounce: 0.28, drag: 0.4, shadow: [0.14, 0.05], sound: "cone" },
};

interface Bit {
  kind: number;
  slot: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  q: THREE.Quaternion;
  /** angular velocity (rad/s, world) */
  w: THREE.Vector3;
  /** stuck to a wall this much longer (s); its face and the way down it */
  stuck: number;
  normal: THREE.Vector3 | null;
  down: THREE.Vector3 | null;
  /** the height it lands on (the floor, or the top it hit) */
  floor: number;
  resting: boolean;
  flat: THREE.Quaternion | null;
  size: number;
  /** when the conservator takes it (s on the sequence clock) */
  seq: number;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _t = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _sq = new THREE.Quaternion();
const _flat = new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2);
const _sp = new THREE.Vector3();
const _ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class FoodDebris {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly shadow: THREE.InstancedMesh;
  private readonly shadowTex = shadowTexture();
  private readonly per: number;
  private bits: Bit[] = [];
  private next: number[];
  private seqT = -1;
  private seqDur = 1;
  /** a piece lands (and each time it bounces hard enough to hear) */
  onLand: ((p: THREE.Vector3, sound: LandSound, speed: number) => void) | null = null;
  /** a slice comes off the wall */
  onPeel: ((p: THREE.Vector3) => void) | null = null;

  /** `low`: fewer of each piece kept (the oldest goes first). */
  constructor(low = false) {
    this.per = low ? 5 : 10;
    this.next = PIECES.map(() => 0);
    this.group.name = "fx-food";
    this.group.userData.fxIgnore = true;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
    this.material.name = "fx-food";
    for (const p of PIECES) {
      const m = new THREE.InstancedMesh(pieceGeometry(p), this.material, this.per);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < this.per; i++) m.setMatrixAt(i, _ZERO);
      // nothing drawn until a piece of this kind exists
      m.count = 0;
      m.frustumCulled = false;
      m.userData.fxIgnore = true;
      this.meshes.push(m);
      this.group.add(m);
    }
    const sm = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    sm.alphaMap = this.shadowTex;
    sm.name = "fx-food-shadow";
    this.shadow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), sm, PIECES.length * this.per);
    this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < PIECES.length * this.per; i++) this.shadow.setMatrixAt(i, _ZERO);
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 1;
    this.shadow.userData.fxIgnore = true;
    this.group.add(this.shadow);
  }

  /**
   * A slice of pizza stuck face first at `p` on the surface `frame`, its tip
   * along `angle` (splat space). On a wall it creeps down, then peels off; on
   * a floor it skids a little and lies there.
   */
  slice(p: THREE.Vector3, frame: SplatFrame, angle: number, impactVel: THREE.Vector3, size: number, floor: number, seed: number): void {
    const r = rng(seed ^ 0x3c6ef372);
    const n = frame.normal;
    // cheese to the surface, the crust away from the tip
    const tip = frame.right.clone().multiplyScalar(Math.cos(angle)).addScaledVector(frame.down, Math.sin(angle));
    const ly = tip.negate();
    const lz = n.clone().negate();
    const lx = new THREE.Vector3().crossVectors(ly, lz);
    const b = this.take(0, size, floor);
    b.q.setFromRotationMatrix(_m.makeBasis(lx, ly, lz));
    b.pos.copy(p).addScaledVector(n, 0.011 * size);
    if (Math.abs(n.y) < 0.55) {
      b.stuck = 0.45 + 0.5 * r();
      b.normal = n.clone();
      b.down = frame.down.clone();
    } else b.vel.copy(impactVel).addScaledVector(n, -impactVel.dot(n)).multiplyScalar(0.12);
  }

  /** A burger bursting at `p` on a surface facing `n`: its parts fly off. */
  burger(p: THREE.Vector3, n: THREE.Vector3, impactVel: THREE.Vector3, floor: number, seed: number, low: boolean): void {
    const r = rng(seed ^ 0x7f4a7c15);
    const parts: Piece[] = low ? ["bunTop", "patty", "bunBottom"] : ["bunTop", "patty", "bunBottom", "tomato", "lettuce"];
    for (const piece of parts) {
      const b = this.take(PIECES.indexOf(piece), 0.9 + 0.2 * r(), floor);
      b.pos.copy(p).addScaledVector(n, 0.035).add(_t.set(gauss(r), gauss(r), gauss(r)).multiplyScalar(0.03));
      b.vel
        .copy(n)
        .multiplyScalar(0.5 + 1.0 * r())
        .addScaledVector(impactVel, -0.03)
        .add(_t.set(gauss(r) * 1.1, 0.4 + 1.1 * r(), gauss(r) * 1.1));
      b.q.setFromEuler(new THREE.Euler(r() * 6.3, r() * 6.3, r() * 6.3));
      b.w.set(gauss(r), gauss(r), gauss(r)).normalize().multiplyScalar(5 + 10 * r());
    }
  }

  /** An ice cream's empty cone falling away from where its scoop landed. */
  cone(p: THREE.Vector3, n: THREE.Vector3, impactVel: THREE.Vector3, floor: number, seed: number): void {
    const r = rng(seed ^ 0x165667b1);
    const b = this.take(PIECES.indexOf("cone"), 1, floor);
    // rim to the surface, as it flew
    b.q.setFromUnitVectors(Y, _t.copy(impactVel).normalize());
    b.pos.copy(p).addScaledVector(n, 0.07);
    b.vel.copy(n).multiplyScalar(0.25 + 0.35 * r()).add(_t.set(gauss(r) * 0.3, 0.3 + 0.4 * r(), gauss(r) * 0.3));
    b.w.set(gauss(r), gauss(r), gauss(r)).normalize().multiplyScalar(3 + 5 * r());
  }

  private take(kind: number, size: number, floor: number): Bit {
    const slot = this.next[kind];
    this.next[kind] = (slot + 1) % this.per;
    // the oldest piece of this kind gives up its slot
    this.bits = this.bits.filter((b) => !(b.kind === kind && b.slot === slot));
    const m = this.meshes[kind];
    m.count = Math.max(m.count, slot + 1);
    const b: Bit = {
      kind,
      slot,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      w: new THREE.Vector3(),
      stuck: 0,
      normal: null,
      down: null,
      floor,
      resting: false,
      flat: null,
      size,
      seq: 0,
    };
    this.bits.push(b);
    return b;
  }

  get count(): number {
    return this.bits.length;
  }

  /** Advance; true while anything is still moving. */
  update(dt: number): boolean {
    let moving = false;
    for (const b of this.bits) {
      if (b.resting) continue;
      moving = true;
      const k = KINDS[PIECES[b.kind]];
      if (b.stuck > 0) {
        // creeping down the wall (held while the conservator works)
        b.pos.addScaledVector(b.down!, dt * 0.03);
        if (this.seqT >= 0) continue;
        b.stuck -= dt;
        if (b.stuck <= 0) {
          // the top comes away first and it tips toward the room: lands cheese up
          b.stuck = 0;
          b.w.crossVectors(_t.copy(b.down!).negate(), b.normal!).multiplyScalar(3.4);
          b.vel.copy(b.normal!).multiplyScalar(0.5).addScaledVector(b.down!, 0.15);
          this.onPeel?.(b.pos);
        }
        continue;
      }
      b.vel.y -= G * dt;
      b.vel.multiplyScalar(Math.max(0, 1 - k.drag * dt));
      b.pos.addScaledVector(b.vel, dt);
      const wl = b.w.length();
      if (wl > 1e-4) {
        _dq.setFromAxisAngle(_a.copy(b.w).divideScalar(wl), wl * dt);
        b.q.premultiply(_dq);
      }
      // its lowest point as it is turned
      const ay = Math.min(1, Math.abs(_a.copy(k.axis).applyQuaternion(b.q).y));
      const fy = b.floor + 0.001 + (k.along * ay + k.across * Math.sqrt(1 - ay * ay)) * b.size;
      if (b.pos.y <= fy) {
        b.pos.y = fy;
        if (b.vel.y < 0) {
          const speed = -b.vel.y;
          if (speed > 0.35 && k.sound) this.onLand?.(b.pos, k.sound, speed);
          if (speed > 0.3 || !b.flat) b.flat = this.flatOf(b, k);
          b.vel.y = speed * k.bounce;
          b.vel.x *= 0.6;
          b.vel.z *= 0.6;
          b.w.multiplyScalar(0.5);
        }
        // skidding
        const f = Math.max(0, 1 - 5 * dt);
        b.vel.x *= f;
        b.vel.z *= f;
      }
      if (b.flat && b.pos.y <= fy + 0.01) {
        b.q.slerp(b.flat, Math.min(1, dt * 9));
        b.w.multiplyScalar(Math.max(0, 1 - 8 * dt));
        if (b.vel.lengthSq() < 0.004 && b.w.lengthSq() < 0.5) {
          b.q.copy(b.flat);
          b.resting = true;
        }
      }
    }
    if (moving) this.writeMatrices();
    return moving;
  }

  /** Lying down from how it is turned now: face up or down, whichever is nearer (a cone on its side). */
  private flatOf(b: Bit, k: Kind): THREE.Quaternion {
    const a = _a.copy(k.axis).applyQuaternion(b.q);
    if (k.side) {
      _t.set(a.x, 0, a.z);
      if (_t.lengthSq() < 1e-6) _t.set(1, 0, 0);
      _t.normalize();
    } else _t.set(0, a.y >= 0 ? 1 : -1, 0);
    return new THREE.Quaternion().setFromUnitVectors(a, _t).multiply(b.q);
  }

  /** World positions of the pieces (for ordering the clean-up). */
  positions(): THREE.Vector3[] {
    return this.bits.map((b) => b.pos);
  }

  /** Each piece's moment in the clean-up (by positions() index). */
  setSequence(seq: (i: number) => number, dur: number): void {
    this.bits.forEach((b, i) => (b.seq = seq(i)));
    this.seqDur = dur;
  }

  /** The conservator's clock (s; < 0: not running): each piece shrinks away at its moment. */
  setClock(t: number): void {
    this.seqT = t;
    this.writeMatrices();
  }

  private writeMatrices(): void {
    const dirty = new Set<number>();
    for (const b of this.bits) {
      const k = this.seqT < 0 ? 1 : 1 - THREE.MathUtils.smoothstep(this.seqT, b.seq, b.seq + this.seqDur);
      _s.setScalar(k * b.size);
      _m.compose(b.pos, b.q, _s);
      this.meshes[b.kind].setMatrixAt(b.slot, _m);
      dirty.add(b.kind);
      // the contact shadow: there once the piece is near what it lands on, long the way the piece lies
      const kind = KINDS[PIECES[b.kind]];
      const near = 1 - THREE.MathUtils.smoothstep(b.pos.y - b.floor, 0.03, 0.25);
      _a.copy(Y).applyQuaternion(b.q);
      _sq.setFromAxisAngle(Y, Math.atan2(-_a.x, -_a.z)).multiply(_flat);
      _sp.set(b.pos.x, b.floor + 0.0006, b.pos.z);
      _s.set(kind.shadow[1], kind.shadow[0], 1).multiplyScalar(b.size * k * near);
      _m.compose(_sp, _sq, _s);
      this.shadow.setMatrixAt(b.kind * this.per + b.slot, _m);
    }
    dirty.forEach((v) => (this.meshes[v].instanceMatrix.needsUpdate = true));
    if (dirty.size) this.shadow.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.bits = [];
    for (const m of this.meshes) {
      for (let i = 0; i < this.per; i++) m.setMatrixAt(i, _ZERO);
      m.instanceMatrix.needsUpdate = true;
      m.count = 0;
    }
    for (let i = 0; i < PIECES.length * this.per; i++) this.shadow.setMatrixAt(i, _ZERO);
    this.shadow.instanceMatrix.needsUpdate = true;
    this.next.fill(0);
    this.seqT = -1;
  }

  dispose(): void {
    this.meshes.forEach((m) => {
      m.geometry.dispose();
      m.dispose();
    });
    this.material.dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.shadow.dispose();
    this.shadowTex.dispose();
  }
}
