// A real building's rooms (src/lib/spaces.ts) as a gallery layout: the plan the visitor walks (plan-nav.ts), and
// each room's works hung on its own walls, clear of its doors. A room of the space takes the works of one section
// (Painting.section: the room's place in the space); a work the space pins hangs at its own place (the Mona Lisa
// on its free-standing wall), the rest fill the walls in their order from one end of the room to the other.

import type { Painting } from "@/lib/types";
import type { Space, SpaceRoom, SpaceSide } from "@/lib/spaces";
import {
  BODY_RADIUS,
  EYE,
  MIN_BOTTOM,
  ROPED_VIEWS,
  TRACK_DROP,
  TRACK_INSET,
  WALL_GAP,
  WALL_MARGIN,
  canvasSize,
  frameAllowance,
  labelReach,
  ropeOff,
  type Barrier,
  type Furnishing,
  type FurnishSizes,
  type GalleryLayout,
  type Placement,
  type SuiteRoom,
} from "./layout";
import {
  planRoutes,
  type Box,
  type PlanArch,
  type PlanColumn,
  type PlanDoor,
  type PlanEntry,
  type PlanLayout,
  type PlanNiche,
  type PlanPartition,
  type PlanPhoto,
  type PlanShell,
  type PlanShrine,
  type PlanZone,
  type Side,
} from "./plan-nav";

export interface PlanOptions {
  /** Each room's furniture to arrange (its style's, furniture.ts furnishSizes), by the room's place in the space. */
  furnish?: (FurnishSizes | undefined)[];
  /** Where each room's spots hang (from its ceiling, MuseumApp): how far in from the walls, and how high. */
  rails?: ({ inset: number; y: number } | undefined)[];
}

/** Clear wall between one work's footprint (frame and label) and the next, and beside a door's case. */
const AIR = 1.1;
const DOOR_CLEAR = 0.55;
const CORNER_CLEAR = 0.7;
/** A shut door's depth (the wall it stands in), and an entrance's. */
const SHUT_DEPTH = 0.9;
/** The columns under an arch across a gallery, two a side one behind the other along it: their radius, how far
 *  out from the wall their axis stands, how far apart along the gallery; the entablature they carry (its height:
 *  the arch springs from its top, the wall's cornice), how far it reaches past them toward the middle of the
 *  room, how far the arch rises for its half span; the block of marble they stand on (how far it reaches past
 *  them along the gallery and toward the middle); the wall kept clear of works either side of the arch. */
export const COLUMN = { r: 0.34, out: 1.6, apart: 1.9, entablature: 1.45, reach: 0.3, rise: 0.62, plinth: 0.72, clear: 2.5 };
/** A bay of marble beside an arch's columns (two pilasters, a niche): how far from the arch along the wall, and
 *  half its width. */
export const NICHE = { off: 7.0, half: 1.35 };

const OPPOSITE: Record<Side, Side> = { n: "s", s: "n", w: "e", e: "w" };
/** The way a wall's face looks (into its room), as a turn about y (Placement.rotationY). */
const FACING: Record<Side, number> = { n: 0, w: Math.PI / 2, s: Math.PI, e: -Math.PI / 2 };
/** Along a wall, the works' local +x (their label side) runs: +1 with the coordinate (x or z), −1 against it. */
const T_SIGN: Record<Side, 1 | -1> = { n: 1, s: -1, w: -1, e: 1 };

const horizontal = (s: Side) => s === "n" || s === "s";

/** A stretch of wall works may hang on: in a zone, on one of its sides (or on a free-standing wall's face), from
 *  a to b along the wall (x or z), the wall's face at `plane`. */
interface Run {
  zone: number;
  side: Side;
  a: number;
  b: number;
  plane: number;
  /** A free-standing wall's face; `pinsOnly`: only works pinned to it hang there. */
  wall?: string;
  pinsOnly?: boolean;
  /** How high the wall is here. */
  top: number;
  hung: Hung[];
}
interface Hung {
  painting: Painting;
  w: number;
  h: number;
  /** Footprint before and after its centre along the works' local +x. */
  left: number;
  right: number;
  order: number;
  /** A pinned work's centre along the wall (x or z). */
  at?: number;
  /** A work hung above this one (a palace gallery hangs its smaller pictures two high, a salon its great ones). */
  over?: Hung;
}

/** Works this small hang two high (m), the lower one's centre, and the wall between the two frames. */
const STACK = { h: 1.15, w: 1.45 };
const STACK_EYE = 1.3;
const STACK_GAP = 0.22;
/** Two rows of great canvases: the wall between an upper frame and the cornice, and between the two rows. */
const ROW_TOP = 0.4;
const ROW_GAP = 0.3;

/** A bay's works with its small ones paired, one above the other, where two follow each other and the wall is
 *  high enough: each pair takes one place on the wall. `rows`: any two that fit under the cornice, the wider
 *  below. */
function stacked(works: Hung[], wallHeight: number, rows: boolean, minBottom: number): Hung[] {
  if (wallHeight < 4.6) return works;
  const small = (hw: Hung) => hw.h <= STACK.h && hw.w <= STACK.w;
  const framed = (hw: Hung) => hw.h + 2 * frameAllowance(hw.w, hw.h);
  const out: Hung[] = [];
  for (let i = 0; i < works.length; i++) {
    const a = works[i];
    const b = works[i + 1];
    if (b && rows && !(small(a) && small(b))) {
      const [lo, up] = a.w >= b.w ? [a, b] : [b, a];
      const fits = Math.max(minBottom, EYE - lo.h / 2) + framed(lo) + ROW_GAP + framed(up) + ROW_TOP <= wallHeight;
      if (fits && up.w >= lo.w * 0.35) {
        out.push({ ...lo, order: Math.min(a.order, b.order), over: up, left: Math.max(lo.left, up.left), right: Math.max(lo.right, up.right) });
        i++;
        continue;
      }
    }
    if (b && small(a) && small(b)) {
      out.push({ ...a, over: b, left: Math.max(a.left, b.left), right: Math.max(a.right, b.right) });
      i++;
    } else out.push(a);
  }
  return out;
}

export function buildPlanLayout(space: Space, paintings: Painting[], opts: PlanOptions = {}): GalleryLayout {
  const round = (v: number) => +v.toFixed(3);

  // ---- the rooms, and their zones (a long gallery's bays)
  const shells: PlanShell[] = space.rooms.map((r, index) => ({
    index,
    id: r.id,
    name: r.name,
    x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1,
    height: r.h,
    zones: [],
    alongX: r.x1 - r.x0 > r.z1 - r.z0,
    rail: opts.rails?.[index] ?? { inset: TRACK_INSET, y: r.h - TRACK_DROP },
  }));
  const zones: PlanZone[] = [];
  const doors: PlanDoor[] = [];
  space.rooms.forEach((r, si) => {
    const sh = shells[si];
    const len = sh.alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    const n = r.bay ? Math.max(1, Math.round(len / r.bay)) : 1;
    // the works begin at one end of the long axis: the zones run from there
    const from: SpaceSide = r.from ?? (sh.alongX ? "w" : "n");
    const back = from === "e" || from === "s";
    for (let i = 0; i < n; i++) {
      const k = back ? n - 1 - i : i;
      const lo = (len * k) / n;
      const hi = (len * (k + 1)) / n;
      const box: Box = sh.alongX
        ? { x0: round(r.x0 + lo), x1: round(r.x0 + hi), z0: r.z0, z1: r.z1 }
        : { x0: r.x0, x1: r.x1, z0: round(r.z0 + lo), z1: round(r.z0 + hi) };
      const open: PlanZone["open"] = {};
      const [first, lastSide]: [Side, Side] = sh.alongX ? ["w", "e"] : ["n", "s"];
      if (k > 0) open[first] = true;
      if (k < n - 1) open[lastSide] = true;
      const index = zones.length;
      zones.push({ ...box, index, shell: si, open });
      sh.zones.push(index);
      if (i > 0) {
        // the bay line between this zone and the one before it
        const prev = zones[index - 1];
        const side: Side = sh.alongX ? (back ? "w" : "e") : back ? "n" : "s";
        const line = sh.alongX ? (back ? prev.x0 : prev.x1) : back ? prev.z0 : prev.z1;
        doors.push({
          a: index - 1, b: index, side,
          at: sh.alongX ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2,
          half: (sh.alongX ? r.z1 - r.z0 : r.x1 - r.x0) / 2,
          height: r.h, arch: 0, bay: true,
          box: sh.alongX ? { x0: line, x1: line, z0: r.z0, z1: r.z1 } : { x0: r.x0, x1: r.x1, z0: line, z1: line },
        });
      }
    }
  });

  const shellOf = (id: string) => shells.find((s) => s.id === id);
  /** The zone of a room at a place along one of its walls. */
  const zoneAlong = (sh: PlanShell, side: Side, at: number): number => {
    for (const zi of sh.zones) {
      const z = zones[zi];
      if (horizontal(side) ? at >= z.x0 && at <= z.x1 : at >= z.z0 && at <= z.z1) return zi;
    }
    return sh.zones[0];
  };
  const faceOf = (b: Box, side: Side) => (side === "n" ? b.z0 : side === "s" ? b.z1 : side === "w" ? b.x0 : b.x1);
  /** How near its walls a room lets one stand: behind its cord or rail, where it has one. */
  const margin = (si: number) => {
    const g = space.rooms[si].look?.room?.guard;
    return g ? Math.max(WALL_MARGIN, g.out + BODY_RADIUS + 0.05) : WALL_MARGIN;
  };

  // ---- the doors
  let entry: PlanEntry | null = null;
  let entryDoor: PlanDoor | null = null;
  for (const d of space.doors) {
    const sh = shellOf(d.room);
    if (!sh) continue;
    const to = d.to ? shellOf(d.to) : null;
    if (d.to && !to) continue;
    const a = zoneAlong(sh, d.side, d.at);
    const b = to ? zoneAlong(to, OPPOSITE[d.side], d.at) : -1;
    const near = faceOf(sh, d.side);
    // out through the wall: to the room beyond, or as deep as the wall
    const out = d.side === "n" || d.side === "w" ? -1 : 1;
    const far = to ? faceOf(to, OPPOSITE[d.side]) : near + out * SHUT_DEPTH;
    const half = d.w / 2;
    const box: Box = horizontal(d.side)
      ? { x0: d.at - half, x1: d.at + half, z0: Math.min(near, far), z1: Math.max(near, far) }
      : { x0: Math.min(near, far), x1: Math.max(near, far), z0: d.at - half, z1: d.at + half };
    const door: PlanDoor = {
      a, b, side: d.side, at: d.at, half, height: d.h,
      arch: d.arch ? Math.min(half * 0.9, d.h - 2.4) : 0, box, bay: false, window: !!d.window && !to,
    };
    doors.push(door);
    if (d.entrance && !entry) {
      // just inside the door, and a few steps on, facing into the room
      const yaw = d.side === "n" ? Math.PI : d.side === "s" ? 0 : d.side === "w" ? -Math.PI / 2 : Math.PI / 2;
      const inX = d.side === "w" ? 1 : d.side === "e" ? -1 : 0;
      const inZ = d.side === "n" ? 1 : d.side === "s" ? -1 : 0;
      const px = horizontal(d.side) ? d.at : near;
      const pz = horizontal(d.side) ? near : d.at;
      const walk = Math.max(3.1, margin(sh.index) + 1.6);
      entry = {
        x: round(px + inX * 0.85), z: round(pz + inZ * 0.85),
        spawnX: round(px + inX * walk), spawnZ: round(pz + inZ * walk),
        yaw, zone: a,
      };
      entryDoor = door;
    }
  }
  if (!entry) {
    const z = zones[0];
    entry = { x: (z.x0 + z.x1) / 2, z: z.z1 - 0.85, spawnX: (z.x0 + z.x1) / 2, spawnZ: z.z1 - 3.1, yaw: 0, zone: 0 };
  }

  // ---- free-standing walls, and the columns under a gallery's arches
  const walls: (PlanPartition & { id: string; hang: boolean })[] = space.walls.flatMap((w) => {
    const sh = shellOf(w.room);
    return sh ? [{ id: w.id, shell: sh.index, x0: w.x0, x1: w.x1, z0: w.z0, z1: w.z1, height: w.h, portal: !!w.portal, hang: !!w.hang }] : [];
  });
  const partitions: PlanPartition[] = [...walls];
  const columns: PlanColumn[] = [];
  const arches: PlanArch[] = [];
  const niches: PlanNiche[] = [];
  space.rooms.forEach((r, si) => {
    const sh = shells[si];
    // at each bay line, or where the space says
    const lines: { at: number; marble?: string }[] =
      r.arches === "bays"
        ? sh.zones.slice(1).map((zi) => {
            const a = zones[zi];
            const b = zones[zi - 1];
            return { at: sh.alongX ? (a.x0 === b.x1 ? a.x0 : a.x1) : a.z0 === b.z1 ? a.z0 : a.z1 };
          })
        : (r.arches ?? []).map((a) => (typeof a === "number" ? { at: a } : a));
    const W = sh.alongX ? r.z1 - r.z0 : r.x1 - r.x0;
    const half = W / 2 - COLUMN.out - COLUMN.reach;
    const top = r.h - COLUMN.entablature;
    const plinth = r.look?.room?.pedestal?.height ?? 0;
    const lo = sh.alongX ? r.z0 : r.x0;
    const hi = sh.alongX ? r.z1 : r.x1;
    for (const line of lines) {
      const at = line.at;
      arches.push({ shell: si, at, half, spring: r.h, rise: Math.min(half, half * COLUMN.rise), depth: COLUMN.apart / 2 + 0.4, marble: line.marble });
      for (const wall of [-1, 1]) {
        const across = wall < 0 ? lo + COLUMN.out : hi - COLUMN.out;
        for (const along of [-COLUMN.apart / 2, COLUMN.apart / 2]) {
          columns.push({
            x: round(sh.alongX ? at + along : across), z: round(sh.alongX ? across : at + along),
            r: COLUMN.r, shell: si, height: top, marble: line.marble,
          });
        }
        // the block the pair stands on, from the wall out past them: nothing walks through it
        if (plinth > 0) {
          const a0 = at - COLUMN.apart / 2 - COLUMN.plinth;
          const a1 = at + COLUMN.apart / 2 + COLUMN.plinth;
          const c0 = wall < 0 ? lo : hi - COLUMN.out - COLUMN.plinth;
          const c1 = wall < 0 ? lo + COLUMN.out + COLUMN.plinth : hi;
          partitions.push({
            shell: si, height: plinth, portal: false, plinth: true,
            ...(sh.alongX ? { x0: a0, x1: a1, z0: c0, z1: c1 } : { x0: c0, x1: c1, z0: a0, z1: a1 }),
          });
        }
        // a bay of marble with a niche either side of the columns
        if (r.look?.room?.nicheBays) {
          const side: Side = sh.alongX ? (wall < 0 ? "n" : "s") : wall < 0 ? "w" : "e";
          const ends = sh.alongX ? [r.x0, r.x1] : [r.z0, r.z1];
          for (const s of [-1, 1]) {
            const mid = at + s * NICHE.off;
            if (mid - NICHE.half < ends[0] + 1 || mid + NICHE.half > ends[1] - 1) continue;
            niches.push({ shell: si, side, at: round(mid), half: NICHE.half, height: top });
          }
        }
      }
    }
  });

  // ---- where one may stand, and where a line of sight may run
  const allowed: Box[] = zones.map((z) => {
    const m = margin(z.shell);
    return {
      x0: z.x0 + (z.open.w ? 0 : m), x1: z.x1 - (z.open.e ? 0 : m),
      z0: z.z0 + (z.open.n ? 0 : m), z1: z.z1 - (z.open.s ? 0 : m),
    };
  });
  const clear: PlanLayout["clear"] = zones.map((z) => ({ box: { x0: z.x0, x1: z.x1, z0: z.z0, z1: z.z1 }, top: Infinity }));
  for (const d of doors) {
    if (d.bay) continue;
    const slim = d.half - BODY_RADIUS;
    const ma = margin(zones[d.a].shell) + 0.05;
    if (d.b < 0) {
      if (d !== entryDoor) continue;
      // the way in: from the door to the room's standing ground
      const face = faceOf(shells[zones[d.a].shell], d.side);
      const into = d.side === "n" || d.side === "w" ? 1 : -1;
      const lo = Math.min(face, face + into * ma);
      const hi = Math.max(face, face + into * ma);
      allowed.push(horizontal(d.side) ? { x0: d.at - slim, x1: d.at + slim, z0: lo, z1: hi } : { x0: lo, x1: hi, z0: d.at - slim, z1: d.at + slim });
      continue;
    }
    // the passage reaches each room's own standing ground (past its cord, where it has one); the room the door
    // is named in lies on the far side of the opening's box when its wall is the north or west one
    const mb = margin(zones[d.b].shell) + 0.05;
    const aHigh = d.side === "n" || d.side === "w";
    const lowReach = aHigh ? mb : ma;
    const highReach = aHigh ? ma : mb;
    allowed.push(
      horizontal(d.side)
        ? { x0: d.at - slim, x1: d.at + slim, z0: d.box.z0 - lowReach, z1: d.box.z1 + highReach }
        : { x0: d.box.x0 - lowReach, x1: d.box.x1 + highReach, z0: d.at - slim, z1: d.at + slim }
    );
    clear.push({
      box: horizontal(d.side)
        ? { x0: d.box.x0, x1: d.box.x1, z0: d.box.z0 - 0.01, z1: d.box.z1 + 0.01 }
        : { x0: d.box.x0 - 0.01, x1: d.box.x1 + 0.01, z0: d.box.z0, z1: d.box.z1 },
      top: d.height - d.arch * 0.5,
    });
  }
  const { hops, via } = planRoutes(zones.length, doors);
  const shrines: PlanShrine[] = [];
  const photos: PlanPhoto[] = (space.photos ?? []).flatMap((p) => {
    const sh = shellOf(p.room);
    const three = (v: number | [number, number, number] | undefined, d: number): [number, number, number] => (Array.isArray(v) ? v : [v ?? d, v ?? d, v ?? d]);
    return sh
      ? [{ shell: sh.index, src: p.src, size: p.size, eye: p.eye, yaw: p.yaw, pitch: p.pitch, roll: p.roll, fov: p.fov, black: three(p.black, 0), gain: three(p.gain, 1), on: p.on }]
      : [];
  });
  const plan: PlanLayout = { id: space.id, shells, zones, doors, partitions, columns, arches, niches, shrines, photos, entry, allowed, clear, hops, via };

  // ---- the walls works hang on: each zone's sides, less its doors, its corners, the columns and niches, and
  // where a free-standing wall meets them
  const runs: Run[] = [];
  for (const z of zones) {
    const sh = shells[z.shell];
    for (const side of ["n", "e", "s", "w"] as Side[]) {
      if (z.open[side]) continue;
      const along = horizontal(side);
      // closed corners keep some wall clear; an open end (the next bay) half the air between works
      const endClear = (end: Side) => (z.open[end] ? AIR / 2 : CORNER_CLEAR);
      const lo = (along ? z.x0 : z.z0) + endClear(along ? "w" : "n");
      const hi = (along ? z.x1 : z.z1) - endClear(along ? "e" : "s");
      const holes: [number, number][] = [];
      // every door of the room in this wall (one of the next bay may reach over the bay line)
      for (const d of doors) {
        if (d.bay) continue;
        const za = zones[d.a];
        const zb = d.b >= 0 ? zones[d.b] : null;
        const near = (za.shell === z.shell && d.side === side) || (zb && zb.shell === z.shell && OPPOSITE[d.side] === side);
        if (near) holes.push([d.at - d.half - DOOR_CLEAR, d.at + d.half + DOOR_CLEAR]);
      }
      // the long walls stay clear behind an arch's columns, and where a bay of marble stands
      if (along === sh.alongX) {
        for (const a of arches) if (a.shell === z.shell) holes.push([a.at - COLUMN.apart / 2 - COLUMN.plinth - 0.5, a.at + COLUMN.apart / 2 + COLUMN.plinth + 0.5]);
      }
      for (const n of niches) if (n.shell === z.shell && n.side === side) holes.push([n.at - n.half - 0.45, n.at + n.half + 0.45]);
      // a free-standing wall that meets this one
      const face = faceOf(sh, side);
      for (const w of walls) {
        if (w.shell !== z.shell) continue;
        const touch = side === "n" ? w.z0 : side === "s" ? w.z1 : side === "w" ? w.x0 : w.x1;
        if (Math.abs(touch - face) < 0.08) holes.push(along ? [w.x0 - 0.5, w.x1 + 0.5] : [w.z0 - 0.5, w.z1 + 0.5]);
      }
      for (const [a, b] of cut([lo, hi], holes)) {
        if (b - a >= 1.2) runs.push({ zone: z.index, side, a, b, plane: face, top: sh.height, hung: [] });
      }
    }
  }
  // a free-standing wall's two long faces (the works pinned to them; the room's own, where it says so)
  for (const w of walls) {
    const sh = shells[w.shell];
    const zi = planZoneOf(zones, sh, w);
    const alongX = w.x1 - w.x0 >= w.z1 - w.z0;
    const post = w.portal ? 0.5 : 0.3;
    // an end that meets one of the room's walls keeps a corner's clearance
    const endA = alongX ? Math.abs(w.x0 - sh.x0) < 0.08 : Math.abs(w.z0 - sh.z0) < 0.08;
    const endB = alongX ? Math.abs(w.x1 - sh.x1) < 0.08 : Math.abs(w.z1 - sh.z1) < 0.08;
    const a = (alongX ? w.x0 : w.z0) + (endA ? CORNER_CLEAR : post);
    const b = (alongX ? w.x1 : w.z1) - (endB ? CORNER_CLEAR : post);
    const base = { zone: zi, a, b, wall: w.id, pinsOnly: !w.hang, top: w.height - (w.portal ? 0.4 : 0) };
    if (alongX) {
      // it runs along x: a face looking north (hung as on a south wall), one looking south
      runs.push({ ...base, side: "s", plane: w.z0, hung: [] });
      runs.push({ ...base, side: "n", plane: w.z1, hung: [] });
    } else {
      runs.push({ ...base, side: "e", plane: w.x0, hung: [] });
      runs.push({ ...base, side: "w", plane: w.x1, hung: [] });
    }
  }

  // ---- the works, room by room
  const sized = (p: Painting, order: number): Hung => {
    const { w, h } = canvasSize(p);
    return { painting: p, w, h, left: w / 2 + frameAllowance(w, h), right: w / 2 + labelReach(w, h), order };
  };
  const keyOf = (p: Painting) => `${p.artistSlug ?? ""}/${p.slug.includes("--") ? p.slug.slice(p.slug.indexOf("--") + 2) : p.slug}`;
  const bySection = new Map<number, Painting[]>();
  for (const p of paintings) {
    const s = p.section ?? 0;
    bySection.set(s, [...(bySection.get(s) ?? []), p]);
  }
  const minBottomOf = (room: SpaceRoom) => room.minBottom ?? (room.look?.room?.dado ? room.look.room.dado.height + 0.14 : MIN_BOTTOM);
  const shrineOf = new Set<Painting>();
  space.rooms.forEach((room, si) => {
    const sh = shells[si];
    const works = (bySection.get(si) ?? []).map(sized);
    if (!works.length) return;
    const mine = runs.filter((r) => zones[r.zone].shell === si);

    // the works with a place of their own (each takes its stretch of that wall, in whichever bays it reaches)
    const free: Hung[] = [];
    const taken: { side: Side; wall?: string; a: number; b: number }[] = [];
    for (const hw of works) {
      const pin = space.pins.find((p) => p.room === room.id && p.work === keyOf(hw.painting));
      if (!pin) {
        free.push(hw);
        continue;
      }
      // a room's wall "n" is hung as side n; a free-standing wall's face looking north is hung as on a south wall
      const side: Side = pin.wall ? OPPOSITE[pin.side] : pin.side;
      const cands = mine.filter((r) => r.side === side && (pin.wall ? r.wall === pin.wall : !r.wall));
      if (!cands.length) {
        free.push(hw);
        continue;
      }
      const lo = Math.min(...cands.map((r) => r.a));
      const hi = Math.max(...cands.map((r) => r.b));
      // where it is said to hang, kept on the wall
      const t = T_SIGN[side];
      const before = t > 0 ? hw.left : hw.right;
      const after = t > 0 ? hw.right : hw.left;
      const at = Math.min(Math.max(pin.at ?? (lo + hi) / 2, lo + before), Math.max(lo + before, hi - after));
      const off = (r: Run) => Math.max(r.a - at, 0, at - r.b);
      const run = cands.reduce((best, r) => (off(r) < off(best) ? r : best), cands[0]);
      run.hung.push({ ...hw, at });
      if (pin.shrine) shrineOf.add(hw.painting);
      taken.push({ side, wall: pin.wall, a: at - before - AIR, b: at + after + AIR });
    }
    // what is left of each run either side of the pinned works hangs the others
    const open: Run[] = [];
    for (const r of mine) {
      if (r.pinsOnly) continue;
      const holes = taken.filter((k) => k.side === r.side && k.wall === r.wall).map((k): [number, number] => [k.a, k.b]);
      for (const [a, b] of cut([r.a, r.b], holes)) if (b - a >= 1.2) open.push({ ...r, a, b, hung: [] });
    }

    // each zone its share of the others, by the wall it has; the largest first, each on the run with most room
    const order = sh.zones;
    const room_ = (r: Run) => r.b - r.a - r.hung.reduce((s, hw) => s + hw.left + hw.right + AIR, 0);
    const capacity = order.map((zi) => open.filter((r) => r.zone === zi).reduce((s, r) => s + (r.b - r.a), 0));
    const total = capacity.reduce((s, c) => s + c, 0) || 1;
    const fitsOn = (hw: Hung, r: Run) => {
      const tall = (x: Hung) => x.h + 2 * frameAllowance(x.w, x.h);
      return room_(r) >= hw.left + hw.right && (hw.over ? tall(hw) + tall(hw.over) + 1.2 : tall(hw) + 0.6) <= r.top;
    };
    let at = 0;
    let carried = 0;
    order.forEach((zi, k) => {
      const zoneRuns = open.filter((r) => r.zone === zi);
      carried += (free.length * capacity[k]) / total;
      const take = k === order.length - 1 ? free.length - at : Math.max(0, Math.round(carried) - at);
      const batch = stacked(free.slice(at, at + take), sh.height, room.rows === 2, minBottomOf(room));
      at += take;
      for (const hw of [...batch].sort((p, q) => q.left + q.right - (p.left + p.right))) {
        let best: Run | null = null;
        for (const r of zoneRuns) if (fitsOn(hw, r) && (!best || room_(r) > room_(best))) best = r;
        // no room in this bay: the next bays' walls
        if (!best) for (const r of open) if (fitsOn(hw, r) && (!best || room_(r) > room_(best))) best = r;
        if (best) best.hung.push(hw);
        else if (hw.over) {
          // the pair fits nowhere (a low free-standing wall): each alone
          for (const one of [{ ...hw, over: undefined }, hw.over]) {
            let b2: Run | null = null;
            for (const r of open) if (fitsOn(one, r) && (!b2 || room_(r) > room_(b2))) b2 = r;
            b2?.hung.push(one);
          }
        }
      }
    });
    runs.push(...open);
    // (the room's first runs stay, holding only the pinned works)
  });

  // ---- places: along each run in the works' order, spaced evenly
  const placements: Placement[] = [];
  const flow = (sh: PlanShell, room: SpaceRoom): 1 | -1 => {
    const from = room.from ?? (sh.alongX ? "w" : "n");
    return from === "e" || from === "s" ? -1 : 1;
  };
  for (const r of runs) {
    if (!r.hung.length) continue;
    const sh = shells[zones[r.zone].shell];
    const room = space.rooms[sh.index];
    const t = T_SIGN[r.side];
    const along = horizontal(r.side);
    const minBottom = minBottomOf(room);
    const hang = (hw: Hung, c: number, y: number) => {
      const nx = Math.sin(FACING[r.side]);
      const nz = Math.cos(FACING[r.side]);
      const pl: Placement = {
        painting: hw.painting,
        position: [round((along ? c : r.plane) + nx * WALL_GAP), round(y), round((along ? r.plane : c) + nz * WALL_GAP)],
        rotationY: FACING[r.side],
        w: hw.w,
        h: hw.h,
        room: r.zone,
        label: 1,
      };
      placements.push(pl);
      if (shrineOf.has(hw.painting)) shrines.push({ x: pl.position[0], y: pl.position[1], z: pl.position[2], rotationY: pl.rotationY, w: hw.w, h: hw.h, shell: sh.index });
    };
    const place = (hw: Hung, c: number) => {
      if (!hw.over) return hang(hw, c, Math.max(EYE, hw.h / 2 + minBottom));
      const up = hw.over;
      const small = hw.h <= STACK.h && up.h <= STACK.h;
      // two works, one above the other: small ones, the lower a little under eye level; great ones, the lower as
      // it would hang alone; the upper a hand above its frame
      const low = small ? Math.max(STACK_EYE, hw.h / 2 + minBottom) : Math.max(EYE, hw.h / 2 + minBottom);
      hang(hw, c, low);
      hang(up, c, low + hw.h / 2 + frameAllowance(hw.w, hw.h) + (small ? STACK_GAP : ROW_GAP) + frameAllowance(up.w, up.h) + up.h / 2);
    };
    const pinned = r.hung.filter((hw) => hw.at !== undefined);
    for (const hw of pinned) place(hw, hw.at!);
    const rest = r.hung.filter((hw) => hw.at === undefined);
    if (!rest.length) continue;
    // in the works' order along the room (a side wall), or left to right (an end wall)
    const sideWall = along === sh.alongX;
    const dir = sideWall ? flow(sh, room) : t;
    rest.sort((p, q) => (p.order - q.order) * dir);
    // now in increasing coordinate; each work's footprint below and above its centre
    const lo = (hw: Hung) => (t > 0 ? hw.left : hw.right);
    const hi = (hw: Hung) => (t > 0 ? hw.right : hw.left);
    const used = rest.reduce((s, hw) => s + hw.left + hw.right, 0);
    const span = r.b - r.a;
    const gap = rest.length > 1 ? Math.min(3.2, (span - used) / (rest.length - 1)) : 0;
    let cursor = r.a + (span - used - gap * (rest.length - 1)) / 2;
    for (const hw of rest) {
      const c = cursor + lo(hw);
      place(hw, c);
      cursor = c + hi(hw) + gap;
    }
  }
  // the best known work first (the doors wait for it), then as hung
  placements.sort((p, q) => {
    const sp = p.room === entry!.zone ? 0 : 1;
    const sq = q.room === entry!.zone ? 0 : 1;
    return sp - sq;
  });
  if (placements.length) {
    const inEntry = placements.filter((p) => p.room === entry!.zone);
    const pool = inEntry.length ? inEntry : placements;
    const star = pool.reduce((best, p) => ((p.painting.pageviews ?? -1) > (best.painting.pageviews ?? -1) ? p : best), pool[0]);
    placements.splice(placements.indexOf(star), 1);
    placements.unshift(star);
  }

  // ---- seating: down the middle of each bay that has the room, one piece or one every so many metres, clear of
  // the way in and of any free-standing wall
  const furniture: Furnishing[] = [];
  zones.forEach((z) => {
    const sizes = opts.furnish?.[z.shell];
    const sh = shells[z.shell];
    const every = space.rooms[z.shell].seatEvery;
    if (!sizes?.centre.length || every === 0) return;
    const long = sh.alongX ? z.x1 - z.x0 : z.z1 - z.z0;
    const wide = sh.alongX ? z.z1 - z.z0 : z.x1 - z.x0;
    const n = every ? Math.max(1, Math.round(long / every)) : 1;
    for (let k = 0; k < n; k++) {
      const index = (z.index + k) % Math.min(2, sizes.centre.length);
      const [w, d] = sizes.centre[index];
      if (long / n < d + 3 || wide < w + 4.6) continue;
      const mid = (sh.alongX ? z.x0 : z.z0) + (long * (k + 0.5)) / n;
      const cx = sh.alongX ? mid : (z.x0 + z.x1) / 2;
      const cz = sh.alongX ? (z.z0 + z.z1) / 2 : mid;
      if (Math.hypot(cx - entry!.spawnX, cz - entry!.spawnZ) < 4.5) continue;
      const reach = Math.max(w, d) / 2 + 1.3;
      if (partitions.some((p) => p.shell === z.shell && cx > p.x0 - reach && cx < p.x1 + reach && cz > p.z0 - reach && cz < p.z1 + reach)) continue;
      // not across an arch's columns
      if (arches.some((a) => a.shell === z.shell && Math.abs((sh.alongX ? cx : cz) - a.at) < d / 2 + a.depth + 1.5)) continue;
      const top = sizes.top?.[index];
      furniture.push({
        kind: "centre", index, position: [round(cx), round(cz)], rotation: sh.alongX ? Math.PI / 2 : 0, size: [w, d],
        room: z.index, tint: ((z.shell * 37 + 11) % 100) / 100, ...(top ? { top } : {}),
      });
    }
  });

  // ---- barriers: a rope before the most famous works in a room without a cord of its own; a curved rail before
  // a work behind glass
  const guarded = (pl: Placement) => !!space.rooms[zones[pl.room].shell].look?.room?.guard;
  const barriers: Barrier[] = placements
    .filter((pl) => (pl.painting.pageviews ?? 0) >= ROPED_VIEWS && !guarded(pl) && !shrineOf.has(pl.painting))
    .map(ropeOff);
  for (const s of shrines) {
    // an arc of rail some 3 m out, 5 m across, its ends turned back to the wall
    const nx = Math.sin(s.rotationY);
    const nz = Math.cos(s.rotationY);
    const R = 3.2;
    const posts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const a = -1.15 + (2.3 * i) / 12;
      posts.push([round(s.x + nz * R * Math.sin(a) + nx * (R * Math.cos(a) - 0.5)), round(s.z - nx * R * Math.sin(a) + nz * (R * Math.cos(a) - 0.5))]);
    }
    const xs = posts.map((p) => p[0]);
    const zs = posts.map((p) => p[1]);
    const zone = zones.find((z) => z.shell === s.shell)!.index;
    barriers.push({ posts, box: [Math.min(...xs, s.x), Math.max(...xs, s.x), Math.min(...zs, s.z), Math.max(...zs, s.z)], room: zone, rail: true });
  }
  const seats = furniture.flatMap((f) => opts.furnish?.[zones[f.room].shell]?.seats?.(f) ?? []);

  const rooms: SuiteRoom[] = zones.map((z) => {
    const years = placements.filter((p) => p.room === z.index).flatMap((p) => (typeof p.painting.year === "number" ? [p.painting.year] : []));
    return {
      index: z.index,
      z0: z.z0,
      z1: z.z1,
      halfWidth: (z.x1 - z.x0) / 2,
      cx: (z.x0 + z.x1) / 2,
      years: years.length ? [Math.min(...years), Math.max(...years)] : null,
      title: shells[z.shell].name,
    };
  });

  const xs = shells.flatMap((s) => [s.x0, s.x1]);
  const zs = shells.flatMap((s) => [s.z0, s.z1]);
  return {
    hallWidth: Math.max(...xs) - Math.min(...xs),
    hallLength: Math.max(...zs) - Math.min(...zs),
    wallHeight: Math.max(...shells.map((s) => s.height)),
    placements,
    furniture,
    barriers,
    seats,
    elevator: null,
    exits: null,
    rooms,
    doorways: [],
    screen: null,
    trackInset: TRACK_INSET,
    nook: null,
    plan,
  };
}

/** A stretch [lo, hi] less some holes: what is left, in order. */
function cut([lo, hi]: [number, number], holes: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let at = lo;
  for (const [a, b] of [...holes].sort((p, q) => p[0] - q[0])) {
    if (b <= at) continue;
    if (a >= hi) break;
    if (a > at) out.push([at, Math.min(a, hi)]);
    at = Math.max(at, b);
  }
  if (at < hi) out.push([at, hi]);
  return out;
}

/** The zone of a room a box lies in (by its centre). */
function planZoneOf(zones: PlanZone[], sh: PlanShell, b: Box): number {
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  return sh.zones.find((zi) => cx >= zones[zi].x0 && cx <= zones[zi].x1 && cz >= zones[zi].z0 && cz <= zones[zi].z1) ?? sh.zones[0];
}
