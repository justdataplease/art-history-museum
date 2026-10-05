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
import { TRACK_DROP, TRACK_INSET, type GalleryLayout } from "./layout";
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
}

export function ceilingSpec(layout: GalleryLayout, theme: GalleryTheme): CeilingSpec {
  const { hallWidth: W, hallLength: L, wallHeight: H } = layout;
  const railX = W / 2 - TRACK_INSET;
  if (theme.room.ceiling === "laylight") {
    const wellX = Math.min(railX - 0.42, W / 2 - 1.6);
    const wellZ0 = -L / 2 + TRACK_INSET + 0.75;
    const wellZ1 = L / 2 - TRACK_INSET - 0.75;
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
    };
  }
  // lightbox: one long shallow diffuser down the middle of a flat ceiling
  const wellX = 0.75;
  const wellZ0 = -L / 2 + TRACK_INSET + 0.6;
  const wellZ1 = L / 2 - TRACK_INSET - 0.6;
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
  };
}

/** The emissive glass (laylight panes / lightbox diffuser), one quad per bay. */
export function buildGlass(spec: CeilingSpec): THREE.BufferGeometry {
  const b = new GeoBatch();
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
  spec: CeilingSpec;
}

export const DOOR = { width: 1.9, height: 3.05, depth: 0.32 };

export function buildHall(layout: GalleryLayout, theme: GalleryTheme): HallGeometry {
  const { hallWidth: W, hallLength: L, wallHeight: H } = layout;
  const spec = ceilingSpec(layout, theme);
  const classical = theme.room.classical;
  const walls = new GeoBatch();
  const ceiling = new GeoBatch();
  const trim = new GeoBatch();
  const track = new GeoBatch();
  const seat = new GeoBatch();
  const frame = new GeoBatch();

  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // ---- walls (room-facing planes only; UVs in metres)
  // left wall (x = -W/2), faces +x: edgeU along -z?  need U×V = +x → U = +z? (+z × +y = -x) so U = -z
  walls.quad(V(-W / 2, 0, L / 2), V(0, 0, -L), V(0, H, 0));
  // right wall faces -x: U = +z  (+z × +y = -x ✓)
  walls.quad(V(W / 2, 0, -L / 2), V(0, 0, L), V(0, H, 0));
  // far wall (z = -L/2) faces +z: U = +x (+x × +y = +z ✓)
  walls.quad(V(-W / 2, 0, -L / 2), V(W, 0, 0), V(0, H, 0));
  // near wall (z = +L/2) faces -z: U = -x, with the door opening
  {
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
    if (classical) {
      // moulded architrave round the opening, with plinth blocks
      const z = L / 2;
      const inward = V(0, 0, -1);
      // jambs: sweep vertical runs — profile in (d, across) so build via rotated sweeps
      // Simplify: the architrave is three straight runs whose "height" axis is
      // across the face. Use boxes + a sweep for the head.
      for (const s of [-1, 1]) {
        const x = s * (dw + 0.065);
        trim.roundedBox(0.13, dh + 0.065, 0.03, x, (dh + 0.065) / 2, z - 0.015, 0.008, 2);
        trim.roundedBox(0.04, dh + 0.06, 0.018, s * (dw + 0.11), (dh + 0.06) / 2, z - 0.035, 0.008, 2);
        trim.roundedBox(0.16, 0.26, 0.045, x, 0.13, z - 0.0225, 0.006, 1); // plinth block
      }
      trim.sweep(
        ARCHITRAVE,
        V(-dw - 0.135, dh, z),
        V(dw + 0.135, dh, z),
        inward
      );
      // cornice over the door
      trim.roundedBox(DOOR.width + 0.5, 0.07, 0.09, 0, dh + 0.17, z - 0.045, 0.012, 2);
      trim.roundedBox(DOOR.width + 0.36, 0.035, 0.06, 0, dh + 0.12, z - 0.03, 0.008, 1);
    } else {
      // flush steel-framed opening: a slim frame
      for (const s of [-1, 1]) {
        trim.box(0.04, dh, 0.012, s * (dw + 0.02), dh / 2, L / 2 - 0.006);
      }
      trim.box(DOOR.width + 0.08, 0.04, 0.012, 0, dh + 0.02, L / 2 - 0.006);
    }
  }

  // ---- skirting / picture rail (classical rooms)
  const runs: { a: THREE.Vector3; b: THREE.Vector3; n: THREE.Vector3 }[] = [
    { a: V(-W / 2, 0, -L / 2), b: V(-W / 2, 0, L / 2), n: V(1, 0, 0) },
    { a: V(W / 2, 0, -L / 2), b: V(W / 2, 0, L / 2), n: V(-1, 0, 0) },
    { a: V(-W / 2, 0, -L / 2), b: V(W / 2, 0, -L / 2), n: V(0, 0, 1) },
  ];
  const nearRuns = [
    { a: V(-W / 2, 0, L / 2), b: V(-DOOR.width / 2 - 0.2, 0, L / 2), n: V(0, 0, -1) },
    { a: V(DOOR.width / 2 + 0.2, 0, L / 2), b: V(W / 2, 0, L / 2), n: V(0, 0, -1) },
  ];
  if (classical) {
    for (const r of [...runs, ...nearRuns]) trim.sweep(SKIRTING, r.a, r.b, r.n);
    if (theme.room.pictureRail) {
      const y = H - spec.coveR - 0.32;
      for (const r of [...runs, { a: V(-W / 2, 0, L / 2), b: V(W / 2, 0, L / 2), n: V(0, 0, -1) }]) {
        trim.sweep(PICTURE_RAIL, r.a.clone().setY(y), r.b.clone().setY(y), r.n);
      }
    }
  }

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
    const all = [
      ...runs.map((q) => ({ a: q.a, b: q.b, n: q.n })),
      { a: V(-W / 2, 0, L / 2), b: V(W / 2, 0, L / 2), n: V(0, 0, -1) },
    ];
    for (const q of all) {
      ceiling.sweep(cove, q.a, q.b, q.n, 50);
      ceiling.sweep(bed, q.a, q.b, q.n);
    }
  }
  // flat band around the opening (faces down)
  {
    const x0 = -W / 2 + r;
    const x1 = W / 2 - r;
    const z0 = -L / 2 + r;
    const z1 = L / 2 - r;
    const wx = spec.wellX;
    const face = (ax: number, bx: number, az: number, bz: number) => {
      if (bx - ax < 1e-4 || bz - az < 1e-4) return;
      // U = +x, V = -z?  (+x × -z = +y) → we need -y: U = +z, V = +x (+z × +x = +y)… use U=+x, V=+z: +x × +z = -y ✓
      ceiling.quad(V(ax, yC, az), V(bx - ax, 0, 0), V(0, 0, bz - az), [ax, az]);
    };
    face(x0, -wx, z0, z1);
    face(wx, x1, z0, z1);
    face(-wx, wx, z0, spec.wellZ0);
    face(-wx, wx, spec.wellZ1, z1);
    // well sides (vertical, facing into the well)
    const dy = spec.yGlass - yC;
    ceiling.quad(V(-wx, yC, spec.wellZ1), V(0, 0, spec.wellZ0 - spec.wellZ1), V(0, dy, 0)); // faces +x
    ceiling.quad(V(wx, yC, spec.wellZ0), V(0, 0, spec.wellZ1 - spec.wellZ0), V(0, dy, 0)); // faces -x
    ceiling.quad(V(-wx, yC, spec.wellZ0), V(2 * wx, 0, 0), V(0, dy, 0)); // faces +z
    ceiling.quad(V(wx, yC, spec.wellZ1), V(-2 * wx, 0, 0), V(0, dy, 0)); // faces -z
    if (spec.kind === "laylight") {
      // moulded soffit frame round the opening
      const fw = 0.12;
      const fd = 0.07;
      const lenZ = spec.wellZ1 - spec.wellZ0 + 2 * fw;
      for (const s of [-1, 1]) {
        ceiling.roundedBox(fw, fd, lenZ, s * (wx + fw / 2), yC - fd / 2 + 0.002, (spec.wellZ0 + spec.wellZ1) / 2, 0.012, 2);
        ceiling.roundedBox(2 * wx, fd, fw, 0, yC - fd / 2 + 0.002, s < 0 ? spec.wellZ0 - fw / 2 : spec.wellZ1 + fw / 2, 0.012, 2);
      }
      // beams between the bays, spanning the well
      for (let i = 1; i < spec.bays.length; i++) {
        const z = spec.bays[i].z0;
        ceiling.roundedBox(2 * wx, spec.beamDepth, spec.beamW, 0, spec.yGlass - spec.beamDepth / 2, z, 0.02, 2);
      }
    } else {
      // slim aluminium-look reveal round the diffuser
      for (const s of [-1, 1]) {
        trim.box(0.025, 0.012, spec.wellZ1 - spec.wellZ0, s * (wx + 0.0125), yC - 0.006, (spec.wellZ0 + spec.wellZ1) / 2);
        trim.box(2 * wx + 0.05, 0.012, 0.025, 0, yC - 0.006, s < 0 ? spec.wellZ0 - 0.0125 : spec.wellZ1 + 0.0125);
      }
    }
  }

  // ---- lighting track (rails + suspension rods + canopies)
  {
    const yR = H - TRACK_DROP;
    const railX = W / 2 - TRACK_INSET;
    const zCross = -L / 2 + TRACK_INSET;
    const zEnd = L / 2 - 0.9;
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
  }

  // ---- benches
  const shadow = buildBenchShadows(layout);
  for (const b of layout.benches) {
    const [bx, bz] = b.position;
    const [bw, bd] = b.size;
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

  return {
    walls: walls.build(),
    ceiling: ceiling.build(),
    trim: trim.build(),
    track: track.build(),
    benchSeat: seat.build(),
    benchFrame: frame.build(),
    benchShadow: shadow,
    spec,
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
