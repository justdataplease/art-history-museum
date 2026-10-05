// Collision-free label placement: a 1D "rail" (Gallery Wall period titles)
// and a 2D greedy occupancy grid (Star Map labels and portraits).

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Liang-Barsky: does segment (x1,y1)-(x2,y2) touch box b? */
export function segHitsBox(x1: number, y1: number, x2: number, y2: number, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - b.x0, b.x1 - x1, y1 - b.y0, b.y1 - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

export class Occupancy {
  private boxes: Box[] = [];
  /** soft obstacles (constellation lines): avoided when possible */
  private segs: [number, number, number, number][] = [];
  constructor(private bounds: Box) {}

  addSeg(x1: number, y1: number, x2: number, y2: number): void {
    this.segs.push([x1, y1, x2, y2]);
  }

  /** Does the middle of a segment run through any placed box? */
  segBlocked(x1: number, y1: number, x2: number, y2: number): boolean {
    const ax = x1 + (x2 - x1) * 0.15;
    const ay = y1 + (y2 - y1) * 0.15;
    const bx = x1 + (x2 - x1) * 0.95;
    const by = y1 + (y2 - y1) * 0.95;
    for (const o of this.boxes) if (segHitsBox(ax, ay, bx, by, o)) return true;
    return false;
  }

  crossesSeg(b: Box): boolean {
    for (const [x1, y1, x2, y2] of this.segs) if (segHitsBox(x1, y1, x2, y2, b)) return true;
    return false;
  }

  inBounds(b: Box): boolean {
    const B = this.bounds;
    return b.x0 >= B.x0 && b.x1 <= B.x1 && b.y0 >= B.y0 && b.y1 <= B.y1;
  }

  free(b: Box, pad = 0): boolean {
    for (const o of this.boxes) {
      if (b.x0 - pad < o.x1 && b.x1 + pad > o.x0 && b.y0 - pad < o.y1 && b.y1 + pad > o.y0) {
        return false;
      }
    }
    return true;
  }

  add(b: Box): void {
    this.boxes.push(b);
  }

  /**
   * First candidate box that is inside the bounds and free — preferring ones
   * no soft line crosses; it is added on success.
   */
  claim(cands: Box[], pad = 0, lookahead = 10): Box | null {
    let fallback: Box | null = null;
    let left = Infinity;
    for (const c of cands) {
      if (left-- <= 0) break;
      if (this.inBounds(c) && this.free(c, pad)) {
        if (!this.segs.length || !this.crossesSeg(c)) {
          this.add(c);
          return c;
        }
        if (!fallback) {
          fallback = c;
          left = lookahead;
        }
      }
    }
    if (fallback) this.add(fallback);
    return fallback;
  }
}

export const boxAt = (cx: number, cy: number, w: number, h: number): Box => ({
  x0: cx - w / 2,
  y0: cy - h / 2,
  x1: cx + w / 2,
  y1: cy + h / 2,
});

// ---------------------------------------------------------------- rail

export interface RailItem {
  id: string;
  width: number;
  /** fixed left x when the label fits inside its own band */
  inside: number | null;
  /** preferred left x for a callout */
  want: number;
  /** x of the band point a callout's leader line points at */
  anchor: number;
}

export interface RailSpot {
  x: number;
  row: number;
  callout: boolean;
}

type Interval = [number, number];

function overlaps(iv: Interval[], a: number, b: number): boolean {
  for (const [s, e] of iv) if (a < e && b > s) return true;
  return false;
}

function nearestFree(
  iv: Interval[],
  want: number,
  width: number,
  lo: number,
  hi: number,
  gap: number
): number | null {
  const maxX = hi - width;
  if (maxX < lo) return null;
  const cands = [Math.min(maxX, Math.max(lo, want))];
  for (const [s, e] of iv) {
    cands.push(s - gap - width, e + gap);
  }
  let best: number | null = null;
  for (const c of cands) {
    if (c < lo || c > maxX) continue;
    if (overlaps(iv, c - gap, c + width + gap)) continue;
    if (best === null || Math.abs(c - want) < Math.abs(best - want)) best = c;
  }
  return best;
}

/**
 * Place one lane's period titles on a rail of `rows` rows above the bands.
 * Titles that fit inside their band sit on row 0 over it; the rest become
 * callouts, nudged sideways/up to the nearest free slot (never overlapping)
 * and joined to their band by a leader. Titles that cannot be placed within
 * `maxShift` are dropped (they reappear as the user zooms in).
 */
export function placeRail(
  items: RailItem[],
  width: number,
  rows: number,
  gap = 14,
  margin = 8,
  maxShift = 360
): Map<string, RailSpot> {
  const out = new Map<string, RailSpot>();
  const occ: Interval[][] = Array.from({ length: rows }, () => []);
  const callouts: RailItem[] = [];
  for (const it of items) {
    if (it.inside !== null && !overlaps(occ[0], it.inside - gap, it.inside + it.width + gap)) {
      occ[0].push([it.inside, it.inside + it.width]);
      out.set(it.id, { x: it.inside, row: 0, callout: false });
    } else {
      callouts.push(it);
    }
  }
  callouts.sort((a, b) => a.anchor - b.anchor);
  for (const it of callouts) {
    let best: { x: number; row: number; cost: number } | null = null;
    for (let r = 0; r < rows; r++) {
      const x = nearestFree(occ[r], it.want, it.width, margin, width - margin, gap);
      if (x === null) continue;
      let cost = Math.abs(x - it.want) + r * 36;
      if (r > 0) {
        // the leader drops through the lower rows: keep it off their labels
        const lx = Math.min(Math.max(it.anchor, x + 6), x + it.width - 6);
        const a = Math.min(lx, it.anchor) - 3;
        const b = Math.max(lx, it.anchor) + 3;
        for (let q = 0; q < r; q++) if (overlaps(occ[q], a, b)) cost += 400;
      }
      if (!best || cost < best.cost) best = { x, row: r, cost };
    }
    if (best && best.cost <= maxShift) {
      occ[best.row].push([best.x, best.x + it.width]);
      out.set(it.id, { x: best.x, row: best.row, callout: true });
    }
  }
  return out;
}
