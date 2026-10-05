// Geometry for an exhibit besides the frame: the painted canvas (a flat
// plane inside a frame, or a stretched box for floaters), the placard card,
// and the track-light fixture, plus the aiming maths that ties the fixture
// to the lighting track and its spotlight to the painting.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TRACK_DROP, TRACK_INSET, WALL_GAP, type Placement } from "./layout";
import { WEAVE_TILE_M } from "./exhibit-materials";

// ------------------------------------------------------------- canvas

/**
 * The painted surface, front face at z = 0 facing +z. With depth > 0 it is a
 * stretched-canvas box whose sides "mirror-wrap" the outer 1.5 % of the
 * image, as paint carried round the stretcher. uv1 is in weave tiles.
 */
export function canvasGeometry(w: number, h: number, depth: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const uv1: number[] = [];
  const idx: number[] = [];
  const T = WEAVE_TILE_M;
  const quad = (
    p: [number, number, number][],
    n: [number, number, number],
    t: [number, number][],
    t1: [number, number][],
  ) => {
    const b = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(...p[i]);
      nor.push(...n);
      uv.push(...t[i]);
      uv1.push(...t1[i]);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const hw = w / 2;
  const hh = h / 2;
  // front (CCW from bottom-left)
  quad(
    [
      [-hw, -hh, 0],
      [hw, -hh, 0],
      [hw, hh, 0],
      [-hw, hh, 0],
    ],
    [0, 0, 1],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    [
      [0, 0],
      [w / T, 0],
      [w / T, h / T],
      [0, h / T],
    ],
  );
  if (depth > 0) {
    const D = -depth;
    const m = 0.015; // wrapped band of the image
    const dT = depth / T;
    // bottom (faces −y)
    quad(
      [
        [-hw, -hh, D],
        [hw, -hh, D],
        [hw, -hh, 0],
        [-hw, -hh, 0],
      ],
      [0, -1, 0],
      [
        [0, m],
        [1, m],
        [1, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [w / T, 0],
        [w / T, dT],
        [0, dT],
      ],
    );
    // top (faces +y)
    quad(
      [
        [-hw, hh, 0],
        [hw, hh, 0],
        [hw, hh, D],
        [-hw, hh, D],
      ],
      [0, 1, 0],
      [
        [0, 1],
        [1, 1],
        [1, 1 - m],
        [0, 1 - m],
      ],
      [
        [0, 0],
        [w / T, 0],
        [w / T, dT],
        [0, dT],
      ],
    );
    // right (faces +x)
    quad(
      [
        [hw, -hh, 0],
        [hw, -hh, D],
        [hw, hh, D],
        [hw, hh, 0],
      ],
      [1, 0, 0],
      [
        [1, 0],
        [1 - m, 0],
        [1 - m, 1],
        [1, 1],
      ],
      [
        [0, 0],
        [dT, 0],
        [dT, h / T],
        [0, h / T],
      ],
    );
    // left (faces −x)
    quad(
      [
        [-hw, -hh, D],
        [-hw, -hh, 0],
        [-hw, hh, 0],
        [-hw, hh, D],
      ],
      [-1, 0, 0],
      [
        [m, 0],
        [0, 0],
        [0, 1],
        [m, 1],
      ],
      [
        [0, 0],
        [dT, 0],
        [dT, h / T],
        [0, h / T],
      ],
    );
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("uv1", new THREE.Float32BufferAttribute(uv1, 2));
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------- placard

/**
 * The label card as one mesh: textured face plus thin edges whose UVs sample
 * a plain patch of the card, so body and face are a single draw call.
 * Back at z = 0 (against the wall), face at z = t.
 */
export function placardGeometry(w: number, h: number, t: number): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(w, h, t);
  box.translate(0, 0, t / 2);
  const uv = box.getAttribute("uv") as THREE.BufferAttribute;
  const nrm = box.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    if (nrm.getZ(i) < 0.5) uv.setXY(i, 0.5, 0.06); // edges & back: plain card
  }
  // drop the back face (never seen)
  const keep: number[] = [];
  const index = box.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    if (nrm.getZ(a) > -0.5) keep.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  }
  box.setIndex(keep);
  box.clearGroups();
  return box;
}

// ------------------------------------------------------------- fixture

export interface HallDims {
  hallWidth: number;
  hallLength: number;
  wallHeight: number;
}

const ADAPTER = { w: 0.05, h: 0.036, l: 0.12 };
const STEM_L = 0.07;
const KNUCKLE_R = 0.016;
const NECK_L = 0.03;
const CAN_L = 0.18;
const LENS_RECESS = 0.022;
const RAIL_HALF_H = 0.013; // ROOM's track rail is 34 × 26 mm, centred at H − TRACK_DROP

export interface FixturePlan {
  /** Adapter centre on the rail (world). */
  mount: THREE.Vector3;
  /** Rail runs along this world axis. */
  railAxis: "x" | "z";
  /** Knuckle at the foot of the stem (world). */
  pivot: THREE.Vector3;
  /** Unit can axis, pointing exactly at `target`. */
  dir: THREE.Vector3;
  /** Lens centre at the can mouth (world) — the spotlight origin. */
  lens: THREE.Vector3;
  /** Aim point on the painting (world). */
  target: THREE.Vector3;
}

/** Derive hall dimensions from the placement when the layout isn't passed in. */
export function hallFromPlacement(pl: Placement, given?: Partial<HallDims>): HallDims & { lengthKnown: boolean } {
  const nx = Math.sin(pl.rotationY);
  const nz = Math.cos(pl.rotationY);
  const lengthFromWall = nz > 0.5 ? 2 * (WALL_GAP - pl.position[2]) : undefined;
  return {
    hallWidth: given?.hallWidth ?? (Math.abs(nx) > 0.5 ? 2 * (Math.abs(pl.position[0]) + WALL_GAP) : 9.2),
    hallLength: given?.hallLength ?? lengthFromWall ?? 15,
    wallHeight: given?.wallHeight ?? 4.7,
    lengthKnown: given?.hallLength !== undefined || lengthFromWall !== undefined,
  };
}

/** Where ROOM's side rails end near the entrance (room-geometry: zEnd = L/2 − 0.9). */
const SIDE_RAIL_END_CLEAR = 0.9;

/** local (exhibit group) point → world */
export function localToWorld(pl: Placement, x: number, y: number, z: number): THREE.Vector3 {
  const c = Math.cos(pl.rotationY);
  const s = Math.sin(pl.rotationY);
  return new THREE.Vector3(pl.position[0] + x * c + z * s, pl.position[1] + y, pl.position[2] - x * s + z * c);
}

/**
 * Clamp the fixture onto its track rail and aim it. Side-wall works hang from
 * the side rail at the painting's z; works on the far wall from the cross
 * rail at the painting's x.
 */
export function planFixture(
  pl: Placement,
  hall: HallDims & { lengthKnown?: boolean },
  aimLocal: [number, number, number],
  /** World coordinate along the rail (z on a side rail, x on the cross rail); default: in front of the work. */
  railAt?: number,
): FixturePlan {
  const nx = Math.sin(pl.rotationY);
  const nz = Math.cos(pl.rotationY);
  const railY = hall.wallHeight - TRACK_DROP;
  let mount: THREE.Vector3;
  let railAxis: "x" | "z";
  if (Math.abs(nx) > 0.5) {
    const railX = Math.sign(pl.position[0] || -nx) * (hall.hallWidth / 2 - TRACK_INSET);
    // stay on the rail: it runs from the cross rail to just short of the entrance wall
    let z = railAt ?? pl.position[2];
    if (hall.lengthKnown !== false) {
      const L2 = hall.hallLength / 2;
      z = THREE.MathUtils.clamp(z, -L2 + TRACK_INSET + 0.08, L2 - SIDE_RAIL_END_CLEAR - 0.08);
    }
    mount = new THREE.Vector3(railX, railY - RAIL_HALF_H - ADAPTER.h / 2 + 0.003, z);
    railAxis = "z";
  } else {
    const railZ = nz > 0 ? -hall.hallLength / 2 + TRACK_INSET : hall.hallLength / 2 - TRACK_INSET;
    const railX = hall.hallWidth / 2 - TRACK_INSET;
    const x = THREE.MathUtils.clamp(railAt ?? pl.position[0], -railX + 0.08, railX - 0.08);
    mount = new THREE.Vector3(x, railY - RAIL_HALF_H - ADAPTER.h / 2 + 0.003, railZ);
    railAxis = "x";
  }
  const pivot = mount.clone().add(new THREE.Vector3(0, -(ADAPTER.h / 2 + STEM_L), 0));
  const target = localToWorld(pl, aimLocal[0], aimLocal[1], aimLocal[2]);
  const dir = target.clone().sub(pivot).normalize();
  const lens = pivot.clone().addScaledVector(dir, NECK_L + CAN_L - LENS_RECESS + 0.001);
  return { mount, railAxis, pivot, dir, lens, target };
}

/** Lathe profile of the can (r, y) from the rear cap to the recessed lens. */
function canProfile(): THREE.Vector2[] {
  const pts: [number, number][] = [
    [0.0, 0.0],
    [0.024, 0.0],
    [0.033, 0.004],
    [0.038, 0.012],
    [0.04, 0.024],
    [0.041, 0.026],
    [0.044, CAN_L - 0.016],
    [0.049, CAN_L - 0.013],
    [0.05, CAN_L - 0.004],
    [0.048, CAN_L],
    [0.037, CAN_L],
    [0.0355, CAN_L - LENS_RECESS],
    [0.0, CAN_L - LENS_RECESS],
  ];
  return pts.map(([r, y]) => new THREE.Vector2(r, y));
}

/**
 * Track heads (adapter, stem, knuckle, neck, can and the lens disc) for one
 * or more plans, merged into ONE geometry relative to `origin` — one draw
 * call per exhibit. The `aLens` attribute is 1 on the lens disc, 0 on the
 * body, so a single material can light the lens (see fixtureMaterial).
 */
export function fixtureGeometry(plans: FixturePlan[], origin: THREE.Vector3): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0);
  const tag = (g: THREE.BufferGeometry, lens: number) => {
    const n = g.getAttribute("position").count;
    g.setAttribute("aLens", new THREE.Float32BufferAttribute(new Float32Array(n).fill(lens), 1));
    parts.push(g);
  };

  for (const plan of plans) {
    const mount = plan.mount.clone().sub(origin);
    // adapter block, long side along the rail
    const adapter = new THREE.BoxGeometry(
      plan.railAxis === "x" ? ADAPTER.l : ADAPTER.w,
      ADAPTER.h,
      plan.railAxis === "x" ? ADAPTER.w : ADAPTER.l,
    );
    adapter.translate(mount.x, mount.y, mount.z);
    tag(adapter, 0);

    const stem = new THREE.CylinderGeometry(0.0075, 0.0075, STEM_L + 0.004, 10, 1, true);
    stem.translate(mount.x, mount.y - (ADAPTER.h / 2 + STEM_L / 2), mount.z);
    tag(stem, 0);

    // the can and its neck: quaternion from +Y to the exact aim direction
    const pivot = plan.pivot.clone().sub(origin);
    q.setFromUnitVectors(UP, plan.dir);
    m.compose(pivot, q, one);

    const knuckle = new THREE.SphereGeometry(KNUCKLE_R, 12, 8);
    knuckle.translate(pivot.x, pivot.y, pivot.z);
    tag(knuckle, 0);

    const neck = new THREE.CylinderGeometry(0.011, 0.013, NECK_L, 10, 1, true);
    neck.translate(0, NECK_L / 2, 0);
    neck.applyMatrix4(m);
    tag(neck, 0);

    const can = new THREE.LatheGeometry(canProfile(), 28);
    can.translate(0, NECK_L, 0);
    can.applyMatrix4(m);
    tag(can, 0);

    // lens disc at the can mouth, facing along the axis (toward the painting)
    const lens = new THREE.CircleGeometry(0.0352, 24);
    lens.rotateX(-Math.PI / 2);
    lens.translate(0, NECK_L + CAN_L - LENS_RECESS + 0.0008, 0);
    lens.applyMatrix4(m);
    tag(lens, 1);
  }

  // normalise attribute sets so the parts can merge
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) {
      if (!["position", "normal", "uv", "aLens"].includes(name)) p.deleteAttribute(name);
    }
    if (!p.index) {
      const n = p.getAttribute("position").count;
      p.setIndex(Array.from({ length: n }, (_, i) => i));
    }
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  const out = merged ?? new THREE.BufferGeometry();
  out.computeBoundingSphere();
  return out;
}

/** A region of the work in exhibit-local coordinates. */
export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Half-angle (rad) from the lens axis to the farthest corner of `r`
 * (exhibit-local, on the plane z), used to fit a spotlight cone to the work.
 */
export function coneHalfAngle(plan: FixturePlan, pl: Placement, r: Rect, z: number): number {
  let half = 0;
  for (const x of [r.x0, r.x1]) {
    for (const y of [r.y0, r.y1]) {
      const c = localToWorld(pl, x, y, z).sub(plan.lens).normalize();
      half = Math.max(half, plan.dir.angleTo(c));
    }
  }
  return half;
}

export interface LightPlan {
  plan: FixturePlan;
  /** Spot cone half-angle (rad). */
  angle: number;
  /** Candela, solved so the aim point receives the target level. */
  intensity: number;
}

/**
 * One fixture per work — or two, splitting the work top/bottom or
 * left/right, when a single cone would have to open wider than `splitAt`
 * (monumental altarpieces hung close under the track). Each cone is fitted
 * so its region's farthest corner sits at the edge of the full-intensity
 * core (angle = half / (1 − penumbra)).
 */
export function planLights(
  pl: Placement,
  hall: HallDims & { lengthKnown?: boolean },
  outer: Rect,
  z: number,
  o: { level: number; penumbra: number; splitAt: number; maxHalf: number },
): LightPlan[] {
  const h = outer.y1 - outer.y0;
  const w = outer.x1 - outer.x0;
  const wallN = new THREE.Vector3(Math.sin(pl.rotationY), 0, Math.cos(pl.rotationY));
  const build = (aim: [number, number], region: Rect, level: number, railAt?: number): LightPlan => {
    const plan = planFixture(pl, hall, [aim[0], aim[1], z], railAt);
    const half = coneHalfAngle(plan, pl, region, z);
    const angle = Math.min(o.maxHalf, half / (1 - o.penumbra));
    const d = plan.lens.distanceTo(plan.target);
    const cosInc = Math.max(0.2, -plan.dir.dot(wallN));
    return { plan, angle, intensity: (level * d * d) / cosInc };
  };
  // the near (top) edge is closer to the lamp: aim a little below centre
  const cy = (outer.y0 + outer.y1) / 2;
  const single = build([(outer.x0 + outer.x1) / 2, cy - 0.08 * h], outer, o.level);
  const singleHalf = single.angle * (1 - o.penumbra);
  if (singleHalf <= o.splitAt) return [single];

  // along-rail world coordinate of a local x on the work
  const railCoord = (x: number) => {
    const p = localToWorld(pl, x, 0, 0);
    return Math.abs(wallN.x) > 0.5 ? p.z : p.x;
  };
  const centreRail = railCoord((outer.x0 + outer.x1) / 2);
  const ov = 0.06; // regions overlap a little so the seam is invisible
  const each = o.level * 0.8; // overlapping cores add up in the middle
  // top / bottom: two heads side by side on the rail
  const yMid = cy;
  const topR: Rect = { ...outer, y0: yMid - ov * h };
  const botR: Rect = { ...outer, y1: yMid + ov * h };
  const tb = [
    build([(outer.x0 + outer.x1) / 2, (topR.y0 + topR.y1) / 2 - 0.05 * h], topR, each, centreRail - 0.17),
    build([(outer.x0 + outer.x1) / 2, (botR.y0 + botR.y1) / 2 - 0.03 * h], botR, each, centreRail + 0.17),
  ];
  // left / right: heads spread along the rail in front of each half
  const xMid = (outer.x0 + outer.x1) / 2;
  const leftR: Rect = { ...outer, x1: xMid + ov * w };
  const rightR: Rect = { ...outer, x0: xMid - ov * w };
  const lx = (leftR.x0 + leftR.x1) / 2;
  const rx = (rightR.x0 + rightR.x1) / 2;
  const lr = [
    build([lx, cy - 0.08 * h], leftR, each, railCoord(lx)),
    build([rx, cy - 0.08 * h], rightR, each, railCoord(rx)),
  ];
  const worst = (ls: LightPlan[]) => Math.max(...ls.map((l) => l.angle));
  return worst(tb) <= worst(lr) ? tb : lr;
}
