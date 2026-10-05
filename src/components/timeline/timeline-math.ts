import type { Artist, Period } from "@/lib/types";

export const YEAR_MIN = 1170;
export const YEAR_MAX = 2035;
export const K_MIN = 1;
export const K_MAX = 80;

export interface Transform {
  k: number; // horizontal zoom factor
  x: number; // horizontal pan in px
  y: number; // vertical pan in px
}

export function xOf(year: number, width: number, t: Transform): number {
  return ((year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * width * t.k + t.x;
}

export function yearAt(px: number, width: number, t: Transform): number {
  return ((px - t.x) / (width * t.k)) * (YEAR_MAX - YEAR_MIN) + YEAR_MIN;
}

export function clampTransform(t: Transform, width: number): Transform {
  const k = Math.min(K_MAX, Math.max(K_MIN, t.k));
  const minX = width - width * k;
  const x = Math.min(0, Math.max(minX, t.x));
  const maxY = 140 * (k - 1);
  const y = Math.min(maxY, Math.max(-maxY, t.y));
  return { k, x, y };
}

/** Greedy interval lane packing so overlapping periods stack vertically. */
export function assignLanes(periods: Period[]): {
  lanes: Map<string, number>;
  laneCount: number;
} {
  const sorted = [...periods].sort((a, b) => a.startYear - b.startYear);
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const p of sorted) {
    let lane = laneEnds.findIndex((end) => end <= p.startYear + 2);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = p.endYear;
    lanes.set(p.slug, lane);
  }
  return { lanes, laneCount: laneEnds.length };
}

/** The stretch of years an artist was plausibly active (from Wikipedia dates). */
export function activeRange(a: Artist): { start: number; end: number; mid: number } {
  const birth = a.birthYear ?? 1500;
  const start = birth + 20;
  const end = a.deathYear ?? Math.min(birth + 65, 2026);
  return { start, end, mid: (start + end) / 2 };
}

/** Year-axis tick values for the current zoom level. */
export function ticksFor(width: number, t: Transform): number[] {
  const spanVisible = yearAt(width, width, t) - yearAt(0, width, t);
  const steps = [200, 100, 50, 25, 10, 5];
  const step = steps.find((s) => spanVisible / s <= 14) ?? 5;
  const first = Math.ceil(yearAt(0, width, t) / step) * step;
  const out: number[] = [];
  for (let y = first; y <= yearAt(width, width, t); y += step) {
    if (y >= YEAR_MIN && y <= YEAR_MAX) out.push(y);
  }
  return out;
}

/**
 * Spread a period's artists horizontally by working date with light
 * collision-avoidance: crowded neighbours alternate between two sub-rows.
 */
export function layoutArtists(
  artists: Artist[],
  width: number,
  t: Transform,
  minGap: number
): { artist: Artist; x: number; row: number }[] {
  const placed = artists
    .map((artist) => ({ artist, x: xOf(activeRange(artist).mid, width, t), row: 0 }))
    .sort((a, b) => a.x - b.x);
  for (let i = 1; i < placed.length; i++) {
    if (placed[i].x - placed[i - 1].x < minGap) {
      placed[i].row = placed[i - 1].row === 0 ? 1 : 0;
      if (placed[i].x - placed[i - 1].x < minGap * 0.45) {
        placed[i].x = placed[i - 1].x + minGap * 0.45;
      }
    }
  }
  return placed;
}

/** Deterministic jitter in [-1, 1] from a string (stable across renders/SSR). */
export function jitter(seed: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 2000) / 1000 - 1;
}
