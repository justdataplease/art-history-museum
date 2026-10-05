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
import type { Artist, Period, TimelineData } from "@/lib/types";
import {
  assignLanes,
  axisTicks,
  clamp,
  clampTransform,
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
import { buildArtistMeta, buildPeriodStyles, cleanArtist } from "./artist-meta";
import { whenFontsReady } from "./text-measure";
import { computeWallLayout } from "./wall-layout";
import { computeStarLayout } from "./star-layout";
import { WallView } from "./WallView";
import { StarView } from "./StarView";
import { Axis } from "./Axis";
import { FilterDropdown, Filter } from "./FilterDropdown";
import { ArtistCard } from "./ArtistCard";

export type ViewName = "wall" | "stars";

const VIEWS: { id: ViewName; label: string }[] = [
  { id: "wall", label: "Gallery Wall" },
  { id: "stars", label: "Star Map" },
];

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
}: {
  view: ViewName;
  onView: (v: ViewName) => void;
  periods: Period[];
  artists: Artist[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  inert: boolean;
}) {
  return (
    <header className="tl-header" inert={inert}>
      <div className="tl-title">
        The Timeline Museum
        <small>A walkable history of art</small>
      </div>
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
      <FilterDropdown periods={periods} artists={artists} filter={filter} onChange={onFilter} />
    </header>
  );
});

// ---------------------------------------------------------------- timeline

export function Timeline({ data }: { data: TimelineData }) {
  const periods = useMemo(
    () => [...data.periods].sort((a, b) => a.startYear - b.startYear || a.endYear - b.endYear),
    [data.periods]
  );
  const artists = useMemo(() => data.artists.map(cleanArtist), [data.artists]);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewName>("wall");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const wRef = useRef(0);
  const hRef = useRef(0);
  const tRef = useRef<Transform>({ k: 1, x: 0, y: 0 });
  const [t, setT] = useState<Transform>(tRef.current);
  const overflowRef = useRef(0);
  const rafRef = useRef(0);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const [filter, setFilter] = useState<Filter>(null);
  const [selected, setSelected] = useState<Artist | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [, setFontsTick] = useState(0);

  // ---- data prepared once
  const meta = useMemo(() => buildArtistMeta(artists), [artists]);
  const styles = useMemo(() => buildPeriodStyles(periods), [periods]);
  const lanesInfo = useMemo(() => assignLanes(periods), [periods]);
  const byPeriod = useMemo(() => {
    const m = new Map<string, Artist[]>();
    for (const p of periods) m.set(p.slug, []);
    for (const a of artists) m.get(a.periodSlug)?.push(a);
    for (const l of m.values())
      l.sort((a, b) => (a.birthYear ?? 9999) - (b.birthYear ?? 9999) || a.name.localeCompare(b.name));
    return m;
  }, [periods, artists]);

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
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
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
    return () => ro.disconnect();
  }, []);

  useEffect(() => whenFontsReady(() => setFontsTick((n) => n + 1)), []);

  // ---- animated moves (log-zoom + linear centre so fly-tos feel like travel)
  const flyTo = useCallback(
    (target: Transform, duration = 1.15, onDone?: () => void) => {
      tweenRef.current?.kill();
      const w = wRef.current || 1;
      if (reducedMotion() || duration <= 0) {
        apply(target, true);
        onDone?.();
        return;
      }
      const from = { ...tRef.current };
      const c0 = yearAt(w / 2, w, from);
      const to = clampTransform(target, w, overflowRef.current);
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

  const diveInto = useCallback(
    (p: Period) => {
      const pad = Math.max(4, (p.endYear - p.startYear) * 0.07);
      zoomToYears(p.startYear - pad, p.endYear + pad);
    },
    [zoomToYears]
  );

  // ---- wheel: native non-passive listener so ctrl/pinch zoom only the timeline
  const hasData = periods.length > 0;
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
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
    const block = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", block);
    el.addEventListener("gesturechange", block);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", block);
      el.removeEventListener("gesturechange", block);
    };
  }, [apply, hasData]);

  // ---- pointers: drag-to-pan with a slop, pinch-zoom, never a click after a drag
  const pts = useRef(new Map<number, { x: number; y: number }>());
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

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = pts.current.get(e.pointerId);
      if (!p) return;
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
    [apply]
  );

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

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick.current = false;
    }
  }, []);

  // ---- keyboard: arrows pan, +/- zoom, 0/Home overview; focus pans into view
  const contentTop = size && size.w <= 720 ? 158 : 122;

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
      else if (r.bottom > h - 50) y -= r.bottom - (h - 60);
      if (x !== c.x || y !== c.y) flyTo({ ...c, x, y }, 0.45);
    },
    [flyTo, contentTop]
  );

  const onFocusIn = useCallback(
    (e: React.FocusEvent) => {
      if (performance.now() - lastPointer.current < 600) return;
      const el = e.target as HTMLElement;
      if (el === canvasRef.current) return;
      if (!el.classList.contains("offscreen")) {
        revealEl(el);
        return;
      }
      const w = wRef.current;
      const c = tRef.current;
      const slug = el.dataset.slug;
      const ps = el.dataset.period;
      let year: number | null = null;
      if (slug) year = meta.get(slug)?.life.start ?? null;
      else if (ps) {
        const p = periods.find((q) => q.slug === ps);
        if (p) year = (p.startYear + p.endYear) / 2;
      }
      if (year === null) return;
      const k = c.k;
      const target = { k, x: w * (slug ? 0.3 : 0.5) - ((year - YEAR_MIN) / YEAR_SPAN) * w * k, y: c.y };
      flyTo(target, 0.5, () => {
        const again = canvasRef.current?.querySelector<HTMLElement>(
          slug ? `[data-slug="${slug}"]` : `[data-period="${ps}"]`
        );
        if (again && !again.classList.contains("offscreen")) revealEl(again);
      });
    },
    [flyTo, meta, periods, revealEl]
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
          zoomToYears(m.life.start - 14, m.life.end + 14, () => {
            canvasRef.current
              ?.querySelector<HTMLElement>(`.artist-node[data-slug="${f.slug}"]`)
              ?.focus({ preventScroll: true });
          });
        }
      }
    },
    [periods, meta, diveInto, flyTo, zoomToYears]
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
  const bottom = h - 46;
  const ticks = size ? axisTicks(w, t) : null;
  const wall =
    size && view === "wall"
      ? computeWallLayout({
          periods,
          byPeriod,
          meta,
          lanes: lanesInfo.lanes,
          laneCount: lanesInfo.laneCount,
          w,
          h,
          t,
          top: contentTop,
          bottom,
        })
      : null;
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
      style={{ ["--top" as string]: `${contentTop}px` }}
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
        {size && overflow > 4 && (
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
      />

      <div className="tl-hint" id="tl-hint">
        <span className="hint-fine">
          Scroll or pinch to travel through time · drag to pan · click a period to dive in · Tab
          to browse
        </span>
        <span className="hint-touch">Pinch to travel through time · drag to pan · tap a period</span>
      </div>

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
