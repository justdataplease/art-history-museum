// Star Map geometry. Each period is a constellation: its artists are stars at
// the dates they worked (sized by how many works the museum hangs), joined in
// order of birth. Constellations share the Gallery Wall's lanes; each keeps to
// its own stretch of the lane, and the lanes on screen share the height by how
// much they hold. Portraits, names and period titles are placed greedily on an
// occupancy grid so nothing ever overlaps; whatever does not fit yet stays a
// plain star until the user zooms in.

import type { Artist, Period } from "@/lib/types";
import type { ArtistMeta } from "./artist-meta";
import { Box, boxAt, Occupancy } from "./label-place";
import { textWidth } from "./text-measure";
import {
  clamp,
  diveFill,
  jitter,
  laneSlots,
  lerp,
  pxPerYear,
  smoothstep,
  Transform,
  xOf,
} from "./timeline-math";

export interface StarInput {
  periods: Period[];
  byPeriod: Map<string, Artist[]>;
  meta: Map<string, ArtistMeta>;
  lanes: Map<string, number>;
  laneCount: number;
  w: number;
  h: number;
  t: Transform;
  top: number;
  bottom: number;
  /** the period the visitor last dived into: its caption wins when it fills the view */
  focus?: string | null;
}

export interface StarNode {
  a: Artist;
  p: Period;
  x: number;
  y: number;
  r: number;
  onScreen: boolean;
  P: number;
  label: { dx: number; dy: number; w: number; name: string; dates: boolean; size: number } | null;
}

export interface StarLabel {
  p: Period;
  x: number;
  y: number;
  w: number;
  size: number;
  years: boolean;
  compact: boolean;
}

export interface StarLeader {
  slug: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface StarLayout {
  nodes: StarNode[];
  lines: { slug: string; d: string }[];
  nebulae: { p: Period; cx: number; cy: number; rx: number; ry: number }[];
  labels: Map<string, StarLabel>;
  leaders: StarLeader[];
  caption: { p: Period; o: number; box: Box } | null;
  detail: number;
}

// zig-zag of vertical offsets (in lane units) so a period's stars spread out
const OFFS = [0.08, -0.62, 0.56, -0.18, 0.86, -0.88, 0.3, -0.42, 0.7, -0.3, 0.42];
const offsetOf = (a: Artist, i: number) => OFFS[i % OFFS.length] + jitter(a.slug, 5) * 0.14;

/**
 * Star radius from the number of works hung, compressed (r ∝ works^0.38) so
 * the whole range reads, from a handful to a couple of hundred:
 * 3 → 1.6px, 12 → 2.7px, 36 → 4.1px, 100 → 6.0px, 190 → 7.6px.
 */
export const starRadius = (works: number) => 1.05 * Math.pow(clamp(works || 6, 1, 240), 0.38);

/** A lane's vertical spread is capped, so a lone constellation stays a constellation. */
const SPREAD_CAP = 250;

type Slot = { fs: number; fe: number };
const OPEN: Slot = { fs: -Infinity, fe: Infinity };

interface StarYears {
  slots: Map<string, Slot>;
  /** artist slug → the year its star is drawn at */
  year: Map<string, number>;
  /** period slug → the middle of its stars (what the overview draws them in toward) */
  centre: Map<string, number>;
  /** constellation figures, filled lazily */
  edges: Map<string, [number, number][]>;
}
const yearsCache = new WeakMap<Map<string, number>, StarYears>();

/**
 * Where each star sits in time: the middle of the artist's working years,
 * kept inside the period's slot of its lane. A constellation whose stars
 * overrun the slot is squeezed into it (linearly, so order and rhythm
 * survive) rather than clamped, which would pile stars up on the edge.
 * Zoom-independent, computed once per lane assignment.
 */
export function starYears(
  periods: Period[],
  byPeriod: Map<string, Artist[]>,
  meta: Map<string, ArtistMeta>,
  lanes: Map<string, number>,
  laneCount: number
): StarYears {
  const hit = yearsCache.get(lanes);
  if (hit) return hit;
  const slots = laneSlots(periods, lanes, laneCount);
  const year = new Map<string, number>();
  const centre = new Map<string, number>();
  for (const p of periods) {
    const arts = byPeriod.get(p.slug) ?? [];
    const s = slots.get(p.slug) ?? OPEN;
    const mids = arts.map((a) => meta.get(a.slug)?.active.mid ?? (p.startYear + p.endYear) / 2);
    if (!mids.length) continue;
    const a0 = Math.min(...mids);
    const a1 = Math.max(...mids);
    const lo = s.fs + 1.5;
    const hi = s.fe - 1.5;
    let b0 = Math.max(a0, lo);
    let b1 = Math.min(a1, hi);
    if (b0 > b1) {
      // the artists' working years lie wholly beyond the slot (Fauvism's six
      // years, its painters working on for decades): spread them across the
      // period's own stretch of the slot instead of piling them on its edge
      b0 = clamp(p.startYear, lo, hi);
      b1 = clamp(p.endYear, lo, hi);
      if (b1 - b0 < 1) b0 = b1 = (Math.max(s.fs, a0) + Math.min(s.fe, a1)) / 2;
    }
    centre.set(p.slug, (b0 + b1) / 2);
    arts.forEach((a, i) => {
      const u = a1 > a0 ? (mids[i] - a0) / (a1 - a0) : 0.5;
      year.set(a.slug, a1 > a0 ? lerp(b0, b1, u) : (b0 + b1) / 2);
    });
  }
  const out = { slots, year, centre, edges: new Map() };
  yearsCache.set(lanes, out);
  return out;
}

/**
 * Constellation figure: a minimum spanning tree over the period's stars,
 * computed in a zoom-independent space so the figure never re-wires while
 * zooming. Cached per period.
 */
function constellationEdges(p: Period, arts: Artist[], sy: StarYears): [number, number][] {
  const hit = sy.edges.get(p.slug);
  if (hit) return hit;
  const span = Math.max(20, p.endYear - p.startYear);
  const pts = arts.map((a, i) => [
    (((sy.year.get(a.slug) ?? p.startYear) - p.startYear) / span) * 2.4,
    offsetOf(a, i),
  ]);
  const n = pts.length;
  const inTree = new Array(n).fill(false);
  const best = new Array(n).fill(Infinity);
  const from = new Array(n).fill(-1);
  const edges: [number, number][] = [];
  if (n) best[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
    inTree[u] = true;
    if (from[u] >= 0) edges.push([from[u], u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = Math.hypot(pts[u][0] - pts[v][0], pts[u][1] - pts[v][1]);
      if (d < best[v]) {
        best[v] = d;
        from[v] = u;
      }
    }
  }
  sy.edges.set(p.slug, edges);
  return edges;
}

export function computeStarLayout(inp: StarInput): StarLayout {
  const { periods, byPeriod, meta, lanes, laneCount, w, h, t, top, bottom } = inp;
  const ppy = pxPerYear(w, t.k);
  const phone = w < 600;
  const compact = phone && ppy < 1.2;
  const titleFace = compact ? "serif-italic-caps-compact" : "serif-italic-caps";
  const detail = smoothstep(3.5, 8, ppy);
  const names = smoothstep(2.2, 3.6, ppy);
  // Overview stars share a phone's limited space; their relative sizes stay
  // intact and grow smoothly to full size before artist names appear.
  const overview = phone ? smoothstep(0.6, 1.2, ppy) : 1;
  const radiusScale = lerp(0.4, 1, overview);
  const spreadScale = lerp(0.55, 1, overview);
  const X = (year: number) => xOf(year, w, t);
  // labels may use the lanes' bottom margin, never the footer row below it
  const occ = new Occupancy({ x0: 4, y0: top - 8, x1: w - 4, y1: bottom + 12 });

  const sy = starYears(periods, byPeriod, meta, lanes, laneCount);
  const slotOf = (p: Period) => sy.slots.get(p.slug) ?? OPEN;

  // ---- lanes share the height by what they show: a lane's weight is its
  // biggest constellation near the screen (smoothly, so nothing jumps)
  const margin = Math.max(240, w * 0.3);
  const weight = new Array<number>(laneCount).fill(0);
  for (const p of periods) {
    const L = lanes.get(p.slug) ?? 0;
    const s = slotOf(p);
    const x0 = X(Math.max(p.startYear - 10, s.fs));
    const x1 = X(Math.min(p.endYear + 10, s.fe));
    const v = 1 - smoothstep(0, margin, Math.max(0, x0 - w, -x1));
    const n = byPeriod.get(p.slug)?.length ?? 0;
    weight[L] = Math.max(weight[L], v * (4 + n));
  }
  let wsum = weight.reduce((a, b) => a + b, 0);
  if (wsum < 1e-6) {
    weight.fill(1);
    wsum = laneCount;
  }
  const laneTop: number[] = [];
  const laneHs: number[] = [];
  {
    let y = top + t.y;
    for (let L = 0; L < laneCount; L++) {
      laneTop[L] = y;
      laneHs[L] = ((bottom - top) * weight[L]) / wsum;
      y += laneHs[L];
    }
  }

  // the wall-text caption for the period that fills the view (of several, the
  // one dived into, else the one most wholly on screen, then the shortest)
  let caption: StarLayout["caption"] = null;
  {
    let best = 0;
    let score = 0;
    let bp: Period | null = null;
    for (const p of periods) {
      const x0 = X(p.startYear);
      const x1 = X(p.endYear);
      const visW = Math.max(0, Math.min(x1, w) - Math.max(x0, 0));
      // a short period can't fill the screen even dived into: it asks for most of what a dive gives
      const need = Math.min(0.5, diveFill(p) * 0.72);
      const f =
        smoothstep(need, need + 0.25 * (need / 0.5), visW / w) *
        smoothstep(Math.min(380, w * need * 0.8), Math.min(460, w * need), visW);
      if (f <= 0) continue;
      const sc =
        f *
        Math.pow(visW / Math.max(1, x1 - x0), 6) *
        (100 / Math.max(10, p.endYear - p.startYear)) *
        (p.slug === inp.focus ? 1e4 : 1);
      if (sc > score) {
        score = sc;
        best = f;
        bp = p;
      }
    }
    if (bp && best > 0.02) {
      const cw = Math.min(430, w - 32);
      const box = { x0: 16, y0: bottom - 168, x1: 16 + cw, y1: bottom };
      caption = { p: bp, o: best, box };
      if (best > 0.3) occ.add(box);
    }
  }

  // ---- stars
  const nodes: StarNode[] = [];
  const byP = new Map<string, StarNode[]>();
  // zoomed out, each constellation draws in a little toward its middle, so
  // neighbours sharing a lane keep a clear gap between their figures
  const shrink = lerp(0.74, 1, smoothstep(1.6, 6, ppy));
  const cyOf = new Map<string, number>();
  const spreadOf = new Map<string, number>();
  for (const p of periods) {
    const lane = lanes.get(p.slug) ?? 0;
    const laneH = laneHs[lane];
    const cy = laneTop[lane] + laneH / 2;
    const spread = Math.min(laneH, SPREAD_CAP) * spreadScale;
    cyOf.set(p.slug, cy);
    spreadOf.set(p.slug, spread);
    const list: StarNode[] = [];
    (byPeriod.get(p.slug) ?? []).forEach((a, i) => {
      const m = meta.get(a.slug)!;
      const yr = sy.year.get(a.slug) ?? m.active.mid;
      const c = sy.centre.get(p.slug) ?? yr;
      const x = X(c + (yr - c) * shrink);
      const y = cy + offsetOf(a, i) * spread * 0.36;
      const r = starRadius(a.paintingCount) * radiusScale;
      const n: StarNode = {
        a,
        p,
        x,
        y,
        r,
        onScreen: x > -60 && x < w + 60 && y > top - 30 && y < h + 30,
        P: 0,
        label: null,
      };
      list.push(n);
      nodes.push(n);
    });
    byP.set(p.slug, list);
  }

  // ---- portraits: biggest bodies of work first, only where they fit
  const coreBox = (n: StarNode) => boxAt(n.x, n.y, n.r * 2 + (compact ? 2 : 6), n.r * 2 + (compact ? 2 : 6));
  if (detail > 0.2) {
    const P = Math.round(lerp(30, 52, detail));
    const placed: Box[] = [];
    const order = nodes
      .filter((n) => n.onScreen)
      .sort((a, b) => (b.a.paintingCount || 0) - (a.a.paintingCount || 0) || a.x - b.x);
    const capBox = caption && caption.o > 0.3 ? caption.box : null;
    for (const n of order) {
      const b = boxAt(n.x, n.y, P + 8, P + 8);
      if (capBox && b.x0 < capBox.x1 && b.x1 > capBox.x0 && b.y0 < capBox.y1 && b.y1 > capBox.y0)
        continue;
      if (b.x0 < 0 || b.x1 > w || b.y0 < top - 12) continue;
      let ok = true;
      for (const o of placed) {
        if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (const m of nodes) {
          if (m === n || !m.onScreen) continue;
          if (Math.abs(m.x - n.x) < P / 2 + m.r + 3 && Math.abs(m.y - n.y) < P / 2 + m.r + 3) {
            ok = false;
            break;
          }
        }
      }
      if (ok) {
        n.P = P;
        placed.push(b);
      }
    }
  }
  for (const n of nodes) {
    if (!n.onScreen) continue;
    occ.add(n.P ? boxAt(n.x, n.y, n.P + 6, n.P + 6) : coreBox(n));
  }

  // ---- constellation lines + nebulae
  const lines: StarLayout["lines"] = [];
  const nebulae: StarLayout["nebulae"] = [];
  for (const p of periods) {
    const list = byP.get(p.slug)!;
    const x0 = X(p.startYear);
    const x1 = X(p.endYear);
    const cy = cyOf.get(p.slug)!;
    if (x1 > -400 && x0 < w + 400) {
      nebulae.push({ p, cx: (x0 + x1) / 2, cy, rx: (x1 - x0) / 2 + 80, ry: spreadOf.get(p.slug)! * 0.66 });
    }
    if (list.length > 1 && list.some((n) => n.x > -w && n.x < 2 * w)) {
      let d = "";
      for (const [i, j] of constellationEdges(p, byPeriod.get(p.slug) ?? [], sy)) {
        const a = list[i];
        const b = list[j];
        d += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
        // keep labels off the figure where possible (shortened so star ends don't count)
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ra = ((a.P ? a.P / 2 : a.r) + 3) / len;
        const rb = ((b.P ? b.P / 2 : b.r) + 3) / len;
        if (ra + rb < 1)
          occ.addSeg(
            a.x + (b.x - a.x) * ra,
            a.y + (b.y - a.y) * ra,
            b.x - (b.x - a.x) * rb,
            b.y - (b.y - a.y) * rb
          );
      }
      lines.push({ slug: p.slug, d });
    }
  }

  // ---- period titles: crowded bands first; reserve wider names first on phones
  const labels = new Map<string, StarLabel>();
  const leaders: StarLeader[] = [];
  const visible = periods
    .map((p) => ({ p, x0: X(p.startYear), x1: X(p.endYear) }))
    .filter((v) => v.x1 > 0 && v.x0 < w)
    .sort((a, b) => compact
      ? textWidth(b.p.name, titleFace, 11) - textWidth(a.p.name, titleFace, 11)
      : a.x1 - a.x0 - (b.x1 - b.x0));

  /** A leader from a displaced title to the nearest star of its constellation. */
  const leaderFor = (slug: string, b: Box, bb: Box, list: StarNode[], always = false): StarLeader | null => {
    const offX = b.x1 < bb.x0 - 6 || b.x0 > bb.x1 + 6;
    const offY = b.y1 < bb.y0 - (always ? 10 : 40) || b.y0 > bb.y1 + (always ? 10 : 40);
    if (!(offX || offY) || !list.length) return null;
    const lx = (b.x0 + b.x1) / 2;
    const ly = (b.y0 + b.y1) / 2;
    let near = list[0];
    for (const n of list) if (Math.hypot(n.x - lx, n.y - ly) < Math.hypot(near.x - lx, near.y - ly)) near = n;
    const ex = clamp(near.x, b.x0, b.x1);
    const ey = near.y < b.y0 ? b.y0 - 2 : near.y > b.y1 ? b.y1 + 2 : ly;
    const rr = (near.P ? near.P / 2 : near.r) + 4;
    const ang = Math.atan2(ey - near.y, ex - near.x);
    return { slug, x1: near.x + Math.cos(ang) * rr, y1: near.y + Math.sin(ang) * rr, x2: ex, y2: ey };
  };
  const place = (p: Period, b: Box, size: number, years: boolean, ld: StarLeader | null) => {
    occ.add(b);
    labels.set(p.slug, { p, x: b.x0, y: b.y0, w: b.x1 - b.x0, size, years, compact });
    if (ld) {
      leaders.push(ld);
      occ.addSeg(ld.x1, ld.y1, ld.x2, ld.y2);
    }
  };
  const titleBox = (p: Period, size: number, years: boolean) => {
    const nameW = textWidth(p.name, titleFace, size);
    const yrSize = Math.max(9, size * 0.55);
    const yrW = years ? textWidth(`${p.startYear} – ${p.endYear}`, "sans-caps", yrSize) : 0;
    return { bw: Math.max(nameW, yrW) + 6, bh: size * 1.2 + (years ? yrSize * 1.5 + 4 : 0) };
  };

  const minSize = phone ? 9 : 10;
  const missed: { v: (typeof visible)[number]; bb: Box; list: StarNode[]; size: number }[] = [];
  for (const v of visible) {
    const { p } = v;
    const bandW = v.x1 - v.x0;
    const list = (byP.get(p.slug) ?? []).filter((n) => n.onScreen);
    const cy = cyOf.get(p.slug)!;
    let bb: Box;
    if (list.length) {
      bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const n of list) {
        const rr = n.P ? n.P / 2 : n.r;
        bb.x0 = Math.min(bb.x0, n.x - rr);
        bb.x1 = Math.max(bb.x1, n.x + rr);
        bb.y0 = Math.min(bb.y0, n.y - rr);
        bb.y1 = Math.max(bb.y1, n.y + rr);
      }
    } else {
      const cx = (Math.max(v.x0, 0) + Math.min(v.x1, w)) / 2;
      bb = { x0: cx, x1: cx, y0: cy, y1: cy };
    }
    let placed = false;
    let size = clamp(10.5 + bandW / 150, 11, 21);
    let years = !compact;
    for (let attempt = 0; attempt < 3 && !placed; attempt++) {
      const { bw, bh } = titleBox(p, size, years);
      const ax = clamp((bb.x0 + bb.x1) / 2, Math.max(v.x0, 0) + bw / 2, Math.min(v.x1, w) - bw / 2);
      const above = bb.y0 - 12 - bh / 2;
      const below = bb.y1 + 12 + bh / 2;
      const ys = [above, below, above - bh - 8, below + bh + 8, cy];
      const dxs = [0, -0.55, 0.55, -1.1, 1.1, -1.7, 1.7, -2.4, 2.4];
      const cands: { b: Box; cost: number }[] = [];
      for (const dx of dxs) {
        ys.forEach((yy, j) => {
          const cx = ax + dx * bw;
          cands.push({ b: boxAt(cx, yy, bw, bh), cost: Math.abs(dx) * 1.2 + j * 0.9 });
        });
      }
      // beside the figure, level with it
      for (const [side, cost] of [[-1, 1.15], [1, 1.25]] as const) {
        const cx = side < 0 ? bb.x0 - 12 - bw / 2 : bb.x1 + 12 + bw / 2;
        cands.push({ b: boxAt(cx, (bb.y0 + bb.y1) / 2, bw, bh), cost });
      }
      cands.sort((a, b) => a.cost - b.cost);
      // a title further than this from its stars no longer reads as theirs
      const reachX = Math.max(60, bw * 0.45);
      const reachY = bh + 26;
      // best spot: free, off the constellation lines, with a leader that crosses no label
      let best: { b: Box; ld: StarLeader | null; score: number } | null = null;
      let budget = Infinity;
      for (const c of cands) {
        if (budget-- <= 0) break;
        if (!occ.inBounds(c.b) || !occ.free(c.b, compact ? 2 : 5)) continue;
        if (list.length) {
          const gx = Math.max(0, c.b.x0 - bb.x1, bb.x0 - c.b.x1);
          const gy = Math.max(0, c.b.y0 - bb.y1, bb.y0 - c.b.y1);
          if (gx > reachX || gy > reachY) continue;
        }
        const ld = leaderFor(p.slug, c.b, bb, list);
        // crossing a figure line ~ moving 0.8 label widths; a leader through a label or star ~ 2.5
        const score =
          c.cost +
          (occ.crossesSeg(c.b) ? 1 : 0) +
          (ld && occ.segBlocked(ld.x1, ld.y1, ld.x2, ld.y2) ? 3 : 0);
        if (!best || score < best.score) best = { b: c.b, ld, score };
        if (score === c.cost) break;
        if (budget === Infinity) budget = 12;
      }
      if (best) {
        place(p, best.b, size, years, best.ld);
        placed = true;
      } else {
        size = Math.max(10, size * 0.85);
        years = false;
      }
    }
    if (!placed) {
      if (phone) placeDistant(v, bb, list, size);
      else missed.push({ v, bb, list, size });
    }
  }

  // Every constellation on screen keeps its title. Those the close search
  // could not seat take the nearest free spot further out (in small type,
  // without the years), joined to their stars by a leader. Include the full
  // phone viewport: its crowded recent centuries need the empty space on
  // the other side of the map to keep every period discoverable.
  function placeDistant(v: (typeof visible)[number], bb: Box, list: StarNode[], s0: number) {
    const { p } = v;
    for (const size of [Math.max(minSize, Math.min(s0, 12)), minSize]) {
      if (labels.has(p.slug)) break;
      const { bw, bh } = titleBox(p, size, false);
      const cx0 = clamp((bb.x0 + bb.x1) / 2, Math.max(v.x0, 0), Math.min(v.x1, w));
      const cy0 = (bb.y0 + bb.y1) / 2;
      type Placement = { b: Box; ld: StarLeader | null; score: number };
      let best: Placement | null = null;
      const pad = compact ? 1 : 3;
      const consider = (cx: number, cy: number, current: Placement | null): Placement | null => {
        const distance = Math.hypot(cx - cx0, (cy - cy0) * 1.4);
        if (current && distance >= current.score) return current;
        const b = boxAt(cx, cy, bw, bh);
        if (!occ.inBounds(b) || !occ.free(b, pad)) return current;
        const ld = leaderFor(p.slug, b, bb, list, true);
        const score = distance + (occ.crossesSeg(b) ? 40 : 0) +
          (ld && occ.segBlocked(ld.x1, ld.y1, ld.x2, ld.y2) ? 120 : 0);
        return !current || score < current.score ? { b, ld, score } : current;
      };
      if (phone) {
        // A small viewport also needs the free gaps inside a figure's bounding
        // box. Keep only the nearest free spots before scoring figure lines
        // and leaders, so a crowded collection does not scan every line at
        // every grid point.
        const nearby: { cx: number; cy: number; distance: number }[] = [];
        for (let cy = top - 8 + bh / 2; cy <= bottom + 12 - bh / 2; cy += 4) {
          for (let cx = 4 + bw / 2; cx <= w - 4 - bw / 2; cx += 8) {
            const distance = Math.hypot(cx - cx0, (cy - cy0) * 1.4);
            if (nearby.length === 24 && distance >= nearby[23].distance) continue;
            if (!occ.free(boxAt(cx, cy, bw, bh), pad)) continue;
            nearby.push({ cx, cy, distance });
            nearby.sort((a, b) => a.distance - b.distance);
            if (nearby.length > 24) nearby.pop();
          }
        }
        for (const { cx, cy } of nearby) best = consider(cx, cy, best);
      } else {
        // Rings around the figure's edge, nearest first.
        const hw = (bb.x1 - bb.x0) / 2 + bw / 2 + 8;
        const hh = (bb.y1 - bb.y0) / 2 + bh / 2 + 8;
        const limit = Math.max(240, w * 0.45);
        for (let r = 0; r <= limit && !best; r += 12) {
          const steps = Math.max(24, Math.ceil((2 * Math.PI * (Math.max(hw, hh) + r)) / Math.max(8, bh / 3)));
          for (let i = 0; i < steps; i++) {
            const a = (i / steps) * Math.PI * 2;
            best = consider(cx0 + Math.cos(a) * (hw + r), cy0 + Math.sin(a) * (hh + r * 0.6), best);
          }
        }
      }
      if (best) place(p, best.b, size, false, best.ld);
    }
  }
  for (const { v, bb, list, size } of missed) placeDistant(v, bb, list, size);

  // ---- artist names (portraits first, then the brightest stars)
  const nameOrder = nodes
    .filter((n) => n.onScreen && (n.P || names > 0.5))
    .sort((a, b) => (b.P ? 1 : 0) - (a.P ? 1 : 0) || (b.a.paintingCount || 0) - (a.a.paintingCount || 0));
  for (const n of nameOrder) {
    const m = meta.get(n.a.slug)!;
    const size = n.P ? 13.5 : 11.5;
    const dsz = 10;
    const tryName = (name: string, dates: boolean) => {
      const nw = textWidth(name, "serif", size);
      const dw = dates && m.years ? textWidth(m.years, "sans", dsz) : 0;
      const bw = Math.max(nw, dw) + 4;
      const bh = size * 1.2 + (dw ? dsz * 1.4 + 2 : 0);
      const rr = n.P ? n.P / 2 : n.r + 2;
      const spots: [number, number][] = [
        [n.x, n.y + rr + 5 + bh / 2],
        [n.x + rr + 7 + bw / 2, n.y],
        [n.x - rr - 7 - bw / 2, n.y],
        [n.x, n.y - rr - 5 - bh / 2],
      ];
      const b = occ.claim(
        spots.map(([cx, cy]) => boxAt(cx, cy, bw, bh)),
        2
      );
      if (!b) return false;
      n.label = {
        dx: b.x0 - n.x,
        dy: b.y0 - n.y,
        w: b.x1 - b.x0,
        name,
        dates: !!dw,
        size,
      };
      return true;
    };
    if (!tryName(n.a.name, !!n.P)) if (!tryName(m.short, !!n.P)) if (n.P) tryName(m.short, false);
  }

  return { nodes, lines, nebulae, labels, leaders, caption, detail };
}
