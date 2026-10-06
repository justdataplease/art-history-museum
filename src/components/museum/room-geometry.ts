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
import { roomAt, TRACK_DROP, TRACK_INSET, type GalleryLayout } from "./layout";
import type { GalleryTheme } from "./theme";

const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ batching

export class GeoBatch {
  private parts: THREE.BufferGeometry[] = [];

  /** Add a geometry (consumed), optionally transformed into world space. */
  add(g: THREE.BufferGeometry, m?: THREE.Matrix4): this {
    if (m) g.applyMatrix4(m);
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    }
    const count = g.attributes.position.count;
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
    return this.add(new RoundedBoxGeometry(w, h, d, segments, r), xform(x, y, z, rotY));
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
    roomCeilingSpec(layout.hallWidth, layout.wallHeight, r.z0, r.z1, theme, layout.trackInset),
  );
}

/** The entrance room's ceiling (the whole hall's, for a single room). */
export function ceilingSpec(layout: GalleryLayout, theme: GalleryTheme): CeilingSpec {
  return ceilingSpecs(layout, theme)[0];
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
  benchSeat: THREE.BufferGeometry;
  benchFrame: THREE.BufferGeometry;
  /** Soft contact shadows under the benches (custom attributes aLocal/aHalf). */
  benchShadow: THREE.BufferGeometry;
  /** The entrance room's ceiling. */
  spec: CeilingSpec;
  /** Every room's ceiling, entrance first. */
  specs: CeilingSpec[];
  /** Each merged geometry's index range per room (see setRoomWindow). */
  ranges: Record<HallPart, IndexRange[]>;
}

export const DOOR = { width: 1.9, height: 3.05, depth: 0.32 };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Moulded door case on a wall face at z whose room side is `facing` (±1 in
 * z): architrave jambs with plinth blocks, a swept head and a small cornice
 * (classical), or a slim flat surround (modern).
 */
function doorCase(trim: GeoBatch, z: number, facing: 1 | -1, dw: number, dh: number, classical: boolean) {
  if (classical) {
    const inward = V(0, 0, facing);
    for (const s of [-1, 1]) {
      const x = s * (dw + 0.065);
      trim.roundedBox(0.13, dh + 0.065, 0.03, x, (dh + 0.065) / 2, z + facing * 0.015, 0.008, 2);
      trim.roundedBox(0.04, dh + 0.06, 0.018, s * (dw + 0.11), (dh + 0.06) / 2, z + facing * 0.035, 0.008, 2);
      trim.roundedBox(0.16, 0.26, 0.045, x, 0.13, z + facing * 0.0225, 0.006, 1); // plinth block
    }
    trim.sweep(ARCHITRAVE, V(-dw - 0.135, dh, z), V(dw + 0.135, dh, z), inward);
    // cornice over the door
    trim.roundedBox(2 * dw + 0.5, 0.07, 0.09, 0, dh + 0.17, z + facing * 0.045, 0.012, 2);
    trim.roundedBox(2 * dw + 0.36, 0.035, 0.06, 0, dh + 0.12, z + facing * 0.03, 0.008, 1);
  } else {
    // flush steel-framed opening: a slim frame
    for (const s of [-1, 1]) {
      trim.box(0.04, dh, 0.012, s * (dw + 0.02), dh / 2, z + facing * 0.006);
    }
    trim.box(2 * dw + 0.08, 0.04, 0.012, 0, dh + 0.02, z + facing * 0.006);
  }
}

/** Top of a door case above the floor (its cornice / frame). */
export function doorCaseTop(dh: number, classical: boolean): number {
  return classical ? dh + 0.205 : dh + 0.04;
}

/** Height of the picture rail's centre (when the theme has one). */
export function pictureRailY(H: number, coveR: number): number {
  return H - coveR - 0.32;
}

/** One room's share of every merged architecture geometry, by material. */
export const HALL_PARTS = ["walls", "ceiling", "trim", "track", "benchSeat", "benchFrame", "benchShadow"] as const;
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
  const { hallWidth: W, hallLength: L, wallHeight: H } = layout;
  const specs = ceilingSpecs(layout, theme);
  const spec = specs[0];
  const classical = theme.room.classical;
  const last = layout.rooms.length - 1;
  // every part goes into the batch of the room it belongs to
  const rooms = layout.rooms.map(() => ({
    walls: new GeoBatch(),
    ceiling: new GeoBatch(),
    trim: new GeoBatch(),
    track: new GeoBatch(),
    seat: new GeoBatch(),
    frame: new GeoBatch(),
  }));
  const at = (r: number) => rooms[Math.max(0, Math.min(last, r))];

  // ---- walls (room-facing planes only; UVs in metres, continuous down the suite)
  // Each room has its own stretch of the side walls; the cross walls stand
  // between them.
  layout.rooms.forEach((room, ri) => {
    const { walls } = rooms[ri];
    // left wall (x = -W/2), faces +x: edgeU along -z?  need U×V = +x → U = +z? (+z × +y = -x) so U = -z
    walls.quad(V(-W / 2, 0, room.z1), V(0, 0, -(room.z1 - room.z0)), V(0, H, 0), [L / 2 - room.z1, 0]);
    // right wall faces -x: U = +z  (+z × +y = -x ✓)
    walls.quad(V(W / 2, 0, room.z0), V(0, 0, room.z1 - room.z0), V(0, H, 0), [room.z0 + L / 2, 0]);
    // far wall (z = -L/2) faces +z: U = +x (+x × +y = +z ✓)
    if (ri === last) walls.quad(V(-W / 2, 0, -L / 2), V(W, 0, 0), V(0, H, 0));
  });
  // near wall (z = +L/2) faces -z: U = -x, with the door opening
  {
    const { walls } = rooms[0];
    const dw = DOOR.width / 2;
    const dh = DOOR.height;
    walls.quad(V(W / 2, 0, L / 2), V(-(W / 2 - dw), 0, 0), V(0, H, 0)); // right of door (seen from inside: left)
    walls.quad(V(-dw, 0, L / 2), V(-(W / 2 - dw), 0, 0), V(0, H, 0), [W / 2 + dw, 0]);
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

  // ---- cross walls between the rooms of a suite: a doorway on the hall
  // axis, both faces cased, the reveals lined (classical) or plain (modern).
  // The face toward the entrance belongs to the room before, the other face
  // to the room after.
  layout.doorways.forEach((d, i) => {
    const before = at(i);
    const after = at(i + 1);
    const hw = d.halfWidth;
    const dh = d.height;
    const zf = d.z + d.thickness / 2; // face toward the entrance (faces +z)
    const zb = d.z - d.thickness / 2; // face toward the far end (faces -z)
    const side = W / 2 - hw;
    // +z face: U = +x
    before.walls.quad(V(-W / 2, 0, zf), V(side, 0, 0), V(0, H, 0));
    before.walls.quad(V(hw, 0, zf), V(side, 0, 0), V(0, H, 0), [W / 2 + hw, 0]);
    before.walls.quad(V(-hw, dh, zf), V(2 * hw, 0, 0), V(0, H - dh, 0), [W / 2 - hw, dh]);
    // -z face: U = -x
    after.walls.quad(V(W / 2, 0, zb), V(-side, 0, 0), V(0, H, 0));
    after.walls.quad(V(-hw, 0, zb), V(-side, 0, 0), V(0, H, 0), [W / 2 + hw, 0]);
    after.walls.quad(V(hw, dh, zb), V(-2 * hw, 0, 0), V(0, H - dh, 0), [W / 2 - hw, dh]);
    // reveals through the thickness
    const reveals = classical ? before.trim : before.walls;
    const T = d.thickness;
    reveals.quad(V(-hw, 0, zf), V(0, 0, -T), V(0, dh, 0)); // left jamb faces +x
    reveals.quad(V(hw, 0, zb), V(0, 0, T), V(0, dh, 0)); // right jamb faces -x
    reveals.quad(V(-hw, dh, zb), V(2 * hw, 0, 0), V(0, 0, T)); // soffit faces -y
    if (classical) {
      // a stone / oak threshold flush with the floor boards
      before.trim.box(2 * hw, 0.008, T + 0.06, 0, 0.004, d.z);
    }
    doorCase(before.trim, zf, 1, hw, dh, classical);
    doorCase(after.trim, zb, -1, hw, dh, classical);
  });

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

  // ---- skirting / picture rail, room by room
  type Run = { a: THREE.Vector3; b: THREE.Vector3; n: THREE.Vector3 };
  // side walls (and the far end wall) of each room
  const runsOf = (ri: number): Run[] => {
    const { z0, z1 } = layout.rooms[ri];
    const out: Run[] = [
      { a: V(-W / 2, 0, z0), b: V(-W / 2, 0, z1), n: V(1, 0, 0) },
      { a: V(W / 2, 0, z0), b: V(W / 2, 0, z1), n: V(-1, 0, 0) },
    ];
    if (ri === last) out.push({ a: V(-W / 2, 0, -L / 2), b: V(W / 2, 0, -L / 2), n: V(0, 0, 1) });
    return out;
  };
  const nearRuns: Run[] = [
    { a: V(-W / 2, 0, L / 2), b: V(-DOOR.width / 2 - 0.2, 0, L / 2), n: V(0, 0, -1) },
    { a: V(DOOR.width / 2 + 0.2, 0, L / 2), b: V(W / 2, 0, L / 2), n: V(0, 0, -1) },
  ];
  const nearFull: Run = { a: V(-W / 2, 0, L / 2), b: V(W / 2, 0, L / 2), n: V(0, 0, -1) };
  // the cross-wall faces each room has: full width (cornice, picture rail)
  // and either side of the doorway (skirting)
  const crossFaces = (ri: number): { full: Run[]; split: Run[] } => {
    const full: Run[] = [];
    const split: Run[] = [];
    const faces: [number, number, 1 | -1][] = [];
    if (ri < last) faces.push([ri, layout.doorways[ri].z + layout.doorways[ri].thickness / 2, 1]);
    if (ri > 0) faces.push([ri - 1, layout.doorways[ri - 1].z - layout.doorways[ri - 1].thickness / 2, -1]);
    for (const [di, z, n] of faces) {
      const d = layout.doorways[di];
      full.push({ a: V(-W / 2, 0, z), b: V(W / 2, 0, z), n: V(0, 0, n) });
      const edge = d.halfWidth + (classical ? 0.2 : 0.06);
      split.push(
        { a: V(-W / 2, 0, z), b: V(-edge, 0, z), n: V(0, 0, n) },
        { a: V(edge, 0, z), b: V(W / 2, 0, z), n: V(0, 0, n) }
      );
    }
    return { full, split };
  };
  layout.rooms.forEach((_, ri) => {
    const { trim } = rooms[ri];
    const cross = crossFaces(ri);
    if (classical) {
      for (const q of [...runsOf(ri), ...(ri === 0 ? nearRuns : []), ...cross.split]) {
        trim.sweep(SKIRTING, q.a, q.b, q.n);
      }
    }
    if (theme.room.pictureRail) {
      const y = pictureRailY(H, spec.coveR);
      for (const q of [...runsOf(ri), ...(ri === 0 ? [nearFull] : []), ...cross.full]) {
        trim.sweep(PICTURE_RAIL, q.a.clone().setY(y), q.b.clone().setY(y), q.n);
      }
    }
  });

  // ---- ceiling
  const r = spec.coveR;
  const yC = spec.yCeil;
  if (r > 0) {
    // cornice cove + a small bed moulding at its foot
    const cove = coveProfile(r, H - r);
    const bed: [number, number][] = [
      [0.0, H - r - 0.07],
      [0.025, H - r - 0.07],
      [0.032, H - r - 0.055],
      [0.032, H - r - 0.035],
      [0.045, H - r - 0.02],
      [0.045, H - r],
      [0.0, H - r + 0.001],
    ];
    layout.rooms.forEach((_, ri) => {
      const { ceiling } = rooms[ri];
      for (const q of [...runsOf(ri), ...(ri === 0 ? [nearFull] : []), ...crossFaces(ri).full]) {
        ceiling.sweep(cove, q.a, q.b, q.n, 50);
        ceiling.sweep(bed, q.a, q.b, q.n);
      }
    });
  }
  specs.forEach((sp, ri) => {
    const { ceiling, trim } = at(ri);
    // flat band around the opening (faces down)
    const x0 = -W / 2 + r;
    const x1 = W / 2 - r;
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
    if (sp.kind === "laylight") {
      // moulded soffit frame round the opening
      const fw = 0.12;
      const fd = 0.07;
      const lenZ = sp.wellZ1 - sp.wellZ0 + 2 * fw;
      for (const s of [-1, 1]) {
        ceiling.roundedBox(fw, fd, lenZ, s * (wx + fw / 2), yC - fd / 2 + 0.002, (sp.wellZ0 + sp.wellZ1) / 2, 0.012, 2);
        ceiling.roundedBox(2 * wx, fd, fw, 0, yC - fd / 2 + 0.002, s < 0 ? sp.wellZ0 - fw / 2 : sp.wellZ1 + fw / 2, 0.012, 2);
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
    const railX = W / 2 - layout.trackInset;
    const zCross = sp.z0 + layout.trackInset;
    const zEnd = sp.z1 - 0.9;
    const RW = 0.034; // rail width
    const RH = 0.026; // rail height
    for (const s of [-1, 1]) {
      track.roundedBox(RW, RH, zEnd - zCross + RW, s * railX, yR, (zCross + zEnd) / 2, 0.004, 1);
    }
    track.roundedBox(2 * railX + RW, RH, RW, 0, yR, zCross, 0.004, 1);
    const rod = (x: number, z: number) => {
      const top = yC; // all rods land on the solid ceiling band
      const h = top - (yR + RH / 2);
      track.cylinder(0.0045, 0.0045, h, x, yR + RH / 2, z, 6);
      track.cylinder(0.032, 0.032, 0.014, x, top - 0.014, z, 16); // canopy
      track.cylinder(0.009, 0.012, 0.03, x, yR + RH / 2, z, 8); // clamp
    };
    const sideLen = zEnd - zCross;
    const nSide = Math.max(2, Math.ceil(sideLen / 2.4));
    for (const s of [-1, 1]) {
      for (let i = 0; i <= nSide; i++) {
        const z = zCross + 0.25 + ((sideLen - 0.5) * i) / nSide;
        rod(s * railX, z);
      }
    }
    const nCross = Math.max(1, Math.ceil((2 * railX) / 2.4));
    for (let i = 1; i < nCross; i++) rod(-railX + (2 * railX * i) / nCross, zCross);
    if (ri === 0 && screen) {
      const zs = screen.z + screen.thickness / 2 + layout.trackInset;
      track.roundedBox(2 * railX + RW, RH, RW, 0, yR, zs, 0.004, 1);
      for (let i = 1; i < nCross; i++) rod(-railX + (2 * railX * i) / nCross, zs);
    }
  });

  // ---- benches
  const shadow = buildBenchShadows(layout);
  for (const b of layout.benches) {
    const [bx, bz] = b.position;
    const [bw, bd] = b.size;
    const { seat, frame } = at(roomAt(layout, bz));
    switch (theme.room.bench) {
      case "leather": {
        // button-less upholstered top on a dark wood frame with turned legs
        seat.roundedBox(bw, 0.11, bd, bx, 0.46 - 0.055, bz, 0.04, 3);
        frame.roundedBox(bw - 0.03, 0.075, bd - 0.03, bx, 0.33, bz, 0.01, 1);
        for (const sx of [-1, 1])
          for (const sz of [-1, 1]) {
            const lx = bx + sx * (bw / 2 - 0.055);
            const lz = bz + sz * (bd / 2 - 0.055);
            frame.cylinder(0.026, 0.018, 0.3, lx, 0, lz, 12);
            frame.cylinder(0.024, 0.026, 0.035, lx, 0.0, lz, 12); // foot
          }
        // stretcher along the length
        frame.roundedBox(0.035, 0.035, bd - 0.14, bx, 0.12, bz, 0.008, 1);
        break;
      }
      case "modern-leather": {
        // slim black leather cushion on a brushed steel frame
        seat.roundedBox(bw, 0.09, bd, bx, 0.43 - 0.045, bz, 0.03, 3);
        frame.roundedBox(bw - 0.06, 0.03, bd - 0.06, bx, 0.37, bz, 0.006, 1);
        for (const sz of [-1, 1]) {
          const lz = bz + sz * (bd / 2 - 0.12);
          frame.roundedBox(bw - 0.1, 0.022, 0.03, bx, 0.011, lz, 0.006, 1);
          for (const sx of [-1, 1]) frame.roundedBox(0.022, 0.36, 0.03, bx + sx * (bw / 2 - 0.06), 0.18, lz, 0.006, 1);
        }
        break;
      }
      case "oak-block": {
        // Judd-like solid oak: a slab on two plinths
        seat.roundedBox(bw, 0.065, bd, bx, 0.44 - 0.0325, bz, 0.008, 2);
        for (const sz of [-1, 1]) {
          frame.roundedBox(bw - 0.08, 0.375, 0.065, bx, 0.1875, bz + sz * (bd / 2 - 0.28), 0.006, 2);
        }
        break;
      }
    }
  }

  const walls = mergeRooms(rooms.map((x) => x.walls));
  const ceiling = mergeRooms(rooms.map((x) => x.ceiling));
  const trim = mergeRooms(rooms.map((x) => x.trim));
  const track = mergeRooms(rooms.map((x) => x.track));
  const seat = mergeRooms(rooms.map((x) => x.seat));
  const frame = mergeRooms(rooms.map((x) => x.frame));
  // bench shadows: one quad (6 indices) per bench, benches in room order
  const shadowRanges: IndexRange[] = layout.rooms.map(() => ({ start: 0, count: 0 }));
  layout.benches.forEach((b, i) => {
    const rr = shadowRanges[Math.max(0, Math.min(last, roomAt(layout, b.position[1])))];
    if (rr.count === 0) rr.start = i * 6;
    rr.count += 6;
  });
  for (let i = 1; i < shadowRanges.length; i++) {
    // keep empty rooms' ranges in order for the contiguous window maths
    if (shadowRanges[i].count === 0) shadowRanges[i].start = shadowRanges[i - 1].start + shadowRanges[i - 1].count;
  }
  return {
    walls: walls.geometry,
    ceiling: ceiling.geometry,
    trim: trim.geometry,
    track: track.geometry,
    benchSeat: seat.geometry,
    benchFrame: frame.geometry,
    benchShadow: shadow,
    spec,
    specs,
    ranges: {
      walls: walls.ranges,
      ceiling: ceiling.ranges,
      trim: trim.ranges,
      track: track.ranges,
      benchSeat: seat.ranges,
      benchFrame: frame.ranges,
      benchShadow: shadowRanges,
    },
  };
}

/** One floor quad per bench carrying its local coordinates for an SDF blob. */
function buildBenchShadows(layout: GalleryLayout): THREE.BufferGeometry {
  const pos: number[] = [];
  const loc: number[] = [];
  const half: number[] = [];
  const idx: number[] = [];
  const PAD = 0.45;
  for (const b of layout.benches) {
    const [bx, bz] = b.position;
    const hw = b.size[0] / 2;
    const hd = b.size[1] / 2;
    const base = pos.length / 3;
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const lx = sx * (hw + PAD);
      const lz = sz * (hd + PAD);
      pos.push(bx + lx, 0.0015, bz + lz);
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
  for (const g of [h.walls, h.ceiling, h.trim, h.track, h.benchSeat, h.benchFrame, h.benchShadow]) g.dispose();
}
