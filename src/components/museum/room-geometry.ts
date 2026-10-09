// Static room geometry, merged per material and baked in world space.
//
// Every architectural part (walls, cornice, skirting, beams, doors, track
// rails, benches…) is generated here as plain BufferGeometry with its world
// transform applied, then merged with BufferGeometryUtils.mergeGeometries —
// one draw call per material instead of one per box. The merged meshes are
// rendered with no transform props and matrixAutoUpdate={false}.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  columnsOf,
  ENTRANCE_DOOR,
  TRACK_DROP,
  TRACK_INSET,
  type Doorway,
  type Furnishing,
  type GalleryLayout,
} from "./layout";
import type { GalleryTheme } from "./theme";
import { buildFurnishing, furnitureOf } from "./furniture";

const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);

// ------------------------------------------------------------------ batching

export class GeoBatch {
  private parts: THREE.BufferGeometry[] = [];

  /** `colored`: every part carries a vertex colour (the furniture: one material, many fabrics). */
  constructor(
    private roundedBoxes: Map<string, THREE.BufferGeometry> | null = null,
    private colored = false
  ) {}

  /** Add a geometry (consumed), optionally transformed into world space, in `color` when the batch is colored. */
  add(g: THREE.BufferGeometry, m?: THREE.Matrix4, color?: THREE.Color): this {
    if (m) g.applyMatrix4(m);
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    }
    const count = g.attributes.position.count;
    if (this.colored) {
      const c = color ?? WHITE;
      const rgb = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        rgb[i * 3] = c.r;
        rgb[i * 3 + 1] = c.g;
        rgb[i * 3 + 2] = c.b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (!g.index) {
      const idx = new Array<number>(count);
      for (let i = 0; i < count; i++) idx[i] = i;
      g.setIndex(idx);
    }
    g.clearGroups();
    this.parts.push(g);
    return this;
  }

  /** Axis-aligned (optionally Y-rotated) box centred at (x, y, z). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), xform(x, y, z, rotY));
  }

  /** Box with rounded (bevelled) edges. */
  roundedBox(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    radius: number, segments = 2, rotY = 0
  ): this {
    const r = Math.min(radius, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    const key = `${w},${h},${d},${segments},${r}`;
    let g = this.roundedBoxes?.get(key);
    if (!g) {
      g = indexRoundedBox(new RoundedBoxGeometry(w, h, d, segments, r));
      this.roundedBoxes?.set(key, g);
    }
    return this.add(this.roundedBoxes ? g.clone() : g, xform(x, y, z, rotY));
  }

  /** Rounded box under any transform (the furniture's tilted backs and cushions). */
  roundedBoxAt(w: number, h: number, d: number, radius: number, segments: number, m: THREE.Matrix4, color?: THREE.Color): this {
    const r = Math.min(radius, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    const key = `${w},${h},${d},${segments},${r}`;
    let g = this.roundedBoxes?.get(key);
    if (!g) {
      g = indexRoundedBox(new RoundedBoxGeometry(w, h, d, segments, r));
      this.roundedBoxes?.set(key, g);
    }
    return this.add(this.roundedBoxes ? g.clone() : g, m, color);
  }

  /** Vertical cylinder (frustum) whose base sits at y. */
  cylinder(rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 12): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false), xform(x, y + h / 2, z));
  }

  /**
   * A planar quad from an origin and two edge vectors; the face normal is
   * edgeU × edgeV. UVs are in metres (u along edgeU, v along edgeV) offset by
   * `uv0`, so textures tile at the same physical scale on every wall.
   */
  quad(origin: THREE.Vector3, edgeU: THREE.Vector3, edgeV: THREE.Vector3, uv0: [number, number] = [0, 0]): this {
    const n = new THREE.Vector3().crossVectors(edgeU, edgeV).normalize();
    const p = [
      origin.clone(),
      origin.clone().add(edgeU),
      origin.clone().add(edgeU).add(edgeV),
      origin.clone().add(edgeV),
    ];
    const lu = edgeU.length();
    const lv = edgeV.length();
    const uv = [
      [uv0[0], uv0[1]],
      [uv0[0] + lu, uv0[1]],
      [uv0[0] + lu, uv0[1] + lv],
      [uv0[0], uv0[1] + lv],
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p.flatMap((v) => [v.x, v.y, v.z]), 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(p.flatMap(() => [n.x, n.y, n.z]), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv.flat(), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return this.add(g);
  }

  /**
   * Sweep a 2D moulding profile along a straight run of wall.
   * profile: [d, h] pairs — d = distance out from the wall face, h = height —
   * ordered from the bottom edge, around the room-facing side, back to the
   * wall. `start`/`end` are on the wall face at h = 0; `inward` is the wall's
   * room-facing normal. Adjacent facets within `smoothDeg` share normals.
   */
  sweep(
    profile: [number, number][],
    start: THREE.Vector3,
    end: THREE.Vector3,
    inward: THREE.Vector3,
    smoothDeg = 38
  ): this {
    const n = profile.length;
    if (n < 2) return this;
    // facet normals in profile space: rotate the facet direction by -90°
    const fN: [number, number][] = [];
    for (let i = 0; i < n - 1; i++) {
      const dd = profile[i + 1][0] - profile[i][0];
      const dh = profile[i + 1][1] - profile[i][1];
      const len = Math.hypot(dd, dh) || 1;
      fN.push([dh / len, -dd / len]);
    }
    const cosLim = Math.cos((smoothDeg * Math.PI) / 180);
    const vtxN = (facet: number, end: 0 | 1): [number, number] => {
      const nb = end === 0 ? facet - 1 : facet + 1;
      const a = fN[facet];
      if (nb < 0 || nb >= fN.length) return a;
      const b = fN[nb];
      if (a[0] * b[0] + a[1] * b[1] < cosLim) return a;
      const sx = a[0] + b[0];
      const sy = a[1] + b[1];
      const l = Math.hypot(sx, sy) || 1;
      return [sx / l, sy / l];
    };
    const runLen = start.distanceTo(end);
    const pos: number[] = [];
    const nor: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    let arc = 0;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < n - 1; i++) {
      const pa = profile[i];
      const pb = profile[i + 1];
      const na = vtxN(i, 0);
      const nb = vtxN(i, 1);
      const segLen = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      const base = pos.length / 3;
      for (const [s, ptA] of [
        [start, pa],
        [end, pa],
        [end, pb],
        [start, pb],
      ] as [THREE.Vector3, [number, number]][]) {
        tmp.copy(s).addScaledVector(inward, ptA[0]).addScaledVector(UP, ptA[1]);
        pos.push(tmp.x, tmp.y, tmp.z);
      }
      for (const nn of [na, na, nb, nb]) {
        tmp.copy(inward).multiplyScalar(nn[0]).addScaledVector(UP, nn[1]).normalize();
        nor.push(tmp.x, tmp.y, tmp.z);
      }
      uvs.push(0, arc, runLen, arc, runLen, arc + segLen, 0, arc + segLen);
      arc += segLen;
      // wind so the geometric normal agrees with the shading normal
      const v0 = new THREE.Vector3(pos[base * 3], pos[base * 3 + 1], pos[base * 3 + 2]);
      const v1 = new THREE.Vector3(pos[base * 3 + 3], pos[base * 3 + 4], pos[base * 3 + 5]);
      const v2 = new THREE.Vector3(pos[base * 3 + 6], pos[base * 3 + 7], pos[base * 3 + 8]);
      const gN = new THREE.Vector3().crossVectors(v1.sub(v0), v2.sub(v0));
      const fn3 = inward.clone().multiplyScalar(fN[i][0]).addScaledVector(UP, fN[i][1]);
      if (gN.dot(fn3) >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return this.add(g);
  }

  get empty() {
    return this.parts.length === 0;
  }

  /** Merge everything into one static world-space geometry. */
  build(): THREE.BufferGeometry {
    if (this.parts.length === 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      return g;
    }
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    if (!merged) throw new Error("room-geometry: merge failed");
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
}

/** RoundedBoxGeometry repeats vertices per triangle. Share only bit-identical
 *  Float32 attributes, preserving normal/UV seams and the triangle order. */
function indexRoundedBox(g: RoundedBoxGeometry): THREE.BufferGeometry {
  const attrs = Object.entries(g.attributes).map(([name, a]) => [name, a as THREE.BufferAttribute] as const);
  const bits = attrs.map(([, a]) => new Uint32Array(a.array.buffer, a.array.byteOffset, a.array.length));
  const unique: number[] = [];
  const indices: number[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < g.getAttribute("position").count; i++) {
    let key = "";
    attrs.forEach(([, a], k) => {
      for (let j = 0; j < a.itemSize; j++) key += `${bits[k][i * a.itemSize + j]},`;
    });
    let index = seen.get(key);
    if (index === undefined) {
      index = unique.length;
      seen.set(key, index);
      unique.push(i);
    }
    indices.push(index);
  }
  for (const [name, a] of attrs) {
    const data = new Float32Array(unique.length * a.itemSize);
    unique.forEach((source, i) => {
      for (let j = 0; j < a.itemSize; j++) data[i * a.itemSize + j] = a.array[source * a.itemSize + j];
    });
    g.setAttribute(name, new THREE.BufferAttribute(data, a.itemSize, a.normalized));
  }
  g.setIndex(indices);
  return g;
}

function xform(x: number, y: number, z: number, rotY = 0): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  if (rotY) m.makeRotationY(rotY);
  m.setPosition(x, y, z);
  return m;
}

// ------------------------------------------------------------------ profiles

/** Quarter-round cove of radius r from (0, h0) up to (r, h0 + r). */
function coveProfile(r: number, h0: number, steps = 8): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    pts.push([r - r * Math.cos(t), h0 - r + r * Math.sin(t) + r]);
  }
  return pts;
}

// skirting: plinth with an ogee top (heights in m)
const SKIRTING: [number, number][] = [
  [0.024, 0],
  [0.024, 0.165],
  [0.03, 0.172],
  [0.03, 0.185],
  [0.022, 0.198],
  [0.014, 0.206],
  [0.01, 0.214],
  [0.0, 0.218],
];

// picture rail: small rounded moulding, ~6 cm tall
const PICTURE_RAIL: [number, number][] = [
  [0.0, -0.03],
  [0.012, -0.03],
  [0.022, -0.022],
  [0.03, -0.008],
  [0.03, 0.006],
  [0.022, 0.018],
  [0.008, 0.026],
  [0.0, 0.03],
];

// door architrave (face width ~13 cm)
const ARCHITRAVE: [number, number][] = [
  [0.0, 0.0],
  [0.022, 0.0],
  [0.03, 0.012],
  [0.03, 0.03],
  [0.024, 0.05],
  [0.024, 0.11],
  [0.034, 0.12],
  [0.034, 0.13],
  [0.0, 0.135],
];

// ------------------------------------------------------------------ ceiling

export interface CeilingSpec {
  kind: GalleryTheme["room"]["ceiling"];
  /** Cornice cove radius (0 = square wall/ceiling junction). */
  coveR: number;
  /** Where the cove springs from the wall: inside the wall's height under a laylight, from the cornice on top
   *  of the walls in a vault. */
  coveBase: number;
  /** Opening in the ceiling plane: half-width in x, z range. */
  wellX: number;
  wellZ0: number;
  wellZ1: number;
  /** Ceiling plane height and glass height. */
  yCeil: number;
  yGlass: number;
  /** Glass bays along z (between beams). */
  bays: { z0: number; z1: number }[];
  beamW: number;
  beamDepth: number;
  panes: [number, number];
  /** The room's own extent along the hall (its far and near wall faces). */
  z0: number;
  z1: number;
}

/** The ceiling of one room spanning z0..z1 (far and near wall faces). */
function roomCeilingSpec(
  W: number,
  H: number,
  z0: number,
  z1: number,
  theme: GalleryTheme,
  inset = TRACK_INSET,
): CeilingSpec {
  const railX = W / 2 - inset;
  if (theme.room.ceiling === "vault") {
    // coves as deep as the room allows springing from the top of the walls, a skylight between them
    const r = Math.max(1.2, Math.min(2.6, W / 2 - 1.9, (z1 - z0) / 2 - 1.9));
    const band = 0.35;
    const wellX = W / 2 - r - band;
    const wellZ0 = z0 + r + band;
    const wellZ1 = z1 - r - band;
    const len = wellZ1 - wellZ0;
    const n = Math.max(2, Math.round(len / 3.2));
    const bays: { z0: number; z1: number }[] = [];
    for (let i = 0; i < n; i++) {
      bays.push({ z0: wellZ0 + (len * i) / n, z1: wellZ0 + (len * (i + 1)) / n });
    }
    return {
      kind: "vault",
      coveR: r,
      coveBase: H,
      wellX,
      wellZ0,
      wellZ1,
      yCeil: H + r,
      yGlass: H + r + 0.55,
      bays,
      beamW: 0.2,
      beamDepth: 0.3,
      panes: [4, 3],
      z0,
      z1,
    };
  }
  if (theme.room.ceiling === "laylight") {
    const wellX = Math.min(railX - 0.42, W / 2 - 1.6);
    const wellZ0 = z0 + inset + 0.75;
    const wellZ1 = z1 - inset - 0.75;
    const len = wellZ1 - wellZ0;
    const n = Math.max(2, Math.round(len / 3.5));
    const beamW = 0.22;
    const bays: { z0: number; z1: number }[] = [];
    for (let i = 0; i < n; i++) {
      bays.push({ z0: wellZ0 + (len * i) / n, z1: wellZ0 + (len * (i + 1)) / n });
    }
    return {
      kind: "laylight",
      coveR: 0.42,
      coveBase: H - 0.42,
      wellX,
      wellZ0,
      wellZ1,
      yCeil: H,
      yGlass: H + 0.62,
      bays,
      beamW,
      beamDepth: 0.34,
      panes: [4, 3],
      z0,
      z1,
    };
  }
  // lightbox: one long shallow diffuser down the middle of a flat ceiling
  // (a cabinet's: a slim slot, the spots do the lighting)
  const wellX = theme.room.diffuserHalfWidth ?? 0.75;
  const wellZ0 = z0 + inset + 0.6;
  const wellZ1 = z1 - inset - 0.6;
  const len = wellZ1 - wellZ0;
  const n = Math.max(2, Math.round(len / 2.4));
  const bays: { z0: number; z1: number }[] = [];
  for (let i = 0; i < n; i++) {
    bays.push({ z0: wellZ0 + (len * i) / n, z1: wellZ0 + (len * (i + 1)) / n });
  }
  return {
    kind: "lightbox",
    coveR: 0,
    coveBase: H,
    wellX,
    wellZ0,
    wellZ1,
    yCeil: H,
    yGlass: H + 0.16,
    bays,
    beamW: 0,
    beamDepth: 0,
    panes: [1, 1],
    z0,
    z1,
  };
}

/** One ceiling (laylight well or lightbox) per room of the suite, entrance first. */
export function ceilingSpecs(layout: GalleryLayout, theme: GalleryTheme): CeilingSpec[] {
  return layout.rooms.map((r) =>
    roomCeilingSpec(2 * r.halfWidth, layout.wallHeight, r.z0, r.z1, theme, layout.trackInset),
  );
}

/** The entrance room's ceiling (the whole hall's, for a single room). */
export function ceilingSpec(layout: GalleryLayout, theme: GalleryTheme): CeilingSpec {
  return ceilingSpecs(layout, theme)[0];
}

/** The ceiling's underside above (x, z) of a room: the flat band, or lower in a cove (rods land on it). */
export function ceilingAt(spec: CeilingSpec, W: number, x: number, z: number): number {
  const r = spec.coveR;
  if (r <= 0 || spec.kind !== "vault") return spec.yCeil;
  const d = Math.min(W / 2 - Math.abs(x), z - spec.z0, spec.z1 - z);
  if (d >= r) return spec.yCeil;
  return spec.coveBase + Math.sqrt(Math.max(0, r * r - (r - Math.max(0, d)) ** 2));
}

/** The emissive glass (laylight panes / lightbox diffuser), one quad per bay. */
export function buildGlass(specs: CeilingSpec | CeilingSpec[]): THREE.BufferGeometry {
  const b = new GeoBatch();
  for (const spec of Array.isArray(specs) ? specs : [specs]) {
    const halfBeam = spec.beamW / 2;
    spec.bays.forEach((bay, i) => {
      const z0 = bay.z0 + (i === 0 ? 0 : halfBeam);
      const z1 = bay.z1 - (i === spec.bays.length - 1 ? 0 : halfBeam);
      const g = new THREE.BufferGeometry();
      const x0 = -spec.wellX;
      const x1 = spec.wellX;
      const y = spec.yGlass;
      g.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], 3)
      );
      g.setAttribute("normal", new THREE.Float32BufferAttribute([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      // (x0,z0)→(x1,z0)→(x1,z1): +x × +z = -y, so the quad faces down
      g.setIndex([0, 1, 2, 0, 2, 3]);
      b.add(g);
    });
  }
  return b.build();
}

// --------------------------------------------------------------------- hall

export interface HallGeometry {
  walls: THREE.BufferGeometry;
  ceiling: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  /** Lighting track, suspension rods and canopies (layer 1). */
  track: THREE.BufferGeometry;
  /** The seating (furniture.ts): upholstery, frame, and the gilt / brass / chrome accents. */
  benchSeat: THREE.BufferGeometry;
  benchFrame: THREE.BufferGeometry;
  benchAccent: THREE.BufferGeometry;
  /** Soft contact shadows under the seats (custom attributes aLocal/aHalf). */
  benchShadow: THREE.BufferGeometry;
  /** Gilding: a vault's ribs and cornice, the columns' bases and capitals. */
  gilt: THREE.BufferGeometry;
  /** A palace gallery's marble columns. */
  marble: THREE.BufferGeometry;
  /** The entrance room's ceiling. */
  spec: CeilingSpec;
  /** Every room's ceiling, entrance first. */
  specs: CeilingSpec[];
  /** Each merged geometry's index range per room (see setRoomWindow). */
  ranges: Record<HallPart, IndexRange[]>;
}

export const DOOR = ENTRANCE_DOOR;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Moulded door case on a wall face at z whose room side is `facing` (±1 in
 * z): architrave jambs with plinth blocks, a swept head and a small cornice
 * (classical), or a slim flat surround (modern).
 */
function doorCase(trim: GeoBatch, z: number, facing: 1 | -1, dw: number, dh: number, classical: boolean, cx = 0) {
  if (classical) {
    const inward = V(0, 0, facing);
    for (const s of [-1, 1]) {
      const x = cx + s * (dw + 0.065);
      trim.roundedBox(0.13, dh + 0.065, 0.03, x, (dh + 0.065) / 2, z + facing * 0.015, 0.008, 2);
      trim.roundedBox(0.04, dh + 0.06, 0.018, cx + s * (dw + 0.11), (dh + 0.06) / 2, z + facing * 0.035, 0.008, 2);
      trim.roundedBox(0.16, 0.26, 0.045, x, 0.13, z + facing * 0.0225, 0.006, 1); // plinth block
    }
    trim.sweep(ARCHITRAVE, V(cx - dw - 0.135, dh, z), V(cx + dw + 0.135, dh, z), inward);
    // cornice over the door
    trim.roundedBox(2 * dw + 0.5, 0.07, 0.09, cx, dh + 0.17, z + facing * 0.045, 0.012, 2);
    trim.roundedBox(2 * dw + 0.36, 0.035, 0.06, cx, dh + 0.12, z + facing * 0.03, 0.008, 1);
  } else {
    // flush steel-framed opening: a slim frame
    for (const s of [-1, 1]) {
      trim.box(0.04, dh, 0.012, cx + s * (dw + 0.02), dh / 2, z + facing * 0.006);
    }
    trim.box(2 * dw + 0.08, 0.04, 0.012, cx, dh + 0.02, z + facing * 0.006);
  }
}

/**
 * A closed pair of door leaves standing on a wall face at z (the room on its +z side), centred at x = cx, cased
 * like the entrance doors: an artist's gallery's doors to the artists before and after (layout.exits).
 */
function exitDoor(trim: GeoBatch, cx: number, z: number, dw: number, dh: number, classical: boolean) {
  const leafW = dw - 0.004;
  const zLeaf = z + 0.03;
  for (const t of [-1, 1]) {
    const x = cx + t * (leafW / 2 + 0.002);
    trim.roundedBox(leafW, dh - 0.01, 0.05, x, dh / 2, zLeaf, 0.004, 1);
    if (classical) {
      const pw = leafW - 0.16;
      const upper = (dh - 0.38) * 0.62;
      const lower = dh - 0.38 - upper;
      trim.roundedBox(pw, upper, 0.02, x, dh - 0.12 - upper / 2, zLeaf + 0.03, 0.006, 1);
      trim.roundedBox(pw, lower, 0.02, x, 0.14 + lower / 2, zLeaf + 0.03, 0.006, 1);
      trim.roundedBox(0.03, 0.26, 0.035, cx + t * 0.07, 1.05, zLeaf + 0.045, 0.01, 1);
    } else {
      trim.roundedBox(0.022, 0.6, 0.04, cx + t * 0.06, 1.05, zLeaf + 0.045, 0.008, 1);
    }
  }
  if (classical) {
    for (const t of [-1, 1]) {
      const x = cx + t * (dw + 0.065);
      trim.roundedBox(0.13, dh + 0.065, 0.06, x, (dh + 0.065) / 2, z + 0.03, 0.008, 2);
      trim.roundedBox(0.16, 0.26, 0.075, x, 0.13, z + 0.0375, 0.006, 1); // plinth block
    }
    trim.roundedBox(2 * dw + 0.26, 0.1, 0.06, cx, dh + 0.05, z + 0.03, 0.008, 2);
    trim.roundedBox(2 * dw + 0.5, 0.07, 0.11, cx, dh + 0.17, z + 0.055, 0.012, 2);
  } else {
    for (const t of [-1, 1]) trim.box(0.04, dh, 0.07, cx + t * (dw + 0.02), dh / 2, z + 0.035);
    trim.box(2 * dw + 0.08, 0.04, 0.07, cx, dh + 0.02, z + 0.035);
  }
}

/** Height of the picture rail's centre (when the theme has one): below the cove's springing. */
export function pictureRailY(coveBase: number): number {
  return coveBase - 0.32;
}

/** One room's share of every merged architecture geometry, by material. */
export const HALL_PARTS = ["walls", "ceiling", "trim", "track", "benchSeat", "benchFrame", "benchAccent", "benchShadow", "gilt", "marble"] as const;
export type HallPart = (typeof HALL_PARTS)[number];

/** A run of indices in a merged geometry (for setDrawRange). */
export interface IndexRange {
  start: number;
  count: number;
}

/**
 * Concatenate per-room batches into one geometry per material, room after
 * room, so any run of consecutive rooms is one contiguous index range: a
 * long suite draws only the rooms near the visitor with a draw range, at no
 * extra draw call.
 */
function mergeRooms(batches: GeoBatch[]): { geometry: THREE.BufferGeometry; ranges: IndexRange[] } {
  const built = batches.map((b) => b.build());
  if (built.length === 1) {
    const g = built[0];
    return { geometry: g, ranges: [{ start: 0, count: g.index ? g.index.count : 0 }] };
  }
  const ranges: IndexRange[] = [];
  let start = 0;
  const parts: THREE.BufferGeometry[] = [];
  for (const g of built) {
    const count = g.index ? g.index.count : 0;
    ranges.push({ start, count });
    start += count;
    if (count) parts.push(g);
  }
  const merged = parts.length ? mergeGeometries(parts, false) : new GeoBatch().build();
  built.forEach((g) => g.dispose());
  if (!merged) throw new Error("room-geometry: room merge failed");
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return { geometry: merged, ranges };
}

/**
 * Show only rooms lo..hi of a merged hall geometry (all of it for null).
 */
export function setRoomWindow(
  geometry: THREE.BufferGeometry,
  ranges: IndexRange[],
  window: [number, number] | null
): void {
  if (!window || ranges.length <= 1) {
    geometry.setDrawRange(0, Infinity);
    return;
  }
  const lo = Math.max(0, Math.min(ranges.length - 1, window[0]));
  const hi = Math.max(lo, Math.min(ranges.length - 1, window[1]));
  const start = ranges[lo].start;
  geometry.setDrawRange(start, ranges[hi].start + ranges[hi].count - start);
}

export function buildHall(layout: GalleryLayout, theme: GalleryTheme): HallGeometry {
  const { hallLength: L, wallHeight: H } = layout;
  // each room its own width; the entrance wall is the first room's, the far end wall the last's
  const half = (ri: number) => layout.rooms[ri]?.halfWidth ?? layout.hallWidth / 2;
  const specs = ceilingSpecs(layout, theme);
  const spec = specs[0];
  const classical = theme.room.classical;
  const last = layout.rooms.length - 1;
  // Share untransformed rounded shapes while this hall is built, then release them.
  const roundedBoxes = new Map<string, THREE.BufferGeometry>();
  // every part goes into the batch of the room it belongs to
  const rooms = layout.rooms.map(() => ({
    walls: new GeoBatch(roundedBoxes),
    ceiling: new GeoBatch(roundedBoxes),
    trim: new GeoBatch(roundedBoxes),
    track: new GeoBatch(roundedBoxes),
    seat: new GeoBatch(roundedBoxes, true),
    frame: new GeoBatch(roundedBoxes, true),
    accent: new GeoBatch(roundedBoxes, true),
    gilt: new GeoBatch(roundedBoxes),
    marble: new GeoBatch(roundedBoxes),
  }));
  const at = (r: number) => rooms[Math.max(0, Math.min(last, r))];

  // ---- walls (room-facing planes only; UVs in metres, continuous down the suite)
  // Each room has its own stretch of the side walls; the cross walls stand
  // between them.
  layout.rooms.forEach((room, ri) => {
    const { walls } = rooms[ri];
    const hw = room.halfWidth;
    // left wall (x = -hw), faces +x: edgeU along -z?  need U×V = +x → U = +z? (+z × +y = -x) so U = -z
    walls.quad(V(-hw, 0, room.z1), V(0, 0, -(room.z1 - room.z0)), V(0, H, 0), [L / 2 - room.z1, 0]);
    // right wall faces -x: U = +z  (+z × +y = -x ✓)
    walls.quad(V(hw, 0, room.z0), V(0, 0, room.z1 - room.z0), V(0, H, 0), [room.z0 + L / 2, 0]);
    // far wall (z = -L/2) faces +z: U = +x (+x × +y = +z ✓)
    if (ri === last) walls.quad(V(-hw, 0, -L / 2), V(2 * hw, 0, 0), V(0, H, 0));
  });
  // near wall (z = +L/2) faces -z: U = -x, with the door opening
  {
    const W = 2 * half(0);
    const { walls } = rooms[0];
    const dw = DOOR.width / 2;
    const dh = DOOR.height;
    walls.quad(V(W / 2, 0, L / 2), V(-(W / 2 - dw), 0, 0), V(0, H, 0)); // right of door (seen from inside: left)
    const lift = layout.elevator;
    if (!lift) walls.quad(V(-dw, 0, L / 2), V(-(W / 2 - dw), 0, 0), V(0, H, 0), [W / 2 + dw, 0]);
    else {
      // the elevator's opening (Elevator.tsx lines it and builds the car behind it): U = W/2 - x
      const e1 = lift.x + lift.halfWidth;
      const e0 = lift.x - lift.halfWidth;
      walls.quad(V(-dw, 0, L / 2), V(e1 + dw, 0, 0), V(0, H, 0), [W / 2 + dw, 0]);
      walls.quad(V(e1, lift.height, L / 2), V(e0 - e1, 0, 0), V(0, H - lift.height, 0), [W / 2 - e1, lift.height]);
      walls.quad(V(e0, 0, L / 2), V(-W / 2 - e0, 0, 0), V(0, H, 0), [W / 2 - e0, 0]);
    }
    walls.quad(V(dw, dh, L / 2), V(-2 * dw, 0, 0), V(0, H - dh, 0), [W / 2 - dw, dh]);
    // reveals (jambs + head) through the wall thickness
    const D = DOOR.depth;
    walls.quad(V(-dw, 0, L / 2 + D), V(0, 0, -D), V(0, dh, 0)); // left jamb faces +x
    walls.quad(V(dw, 0, L / 2), V(0, 0, D), V(0, dh, 0)); // right jamb faces -x
    walls.quad(V(-dw, dh, L / 2), V(2 * dw, 0, 0), V(0, 0, D)); // head faces -y
  }

  // ---- doors: a pair of leaves set in the reveal
  {
    const { trim } = rooms[0];
    const dw = DOOR.width / 2;
    const dh = DOOR.height;
    const zLeaf = L / 2 + DOOR.depth * 0.55;
    const leafW = dw - 0.004;
    for (const s of [-1, 1]) {
      const cx = s * (leafW / 2 + 0.002);
      trim.roundedBox(leafW, dh - 0.01, 0.05, cx, dh / 2, zLeaf, 0.004, 1);
      if (classical) {
        // raised and fielded panels: tall upper, short lower
        const pw = leafW - 0.2;
        trim.roundedBox(pw, 1.55, 0.02, cx, dh - 0.12 - 0.775, zLeaf - 0.03, 0.006, 1);
        trim.roundedBox(pw, 0.85, 0.02, cx, 0.14 + 0.425, zLeaf - 0.03, 0.006, 1);
        // brass-less simple pull
        trim.roundedBox(0.03, 0.28, 0.035, s * 0.07, 1.1, zLeaf - 0.045, 0.01, 1);
      } else {
        trim.roundedBox(0.022, 0.6, 0.04, s * 0.06, 1.1, zLeaf - 0.045, 0.008, 1);
      }
    }
    // moulded architrave round the opening (classical), or a slim frame
    doorCase(trim, L / 2, -1, dw, dh, classical);
  }

  // ---- an artist's gallery: doors to the artists before and after in the far end wall
  if (layout.exits) {
    const { x, halfWidth, height } = layout.exits;
    for (const s of [-1, 1]) exitDoor(rooms[last].trim, s * x, -L / 2, halfWidth, height, classical);
  }

  // ---- cross walls between the rooms of a suite: a doorway on the hall
  // axis, both faces cased, the reveals lined (classical) or plain (modern).
  // The face toward the entrance belongs to the room before, the other face
  // to the room after.
  layout.doorways.forEach((d, i) => {
    const before = at(i);
    const after = at(i + 1);
    const hw = d.halfWidth;
    const dh = d.height;
    // the opening's centre: on the axis, or to one side (an arch keeps to the axis)
    const cx = d.arch > 0 ? 0 : d.x;
    const hb = half(i); // the room before's half width: the +z face's reach
    const ha = half(i + 1); // and the room after's: the -z face's
    const zf = d.z + d.thickness / 2; // face toward the entrance (faces +z)
    const zb = d.z - d.thickness / 2; // face toward the far end (faces -z)
    // the jambs rise to the springing of an arch, or to a square head
    const js = dh - d.arch;
    // +z face: U = +x (u measured from the room before's left wall)
    before.walls.quad(V(-hb, 0, zf), V(cx - hw + hb, 0, 0), V(0, H, 0));
    before.walls.quad(V(cx + hw, 0, zf), V(hb - cx - hw, 0, 0), V(0, H, 0), [hb + cx + hw, 0]);
    if (d.arch > 0) before.walls.add(archSpandrel(hw, js, d.arch, H), new THREE.Matrix4().makeTranslation(cx, 0, zf));
    else before.walls.quad(V(cx - hw, dh, zf), V(2 * hw, 0, 0), V(0, H - dh, 0), [hb + cx - hw, dh]);
    // -z face: U = -x (u measured from the room after's right wall)
    after.walls.quad(V(ha, 0, zb), V(-(ha - cx - hw), 0, 0), V(0, H, 0));
    after.walls.quad(V(cx - hw, 0, zb), V(-(cx - hw + ha), 0, 0), V(0, H, 0), [ha - cx + hw, 0]);
    if (d.arch > 0) after.walls.add(archSpandrel(hw, js, d.arch, H), new THREE.Matrix4().makeRotationY(Math.PI).setPosition(cx, 0, zb));
    else after.walls.quad(V(cx + hw, dh, zb), V(-2 * hw, 0, 0), V(0, H - dh, 0), [ha - cx - hw, dh]);
    // reveals through the thickness
    const reveals = classical ? before.trim : before.walls;
    const T = d.thickness;
    reveals.quad(V(cx - hw, 0, zf), V(0, 0, -T), V(0, js, 0)); // left jamb faces +x
    reveals.quad(V(cx + hw, 0, zb), V(0, 0, T), V(0, js, 0)); // right jamb faces -x
    if (d.arch > 0) reveals.add(archSoffit(hw, js, d.arch, zb, zf));
    else reveals.quad(V(cx - hw, dh, zb), V(2 * hw, 0, 0), V(0, 0, T)); // soffit faces -y
    if (classical) {
      // a stone / oak threshold flush with the floor boards
      before.trim.box(2 * hw, 0.008, T + 0.06, cx, 0.004, d.z);
    }
    if (d.arch > 0) {
      archivolt(before.trim, before.gilt, d, zf, 1);
      archivolt(after.trim, after.gilt, d, zb, -1);
    } else {
      doorCase(before.trim, zf, 1, hw, dh, classical, cx);
      doorCase(after.trim, zb, -1, hw, dh, classical, cx);
    }
  });
  // ---- a palace gallery's columns, either side of each arch on both faces
  for (const c of columnsOf(layout)) {
    const d = layout.doorways.find((x) => Math.abs(x.z - c.z) < 1);
    if (!d) continue;
    const { marble, gilt, trim } = at(c.z > d.z ? layout.doorways.indexOf(d) : layout.doorways.indexOf(d) + 1);
    column(marble, gilt, trim, c.x, c.z, c.r, d.height - d.arch);
  }

  // ---- the flagship's freestanding screen (a long suite's first room)
  const screen = layout.screen;
  if (screen) {
    const { walls, trim } = rooms[0];
    const sh = screen.halfWidth;
    const sH = screen.height;
    const zf = screen.z + screen.thickness / 2;
    const zb = screen.z - screen.thickness / 2;
    walls.quad(V(-sh, 0, zf), V(2 * sh, 0, 0), V(0, sH, 0)); // front faces +z
    walls.quad(V(sh, 0, zb), V(-2 * sh, 0, 0), V(0, sH, 0)); // back faces -z
    walls.quad(V(-sh, 0, zb), V(0, 0, screen.thickness), V(0, sH, 0)); // end faces -x
    walls.quad(V(sh, 0, zf), V(0, 0, -screen.thickness), V(0, sH, 0)); // end faces +x
    walls.quad(V(-sh, sH, zb), V(0, 0, screen.thickness), V(2 * sh, 0, 0)); // top faces +y
    // a capping moulding, and a plinth / shadow-gap base
    trim.roundedBox(2 * sh + 0.05, 0.045, screen.thickness + 0.05, 0, sH + 0.0225, screen.z, 0.01, 2);
    if (classical) {
      for (const [a, b, n] of [
        [V(-sh, 0, zf), V(sh, 0, zf), V(0, 0, 1)],
        [V(sh, 0, zb), V(-sh, 0, zb), V(0, 0, -1)],
        [V(-sh, 0, zb), V(-sh, 0, zf), V(-1, 0, 0)],
        [V(sh, 0, zf), V(sh, 0, zb), V(1, 0, 0)],
      ] as const) {
        trim.sweep(SKIRTING, a, b, n);
      }
    }
  }

  // ---- the films' free-standing wall: its face toward the room (the works hang there), its back toward the
  // films' corner, its open end and its top; a capping moulding, and a skirting round it (classical)
  const nook = layout.nook;
  if (nook) {
    const { walls, trim } = at(nook.room);
    const { face: xf, thickness: t, z0, z1, height: h } = nook.wall;
    const xb = xf - t;
    walls.quad(V(xf, 0, z1), V(0, 0, -(z1 - z0)), V(0, h, 0), [L / 2 - z1, 0]); // face: +x
    walls.quad(V(xb, 0, z0), V(0, 0, z1 - z0), V(0, h, 0), [z0 + L / 2, 0]); // back: -x
    walls.quad(V(xf, 0, z0), V(-t, 0, 0), V(0, h, 0)); // open end: -z
    walls.quad(V(xb, h, z0), V(0, 0, z1 - z0), V(t, 0, 0)); // top: +y
    trim.roundedBox(t + 0.05, 0.045, z1 - z0 + 0.025, xf - t / 2, h + 0.0225, (z0 + z1) / 2 - 0.0125, 0.01, 2);
    if (classical) {
      trim.sweep(SKIRTING, V(xf, 0, z0), V(xf, 0, z1), V(1, 0, 0));
      trim.sweep(SKIRTING, V(xb, 0, z0), V(xb, 0, z1), V(-1, 0, 0));
      trim.sweep(SKIRTING, V(xb, 0, z0), V(xf, 0, z0), V(0, 0, -1));
    }
  }

  // ---- skirting / picture rail, room by room
  type Run = { a: THREE.Vector3; b: THREE.Vector3; n: THREE.Vector3 };
  // side walls (and the far end wall) of each room
  const runsOf = (ri: number): Run[] => {
    const { z0, z1, halfWidth: hw } = layout.rooms[ri];
    const out: Run[] = [
      { a: V(-hw, 0, z0), b: V(-hw, 0, z1), n: V(1, 0, 0) },
      { a: V(hw, 0, z0), b: V(hw, 0, z1), n: V(-1, 0, 0) },
    ];
    if (ri === last) out.push({ a: V(-hw, 0, -L / 2), b: V(hw, 0, -L / 2), n: V(0, 0, 1) });
    return out;
  };
  const lift = layout.elevator;
  const W = 2 * half(0); // the entrance wall's
  const nearRuns: Run[] = [
    ...(lift
      ? [
          { a: V(-W / 2, 0, L / 2), b: V(lift.x - lift.halfWidth - 0.1, 0, L / 2), n: V(0, 0, -1) },
          { a: V(lift.x + lift.halfWidth + 0.1, 0, L / 2), b: V(-DOOR.width / 2 - 0.2, 0, L / 2), n: V(0, 0, -1) },
        ]
      : [{ a: V(-W / 2, 0, L / 2), b: V(-DOOR.width / 2 - 0.2, 0, L / 2), n: V(0, 0, -1) }]),
    { a: V(DOOR.width / 2 + 0.2, 0, L / 2), b: V(W / 2, 0, L / 2), n: V(0, 0, -1) },
  ];
  const nearFull: Run = { a: V(-W / 2, 0, L / 2), b: V(W / 2, 0, L / 2), n: V(0, 0, -1) };
  // the skirting stops at the far wall's doors (an artist's gallery)
  const skirtingRuns = (ri: number): Run[] => {
    const runs = runsOf(ri);
    const ex = layout.exits;
    if (ri !== last || !ex) return runs;
    const edge = ex.halfWidth + 0.15;
    const z = -L / 2;
    const n = V(0, 0, 1);
    const hl = half(last);
    return [
      ...runs.slice(0, -1),
      { a: V(-hl, 0, z), b: V(-ex.x - edge, 0, z), n },
      { a: V(-ex.x + edge, 0, z), b: V(ex.x - edge, 0, z), n },
      { a: V(ex.x + edge, 0, z), b: V(hl, 0, z), n },
    ];
  };
  // the cross-wall faces each room has: full width (cornice, picture rail)
  // and either side of the doorway (skirting)
  const crossFaces = (ri: number): { full: Run[]; split: Run[] } => {
    const full: Run[] = [];
    const split: Run[] = [];
    const faces: [number, number, 1 | -1][] = [];
    if (ri < last) faces.push([ri, layout.doorways[ri].z + layout.doorways[ri].thickness / 2, 1]);
    if (ri > 0) faces.push([ri - 1, layout.doorways[ri - 1].z - layout.doorways[ri - 1].thickness / 2, -1]);
    const hw = half(ri);
    for (const [di, z, n] of faces) {
      const d = layout.doorways[di];
      const cx = d.arch > 0 ? 0 : d.x;
      full.push({ a: V(-hw, 0, z), b: V(hw, 0, z), n: V(0, 0, n) });
      const edge = d.halfWidth + (classical ? 0.2 : 0.06);
      split.push(
        { a: V(-hw, 0, z), b: V(cx - edge, 0, z), n: V(0, 0, n) },
        { a: V(cx + edge, 0, z), b: V(hw, 0, z), n: V(0, 0, n) }
      );
    }
    return { full, split };
  };
  layout.rooms.forEach((_, ri) => {
    const { trim } = rooms[ri];
    const cross = crossFaces(ri);
    if (classical) {
      for (const q of [...skirtingRuns(ri), ...(ri === 0 ? nearRuns : []), ...cross.split]) {
        trim.sweep(SKIRTING, q.a, q.b, q.n);
      }
    }
    if (theme.room.pictureRail) {
      const y = pictureRailY(specs[ri].coveBase);
      for (const q of [...runsOf(ri), ...(ri === 0 ? [nearFull] : []), ...cross.full]) {
        trim.sweep(PICTURE_RAIL, q.a.clone().setY(y), q.b.clone().setY(y), q.n);
      }
    }
  });

  // ---- ceiling: each room's cornice cove (a vault's deep coves) and a small bed moulding at its foot
  layout.rooms.forEach((_, ri) => {
    const sp = specs[ri];
    const r = sp.coveR;
    if (r <= 0) return;
    const b = sp.coveBase;
    const cove = coveProfile(r, b, sp.kind === "vault" ? 16 : 8);
    const bed: [number, number][] = [
      [0.0, b - 0.07],
      [0.025, b - 0.07],
      [0.032, b - 0.055],
      [0.032, b - 0.035],
      [0.045, b - 0.02],
      [0.045, b],
      [0.0, b + 0.001],
    ];
    const { ceiling, trim, gilt } = rooms[ri];
    const runs = [...runsOf(ri), ...(ri === 0 ? [nearFull] : []), ...crossFaces(ri).full];
    for (const q of runs) {
      ceiling.sweep(cove, q.a, q.b, q.n, 50);
      if (sp.kind === "vault") {
        // a deep cornice at the springing, a gilt bead along it
        trim.sweep(VAULT_CORNICE.map(([dd, hh]) => [dd, b + hh] as [number, number]), q.a, q.b, q.n);
        if (theme.room.gilt) gilt.sweep(GILT_BEAD.map(([dd, hh]) => [dd, b - 0.2 + hh] as [number, number]), q.a, q.b, q.n);
      } else ceiling.sweep(bed, q.a, q.b, q.n);
    }
    if (sp.kind === "vault" && theme.room.gilt) vaultRibs(gilt, sp, 2 * half(ri));
  });
  specs.forEach((sp, ri) => {
    const { ceiling, trim, gilt } = at(ri);
    const r = sp.coveR;
    const yC = sp.yCeil;
    // flat band around the opening (faces down)
    const x0 = -half(ri) + r;
    const x1 = half(ri) - r;
    const z0 = sp.z0 + r;
    const z1 = sp.z1 - r;
    const wx = sp.wellX;
    const face = (ax: number, bx: number, az: number, bz: number) => {
      if (bx - ax < 1e-4 || bz - az < 1e-4) return;
      // U = +x, V = -z?  (+x × -z = +y) → we need -y: U = +z, V = +x (+z × +x = +y)… use U=+x, V=+z: +x × +z = -y ✓
      ceiling.quad(V(ax, yC, az), V(bx - ax, 0, 0), V(0, 0, bz - az), [ax, az]);
    };
    face(x0, -wx, z0, z1);
    face(wx, x1, z0, z1);
    face(-wx, wx, z0, sp.wellZ0);
    face(-wx, wx, sp.wellZ1, z1);
    // well sides (vertical, facing into the well)
    const dy = sp.yGlass - yC;
    ceiling.quad(V(-wx, yC, sp.wellZ1), V(0, 0, sp.wellZ0 - sp.wellZ1), V(0, dy, 0)); // faces +x
    ceiling.quad(V(wx, yC, sp.wellZ0), V(0, 0, sp.wellZ1 - sp.wellZ0), V(0, dy, 0)); // faces -x
    ceiling.quad(V(-wx, yC, sp.wellZ0), V(2 * wx, 0, 0), V(0, dy, 0)); // faces +z
    ceiling.quad(V(wx, yC, sp.wellZ1), V(-2 * wx, 0, 0), V(0, dy, 0)); // faces -z
    if (sp.kind === "laylight" || sp.kind === "vault") {
      // moulded soffit frame round the opening (gilt in a vault)
      const fw = 0.12;
      const fd = 0.07;
      const lenZ = sp.wellZ1 - sp.wellZ0 + 2 * fw;
      const frame = sp.kind === "vault" && theme.room.gilt ? gilt : ceiling;
      for (const s of [-1, 1]) {
        frame.roundedBox(fw, fd, lenZ, s * (wx + fw / 2), yC - fd / 2 + 0.002, (sp.wellZ0 + sp.wellZ1) / 2, 0.012, 2);
        frame.roundedBox(2 * wx, fd, fw, 0, yC - fd / 2 + 0.002, s < 0 ? sp.wellZ0 - fw / 2 : sp.wellZ1 + fw / 2, 0.012, 2);
      }
      // beams between the bays, spanning the well
      for (let i = 1; i < sp.bays.length; i++) {
        const z = sp.bays[i].z0;
        ceiling.roundedBox(2 * wx, sp.beamDepth, sp.beamW, 0, sp.yGlass - sp.beamDepth / 2, z, 0.02, 2);
      }
    } else {
      // slim aluminium-look reveal round the diffuser
      for (const s of [-1, 1]) {
        trim.box(0.025, 0.012, sp.wellZ1 - sp.wellZ0, s * (wx + 0.0125), yC - 0.006, (sp.wellZ0 + sp.wellZ1) / 2);
        trim.box(2 * wx + 0.05, 0.012, 0.025, 0, yC - 0.006, s < 0 ? sp.wellZ0 - 0.0125 : sp.wellZ1 + 0.0125);
      }
    }
  });

  // ---- lighting track per room (rails + suspension rods + canopies): side
  // rails, and a cross rail in front of each room's far wall (and in front
  // of the flagship's screen)
  specs.forEach((sp, ri) => {
    const { track } = at(ri);
    const yR = H - TRACK_DROP;
    const W = 2 * half(ri);
    const railX = W / 2 - layout.trackInset;
    const zCross = sp.z0 + layout.trackInset;
    const zEnd = sp.z1 - 0.9;
    const RW = 0.034; // rail width
    const RH = 0.026; // rail height
    const rod = (x: number, z: number) => {
      const top = ceilingAt(sp, W, x, z); // the rods land on the ceiling band, or on a vault's cove
      const h = top - (yR + RH / 2);
      track.cylinder(0.0045, 0.0045, h, x, yR + RH / 2, z, 6);
      track.cylinder(0.032, 0.032, 0.014, x, top - 0.014, z, 16); // canopy
      track.cylinder(0.009, 0.012, 0.03, x, yR + RH / 2, z, 8); // clamp
    };
    // a side rail from z0 to z1, its rods spaced along it
    const sideRail = (x: number, z0: number, z1: number) => {
      if (z1 - z0 < 1) return;
      track.roundedBox(RW, RH, z1 - z0 + RW, x, yR, (z0 + z1) / 2, 0.004, 1);
      const len = z1 - z0;
      const n = Math.max(2, Math.ceil(len / 2.4));
      for (let i = 0; i <= n; i++) rod(x, z0 + 0.25 + ((len - 0.5) * i) / n);
    };
    const films = layout.nook?.room === ri ? layout.nook : null;
    sideRail(railX, zCross, zEnd);
    if (films) {
      // the left rail stops short of the films' corner; another lights the free-standing wall's works
      sideRail(-railX, zCross, Math.min(zEnd, films.wall.z0 - 0.4));
      sideRail(films.wall.face + layout.trackInset, Math.max(zCross, films.wall.z0 - 0.2), zEnd);
    } else sideRail(-railX, zCross, zEnd);
    track.roundedBox(2 * railX + RW, RH, RW, 0, yR, zCross, 0.004, 1);
    const nCross = Math.max(1, Math.ceil((2 * railX) / 2.4));
    for (let i = 1; i < nCross; i++) rod(-railX + (2 * railX * i) / nCross, zCross);
    if (ri === 0 && screen) {
      const zs = screen.z + screen.thickness / 2 + layout.trackInset;
      track.roundedBox(2 * railX + RW, RH, RW, 0, yR, zs, 0.004, 1);
      for (let i = 1; i < nCross; i++) rod(-railX + (2 * railX * i) / nCross, zs);
    }
  });

  // ---- rope barriers before the most famous works: brass posts, a velvet rope sagging between them
  const rope = new THREE.Color("#6e1418");
  for (const b of layout.barriers) {
    const { gilt, seat } = at(b.room);
    b.posts.forEach(([x, z], i) => {
      gilt.cylinder(0.16, 0.17, 0.035, x, 0, z, 24);
      gilt.cylinder(0.02, 0.026, 0.9, x, 0.035, z, 12);
      gilt.add(new THREE.SphereGeometry(0.04, 12, 8), new THREE.Matrix4().makeTranslation(x, 0.95, z));
      const next = b.posts[i + 1];
      if (!next) return;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        pts.push(new THREE.Vector3(x + (next[0] - x) * t, 0.9 - 0.16 * 4 * t * (1 - t), z + (next[1] - z) * t));
      }
      seat.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.018, 6, false), undefined, rope);
    });
  }

  // ---- seating: the room style's furniture (furniture.ts), as the layout arranged it room by room
  const furniture = furnitureOf(theme);
  const seats = [...layout.furniture].sort((a, b) => a.room - b.room);
  const shadow = buildBenchShadows(seats);
  for (const f of seats) {
    const { seat: up, frame: wood, accent: metal } = at(f.room);
    buildFurnishing(furniture, { up, wood, metal }, f);
  }

  const walls = mergeRooms(rooms.map((x) => x.walls));
  const ceiling = mergeRooms(rooms.map((x) => x.ceiling));
  const trim = mergeRooms(rooms.map((x) => x.trim));
  const track = mergeRooms(rooms.map((x) => x.track));
  const seat = mergeRooms(rooms.map((x) => x.seat));
  const frame = mergeRooms(rooms.map((x) => x.frame));
  const accent = mergeRooms(rooms.map((x) => x.accent));
  const gilt = mergeRooms(rooms.map((x) => x.gilt));
  const marble = mergeRooms(rooms.map((x) => x.marble));
  // seat shadows: one quad (6 indices) per seat, seats in room order
  const shadowRanges: IndexRange[] = layout.rooms.map(() => ({ start: 0, count: 0 }));
  seats.forEach(({ room }, i) => {
    const rr = shadowRanges[room];
    if (rr.count === 0) rr.start = i * 6;
    rr.count += 6;
  });
  for (let i = 1; i < shadowRanges.length; i++) {
    // keep empty rooms' ranges in order for the contiguous window maths
    if (shadowRanges[i].count === 0) shadowRanges[i].start = shadowRanges[i - 1].start + shadowRanges[i - 1].count;
  }
  roundedBoxes.forEach((g) => g.dispose());
  return {
    walls: walls.geometry,
    ceiling: ceiling.geometry,
    trim: trim.geometry,
    track: track.geometry,
    benchSeat: seat.geometry,
    benchFrame: frame.geometry,
    benchAccent: accent.geometry,
    benchShadow: shadow,
    gilt: gilt.geometry,
    marble: marble.geometry,
    spec,
    specs,
    ranges: {
      walls: walls.ranges,
      ceiling: ceiling.ranges,
      trim: trim.ranges,
      track: track.ranges,
      benchSeat: seat.ranges,
      benchFrame: frame.ranges,
      benchAccent: accent.ranges,
      benchShadow: shadowRanges,
      gilt: gilt.ranges,
      marble: marble.ranges,
    },
  };
}

/** One floor quad per piece (turned with it) carrying its local coordinates for an SDF blob. */
function buildBenchShadows(pieces: Furnishing[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const loc: number[] = [];
  const half: number[] = [];
  const idx: number[] = [];
  const PAD = 0.45;
  for (const b of pieces) {
    const [bx, bz] = b.position;
    // a chair's blob a little inside its footprint (its legs, not its arms' reach)
    const k = b.kind === "chair" ? 0.42 : 0.5;
    const hw = b.size[0] * k;
    const hd = b.size[1] * k;
    const c = Math.cos(b.rotation);
    const sn = Math.sin(b.rotation);
    const base = pos.length / 3;
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const lx = sx * (hw + PAD);
      const lz = sz * (hd + PAD);
      // rotation about y: x' = x cos + z sin, z' = -x sin + z cos
      pos.push(bx + lx * c + lz * sn, 0.0015, bz - lx * sn + lz * c);
      loc.push(lx, lz);
      half.push(hw, hd);
    }
    // faces up: (-,-)→(+,-)→(+,+): (+x) × (+z) = -y → reverse
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aLocal", new THREE.Float32BufferAttribute(loc, 2));
  g.setAttribute("aHalf", new THREE.Float32BufferAttribute(half, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function disposeHall(h: HallGeometry) {
  for (const k of HALL_PARTS) h[k].dispose();
}

// ------------------------------------------------------------ palace parts

// a vault's cornice at the springing (d out from the wall, h above the top of the wall)
const VAULT_CORNICE: [number, number][] = [
  [0.0, -0.32],
  [0.03, -0.32],
  [0.03, -0.26],
  [0.06, -0.22],
  [0.06, -0.12],
  [0.1, -0.09],
  [0.14, -0.04],
  [0.18, 0.0],
  [0.18, 0.03],
  [0.0, 0.04],
];
// a gilt bead in the cornice
const GILT_BEAD: [number, number][] = [
  [0.0, -0.025],
  [0.05, -0.025],
  [0.07, -0.012],
  [0.072, 0.0],
  [0.07, 0.012],
  [0.05, 0.025],
  [0.0, 0.025],
];

/** The wall above an arch: from the springing (y0) to the top of the wall, less an elliptical head of half
 *  width hw and rise `rise`; facing +z at z = 0, UVs in metres. */
function archSpandrel(hw: number, y0: number, rise: number, H: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-hw, y0);
  const n = 24;
  for (let i = 1; i <= n; i++) {
    const t = Math.PI - (Math.PI * i) / n;
    shape.lineTo(hw * Math.cos(t), y0 + rise * Math.sin(t));
  }
  shape.lineTo(hw, H);
  shape.lineTo(-hw, H);
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 1);
}

/** The underside of an arch through the wall's thickness (zb..zf), facing in toward its centre. */
function archSoffit(hw: number, y0: number, rise: number, zb: number, zf: number): THREE.BufferGeometry {
  const n = 24;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let arc = 0;
  let prev: [number, number] | null = null;
  for (let i = 0; i <= n; i++) {
    const t = Math.PI - (Math.PI * i) / n;
    const x = hw * Math.cos(t);
    const y = y0 + rise * Math.sin(t);
    if (prev) arc += Math.hypot(x - prev[0], y - prev[1]);
    prev = [x, y];
    // inward: against the ellipse's gradient
    const nx = -Math.cos(t) / hw;
    const ny = -Math.sin(t) / rise;
    const l = Math.hypot(nx, ny) || 1;
    for (const z of [zf, zb]) {
      pos.push(x, y, z);
      nor.push(nx / l, ny / l, 0);
      uv.push(arc, z - zb);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      // (a: zf, a+1: zb) → (a+2: zf, a+3: zb); seen from below: wind toward the normal
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  // make the geometric normal agree with the shading normal
  const v = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const gn = new THREE.Vector3().crossVectors(v(1).sub(v(0)), v(2).sub(v(0)));
  if (gn.dot(new THREE.Vector3(nor[0], nor[1], nor[2])) < 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  }
  g.setIndex(idx);
  return g;
}

/** An arch's moulded surround on a face at z (facing ±z): a band round the head, a keystone, imposts at the
 *  springing; a gilt bead inside the band. */
function archivolt(trim: GeoBatch, gilt: GeoBatch, d: Doorway, z: number, facing: 1 | -1): void {
  const hw = d.halfWidth;
  const y0 = d.height - d.arch;
  const ring = (grow: number, out: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 32; i++) {
      const t = Math.PI - (Math.PI * i) / 32;
      pts.push(new THREE.Vector3((hw + grow) * Math.cos(t), y0 + (d.arch + grow) * Math.sin(t), z + facing * out));
    }
    return new THREE.CatmullRomCurve3(pts);
  };
  trim.add(new THREE.TubeGeometry(ring(0.1, 0.0), 48, 0.085, 8, false));
  gilt.add(new THREE.TubeGeometry(ring(0.03, 0.035), 48, 0.022, 6, false));
  // the keystone, and the imposts the arch springs from
  trim.roundedBox(0.34, 0.5, 0.12, 0, d.height + 0.12, z + facing * 0.04, 0.02, 2);
  for (const s of [-1, 1]) {
    trim.roundedBox(0.36, 0.16, 0.1, s * (hw + 0.1), y0 - 0.06, z + facing * 0.035, 0.02, 2);
    // pilaster strips down the jambs
    trim.roundedBox(0.2, y0 - 0.14, 0.04, s * (hw + 0.1), (y0 - 0.14) / 2, z + facing * 0.02, 0.01, 1);
  }
}

/** A column standing at (x, z) up to y1 (an arch's springing): a marble plinth and shaft, gilt base and
 *  capital, an impost block on top. */
function column(marble: GeoBatch, gilt: GeoBatch, trim: GeoBatch, x: number, z: number, r: number, y1: number): void {
  marble.roundedBox(2.7 * r, 0.22, 2.7 * r, x, 0.11, z, 0.015, 2);
  gilt.add(new THREE.TorusGeometry(r * 1.12, r * 0.14, 8, 28), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, 0.25, z));
  gilt.add(new THREE.TorusGeometry(r * 1.04, r * 0.1, 8, 28), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, 0.32, z));
  const capH = 0.46;
  const shaftTop = y1 - 0.12 - capH;
  marble.cylinder(r * 0.88, r, shaftTop - 0.34, x, 0.34, z, 28);
  gilt.add(new THREE.TorusGeometry(r * 0.92, r * 0.08, 8, 28), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, shaftTop + 0.02, z));
  // a Corinthian-ish capital: a flaring bell ringed with leaves, an abacus
  gilt.cylinder(r * 1.45, r * 0.9, capH - 0.08, x, shaftTop, z, 24);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    gilt.add(
      new THREE.SphereGeometry(r * 0.32, 8, 6),
      new THREE.Matrix4().compose(
        new THREE.Vector3(x + Math.cos(a) * r * 1.02, shaftTop + capH * 0.3, z + Math.sin(a) * r * 1.02),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 1.6, 1)
      )
    );
  }
  gilt.roundedBox(3.2 * r, 0.08, 3.2 * r, x, shaftTop + capH - 0.04, z, 0.01, 1);
  trim.roundedBox(3.3 * r, 0.12, 3.3 * r, x, y1 - 0.06, z, 0.015, 2);
}

/** A vault's coffering in gilt: ribs across each cove, a ring at mid-height, ribs up the corners' groins. */
function vaultRibs(gilt: GeoBatch, sp: CeilingSpec, W: number): void {
  const r = sp.coveR;
  const b = sp.coveBase;
  const R = r - 0.02;
  const rod = (pts: THREE.Vector3[], rad: number) => gilt.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, rad, 6, false));
  const arc = (at: (t: number) => THREE.Vector3) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) pts.push(at((i / 10) * (Math.PI / 2)));
    rod(pts, 0.03);
  };
  const xIn = W / 2 - r;
  // ribs across the side coves, between the corners
  const zA = sp.z0 + r;
  const zB = sp.z1 - r;
  const nz = Math.max(1, Math.round((zB - zA) / 1.5));
  for (let i = 0; i <= nz; i++) {
    const z = zA + ((zB - zA) * i) / nz;
    for (const s of [-1, 1]) arc((t) => new THREE.Vector3(s * (xIn + R * Math.cos(t)), b + R * Math.sin(t), z));
  }
  // and across the end coves
  const nx = Math.max(1, Math.round((2 * xIn) / 1.5));
  for (let i = 0; i <= nx; i++) {
    const x = -xIn + (2 * xIn * i) / nx;
    arc((t) => new THREE.Vector3(x, b + R * Math.sin(t), sp.z0 + r - R * Math.cos(t)));
    arc((t) => new THREE.Vector3(x, b + R * Math.sin(t), sp.z1 - r + R * Math.cos(t)));
  }
  // the groins: where the coves meet in the corners
  for (const sx of [-1, 1])
    for (const [zw, sz] of [[sp.z0, 1], [sp.z1, -1]] as const) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const dd = (r * i) / 12;
        const y = b + Math.sqrt(Math.max(0, R * R - (R - dd) ** 2));
        pts.push(new THREE.Vector3(sx * (W / 2 - dd), y, zw + sz * dd));
      }
      rod(pts, 0.04);
    }
  // a ring round the vault at mid-height: the contour, inset the same from every wall
  for (const t of [Math.PI / 4, (Math.PI * 5) / 12]) {
    const dd = r - R * Math.cos(t);
    const y = b + R * Math.sin(t);
    const pts = [
      new THREE.Vector3(-W / 2 + dd, y, sp.z0 + dd),
      new THREE.Vector3(W / 2 - dd, y, sp.z0 + dd),
      new THREE.Vector3(W / 2 - dd, y, sp.z1 - dd),
      new THREE.Vector3(-W / 2 + dd, y, sp.z1 - dd),
    ];
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % 4];
      const len = a.distanceTo(c);
      const g = new THREE.CylinderGeometry(0.022, 0.022, len, 6, 1);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, c.clone().sub(a).normalize());
      gilt.add(g, new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    }
  }
}
