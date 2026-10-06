// Eggshell: curved, jagged pieces of an ellipsoid that burst off the
// impact, tumble, bounce on the floor and stay there. The outer face is the
// shell (white or brown, faintly speckled, matte), the inner face the pale,
// slightly glossy membrane. Each piece lying on the floor sits on a soft
// contact shadow. Instanced per shard shape (and one instanced mesh for all
// the shadows), so a whole visit's worth of broken eggs is a handful of
// draw calls.

import * as THREE from "three";
import { gauss, rng } from "./noise";

const VARIANTS = 6;
const PER_VARIANT = 40;
const G = 9.81;
const EGG_R = 0.022; // equatorial radius (m)
const EGG_L = 0.029; // half length

interface Shard {
  v: number; // variant
  slot: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  q: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number; // rad/s
  resting: boolean;
  flat: THREE.Quaternion | null;
  /** when the conservator takes it (s on the sequence clock) */
  seq: number;
  /** its own size (pieces of one egg differ) */
  size: number;
}

/** A jagged patch of an egg's shell, centred on the origin, outer side +z (front faces outward). */
function shardGeometry(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  // patch around a random point of the egg, in the egg's own frame
  const lat = (r() - 0.5) * 2.2;
  const lon = r() * Math.PI * 2;
  const ang = 0.42 + 0.42 * r(); // angular radius of the patch
  const nEdge = 7 + Math.floor(r() * 4);
  const edge: number[] = [];
  for (let i = 0; i < nEdge; i++) {
    // jagged crack line: alternating in/out
    edge.push(ang * (0.5 + 0.5 * r()) * (i % 2 ? 0.78 : 1));
  }
  const rings = 3;
  const center = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  const t1 = new THREE.Vector3(0, 1, 0).cross(center);
  if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
  t1.normalize();
  const t2 = new THREE.Vector3().crossVectors(center, t1).normalize();
  const egg = (d: THREE.Vector3) => {
    // ellipsoid: stretch y (the long axis), slightly pointy at +y
    const y = d.y * EGG_L * (d.y > 0 ? 1.08 : 0.94);
    return new THREE.Vector3(d.x * EGG_R, y, d.z * EGG_R);
  };
  const pts: THREE.Vector3[] = [];
  pts.push(egg(center));
  for (let ring = 1; ring <= rings; ring++) {
    for (let i = 0; i < nEdge; i++) {
      const a = (i / nEdge) * Math.PI * 2;
      const rad = (edge[i] * ring) / rings;
      const dir = center
        .clone()
        .multiplyScalar(Math.cos(rad))
        .addScaledVector(t1, Math.sin(rad) * Math.cos(a))
        .addScaledVector(t2, Math.sin(rad) * Math.sin(a))
        .normalize();
      pts.push(egg(dir));
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nEdge; i++) idx.push(0, 1 + i, 1 + ((i + 1) % nEdge));
  for (let ring = 1; ring < rings; ring++) {
    const a0 = 1 + (ring - 1) * nEdge;
    const b0 = 1 + ring * nEdge;
    for (let i = 0; i < nEdge; i++) {
      const i1 = (i + 1) % nEdge;
      idx.push(a0 + i, b0 + i, b0 + i1, a0 + i, b0 + i1, a0 + i1);
    }
  }
  // recentre: the patch centroid at the origin, its outward normal on +z
  const c = new THREE.Vector3();
  pts.forEach((p) => c.add(p));
  c.divideScalar(pts.length);
  const out = egg(center).normalize();
  const rot = new THREE.Quaternion().setFromUnitVectors(out, new THREE.Vector3(0, 0, 1));
  const pos = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => {
    p.sub(c).applyQuaternion(rot);
    pos.set([p.x, p.y, p.z], i * 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);
const _dq = new THREE.Quaternion();
const _Z = new THREE.Vector3(0, 0, 1);
const _Y = new THREE.Vector3(0, 1, 0);
const _ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const _sp = new THREE.Vector3();
const _sq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

/** A soft round falloff for the contact shadows. */
function shadowTexture(): THREE.DataTexture {
  const S = 64;
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const r = Math.sqrt(u * u + v * v) * 2;
      const a = Math.max(0, 1 - r) ** 2.2;
      // (an alphaMap is read from the green channel)
      const i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = a * 255;
      d[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(d, S, S);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const WHITE = new THREE.Color("#efe7d8");
const BROWN = new THREE.Color("#c18a5e");

export class ShardSystem {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly shadow: THREE.InstancedMesh;
  private readonly shadowTex = shadowTexture();
  private shards: Shard[] = [];
  private next = new Array(VARIANTS).fill(0);
  private floorY: number;
  private seqT = -1;
  private seqDur = 1;
  /** called when a shard first strikes the floor (for a tick of sound) */
  onClink: ((p: THREE.Vector3, speed: number) => void) | null = null;

  constructor(floorY = 0) {
    this.floorY = floorY;
    this.group.name = "fx-shards";
    this.group.userData.fxIgnore = true;
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.6,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.material.name = "fx-shell";
    // outside: the shell (instance colour, faint speckle); inside: the membrane
    this.material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vShellP;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvShellP = position * 900.0;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vShellP;")
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
	{
		float sp = fract( sin( dot( floor( vShellP ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
		vec3 shell = diffuseColor.rgb * ( 0.94 + 0.06 * sp );
		vec3 membrane = vec3( 0.93, 0.91, 0.86 );
		diffuseColor.rgb = gl_FrontFacing ? shell : membrane;
	}`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\n\troughnessFactor = gl_FrontFacing ? roughnessFactor : 0.32;",
        );
    };
    this.material.customProgramCacheKey = () => "fx-shell-2";
    for (let v = 0; v < VARIANTS; v++) {
      const g = shardGeometry(1000 + v * 77);
      this.geos.push(g);
      const m = new THREE.InstancedMesh(g, this.material, PER_VARIANT);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < PER_VARIANT; i++) {
        m.setMatrixAt(i, _ZERO);
        m.setColorAt(i, WHITE);
      }
      m.count = PER_VARIANT;
      m.frustumCulled = false;
      m.userData.fxIgnore = true;
      this.meshes.push(m);
      this.group.add(m);
    }
    const sg = new THREE.PlaneGeometry(1, 1);
    const sm = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    sm.alphaMap = this.shadowTex;
    sm.name = "fx-shell-shadow";
    this.shadow = new THREE.InstancedMesh(sg, sm, VARIANTS * PER_VARIANT);
    this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < VARIANTS * PER_VARIANT; i++) this.shadow.setMatrixAt(i, _ZERO);
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 1;
    this.shadow.userData.fxIgnore = true;
    this.group.add(this.shadow);
  }

  setFloor(y: number): void {
    this.floorY = y;
  }

  /** Burst pieces off an impact at `p` on a surface facing `normal`. */
  spawn(p: THREE.Vector3, normal: THREE.Vector3, impactVel: THREE.Vector3, seed: number, brown = false): void {
    const r = rng(seed);
    const n = 5 + Math.floor(r() * 5);
    const col = brown ? BROWN : WHITE;
    for (let k = 0; k < n; k++) {
      const v = Math.floor(r() * VARIANTS);
      const slot = this.next[v];
      this.next[v] = (slot + 1) % PER_VARIANT;
      // drop whatever shard used that slot before
      this.shards = this.shards.filter((s) => !(s.v === v && s.slot === slot));
      this.shadow.setMatrixAt(v * PER_VARIANT + slot, _ZERO);
      const vel = normal
        .clone()
        .multiplyScalar(0.25 + 0.75 * r())
        .addScaledVector(impactVel, -0.04)
        .add(new THREE.Vector3(gauss(r) * 0.6, 0.15 + r() * 0.7, gauss(r) * 0.6));
      const pos = p.clone().addScaledVector(normal, 0.012).add(new THREE.Vector3(gauss(r) * 0.03, gauss(r) * 0.03, gauss(r) * 0.03));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6.3, r() * 6.3, r() * 6.3));
      const axis = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize();
      this.shards.push({ v, slot, pos, vel, q, axis, spin: 8 + 18 * r(), resting: false, flat: null, seq: 0, size: 0.8 + 0.45 * r() });
      this.meshes[v].setColorAt(slot, col);
      if (this.meshes[v].instanceColor) this.meshes[v].instanceColor!.needsUpdate = true;
    }
  }

  get count(): number {
    return this.shards.length;
  }

  /** Advance; true while anything is still moving. */
  update(dt: number): boolean {
    let moving = false;
    const fy = this.floorY + 0.0016;
    for (const s of this.shards) {
      if (s.resting) continue;
      moving = true;
      s.vel.y -= G * dt;
      // a little air drag: shell flakes flutter
      s.vel.multiplyScalar(1 - 0.6 * dt);
      s.pos.addScaledVector(s.vel, dt);
      _dq.setFromAxisAngle(s.axis, s.spin * dt);
      s.q.premultiply(_dq);
      if (s.pos.y <= fy) {
        s.pos.y = fy;
        const speed = Math.abs(s.vel.y);
        if (speed > 0.25) this.onClink?.(s.pos, speed);
        s.vel.y = speed * 0.22;
        s.vel.x *= 0.5;
        s.vel.z *= 0.5;
        s.spin *= 0.45;
        if (!s.flat) {
          // settle convex side up or down, whichever is nearer
          const z = _Z.clone().applyQuaternion(s.q);
          const target = z.y >= 0 ? _Y : _Y.clone().negate();
          s.flat = new THREE.Quaternion().setFromUnitVectors(z, target).multiply(s.q);
        }
      }
      if (s.flat && s.pos.y <= fy + 0.01) {
        s.q.slerp(s.flat, Math.min(1, dt * 10));
        if (s.vel.lengthSq() < 0.02 && s.spin < 3) {
          s.q.copy(s.flat);
          s.resting = true;
        }
      }
    }
    if (moving) this.writeMatrices();
    return moving;
  }

  /** World positions of the shards (for ordering the clean-up). */
  positions(): THREE.Vector3[] {
    return this.shards.map((s) => s.pos);
  }

  /** Each shard's moment in the clean-up (by positions() index). */
  setSequence(seq: (i: number) => number, dur: number): void {
    this.shards.forEach((s, i) => (s.seq = seq(i)));
    this.seqDur = dur;
  }

  /** The conservator's clock (s; < 0: not running): each shard shrinks away at its moment. */
  setClock(t: number): void {
    this.seqT = t;
    this.writeMatrices();
  }

  private writeMatrices(): void {
    const dirty = new Set<number>();
    for (const s of this.shards) {
      const k = this.seqT < 0 ? 1 : 1 - THREE.MathUtils.smoothstep(this.seqT, s.seq, s.seq + this.seqDur);
      _s.setScalar(k * s.size);
      _m.compose(s.pos, s.q, _s);
      this.meshes[s.v].setMatrixAt(s.slot, _m);
      dirty.add(s.v);
      // the contact shadow: there once the piece is near the floor
      const near = 1 - THREE.MathUtils.smoothstep(s.pos.y - this.floorY, 0.004, 0.08);
      _sp.set(s.pos.x, this.floorY + 0.0006, s.pos.z);
      _s.setScalar(0.05 * s.size * k * near);
      _m.compose(_sp, _sq, _s);
      this.shadow.setMatrixAt(s.v * PER_VARIANT + s.slot, _m);
    }
    dirty.forEach((v) => (this.meshes[v].instanceMatrix.needsUpdate = true));
    if (dirty.size) this.shadow.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.shards = [];
    for (const m of this.meshes) {
      for (let i = 0; i < PER_VARIANT; i++) m.setMatrixAt(i, _ZERO);
      m.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < VARIANTS * PER_VARIANT; i++) this.shadow.setMatrixAt(i, _ZERO);
    this.shadow.instanceMatrix.needsUpdate = true;
    this.seqT = -1;
  }

  dispose(): void {
    this.geos.forEach((g) => g.dispose());
    this.material.dispose();
    this.meshes.forEach((m) => m.dispose());
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.shadow.dispose();
    this.shadowTex.dispose();
  }
}
