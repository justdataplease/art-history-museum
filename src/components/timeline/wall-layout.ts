// Gallery Wall geometry. Pure: (data, viewport, transform) → boxes in screen px.
//
// Periods sit in packed lanes. Every artist gets a row inside its period's
// band: a lifeline drawn at its true birth → death dates (bolder where it
// overlaps the period), a dated node at the start of the line and its name.
// Each row owns the horizontal "slot" of its period inside the lane (split at
// the midpoint of the gap to the neighbouring bands), so rows and labels can
// never collide. Vertical space is shared out continuously between the lanes
// that are on screen, so zooming or panning never makes the wall jump.

import type { Artist, Period } from "@/lib/types";
import type { ArtistMeta } from "./artist-meta";
import { placeRail, RailItem } from "./label-place";
import { textWidth } from "./text-measure";
import {
  clamp,
  lerp,
  pxPerYear,
  smoothstep,
  Transform,
  xOf,
} from "./timeline-math";

export interface WallInput {
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

export interface WallBand {
  p: Period;
  x0: number;
  x1: number;
  /** drawn extent: the band clipped to its slot in the lane */
  dx0: number;
  dx1: number;
  top: number;
  height: number;
  onScreen: boolean;
  text: { x: number; y: number; w: number; h: number; o: number } | null;
}

export interface WallLabel {
  p: Period;
  x: number;
  y: number;
  w: number;
  size: number;
  years: boolean;
  callout: boolean;
  /** the band itself is off screen; the title heads its visible rows (arrow points to it) */
  ghost: -1 | 0 | 1;
}

export interface WallRow {
  a: Artist;
  p: Period;
  onScreen: boolean;
  y: number;
  ls: number;
  le: number;
  lineY: number;
  clipL: boolean;
  clipR: boolean;
  in0: number;
  in1: number;
  nodeX: number;
  P: number;
  mode: RowMode;
  label: 0 | 1 | 2;
  dates: boolean;
  nameSize: number;
  dateSize: number;
  room: number;
}

export type RowMode = "dot" | "inline" | "full";

export interface WallLeader {
  slug: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WallLayout {
  bands: WallBand[];
  labels: Map<string, WallLabel>;
  rows: WallRow[];
  leaders: WallLeader[];
  rowH: number;
  detail: number;
  overflow: number;
}

const RAIL_ROW_H = 19;
const RAIL_TWO = 44;
const RAIL_ONE = 26;
const PAD_T = 10;
const PAD_B = 8;
const LANE_GAP = 12;
const TEXT_H = 98;
/** px kept free on each side of a slot boundary so neighbouring rows never touch */
const SLOT_GAP = 7;

interface PInfo {
  p: Period;
  lane: number;
  arts: Artist[];
  n: number;
  fs: number;
  fe: number;
  x0: number;
  x1: number;
  v: number;
  f: number;
  visW: number;
}

export function computeWallLayout(inp: WallInput): WallLayout {
  const { periods, byPeriod, meta, lanes, laneCount, w, h, t, top, bottom } = inp;
  const ppy = pxPerYear(w, t.k);
  const detail = smoothstep(2.6, 5.2, ppy);
  const avail = bottom - top + LANE_GAP;
  const margin = Math.max(260, w * 0.35);
  const X = (year: number) => xOf(year, w, t);

  const laneP: Period[][] = Array.from({ length: laneCount }, () => []);
  for (const p of periods) laneP[lanes.get(p.slug) ?? 0].push(p);
  for (const l of laneP) l.sort((a, b) => a.startYear - b.startYear);

  const info = new Map<string, PInfo>();
  laneP.forEach((list, L) =>
    list.forEach((p, i) => {
      const prev = list[i - 1];
      const next = list[i + 1];
      const fs = prev ? (prev.endYear + p.startYear) / 2 : -Infinity;
      const fe = next ? (p.endYear + next.startYear) / 2 : Infinity;
      const arts = byPeriod.get(p.slug) ?? [];
      let es = p.startYear;
      let ee = p.endYear;
      for (const a of arts) {
        const m = meta.get(a.slug);
        if (!m) continue;
        es = Math.min(es, m.life.start);
        ee = Math.max(ee, m.life.end);
      }
      es = Math.max(es, fs);
      ee = Math.min(ee, fe);
      const x0 = X(p.startYear);
      const x1 = X(p.endYear);
      const dist = Math.max(0, X(es) - w, -X(ee));
      const v = 1 - smoothstep(0, margin, dist);
      const visW = Math.max(0, Math.min(x1, w) - Math.max(x0, 0));
      // "zoomed into this period": a narrow window so the wall text is rarely left half-open
      const f = smoothstep(0.66, 0.74, visW / w) * smoothstep(340, 420, visW) * detail;
      info.set(p.slug, { p, lane: L, arts, n: arts.length, fs, fe, x0, x1, v, f, visW });
    })
  );

  // only one wall text at a time: overlapping periods that all fill the view
  // share by a soft arg-max (the most specific, i.e. shortest, period wins)
  {
    let sum = 0;
    const u = new Map<string, number>();
    for (const I of info.values()) {
      if (I.f <= 0) continue;
      const v = Math.pow(I.f, 6) * Math.pow(100 / Math.max(10, I.p.endYear - I.p.startYear), 6);
      u.set(I.p.slug, v);
      sum += v;
    }
    for (const I of info.values()) if (I.f > 0) I.f *= (u.get(I.p.slug) ?? 0) / sum;
  }

  const wL = laneP.map((list) =>
    list.reduce((m, p) => Math.max(m, info.get(p.slug)!.v), 0)
  );
  const railH = lerp(RAIL_TWO, RAIL_ONE, detail);
  const railRows = railH >= 2 * RAIL_ROW_H + 4 ? 2 : 1;

  const laneContent = (L: number, R: number, textOn: number) => {
    let m = 0;
    for (const p of laneP[L]) {
      const I = info.get(p.slug)!;
      const hh = I.v * (I.n * R + I.f * TEXT_H * textOn);
      if (hh > m) m = hh;
    }
    return m;
  };
  const laneFixed = (L: number) => wL[L] * (railH + PAD_T + PAD_B + LANE_GAP);
  const total = (R: number, textOn: number) => {
    let s = 0;
    for (let L = 0; L < laneCount; L++) s += laneFixed(L) + laneContent(L, R, textOn);
    return s;
  };

  const Rmin = lerp(15, 25, detail);
  const Rmax = lerp(30, 58, detail);
  const solve = (textOn: number) => {
    if (total(Rmax, textOn) <= avail) return Rmax;
    if (total(Rmin, textOn) > avail) return Rmin;
    let lo = Rmin;
    let hi = Rmax;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (total(mid, textOn) <= avail) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  // a period that fills the view shows its wall text, even if its rows get tighter
  const textOn = 1;
  const R = solve(textOn);
  const overflow = Math.max(0, total(R, textOn) - avail);

  const laneTop: number[] = [];
  let y = top + t.y;
  for (let L = 0; L < laneCount; L++) {
    laneTop[L] = y;
    y += laneFixed(L) + laneContent(L, R, textOn);
  }

  // ---- bands + wall text
  const bands: WallBand[] = [];
  const bandTopOf = new Map<string, number>();
  const rowsTopOf = new Map<string, number>();
  for (const p of periods) {
    const I = info.get(p.slug)!;
    const L = I.lane;
    const T = I.f * TEXT_H * textOn;
    const bt = laneTop[L] + wL[L] * railH;
    const height = PAD_T + T + I.n * R + PAD_B;
    bandTopOf.set(p.slug, bt);
    rowsTopOf.set(p.slug, bt + PAD_T + T);
    const onScreen = I.x1 > -40 && I.x0 < w + 40 && bt < h && bt + height > 0;
    let text: WallBand["text"] = null;
    if (T > 6 && I.visW > 0) {
      const tw = Math.min(680, I.visW - 48);
      text = {
        x: clamp(Math.max(I.x0, 0) + 24, I.x0 + 24, I.x1 - tw - 24),
        y: bt + PAD_T + 2,
        w: tw,
        h: T - 6,
        o: Math.pow(I.f * textOn, 1.6),
      };
    }
    const sl = Number.isFinite(I.fs) ? X(I.fs) + SLOT_GAP : -1e7;
    const sr = Number.isFinite(I.fe) ? X(I.fe) - SLOT_GAP : 1e7;
    bands.push({
      p,
      x0: I.x0,
      x1: I.x1,
      dx0: Math.max(I.x0, sl),
      dx1: Math.max(Math.max(I.x0, sl) + 2, Math.min(I.x1, sr)),
      top: bt,
      height,
      onScreen,
      text,
    });
  }

  // ---- artist rows
  const baseMode: RowMode = detail < 0.45 || R < 24 ? "dot" : R < 40 ? "inline" : "full";
  const P0 =
    baseMode === "full" ? clamp(R - 10, 30, 46) : baseMode === "inline" ? clamp(R - 6, 18, 28) : R >= 20 ? 8 : 7;
  const nameSize = baseMode === "full" ? (R >= 48 ? 15 : 14) : baseMode === "inline" ? 12.5 : 11.5;
  const dateSize = baseMode === "full" ? 10.5 : baseMode === "inline" ? 9.5 : 9;
  const rows: WallRow[] = [];
  const rowExtent = new Map<string, [number, number]>();
  for (const p of periods) {
    const I = info.get(p.slug)!;
    const rt = rowsTopOf.get(p.slug)!;
    const sL = Number.isFinite(I.fs) ? X(I.fs) + SLOT_GAP : -1e7;
    const sR = Number.isFinite(I.fe) ? X(I.fe) - SLOT_GAP : 1e7;
    I.arts.forEach((a, i) => {
      const m = meta.get(a.slug)!;
      const rowY = rt + i * R;
      const bx = X(m.life.start);
      const dx = X(m.life.end);
      let ls = Math.max(bx, sL);
      let le = Math.min(dx, sR);
      if (le - ls < 4) {
        if (ls >= sR - 4) {
          ls = sR - 4;
          le = sR;
        } else le = ls + 4;
      }
      // a portrait only where the slot is wide enough to hold it
      let mode = baseMode;
      let P = P0;
      if (mode !== "dot" && sR - sL < P + 6) {
        mode = "dot";
        P = 8;
      }
      const half = P / 2;
      const lineY =
        mode === "full" ? rowY + R / 2 : mode === "inline" ? rowY + R * 0.6 : rowY + R - 6;
      // the node stays at the start of the visible line (sticky at the left edge), inside its slot
      const sticky = Math.max(ls, 10 + half);
      const nodeX = clamp(Math.min(sticky, Math.max(ls, le - half)), sL + half, Math.max(sL + half, sR - half));
      const textX = nodeX + (mode === "dot" ? 5 : half + 8);
      const room = Math.min(sR, w - 6) - textX - 2;
      const fullW = textWidth(a.name, "serif", nameSize);
      const shortW = textWidth(m.short, "serif", nameSize);
      const datesW = m.years ? textWidth(m.years, "sans", dateSize) : 0;
      let label: 0 | 1 | 2 = 0;
      if (fullW <= room) label = 2;
      else if (shortW <= room) label = 1;
      const nameW = label === 2 ? fullW : label === 1 ? shortW : 0;
      const dates =
        mode === "full"
          ? label > 0 && datesW <= room
          : label > 0 && R >= 17 && nameW + 8 + datesW <= room;
      const onScreen = le > -30 && ls < w + 30 && rowY + R > top - 30 && rowY < h + 10;
      if (onScreen) {
        const e = rowExtent.get(p.slug);
        const a0 = Math.max(ls, 0);
        const a1 = Math.min(le, w);
        if (a1 > a0) rowExtent.set(p.slug, e ? [Math.min(e[0], a0), Math.max(e[1], a1)] : [a0, a1]);
      }
      rows.push({
        a,
        p,
        onScreen,
        y: rowY,
        ls,
        le,
        lineY,
        clipL: bx < sL - 0.5,
        clipR: dx > sR + 0.5,
        in0: clamp(I.x0, ls, le),
        in1: clamp(I.x1, ls, le),
        nodeX,
        P,
        mode,
        label,
        dates,
        nameSize,
        dateSize,
        room,
      });
    });
  }

  // ---- period titles on each lane's rail
  const labels = new Map<string, WallLabel>();
  const leaders: WallLeader[] = [];
  const size = lerp(11, 14, detail);
  const yrSize = Math.round(size * 0.78 * 10) / 10;
  const labelH = Math.round(size * 1.35);
  laneP.forEach((list, L) => {
    if (wL[L] < 0.05) return;
    const items: RailItem[] = [];
    const meta2 = new Map<string, { years: boolean; anchor: number; ghost: -1 | 0 | 1 }>();
    for (const p of list) {
      const I = info.get(p.slug)!;
      const nameW = textWidth(p.name, "serif-caps", size);
      const yrW = textWidth(`${p.startYear} – ${p.endYear}`, "sans", yrSize);
      const b = bands.find((x) => x.p.slug === p.slug)!;
      const bandOn = b.dx1 > 0 && b.dx0 < w;
      if (!bandOn) {
        // band off screen but some of its rows are not: title the rows, pointing at the band
        const ext = rowExtent.get(p.slug);
        if (!ext) continue;
        const ghost = b.dx0 >= w ? 1 : -1;
        const arrowW = textWidth("→", "sans", yrSize) + 14;
        const width = nameW + arrowW;
        if (width + 16 > ext[1] - ext[0]) continue;
        const x = ghost === 1 ? ext[1] - width - 8 : ext[0] + 8;
        items.push({ id: p.slug, width, inside: x, want: x, anchor: x + width / 2 });
        meta2.set(p.slug, { years: false, anchor: x, ghost });
        continue;
      }
      const bandW = b.dx1 - b.dx0;
      const vx0 = Math.max(b.dx0, 0);
      const vx1 = Math.min(b.dx1, w);
      const fits = (width: number) => {
        if (width + 24 > bandW) return null;
        const x = clamp(vx0 + 14, b.dx0 + 12, b.dx1 - width - 12);
        return x < 4 || x + width > w - 4 ? null : x;
      };
      let years = true;
      let width = nameW + 14 + yrW;
      let inside = fits(width);
      if (inside === null) {
        years = false;
        width = nameW;
        inside = fits(width);
      }
      const anchor = (vx0 + vx1) / 2;
      items.push({ id: p.slug, width, inside, want: anchor - width / 2, anchor });
      meta2.set(p.slug, { years, anchor, ghost: 0 });
    }
    const spots = placeRail(items, w, railRows);
    for (const it of items) {
      const s = spots.get(it.id);
      if (!s) continue;
      const p = info.get(it.id)!.p;
      const bt = bandTopOf.get(it.id)!;
      const bottomY = bt - 5 - s.row * RAIL_ROW_H;
      labels.set(it.id, {
        p,
        x: s.x,
        y: bottomY - labelH,
        w: it.width,
        size,
        years: meta2.get(it.id)!.years,
        callout: s.callout,
        ghost: meta2.get(it.id)!.ghost,
      });
      if (s.callout && !meta2.get(it.id)!.ghost) {
        leaders.push({
          slug: it.id,
          x1: it.anchor,
          y1: bt,
          x2: clamp(it.anchor, s.x + 6, s.x + it.width - 6),
          y2: bottomY + 1,
        });
      }
    }
  });

  return { bands, labels, rows, leaders, rowH: R, detail, overflow };
}
