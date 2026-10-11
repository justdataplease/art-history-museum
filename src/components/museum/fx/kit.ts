// Small props (food, darts) built from three's primitives and merged into
// one geometry with a colour per vertex: a whole slice of pizza or a dart's
// barrel is a single draw with one shared material, and the piece's look
// (crust, cheese, pepperoni; steel point, knurled grip) lives in the colours.

import * as THREE from "three";
import type { RGB } from "./splat";

/** A colour for a vertex (sRGB 0..255) from its position and normal (after the primitive's transform). */
export type Paint = (p: THREE.Vector3, n: THREE.Vector3) => RGB;

const _c = new THREE.Color();

export class Kit {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];

  /** Add a primitive (already placed) painted by `paint`; the primitive is disposed. */
  add(g: THREE.BufferGeometry, paint: Paint | RGB): this {
    const src = g.index ? g.toNonIndexed() : g;
    if (!src.getAttribute("normal")) src.computeVertexNormals();
    const P = src.getAttribute("position");
    const N = src.getAttribute("normal");
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i);
      n.fromBufferAttribute(N, i);
      const c = typeof paint === "function" ? paint(p, n) : paint;
      // vertex colours are linear
      _c.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      this.col.push(_c.r, _c.g, _c.b);
    }
    if (src !== g) src.dispose();
    g.dispose();
    return this;
  }

  /** Add triangles given directly (a flat colour per triangle: waffle cells). */
  tris(pos: number[], nrm: number[], col: RGB[]): this {
    for (let i = 0; i < pos.length / 3; i++) {
      const c = col[Math.floor(i / 3)];
      _c.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
      this.pos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      this.nrm.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
      this.col.push(_c.r, _c.g, _c.b);
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Blend two colours. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
