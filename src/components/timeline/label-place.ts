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

const CELL_SIZE = 32;

export class Occupancy {
  private boxes: Box[] = [];
  private cells = new Map<number, Map<number, Box[]>>();
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
    for (let y = Math.floor((b.y0 - pad) / CELL_SIZE); y <= Math.floor((b.y1 + pad) / CELL_SIZE); y++) {
      const row = this.cells.get(y);
      if (!row) continue;
      for (let x = Math.floor((b.x0 - pad) / CELL_SIZE); x <= Math.floor((b.x1 + pad) / CELL_SIZE); x++) {
        const cell = row.get(x);
        if (!cell) continue;
        for (const o of cell) {
          if (b.x0 - pad < o.x1 && b.x1 + pad > o.x0 && b.y0 - pad < o.y1 && b.y1 + pad > o.y0)
            return false;
        }
      }
    }
    return true;
  }

  add(b: Box): void {
    this.boxes.push(b);
    for (let y = Math.floor(b.y0 / CELL_SIZE); y <= Math.floor(b.y1 / CELL_SIZE); y++) {
      let row = this.cells.get(y);
      if (!row) this.cells.set(y, row = new Map());
      for (let x = Math.floor(b.x0 / CELL_SIZE); x <= Math.floor(b.x1 / CELL_SIZE); x++) {
        const cell = row.get(x);
        if (cell) cell.push(b);
        else row.set(x, [b]);
      }
    }
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
  /** where along the band the leader may land (its visible extent) */
  a0?: number;
  a1?: number;
}

export interface RailSpot {
  x: number;
  row: number;
  callout: boolean;
  /** x where the callout's leader meets the band */
  lx: number;
}

type Interval = [number, number];

function overlaps(iv: Interval[], a: number, b: number): boolean {
  for (const [s, e] of iv) if (a < e && b > s) return true;
  return false;
}

function nearestFree(
  iv: Interval[],
  posts: number[],
  want: number,
  width: number,
  lo: number,
  hi: number,
  gap: number,
  postGap: number
): number | null {
  const maxX = hi - width;
  if (maxX < lo) return null;
  const cands = [Math.min(maxX, Math.max(lo, want))];
  for (const [s, e] of iv) cands.push(s - gap - width, e + gap);
  for (const p of posts) cands.push(p - postGap - width, p + postGap);
  let best: number | null = null;
  for (const c of cands) {
    if (c < lo || c > maxX) continue;
    if (overlaps(iv, c - gap, c + width + gap)) continue;
    if (posts.some((p) => p > c - postGap && p < c + width + postGap)) continue;
    if (best === null || Math.abs(c - want) < Math.abs(best - want)) best = c;
  }
  return best;
}

/**
 * Place one lane's period titles on a rail of `rows` rows above the bands.
 * Titles that fit inside their band sit on row 0 over it; the rest become
 * callouts, nudged sideways/up to the nearest free slot (never overlapping)
 * and joined to their band by a leader. Narrow bands are served first (they
 * have the least room to give), a callout never leaves its own band by more
 * than `reach` px (or it would read as a neighbour's title), and a raised
 * callout's leader keeps a clear path down through the rows below it. Titles
 * that find no such spot are dropped: they reappear as the user zooms in.
 */
export function placeRail(
  items: RailItem[],
  width: number,
  rows: number,
  gap = 14,
  margin = 8,
  reach = 26
): Map<string, RailSpot> {
  const out = new Map<string, RailSpot>();
  const occ: Interval[][] = Array.from({ length: rows }, () => []);
  /** x of leaders rising through each row */
  const posts: number[][] = Array.from({ length: rows }, () => []);
  const callouts: RailItem[] = [];
  for (const it of items) {
    if (it.inside !== null && !overlaps(occ[0], it.inside - gap, it.inside + it.width + gap)) {
      occ[0].push([it.inside, it.inside + it.width]);
      out.set(it.id, { x: it.inside, row: 0, callout: false, lx: it.anchor });
    } else {
      callouts.push(it);
    }
  }
  const span = (it: RailItem) => (it.a1 ?? it.anchor) - (it.a0 ?? it.anchor);
  callouts.sort((a, b) => span(a) - span(b) || a.anchor - b.anchor);
  for (const it of callouts) {
    const a0 = it.a0 ?? it.anchor;
    const a1 = Math.max(a0, it.a1 ?? it.anchor);
    const lo = Math.max(margin, a0 - reach - it.width);
    const hi = Math.min(width - margin, a1 + reach + it.width);
    let best: { x: number; row: number; cost: number; lx: number } | null = null;
    for (let r = 0; r < rows; r++) {
      const x = nearestFree(occ[r], posts[r], it.want, it.width, lo, hi, gap, 5);
      if (x === null) continue;
      const cost = Math.abs(x - it.want) + r * 36;
      if (best && cost >= best.cost) continue;
      // the leader lands on the band as close under the title as it can...
      const target = Math.min(Math.max(x + it.width / 2, a0), a1);
      let lx: number | null = target;
      if (r > 0) {
        // ...and rises through the lower rows somewhere off their labels
        const blocked = (c: number) => {
          for (let q = 0; q < r; q++) if (overlaps(occ[q], c - 3, c + 3)) return true;
          return false;
        };
        if (blocked(target)) {
          lx = null;
          for (let q = 0; q < r; q++)
            for (const [s, e] of occ[q])
              for (const c of [s - 5, e + 5])
                if (c >= a0 && c <= a1 && !blocked(c) && (lx === null || Math.abs(c - target) < Math.abs(lx - target)))
                  lx = c;
        }
      }
      if (lx === null) continue;
      best = { x, row: r, cost, lx };
    }
    if (best) {
      occ[best.row].push([best.x, best.x + it.width]);
      for (let q = 0; q < best.row; q++) posts[q].push(best.lx);
      out.set(it.id, { x: best.x, row: best.row, callout: true, lx: best.lx });
    }
  }
  return out;
}
