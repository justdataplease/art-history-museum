// Star Map geometry. Each period is a constellation: its artists are stars at
// the dates they worked (sized by how many works the museum hangs), joined in
// order of birth. Portraits, names and period titles are placed greedily on an
// occupancy grid so nothing ever overlaps; whatever does not fit yet stays a
// plain star until the user zooms in.

import type { Artist, Period } from "@/lib/types";
import type { ArtistMeta } from "./artist-meta";
import { Box, boxAt, Occupancy } from "./label-place";
import { textWidth } from "./text-measure";
import {
  clamp,
  jitter,
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
const OFFS = [0.08, -0.62, 0.56, -0.18, 0.86, -0.88, 0.3, -0.42];
const offsetOf = (a: Artist, i: number) => OFFS[i % OFFS.length] + jitter(a.slug, 5) * 0.14;

/**
 * Constellation figure: a minimum spanning tree over the period's stars,
 * computed in a zoom-independent space so the figure never re-wires while
 * zooming. Cached per period.
 */
const treeCache = new Map<string, [number, number][]>();
function constellationEdges(p: Period, arts: Artist[], meta: Map<string, ArtistMeta>): [number, number][] {
  const key = p.slug + "|" + arts.map((a) => a.slug).join(",");
  const hit = treeCache.get(key);
  if (hit) return hit;
  const span = Math.max(20, p.endYear - p.startYear);
  const pts = arts.map((a, i) => [
    ((meta.get(a.slug)!.active.mid - p.startYear) / span) * 2.4,
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
  treeCache.set(key, edges);
  return edges;
}

export function computeStarLayout(inp: StarInput): StarLayout {
  const { periods, byPeriod, meta, lanes, laneCount, w, h, t, top, bottom } = inp;
  const ppy = pxPerYear(w, t.k);
  const detail = smoothstep(3.5, 8, ppy);
  const names = smoothstep(2.2, 3.6, ppy);
  const laneH = (bottom - top) / laneCount;
  const X = (year: number) => xOf(year, w, t);
  const occ = new Occupancy({ x0: 4, y0: top - 8, x1: w - 4, y1: h - 40 });

  // the wall-text caption for the period that fills the view
  let caption: StarLayout["caption"] = null;
  {
    let best = 0;
    let bp: Period | null = null;
    for (const p of periods) {
      const visW = Math.max(0, Math.min(X(p.endYear), w) - Math.max(X(p.startYear), 0));
      const f = smoothstep(0.5, 0.75, visW / w) * smoothstep(380, 460, visW);
      if (f > best) {
        best = f;
        bp = p;
      }
    }
    if (bp && best > 0.02) {
      const cw = Math.min(430, w - 32);
      const box = { x0: 16, y0: h - 64 - 168, x1: 16 + cw, y1: h - 64 };
      caption = { p: bp, o: best, box };
      if (best > 0.3) occ.add(box);
    }
  }

  // ---- stars
  const nodes: StarNode[] = [];
  const byP = new Map<string, StarNode[]>();
  const cyOf = new Map<string, number>();
  for (const p of periods) {
    const lane = lanes.get(p.slug) ?? 0;
    const cy = top + (lane + 0.5) * laneH + t.y;
    cyOf.set(p.slug, cy);
    const list: StarNode[] = [];
    (byPeriod.get(p.slug) ?? []).forEach((a, i) => {
      const m = meta.get(a.slug)!;
      const x = X(m.active.mid);
      const y = cy + offsetOf(a, i) * laneH * 0.36;
      const r = 1.5 + clamp(a.paintingCount || 6, 3, 14) * 0.23;
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
  const coreBox = (n: StarNode) => boxAt(n.x, n.y, n.r * 2 + 6, n.r * 2 + 6);
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
      nebulae.push({ p, cx: (x0 + x1) / 2, cy, rx: (x1 - x0) / 2 + 80, ry: laneH * 0.66 });
    }
    if (list.length > 1 && list.some((n) => n.x > -w && n.x < 2 * w)) {
      let d = "";
      for (const [i, j] of constellationEdges(p, byPeriod.get(p.slug) ?? [], meta)) {
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

  // ---- period titles: narrowest (most crowded) first
  const labels = new Map<string, StarLabel>();
  const leaders: StarLeader[] = [];
  const visible = periods
    .map((p) => ({ p, x0: X(p.startYear), x1: X(p.endYear) }))
    .filter((v) => v.x1 > 0 && v.x0 < w)
    .sort((a, b) => a.x1 - a.x0 - (b.x1 - b.x0));
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
    let placed: Box | null = null;
    let size = clamp(10.5 + bandW / 150, 11, 21);
    let years = true;
    for (let attempt = 0; attempt < 3 && !placed; attempt++) {
      const nameW = textWidth(p.name, "serif-italic-caps", size);
      const yrSize = Math.max(9, size * 0.55);
      const yrW = years ? textWidth(`${p.startYear} – ${p.endYear}`, "sans-caps", yrSize) : 0;
      const bw = Math.max(nameW, yrW) + 6;
      const bh = size * 1.2 + (years ? yrSize * 1.5 + 4 : 0);
      const ax = clamp((bb.x0 + bb.x1) / 2, Math.max(v.x0, 0) + bw / 2, Math.min(v.x1, w) - bw / 2);
      const above = bb.y0 - 12 - bh / 2;
      const below = bb.y1 + 12 + bh / 2;
      const ys = [above, below, above - bh - 8, below + bh + 8, cy];
      const dxs = [0, -0.55, 0.55, -1.1, 1.1, -1.7, 1.7, -2.4, 2.4, -3.2, 3.2];
      const cands: { b: Box; cost: number }[] = [];
      for (const dx of dxs) {
        ys.forEach((yy, j) => {
          const cx = ax + dx * bw;
          cands.push({ b: boxAt(cx, yy, bw, bh), cost: Math.abs(dx) * 1.2 + j * 0.9 });
        });
      }
      cands.sort((a, b) => a.cost - b.cost);
      // leader from a displaced title to the nearest star of its constellation
      const leaderFor = (b: Box): StarLeader | null => {
        const offX = b.x1 < bb.x0 - 6 || b.x0 > bb.x1 + 6;
        const offY = b.y1 < bb.y0 - 40 || b.y0 > bb.y1 + 40;
        if (!(offX || offY) || !list.length) return null;
        const lx = (b.x0 + b.x1) / 2;
        const ly = (b.y0 + b.y1) / 2;
        let near = list[0];
        for (const n of list)
          if (Math.hypot(n.x - lx, n.y - ly) < Math.hypot(near.x - lx, near.y - ly)) near = n;
        const ex = clamp(near.x, b.x0, b.x1);
        const ey = near.y < b.y0 ? b.y0 - 2 : near.y > b.y1 ? b.y1 + 2 : ly;
        const rr = (near.P ? near.P / 2 : near.r) + 4;
        const ang = Math.atan2(ey - near.y, ex - near.x);
        return {
          slug: p.slug,
          x1: near.x + Math.cos(ang) * rr,
          y1: near.y + Math.sin(ang) * rr,
          x2: ex,
          y2: ey,
        };
      };
      // best spot: free, off the constellation lines, with a leader that crosses no label
      let best: { b: Box; ld: StarLeader | null; score: number } | null = null;
      let budget = Infinity;
      for (const c of cands) {
        if (budget-- <= 0) break;
        if (!occ.inBounds(c.b) || !occ.free(c.b, 5)) continue;
        const ld = leaderFor(c.b);
        // crossing a figure line ~ moving 0.8 label widths; a leader through a label ~ 1.6
        const score =
          c.cost +
          (occ.crossesSeg(c.b) ? 1 : 0) +
          (ld && occ.segBlocked(ld.x1, ld.y1, ld.x2, ld.y2) ? 2 : 0);
        if (!best || score < best.score) best = { b: c.b, ld, score };
        if (score === c.cost) break;
        if (budget === Infinity) budget = 12;
      }
      placed = best ? best.b : null;
      if (best) {
        occ.add(best.b);
        labels.set(p.slug, {
          p,
          x: best.b.x0,
          y: best.b.y0,
          w: best.b.x1 - best.b.x0,
          size,
          years,
        });
        if (best.ld) {
          leaders.push(best.ld);
          occ.addSeg(best.ld.x1, best.ld.y1, best.ld.x2, best.ld.y2);
        }
      } else {
        size = Math.max(10, size * 0.85);
        years = false;
      }
    }
  }

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
