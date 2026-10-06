// Short-lived bits in the air: plaster dust and grit where a blade scores a
// wall, fibres and paint flakes where it opens a canvas, flecks of gold leaf
// off a frame, a fine mist where a paintball bursts. One pooled point cloud
// (one draw call), simulated on the CPU (a few hundred points at most).

import * as THREE from "three";
import { gauss, rng } from "./noise";

const G = 9.81;

/** Soft: a gaussian puff (dust). Chip: a hard-edged flake (grit, paint, fibres). */
export const Shape = { Soft: 0, Chip: 1 } as const;
export type Shape = (typeof Shape)[keyof typeof Shape];

export interface ParticleSpec {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  size0: number; // m
  size1: number;
  color: THREE.Color; // linear
  alpha: number;
  gravity: number; // × g
  drag: number; // 1/s
  shape: Shape;
  floor?: boolean; // stop on the floor (debris)
}

interface P extends ParticleSpec {
  age: number;
  alive: boolean;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
attribute float aShape;
uniform float uScale;
varying vec4 vColor;
varying float vShape;
void main() {
	vec4 mv = modelViewMatrix * vec4( position, 1.0 );
	gl_Position = projectionMatrix * mv;
	gl_PointSize = max( 1.0, aSize * uScale / max( 0.05, - mv.z ) );
	vColor = aColor;
	vShape = aShape;
}`;

const FRAG = /* glsl */ `
uniform float uLight;
varying vec4 vColor;
varying float vShape;
void main() {
	vec2 p = gl_PointCoord * 2.0 - 1.0;
	float r2 = dot( p, p );
	if ( r2 > 1.0 ) discard;
	float a;
	vec3 c = vColor.rgb;
	if ( vShape < 0.5 ) {
		a = exp( - r2 * 3.2 ) * ( 1.0 - smoothstep( 0.7, 1.0, r2 ) );
	} else {
		// a chip: hard edge, a little shading so it reads as a solid bit
		a = 1.0 - smoothstep( 0.45, 0.62, r2 );
		c *= 0.8 + 0.35 * ( 0.5 - p.y * 0.5 );
	}
	gl_FragColor = vec4( c * uLight, vColor.a * a );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

export class Particles {
  readonly points: THREE.Points;
  private readonly pool: P[] = [];
  private readonly pos: Float32Array;
  private readonly size: Float32Array;
  private readonly color: Float32Array;
  private readonly shape: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private next = 0;
  private live = 0;
  private floor: number;

  constructor(cap = 600, floorY = 0) {
    this.floor = floorY;
    this.pos = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.color = new Float32Array(cap * 4);
    this.shape = new Float32Array(cap);
    for (let i = 0; i < cap; i++) this.pool.push({ alive: false, age: 0 } as P);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aShape", new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 800 }, uLight: { value: 0.85 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.name = "fx-particles";
    this.points.frustumCulled = false;
    this.points.userData.fxIgnore = true;
    this.points.renderOrder = 3;
  }

  setFloor(y: number): void {
    this.floor = y;
  }

  /** Viewport scale for point sizes: pixels per metre at 1 m. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  get active(): boolean {
    return this.live > 0;
  }

  emit(s: ParticleSpec): void {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    Object.assign(p, s, { pos: s.pos.clone(), vel: s.vel.clone(), color: s.color.clone(), age: 0, alive: true });
  }

  // ------------------------------------------------------------ recipes

  /** Plaster or stone scored by a blade: a puff of dust and a sprinkle of grit. */
  dust(p: THREE.Vector3, n: THREE.Vector3, seed: number, tint: THREE.Color, amount = 1): void {
    const r = rng(seed);
    const puffs = Math.round((8 + 6 * r()) * amount);
    for (let i = 0; i < puffs; i++) {
      const v = n.clone().multiplyScalar(0.3 + 0.7 * r()).add(new THREE.Vector3(gauss(r), gauss(r) + 0.15, gauss(r)).multiplyScalar(0.3));
      this.emit({
        pos: p.clone().addScaledVector(n, 0.01),
        vel: v,
        life: 0.8 + 0.8 * r(),
        size0: 0.01 + 0.01 * r(),
        size1: 0.07 + 0.09 * r(),
        color: tint.clone().multiplyScalar(0.9 + 0.2 * r()),
        alpha: 0.2 + 0.15 * r(),
        gravity: 0.02,
        drag: 3.2,
        shape: Shape.Soft,
      });
    }
    const chips = Math.round((6 + 6 * r()) * amount);
    for (let i = 0; i < chips; i++) {
      const v = n.clone().multiplyScalar(0.3 + 1.1 * r()).add(new THREE.Vector3(gauss(r), gauss(r) + 0.3, gauss(r)).multiplyScalar(0.7));
      this.emit({
        pos: p.clone().addScaledVector(n, 0.005),
        vel: v,
        life: 1.4 + 1.0 * r(),
        size0: 0.0025 + 0.003 * r(),
        size1: 0.0025 + 0.003 * r(),
        color: tint.clone().multiplyScalar(0.75 + 0.3 * r()),
        alpha: 1,
        gravity: 1,
        drag: 0.4,
        shape: Shape.Chip,
        floor: true,
      });
    }
  }

  /** A canvas opened by a blade: linen fibres and flakes of the paint layer. */
  flakes(p: THREE.Vector3, n: THREE.Vector3, seed: number, colors: THREE.Color[]): void {
    const r = rng(seed);
    const k = 6 + Math.floor(r() * 7);
    for (let i = 0; i < k; i++) {
      const c = colors[Math.floor(r() * colors.length)] ?? new THREE.Color(0.6, 0.55, 0.45);
      const v = n.clone().multiplyScalar(0.2 + 0.7 * r()).add(new THREE.Vector3(gauss(r), gauss(r) + 0.2, gauss(r)).multiplyScalar(0.5));
      this.emit({
        pos: p.clone().addScaledVector(n, 0.004),
        vel: v,
        life: 1.2 + 1.2 * r(),
        size0: 0.002 + 0.003 * r(),
        size1: 0.002 + 0.003 * r(),
        color: c.clone().multiplyScalar(0.85 + 0.25 * r()),
        alpha: 1,
        gravity: 0.55,
        drag: 2.2, // flakes flutter
        shape: Shape.Chip,
        floor: true,
      });
    }
  }

  /** A paintball bursting: a brief fine mist of the fill. */
  mist(p: THREE.Vector3, n: THREE.Vector3, seed: number, color: THREE.Color): void {
    const r = rng(seed);
    const k = 10 + Math.floor(r() * 8);
    for (let i = 0; i < k; i++) {
      const v = n.clone().multiplyScalar(0.4 + 1.2 * r()).add(new THREE.Vector3(gauss(r), gauss(r), gauss(r)).multiplyScalar(1.4));
      this.emit({
        pos: p.clone().addScaledVector(n, 0.006),
        vel: v,
        life: 0.25 + 0.3 * r(),
        size0: 0.0018 + 0.002 * r(),
        size1: 0.001,
        color: color.clone().multiplyScalar(0.8 + 0.3 * r()),
        alpha: 0.9,
        gravity: 0.8,
        drag: 4,
        shape: Shape.Chip,
      });
    }
  }

  update(dt: number): boolean {
    let n = 0;
    const fy = this.floor;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      p.vel.y -= G * p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.floor && p.pos.y < fy + 0.002) {
        p.pos.y = fy + 0.002;
        p.vel.set(p.vel.x * 0.3, Math.abs(p.vel.y) * 0.15, p.vel.z * 0.3);
      }
      const k = p.age / p.life;
      const fade = p.shape === Shape.Soft ? 1 - k : 1 - Math.max(0, (k - 0.7) / 0.3);
      this.pos[n * 3] = p.pos.x;
      this.pos[n * 3 + 1] = p.pos.y;
      this.pos[n * 3 + 2] = p.pos.z;
      this.size[n] = p.size0 + (p.size1 - p.size0) * Math.sqrt(k);
      this.color[n * 4] = p.color.r;
      this.color[n * 4 + 1] = p.color.g;
      this.color[n * 4 + 2] = p.color.b;
      this.color[n * 4 + 3] = p.alpha * fade;
      this.shape[n] = p.shape;
      n++;
    }
    const was = this.live;
    this.live = n;
    this.geo.setDrawRange(0, n);
    if (n > 0 || was > 0) {
      for (const name of ["position", "aSize", "aColor", "aShape"]) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
    return n > 0;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
    this.live = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
