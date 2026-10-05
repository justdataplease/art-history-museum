import type { Painting } from "@/lib/types";

export interface Placement {
  painting: Painting;
  position: [number, number, number];
  rotationY: number;
  w: number; // canvas width in meters
  h: number; // canvas height in meters
}

export interface Bench {
  /** Centre on the floor plane (x, z), metres. */
  position: [number, number];
  /** Footprint (width along x, depth along z), metres. */
  size: [number, number];
}

export interface GalleryLayout {
  hallWidth: number;
  hallLength: number;
  wallHeight: number;
  placements: Placement[];
  benches: Bench[];
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
/** Clear wall between one work's footprint (frame + label) and the next. */
const AIR = 1.2;
/** Near (entrance) wall to the first footprint along the side walls. */
const ENTRY_CLEAR = 1.7;
/** Last side-wall footprint to the far wall. */
const FAR_CLEAR = 1.5;
/** Frame top to ceiling: picture rail, track and fixtures live up there. */
const HEADROOM = 1.0;
/** Benches stay out of this stretch in front of the entrance (spawn point). */
const SPAWN_KEEP_OUT = 6.2;
const BENCH_SIZE: [number, number] = [0.62, 1.9];

/** Moulding width the layout budgets for: the widest era frame (0.13 m)
 *  with a margin, growing for monumental canvases whose frames scale up. */
export function frameAllowance(w: number, h: number): number {
  return Math.max(0.16, 0.03 * Math.max(w, h));
}

/** Space a work needs on its label side, beyond the canvas edge. */
function labelReach(w: number, h: number): number {
  return frameAllowance(w, h) + PLACARD_GAP + PLACARD_W;
}

/** Physical canvas size in metres. Prefers Wikidata's measured size
 *  (keeping the image's own aspect so the scan is never distorted), and
 *  falls back to a pixel-aspect heuristic when the size is unknown. */
export function canvasSize(p: Painting): { w: number; h: number } {
  const pxAspect =
    p.imageWidth && p.imageHeight && p.imageWidth > 0 && p.imageHeight > 0
      ? p.imageWidth / p.imageHeight
      : 0;
  const wm = p.widthCm && p.widthCm > 0 ? p.widthCm / 100 : 0;
  const hm = p.heightCm && p.heightCm > 0 ? p.heightCm / 100 : 0;
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
    const grow = Math.max(1, 0.25 / Math.max(w, h));
    return { w: w * grow, h: h * grow };
  }
  const aspect = pxAspect || 0.8;
  if (aspect >= 1.4) {
    // wide landscape: let it breathe
    const w = Math.min(2.9, 1.1 * aspect + 0.6);
    return { w, h: w / aspect };
  }
  const h = aspect < 0.8 ? 1.75 : 1.55;
  return { w: h * aspect, h };
}

/** Height of a work's centre above the floor. */
export function hangHeight(h: number): number {
  return Math.max(EYE, h / 2 + MIN_BOTTOM);
}

/** The flagship: most-viewed article over the last year, else the first work. */
export function pickAnchor(paintings: Painting[]): number {
  let best = 0;
  let bestViews = -1;
  paintings.forEach((p, i) => {
    const v = typeof p.pageviews === "number" && Number.isFinite(p.pageviews) ? p.pageviews : -1;
    if (v > bestViews) {
      bestViews = v;
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

export function buildLayout(paintings: Painting[]): GalleryLayout {
  if (paintings.length === 0) {
    return {
      hallWidth: BASE_HALL_WIDTH,
      hallLength: MIN_HALL_LENGTH,
      wallHeight: BASE_WALL_HEIGHT,
      placements: [],
      benches: [],
    };
  }

  const anchorIdx = pickAnchor(paintings);
  const anchor = paintings[anchorIdx];
  // Chronological along both walls, alternating left / right, so walking
  // toward the flagship walks forward in time. (Array.prototype.sort is
  // stable, so undated works keep their curated order at the end.)
  const rest = paintings.filter((_, i) => i !== anchorIdx).sort(byYear);

  // Left wall (x < 0) faces +x: its local +x (label side) points to −z.
  // Right wall faces −x: its local +x points to +z (toward the entrance).
  const left: Sized[] = [];
  const right: Sized[] = [];
  rest.forEach((p, i) => {
    const { w, h } = canvasSize(p);
    const plain = w / 2 + frameAllowance(w, h);
    const label = w / 2 + labelReach(w, h);
    if (i % 2 === 0) left.push({ painting: p, w, h, near: plain, far: label });
    else right.push({ painting: p, w, h, near: label, far: plain });
  });

  // 0 for a room of cabinet pictures (largest side <= 0.9 m), 1 from ~2.1 m up.
  const largest = Math.max(
    ...[anchor, ...rest].map((p) => {
      const s = canvasSize(p);
      return Math.max(s.w, s.h);
    })
  );
  const grand = Math.min(1, Math.max(0, (largest - 0.9) / 1.2));
  const baseWidth = CABINET_HALL_WIDTH + (BASE_HALL_WIDTH - CABINET_HALL_WIDTH) * grand;
  const baseHeight = CABINET_WALL_HEIGHT + (BASE_WALL_HEIGHT - CABINET_WALL_HEIGHT) * grand;
  const minLength = CABINET_HALL_LENGTH + (MIN_HALL_LENGTH - CABINET_HALL_LENGTH) * grand;

  const run = (ws: Sized[]) =>
    ws.reduce((s, x) => s + x.near + x.far, 0) + AIR * Math.max(0, ws.length - 1);
  const needed = Math.max(run(left), run(right));
  const hallLength = Math.max(
    Math.ceil(minLength * 10) / 10,
    Math.ceil((ENTRY_CLEAR + needed + FAR_CLEAR) * 10) / 10
  );

  const a = canvasSize(anchor);
  const sideMax = Math.max(0, ...rest.map((p) => canvasSize(p).w));
  const hallWidth = Math.min(
    MAX_HALL_WIDTH,
    Math.ceil(10 * Math.max(
      baseWidth,
      // the flagship + its label, with a metre of wall either side
      2 * (a.w / 2 + labelReach(a.w, a.h) + 1.0),
      // big side-wall canvases want a longer viewing distance
      sideMax * 1.1 + 2.6
    )) / 10
  );

  const placements: Placement[] = [];

  // Anchor piece on the far end wall.
  placements.push({
    painting: anchor,
    position: [0, hangHeight(a.h), -hallLength / 2 + WALL_GAP],
    rotationY: 0,
    w: a.w,
    h: a.h,
  });

  // Both walls span the same run (justified spacing), so a wall with fewer
  // or narrower works gets more air instead of ending early.
  const zNear = hallLength / 2 - ENTRY_CLEAR;
  const span = hallLength - ENTRY_CLEAR - FAR_CLEAR;
  const hang = (ws: Sized[], side: -1 | 1): Placement[] => {
    const total = ws.reduce((s, x) => s + x.near + x.far, 0);
    const gap = ws.length > 1 ? (span - total) / (ws.length - 1) : 0;
    let cursor = ws.length > 1 ? zNear : zNear - (span - total) / 2;
    return ws.map((x) => {
      const z = cursor - x.near;
      cursor = z - x.far - gap;
      return {
        painting: x.painting,
        position: [side * (hallWidth / 2 - WALL_GAP), hangHeight(x.h), z],
        rotationY: side === -1 ? Math.PI / 2 : -Math.PI / 2,
        w: x.w,
        h: x.h,
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

  // Tall works raise the ceiling: the frame top keeps HEADROOM below it for
  // the picture rail, the lighting track and its fixtures.
  const maxTop = Math.max(
    ...placements.map((p) => p.position[1] + p.h / 2 + frameAllowance(p.w, p.h))
  );
  const wallHeight = Math.max(
    Math.ceil(baseHeight * 10) / 10,
    Math.ceil((maxTop + HEADROOM) * 10) / 10
  );

  // Benches down the centre line, clear of the spawn point and the far wall.
  const benches: Bench[] = [];
  const lo = -hallLength / 2 + 3.2;
  const hi = hallLength / 2 - SPAWN_KEEP_OUT - BENCH_SIZE[1] / 2;
  if (hi > lo) {
    const count = Math.max(1, Math.floor((hi - lo + BENCH_SIZE[1]) / 7));
    for (let i = 0; i < count; i++) {
      const z = count === 1 ? (lo + hi) / 2 : lo + (i / (count - 1)) * (hi - lo);
      benches.push({ position: [0, +z.toFixed(3)], size: [...BENCH_SIZE] });
    }
  }

  return { hallWidth, hallLength, wallHeight, placements, benches };
}

// ------------------------------------------------------------- navigation

/** Where the camera starts (just inside the doorway) and where the entry walk ends. */
export function entryZ(layout: GalleryLayout): number {
  return layout.hallLength / 2 - 0.85;
}
export function spawnZ(layout: GalleryLayout): number {
  return layout.hallLength / 2 - 3.1;
}

/** Slugs whose textures should be in before the doors open: the flagship on
 *  the far wall plus the `n` works nearest the entrance. */
export function entryGateSlugs(layout: GalleryLayout, n = 4): string[] {
  const [anchor, ...side] = layout.placements;
  if (!anchor) return [];
  const nearest = [...side]
    .sort((a, b) => b.position[2] - a.position[2])
    .slice(0, n)
    .map((p) => p.painting.slug);
  return [anchor.painting.slug, ...nearest];
}

/** Keep a visitor (x, z on the floor) inside the hall and out of the benches. */
export function confine(p: { x: number; z: number }, layout: GalleryLayout): void {
  const m = 0.55;
  p.x = Math.min(layout.hallWidth / 2 - m, Math.max(-layout.hallWidth / 2 + m, p.x));
  p.z = Math.min(layout.hallLength / 2 - m, Math.max(-layout.hallLength / 2 + m, p.z));
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
}

// ----------------------------------------------------------------- labels

/** Placard centre in the placement's local frame (x right, y up, origin at
 *  the canvas centre), given the actual frame moulding width. */
export function placardLocal(pl: Placement, frameWidth: number): { x: number; y: number } {
  const x = pl.w / 2 + frameWidth + PLACARD_GAP + PLACARD_W / 2;
  const half = Math.max(0, pl.h / 2 - PLACARD_H / 2);
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

/** How far the camera may back away from a placement before leaving the hall. */
export function inspectMaxDist(pl: Placement, layout: GalleryLayout): number {
  return Math.abs(pl.rotationY) > 0.1 ? layout.hallWidth - 0.8 : layout.hallLength - 1.5;
}
