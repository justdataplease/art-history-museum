import type { Artist, Period } from "@/lib/types";

// Leave a margin before Li Cheng (born 919), the earliest indexed painter.
export const YEAR_MIN = 900;
export const YEAR_MAX = 2035;
export const YEAR_SPAN = YEAR_MAX - YEAR_MIN;
export const K_MIN = 1;
export const K_MAX = 80;

export interface Transform {
  k: number; // horizontal zoom factor
  x: number; // horizontal pan in px
  y: number; // vertical pan in px (<= 0; only when a view overflows)
}

export function xOf(year: number, width: number, t: Transform): number {
  return ((year - YEAR_MIN) / YEAR_SPAN) * width * t.k + t.x;
}

export function yearAt(px: number, width: number, t: Transform): number {
  return ((px - t.x) / (width * t.k)) * YEAR_SPAN + YEAR_MIN;
}

export function pxPerYear(width: number, k: number): number {
  return (width * k) / YEAR_SPAN;
}

/** Keep the transform inside the timeline; `overflowY` is how far the active view may scroll down. */
export function clampTransform(t: Transform, width: number, overflowY = 0): Transform {
  const k = Math.min(K_MAX, Math.max(K_MIN, t.k));
  const minX = width - width * k;
  const x = Math.min(0, Math.max(minX, t.x));
  const y = Math.min(0, Math.max(-Math.max(0, overflowY), t.y));
  return { k, x, y };
}

/** The transform that frames [startYear, endYear] across the full width. */
export function frameYears(startYear: number, endYear: number, width: number): Transform {
  const span = Math.max(1, endYear - startYear);
  const k = Math.min(K_MAX * 0.9, Math.max(K_MIN, YEAR_SPAN / span));
  const mid = (startYear + endYear) / 2;
  return { k, x: width / 2 - ((mid - YEAR_MIN) / YEAR_SPAN) * width * k, y: 0 };
}

/** The years a dive into `p` frames: the period and a slim margin either side. */
export function diveYears(p: Period): [number, number] {
  const pad = Math.max(1.5, (p.endYear - p.startYear) * 0.07);
  return [p.startYear - pad, p.endYear + pad];
}

/**
 * How much of the screen's width `p` fills once dived into: most of it, but
 * less for the shortest periods (Fauvism's six years), where the zoom tops out.
 */
export function diveFill(p: Period): number {
  const [a, b] = diveYears(p);
  const k = Math.min(K_MAX * 0.9, Math.max(K_MIN, YEAR_SPAN / Math.max(1, b - a)));
  return Math.min(1, ((p.endYear - p.startYear) * k) / YEAR_SPAN);
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function smoothstep(e0: number, e1: number, v: number): number {
  const t = clamp((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Interval lane packing so overlapping periods stack vertically. A lane is as
 * tall as its biggest period, so periods are placed biggest first, each into
 * the lane it fits whose tallest period is the closest above it (best fit):
 * small periods fill the gaps beside big ones instead of opening lanes of
 * their own. Lanes are then ordered by their earliest period. Pure and
 * deterministic (no zoom input), so both views keep one stable arrangement.
 */
export function assignLanes(
  periods: Period[],
  sizes?: Map<string, number>
): {
  lanes: Map<string, number>;
  laneCount: number;
} {
  const n = (p: Period) => sizes?.get(p.slug) ?? 0;
  const span = (p: Period) => p.endYear - p.startYear;
  const order = [...periods].sort(
    (a, b) => n(b) - n(a) || span(b) - span(a) || a.startYear - b.startYear || a.slug.localeCompare(b.slug)
  );
  // two periods may share a lane when they overlap by at most two years
  const fits = (l: Period[], p: Period) =>
    l.every((q) => q.endYear <= p.startYear + 2 || p.endYear <= q.startYear + 2);
  const packed: { list: Period[]; max: number }[] = [];
  for (const p of order) {
    let best: (typeof packed)[number] | null = null;
    for (const l of packed) {
      if (!fits(l.list, p)) continue;
      if (!best || l.max - n(p) < best.max - n(p)) best = l;
    }
    if (!best) {
      best = { list: [], max: n(p) };
      packed.push(best);
    }
    best.list.push(p);
  }
  const first = (l: Period[]) => Math.min(...l.map((p) => p.startYear));
  packed.sort((a, b) => first(a.list) - first(b.list) || b.max - a.max);
  const lanes = new Map<string, number>();
  packed.forEach((l, i) => l.list.forEach((p) => lanes.set(p.slug, i)));
  return { lanes, laneCount: Math.max(1, packed.length) };
}

/**
 * Each period's own stretch of its lane, in years: split at the midpoint of
 * the gap (or overlap) to the neighbouring periods in the same lane, open
 * (±Infinity) at the lane's ends. Rows and stars stay inside it, so the
 * neighbours' artists can never interleave.
 */
export function laneSlots(
  periods: Period[],
  lanes: Map<string, number>,
  laneCount: number
): Map<string, { fs: number; fe: number }> {
  const byLane: Period[][] = Array.from({ length: laneCount }, () => []);
  for (const p of periods) byLane[lanes.get(p.slug) ?? 0].push(p);
  const out = new Map<string, { fs: number; fe: number }>();
  for (const list of byLane) {
    list.sort((a, b) => a.startYear - b.startYear);
    list.forEach((p, i) => {
      const prev = list[i - 1];
      const next = list[i + 1];
      out.set(p.slug, {
        fs: prev ? (prev.endYear + p.startYear) / 2 : -Infinity,
        fe: next ? (p.endYear + next.startYear) / 2 : Infinity,
      });
    });
  }
  return out;
}

/** The stretch of years an artist was plausibly active (from Wikipedia dates). */
export function activeRange(a: Artist): { start: number; end: number; mid: number } {
  const birth = a.birthYear ?? 1500;
  const start = birth + 20;
  const end = a.deathYear ?? Math.min(birth + 65, 2026);
  return { start, end, mid: (start + end) / 2 };
}

/** Birth → death (living artists run to the present). */
export function lifeRange(a: Artist): { start: number; end: number } {
  const start = a.birthYear ?? activeRange(a).start - 20;
  const end = a.deathYear ?? Math.max(start + 1, new Date().getFullYear());
  return { start, end };
}

// ------------------------------------------------------------------ axis ticks

export interface AxisTicks {
  major: number[];
  mid: number[];
  minor: number[];
  step: number;
}

const MAJOR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200];
const MINOR_OF: Record<number, number> = {
  1: 0,
  2: 1,
  5: 1,
  10: 1,
  20: 5,
  25: 5,
  50: 10,
  100: 10,
  200: 50,
};

/**
 * A ruler for the visible window: the densest labelled step that keeps labels
 * at least ~90px apart, a half-step "mid" tick and fine minor ticks when they
 * are at least 6px apart.
 */
export function axisTicks(width: number, t: Transform): AxisTicks {
  const ppy = pxPerYear(width, t.k);
  const minPx = width < 640 ? 70 : 96;
  const step = MAJOR_STEPS.find((s) => s * ppy >= minPx) ?? 200;
  let minor = MINOR_OF[step];
  if (minor && minor * ppy < 6) minor = 0;
  const half = step % 2 === 0 && step >= 2 ? step / 2 : 0;
  const y0 = Math.max(YEAR_MIN, Math.floor(yearAt(-20, width, t)));
  const y1 = Math.min(YEAR_MAX, Math.ceil(yearAt(width + 20, width, t)));
  const major: number[] = [];
  const mid: number[] = [];
  const minorOut: number[] = [];
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) major.push(y);
  if (half && half * ppy >= 14) {
    for (let y = Math.ceil(y0 / half) * half; y <= y1; y += half) if (y % step) mid.push(y);
  }
  if (minor) {
    for (let y = Math.ceil(y0 / minor) * minor; y <= y1; y += minor) {
      if (y % step && (!half || y % half)) minorOut.push(y);
    }
  }
  return { major, mid, minor: minorOut, step };
}

/** Deterministic jitter in [-1, 1] from a string (stable across renders/SSR). */
export function jitter(seed: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 2000) / 1000 - 1;
}
