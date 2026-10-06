import type { Painting } from "@/lib/types";
import type { WorkScale } from "./theme";

export interface Placement {
  painting: Painting;
  position: [number, number, number];
  rotationY: number;
  w: number; // canvas width in meters
  h: number; // canvas height in meters
  /** Room of the suite the work hangs in (0 = the entrance room). */
  room: number;
  /** Wall-label scale (1: the standard card; smaller beside prints and miniatures). */
  label?: number;
}

export interface Bench {
  /** Centre on the floor plane (x, z), metres. */
  position: [number, number];
  /** Footprint (width along x, depth along z), metres. */
  size: [number, number];
}

/** One room of the suite. Rooms run along the hall axis from the entrance
 *  (+z) to the far end wall (−z). */
export interface SuiteRoom {
  index: number;
  /** z of the room's far (−z) and near (+z) wall faces. */
  z0: number;
  z1: number;
  /** Year span of the dated works hung in the room (null: none is dated). */
  years: [number, number] | null;
}

/** A doorway in the cross wall between rooms[i] and rooms[i + 1]. */
export interface Doorway {
  /** Centre plane of the cross wall. */
  z: number;
  /** Cross-wall thickness (depth of the reveals). */
  thickness: number;
  /** Half the clear opening width, centred on the hall axis (x = 0). */
  halfWidth: number;
  /** Clear opening height. */
  height: number;
}

/** A freestanding wall in the entrance room that the flagship hangs on, in a
 *  suite too long for the far end to be seen from the doors. */
export interface Screen {
  /** Centre plane (z) and depth. */
  z: number;
  thickness: number;
  halfWidth: number;
  height: number;
}

export interface GalleryLayout {
  hallWidth: number;
  /** Whole suite, entrance wall to the far end wall. */
  hallLength: number;
  wallHeight: number;
  placements: Placement[];
  benches: Bench[];
  /** Entrance room first; a single-room gallery has exactly one. */
  rooms: SuiteRoom[];
  /** doorways[i] joins rooms[i] and rooms[i + 1]. */
  doorways: Doorway[];
  /** The flagship's screen in the entrance room (long suites only). */
  screen: Screen | null;
  /** Lighting rails' distance in from the side walls (TRACK_INSET in a hall,
   *  less in a low cabinet so the spots keep their ~30° aim). */
  trackInset: number;
}

/** Centre line for small and mid-sized works (museum standard ~1.45-1.60 m). */
export const EYE = 1.55;
/** Large works keep their bottom edge at least this far off the floor. */
export const MIN_BOTTOM = 0.45;
/** Camera (visitor eye) height while walking. */
export const EYE_HEIGHT = 1.65;
/** Visitor body radius used for wall / bench collision. */
export const BODY_RADIUS = 0.3;

// Distance from the wall face to a placement's origin. The frame backing
// extends 0.024 behind the origin, so this leaves a ~4 mm air gap that
// avoids z-fighting while keeping the frame visually flush with the wall.
export const WALL_GAP = 0.028;

// Lighting track: rails run the length of the hall TRACK_INSET metres in from
// each side wall, plus a cross rail TRACK_INSET in front of the far end wall,
// all hanging TRACK_DROP below the ceiling. Spot fixtures clamp onto these.
export const TRACK_INSET = 2.0;
export const TRACK_DROP = 0.32;

// Wall label geometry the layout reserves room for. The placard hangs to the
// right of the frame (local +x of the placement), PLACARD_GAP clear of the
// frame's outer edge, its centre at PLACARD_Y above the floor where the work
// is tall enough (else level with the frame's bottom edge).
export const PLACARD_W = 0.4;
export const PLACARD_H = PLACARD_W * (416 / 768);
export const PLACARD_GAP = 0.1;
export const PLACARD_Y = 1.35;

// Room proportions scale with the collection: cabinet pictures (Vermeer's
// ~45 cm interiors) get an intimate room, salon-sized canvases a grand hall.
const BASE_HALL_WIDTH = 9.2;
const CABINET_HALL_WIDTH = 7.2;
const MAX_HALL_WIDTH = 14;
const BASE_WALL_HEIGHT = 4.7;
const CABINET_WALL_HEIGHT = 4.2;
const MIN_HALL_LENGTH = 15;
const CABINET_HALL_LENGTH = 12;
/** Near (entrance) wall to the first footprint along the side walls. */
const ENTRY_CLEAR = 1.7;
/** Last side-wall footprint to the far wall. */
const FAR_CLEAR = 1.5;
/** Frame top to ceiling: picture rail, track and fixtures live up there. */
const HEADROOM = 1.0;
/** Benches stay out of this stretch in front of the entrance (spawn point). */
const SPAWN_KEEP_OUT = 6.2;
const BENCH_SIZE: [number, number] = [0.62, 1.9];
/** Benches keep this far from a doorway's wall face (the walk-through line). */
const DOOR_KEEP_OUT = 2.4;
/** Most works one room of a suite holds; a bigger collection gets more rooms. */
export const ROOM_MAX = 12;
/** Longest suite: past this the rooms grow instead (a 400-work artist). */
export const MAX_ROOMS = 34;
/**
 * The flagship closes the suite's axis on the far end wall while the end is
 * near enough to be seen from the doors: up to this many rooms (the rooms
 * drawn around the visitor reach that far). A longer suite opens with it
 * instead, on a freestanding screen in the first room: the work everyone
 * comes for is the first thing seen, not a dot 100+ m down the enfilade.
 */
export const VISTA_ROOMS = 3;
/** The flagship's screen: its depth, and the walk-round space behind it. */
const SCREEN_THICKNESS = 0.36;
const SCREEN_BACK = 4.2;
/** Clear passage either side of the screen. */
const SCREEN_PASSAGE = 1.7;
/** Depth of a cross wall between two rooms (the doorway reveals). */
export const CROSS_WALL_THICKNESS = 0.4;

/** Moulding width the layout budgets for: the widest era frame (0.13 m)
 *  with a margin, growing for monumental canvases whose frames scale up,
 *  and less for small works, whose frames scale down (frameScale). */
export function frameAllowance(w: number, h: number): number {
  const side = Math.max(w, h);
  return Math.max(Math.min(0.16, 0.05 + 0.12 * side), 0.03 * side);
}

/** Space a work needs on its label side, beyond the canvas edge. */
function labelReach(w: number, h: number, label = 1): number {
  return frameAllowance(w, h) + PLACARD_GAP * label + PLACARD_W * label;
}

/**
 * How a room of a given kind of work is hung. Works on paper (prints,
 * miniatures) hang at their real size, so a room holds more of them, closer
 * together, with a smaller wall label; a sheet whose size is not recorded is
 * given its format's typical size instead of an easel painting's.
 */
interface Hanging {
  /** Most works one room holds. */
  roomMax: number;
  /** Clear wall between one work's footprint (frame + label) and the next. */
  air: number;
  /** Wall-label scale. */
  label: number;
  /** Smallest long side a work is shown at (m). */
  minSide: number;
  /** Small works hang in cabinets, as print rooms and miniature galleries
   *  do: a narrower, lower, shorter room, works centred a little lower
   *  (visitors lean in), a narrower doorway, the track closer to the walls. */
  cabinet?: Cabinet;
}

interface Cabinet {
  width: number;
  height: number;
  /** Shortest room (a cabinet of two works). */
  minLength: number;
  entryClear: number;
  farClear: number;
  /** Centre height of the works. */
  eye: number;
  trackInset: number;
  /** Half the doorway's clear width. */
  doorHalf: number;
}
const HANGING: Record<WorkScale, Hanging> = {
  painting: { roomMax: 12, air: 1.2, label: 1, minSide: 0.25 },
  scroll: { roomMax: 12, air: 1.1, label: 1, minSide: 0.2 },
  // a print room: a lighter cabinet, prints hung in rows (14 to a room: a
  // suite draws three rooms of works at once, so this keeps a 300-print
  // suite near a painting suite's per-frame cost)
  print: {
    roomMax: 14, air: 0.6, label: 0.58, minSide: 0.15,
    cabinet: { width: 6.4, height: 3.8, minLength: 7, entryClear: 1.3, farClear: 1.1, eye: 1.45, trackInset: 1.35, doorHalf: 0.95 },
  },
  // a miniature cabinet: about ten works to a room of 7 to 8 m
  miniature: {
    roomMax: 12, air: 0.5, label: 0.58, minSide: 0.12,
    cabinet: { width: 5.4, height: 3.4, minLength: 6, entryClear: 1.2, farClear: 1.0, eye: 1.45, trackInset: 1.1, doorHalf: 0.8 },
  },
  icon: { roomMax: 12, air: 1.0, label: 0.85, minSide: 0.2 },
};

export interface LayoutOptions {
  /** What the gallery hangs (the theme's `works`); paintings by default. */
  works?: WorkScale;
}

/** Physical canvas size in metres. Prefers Wikidata's measured size
 *  (keeping the image's own aspect so the scan is never distorted); with
 *  only one side measured, the other follows from the image's proportions;
 *  with neither, a pixel-aspect heuristic. */
export function canvasSize(p: Painting, works: WorkScale = "painting"): { w: number; h: number } {
  const pxAspect =
    p.imageWidth && p.imageHeight && p.imageWidth > 0 && p.imageHeight > 0
      ? p.imageWidth / p.imageHeight
      : 0;
  let wm = p.widthCm && p.widthCm > 0 ? p.widthCm / 100 : 0;
  let hm = p.heightCm && p.heightCm > 0 ? p.heightCm / 100 : 0;
  // one side measured: the image gives the other (a square guess without one)
  if (wm > 0 && hm === 0) hm = wm / (pxAspect || 1);
  else if (hm > 0 && wm === 0) wm = hm * (pxAspect || 1);
  if (wm > 0 && hm > 0) {
    const realAspect = wm / hm;
    let aspect = pxAspect || realAspect;
    // Within 25 % the scan and the measurement agree: use the scan's aspect
    // at the measured area. Beyond that the scan is probably a crop/detail
    // or the measurement is of something else; still trust the area.
    if (pxAspect && Math.abs(Math.log(pxAspect / realAspect)) > Math.log(1.25)) {
      aspect = pxAspect;
    }
    const area = wm * hm;
    let w = Math.sqrt(area * aspect);
    let h = Math.sqrt(area / aspect);
    // Monumental works (Tintoretto's Paradise is 24 m wide) are hung at a
    // reduced scale that still fits a grand hall; tiny ones stay legible.
    const shrink = Math.min(1, 12 / w, 7.5 / h);
    w *= shrink;
    h *= shrink;
    const grow = Math.max(1, HANGING[works].minSide / Math.max(w, h));
    return { w: w * grow, h: h * grow };
  }
  if (works !== "painting") return typicalSize(works, pxAspect);
  if (!pxAspect) return unknownSize(p.slug);
  const aspect = pxAspect;
  if (aspect >= 1.4) {
    // wide landscape: let it breathe (a frieze-like mural more than most)
    const w = Math.min(3.6, 1.1 * aspect + 0.6);
    return { w, h: w / aspect };
  }
  const h = aspect < 0.8 ? 1.75 : 1.55;
  return { w: h * aspect, h };
}

/** Easel formats for a work with neither a measured size nor an image (a ©
 *  placard canvas): a portrait, landscape or square of plausible size, picked
 *  per work so a wall of them doesn't read as identical blanks. */
const UNKNOWN_FORMATS: [number, number][] = [
  [0.92, 1.15],
  [1.3, 1.0],
  [1.05, 1.05],
  [0.81, 1.0],
  [1.46, 1.14],
  [1.0, 1.3],
];
function unknownSize(slug: string): { w: number; h: number } {
  let x = 2166136261;
  for (let i = 0; i < slug.length; i++) x = Math.imul(x ^ slug.charCodeAt(i), 16777619);
  const [w, h] = UNKNOWN_FORMATS[(x >>> 0) % UNKNOWN_FORMATS.length];
  return { w, h };
}

/**
 * A work on paper or silk of unknown size, from its format and the image's
 * proportions: an oban print (~26 x 38 cm), an album or manuscript page
 * (~20 x 30 cm), an icon panel (~50 x 65 cm); for East Asian painting, a hanging scroll (tall), a
 * handscroll (a long strip ~32 cm high), a folding screen (~1.6 m high) or
 * an album leaf.
 */
function typicalSize(works: WorkScale, pxAspect: number): { w: number; h: number } {
  const byLong = (long: number, aspect: number) =>
    aspect >= 1 ? { w: long, h: long / aspect } : { w: long * aspect, h: long };
  if (works === "print") return byLong(0.38, pxAspect || 0.69);
  if (works === "miniature") return byLong(0.3, pxAspect || 0.68);
  if (works === "icon") return byLong(0.65, pxAspect || 0.78);
  const a = pxAspect || 0.45;
  if (a < 0.6) return { w: 1.4 * a, h: 1.4 }; // hanging scroll
  if (a > 2.8) {
    // handscroll: ~32 cm high, as long as the image (within a wall's reach)
    const w = Math.min(6, 0.32 * a);
    return { w, h: w / a };
  }
  if (a >= 1.6) return { w: 1.5 * a, h: 1.5 }; // folding screen
  return byLong(0.6, a); // album leaf or fan
}

/** Height of a work's centre above the floor (`eye`: the centre line). */
export function hangHeight(h: number, eye = EYE): number {
  return Math.max(eye, h / 2 + MIN_BOTTOM);
}

/** The flagship: most-viewed article over the last year, else the first
 *  work; one with an image wins over a withheld (© placard) canvas. */
export function pickAnchor(paintings: Painting[]): number {
  let best = 0;
  let bestKey = -Infinity;
  paintings.forEach((p, i) => {
    const v = typeof p.pageviews === "number" && Number.isFinite(p.pageviews) ? p.pageviews : -1;
    const key = (!p.imageUrl ? -1e15 : 0) + v;
    if (key > bestKey) {
      bestKey = key;
      best = i;
    }
  });
  return best;
}

function byYear(a: Painting, b: Painting): number {
  const ya = a.year ?? Number.POSITIVE_INFINITY;
  const yb = b.year ?? Number.POSITIVE_INFINITY;
  return ya === yb ? 0 : ya < yb ? -1 : 1;
}

interface Sized {
  painting: Painting;
  w: number;
  h: number;
  /** Footprint toward the entrance (+z) and toward the far wall (−z). */
  near: number;
  far: number;
}

export function buildLayout(paintings: Painting[], opts: LayoutOptions = {}): GalleryLayout {
  const works = opts.works ?? "painting";
  const hanging = HANGING[works];
  const size = (p: Painting) => canvasSize(p, works);
  const reach = (w: number, h: number) => labelReach(w, h, hanging.label);
  if (paintings.length === 0) {
    return {
      hallWidth: BASE_HALL_WIDTH,
      hallLength: MIN_HALL_LENGTH,
      wallHeight: BASE_WALL_HEIGHT,
      placements: [],
      benches: [],
      rooms: [{ index: 0, z0: -MIN_HALL_LENGTH / 2, z1: MIN_HALL_LENGTH / 2, years: null }],
      doorways: [],
      screen: null,
      trackInset: TRACK_INSET,
    };
  }
  const cab = hanging.cabinet;
  const entryClear = cab?.entryClear ?? ENTRY_CLEAR;
  const farClear = cab?.farClear ?? FAR_CLEAR;
  const eye = cab?.eye ?? EYE;

  const anchorIdx = pickAnchor(paintings);
  const anchor = paintings[anchorIdx];
  // Chronological along both walls, alternating left / right, so walking
  // toward the flagship walks forward in time. (Array.prototype.sort is
  // stable, so undated works keep their curated order at the end.)
  const rest = paintings.filter((_, i) => i !== anchorIdx).sort(byYear);

  // A big collection becomes a suite: chronological chapters of at most
  // ROOM_MAX works in rooms along one axis. The flagship closes the last
  // room, or, in a suite longer than VISTA_ROOMS, opens the first.
  const roomSizes = splitRooms(paintings.length, hanging.roomMax);
  const nRooms = roomSizes.length;
  const overture = nRooms > VISTA_ROOMS;
  const anchorRoom = overture ? 0 : nRooms - 1;
  const chapters: Painting[][] = [];
  {
    let at = 0;
    roomSizes.forEach((size, r) => {
      const take = r === anchorRoom ? size - 1 : size; // that room also holds the flagship
      chapters.push(rest.slice(at, at + take));
      at += take;
    });
  }

  // Left wall (x < 0) faces +x: its local +x (label side) points to −z.
  // Right wall faces −x: its local +x points to +z (toward the entrance).
  const walls = chapters.map((works) => {
    const left: Sized[] = [];
    const right: Sized[] = [];
    works.forEach((p, i) => {
      const { w, h } = size(p);
      const plain = w / 2 + frameAllowance(w, h);
      const label = w / 2 + reach(w, h);
      if (i % 2 === 0) left.push({ painting: p, w, h, near: plain, far: label });
      else right.push({ painting: p, w, h, near: label, far: plain });
    });
    return { left, right };
  });

  // 0 for a room of cabinet pictures (largest side <= 0.9 m), 1 from ~2.1 m up.
  const largest = Math.max(
    ...[anchor, ...rest].map((p) => {
      const s = size(p);
      return Math.max(s.w, s.h);
    })
  );
  const grand = Math.min(1, Math.max(0, (largest - 0.9) / 1.2));
  const baseWidth = cab?.width ?? CABINET_HALL_WIDTH + (BASE_HALL_WIDTH - CABINET_HALL_WIDTH) * grand;
  const baseHeight = cab?.height ?? CABINET_WALL_HEIGHT + (BASE_WALL_HEIGHT - CABINET_WALL_HEIGHT) * grand;
  const minLength = cab?.minLength ?? CABINET_HALL_LENGTH + (MIN_HALL_LENGTH - CABINET_HALL_LENGTH) * grand;

  const run = (ws: Sized[]) =>
    ws.reduce((s, x) => s + x.near + x.far, 0) + hanging.air * Math.max(0, ws.length - 1);
  // Each room is as long as its own works need (the same rule as one hall);
  // an overture room leaves the flagship's screen a good viewing distance.
  const roomLengths = walls.map(({ left, right }, r) =>
    Math.max(
      Math.ceil(minLength * 10) / 10,
      Math.ceil((entryClear + Math.max(run(left), run(right)) + farClear) * 10) / 10,
      overture && r === 0 ? Math.ceil((SCREEN_BACK + (cab ? 9 : 15)) * 10) / 10 : 0
    )
  );
  const hallLength =
    roomLengths.reduce((s, l) => s + l, 0) + CROSS_WALL_THICKNESS * (nRooms - 1);

  const a = size(anchor);
  const sideMax = Math.max(0, ...rest.map((p) => size(p).w));
  // the flagship's screen: the work and its label with a margin
  const screenHalf = a.w / 2 + reach(a.w, a.h) + 0.45;
  // one width for the whole suite, so the doorways line up on one axis
  const hallWidth = Math.min(
    MAX_HALL_WIDTH,
    Math.ceil(10 * Math.max(
      baseWidth,
      // the flagship + its label, with a metre of wall either side
      2 * (a.w / 2 + reach(a.w, a.h) + 1.0),
      // big side-wall canvases want a longer viewing distance
      sideMax * 1.1 + 2.6,
      // walk-round passages either side of the flagship's screen
      overture ? 2 * (screenHalf + SCREEN_PASSAGE) : 0
    )) / 10
  );

  // Rooms from the entrance (+z) toward the far end wall (−z).
  const spans: { z0: number; z1: number }[] = [];
  {
    let z1 = hallLength / 2;
    roomLengths.forEach((len, r) => {
      const z0 = r === nRooms - 1 ? -hallLength / 2 : z1 - len;
      spans.push({ z0, z1 });
      z1 = z0 - CROSS_WALL_THICKNESS;
    });
  }

  const placements: Placement[] = [];

  // Anchor piece on the far end wall, or on the overture screen.
  const screenZ = spans[0].z0 + SCREEN_BACK;
  placements.push({
    painting: anchor,
    position: [
      0,
      hangHeight(a.h, eye),
      overture ? screenZ + SCREEN_THICKNESS / 2 + WALL_GAP : -hallLength / 2 + WALL_GAP,
    ],
    rotationY: 0,
    w: a.w,
    h: a.h,
    room: anchorRoom,
    label: hanging.label,
  });

  walls.forEach(({ left, right }, r) => {
    const { z0, z1 } = spans[r];
    // Both walls span the same run (justified spacing), so a wall with fewer
    // or narrower works gets more air instead of ending early.
    const zNear = z1 - entryClear;
    const span = z1 - z0 - entryClear - farClear;
    const hang = (ws: Sized[], side: -1 | 1): Placement[] => {
      const total = ws.reduce((s, x) => s + x.near + x.far, 0);
      const gap = ws.length > 1 ? (span - total) / (ws.length - 1) : 0;
      let cursor = ws.length > 1 ? zNear : zNear - (span - total) / 2;
      return ws.map((x) => {
        const z = cursor - x.near;
        cursor = z - x.far - gap;
        return {
          painting: x.painting,
          position: [side * (hallWidth / 2 - WALL_GAP), hangHeight(x.h, eye), z],
          rotationY: side === -1 ? Math.PI / 2 : -Math.PI / 2,
          w: x.w,
          h: x.h,
          room: r,
          label: hanging.label,
        };
      });
    };
    // Interleave back into chronological order in the placements array.
    const lefts = hang(left, -1);
    const rights = hang(right, 1);
    for (let i = 0; i < lefts.length; i++) {
      placements.push(lefts[i]);
      if (rights[i]) placements.push(rights[i]);
    }
  });

  // Tall works raise the ceiling: the frame top keeps HEADROOM below it for
  // the picture rail, the lighting track and its fixtures.
  const maxTop = Math.max(
    ...placements.map((p) => p.position[1] + p.h / 2 + frameAllowance(p.w, p.h))
  );
  const wallHeight = Math.max(
    Math.ceil(baseHeight * 10) / 10,
    Math.ceil((maxTop + HEADROOM) * 10) / 10
  );

  // Benches down each room's centre line, clear of the spawn point, the far
  // wall and the doorways.
  const benches: Bench[] = [];
  spans.forEach(({ z0, z1 }, r) => {
    // clear of the flagship (its wall or screen), the spawn point and doorways
    const front = overture && r === 0 ? screenZ + SCREEN_THICKNESS / 2 : z0;
    const farKeep = r === anchorRoom ? 3.2 - BENCH_SIZE[1] / 2 : DOOR_KEEP_OUT;
    const nearKeep = r === 0 ? SPAWN_KEEP_OUT : DOOR_KEEP_OUT;
    const lo = front + farKeep + BENCH_SIZE[1] / 2;
    const hi = z1 - nearKeep - BENCH_SIZE[1] / 2;
    if (hi > lo) {
      const count = Math.max(1, Math.floor((hi - lo + BENCH_SIZE[1]) / 7));
      for (let i = 0; i < count; i++) {
        const z = count === 1 ? (lo + hi) / 2 : lo + (i / (count - 1)) * (hi - lo);
        benches.push({ position: [0, +z.toFixed(3)], size: [...BENCH_SIZE] });
      }
    }
  });

  const rooms: SuiteRoom[] = spans.map(({ z0, z1 }, r) => {
    // the room's chronological chapter: the flagship hangs out of sequence
    // (it only stands in for the span when nothing else in the room is dated)
    const dated = (list: Placement[]) =>
      list.filter((p) => p.room === r && typeof p.painting.year === "number").map((p) => p.painting.year as number);
    const chapter = dated(placements.slice(1));
    const years = chapter.length ? chapter : dated(placements.slice(0, 1));
    return {
      index: r,
      z0,
      z1,
      years: years.length ? [Math.min(...years), Math.max(...years)] : null,
    };
  });

  // Doorways scale a little with the wall: ~3.4 m clear in a 4.7 m room.
  const doorHeight = Math.min(4, Math.max(3, wallHeight - 1.3));
  const doorHalf = cab?.doorHalf ?? Math.min(2.8, Math.max(2.4, doorHeight * 0.76)) / 2;
  const doorways: Doorway[] = spans.slice(0, -1).map(({ z0 }) => ({
    z: z0 - CROSS_WALL_THICKNESS / 2,
    thickness: CROSS_WALL_THICKNESS,
    halfWidth: doorHalf,
    height: doorHeight,
  }));

  // the screen stands clear of the picture rail / cornice, tall enough for the work
  const screen: Screen | null = overture
    ? {
        z: screenZ,
        thickness: SCREEN_THICKNESS,
        halfWidth: screenHalf,
        // (a print or a miniature gets a lower one: a cabinet screen)
        height: Math.min(wallHeight - 0.75, Math.max(cab ? 2.4 : 3.4, hangHeight(a.h, eye) + a.h / 2 + frameAllowance(a.w, a.h) + 0.45)),
      }
    : null;

  return { hallWidth, hallLength, wallHeight, placements, benches, rooms, doorways, screen, trackInset: cab?.trackInset ?? TRACK_INSET };
}

/** Works per room for a collection of `n`: chronological chapters of at
 *  most ROOM_MAX, as even as possible (30 → 10/10/10, 26 → 9/9/8). */
export function splitRooms(n: number, roomMax = ROOM_MAX): number[] {
  const rooms = Math.min(MAX_ROOMS, Math.max(1, Math.ceil(n / roomMax)));
  const base = Math.floor(n / rooms);
  const extra = n % rooms;
  return Array.from({ length: rooms }, (_, i) => base + (i < extra ? 1 : 0));
}

// ------------------------------------------------------------- navigation

/** Where the camera starts (just inside the doorway) and where the entry walk ends. */
export function entryZ(layout: GalleryLayout): number {
  return layout.hallLength / 2 - 0.85;
}
export function spawnZ(layout: GalleryLayout): number {
  return layout.hallLength / 2 - 3.1;
}

/** The `n` works nearest the entrance (all in the first room). */
function nearestEntrance(layout: GalleryLayout, n: number): string[] {
  return layout.placements
    .slice(1)
    .filter((p) => p.room === 0)
    .sort((a, b) => b.position[2] - a.position[2])
    .slice(0, n)
    .map((p) => p.painting.slug);
}

/** The textures the entry doors wait for, flagship first, as the gallery
 *  first requests them: at wall resolution where the flagship hangs in the
 *  entrance room (a single hall, or a long suite's overture screen), as a
 *  thumbnail where it closes a short suite rooms away; then the `n` works
 *  nearest the entrance (wall). The server page preloads exactly these. */
export function entryPreloads(layout: GalleryLayout, n = 4): { slug: string; thumb: boolean }[] {
  const anchor = layout.placements[0];
  if (!anchor) return [];
  return [
    { slug: anchor.painting.slug, thumb: anchor.room !== 0 },
    ...nearestEntrance(layout, n).map((slug) => ({ slug, thumb: false })),
  ];
}

/** Everything the entry doors wait for: the flagship (at whatever resolution
 *  it is first requested) plus the `n` works nearest the entrance. */
export function entryGate(layout: GalleryLayout, n = 4): string[] {
  const anchor = layout.placements[0];
  if (!anchor) return [];
  return [anchor.painting.slug, ...nearestEntrance(layout, n)];
}

/** Room holding the floor point at depth z (the cross walls' centre planes divide them). */
export function roomAt(layout: GalleryLayout, z: number): number {
  let r = 0;
  while (r < layout.doorways.length && z < layout.doorways[r].z) r++;
  return r;
}

/** Margin kept between the camera and a wall face. */
const WALL_MARGIN = 0.55;

/** Push p (a disc of radius r) out of the box [x0, x1] × [z0, z1]. */
function pushOut(
  p: { x: number; z: number },
  x0: number, x1: number, z0: number, z1: number,
  r: number
): void {
  const qx = Math.min(x1, Math.max(x0, p.x));
  const qz = Math.min(z1, Math.max(z0, p.z));
  const dx = p.x - qx;
  const dz = p.z - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    p.x = qx + (dx / d) * r;
    p.z = qz + (dz / d) * r;
    return;
  }
  // centre inside the box: out through the nearest face
  const e = [p.x - x0, x1 - p.x, p.z - z0, z1 - p.z];
  const i = e.indexOf(Math.min(...e));
  if (i === 0) p.x = x0 - r;
  else if (i === 1) p.x = x1 + r;
  else if (i === 2) p.z = z0 - r;
  else p.z = z1 + r;
}

/** Keep a visitor (x, z on the floor) inside the suite, out of the cross
 *  walls (only the doorways let them through) and out of the benches. */
export function confine(p: { x: number; z: number }, layout: GalleryLayout): void {
  const m = WALL_MARGIN;
  const clampHall = () => {
    p.x = Math.min(layout.hallWidth / 2 - m, Math.max(-layout.hallWidth / 2 + m, p.x));
    p.z = Math.min(layout.hallLength / 2 - m, Math.max(-layout.hallLength / 2 + m, p.z));
  };
  clampHall();
  for (const b of layout.benches) {
    const hx = b.size[0] / 2 + BODY_RADIUS;
    const hz = b.size[1] / 2 + BODY_RADIUS;
    const dx = p.x - b.position[0];
    const dz = p.z - b.position[1];
    if (Math.abs(dx) >= hx || Math.abs(dz) >= hz) continue;
    // push out along the axis of least penetration
    if (hx - Math.abs(dx) < hz - Math.abs(dz)) {
      p.x = b.position[0] + (dx < 0 ? -hx : hx);
    } else {
      p.z = b.position[1] + (dz < 0 ? -hz : hz);
    }
  }
  if (layout.doorways.length === 0) return;
  // Cross walls: the faces keep the usual wall margin, the jambs the body
  // radius (rounded corners, so the visitor slides round them). The same
  // for the flagship's screen.
  const W = layout.hallWidth;
  for (const d of layout.doorways) {
    const zh = d.thickness / 2 + (m - BODY_RADIUS);
    pushOut(p, -W, -d.halfWidth, d.z - zh, d.z + zh, BODY_RADIUS);
    pushOut(p, d.halfWidth, W, d.z - zh, d.z + zh, BODY_RADIUS);
  }
  const s = layout.screen;
  if (s) {
    const zh = s.thickness / 2 + (m - BODY_RADIUS);
    pushOut(p, -s.halfWidth, s.halfWidth, s.z - zh, s.z + zh, BODY_RADIUS);
  }
  clampHall();
}

/** Benches, and the flagship's screen as one more (bench-like) obstacle. */
function blockers(layout: GalleryLayout): Bench[] {
  const s = layout.screen;
  if (!s) return layout.benches;
  const depth = s.thickness + 2 * (WALL_MARGIN - BODY_RADIUS);
  return [...layout.benches, { position: [0, s.z], size: [2 * s.halfWidth, depth] }];
}

type P2 = { x: number; z: number };
type Box = [number, number, number, number]; // x0, x1, z0, z1

/** Cross-wall solids a straight walk must miss (grown by the body radius). */
function wallBoxes(layout: GalleryLayout): Box[] {
  const W = layout.hallWidth;
  const r = BODY_RADIUS + 0.02;
  const out: Box[] = [];
  for (const d of layout.doorways) {
    const zh = d.thickness / 2 + (WALL_MARGIN - BODY_RADIUS) + r;
    out.push([-W, -d.halfWidth + r, d.z - zh, d.z + zh], [d.halfWidth - r, W, d.z - zh, d.z + zh]);
  }
  return out;
}

/** A bench's footprint grown by the body radius plus `pad`. */
function benchBox(b: Bench, pad: number): Box {
  const hx = b.size[0] / 2 + BODY_RADIUS + pad;
  const hz = b.size[1] / 2 + BODY_RADIUS + pad;
  return [b.position[0] - hx, b.position[0] + hx, b.position[1] - hz, b.position[1] + hz];
}

/** Does the segment a→b cross the box? (Liang–Barsky) */
function segmentHitsBox(a: P2, b: P2, box: Box): boolean {
  const [x0, x1, z0, z1] = box;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
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
  return (
    clip(-dx, a.x - x0) &&
    clip(dx, x1 - a.x) &&
    clip(-dz, a.z - z0) &&
    clip(dz, z1 - a.z) &&
    t1 - t0 > 1e-6
  );
}

/**
 * Floor waypoints for walking from `a` to `b` (b included, a not): through
 * the middle of every doorway between their rooms and round any bench in the
 * way, then string-pulled so no corner a straight line can cut remains.
 */
export function planRoute(a: P2, b: P2, layout: GalleryLayout): P2[] {
  const walls = wallBoxes(layout);
  const stops = blockers(layout);
  const benches = stops.map((x) => benchBox(x, 0.02));
  const clear = (p: P2, q: P2) =>
    walls.every((o) => !segmentHitsBox(p, q, o)) && benches.every((o) => !segmentHitsBox(p, q, o));

  const ra = roomAt(layout, a.z);
  const rb = roomAt(layout, b.z);
  const pts: P2[] = [{ x: a.x, z: a.z }];
  const step = rb > ra ? 1 : -1;
  for (let r = ra; r !== rb; r += step) {
    const d = layout.doorways[step > 0 ? r : r - 1];
    const off = d.thickness / 2 + WALL_MARGIN + 0.3;
    pts.push({ x: 0, z: d.z + step * off }, { x: 0, z: d.z - step * off });
  }
  pts.push({ x: b.x, z: b.z });

  // detour round benches standing across a leg: past the side nearer the leg
  const out: P2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1];
    const q = pts[i];
    const hits = stops
      .filter((x) => segmentHitsBox(p, q, benchBox(x, 0.02)))
      // in walking order
      .sort((u, v) => (q.z < p.z ? v.position[1] - u.position[1] : u.position[1] - v.position[1]));
    for (const bench of hits) {
      const [x0, x1, z0, z1] = benchBox(bench, 0.2);
      const side = (p.x + q.x) / 2 < bench.position[0] ? x0 : x1;
      const [first, second] = q.z < p.z ? [z1, z0] : [z0, z1];
      out.push({ x: side, z: first }, { x: side, z: second });
    }
    out.push(q);
  }

  // string-pull: from each kept point jump to the furthest one in plain sight
  const path: P2[] = [];
  let i = 0;
  while (i < out.length - 1) {
    let j = out.length - 1;
    while (j > i + 1 && !clear(out[i], out[j])) j--;
    path.push(out[j]);
    i = j;
  }
  return path;
}

type P3 = { x: number; y: number; z: number };

/**
 * Where the straight line a→b first runs into a cross wall (anywhere but a
 * doorway opening): the crossing point and the side the line came from
 * (+1: the face toward the entrance). Null when the line is clear.
 */
export function firstWallHit(
  a: P3,
  b: P3,
  layout: GalleryLayout
): { t: number; x: number; y: number; z: number; facing: 1 | -1 } | null {
  let best: { t: number; x: number; y: number; z: number; facing: 1 | -1 } | null = null;
  const s = layout.screen;
  if (s) {
    // the flagship's screen: a solid box (only its faces matter here)
    for (const zf of [s.z + s.thickness / 2, s.z - s.thickness / 2]) {
      if ((a.z - zf) * (b.z - zf) >= 0) continue;
      const t = (zf - a.z) / (b.z - a.z);
      const x = a.x + t * (b.x - a.x);
      const y = a.y + t * (b.y - a.y);
      if (Math.abs(x) > s.halfWidth || y > s.height || y < 0) continue;
      if (!best || t < best.t) best = { t, x, y, z: zf, facing: a.z > zf ? 1 : -1 };
    }
  }
  for (const d of layout.doorways) {
    for (const zf of [d.z + d.thickness / 2, d.z - d.thickness / 2]) {
      if ((a.z - zf) * (b.z - zf) >= 0) continue;
      const t = (zf - a.z) / (b.z - a.z);
      if (best && t >= best.t) continue;
      const x = a.x + t * (b.x - a.x);
      const y = a.y + t * (b.y - a.y);
      if (Math.abs(x) <= d.halfWidth && y <= d.height && y >= 0) continue;
      best = { t, x, y, z: zf, facing: a.z > zf ? 1 : -1 };
    }
  }
  return best;
}

/** Walking distance between two floor points (through the doorway centres). */
export function pathDistance(a: P2, b: P2, layout: GalleryLayout): number {
  const ra = roomAt(layout, a.z);
  const rb = roomAt(layout, b.z);
  if (ra === rb) return Math.hypot(b.x - a.x, b.z - a.z);
  const step = rb > ra ? 1 : -1;
  let d = 0;
  let px = a.x;
  let pz = a.z;
  for (let r = ra; r !== rb; r += step) {
    const door = layout.doorways[step > 0 ? r : r - 1];
    d += Math.hypot(px, door.z - pz);
    px = 0;
    pz = door.z;
  }
  return d + Math.hypot(b.x - px, b.z - pz);
}

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];
/** Room number as museums letter it over a doorway: Roman throughout (I … XXXIV). */
export function roomNumeral(index: number): string {
  let n = Math.max(1, Math.floor(index) + 1);
  let out = "";
  for (const [v, sym] of ROMAN) {
    while (n >= v) {
      out += sym;
      n -= v;
    }
  }
  return out;
}

/** "1901 – 1906" (or "1901"), from the room's dated works; "" when none is dated. */
export function roomYears(room: SuiteRoom, dash = " – "): string {
  if (!room.years) return "";
  const [a, b] = room.years;
  return a === b ? String(a) : `${a}${dash}${b}`;
}

// ----------------------------------------------------------------- labels

/** Placard centre in the placement's local frame (x right, y up, origin at
 *  the canvas centre), given the actual frame moulding width. */
export function placardLocal(pl: Placement, frameWidth: number): { x: number; y: number } {
  const k = pl.label ?? 1;
  const x = pl.w / 2 + frameWidth + (PLACARD_GAP + PLACARD_W / 2) * k;
  const half = Math.max(0, pl.h / 2 - (PLACARD_H * k) / 2);
  const y = Math.min(half, Math.max(-half, PLACARD_Y - pl.position[1]));
  return { x, y };
}

// ---------------------------------------------------------------- inspect

/** Screen space the inspect panel covers, in CSS px. Mirrors the panel rules
 *  in museum.module.css: a right-hand column on wide screens, a bottom sheet
 *  at or below INSPECT_SHEET_BREAKPOINT. */
export const INSPECT_SHEET_BREAKPOINT = 760;
export function inspectPanelInset(
  width: number,
  height: number
): { right: number; bottom: number } {
  if (width <= INSPECT_SHEET_BREAKPOINT) {
    return { right: 0, bottom: Math.min(height * 0.5, 480) };
  }
  return { right: Math.min(440, width * 0.92), bottom: 0 };
}

/** Where the camera should stand to inspect a placement head-on.
 *  `aspect` is the unobstructed width over the full viewport height;
 *  `heightFrac` the unobstructed fraction of the viewport height. */
export function inspectPose(
  pl: Placement,
  fovDeg: number,
  aspect: number,
  opts: { heightFrac?: number; maxDist?: number } = {}
): { position: [number, number, number]; lookAt: [number, number, number] } {
  const fov = (fovDeg * Math.PI) / 180;
  const t = Math.tan(fov / 2);
  const f = frameAllowance(pl.w, pl.h);
  const fitH = (pl.h + 2 * f) / (2 * t * (opts.heightFrac ?? 1));
  const fitW = (pl.w + 2 * f) / (2 * t * Math.max(0.2, aspect));
  let dist = Math.max(fitH, fitW) * 1.12 + 0.2;
  if (opts.maxDist) dist = Math.min(dist, opts.maxDist);
  const nx = Math.sin(pl.rotationY);
  const nz = Math.cos(pl.rotationY);
  return {
    position: [pl.position[0] + nx * dist, pl.position[1], pl.position[2] + nz * dist],
    lookAt: pl.position,
  };
}

/** How far the camera may back away from a placement before leaving its room. */
export function inspectMaxDist(pl: Placement, layout: GalleryLayout): number {
  if (Math.abs(pl.rotationY) > 0.1) return layout.hallWidth - 0.8;
  const room = layout.rooms[pl.room];
  // the far wall, or the flagship's screen standing in front of it
  return (room ? room.z1 - room.z0 : layout.hallLength) - 1.5 - (layout.screen && pl.room === 0 ? pl.position[2] - room.z0 : 0);
}
