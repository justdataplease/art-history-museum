// A real building's floor plan (src/lib/spaces.ts), as the gallery walks it: rooms where they stand, joined by
// their doors, instead of one suite of rooms along an axis. Plan view, metres: x east, z south.
//
// A room of the plan is a rectangle. A long gallery is cut into zones (bays some 25 m long, open to each other
// across its whole width), so the works of a 270 m gallery hang, light and load bay by bay as a suite's do room
// by room. A zone is what the rest of the gallery calls a room (Placement.room, the navigator, the lights);
// a shell is one room's architecture (walls, ceiling, floor), which may hold several zones.
//
// Everything here is plain geometry (no three.js): where one may stand, which zone a point is in, how to walk
// from one zone to another, and what a line of sight runs into.

export interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** The four walls of a room: n (z0, facing +z), s (z1, facing −z), w (x0, facing +x), e (x1, facing −x). */
export type Side = "n" | "s" | "w" | "e";
export const SIDES: Side[] = ["n", "e", "s", "w"];

export interface PlanZone extends Box {
  index: number;
  shell: number;
  /** Sides open to the next zone of the same room (a bay of a long gallery): no wall stands there. */
  open: Partial<Record<Side, boolean>>;
}

export interface PlanDoor {
  /** The zones it joins; `b` −1: a door that stays shut (to a part of the building not recreated). */
  a: number;
  b: number;
  /** The wall of zone `a` it stands in. */
  side: Side;
  /** Its centre along the wall (x on a north or south wall, z on an east or west wall), half its clear width,
   *  its clear height (the crown of an arch). */
  at: number;
  half: number;
  height: number;
  /** The rise of an arched head (0: a square head). */
  arch: number;
  /** The opening through the wall, face to face, in plan. */
  box: Box;
  /** Between two bays of one room: nothing but air (and perhaps columns). */
  bay: boolean;
  /** Not a door but a window to the outside: glazed, daylight behind it. */
  window?: boolean;
}

/** A free-standing wall inside a room (the Mona Lisa's, the wall the Wedding at Cana hangs on). */
export interface PlanPartition extends Box {
  shell: number;
  height: number;
  /** It stands in a surround of stone: two posts and a lintel (else a plain panel). */
  portal: boolean;
  /** Not a wall but the block of marble an arch's columns stand on: it stops a walk, and is built with them. */
  plinth?: boolean;
}

/** A round column standing on the floor. */
export interface PlanColumn {
  x: number;
  z: number;
  r: number;
  shell: number;
  /** The top of its capital. */
  height: number;
  /** Its marble (default: the room's). */
  marble?: string;
}

/** A work behind glass set in its wall, a shelf below it, a curved rail before it: where it hangs. */
export interface PlanShrine {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  w: number;
  h: number;
  shell: number;
}

/** An arch across a gallery at a bay line: two columns a side under an entablature, the arch springing from
 *  them. `at`: its place along the gallery (x or z); half its clear width, the height it springs from, its
 *  rise, and half its depth along the gallery. */
export interface PlanArch {
  shell: number;
  at: number;
  half: number;
  spring: number;
  rise: number;
  depth: number;
  /** Its columns' marble (default: the room's). */
  marble?: string;
}

/** A bay of marble on a long wall beside an arch's columns: two pilasters and a niche. `at`: its middle along
 *  the wall (x or z), half its width, the height of its pilasters. */
export interface PlanNiche {
  shell: number;
  side: Side;
  at: number;
  half: number;
  height: number;
}

export interface PlanShell extends Box {
  index: number;
  id: string;
  name: string;
  /** Wall height, to the cornice. */
  height: number;
  zones: number[];
  /** The room's long axis: along z (false) or along x (true). Its ceiling, floor boards and benches follow it. */
  alongX: boolean;
  /** Where the spots hang: how far in from the walls, and how high. */
  rail: { inset: number; y: number };
}

export interface PlanEntry {
  /** Where the visitor stands as the doors open, where the entry walk ends, and the way they face (yaw about y:
   *  0 looks toward −z, π toward +z). */
  x: number;
  z: number;
  spawnX: number;
  spawnZ: number;
  yaw: number;
  zone: number;
}

/** What a photograph is laid on, on one side of a room: its cove, its attic (the band between the wall's top and
 *  the cove, with its cornice), the frame of the skylight (the flat band between the cove and the glass), or the
 *  whole flat top of a vault that has no glass (`side`: any). */
export interface PhotoPatch {
  side: Side;
  part: "cove" | "attic" | "frame" | "top";
  /** An attic that stands upright to the cove's foot, without a cornice standing out under it. */
  plain?: boolean;
  /** Raised where the photograph is light (white stucco, gilt frames), up to this many metres from the surface
   *  (plan-relief.ts): what stands out in the room stands out here, and shifts against its ground as one walks. */
  relief?: number;
  /** Along the wall: from..to in metres from the room's middle (x on a north or south side, z on a west or east
   *  one; default: all of it). */
  s?: [number, number];
  /** Only this near each end of the side (the corners of a ceiling), in metres. */
  ends?: number;
  /** Up the cove: from..to as shares of its quarter turn (default: all of it). */
  t?: [number, number];
  /** The photograph is of the other end of the room: laid here as there, turned about the room's middle. */
  turned?: boolean;
}

/** A photograph of the real room laid on its ceiling from where it was taken (src/lib/spaces.ts SpacePhoto). */
export interface PlanPhoto {
  shell: number;
  src: string;
  size: [number, number];
  eye: [number, number, number];
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
  /** Its colours on the model: what is taken off each channel first (haze), then what each is multiplied by. */
  black: [number, number, number];
  gain: [number, number, number];
  on: PhotoPatch[];
}

/** Where a point of the room falls on a photograph: (u, v) from its left and its foot, 0..1 inside the picture;
 *  null behind the camera. The gallery camera's own turns (yaw about y, then pitch, then roll), as
 *  scripts/fit-photo.mjs finds them. */
export function photoUV(ph: Pick<PlanPhoto, "eye" | "yaw" | "pitch" | "roll" | "fov" | "size">, x: number, y: number, z: number): [number, number] | null {
  const dx = x - ph.eye[0];
  const dy = y - ph.eye[1];
  const dz = z - ph.eye[2];
  const cy = Math.cos(ph.yaw);
  const sy = Math.sin(ph.yaw);
  const x1 = cy * dx - sy * dz;
  const z1 = sy * dx + cy * dz;
  const cp = Math.cos(ph.pitch);
  const sp = Math.sin(ph.pitch);
  const y2 = cp * dy + sp * z1;
  const z2 = -sp * dy + cp * z1;
  const cr = Math.cos(ph.roll);
  const sr = Math.sin(ph.roll);
  const x3 = cr * x1 + sr * y2;
  const y3 = -sr * x1 + cr * y2;
  if (z2 > -1e-6) return null;
  // the focal length in picture heights
  const f = 0.5 / Math.tan((ph.fov * Math.PI) / 360);
  const aspect = ph.size[0] / ph.size[1];
  return [0.5 + (f * x3) / -z2 / aspect, 0.5 + (f * y3) / -z2];
}

export interface PlanLayout {
  id: string;
  shells: PlanShell[];
  zones: PlanZone[];
  doors: PlanDoor[];
  partitions: PlanPartition[];
  columns: PlanColumn[];
  arches: PlanArch[];
  niches: PlanNiche[];
  shrines: PlanShrine[];
  photos: PlanPhoto[];
  entry: PlanEntry;
  /** Where one may stand: every zone less the wall margin (none on an open side), every open door's passage. */
  allowed: Box[];
  /** Where a line of sight may run: every zone, every open door's opening (below its head). */
  clear: { box: Box; top: number }[];
  /** hops[a][b]: doors and bays between two zones (Infinity: no way). */
  hops: number[][];
  /** via[a][b]: the door to take first from zone a toward zone b (−1: none, or already there). */
  via: number[][];
}

const inBox = (b: Box, x: number, z: number, pad = 0) => x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad;

/** The zone a floor point is in (the nearest, for a point in a doorway or a wall). */
export function planZoneAt(plan: PlanLayout, x: number, z: number): number {
  let best = 0;
  let bd = Infinity;
  for (const zn of plan.zones) {
    const dx = Math.max(zn.x0 - x, 0, x - zn.x1);
    const dz = Math.max(zn.z0 - z, 0, z - zn.z1);
    const d = dx * dx + dz * dz;
    if (d < bd) {
      bd = d;
      best = zn.index;
      if (d === 0) break;
    }
  }
  return best;
}

/** As planZoneAt, but a visitor in `current` stays there until well inside another zone (no flicker in a doorway). */
export function planZoneTrack(plan: PlanLayout, current: number, x: number, z: number, hysteresis = 0.35): number {
  const cur = plan.zones[current];
  if (cur && inBox(cur, x, z, hysteresis)) return current;
  return planZoneAt(plan, x, z);
}

/** Keep a floor point where one may stand: the nearest point of the allowed boxes. */
export function planConfine(plan: PlanLayout, p: { x: number; z: number }): void {
  let bx = p.x;
  let bz = p.z;
  let bd = Infinity;
  for (const b of plan.allowed) {
    const qx = Math.min(b.x1, Math.max(b.x0, p.x));
    const qz = Math.min(b.z1, Math.max(b.z0, p.z));
    const d = (qx - p.x) ** 2 + (qz - p.z) ** 2;
    if (d < bd) {
      bd = d;
      bx = qx;
      bz = qz;
      if (d === 0) return;
    }
  }
  p.x = bx;
  p.z = bz;
}

/** A door's centre on the floor, and a point a step into each of its zones. */
export function doorPoints(plan: PlanLayout, d: PlanDoor, step: number): { a: P2; b: P2; mid: P2 } {
  const horizontal = d.side === "n" || d.side === "s"; // the wall runs along x
  const mid = horizontal ? { x: d.at, z: (d.box.z0 + d.box.z1) / 2 } : { x: (d.box.x0 + d.box.x1) / 2, z: d.at };
  const za = plan.zones[d.a];
  // toward a's inside
  const sign = d.side === "n" || d.side === "w" ? 1 : -1;
  const depth = horizontal ? (d.box.z1 - d.box.z0) / 2 : (d.box.x1 - d.box.x0) / 2;
  const off = depth + step;
  const a = horizontal ? { x: d.at, z: mid.z + sign * off } : { x: mid.x + sign * off, z: d.at };
  const b = horizontal ? { x: d.at, z: mid.z - sign * off } : { x: mid.x - sign * off, z: d.at };
  void za;
  return { a, b, mid };
}

type P2 = { x: number; z: number };

/** The doors to walk through from zone `from` to zone `to`, in order (empty: the same zone, or no way). */
export function planDoorsBetween(plan: PlanLayout, from: number, to: number): { door: PlanDoor; forward: boolean }[] {
  const out: { door: PlanDoor; forward: boolean }[] = [];
  let at = from;
  for (let guard = 0; at !== to && guard < plan.zones.length + 2; guard++) {
    const di = plan.via[at]?.[to] ?? -1;
    if (di < 0) return [];
    const door = plan.doors[di];
    const forward = door.a === at;
    out.push({ door, forward });
    at = forward ? door.b : door.a;
  }
  return out;
}

/** Walking distance between two floor points: straight within a room, through the doors' centres between rooms. */
export function planPathDistance(plan: PlanLayout, a: P2, b: P2): number {
  const za = planZoneAt(plan, a.x, a.z);
  const zb = planZoneAt(plan, b.x, b.z);
  if (za === zb || plan.zones[za].shell === plan.zones[zb].shell) return Math.hypot(b.x - a.x, b.z - a.z);
  const doors = planDoorsBetween(plan, za, zb);
  if (!doors.length) return Math.hypot(b.x - a.x, b.z - a.z) + 50;
  let at = a;
  let total = 0;
  for (const { door } of doors) {
    if (door.bay) continue; // open air: no detour
    const m = doorPoints(plan, door, 0).mid;
    total += Math.hypot(m.x - at.x, m.z - at.z);
    at = m;
  }
  return total + Math.hypot(b.x - at.x, b.z - at.z);
}

/** The floor points that lead from `a` to `b` through the doors between their zones (b included, a not). */
export function planWaypoints(plan: PlanLayout, a: P2, b: P2, step: number): P2[] {
  const za = planZoneAt(plan, a.x, a.z);
  const zb = planZoneAt(plan, b.x, b.z);
  const pts: P2[] = [];
  for (const { door, forward } of planDoorsBetween(plan, za, zb)) {
    if (door.bay) continue;
    const dp = doorPoints(plan, door, step);
    pts.push(forward ? dp.a : dp.b, forward ? dp.b : dp.a);
  }
  pts.push({ x: b.x, z: b.z });
  return pts;
}

/** Is the straight walk p → q inside the allowed boxes all the way? */
export function planWalkClear(plan: PlanLayout, p: P2, q: P2): boolean {
  return coveredUntil(p, q, plan.allowed.map((box) => ({ box, top: Infinity })), 0, 0) >= 1 - 1e-6;
}

/** Liang–Barsky: the part [t0, t1] of segment a→b inside a box (null: none). */
function clipToBox(ax: number, az: number, bx: number, bz: number, box: Box): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (clip(-dx, ax - box.x0) && clip(dx, box.x1 - ax) && clip(-dz, az - box.z0) && clip(dz, box.z1 - az) && t1 >= t0) return [t0, t1];
  return null;
}

/** How far along a→b (0..1) the segment stays inside the union of the boxes (each up to its top, at heights
 *  ya → yb), starting inside one. */
function coveredUntil(a: P2, b: P2, boxes: { box: Box; top: number }[], ya: number, yb: number): number {
  const spans: [number, number][] = [];
  for (const { box, top } of boxes) {
    const s = clipToBox(a.x, a.z, b.x, b.z, box);
    if (!s) continue;
    let [t0, t1] = s;
    if (top !== Infinity) {
      // only where the line is below the opening's head
      const y0 = ya + (yb - ya) * t0;
      const y1 = ya + (yb - ya) * t1;
      if (y0 > top && y1 > top) continue;
      if (y0 > top || y1 > top) {
        const tc = (top - ya) / (yb - ya);
        if (y0 > top) t0 = tc;
        else t1 = tc;
      }
    }
    spans.push([t0, t1]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  let reach = 0;
  for (const [t0, t1] of spans) {
    if (t0 > reach + 1e-4) break;
    reach = Math.max(reach, t1);
  }
  return reach;
}

export interface PlanHit {
  t: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
}

/** Where the straight line a→b first leaves the rooms and their door openings (runs into a wall, a door's head
 *  or a free-standing wall): the point, and the wall's normal toward where the line came from. Null: clear. */
export function planFirstHit(
  plan: PlanLayout,
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): PlanHit | null {
  let t = coveredUntil(a, b, plan.clear, a.y, b.y);
  let nx = 0;
  let nz = 0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (t < 1 - 1e-6) {
    // the wall it leaves through: the side of the box it was last in
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    let best = Infinity;
    for (const { box } of plan.clear) {
      if (!inBox(box, px, pz, 0.02)) continue;
      const cands: [number, number, number][] = [
        [Math.abs(px - box.x0), 1, 0],
        [Math.abs(px - box.x1), -1, 0],
        [Math.abs(pz - box.z0), 0, 1],
        [Math.abs(pz - box.z1), 0, -1],
      ];
      for (const [d, cx, cz] of cands) {
        // leaving through this side: moving against its inward normal
        if (d < best && cx * dx + cz * dz < 0) {
          best = d;
          nx = cx;
          nz = cz;
        }
      }
    }
    if (!nx && !nz) {
      if (Math.abs(dx) > Math.abs(dz)) nx = dx > 0 ? -1 : 1;
      else nz = dz > 0 ? -1 : 1;
    }
  } else t = Infinity;
  // free-standing walls: solid boxes up to their height
  for (const w of plan.partitions) {
    const s = clipToBox(a.x, a.z, b.x, b.z, w);
    if (!s || s[0] >= t) continue;
    const y = a.y + (b.y - a.y) * s[0];
    if (y > w.height) continue;
    t = s[0];
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const e = [Math.abs(px - w.x0), Math.abs(px - w.x1), Math.abs(pz - w.z0), Math.abs(pz - w.z1)];
    const i = e.indexOf(Math.min(...e));
    nx = i === 0 ? -1 : i === 1 ? 1 : 0;
    nz = i === 2 ? -1 : i === 3 ? 1 : 0;
  }
  if (t === Infinity || t >= 1 - 1e-6) return null;
  return { t, x: a.x + dx * t, y: a.y + (b.y - a.y) * t, z: a.z + dz * t, nx, nz };
}

/** Hop counts and first doors between every two zones (breadth first; a shut door joins nothing). */
export function planRoutes(zones: number, doors: PlanDoor[]): { hops: number[][]; via: number[][] } {
  const adj: { to: number; door: number }[][] = Array.from({ length: zones }, () => []);
  doors.forEach((d, i) => {
    if (d.b < 0) return;
    adj[d.a].push({ to: d.b, door: i });
    adj[d.b].push({ to: d.a, door: i });
  });
  const hops = Array.from({ length: zones }, () => new Array<number>(zones).fill(Infinity));
  const via = Array.from({ length: zones }, () => new Array<number>(zones).fill(-1));
  for (let s = 0; s < zones; s++) {
    hops[s][s] = 0;
    const queue = [s];
    // first[n]: the door taken out of s on the shortest way to n
    const first = new Array<number>(zones).fill(-1);
    for (let qi = 0; qi < queue.length; qi++) {
      const at = queue[qi];
      for (const { to, door } of adj[at]) {
        if (hops[s][to] !== Infinity) continue;
        hops[s][to] = hops[s][at] + 1;
        first[to] = at === s ? door : first[at];
        queue.push(to);
      }
    }
    for (let n = 0; n < zones; n++) via[s][n] = first[n];
  }
  return { hops, via };
}
