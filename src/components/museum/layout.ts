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
  /** Hangs on the film corner's free-standing wall (FilmNook), not on the room's left wall. */
  partition?: boolean;
}

export interface Bench {
  /** Centre on the floor plane (x, z), metres. */
  position: [number, number];
  /** Footprint (width along x, depth along z), metres. */
  size: [number, number];
  /** A piece one can stand on (a bench): its top; feet as high as that pass over it. */
  top?: number;
}

/** The footprints a room style's furniture offers the layout to arrange (furniture.ts): across and deep, facing
 *  +z. A centre piece's depth runs along the hall; a wall piece's width is the most wall it wants. */
export interface FurnishSizes {
  centre: [number, number][];
  wall: [number, number][];
  chairs: [number, number][];
  /** The centre pieces one can stand on: their tops (null: not one to stand on). */
  top?: (number | null)[];
  /** Where one may sit on a placed piece. */
  seats?: (f: Furnishing) => SeatSpot[];
}

/** A place to sit: on the floor at (x, z), the seat h high, facing ry (0: +z, toward the entrance). */
export interface SeatSpot {
  x: number;
  z: number;
  h: number;
  ry: number;
  room: number;
}

/** A piece of furniture the layout has placed: which of the style's pieces, where, turned how, in which colours. */
export interface Furnishing {
  /** The style's list (down the middle, against a wall, a chair set alone) and the piece in it. */
  kind: "centre" | "wall" | "chair";
  index: number;
  /** Centre of the footprint on the floor (x, z) and its turn about y (0: facing +z, the entrance). */
  position: [number, number];
  rotation: number;
  /** The piece's own footprint (across, deep) before turning; a wall piece's width is what the wall left it. */
  size: [number, number];
  /** The room of the suite it stands in. */
  room: number;
  /** In [0, 1): picks its fabric and wood from the style's (pieces in one room mostly match). */
  tint: number;
  /** A piece one can stand on: its top. */
  top?: number;
}

/** A rope barrier in front of a famous work, as museums rope off the Mona Lisa: brass posts on the floor from
 *  the wall out and round to the wall, and the roped-off floor as a box (x0, x1, z0, z1). */
export interface Barrier {
  posts: [number, number][];
  box: [number, number, number, number];
  room: number;
}

/** A custom room's elevator, in the entrance wall beside the doors (a room with more than one floor). */
export interface ElevatorSpot {
  /** Centre of the opening (x) on the entrance wall (z = hallLength / 2). */
  x: number;
  /** Half the opening's clear width, and its height. */
  halfWidth: number;
  height: number;
  /** The call buttons, between the entrance doors' casing and the elevator. */
  panelX: number;
  /** The floor directory beside it, where the wall leaves room, and the board's width. */
  directoryX: number | null;
  directoryWidth: number;
}

/** The entrance doors in the near wall (z = +hallLength / 2), centred on the hall axis. */
export const ENTRANCE_DOOR = { width: 1.9, height: 3.05, depth: 0.32 };

/** An artist's gallery ends at two doors in the far end wall (z = −hallLength / 2), either side of the flagship:
 *  to the artist before (x < 0, on the left as one faces the wall) and the artist after (x > 0). */
export interface ExitDoors {
  /** Centre of each door (|x|). */
  x: number;
  /** Half the door's width, and its height. */
  halfWidth: number;
  height: number;
}
export const EXIT_DOOR = { halfWidth: 0.6, height: 2.45, casing: 0.22 };
/** The wall kept clear between a door's casing and the hall's corner. */
const EXIT_CORNER = 0.35;

/** One room of the suite. Rooms run along the hall axis from the entrance
 *  (+z) to the far end wall (−z). */
export interface SuiteRoom {
  index: number;
  /** z of the room's far (−z) and near (+z) wall faces. */
  z0: number;
  z1: number;
  /** Half the room's width: its side walls stand at x = ±halfWidth. Rooms differ (never narrower than the
   *  suite's hallWidth); a cross wall reaches as far as the wider of the rooms either side. */
  halfWidth: number;
  /** Year span of the dated works hung in the room (null: none is dated). */
  years: [number, number] | null;
  /** The phase of the artist's life the room shows ("Blue Period"), when the gallery follows phases. */
  title?: string | null;
}

/** A doorway in the cross wall between rooms[i] and rooms[i + 1]. */
export interface Doorway {
  /** Centre plane of the cross wall. */
  z: number;
  /** Cross-wall thickness (depth of the reveals). */
  thickness: number;
  /** Centre of the opening: on the hall axis (0), or to one side of it where both rooms have the wall, so the
   *  walk through the suite turns. */
  x: number;
  /** Half the clear opening width. */
  halfWidth: number;
  /** Clear opening height (the crown of an arch). */
  height: number;
  /** A palace gallery's arch: the rise of its (elliptical) head above the springing; 0 for a square head. */
  arch: number;
  /** Columns either side of the arch on both faces (their radius; 0: none). */
  columns: number;
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
  /** The seating, room by room: different in every room (furnish). */
  furniture: Furnishing[];
  /** Rope barriers in front of the most famous works. */
  barriers: Barrier[];
  /** Every place to sit (C beside it). */
  seats: SeatSpot[];
  /** A custom room's elevator (LayoutOptions.elevator). */
  elevator: ElevatorSpot | null;
  /** An artist's gallery's doors to the artists before and after (LayoutOptions.exits). */
  exits: ExitDoors | null;
  /** Entrance room first; a single-room gallery has exactly one. */
  rooms: SuiteRoom[];
  /** doorways[i] joins rooms[i] and rooms[i + 1]. */
  doorways: Doorway[];
  /** The flagship's screen in the entrance room (long suites only). */
  screen: Screen | null;
  /** Lighting rails' distance in from the side walls (TRACK_INSET in a hall,
   *  less in a low cabinet so the spots keep their ~30° aim). */
  trackInset: number;
  /** The films about the artist, in a corner of one room (LayoutOptions.films). */
  nook: FilmNook | null;
}

/**
 * The films about the artist, shown as museums show them, in a corner of the gallery itself: one room of the
 * suite (the second; a single room's own) is wider, nearly square, and a free-standing wall of its works stands
 * on its left, joined to its near wall. Behind that wall, open at its far end, two rows of the room style's
 * chairs face a screen on the near wall, the projector on its stand behind them. The room's lights reach in only
 * dimly (the room's surfaces darken there: room-shading), and the picture lights it.
 */
export interface FilmNook {
  room: number;
  /** The free-standing wall: its face toward the room (x), its depth (behind the face), its run from its open
   *  end (z0) to the room's near wall (z1), its height. */
  wall: { face: number; thickness: number; z0: number; z1: number; height: number };
  /** The floor behind it: the room's left wall to the wall's back (x0..x1), its open end to the near wall (z0..z1). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** The screen on the near wall, facing −z: its frame (16:9, the largest picture) centred on x = cx, its bottom
   *  edge, its plane (z). */
  screen: { w: number; h: number; bottom: number; z: number; cx: number };
  /** The projector's stand (x, z) and its lens, toward the screen (+z). */
  projector: { x: number; z: number; lens: [number, number, number] };
  /** What stands in the way on its floor besides the chairs (furniture): the projector's stand. */
  blocks: Bench[];
  /** Where the top bar's Films puts the visitor: behind the chairs, facing the screen (yaw π: toward +z). */
  view: { x: number; z: number; yaw: number };
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
/** Benches keep this far from a doorway's wall face (the walk-through line). */
const DOOR_KEEP_OUT = 2.4;
/** Most works one room of a suite holds; a bigger collection gets more rooms. */
export const ROOM_MAX = 12;
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
  /** Hang in the order given instead of by year (a custom room ordered by artist or by fame). */
  keepOrder?: boolean;
  /** The room style's furniture to arrange in the rooms (furniture.ts furnishSizes); none when omitted. */
  furnish?: FurnishSizes;
  /** Wide arches between the rooms instead of doorways: on columns (a palace gallery), or plain. */
  arches?: "columns" | "plain";
  /** An elevator beside the entrance doors (a custom room with more than one floor). */
  elevator?: boolean;
  /** Doors to the artists before and after in the far end wall (an artist's gallery). */
  exits?: boolean;
  /** The phases of the artist's life, in order (each painting's `phase` indexes them): rooms split where a phase
   *  ends, each named after its phase, instead of evenly by year. */
  phases?: string[];
  /** The films about the artist: a corner of one room for them (FilmNook). */
  films?: boolean;
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
      furniture: [],
      barriers: [],
      seats: [],
      elevator: null,
      exits: null,
      rooms: [{ index: 0, z0: -MIN_HALL_LENGTH / 2, z1: MIN_HALL_LENGTH / 2, halfWidth: BASE_HALL_WIDTH / 2, years: null }],
      doorways: [],
      screen: null,
      trackInset: TRACK_INSET,
      nook: null,
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
  const rest = paintings.filter((_, i) => i !== anchorIdx);
  if (!opts.keepOrder) rest.sort(byYear);

  // A big collection becomes a suite: chronological chapters of at most
  // ROOM_MAX works in rooms along one axis. The flagship closes the last
  // room, or, in a suite longer than VISTA_ROOMS, opens the first.
  const chapters: Painting[][] = [];
  const titles: (string | null)[] = [];
  let nRooms: number;
  let overture: boolean;
  let anchorRoom: number;
  const phases = !opts.keepOrder && opts.phases?.length ? opts.phases : null;
  if (phases) {
    // by phase (the unplaced last), by year within it; each phase its own rooms of at most roomMax
    const phaseOf = (p: Painting) => (p.phase != null && p.phase < phases.length ? p.phase : phases.length);
    rest.sort((x, y) => phaseOf(x) - phaseOf(y));
    for (let at = 0; at < rest.length; ) {
      const ph = phaseOf(rest[at]);
      let end = at;
      while (end < rest.length && phaseOf(rest[end]) === ph) end++;
      let from = at;
      for (const size of splitRooms(end - at, hanging.roomMax)) {
        chapters.push(rest.slice(from, from + size));
        titles.push(phases[ph] ?? null);
        from += size;
      }
      at = end;
    }
    if (!chapters.length) {
      chapters.push([]);
      titles.push(null);
    }
    // the films' room (the second) holds half a room's works, so it can be nearly square: the rest of its
    // phase goes on in the room after
    const filmShare = Math.ceil(hanging.roomMax / 2);
    if (opts.films && chapters.length > 1 && chapters[1].length > filmShare) {
      const c = chapters[1];
      chapters.splice(1, 1, c.slice(0, filmShare), c.slice(filmShare));
      titles.splice(1, 0, titles[1]);
    }
    nRooms = chapters.length;
    overture = nRooms > VISTA_ROOMS;
    anchorRoom = overture ? 0 : nRooms - 1;
  } else {
    let roomSizes = splitRooms(paintings.length, hanging.roomMax);
    // the films' room (the second) holds half a room's works, so it can be nearly square
    const filmShare = Math.ceil(hanging.roomMax / 2);
    if (opts.films && roomSizes.length > 1 && roomSizes[1] > filmShare) {
      const others = splitRooms(paintings.length - filmShare, hanging.roomMax);
      roomSizes = [others[0], filmShare, ...others.slice(1)];
    }
    nRooms = roomSizes.length;
    overture = nRooms > VISTA_ROOMS;
    anchorRoom = overture ? 0 : nRooms - 1;
    let at = 0;
    roomSizes.forEach((size, r) => {
      const take = r === anchorRoom ? size - 1 : size; // that room also holds the flagship
      chapters.push(rest.slice(at, at + take));
      titles.push(null);
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
  // the films' corner: in the second room of a suite (as one walks on), in a single room its own
  const filmRoom = opts.films ? Math.min(1, nRooms - 1) : -1;

  // 0 for a room of cabinet pictures (largest side <= 0.9 m), 1 from ~2.1 m up.
  const largest = paintings.reduce((largest, p) => {
    const s = size(p);
    return Math.max(largest, s.w, s.h);
  }, 0);
  const grand = Math.min(1, Math.max(0, (largest - 0.9) / 1.2));
  const baseWidth = cab?.width ?? CABINET_HALL_WIDTH + (BASE_HALL_WIDTH - CABINET_HALL_WIDTH) * grand;
  const baseHeight = cab?.height ?? CABINET_WALL_HEIGHT + (BASE_WALL_HEIGHT - CABINET_WALL_HEIGHT) * grand;
  const minLength = cab?.minLength ?? CABINET_HALL_LENGTH + (MIN_HALL_LENGTH - CABINET_HALL_LENGTH) * grand;

  const run = (ws: Sized[]) =>
    ws.reduce((s, x) => s + x.near + x.far, 0) + hanging.air * Math.max(0, ws.length - 1);
  const tenth = (v: number) => Math.ceil(v * 10) / 10;

  const a = size(anchor);
  const sideMax = rest.reduce((largest, p) => Math.max(largest, size(p).w), 0);
  // the flagship's screen: the work and its label with a margin
  const screenHalf = a.w / 2 + reach(a.w, a.h) + 0.45;
  // the suite's width: what its works need (a room may be wider than this, never narrower)
  const hallWidth = Math.min(
    MAX_HALL_WIDTH,
    Math.ceil(10 * Math.max(
      baseWidth,
      // the flagship + its label, with a metre of wall either side
      2 * (a.w / 2 + reach(a.w, a.h) + 1.0),
      // big side-wall canvases want a longer viewing distance
      sideMax * 1.1 + 2.6,
      // walk-round passages either side of the flagship's screen
      overture ? 2 * (screenHalf + SCREEN_PASSAGE) : 0,
      // the entrance doors, the call buttons and the elevator side by side
      opts.elevator ? ELEVATOR_HALL_WIDTH : 0,
      // a palace gallery's arches want breadth
      opts.arches ? ARCHED_HALL_WIDTH : 0,
      // the doors to the artists before and after, either side of the flagship
      opts.exits ? 2 * (exitInner(overture, a.w / 2 + reach(a.w, a.h)) + exitWidth + EXIT_CORNER) : 0
    )) / 10
  );

  // Tall works raise the ceiling: the frame top keeps HEADROOM below it for
  // the picture rail, the lighting track and its fixtures.
  const maxTop = paintings.reduce((top, p) => {
    const s = size(p);
    return Math.max(top, hangHeight(s.h, eye) + s.h / 2 + frameAllowance(s.w, s.h));
  }, 0);
  const wallHeight = Math.max(tenth(baseHeight), tenth(maxTop + HEADROOM));

  // Doorways scale a little with the wall: ~3.4 m clear in a 4.7 m room. A palace gallery's arches span
  // half the hall and rise nearly to the cornice, on columns.
  const arched = !!opts.arches && !cab;
  const doorHeight = arched ? Math.max(3.8, wallHeight - 0.45) : Math.min(4, Math.max(3, wallHeight - 1.3));
  const doorHalf = arched
    ? Math.min(2.7, Math.max(1.7, hallWidth * 0.26))
    : cab?.doorHalf ?? Math.min(2.8, Math.max(2.4, doorHeight * 0.76)) / 2;

  // No two rooms alike, as in a real museum: now and then one is wider than the rest, and a doorway stands to
  // one side of the axis, so the walk through the suite turns (seeded by the works: the same on every visit).
  const plan = seeded(paintings.map((p) => p.slug).join("|") + "#plan");
  const half = hallWidth / 2;
  const halves = chapters.map(() => {
    const roll = plan();
    const step = plan();
    if (nRooms === 1 || roll < 0.45) return half;
    const steps = cab ? WIDER_CABINET : WIDER;
    return +Math.min(Math.max(half, WIDEST / 2), half + steps[Math.floor(step * steps.length) % steps.length]).toFixed(2);
  });
  let last = 0;
  const offsets = halves.slice(1).map((_, i) => {
    const roll = plan();
    const mag = plan();
    const coin = plan();
    const most = Math.min(halves[i], halves[i + 1]) - doorHalf - DOOR_SIDE;
    // a palace's arches keep to the axis
    if (arched) return 0;
    // the films' room's near doorway moves to the right, to leave its free-standing wall room on the left
    if (i === filmRoom - 1) return (last = +Math.max(0, Math.min(NOOK.shift, halves[i] - doorHalf - DOOR_SIDE)).toFixed(2));
    // and the doorway a short suite's flagship closes keeps to the axis
    if (roll < 0.3 || most < MIN_SHIFT || (!overture && i === nRooms - 2)) return (last = 0);
    // to the other side from the last doorway that moved (the walk zigzags), else either
    const side = last ? -Math.sign(last) : coin < 0.5 ? -1 : 1;
    return (last = +(side * (MIN_SHIFT + mag * (most - MIN_SHIFT))).toFixed(2));
  });

  // The films' room: its free-standing wall stands to the left of the doorway in its near wall, and the room is
  // as wide as the corner behind that wall needs.
  let face = 0;
  if (filmRoom >= 0) {
    let nearX = 0;
    let nearReach: number;
    if (filmRoom === 0) nearReach = ENTRANCE_DOOR.width / 2 + DOOR_CASING + 1.2;
    else {
      nearX = offsets[filmRoom - 1];
      nearReach = doorHalf + (arched && opts.arches === "columns" ? COLUMN_OUT + COLUMN_RADIUS : 0) + NOOK.byDoor;
    }
    face = +(nearX - nearReach).toFixed(2);
    halves[filmRoom] = Math.max(halves[filmRoom], +(NOOK.width + NOOK.thickness - face).toFixed(2));
  }
  // its left-hand works: on the free-standing wall as far as that holds them, the rest on the room's left wall
  // beyond the wall's open end (one at least, of two or more)
  let onWall: Sized[] = [];
  let beyond: Sized[] = [];
  if (filmRoom >= 0) {
    const left = walls[filmRoom].left;
    const room = NOOK.length - entryClear - NOOK.endClear;
    let k = 0;
    let used = 0;
    while (k < left.length) {
      const need = used + (k ? hanging.air : 0) + left[k].near + left[k].far;
      if (need > room) break;
      used = need;
      k++;
    }
    if (k === left.length && k >= 2) k--;
    onWall = left.slice(0, k);
    beyond = left.slice(k);
  }

  // Each room is as long as its own works need (the same rule as one hall); an overture room leaves the
  // flagship's screen a good viewing distance; the films' room is nearly square.
  const roomLengths = walls.map(({ left, right }, r) =>
    r === filmRoom
      ? Math.max(
          tenth(minLength),
          tenth(entryClear + run(right) + farClear),
          tenth(NOOK.length + NOOK.beyond + (beyond.length ? run(beyond) + farClear : 0)),
          tenth(2 * halves[r] * NOOK.square)
        )
      : Math.max(
          tenth(minLength),
          tenth(entryClear + Math.max(run(left), run(right)) + farClear),
          overture && r === 0 ? tenth(SCREEN_BACK + (cab ? 9 : 15)) : 0
        )
  );
  const hallLength =
    roomLengths.reduce((s, l) => s + l, 0) + CROSS_WALL_THICKNESS * (nRooms - 1);

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
    const hw = halves[r];
    // Both walls span the same run (justified spacing), so a wall with fewer
    // or narrower works gets more air instead of ending early.
    const hang = (ws: Sized[], x: number, side: -1 | 1, zNear: number, zFar: number, partition = false): Placement[] => {
      const span = zNear - zFar;
      const total = ws.reduce((s, w) => s + w.near + w.far, 0);
      const gap = ws.length > 1 ? (span - total) / (ws.length - 1) : 0;
      let cursor = ws.length > 1 ? zNear : zNear - (span - total) / 2;
      return ws.map((w): Placement => {
        const z = cursor - w.near;
        cursor = z - w.far - gap;
        return {
          painting: w.painting,
          position: [x, hangHeight(w.h, eye), z],
          rotationY: side === -1 ? Math.PI / 2 : -Math.PI / 2,
          w: w.w,
          h: w.h,
          room: r,
          label: hanging.label,
          ...(partition ? { partition: true } : {}),
        };
      });
    };
    const zNear = z1 - entryClear;
    const zFar = z0 + farClear;
    const lefts =
      r === filmRoom
        ? [
            ...hang(onWall, face + WALL_GAP, -1, zNear, z1 - NOOK.length + NOOK.endClear, true),
            ...hang(beyond, -hw + WALL_GAP, -1, z1 - NOOK.length - NOOK.beyond, zFar),
          ]
        : hang(left, -hw + WALL_GAP, -1, zNear, zFar);
    const rights = hang(right, hw - WALL_GAP, 1, zNear, zFar);
    // Interleave back into chronological order in the placements array.
    for (let i = 0; i < Math.max(lefts.length, rights.length); i++) {
      if (lefts[i]) placements.push(lefts[i]);
      if (rights[i]) placements.push(rights[i]);
    }
  });

  const rooms: SuiteRoom[] = spans.map(({ z0, z1 }, r) => {
    // the room's chronological chapter: the flagship hangs out of sequence
    // (it only stands in for the span when nothing else in the room is dated)
    const years = chapters[r].flatMap((p) => typeof p.year === "number" ? [p.year] : []);
    if (!years.length && r === anchorRoom && typeof anchor.year === "number") years.push(anchor.year);
    return {
      index: r,
      z0,
      z1,
      halfWidth: halves[r],
      years: years.length ? [Math.min(...years), Math.max(...years)] : null,
      title: titles[r] ?? null,
    };
  });

  const doorways: Doorway[] = spans.slice(0, -1).map(({ z0 }, i) => ({
    z: z0 - CROSS_WALL_THICKNESS / 2,
    thickness: CROSS_WALL_THICKNESS,
    x: offsets[i],
    halfWidth: doorHalf,
    height: doorHeight,
    arch: arched ? Math.min(doorHalf * 0.8, doorHeight - 2.6) : 0,
    columns: arched && opts.arches === "columns" ? COLUMN_RADIUS : 0,
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

  const elevator = opts.elevator ? elevatorSpot(2 * halves[0]) : null;
  const exits = opts.exits ? exitDoors(2 * halves[nRooms - 1], exitInner(overture, a.w / 2 + reach(a.w, a.h))) : null;
  // the films' corner behind its wall of works, and its chairs
  const films =
    filmRoom >= 0
      ? filmNook(filmRoom, spans[filmRoom], halves[filmRoom], face, wallHeight, placements.filter((p) => p.partition), opts.furnish)
      : null;
  const nook = films?.nook ?? null;
  const furniture = opts.furnish
    ? furnish({
        halves,
        spans,
        doorways,
        sizes: opts.furnish,
        rng: seeded(paintings.map((p) => p.slug).join("|")),
        anchorRoom,
        // the flagship on the far end wall, and its label
        anchorHalf: overture ? 0 : a.w / 2 + reach(a.w, a.h),
        front: overture ? screenZ + SCREEN_THICKNESS / 2 : null,
        elevator,
        exits: !!exits,
        nook,
      })
    : [];
  if (films) furniture.push(...films.chairs);

  const barriers = placements.filter((pl) => (pl.painting.pageviews ?? 0) >= ROPED_VIEWS).map(ropeOff);
  const seats = opts.furnish?.seats ? furniture.flatMap(opts.furnish.seats) : [];

  return {
    hallWidth, hallLength, wallHeight, placements, furniture, barriers, seats, elevator, exits, rooms, doorways, screen,
    trackInset: cab?.trackInset ?? TRACK_INSET, nook,
  };
}

/** Wider rooms: how much wider (half of it, either side), in a hall and in a cabinet; the widest any room gets. */
const WIDER = [0.4, 0.7, 1.0, 1.3];
const WIDER_CABINET = [0.3, 0.6];
const WIDEST = MAX_HALL_WIDTH + 1;
/** A doorway keeps this much wall either side of it, beside its case, for the room card (room-signs). */
const DOOR_SIDE = 1.5;
/** The least a doorway moves off the axis, when it moves (less would read as a mistake). */
const MIN_SHIFT = 0.7;

/**
 * The films' corner's measures: the floor behind the free-standing wall (across, at least) and the wall's run
 * from the near wall (the screen, two rows of chairs, the projector and an aisle to its open end); the wall's
 * depth; the wall kept clear between a work and its open end, and on the room's left wall beyond it; how far
 * the room's near doorway moves to the right, and the wall the free-standing one keeps from that doorway's case;
 * the room's length to its width.
 */
const NOOK = { width: 4.4, length: 7.4, thickness: 0.24, endClear: 0.55, beyond: 2.0, shift: 1.4, byDoor: 1.9, square: 0.9 };

/** The films' corner of room `room` (FilmNook), its wall's face at x = face; and its seats: the room style's
 *  narrowest chair, up to five to a row, two rows (a style without chairs, an Edo tea house's, its benches
 *  turned across the rows). */
function filmNook(
  room: number,
  span: { z0: number; z1: number },
  half: number,
  face: number,
  wallHeight: number,
  onWall: Placement[],
  furnish?: FurnishSizes
): { nook: FilmNook; chairs: Furnishing[] } {
  const x0 = -half;
  const x1 = +(face - NOOK.thickness).toFixed(3);
  const z1 = span.z1;
  const zEnd = +(z1 - NOOK.length).toFixed(3);
  // the rows by the room's left wall, the aisle beside the wall of works; the screen centred on the rows
  const band0 = x0 + 0.25;
  const band1 = x1 - 0.7;
  const cx = +((band0 + band1) / 2).toFixed(3);
  const sw = Math.min(3, band1 - band0 - 0.2);
  const sz = +(z1 - 0.06).toFixed(3);
  const row1 = sz - Math.max(2.6, sw * 0.95);
  const row2 = row1 - 1.2;
  const standZ = +(row2 - 1.75).toFixed(3);
  const chairs: Furnishing[] = [];
  const pick = furnish?.chairs.length
    ? furnish.chairs.reduce((best, s, i) => (s[0] < furnish.chairs[best][0] ? i : best), 0)
    : -1;
  if (pick >= 0) {
    const [cw, cd] = furnish!.chairs[pick];
    const pitch = cw + 0.06;
    const per = Math.max(3, Math.min(5, Math.floor((band1 - band0 + 0.06) / pitch)));
    const rowW = per * pitch - 0.06;
    [row1, row2].forEach((z, r) => {
      for (let i = 0; i < per; i++) {
        const x = cx - rowW / 2 + cw / 2 + i * pitch;
        // facing the screen (+z), in the style's first fabric, a row a shade apart
        chairs.push({ kind: "chair", index: pick, position: [+x.toFixed(3), +z.toFixed(3)], rotation: 0, size: [cw, cd], room, tint: 0.17 + r * 0.02 });
      }
    });
  } else if (furnish?.centre.length) {
    // a bench runs along its depth: turned a quarter, across the corner
    const [bw, bd] = furnish.centre[0];
    const per = Math.max(1, Math.floor((band1 - band0 + 0.1) / (bd + 0.1)));
    const rowW = per * (bd + 0.1) - 0.1;
    const top = furnish.top?.[0];
    [row1, row2].forEach((z, r) => {
      for (let i = 0; i < per; i++) {
        const x = cx - rowW / 2 + bd / 2 + i * (bd + 0.1);
        chairs.push({
          kind: "centre", index: 0, position: [+x.toFixed(3), +z.toFixed(3)], rotation: Math.PI / 2, size: [bw, bd], room,
          tint: 0.17 + r * 0.02, ...(top ? { top } : {}),
        });
      }
    });
  }
  // as high as its works want, under the room's cornice
  const top = onWall.reduce((t, p) => Math.max(t, p.position[1] + p.h / 2 + frameAllowance(p.w, p.h)), 0);
  const height = +Math.min(wallHeight - 0.5, Math.max(2.9, top + 0.35)).toFixed(2);
  return {
    nook: {
      room,
      wall: { face, thickness: NOOK.thickness, z0: zEnd, z1, height },
      x0,
      x1,
      z0: zEnd,
      z1,
      screen: { w: +sw.toFixed(3), h: +((sw * 9) / 16).toFixed(3), bottom: 0.95, z: sz, cx },
      projector: { x: cx, z: standZ, lens: [cx, 1.96, +(standZ + 0.336).toFixed(3)] },
      blocks: [{ position: [cx, standZ], size: [0.5, 0.75] }],
      view: { x: cx, z: +(row2 - 0.86).toFixed(3), yaw: Math.PI },
    },
    chairs,
  };
}

/** In the films' corner: behind its wall, `margin` in from its open end. */
export function inNook(layout: GalleryLayout, x: number, z: number, margin = 0): boolean {
  const n = layout.nook;
  return !!n && x < n.x1 + 0.05 && x > n.x0 - 0.5 && z > n.z0 + margin && z < n.z1 + 0.5;
}

/** A door's width with its casing. */
const exitWidth = 2 * (EXIT_DOOR.halfWidth + EXIT_DOOR.casing);
/** The far wall kept clear about the axis: the flagship and its label (a long suite's flagship hangs on its screen
 *  in the first room, leaving the far wall bare). */
function exitInner(overture: boolean, anchorHalf: number): number {
  return overture ? 0.9 : anchorHalf + 0.3;
}
/** The doors halfway between the flagship's wall and the corners; none when the hall (at its widest) is too narrow. */
function exitDoors(W: number, inner: number): ExitDoors | null {
  const lo = inner + EXIT_DOOR.casing + EXIT_DOOR.halfWidth;
  const hi = W / 2 - EXIT_CORNER - EXIT_DOOR.casing - EXIT_DOOR.halfWidth;
  if (hi < lo) return null;
  return { x: +((lo + hi) / 2).toFixed(3), halfWidth: EXIT_DOOR.halfWidth, height: EXIT_DOOR.height };
}

/** Narrowest hall that fits the entrance doors, a stretch of wall, the call buttons and an elevator side by side. */
const ELEVATOR_HALL_WIDTH = 8.4;
/** The entrance doors' casing, beyond the opening. */
const DOOR_CASING = 0.25;

/** The elevator: on the entrance wall to the right of the doors as one walks back to them (x < 0), well clear of
 *  them (most of the spare wall lies between the doors and the call buttons, with the floor directory on it), the
 *  call buttons beside the car. */
function elevatorSpot(W: number): ElevatorSpot {
  const inner = ENTRANCE_DOOR.width / 2 + DOOR_CASING;
  const outer = W / 2 - 0.3;
  const frame = 0.1;
  const gap = 0.34; // the call buttons
  const halfWidth = 0.6;
  const spare = Math.max(0, outer - inner - gap - 2 * frame - 2 * halfWidth);
  // the wall between the doors' casing and the call buttons
  const clear = Math.min(2.4, spare * 0.72);
  const x = inner + clear + gap + frame + halfWidth;
  const beyond = outer - (x + halfWidth + frame);
  return {
    x: -x,
    halfWidth,
    height: 2.5,
    panelX: -(inner + clear + gap / 2 + 0.02),
    directoryX: clear >= 0.66 ? -(inner + clear / 2) : beyond >= 0.66 ? -(x + halfWidth + frame + beyond / 2) : null,
    // as wide as reads from a step away (the full floor names), with a margin of wall either side
    directoryWidth: Math.max(0.5, Math.min(0.84, (clear >= 0.66 ? clear : beyond) - 0.2)),
  };
}

/** Works this famous (English Wikipedia views a year) are roped off: the Mona Lisa, The Starry Night, Girl with
 *  a Pearl Earring, The Birth of Venus ... about a dozen. */
const ROPED_VIEWS = 500_000;

/** A rope 1.1 m out from the wall across the work and back to the wall either side (the label stays outside). */
function ropeOff(pl: Placement): Barrier {
  const nx = Math.sin(pl.rotationY);
  const nz = Math.cos(pl.rotationY);
  const tx = nz;
  const tz = -nx;
  const bx = pl.position[0] - nx * WALL_GAP;
  const bz = pl.position[2] - nz * WALL_GAP;
  const half = pl.w / 2 + frameAllowance(pl.w, pl.h) + 0.35;
  const D = 1.1;
  const at = (s: number, d: number): [number, number] => [+(bx + tx * s + nx * d).toFixed(3), +(bz + tz * s + nz * d).toFixed(3)];
  const n = Math.max(1, Math.ceil((2 * half) / 1.6));
  const posts: [number, number][] = [at(-half, 0.14)];
  for (let i = 0; i <= n; i++) posts.push(at(-half + (2 * half * i) / n, D));
  posts.push(at(half, 0.14));
  const xs = posts.map((p) => p[0]);
  const zs = posts.map((p) => p[1]);
  return { posts, box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)], room: pl.room };
}

/** Narrowest hall a palace gallery's arches look right in. */
const ARCHED_HALL_WIDTH = 8.6;
/** The columns either side of a palace gallery's arches: radius, and how far they stand out from the wall face
 *  and the jamb. */
const COLUMN_RADIUS = 0.2;
const COLUMN_OUT = 0.34;

/** Every column a palace gallery's arches stand on: four per arch (both faces, both jambs). */
export function columnsOf(layout: Pick<GalleryLayout, "doorways">): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (const d of layout.doorways) {
    if (!d.columns) continue;
    for (const sz of [-1, 1])
      for (const sx of [-1, 1]) {
        out.push({ x: d.x + sx * (d.halfWidth + COLUMN_OUT), z: d.z + sz * (d.thickness / 2 + COLUMN_OUT), r: d.columns });
      }
  }
  return out;
}

/** A small seeded generator (mulberry32 over an FNV-1a hash): the same works, the same furniture. */
function seeded(key: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Half extents (x, z) of a footprint turned by `ry` about y. */
export function turnedHalf(size: [number, number], ry: number): [number, number] {
  const c = Math.abs(Math.cos(ry));
  const s = Math.abs(Math.sin(ry));
  return [(size[0] * c + size[1] * s) / 2, (size[0] * s + size[1] * c) / 2];
}

/**
 * Furnish each room differently, as a real museum's rooms are: often a bench or an ottoman down the middle
 * (sometimes not), and here and there an armchair set alone at an angle in a corner, a settee against the wall
 * beside a doorway, two chairs and a table. Clear of the spawn point, the doorways' walk-through line, the
 * flagship, the elevator and the side walls' works (which start ENTRY_CLEAR / FAR_CLEAR from the cross walls).
 */
function furnish(o: {
  /** Each room's half width. */
  halves: number[];
  spans: { z0: number; z1: number }[];
  doorways: Doorway[];
  sizes: FurnishSizes;
  rng: () => number;
  anchorRoom: number;
  anchorHalf: number;
  /** An overture's screen face (room 0's far limit), or null. */
  front: number | null;
  elevator: ElevatorSpot | null;
  /** Doors in the far end wall: its corners stay clear. */
  exits: boolean;
  /** The films' corner: its room's near left corner is behind the free-standing wall. */
  nook: FilmNook | null;
}): Furnishing[] {
  const { halves, spans, doorways, sizes, rng, nook } = o;
  const out: Furnishing[] = [];
  const last = spans.length - 1;
  const round = (v: number) => +v.toFixed(3);
  spans.forEach(({ z0, z1 }, r) => {
    const W = 2 * halves[r];
    const films = nook?.room === r ? nook : null;
    // down the middle of the room (in the films' room, of the floor left of its free-standing wall)
    const midX = films ? round((films.wall.face + halves[r]) / 2) : 0;
    const roomTint = rng();
    // most pieces in a room match; now and then one is covered in another of the style's fabrics
    const tint = () => (rng() < 0.3 ? rng() : roomTint);
    let placed = 0;

    // ---- down the middle
    const front = o.front !== null && r === 0 ? o.front : z0;
    const roll = rng();
    if (sizes.centre.length && roll < 0.72) {
      const index = roll < 0.48 || sizes.centre.length === 1 ? 0 : 1 + (Math.floor(rng() * (sizes.centre.length - 1)) % (sizes.centre.length - 1));
      const [w, d] = sizes.centre[index];
      const farKeep = r === o.anchorRoom && o.front === null ? 3.2 - d / 2 : DOOR_KEEP_OUT;
      const nearKeep = r === 0 ? SPAWN_KEEP_OUT : DOOR_KEEP_OUT;
      const lo = front + farKeep + d / 2;
      const hi = z1 - nearKeep - d / 2;
      if (hi > lo) {
        const most = Math.max(1, Math.floor((hi - lo + d) / 7));
        const count = most > 1 && rng() < 0.35 ? most - 1 : most;
        const t = tint();
        for (let i = 0; i < count; i++) {
          const z = count === 1 ? lo + (hi - lo) * (0.3 + 0.4 * rng()) : lo + (i / (count - 1)) * (hi - lo);
          const top = sizes.top?.[index];
          out.push({ kind: "centre", index, position: [midX, round(z)], rotation: 0, size: [w, d], room: r, tint: t, ...(top ? { top } : {}) });
          placed++;
        }
      }
    }

    // ---- by the walls: the four ends of the room's cross walls (or the entrance wall, or the far end wall)
    interface End {
      zWall: number;
      /** Into the room along z from this wall. */
      facing: 1 | -1;
      side: 1 | -1;
      /** The wall is free from |x| = inner to the side wall. */
      inner: number;
    }
    const ends: End[] = [];
    const casing = 0.35;
    // the wall either side of a doorway: from its case (on this side of its centre) to the side wall
    // (a piece keeps to its own side of the axis, even where the doorway has moved over to the other)
    const beside = (d: Doorway, side: 1 | -1) => Math.max(0.3, side * d.x + d.halfWidth + casing + (d.columns ? 0.65 : 0));
    for (const side of [-1, 1] as const) {
      // the near wall: the entrance (not the elevator's side), else the doorway from the room before; not the
      // films' corner, behind its wall
      if (films && side === -1) {
        // (none)
      } else if (r === 0) {
        if (!(o.elevator && side === -1)) ends.push({ zWall: z1, facing: -1, side, inner: ENTRANCE_DOOR.width / 2 + casing });
      } else {
        ends.push({ zWall: z1, facing: -1, side, inner: beside(doorways[r - 1], side) });
      }
      // the far wall: the doorway to the next room (not behind an overture's screen), or the flagship's wall
      if (r < last) {
        if (!(o.front !== null && r === 0)) ends.push({ zWall: z0, facing: 1, side, inner: beside(doorways[r], side) });
      } else if (!o.exits) {
        ends.push({ zWall: z0, facing: 1, side, inner: o.anchorHalf > 0 ? o.anchorHalf + 0.35 : 0.5 });
      }
    }
    const want = placed === 0 ? (rng() < 0.88 ? (rng() < 0.3 ? 2 : 1) : 0) : rng() < 0.32 ? 0 : rng() < 0.78 ? 1 : 2;
    const free = [...ends];
    for (let n = 0; n < want && free.length; n++) {
      const e = free.splice(Math.floor(rng() * free.length) % free.length, 1)[0];
      const outer = W / 2 - 0.12;
      const asChair = sizes.chairs.length > 0 && (sizes.wall.length === 0 || rng() < 0.62);
      if (asChair) {
        // an armchair alone, turned 25-60 degrees from the wall toward the room, tucked into the corner
        const index = Math.floor(rng() * sizes.chairs.length) % sizes.chairs.length;
        const size = sizes.chairs[index];
        const turn = 0.45 + rng() * 0.6;
        const rotation = e.facing === 1 ? -e.side * turn : Math.PI + e.side * turn;
        const [hx, hz] = turnedHalf(size, rotation);
        const gap = 0.05 + rng() * 0.12;
        const x = outer - gap - hx;
        if (x - hx < e.inner) continue;
        out.push({
          kind: "chair", index, rotation: round(rotation), size: [...size], room: r, tint: tint(),
          position: [round(e.side * x), round(e.zWall + e.facing * (hz + 0.06 + gap * 0.5))],
        });
      } else {
        const index = Math.floor(rng() * sizes.wall.length) % sizes.wall.length;
        const [most, depth] = sizes.wall[index];
        const lo = e.inner;
        const hi = W / 2 - 0.55;
        if (hi - lo < 0.75) continue;
        const width = Math.min(most, hi - lo);
        const x = lo + width / 2 + rng() * (hi - lo - width);
        out.push({
          kind: "wall", index, rotation: e.facing === 1 ? 0 : Math.PI, size: [round(width), depth], room: r, tint: tint(),
          position: [round(e.side * x), round(e.zWall + e.facing * (depth / 2 + 0.03))],
        });
      }
    }
  });
  return out;
}

/** Works per room for a collection of `n`: chronological chapters of at
 *  most ROOM_MAX, as even as possible (30 → 10/10/10, 26 → 9/9/8). */
export function splitRooms(n: number, roomMax = ROOM_MAX): number[] {
  const rooms = Math.max(1, Math.ceil(n / roomMax));
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
  let lo = 0;
  let hi = layout.doorways.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (z < layout.doorways[mid].z) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Half the width of the room holding depth z. */
export function halfWidthAt(layout: GalleryLayout, z: number): number {
  return layout.rooms[roomAt(layout, z)]?.halfWidth ?? layout.hallWidth / 2;
}

/** Half the width of the widest room: how far the floor and the cross walls reach. */
export function outerHalf(layout: Pick<GalleryLayout, "hallWidth" | "rooms">): number {
  return layout.rooms.reduce((m, r) => Math.max(m, r.halfWidth), layout.hallWidth / 2);
}

/** Margin kept between the camera and a wall face. */
export const WALL_MARGIN = 0.55;

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

/** How much higher than the feet a bench's top may be and still be stepped onto (landing from a jump). */
const STEP_UP = 0.15;

/** Keep a visitor (x, z on the floor) inside the suite, out of the cross
 *  walls (only the doorways let them through), the flagship's screen and the films' wall, and out of the
 *  furniture: but over a bench once the feet are up at its top (a jump onto it, standing on it). */
export function confine(p: { x: number; z: number }, layout: GalleryLayout, feet = 0): void {
  const m = WALL_MARGIN;
  // each room its own width (the room at the visitor's depth)
  const clampHall = () => {
    p.z = Math.min(layout.hallLength / 2 - m, Math.max(-layout.hallLength / 2 + m, p.z));
    const hw = halfWidthAt(layout, p.z);
    p.x = Math.min(hw - m, Math.max(-hw + m, p.x));
  };
  clampHall();
  for (const b of seatsOf(layout)) {
    if (b.top !== undefined && b.top <= feet + STEP_UP) continue;
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
  // Cross walls: the faces keep the usual wall margin, the jambs the body
  // radius (rounded corners, so the visitor slides round them). The same
  // for the flagship's screen and the films' wall.
  const W = 2 * outerHalf(layout) + 1;
  const grow = m - BODY_RADIUS;
  for (const d of layout.doorways) {
    const zh = d.thickness / 2 + grow;
    pushOut(p, -W, d.x - d.halfWidth, d.z - zh, d.z + zh, BODY_RADIUS);
    pushOut(p, d.x + d.halfWidth, W, d.z - zh, d.z + zh, BODY_RADIUS);
  }
  const s = layout.screen;
  if (s) {
    const zh = s.thickness / 2 + grow;
    pushOut(p, -s.halfWidth, s.halfWidth, s.z - zh, s.z + zh, BODY_RADIUS);
  }
  const w = layout.nook?.wall;
  if (w) pushOut(p, w.face - w.thickness - grow, w.face + grow, w.z0 - grow, w.z1 + 1, BODY_RADIUS);
  clampHall();
}

/** Everything in the way on the floor, as footprints: the furniture (its turned footprint's box), a
 *  palace gallery's columns, the rope barriers and the films' projector. */
const seatBoxes = new WeakMap<GalleryLayout, Bench[]>();
function seatsOf(layout: GalleryLayout): Bench[] {
  const kept = seatBoxes.get(layout);
  if (kept) return kept;
  const out: Bench[] = layout.furniture.map((f) => {
    const [hx, hz] = turnedHalf(f.size, f.rotation);
    return { position: f.position, size: [2 * hx, 2 * hz], ...(f.top ? { top: f.top } : {}) };
  });
  for (const c of columnsOf(layout)) out.push({ position: [c.x, c.z], size: [2 * c.r + 0.1, 2 * c.r + 0.1] });
  for (const { box: [x0, x1, z0, z1] } of layout.barriers) {
    out.push({ position: [(x0 + x1) / 2, (z0 + z1) / 2], size: [x1 - x0 + 0.1, z1 - z0 + 0.1] });
  }
  if (layout.nook) out.push(...layout.nook.blocks);
  seatBoxes.set(layout, out);
  return out;
}

/** What the feet stand on at (x, z): the top of a bench under them no higher than they can step (feet +
 *  STEP_UP), else the floor. */
export function supportAt(layout: GalleryLayout, x: number, z: number, feet: number): number {
  let ground = 0;
  for (const f of layout.furniture) {
    if (!f.top || f.top > feet + STEP_UP || f.top <= ground) continue;
    const dx = x - f.position[0];
    const dz = z - f.position[1];
    const c = Math.cos(f.rotation);
    const s = Math.sin(f.rotation);
    // into the piece's frame (the inverse of its turn)
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) <= f.size[0] / 2 + 0.12 && Math.abs(lz) <= f.size[1] / 2 + 0.12) ground = f.top;
  }
  return ground;
}

/** The nearest place to sit within `reach` of (x, z), or null. */
export function seatNear(layout: GalleryLayout, x: number, z: number, reach = 1.1): SeatSpot | null {
  let best: SeatSpot | null = null;
  let bd = reach * reach;
  for (const s of layout.seats) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Seats, and the flagship's screen as one more (bench-like) obstacle. */
function blockers(layout: GalleryLayout): Bench[] {
  const s = layout.screen;
  if (!s) return seatsOf(layout);
  const depth = s.thickness + 2 * (WALL_MARGIN - BODY_RADIUS);
  return [...seatsOf(layout), { position: [0, s.z], size: [2 * s.halfWidth, depth] }];
}

type P2 = { x: number; z: number };
type Box = [number, number, number, number]; // x0, x1, z0, z1

/** Wall solids a straight walk must miss (grown by the body radius): the cross walls either side of their
 *  doorways, and the films' wall. */
function wallBoxes(layout: GalleryLayout): Box[] {
  const W = 2 * outerHalf(layout) + 1;
  const r = BODY_RADIUS + 0.02;
  const grow = WALL_MARGIN - BODY_RADIUS + r;
  const out: Box[] = [];
  for (const d of layout.doorways) {
    const zh = d.thickness / 2 + grow;
    out.push([-W, d.x - d.halfWidth + r, d.z - zh, d.z + zh], [d.x + d.halfWidth - r, W, d.z - zh, d.z + zh]);
  }
  const w = layout.nook?.wall;
  if (w) out.push([w.face - w.thickness - grow, w.face + grow, w.z0 - grow, w.z1 + 1]);
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

/** The two floor points that lead round the films' wall's open end: on the room's side, then behind it. */
function roundNook(layout: GalleryLayout): [P2, P2] | null {
  const n = layout.nook;
  if (!n) return null;
  const z = n.z0 - WALL_MARGIN - 0.35;
  return [
    { x: n.wall.face + WALL_MARGIN + 0.35, z },
    { x: Math.max(n.x0 + WALL_MARGIN + 0.2, n.x1 - WALL_MARGIN - 0.35), z },
  ];
}

/**
 * Floor waypoints for walking from `a` to `b` (b included, a not): through
 * the middle of every doorway between their rooms, round the films' wall into or out of its corner, and round
 * any bench in the way, then string-pulled so no corner a straight line can cut remains.
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
  const round = roundNook(layout);
  const aIn = inNook(layout, a.x, a.z);
  const bIn = inNook(layout, b.x, b.z);
  if (round && aIn && !bIn) pts.push(round[1], round[0]);
  const step = rb > ra ? 1 : -1;
  for (let r = ra; r !== rb; r += step) {
    const d = layout.doorways[step > 0 ? r : r - 1];
    const off = d.thickness / 2 + WALL_MARGIN + 0.3;
    pts.push({ x: d.x, z: d.z + step * off }, { x: d.x, z: d.z - step * off });
  }
  if (round && bIn && !aIn) pts.push(round[0], round[1]);
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
      const [first, second] = q.z < p.z ? [z1, z0] : [z0, z1];
      const beside = (s: P2) => s.z > z0 && s.z < z1;
      const sideOf = (s: P2) => (s.x < bench.position[0] ? x0 : x1);
      // already alongside it (or stopping alongside): along that side, round the one end
      if (beside(p) && !beside(q)) out.push({ x: sideOf(p), z: second });
      else if (beside(q) && !beside(p)) out.push({ x: sideOf(q), z: first });
      else {
        const side = (p.x + q.x) / 2 < bench.position[0] ? x0 : x1;
        out.push({ x: side, z: first }, { x: side, z: second });
      }
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

/** Where a line first meets a wall: the point, the line's parameter, and the face's normal on the line's side
 *  (nx, nz); `facing` is nz for a cross wall (+1: the face toward the entrance). */
export interface WallHit {
  t: number;
  x: number;
  y: number;
  z: number;
  facing: 1 | -1;
  nx: number;
  nz: number;
}

/**
 * Where the straight line a→b first runs into a cross wall (anywhere but a
 * doorway opening), the flagship's screen or the films' wall: the crossing point and the face's normal toward
 * where the line came from. Null when the line is clear.
 */
export function firstWallHit(a: P3, b: P3, layout: GalleryLayout): WallHit | null {
  let best: WallHit | null = null;
  // a face of constant z, solid where `solid` says
  const zFace = (zf: number, solid: (x: number, y: number) => boolean) => {
    if ((a.z - zf) * (b.z - zf) >= 0) return;
    const t = (zf - a.z) / (b.z - a.z);
    if (best && t >= best.t) return;
    const x = a.x + t * (b.x - a.x);
    const y = a.y + t * (b.y - a.y);
    if (!solid(x, y)) return;
    const facing = a.z > zf ? 1 : -1;
    best = { t, x, y, z: zf, facing, nx: 0, nz: facing };
  };
  const s = layout.screen;
  if (s) {
    // the flagship's screen: a solid box (only its faces matter here)
    for (const zf of [s.z + s.thickness / 2, s.z - s.thickness / 2]) {
      zFace(zf, (x, y) => Math.abs(x) <= s.halfWidth && y <= s.height && y >= 0);
    }
  }
  for (const d of layout.doorways) {
    for (const zf of [d.z + d.thickness / 2, d.z - d.thickness / 2]) {
      zFace(zf, (x, y) => !(Math.abs(x - d.x) <= d.halfWidth && y <= d.height && y >= 0));
    }
  }
  const w = layout.nook?.wall;
  if (w) {
    // the films' wall: its face, its back and its open end
    zFace(w.z0, (x, y) => x >= w.face - w.thickness && x <= w.face && y <= w.height && y >= 0);
    for (const xf of [w.face, w.face - w.thickness]) {
      if ((a.x - xf) * (b.x - xf) >= 0) continue;
      const t = (xf - a.x) / (b.x - a.x);
      if (best && t >= best.t) continue;
      const y = a.y + t * (b.y - a.y);
      const z = a.z + t * (b.z - a.z);
      if (y < 0 || y > w.height || z < w.z0 || z > w.z1) continue;
      const nx = a.x > xf ? 1 : -1;
      best = { t, x: xf, y, z, facing: 1, nx, nz: 0 };
    }
  }
  return best;
}

/** Walking distance between two floor points (through the doorways' centres). */
export function pathDistance(a: P2, b: P2, layout: GalleryLayout): number {
  const ra = roomAt(layout, a.z);
  const rb = roomAt(layout, b.z);
  if (ra === rb) return Math.hypot(b.x - a.x, b.z - a.z);
  const step = rb > ra ? 1 : -1;
  let at: P2 = a;
  let total = 0;
  for (let r = ra; r !== rb; r += step) {
    const d = layout.doorways[step > 0 ? r : r - 1];
    total += Math.hypot(d.x - at.x, d.z - at.z);
    at = d;
  }
  return total + Math.hypot(b.x - at.x, b.z - at.z);
}

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];
/** Room number as museums letter it over a doorway, in Roman numerals. */
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
  const room = layout.rooms[pl.room];
  if (Math.abs(pl.rotationY) > 0.1) {
    const hw = room?.halfWidth ?? layout.hallWidth / 2;
    // across the films' room, the free-standing wall stands in the way along its run
    const w = layout.nook?.room === pl.room ? layout.nook.wall : null;
    if (w && pl.position[2] > w.z0 - 0.5) return hw - w.face - 0.8;
    return 2 * hw - 0.8;
  }
  // the far wall, or the flagship's screen standing in front of it
  return (room ? room.z1 - room.z0 : layout.hallLength) - 1.5 - (layout.screen && pl.room === 0 ? pl.position[2] - room.z0 : 0);
}
