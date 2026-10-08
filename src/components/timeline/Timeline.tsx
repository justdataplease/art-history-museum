"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import gsap from "gsap";
import Link from "next/link";
import type { Artist, Period, TimelineData } from "@/lib/types";
import {
  assignLanes,
  axisTicks,
  clamp,
  clampTransform,
  diveYears,
  frameYears,
  K_MAX,
  K_MIN,
  lerp,
  Transform,
  YEAR_MAX,
  YEAR_MIN,
  YEAR_SPAN,
  yearAt,
} from "./timeline-math";
import { buildArtistMeta, buildPeriodStyles } from "./artist-meta";
import { whenFontsReady } from "./text-measure";
import { computeWallLayout } from "./wall-layout";
import { computeStarLayout, starYears } from "./star-layout";
import { WallView } from "./WallView";
import { StarView } from "./StarView";
import { Axis } from "./Axis";
import { FilterDropdown, Filter } from "./FilterDropdown";
import { ArtistCard } from "./ArtistCard";
import { SourceLink } from "./SourceLink";
import { FEATURED_ARTIST_SLUGS } from "./featured-artists";

export type ViewName = "wall" | "stars";

const VIEWS: { id: ViewName; label: string }[] = [
  { id: "wall", label: "Gallery Wall" },
  { id: "stars", label: "Star Map" },
];

/** the "more below" pill's strip, kept free above the footer while the wall overflows */
const PILL_H = 26;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ header

const TimelineHeader = memo(function TimelineHeader({
  view,
  onView,
  periods,
  artists,
  filter,
  onFilter,
  inert,
  showAll,
  onCollection,
}: {
  view: ViewName;
  onView: (v: ViewName) => void;
  periods: Period[];
  artists: Artist[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  inert: boolean;
  showAll: boolean;
  onCollection: (all: boolean) => void;
}) {
  return (
    <header className="tl-header" inert={inert}>
      <div className="tl-title">
        A Walkable History of Art
        <small>Every artist, every work, under one roof.</small>
      </div>
      <div className="tl-modes">
        <nav className="tl-switcher" aria-label="Timeline view">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`tl-switch${view === v.id ? " active" : ""}`}
            aria-pressed={view === v.id}
            onClick={() => onView(v.id)}
          >
            {v.label}
          </button>
        ))}
        </nav>
        <nav className="tl-collection" aria-label="Artist selection">
          <button type="button" aria-pressed={!showAll} title="A curated introduction to influential painters across the collection" onClick={() => onCollection(false)}>Featured</button>
          <button type="button" aria-pressed={showAll} onClick={() => onCollection(true)}>All artists</button>
          <Link href="/rooms" className="tl-room-link" title="Hang your own room: an era, a movement, a genre, a country, artists">
            Make a room
          </Link>
          <Link href="/rooms#museums" className="tl-room-link" title="Walk real museums, recreated: the Louvre, the Rijksmuseum, the National Gallery of Greece">
            Museums
          </Link>
        </nav>
      </div>
      <FilterDropdown periods={periods} artists={artists} filter={filter} onChange={onFilter} hidden={inert} showAll={showAll} onCollection={onCollection} />
    </header>
  );
});

// ---------------------------------------------------------------- timeline

export function Timeline({ data }: { data: TimelineData }) {
  const periods = useMemo(
    () => [...data.periods].sort((a, b) => a.startYear - b.startYear || a.endYear - b.endYear),
    [data.periods]
  );
  // already in display form: data.ts decodes entities and drops disambiguators
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    try { setShowAll(localStorage.getItem("timeline-museum:artist-selection") === "all"); } catch {}
  }, []);
  const artists = useMemo(() => showAll ? data.artists : data.artists.filter((a) => FEATURED_ARTIST_SLUGS.has(a.slug)), [data.artists, showAll]);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewName>("wall");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [headerH, setHeaderH] = useState(0);
  /** height of the footer row (hint, note, source link) from the bottom of the screen */
  const [footH, setFootH] = useState(0);
  const wRef = useRef(0);
  const hRef = useRef(0);
  const tRef = useRef<Transform>({ k: 1, x: 0, y: 0 });
  const [t, setT] = useState<Transform>(tRef.current);
  const overflowRef = useRef(0);
  const rafRef = useRef(0);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const [filter, setFilter] = useState<Filter>(null);
  /** the period last dived into (gets the wall text and full-size rows) */
  const [focusP, setFocusP] = useState<string | null>(null);
  const [selected, setSelected] = useState<Artist | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [, setFontsTick] = useState(0);

  // ---- data prepared once
  const meta = useMemo(() => buildArtistMeta(artists), [artists]);
  const styles = useMemo(() => buildPeriodStyles(periods), [periods]);
  const byPeriod = useMemo(() => {
    const m = new Map<string, Artist[]>();
    for (const p of periods) m.set(p.slug, []);
    for (const a of artists) m.get(a.periodSlug)?.push(a);
    for (const l of m.values())
      l.sort((a, b) => (a.birthYear ?? 9999) - (b.birthYear ?? 9999) || a.name.localeCompare(b.name));
    return m;
  }, [periods, artists]);
  // lanes are packed by how many artists each period hangs (a lane is as tall as its biggest)
  const lanesInfo = useMemo(
    () => assignLanes(periods, new Map([...byPeriod].map(([s, l]) => [s, l.length]))),
    [periods, byPeriod]
  );

  // ---- transform: the ref is the source of truth, React commits once per frame
  const commit = useCallback(() => {
    rafRef.current = 0;
    flushSync(() => setT(tRef.current));
  }, []);

  const apply = useCallback(
    (next: Transform, immediate = false) => {
      tRef.current = clampTransform(next, wRef.current || 1, overflowRef.current);
      if (immediate) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        commit();
        return;
      }
      if (!rafRef.current) rafRef.current = requestAnimationFrame(commit);
    },
    [commit]
  );

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // ---- size: measured before first paint, rescaled + re-clamped on resize
  // (the header and footer too: they wrap on narrow screens, and the content
  // sits between them)
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const header = el.querySelector<HTMLElement>(".tl-header");
    const footer = el.querySelector<HTMLElement>(".tl-foot");
    const measure = () => {
      if (header) setHeaderH(header.offsetHeight);
      if (footer) setFootH(Math.ceil(el.clientHeight - footer.offsetTop));
      const nw = el.clientWidth;
      const nh = el.clientHeight;
      const ow = wRef.current;
      if (nw === ow && nh === hRef.current) return;
      wRef.current = nw;
      hRef.current = nh;
      const c = tRef.current;
      tRef.current = clampTransform(
        { ...c, x: ow ? (c.x * nw) / ow : c.x },
        nw,
        overflowRef.current
      );
      setSize({ w: nw, h: nh });
      setT(tRef.current);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (header) ro.observe(header);
    if (footer) ro.observe(footer);
    return () => ro.disconnect();
  }, []);

  useEffect(() => whenFontsReady(() => setFontsTick((n) => n + 1)), []);

  // ---- animated moves (log-zoom + linear centre so fly-tos feel like travel)
  // `overflowY`: how far the target may scroll down when it is known to differ
  // from the current view's (the wall's height depends on what is on screen)
  const flyTo = useCallback(
    (target: Transform, duration = 1.15, onDone?: () => void, overflowY?: number) => {
      tweenRef.current?.kill();
      const w = wRef.current || 1;
      if (reducedMotion() || duration <= 0) {
        if (overflowY !== undefined) overflowRef.current = Math.max(overflowRef.current, overflowY);
        apply(target, true);
        onDone?.();
        return;
      }
      const from = { ...tRef.current };
      const c0 = yearAt(w / 2, w, from);
      const to = clampTransform(target, w, overflowY ?? overflowRef.current);
      const c1 = yearAt(w / 2, w, to);
      const lk0 = Math.log(from.k);
      const lk1 = Math.log(to.k);
      const proxy = { u: 0 };
      tweenRef.current = gsap.to(proxy, {
        u: 1,
        duration,
        ease: "power3.inOut",
        onUpdate: () => {
          const k = Math.exp(lerp(lk0, lk1, proxy.u));
          const c = lerp(c0, c1, proxy.u);
          apply(
            { k, x: w / 2 - ((c - YEAR_MIN) / YEAR_SPAN) * w * k, y: lerp(from.y, to.y, proxy.u) },
            true
          );
        },
        onComplete: onDone,
      });
    },
    [apply]
  );

  const zoomToYears = useCallback(
    (a: number, b: number, onDone?: () => void) =>
      flyTo(frameYears(a, b, wRef.current || 1), 1.15, onDone),
    [flyTo]
  );

  const zoomAbout = useCallback(
    (cx: number, factor: number) => {
      const c = tRef.current;
      const k = clamp(c.k * factor, K_MIN, K_MAX);
      flyTo({ k, x: cx - ((cx - c.x) * k) / c.k, y: c.y }, 0.35);
    },
    [flyTo]
  );

  // ---- wheel: native non-passive listener so ctrl/pinch zoom only the timeline
  const hasData = periods.length > 0;
  /** pointers down on the canvas (see "pointers" below) */
  const pts = useRef(new Map<number, { x: number; y: number }>());
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    // desktop Safari reports a trackpad pinch as WebKit GestureEvents, not ctrl+wheel
    let g0: { k: number; x: number; cx: number } | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (g0 && e.ctrlKey) return;
      tweenRef.current?.kill();
      const u = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      let dx = e.deltaX * u;
      let dy = e.deltaY * u;
      if (e.shiftKey && !e.ctrlKey && Math.abs(dx) < Math.abs(dy)) {
        dx = dy;
        dy = 0;
      }
      const cur = tRef.current;
      if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) {
        apply({ ...cur, x: cur.x - dx });
        return;
      }
      const k = clamp(cur.k * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)), K_MIN, K_MAX);
      const mx = e.clientX;
      apply({ k, x: mx - ((mx - cur.x) * k) / cur.k, y: cur.y });
    };
    type Gesture = Event & { scale: number; clientX: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      tweenRef.current?.kill();
      const cx = (e as Gesture).clientX;
      const c = tRef.current;
      g0 = { k: c.k, x: c.x, cx: Number.isFinite(cx) ? cx : wRef.current / 2 };
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      // iOS fires these for a touch pinch too, which the pointer path already handles
      if (!g0 || pts.current.size) return;
      const k = clamp(g0.k * (e as Gesture).scale, K_MIN, K_MAX);
      apply({ k, x: g0.cx - ((g0.cx - g0.x) * k) / g0.k, y: tRef.current.y });
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      g0 = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("gestureend", onGestureEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  }, [apply, hasData]);

  // ---- pointers: drag-to-pan with a slop, pinch-zoom, never a click after a drag
  const pinch = useRef<{ d: number; mx: number; my: number; t: Transform } | null>(null);
  const downAt = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const suppressClick = useRef(false);
  const lastPointer = useRef(0);

  const measurePinch = () => {
    const [a, b] = [...pts.current.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    lastPointer.current = performance.now();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    tweenRef.current?.kill();
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 1) {
      downAt.current = { x: e.clientX, y: e.clientY };
      moved.current = false;
    } else if (pts.current.size === 2) {
      pinch.current = { ...measurePinch(), t: { ...tRef.current } };
      moved.current = true;
      try {
        for (const id of pts.current.keys()) canvasRef.current?.setPointerCapture(id);
      } catch {}
    }
  }, []);

  const onPointerEnd = useCallback((e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = null;
    if (!pts.current.size) {
      canvasRef.current?.classList.remove("dragging");
      if (moved.current) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
      }
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = pts.current.get(e.pointerId);
      if (!p) return;
      // the release was missed (it landed outside the canvas before capture,
      // or the window lost it): a hover must never pan
      if (e.pointerType !== "touch" && e.buttons === 0) {
        onPointerEnd(e);
        return;
      }
      const px = p.x;
      const py = p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (!moved.current) {
        const slop = e.pointerType === "touch" ? 8 : 4;
        if (Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) <= slop) return;
        moved.current = true;
        try {
          canvasRef.current?.setPointerCapture(e.pointerId);
        } catch {}
        canvasRef.current?.classList.add("dragging");
      }
      const c = tRef.current;
      const g0 = pinch.current;
      if (pts.current.size === 1 || !g0) {
        apply({ ...c, x: c.x + p.x - px, y: c.y + p.y - py });
        return;
      }
      const g = measurePinch();
      const k = clamp((g0.t.k * g.d) / g0.d, K_MIN, K_MAX);
      apply({
        k,
        x: g.mx - ((g0.mx - g0.t.x) * k) / g0.t.k,
        y: g0.t.y + (g.my - g0.my),
      });
    },
    [apply, onPointerEnd]
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick.current = false;
    }
  }, []);

  // ---- keyboard: arrows pan, +/- zoom, 0/Home overview; focus pans into view
  // the content (and the axis above it) starts below the header, however it wraps
  const contentTop = Math.max(size && size.w <= 720 ? 158 : 122, headerH + 44);
  // ...and ends above the footer row (hint, note, source link), which no row may sit under
  const footReserve = footH ? footH + 6 : 52;

  /**
   * The Gallery Wall at transform `tt` (pure and cheap: used to aim fly-tos at
   * a row). A wall taller than the screen also keeps the "more below" pill's
   * strip, above the footer, free (no row ever sits under the pill). Rows are
   * already at their tightest when the wall overflows, so the lanes don't move.
   */
  const wallAt = useCallback(
    (tt: Transform, w = wRef.current, h = hRef.current, focus = focusP) => {
      const inp = {
        periods,
        byPeriod,
        meta,
        lanes: lanesInfo.lanes,
        laneCount: lanesInfo.laneCount,
        w,
        h,
        t: tt,
        top: contentTop,
        bottom: h - footReserve,
        focus,
      };
      const L = computeWallLayout(inp);
      return L.overflow > 0.5 ? computeWallLayout({ ...inp, bottom: inp.bottom - PILL_H }) : L;
    },
    [periods, byPeriod, meta, lanesInfo, contentTop, footReserve, focusP]
  );

  /**
   * Keep `target`'s zoom and x, and pan vertically so that `slug`'s Gallery
   * Wall row is on screen there; also returns how far the wall can scroll there.
   */
  const aimAtRow = useCallback(
    (target: Transform, slug: string) => {
      const h = hRef.current;
      const tt = clampTransform(target, wRef.current || 1, Infinity);
      const L = wallAt(tt);
      const r = L.rows.find((q) => q.a.slug === slug);
      let y = tt.y;
      const lo = contentTop + 10;
      const hi = h - footReserve - 8;
      if (r && r.y < lo) y += lo - r.y;
      else if (r && r.y + r.R > hi) y -= r.y + r.R - hi;
      return { target: { ...tt, y: clamp(y, -L.overflow, 0) }, overflow: L.overflow };
    },
    [wallAt, contentTop, footReserve]
  );

  /**
   * Dive into a period: frame its years and, on the Gallery Wall, bring its
   * band up from a lower lane when it would otherwise open below the fold.
   */
  const diveInto = useCallback(
    (p: Period) => {
      const w = wRef.current || 1;
      let [y0, y1] = diveYears(p);
      // A tradition spanning centuries would otherwise reopen the overview.
      // Start near the years already in view, with enough room for artist names.
      if (p.endYear - p.startYear > 400) {
        const span = Math.min(y1 - y0, w / 6);
        const centre = clamp(yearAt(w / 2, w, tRef.current), p.startYear + span / 2, p.endYear - span / 2);
        y0 = centre - span / 2;
        y1 = centre + span / 2;
      }
      setFocusP(p.slug);
      if (view !== "wall") {
        zoomToYears(y0, y1);
        return;
      }
      const h = hRef.current;
      const target = clampTransform(frameYears(y0, y1, w), w, 0);
      const L = wallAt(target, w, h, p.slug);
      const b = L.bands.find((q) => q.p.slug === p.slug);
      let y = 0;
      // the band's title sits ~30px above it; the footer row below is out of bounds
      const lo = contentTop + 34;
      const hi = h - footReserve - (L.overflow > 0.5 ? PILL_H : 0) - 6;
      if (b && (b.top < lo || b.top + b.height > hi)) {
        // a band that has to move comes to the middle of the free space (its
        // top under the ruler when it is taller than that), not to an edge
        const room = hi - lo;
        y = (b.height <= room ? lo + (room - b.height) / 2 : lo) - b.top;
      }
      flyTo({ ...target, y: clamp(y, -L.overflow, 0) }, 1.15, undefined, L.overflow);
    },
    [view, zoomToYears, wallAt, flyTo, contentTop, footReserve]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const c = tRef.current;
      const w = wRef.current;
      switch (e.key) {
        case "ArrowLeft":
          flyTo({ ...c, x: c.x + w * 0.2 }, 0.3);
          break;
        case "ArrowRight":
          flyTo({ ...c, x: c.x - w * 0.2 }, 0.3);
          break;
        case "ArrowUp":
          flyTo({ ...c, y: c.y + 90 }, 0.25);
          break;
        case "ArrowDown":
          flyTo({ ...c, y: c.y - 90 }, 0.25);
          break;
        case "+":
        case "=":
          zoomAbout(w / 2, 1.4);
          break;
        case "-":
        case "_":
          zoomAbout(w / 2, 1 / 1.4);
          break;
        case "0":
        case "Home":
          flyTo({ k: 1, x: 0, y: 0 });
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    [flyTo, zoomAbout]
  );

  const revealEl = useCallback(
    (el: HTMLElement) => {
      const w = wRef.current;
      const h = hRef.current;
      const r = el.getBoundingClientRect();
      const c = tRef.current;
      let { x, y } = c;
      if (r.left < 12) x += 40 - r.left;
      else if (r.right > w - 12) x -= Math.min(r.left - 40, r.right - (w - 40));
      if (r.top < contentTop) y += contentTop + 20 - r.top;
      else if (r.bottom > h - footReserve) y -= r.bottom - (h - footReserve - 10);
      if (x !== c.x || y !== c.y) flyTo({ ...c, x, y }, 0.45);
    },
    [flyTo, contentTop, footReserve]
  );

  const onFocusIn = useCallback(
    (e: React.FocusEvent) => {
      if (performance.now() - lastPointer.current < 600) return;
      const el = e.target as HTMLElement;
      if (el === canvasRef.current) return;
      // stars and titles carry .offscreen themselves, wall rows on their wrapper
      if (!el.closest(".offscreen")) {
        revealEl(el);
        return;
      }
      const w = wRef.current;
      const c = tRef.current;
      const slug = el.dataset.slug;
      const ps = el.dataset.period;
      const xFor = (year: number, at: number) => w * at - ((year - YEAR_MIN) / YEAR_SPAN) * w * c.k;
      let target: Transform | null = null;
      let overflowY: number | undefined;
      if (slug && view === "wall") {
        // a row hidden sideways brings its line start to 0.3w; one only
        // scrolled out of the wall keeps x. Either way the row comes up into view.
        const r = wallAt(c).rows.find((q) => q.a.slug === slug);
        const m = meta.get(slug);
        let x = c.x;
        if (r) {
          if (r.le < 40 || r.ls > w - 120) x += w * 0.3 - r.ls;
        } else if (m) x = xFor(m.life.start, 0.3);
        const aim = aimAtRow({ ...c, x }, slug);
        target = aim.target;
        overflowY = aim.overflow;
      } else if (slug) {
        // a star sits at the middle of the artist's working years (inside its period's slot)
        const m = meta.get(slug);
        const sy = starYears(periods, byPeriod, meta, lanesInfo.lanes, lanesInfo.laneCount);
        if (m) target = { ...c, x: xFor(sy.year.get(slug) ?? m.active.mid, 0.5) };
      } else if (ps) {
        const p = periods.find((q) => q.slug === ps);
        if (p) target = { ...c, x: xFor((p.startYear + p.endYear) / 2, 0.5) };
      }
      if (!target) return;
      flyTo(
        target,
        0.5,
        () => {
          const again = canvasRef.current?.querySelector<HTMLElement>(
            slug ? `[data-slug="${slug}"]` : `[data-period="${ps}"]`
          );
          if (again && !again.closest(".offscreen")) revealEl(again);
        },
        overflowY
      );
    },
    [flyTo, meta, periods, byPeriod, revealEl, view, wallAt, aimAtRow, lanesInfo]
  );

  // ---- filter: dim the rest, fly to the selection
  const onFilter = useCallback(
    (f: Filter) => {
      setFilter(f);
      if (!f) {
        flyTo({ k: 1, x: 0, y: 0 });
        return;
      }
      if (f.type === "period") {
        const p = periods.find((x) => x.slug === f.slug);
        if (p) diveInto(p);
      } else {
        const m = meta.get(f.slug);
        if (m) {
          let target = frameYears(m.life.start - 14, m.life.end + 14, wRef.current || 1);
          let overflowY: number | undefined;
          // on a short screen the artist's row may sit below the fold of the wall
          if (view === "wall") ({ target, overflow: overflowY } = aimAtRow(target, f.slug));
          flyTo(
            target,
            1.15,
            () => {
              canvasRef.current
                ?.querySelector<HTMLElement>(`.artist-node[data-slug="${f.slug}"]`)
                ?.focus({ preventScroll: true });
            },
            overflowY
          );
        }
      }
    },
    [periods, meta, diveInto, flyTo, view, aimAtRow]
  );

  const ownerPeriod =
    filter?.type === "artist" ? meta.get(filter.slug)?.a.periodSlug : undefined;
  const dimPeriod = useCallback(
    (slug: string) =>
      !filter ? false : filter.type === "period" ? slug !== filter.slug : slug !== ownerPeriod,
    [filter, ownerPeriod]
  );
  const dimArtist = useCallback(
    (a: Artist) =>
      !filter ? false : filter.type === "period" ? a.periodSlug !== filter.slug : a.slug !== filter.slug,
    [filter]
  );

  const onArtist = useCallback((a: Artist, el: HTMLElement) => {
    openerRef.current = el;
    setSelected(a);
  }, []);

  const onCollection = useCallback((all: boolean) => {
    if (all === showAll) return;
    setShowAll(all);
    setFilter(null);
    setFocusP(null);
    try { localStorage.setItem("timeline-museum:artist-selection", all ? "all" : "featured"); } catch {}
    flyTo({ k: 1, x: 0, y: 0 }, 0);
  }, [showAll, flyTo]);

  const closeCard = useCallback(() => {
    setSelected(null);
    const el = openerRef.current;
    requestAnimationFrame(() => {
      const slug = el?.dataset.slug;
      const again =
        (el?.isConnected ? el : null) ??
        (slug ? canvasRef.current?.querySelector<HTMLElement>(`[data-slug="${slug}"]`) : null) ??
        canvasRef.current;
      again?.focus({ preventScroll: true });
    });
  }, []);

  // ---- layout for this frame
  const w = size?.w ?? 0;
  const h = size?.h ?? 0;
  const bottom = h - footReserve;
  const ticks = size ? axisTicks(w, t) : null;
  const wall = size && view === "wall" ? wallAt(t, w, h) : null;
  const stars =
    size && view === "stars"
      ? computeStarLayout({
          periods,
          byPeriod,
          meta,
          lanes: lanesInfo.lanes,
          laneCount: lanesInfo.laneCount,
          w,
          h,
          t,
          top: contentTop,
          bottom: bottom - 14,
          focus: focusP,
        })
      : null;

  // the wall may be taller than the screen: allow (and keep within) vertical pan
  const overflow = wall?.overflow ?? 0;
  useLayoutEffect(() => {
    overflowRef.current = overflow;
    const c = tRef.current;
    const cl = clampTransform(c, wRef.current || 1, overflow);
    if (cl.y !== c.y) apply(cl);
  }, [overflow, apply]);

  if (!periods.length) {
    return (
      <div className="empty-state">
        <h1>The collection is still being hung</h1>
        <p>
          Run <code>npm run ingest</code> to pull the collection from Wikipedia, then reload.
        </p>
      </div>
    );
  }

  const common = size
    ? {
        periods,
        meta,
        styles,
        w,
        h,
        top: contentTop,
        t,
        ticks: ticks!,
        dimPeriod,
        dimArtist,
        onArtist,
        onPeriod: diveInto,
      }
    : null;

  return (
    <div
      ref={rootRef}
      className={`tl-root view-${view}`}
      style={{
        ["--top" as string]: `${contentTop}px`,
        ["--foot" as string]: `${footReserve}px`,
        ["--pill" as string]: `${overflow > 0.5 ? PILL_H : 0}px`,
      }}
    >
      <div
        ref={canvasRef}
        className="tl-canvas"
        tabIndex={0}
        role="region"
        aria-roledescription="interactive timeline"
        aria-label={`Timeline of art history, ${YEAR_MIN} to ${YEAR_MAX}`}
        aria-describedby="tl-hint"
        inert={!!selected}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={(e) => {
          if (e.target === e.currentTarget) onPointerEnd(e);
        }}
        onClickCapture={onClickCapture}
        onKeyDown={onKeyDown}
        onFocus={onFocusIn}
      >
        {common && wall && <WallView {...common} layout={wall} />}
        {common && stars && <StarView {...common} layout={stars} />}
        {size && ticks && <Axis ticks={ticks} w={w} t={t} top={contentTop - 44} />}
        {size && overflow > 0.5 && (
          <div
            className="tl-scrollhint"
            aria-hidden
            style={{
              opacity: t.y > -overflow + 4 ? 1 : 0,
            }}
          >
            more below · drag up
          </div>
        )}
      </div>

      <TimelineHeader
        view={view}
        onView={setView}
        periods={periods}
        artists={artists}
        filter={filter}
        onFilter={onFilter}
        inert={!!selected}
        showAll={showAll}
        onCollection={onCollection}
      />

      {/* the footer row: provenance (left), hint (centre), Wikipedia donation,
          credits and source link (right); the hint above the two notes on
          mid-size screens, one centred column on narrow ones. Its measured
          height is kept free of content (--foot). */}
      <footer className="tl-foot" inert={!!selected}>
        <p className="tl-note tl-note-l">
          <span className="tl-note-src">
            All credit goes to{" "}
            <a href="https://en.wikipedia.org/" target="_blank" rel="noopener noreferrer">
              Wikipedia
            </a>{" "}
            and{" "}
            <a href="https://www.wikiart.org/" target="_blank" rel="noopener noreferrer">
              WikiArt
            </a>{" "}
            · for educational use only.
          </span>{" "}
          <span className="tl-note-give">
            Free knowledge keeps democracies strong.{" "}
            <a href="https://donate.wikimedia.org/" target="_blank" rel="noopener noreferrer">
              Donate to Wikipedia
            </a>
            .
          </span>
        </p>
        <div className="tl-hint" id="tl-hint">
          <span className="hint-fine">
            Scroll or pinch to travel through time · drag to pan · click a period to dive in · Tab
            to browse
          </span>
          <span className="hint-touch">Pinch to travel through time · drag to pan · tap a period</span>
        </div>
        <div className="tl-note tl-note-r">
          <span className="tl-note-by">
            <span>
              Made with <span className="tl-heart" role="img" aria-label="love">♥</span> by{" "}
              <a href="https://justdataplease.com" target="_blank" rel="noopener noreferrer">
                justdataplease.com
              </a>
            </span>
            <SourceLink className="tl-source" />
          </span>
        </div>
      </footer>

      {selected && (
        <ArtistCard
          artist={selected}
          period={periods.find((p) => p.slug === selected.periodSlug)}
          onClose={closeCard}
        />
      )}
    </div>
  );
}
