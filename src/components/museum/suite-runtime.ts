// What the visitor's position decides, frame by frame, in a gallery of one
// or more rooms:
//
// - Spotlight pool. Every track head is planned up front (exhibit-lights.ts),
//   but only a FIXED number of THREE.SpotLights exist: three.js sizes its
//   light uniforms (and so every lit program) by the light count, so the
//   count must never change at runtime, and each light costs every lit
//   fragment its cone test. A single room gets one light per head, all lit
//   for good (exactly as before the pool). A suite gets at most POOL_MAX,
//   handed to the heads that matter from where the visitor stands: the
//   flagship (the vista), the visitor's room, then the nearest works along
//   the walking path that a doorway shows, so lights move ahead into the next
//   room as a doorway approaches. A light being handed over fades out, moves,
//   and fades in on its new work.
// - Texture tiers. A suite's works load as small thumbnails until the
//   visitor is near (their room, or a short walk away), then at wall
//   resolution; walking away again drops them back to the thumbnail, so GPU
//   memory stays bounded however long the suite. Before the doors open only
//   the entrance room (wall) and the flagship (thumbnail) load.
// - Portal culling. Rooms are seen only through the doorways: an exhibit in
//   another room whose plan-view footprint lies outside every doorway's
//   wedge from the camera is hidden (no draw calls, in the floor reflection
//   either: reflecting in a horizontal floor keeps a ray's plan direction).
// - Room windows. However long the suite, only the rooms around the visitor
//   exist on the GPU: the architecture of the current room +/- ARCH_REACH
//   (a draw range over the merged geometry), exhibits in full within
//   FULL_REACH rooms and as frame + canvas (thumbnail) within LITE_REACH,
//   none beyond (unmounted: their textures, placards and geometry freed).
//   The laylights' area lights are a pool too (AREA_POOL, following the
//   visitor), as is the room AO's set of cross walls.
// - The current room (with hysteresis inside the doorway), for the HUD and
//   the windows; teleport() jumps it for the room navigator.

import * as THREE from "three";
import { pathDistance, roomAt, type GalleryLayout, type Placement } from "./layout";
import type { LightPlan } from "./exhibit-geometry";
import type { ExhibitLights } from "./exhibit-lights";

/** Most spotlights a suite may have. Each costs every lit fragment a cone
 *  test and four uniform vectors (WebGL2 guarantees only 224 per shader). */
export const POOL_MAX = 16;
/** Lights kept free for cross-fades in a suite. None: with rooms of up to
 *  twelve works every light is worth more lit; a newcomer waits for the
 *  light it replaces to fade out (half a second) before it fades in. */
const SPARE = 0;
/** Extra walking distance charged to works outside the visitor's room... */
const ROOM_PENALTY = 3.5;
/** ...and to those no doorway shows from where the visitor stands. */
const HIDDEN_PENALTY = 10;
/** A lit work keeps its light until a rival is this much closer (m). */
const HYSTERESIS = 1.5;
/** Re-plan after the visitor has moved this far (m). */
const REPLAN_STEP = 0.2;
const FADE_IN_S = 0.9;
const FADE_OUT_S = 0.5;
/** Inspect: the focused work brightens, everything else dims. */
const FOCUS_GAIN = 1.3;
const DIM_GAIN = 0.07;
/** Wall resolution within this walk of the visitor (m); back to thumbnail beyond TIER_DOWN. */
const TIER_UP = 10;
const TIER_DOWN = 14;
/** Close-up resolution for works this near the visitor (m, plan view, same
 *  room), dropped again beyond NEAR_DOWN; at most NEAR_MAX works at a time. */
const NEAR_UP = 3.5;
const NEAR_DOWN = 5;
const NEAR_MAX = 3;
/** Plan-view distance from the wall at which a work is looked at. */
const VIEW_DIST = 1.8;
/** Culling slack (m): anything this close to a doorway's sightline still shows. */
const CULL_MARGIN = 0.1;
/** Rooms of architecture drawn either side of the visitor's. */
export const ARCH_REACH = 3;
/** Exhibits in full within this many rooms, as frame + canvas within LITE_REACH. */
export const FULL_REACH = 1;
export const LITE_REACH = 2;
/** Laylight area lights (each costs every lit fragment an LTC evaluation):
 *  the visitor's room, the one behind and the two ahead (seen down the
 *  enfilade). A suite of up to this many rooms keeps one per room for good. */
export const AREA_POOL = 4;
/** Eye height assumed before the camera reports in. */
const EYE = 1.65;

export type Tier = "none" | "thumb" | "wall" | "near";
/** An exhibit's level of detail: everything, or just its frame and canvas. */
export type Lod = "full" | "lite";

/** Level of detail of the exhibits in `room` with the visitor in `current` (null: not hung). */
export function lodAt(room: number, current: number): Lod | null {
  const d = Math.abs(room - current);
  return d <= FULL_REACH ? "full" : d <= LITE_REACH ? "lite" : null;
}

/** A laylight area light of the pool: which room it lights, and its fade. */
export interface AreaSlot {
  room: number;
  level: number;
  goal: 0 | 1;
}

type P2 = { x: number; z: number };
type P3 = { x: number; y: number; z: number };

export interface ExhibitState {
  readonly slug: string;
  readonly placement: Placement;
  readonly lights: ExhibitLights;
  /** Focus gain on its spots (1 at rest). */
  gain: number;
  /** Fade level of its spots, 0 (off) .. 1. */
  level: number;
  /** Texture tier wanted now. */
  tier: Tier;
  /** Doors-gate work: fetched first. */
  readonly gate: boolean;
}

interface Exhibit extends ExhibitState {
  index: number;
  isAnchor: boolean;
  view: P2;
  /** Plan view of the wall stretch it covers (frame, label, spot pool). */
  wall: [P2, P2];
  /** Its track heads' lenses (up by the ceiling: a doorway head can hide them). */
  lenses: P3[];
  /** Seen through the doorways from the last planned viewpoint. */
  seen: boolean;
  group: THREE.Object3D | null;
  tierSubs: Set<() => void>;
  heads: Head[];
}

interface Head {
  exhibit: Exhibit;
  plan: LightPlan;
  slot: Slot | null;
}

interface Slot {
  light: THREE.SpotLight;
  head: Head | null;
  level: number;
  goal: 0 | 1;
}

const ease = (t: number) => t * t * (3 - 2 * t);

export class SuiteRuntime {
  readonly layout: GalleryLayout;
  readonly suite: boolean;
  /** Spotlights and their targets: add once to the scene. */
  readonly root = new THREE.Group();
  readonly poolSize: number;
  private exhibits: Exhibit[];
  private bySlug = new Map<string, Exhibit>();
  private slots: Slot[] = [];
  private heads: Head[] = [];
  private lastPlan: P3 | null = null;
  private focus: string | null = null;
  private open = false;
  private room = 0;
  private roomSubs = new Set<(room: number) => void>();
  private windowSubs = new Set<() => void>();
  private settleFrames = 0;
  /** A jump (behind the navigator's fade): the next plan lights the new
   *  room at once instead of fading lights across. */
  private snap = false;
  /** The laylight area lights (Lighting reads them every frame). */
  readonly areaSlots: AreaSlot[] = [];

  constructor(
    layout: GalleryLayout,
    lights: ExhibitLights[],
    opts: { color: THREE.ColorRepresentation; gate: string[]; start: P2 },
  ) {
    this.layout = layout;
    this.suite = layout.rooms.length > 1;
    const gate = new Set(opts.gate);
    const W = layout.hallWidth;
    this.exhibits = layout.placements.map((pl, i) => {
      const nx = Math.sin(pl.rotationY);
      const nz = Math.cos(pl.rotationY);
      const [x, , z] = pl.position;
      const reach = pl.w / 2 + 0.75; // frame, placard and the spot's pool
      const along = { x: nz, z: -nx }; // along the wall
      const e: Exhibit = {
        index: i,
        slug: pl.painting.slug,
        placement: pl,
        lights: lights[i],
        gain: 1,
        level: this.suite ? 0 : 1,
        tier: this.suite ? (pl.room === 0 ? "wall" : i === 0 ? "thumb" : "none") : "wall",
        gate: gate.has(pl.painting.slug),
        isAnchor: i === 0,
        view: {
          x: THREE.MathUtils.clamp(x + nx * VIEW_DIST, -W / 2 + 0.6, W / 2 - 0.6),
          z: z + nz * VIEW_DIST,
        },
        wall: [
          { x: x + along.x * reach, z: z + along.z * reach },
          { x: x - along.x * reach, z: z - along.z * reach },
        ],
        lenses: lights[i].heads.map((l) => ({ x: l.plan.lens.x, y: l.plan.lens.y, z: l.plan.lens.z })),
        seen: true,
        group: null,
        tierSubs: new Set(),
        heads: [],
      };
      e.heads = lights[i].heads.map((plan) => ({ exhibit: e, plan, slot: null }));
      this.heads.push(...e.heads);
      this.bySlug.set(e.slug, e);
      return e;
    });

    this.poolSize = this.suite ? Math.min(POOL_MAX, this.heads.length) : this.heads.length;
    for (let i = 0; i < this.poolSize; i++) {
      const light = new THREE.SpotLight(opts.color, 0, 0, 0.3, 0.3, 2);
      light.castShadow = false;
      light.position.set(0, layout.wallHeight, 0);
      light.target.position.set(0, 0, 0);
      this.root.add(light, light.target);
      this.slots.push({ light, head: null, level: 0, goal: 0 });
    }
    // light the starting view at full strength (behind the closed doors)
    this.room = roomAt(layout, opts.start.z);
    const nArea = Math.min(layout.rooms.length, AREA_POOL);
    for (const room of this.areaRooms(nArea)) this.areaSlots.push({ room, level: 1, goal: 1 });
    this.plan({ x: opts.start.x, y: EYE, z: opts.start.z });
    for (const s of this.slots) {
      if (s.head && s.goal === 1) s.level = 1;
    }
    this.apply();
    this.root.updateMatrixWorld(true);
  }

  // --------------------------------------------------------------- queries

  state(slug: string): ExhibitState | undefined {
    return this.bySlug.get(slug);
  }

  /** The room the visitor is in (doorway hysteresis applied). */
  currentRoom(): number {
    return this.room;
  }

  onRoomChange(cb: (room: number) => void): () => void {
    this.roomSubs.add(cb);
    return () => {
      this.roomSubs.delete(cb);
    };
  }

  /** The room windows moved (the current room changed). */
  onWindowChange(cb: () => void): () => void {
    this.windowSubs.add(cb);
    return () => {
      this.windowSubs.delete(cb);
    };
  }

  /** Rooms whose architecture is drawn: [first, last]. */
  archWindow(): [number, number] {
    const n = this.layout.rooms.length;
    return [Math.max(0, this.room - ARCH_REACH), Math.min(n - 1, this.room + ARCH_REACH)];
  }

  /** Level of detail of the exhibits in `room` now (null: not mounted). */
  lodOf(room: number): Lod | null {
    return lodAt(room, this.room);
  }

  /** First cross wall of the room AO's window (CROSS_SLOTS walls from here). */
  crossFirst(slots: number): number {
    return Math.max(0, Math.min(this.layout.doorways.length - slots, this.room - Math.floor(slots / 2)));
  }

  /** Jump to another room (the navigator): the camera is moved by the
   *  caller, the view is faded out meanwhile, so the new room's lights come
   *  up at once (settled() tells when the fade may clear). */
  teleport(room: number): void {
    const r = Math.max(0, Math.min(this.layout.rooms.length - 1, room));
    if (r === this.room) return;
    this.snap = true;
    this.setRoom(r);
  }

  /** Nothing is fading (spots, laylights) and the lights are planned for
   *  where the visitor stands: the room is as lit as it will get. */
  settled(): boolean {
    if (this.lastPlan === null || this.snap) return false;
    for (const s of this.slots) if (s.head && s.level !== s.goal) return false;
    for (const s of this.areaSlots) if (s.level !== s.goal) return false;
    return true;
  }

  subscribeTier(slug: string, cb: () => void): () => void {
    const e = this.bySlug.get(slug);
    if (!e) return () => {};
    e.tierSubs.add(cb);
    return () => {
      e.tierSubs.delete(cb);
    };
  }

  tier(slug: string): Tier {
    return this.bySlug.get(slug)?.tier ?? "wall";
  }

  /** An exhibit's root group, hidden while out of sight. */
  attach(slug: string, group: THREE.Object3D | null): void {
    const e = this.bySlug.get(slug);
    if (!e) return;
    e.group = group;
    if (group) group.visible = e.seen;
  }

  // ------------------------------------------------------------- controls

  setFocus(slug: string | null): void {
    this.focus = slug;
    this.lastPlan = null;
  }

  /** The doors are opening: everything beyond the entrance room may load. */
  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.lastPlan = null;
  }

  /**
   * Per rendered frame, after the camera has moved. Returns true while
   * something is still fading (render another frame).
   */
  update(cam: THREE.Vector3, dt: number): boolean {
    const p = { x: cam.x, y: cam.y, z: cam.z };
    this.trackRoom(p);
    const last = this.lastPlan;
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > REPLAN_STEP || Math.abs(p.y - last.y) > REPLAN_STEP) {
      this.plan(p);
    } else if (this.suite && (last.x !== p.x || last.z !== p.z || last.y !== p.y)) {
      this.cull(p);
    }
    const moving = this.animate(Math.min(dt, 0.1));
    if (moving) this.settleFrames = 2;
    else if (this.settleFrames > 0) this.settleFrames--;
    // a couple of frames past the last change, so readers (the exhibits'
    // shadows and lenses, updated before this) catch the final values
    return moving || this.settleFrames > 0;
  }

  dispose(): void {
    for (const s of this.slots) s.light.dispose();
    this.root.clear();
    this.roomSubs.clear();
    this.windowSubs.clear();
  }

  // ------------------------------------------------------------- internals

  private trackRoom(p: P3): void {
    const { doorways } = this.layout;
    let r = this.room;
    // change rooms only once clear of the doorway's depth
    while (r < doorways.length && p.z < doorways[r].z - doorways[r].thickness / 2) r++;
    while (r > 0 && p.z > doorways[r - 1].z + doorways[r - 1].thickness / 2) r--;
    if (r === this.room) return;
    this.setRoom(r);
  }

  private setRoom(r: number): void {
    this.room = r;
    this.lastPlan = null;
    this.assignArea();
    this.roomSubs.forEach((cb) => cb(r));
    this.windowSubs.forEach((cb) => cb());
  }

  /** The rooms the area lights belong to: one behind the visitor, the rest ahead. */
  private areaRooms(count: number): number[] {
    const n = this.layout.rooms.length;
    const lo = Math.max(0, Math.min(n - count, this.room - 1));
    return Array.from({ length: count }, (_, i) => lo + i);
  }

  /** Area lights leaving their room fade out; free ones move in and fade
   *  in (a jump switches them over at once). */
  private assignArea(): void {
    const want = this.areaRooms(this.areaSlots.length);
    for (const s of this.areaSlots) {
      s.goal = want.includes(s.room) ? 1 : 0;
      if (this.snap) s.level = s.goal;
    }
    for (const room of want) {
      if (this.areaSlots.some((s) => s.room === room)) continue;
      const free = this.areaSlots.find((s) => s.goal === 0 && s.level === 0);
      if (!free) break; // taken up once a light has faded out
      free.room = room;
      free.goal = 1;
      if (this.snap) free.level = 1;
    }
  }

  /** Choose the lit works and the texture tiers for a viewpoint. */
  private plan(p: P3): void {
    this.lastPlan = { ...p };
    this.cull(p);
    const layout = this.layout;
    const here = roomAt(layout, p.z);
    const dist = this.exhibits.map((e) => pathDistance(p, e.view, layout));

    // ---- lights
    if (this.suite) {
      const lit = (e: Exhibit) => e.heads.some((h) => h.slot && h.slot.goal === 1);
      const score = (e: Exhibit) => {
        if (e.slug === this.focus) return -1e9;
        if (e.isAnchor) return -1e6;
        const away = e.placement.room === here ? 0 : ROOM_PENALTY + (e.seen ? 0 : HIDDEN_PENALTY);
        return dist[e.index] + away - (lit(e) ? HYSTERESIS : 0);
      };
      // only works that are hung (mounted) right now
      const order = this.exhibits
        .filter((e) => this.lodOf(e.placement.room) !== null)
        .sort((a, b) => score(a) - score(b));
      const want = new Set<Head>();
      let budget = this.poolSize - SPARE;
      for (const e of order) {
        if (e.heads.length > budget) continue;
        e.heads.forEach((h) => want.add(h));
        budget -= e.heads.length;
        if (budget <= 0) break;
      }
      this.assign(want);
    } else {
      this.assign(new Set(this.heads));
    }

    // ---- texture tiers: close-up resolution for the few works the visitor
    // stands at; in a suite, wall resolution only within a short walk
    const near = new Set<Exhibit>();
    if (this.open) {
      const close = this.exhibits
        .map((e) => {
          const [x, , z] = e.placement.position;
          const d = e.placement.room === here ? Math.hypot(p.x - x, p.z - z) : Infinity;
          return { e, d };
        })
        .filter(({ e, d }) => d < (e.tier === "near" ? NEAR_DOWN : NEAR_UP))
        .sort((a, b) => a.d - b.d)
        .slice(0, NEAR_MAX);
      for (const { e } of close) near.add(e);
    }
    for (const e of this.exhibits) {
      let tier: Tier;
      if (near.has(e)) {
        tier = "near";
      } else if (!this.suite) {
        tier = "wall";
      } else if (!this.open) {
        tier = e.placement.room === 0 ? "wall" : e.isAnchor ? "thumb" : e.tier;
      } else if (e.placement.room === this.room || dist[e.index] < TIER_UP) {
        tier = "wall";
      } else {
        tier = (e.tier === "wall" || e.tier === "near") && dist[e.index] < TIER_DOWN ? "wall" : "thumb";
      }
      if (tier !== e.tier) {
        e.tier = tier;
        e.tierSubs.forEach((cb) => cb());
      }
    }
  }

  /** Hand lights to the wanted heads: keep, recall, fade out, take free slots. */
  private assign(want: Set<Head>): void {
    const snap = this.snap;
    this.snap = false;
    for (const s of this.slots) {
      if (!s.head) continue;
      s.goal = want.has(s.head) ? 1 : 0;
      if (snap) {
        s.level = s.goal;
        if (s.goal === 0) {
          // a jump: off and free at once
          s.head.slot = null;
          s.head = null;
        }
      }
    }
    for (const h of want) {
      if (h.slot) continue;
      const free = this.slots.find((s) => !s.head);
      if (!free) break; // picked up as fading lights come free
      free.head = h;
      free.goal = 1;
      free.level = snap ? 1 : 0;
      h.slot = free;
      const l = free.light;
      l.position.copy(h.plan.plan.lens);
      l.target.position.copy(h.plan.plan.target);
      l.angle = h.plan.angle;
      l.penumbra = h.exhibit.lights.penumbra;
      l.updateMatrixWorld();
      l.target.updateMatrixWorld();
    }
  }

  /** Fades and focus gains; returns whether anything is still changing. */
  private animate(dt: number): boolean {
    let moving = false;
    let freed = false;
    for (const s of this.slots) {
      if (!s.head) continue;
      const rate = s.goal ? dt / FADE_IN_S : -dt / FADE_OUT_S;
      const next = THREE.MathUtils.clamp(s.level + rate, 0, 1);
      if (next !== s.level) {
        s.level = next;
        moving = true;
      }
      if (s.goal === 0 && s.level === 0) {
        s.head.slot = null;
        s.head = null;
        freed = true;
      }
    }
    for (const e of this.exhibits) {
      const goal = this.focus ? (e.slug === this.focus ? FOCUS_GAIN : DIM_GAIN) : 1;
      if (e.gain !== goal) {
        let next = THREE.MathUtils.damp(e.gain, goal, 3.5, dt);
        if (Math.abs(next - goal) < 0.003) next = goal;
        e.gain = next;
        moving = true;
      }
    }
    let areaFreed = false;
    for (const s of this.areaSlots) {
      const rate = s.goal ? dt / FADE_IN_S : -dt / FADE_OUT_S;
      const next = THREE.MathUtils.clamp(s.level + rate, 0, 1);
      if (next !== s.level) {
        s.level = next;
        moving = true;
        if (next === 0) areaFreed = true;
      }
    }
    if (areaFreed) this.assignArea();
    if (freed && this.lastPlan) {
      // lights came free: give them to heads still waiting
      this.plan(this.lastPlan);
      moving = true;
    }
    this.apply();
    return moving;
  }

  private apply(): void {
    for (const e of this.exhibits) e.level = 0;
    for (const s of this.slots) {
      const h = s.head;
      if (!h) {
        s.light.intensity = 0;
        continue;
      }
      const k = this.suite ? ease(s.level) : s.level;
      s.light.intensity = h.plan.intensity * h.exhibit.gain * k;
      h.exhibit.level = Math.max(h.exhibit.level, k);
    }
  }

  /**
   * Portal culling: an exhibit in another room shows only if its wall
   * stretch, or one of its track heads, lies within the wedge every doorway
   * between leaves open in plan view (the heads also below the sightline
   * under each doorway head). Plan-view only for the wall stretch, so it
   * holds for the floor reflection too.
   */
  private cull(p: P3): void {
    if (!this.suite) return;
    const { doorways } = this.layout;
    const here = roomAt(this.layout, p.z);
    for (const e of this.exhibits) {
      const r = e.placement.room;
      let show = true;
      if (r !== here) {
        // slopes (x, and y up, per unit of depth) the doorways let through
        const ahead = r > here;
        let lo = -Infinity;
        let hi = Infinity;
        let up = Infinity;
        for (let j = Math.min(r, here); j < Math.max(r, here); j++) {
          const d = doorways[j];
          for (const zf of [d.z + d.thickness / 2, d.z - d.thickness / 2]) {
            const depth = ahead ? p.z - zf : zf - p.z;
            if (depth <= 0.02) continue; // the camera stands within this face
            lo = Math.max(lo, (-d.halfWidth - p.x) / depth);
            hi = Math.min(hi, (d.halfWidth - p.x) / depth);
            up = Math.min(up, (d.height - p.y) / depth);
          }
        }
        // a point's slopes, with a 10 cm margin at its own depth
        const depthOf = (q: P2) => Math.max(0.02, ahead ? p.z - q.z : q.z - p.z);
        const inWedge = (q: P2) => {
          const depth = depthOf(q);
          const s = (q.x - p.x) / depth;
          const m = CULL_MARGIN / depth;
          return s >= lo - m && s <= hi + m;
        };
        const [a, b] = e.wall;
        const da = depthOf(a);
        const db = depthOf(b);
        const sa = (a.x - p.x) / da;
        const sb = (b.x - p.x) / db;
        const m = CULL_MARGIN / Math.min(da, db);
        show = lo <= hi && (inWedge(a) || inWedge(b) || (Math.min(sa, sb) <= lo + m && Math.max(sa, sb) >= hi - m));
        if (!show && lo <= hi) {
          show = e.lenses.some((q) => inWedge(q) && (q.y - p.y - CULL_MARGIN) / depthOf(q) <= up);
        }
      }
      e.seen = show;
      if (e.group && e.group.visible !== show) e.group.visible = show;
    }
  }
}

