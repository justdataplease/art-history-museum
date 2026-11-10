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
  type PlanPartition,
  type PlanShell,
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
/** The columns under an arch across a gallery: their radius, how far out from the wall they stand, how far
 *  apart along it; the entablature they carry (its height, and how far it reaches past them); the wall kept clear
 *  of works either side of the arch. */
const COLUMN = { r: 0.34, out: 1.05, apart: 3.0, entablature: 0.9, reach: 0.5, clear: 2.5 };

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
  /** A free-standing wall's face: only works pinned to it hang there. */
  wall?: string;
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
  /** A small work hung above this one (a palace gallery hangs its smaller pictures two high). */
  over?: Hung;
}

/** Works this small hang two high (m), the lower one's centre, and the wall between the two frames. */
const STACK = { h: 1.15, w: 1.45 };
const STACK_EYE = 1.3;
const STACK_GAP = 0.22;

/** A bay's works with its small ones paired, one above the other, where two follow each other and the wall is
 *  high enough: each pair takes one place on the wall. */
function stacked(works: Hung[], wallHeight: number): Hung[] {
  if (wallHeight < 4.6) return works;
  const small = (hw: Hung) => hw.h <= STACK.h && hw.w <= STACK.w;
  const out: Hung[] = [];
  for (let i = 0; i < works.length; i++) {
    const lo = works[i];
    const up = works[i + 1];
    if (up && small(lo) && small(up)) {
      out.push({ ...lo, over: up, left: Math.max(lo.left, up.left), right: Math.max(lo.right, up.right) });
      i++;
    } else out.push(lo);
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

  // ---- the doors
  let entry: PlanEntry | null = null;
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
    doors.push({
      a, b, side: d.side, at: d.at, half, height: d.h,
      arch: d.arch ? Math.min(half * 0.9, d.h - 2.4) : 0, box, bay: false,
    });
    if (d.entrance && !entry) {
      // just inside the door, and a few steps on, facing into the room
      const yaw = d.side === "n" ? Math.PI : d.side === "s" ? 0 : d.side === "w" ? -Math.PI / 2 : Math.PI / 2;
      const inX = d.side === "w" ? 1 : d.side === "e" ? -1 : 0;
      const inZ = d.side === "n" ? 1 : d.side === "s" ? -1 : 0;
      const px = horizontal(d.side) ? d.at : near;
      const pz = horizontal(d.side) ? near : d.at;
      entry = {
        x: round(px + inX * 0.85), z: round(pz + inZ * 0.85),
        spawnX: round(px + inX * 3.1), spawnZ: round(pz + inZ * 3.1),
        yaw, zone: a,
      };
    }
  }
  if (!entry) {
    const z = zones[0];
    entry = { x: (z.x0 + z.x1) / 2, z: z.z1 - 0.85, spawnX: (z.x0 + z.x1) / 2, spawnZ: z.z1 - 3.1, yaw: 0, zone: 0 };
  }

  // ---- free-standing walls, and the columns under a gallery's arches
  const partitions: (PlanPartition & { id: string })[] = space.walls.flatMap((w) => {
    const sh = shellOf(w.room);
    return sh ? [{ id: w.id, shell: sh.index, x0: w.x0, x1: w.x1, z0: w.z0, z1: w.z1, height: w.h }] : [];
  });
  const columns: PlanColumn[] = [];
  const arches: PlanArch[] = [];
  space.rooms.forEach((r, si) => {
    const sh = shells[si];
    // at each bay line, or where the space says
    const lines =
      r.arches === "bays"
        ? sh.zones.slice(1).map((zi) => {
            const a = zones[zi];
            const b = zones[zi - 1];
            return sh.alongX ? (a.x0 === b.x1 ? a.x0 : a.x1) : a.z0 === b.z1 ? a.z0 : a.z1;
          })
        : r.arches ?? [];
    const W = sh.alongX ? r.z1 - r.z0 : r.x1 - r.x0;
    const half = W / 2 - COLUMN.out - COLUMN.reach;
    const spring = r.h - COLUMN.entablature;
    const rise = Math.min(half, (r.look?.room?.coveRise ?? r.look?.room?.coveRadius ?? 2.6) + COLUMN.entablature - 0.75);
    for (const at of lines) {
      arches.push({ shell: si, at, half, spring, rise, depth: COLUMN.apart / 2 + 0.5 });
      for (const along of [-COLUMN.apart / 2, COLUMN.apart / 2])
        for (const wall of [-1, 1]) {
          const across = wall < 0 ? (sh.alongX ? r.z0 : r.x0) + COLUMN.out : (sh.alongX ? r.z1 : r.x1) - COLUMN.out;
          columns.push({
            x: round(sh.alongX ? at + along : across), z: round(sh.alongX ? across : at + along),
            r: COLUMN.r, shell: si, height: spring - COLUMN.entablature,
          });
        }
    }
  });

  // ---- where one may stand, and where a line of sight may run
  const m = WALL_MARGIN;
  const allowed: Box[] = zones.map((z) => ({
    x0: z.x0 + (z.open.w ? 0 : m), x1: z.x1 - (z.open.e ? 0 : m),
    z0: z.z0 + (z.open.n ? 0 : m), z1: z.z1 - (z.open.s ? 0 : m),
  }));
  const clear: PlanLayout["clear"] = zones.map((z) => ({ box: { x0: z.x0, x1: z.x1, z0: z.z0, z1: z.z1 }, top: Infinity }));
  for (const d of doors) {
    if (d.bay || d.b < 0) continue;
    const reach = m + 0.05;
    const slim = d.half - BODY_RADIUS;
    allowed.push(
      horizontal(d.side)
        ? { x0: d.at - slim, x1: d.at + slim, z0: d.box.z0 - reach, z1: d.box.z1 + reach }
        : { x0: d.box.x0 - reach, x1: d.box.x1 + reach, z0: d.at - slim, z1: d.at + slim }
    );
    clear.push({
      box: horizontal(d.side)
        ? { x0: d.box.x0, x1: d.box.x1, z0: d.box.z0 - 0.01, z1: d.box.z1 + 0.01 }
        : { x0: d.box.x0 - 0.01, x1: d.box.x1 + 0.01, z0: d.box.z0, z1: d.box.z1 },
      top: d.height - d.arch * 0.5,
    });
  }
  const { hops, via } = planRoutes(zones.length, doors);
  const plan: PlanLayout = { id: space.id, shells, zones, doors, partitions, columns, arches, entry, allowed, clear, hops, via };

  // ---- the walls works hang on: each zone's sides, less its doors, its corners and the columns
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
      // the long walls stay clear behind an arch's columns
      if (along === sh.alongX) for (const a of arches) if (a.shell === z.shell) holes.push([a.at - COLUMN.clear, a.at + COLUMN.clear]);
      for (const [a, b] of cut([lo, hi], holes)) {
        if (b - a >= 1.2) runs.push({ zone: z.index, side, a, b, plane: faceOf(sh, side), hung: [] });
      }
    }
  }
  // a free-standing wall's two long faces (for the works pinned to them)
  for (const w of partitions) {
    const zi = planZoneOf(zones, shells[w.shell], w);
    if (w.x1 - w.x0 >= w.z1 - w.z0) {
      // it runs along x: a face looking north (hung as on a south wall), one looking south
      runs.push({ zone: zi, side: "s", a: w.x0 + 0.3, b: w.x1 - 0.3, plane: w.z0, wall: w.id, hung: [] });
      runs.push({ zone: zi, side: "n", a: w.x0 + 0.3, b: w.x1 - 0.3, plane: w.z1, wall: w.id, hung: [] });
    } else {
      runs.push({ zone: zi, side: "e", a: w.z0 + 0.3, b: w.z1 - 0.3, plane: w.x0, wall: w.id, hung: [] });
      runs.push({ zone: zi, side: "w", a: w.z0 + 0.3, b: w.z1 - 0.3, plane: w.x1, wall: w.id, hung: [] });
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
  space.rooms.forEach((room, si) => {
    const sh = shells[si];
    const works = (bySection.get(si) ?? []).map(sized);
    if (!works.length) return;
    const mine = runs.filter((r) => zones[r.zone].shell === si);

    // the works with a place of their own (each takes its stretch of that wall, in whichever bays it reaches)
    const free: Hung[] = [];
    const taken: { side: Side; a: number; b: number }[] = [];
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
      const at = pin.at ?? (lo + hi) / 2;
      const off = (r: Run) => Math.max(r.a - at, 0, at - r.b);
      const run = cands.reduce((best, r) => (off(r) < off(best) ? r : best), cands[0]);
      run.hung.push({ ...hw, at });
      const t = T_SIGN[side];
      if (!pin.wall) taken.push({ side, a: at - (t > 0 ? hw.left : hw.right) - AIR, b: at + (t > 0 ? hw.right : hw.left) + AIR });
    }
    // what is left of each run either side of the pinned works hangs the others
    const open: Run[] = [];
    for (const r of mine) {
      if (r.wall) continue;
      const holes = taken.filter((k) => k.side === r.side).map((k): [number, number] => [k.a, k.b]);
      for (const [a, b] of cut([r.a, r.b], holes)) if (b - a >= 1.2) open.push({ ...r, a, b, hung: [] });
    }

    // each zone its share of the others, by the wall it has; the largest first, each on the run with most room
    const order = sh.zones;
    const room_ = (r: Run) => r.b - r.a - r.hung.reduce((s, hw) => s + hw.left + hw.right + AIR, 0);
    const capacity = order.map((zi) => open.filter((r) => r.zone === zi).reduce((s, r) => s + (r.b - r.a), 0));
    const total = capacity.reduce((s, c) => s + c, 0) || 1;
    let at = 0;
    let carried = 0;
    order.forEach((zi, k) => {
      const zoneRuns = open.filter((r) => r.zone === zi);
      carried += (free.length * capacity[k]) / total;
      const take = k === order.length - 1 ? free.length - at : Math.max(0, Math.round(carried) - at);
      const batch = stacked(free.slice(at, at + take), sh.height);
      at += take;
      for (const hw of [...batch].sort((p, q) => q.left + q.right - (p.left + p.right))) {
        const need = hw.left + hw.right;
        let best: Run | null = null;
        for (const r of zoneRuns) if (room_(r) >= need && (!best || room_(r) > room_(best))) best = r;
        // no room in this bay: the next bays' walls
        if (!best) for (const r of open) if (room_(r) >= need && (!best || room_(r) > room_(best))) best = r;
        best?.hung.push(hw);
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
    const minBottom = room.minBottom ?? (room.look?.room?.dado ? room.look.room.dado.height + 0.14 : MIN_BOTTOM);
    const hang = (hw: Hung, c: number, y: number) => {
      const nx = Math.sin(FACING[r.side]);
      const nz = Math.cos(FACING[r.side]);
      placements.push({
        painting: hw.painting,
        position: [round((along ? c : r.plane) + nx * WALL_GAP), round(y), round((along ? r.plane : c) + nz * WALL_GAP)],
        rotationY: FACING[r.side],
        w: hw.w,
        h: hw.h,
        room: r.zone,
        label: 1,
      });
    };
    const place = (hw: Hung, c: number) => {
      if (!hw.over) return hang(hw, c, Math.max(EYE, hw.h / 2 + minBottom));
      // two small works, one above the other: the lower a little under eye level, the upper a hand above its frame
      const low = Math.max(STACK_EYE, hw.h / 2 + minBottom);
      hang(hw, c, low);
      const up = hw.over;
      hang(up, c, low + hw.h / 2 + frameAllowance(hw.w, hw.h) + STACK_GAP + frameAllowance(up.w, up.h) + up.h / 2);
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

  // ---- seating: a piece down the middle of each bay that has the room (none where a free-standing wall stands)
  const furniture: Furnishing[] = [];
  zones.forEach((z) => {
    const sizes = opts.furnish?.[z.shell];
    const sh = shells[z.shell];
    if (!sizes?.centre.length || partitions.some((w) => w.shell === z.shell)) return;
    const index = z.index % Math.min(2, sizes.centre.length);
    const [w, d] = sizes.centre[index];
    const long = sh.alongX ? z.x1 - z.x0 : z.z1 - z.z0;
    const wide = sh.alongX ? z.z1 - z.z0 : z.x1 - z.x0;
    if (long < d + 9 || wide < w + 6.5) return;
    const cx = (z.x0 + z.x1) / 2;
    const cz = (z.z0 + z.z1) / 2;
    // clear of the way in
    if (Math.hypot(cx - entry!.spawnX, cz - entry!.spawnZ) < 4.5) return;
    const top = sizes.top?.[index];
    furniture.push({
      kind: "centre", index, position: [round(cx), round(cz)], rotation: sh.alongX ? Math.PI / 2 : 0, size: [w, d],
      room: z.index, tint: ((z.shell * 37 + 11) % 100) / 100, ...(top ? { top } : {}),
    });
  });

  const barriers = placements.filter((pl) => (pl.painting.pageviews ?? 0) >= ROPED_VIEWS).map(ropeOff);
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
