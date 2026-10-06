// Paint on everything that is not a painting: walls, floor, frames, benches.
// Each splat gets a square cell of one shared atlas (a PaintSurface) and a
// projected decal (three's DecalGeometry, clipped to the meshes the splat's
// box touches, so it wraps a gilt moulding or a bench edge). All decals are
// merged into a single mesh: one draw call however many there are. The
// oldest decal gives up its cell when the atlas is full. Each decal carries
// a per-vertex sequence key so the conservator can dissolve them one by one
// against a single clock.

import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { createDecalMaterial, type OverlayUniforms } from "./materials";
import { PaintSurface, type Rect } from "./surface";
import type { Bounds, Receiver } from "./splat";

/** A splat's frame in world space (splat space: +x right, +y down, metres). */
export interface SplatFrame {
  origin: THREE.Vector3;
  right: THREE.Vector3;
  down: THREE.Vector3;
  normal: THREE.Vector3;
}

interface Decal {
  cell: number;
  born: number;
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  /** the projector's frame and its square (splat metres), for reuse */
  frame: SplatFrame;
  sq: Bounds;
  rcv: Receiver;
  /** when the conservator dissolves it (s on the sequence clock) */
  seq: number;
}

export interface DecalOptions {
  atlasW: number;
  atlasH: number;
  cell: number;
  /** largest box a cell may cover (m); bigger splats are cropped */
  maxSide?: number;
}

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _d = new THREE.Vector3();

export class DecalManager {
  readonly mesh: THREE.Mesh;
  readonly uniforms: OverlayUniforms;
  private atlas: PaintSurface | null = null;
  private readonly opts: Required<DecalOptions>;
  private readonly cells: Rect[] = [];
  private readonly owner: (Decal | null)[] = [];
  private decals: Decal[] = [];
  private readonly texel = new THREE.Vector2(1, 1);

  constructor(opts: DecalOptions) {
    this.opts = { maxSide: 1.5, ...opts };
    const cols = Math.floor(opts.atlasW / opts.cell);
    const rows = Math.floor(opts.atlasH / opts.cell);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.cells.push({ x0: c * opts.cell, y0: r * opts.cell, x1: (c + 1) * opts.cell, y1: (r + 1) * opts.cell });
        this.owner.push(null);
      }
    }
    const { material, uniforms } = createDecalMaterial(
      new THREE.Texture(), // replaced by the atlas on first use
      new THREE.Texture(),
      this.texel,
    );
    this.uniforms = uniforms;
    uniforms.uOvlOn.value = 0;
    const geo = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = "fx-decals";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.userData.fxIgnore = true;
    this.mesh.visible = false;
  }

  /** The atlas (allocated on the first decal). */
  get surface(): PaintSurface | null {
    return this.atlas;
  }

  get count(): number {
    return this.decals.length;
  }

  private ensureAtlas(): PaintSurface {
    if (!this.atlas) {
      this.atlas = new PaintSurface(this.opts.atlasW, this.opts.atlasH);
      this.uniforms.uOvlCol.value = this.atlas.colTex;
      this.uniforms.uOvlMat.value = this.atlas.matTex;
      this.texel.set(1 / this.atlas.w, 1 / this.atlas.h);
      this.uniforms.uOvlOn.value = 1;
    }
    return this.atlas;
  }

  /**
   * Project a decal covering `box` (splat metres around the frame's origin)
   * onto `targets`. Returns the receiver that paints its cell, or null when
   * nothing was hit.
   */
  add(frame: SplatFrame, box: Bounds, targets: THREE.Mesh[], now: number, depth = 0.32, minSide = 0): Receiver | null {
    if (targets.length === 0) return null;
    const atlas = this.ensureAtlas();
    // a square box around the splat (cells are square), cropped if huge
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const side = Math.min(this.opts.maxSide, Math.max(minSide, Math.max(box.x1 - box.x0, box.y1 - box.y0) * 1.02));
    // keep the impact inside a cropped box (drips beyond it are cut off)
    const bx = THREE.MathUtils.clamp(cx, -side / 2 + 0.02, side / 2 - 0.02);
    const by = THREE.MathUtils.clamp(cy, -side / 2 + 0.02, side / 2 - 0.02);
    const sq = { x0: bx - side / 2, y0: by - side / 2, x1: bx + side / 2, y1: by + side / 2 };

    // projector: x = right, y = up (−down), z = out of the surface
    _up.copy(frame.down).negate();
    _m.makeBasis(frame.right, _up, frame.normal);
    _e.setFromRotationMatrix(_m);
    _p.copy(frame.origin).addScaledVector(frame.right, bx).addScaledVector(frame.down, by);
    const size = new THREE.Vector3(side, side, depth);

    const pos: number[] = [];
    const nrm: number[] = [];
    const uvs: number[] = [];
    for (const t of targets) {
      t.updateMatrixWorld();
      let g: THREE.BufferGeometry;
      try {
        g = new DecalGeometry(t, _p, _e, size);
      } catch {
        continue;
      }
      const P = g.getAttribute("position") as THREE.BufferAttribute | undefined;
      const N = g.getAttribute("normal") as THREE.BufferAttribute | undefined;
      const U = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
      if (!P || !U || P.count === 0) {
        g.dispose();
        continue;
      }
      for (let i = 0; i < P.count; i += 3) {
        // drop faces the projection grazes (they would smear into streaks)
        _a.fromBufferAttribute(P, i);
        _b.fromBufferAttribute(P, i + 1);
        _c.fromBufferAttribute(P, i + 2);
        _n.subVectors(_b, _a).cross(_d.subVectors(_c, _a)).normalize();
        if (_n.dot(frame.normal) < 0.3) continue;
        for (let k = 0; k < 3; k++) {
          const v = k === 0 ? _a : k === 1 ? _b : _c;
          // lift a hair off the surface (polygon offset does the rest)
          pos.push(v.x + frame.normal.x * 0.0008, v.y + frame.normal.y * 0.0008, v.z + frame.normal.z * 0.0008);
          if (N) nrm.push(N.getX(i + k), N.getY(i + k), N.getZ(i + k));
          else nrm.push(frame.normal.x, frame.normal.y, frame.normal.z);
          uvs.push(U.getX(i + k), U.getY(i + k));
        }
      }
      g.dispose();
    }
    if (pos.length === 0) return null;

    const cellIdx = this.takeCell(now);
    const cell = this.cells[cellIdx];
    const cw = cell.x1 - cell.x0;
    const ch = cell.y1 - cell.y0;
    // decal uv (0..1, v up) → atlas texture coordinates (rows run top-down,
    // the shader samples them as stored: v_tex = row / H)
    for (let i = 0; i < uvs.length; i += 2) {
      const u = uvs[i];
      const v = uvs[i + 1];
      uvs[i] = (cell.x0 + u * cw) / atlas.w;
      uvs[i + 1] = (cell.y0 + (1 - v) * ch) / atlas.h;
    }
    const rcv: Receiver = {
      surface: atlas,
      ox: cell.x0 - sq.x0 * (cw / side),
      oy: cell.y0 - sq.y0 * (ch / side),
      sx: cw / side,
      sy: ch / side,
      clip: cell,
    };
    const d: Decal = {
      cell: cellIdx,
      born: now,
      pos: new Float32Array(pos),
      nrm: new Float32Array(nrm),
      uv: new Float32Array(uvs),
      frame: { origin: frame.origin.clone(), right: frame.right.clone(), down: frame.down.clone(), normal: frame.normal.clone() },
      sq,
      rcv,
      seq: 0,
    };
    this.owner[cellIdx] = d;
    this.decals.push(d);
    this.rebuild();
    return rcv;
  }

  /**
   * An existing decal on the same plane that already covers `box` around
   * `point` (paintballs and scratches cluster: a burst should not eat the
   * atlas). The receiver and frame returned are in that decal's axes.
   */
  reuse(point: THREE.Vector3, normal: THREE.Vector3, box: Bounds): { rcv: Receiver; frame: SplatFrame } | null {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      const f = d.frame;
      if (f.normal.dot(normal) < 0.985) continue;
      _a.subVectors(point, f.origin);
      if (Math.abs(_a.dot(f.normal)) > 0.012) continue;
      const x = _a.dot(f.right);
      const y = _a.dot(f.down);
      const m = 0.01;
      if (x + box.x0 < d.sq.x0 + m || x + box.x1 > d.sq.x1 - m || y + box.y0 < d.sq.y0 + m || y + box.y1 > d.sq.y1 - m) continue;
      const r = d.rcv;
      return {
        rcv: { surface: r.surface, ox: r.ox + x * r.sx, oy: r.oy + y * r.sy, sx: r.sx, sy: r.sy, clip: r.clip },
        frame: { origin: point.clone(), right: f.right.clone(), down: f.down.clone(), normal: f.normal.clone() },
      };
    }
    return null;
  }

  private takeCell(now: number): number {
    let idx = this.owner.indexOf(null);
    if (idx < 0) {
      // recycle the oldest decal
      let oldest = 0;
      for (let i = 1; i < this.owner.length; i++) {
        if ((this.owner[i]?.born ?? Infinity) < (this.owner[oldest]?.born ?? Infinity)) oldest = i;
      }
      idx = oldest;
      const gone = this.owner[idx];
      this.decals = this.decals.filter((x) => x !== gone);
      this.owner[idx] = null;
    }
    this.atlas?.clearRect(this.cells[idx]);
    void now;
    return idx;
  }

  /** World-space centre of each decal (for ordering the clean-up). */
  centres(): { id: number; at: THREE.Vector3 }[] {
    return this.decals.map((d, id) => ({
      id,
      at: d.frame.origin.clone().addScaledVector(d.frame.right, (d.sq.x0 + d.sq.x1) / 2).addScaledVector(d.frame.down, (d.sq.y0 + d.sq.y1) / 2),
    }));
  }

  /** Give each decal (by centres() id) its moment in the clean-up sequence. */
  setSequence(seq: (id: number) => number): void {
    this.decals.forEach((d, i) => (d.seq = seq(i)));
    this.rebuild();
  }

  private rebuild(): void {
    let n = 0;
    for (const d of this.decals) n += d.pos.length;
    const pos = new Float32Array(n);
    const nrm = new Float32Array(n);
    const uv = new Float32Array((n / 3) * 2);
    const seq = new Float32Array(n / 3);
    let o = 0;
    let ou = 0;
    for (const d of this.decals) {
      pos.set(d.pos, o);
      nrm.set(d.nrm, o);
      uv.set(d.uv, ou);
      seq.fill(d.seq, o / 3, (o + d.pos.length) / 3);
      o += d.pos.length;
      ou += d.uv.length;
    }
    const old = this.mesh.geometry;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("aOvlSeq", new THREE.BufferAttribute(seq, 1));
    g.computeBoundingSphere();
    this.mesh.geometry = g;
    old.dispose();
    this.mesh.visible = n > 0;
  }

  /** Remove every decal and wipe the atlas. */
  clear(): void {
    this.decals = [];
    this.owner.fill(null);
    this.atlas?.clear();
    this.rebuild();
  }

  /** Free the atlas memory (it comes back on the next decal). */
  release(): void {
    this.atlas?.dispose();
    this.atlas = null;
    this.uniforms.uOvlOn.value = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.atlas?.dispose();
    this.atlas = null;
  }
}
