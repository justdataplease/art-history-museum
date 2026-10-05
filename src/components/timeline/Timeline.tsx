"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { Artist, Period, TimelineData } from "@/lib/types";
import {
  clampTransform,
  ticksFor,
  Transform,
  xOf,
  yearAt,
  activeRange,
  assignLanes,
} from "./timeline-math";
import { GalleryWallView, RiverView, StarMapView } from "./views";
import { FilterDropdown, Filter } from "./FilterDropdown";
import { ArtistCard } from "./ArtistCard";

export type ViewName = "wall" | "stars" | "river";

const VIEWS: { id: ViewName; label: string }[] = [
  { id: "wall", label: "Gallery Wall" },
  { id: "stars", label: "Star Map" },
  { id: "river", label: "The River" },
];

export function Timeline({ data }: { data: TimelineData }) {
  const { periods, artists } = data;
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewName>("wall");
  const [size, setSize] = useState({ w: 1400, h: 800 });
  const [t, setT] = useState<Transform>({ k: 1, x: 0, y: 0 });
  const tRef = useRef(t);
  tRef.current = t;
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState<Filter>(null);
  const [selected, setSelected] = useState<Artist | null>(null);
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight })
    );
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const apply = useCallback(
    (next: Transform) => setT(clampTransform(next, rootRef.current?.clientWidth ?? size.w)),
    [size.w]
  );

  // Smooth GSAP fly-to for filters / period clicks.
  const zoomToYears = useCallback(
    (startYear: number, endYear: number) => {
      const w = rootRef.current?.clientWidth ?? size.w;
      const span = endYear - startYear;
      const k = Math.min(70, Math.max(1, (2035 - 1170) / span / 1.18));
      const proxy = { ...tRef.current };
      const targetX =
        w / 2 - (((startYear + endYear) / 2 - 1170) / (2035 - 1170)) * w * k;
      tweenRef.current?.kill();
      tweenRef.current = gsap.to(proxy, {
        k,
        x: targetX,
        y: 0,
        duration: 1.25,
        ease: "power3.inOut",
        onUpdate: () => apply({ k: proxy.k, x: proxy.x, y: proxy.y }),
      });
    },
    [apply, size.w]
  );

  // ---- wheel zoom / drag pan ----
  const drag = useRef<{ px: number; py: number; active: boolean }>({
    px: 0,
    py: 0,
    active: false,
  });

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      tweenRef.current?.kill();
      const cur = tRef.current;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const k = Math.min(80, Math.max(1, cur.k * factor));
      const mx = e.clientX;
      const x = mx - ((mx - cur.x) * k) / cur.k;
      apply({ k, x, y: cur.y * (k / cur.k) });
    },
    [apply]
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    tweenRef.current?.kill();
    drag.current = { px: e.clientX, py: e.clientY, active: true };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current.active) return;
      const dx = e.clientX - drag.current.px;
      const dy = e.clientY - drag.current.py;
      drag.current.px = e.clientX;
      drag.current.py = e.clientY;
      const cur = tRef.current;
      apply({ k: cur.k, x: cur.x + dx, y: cur.y + dy });
    },
    [apply]
  );

  const onPointerUp = useCallback(() => {
    drag.current.active = false;
    setDragging(false);
  }, []);

  // ---- filter behaviour: dim non-matching, fly to the selection ----
  const onFilter = useCallback(
    (f: Filter) => {
      setFilter(f);
      if (!f) {
        zoomToYears(1170, 2035);
        return;
      }
      if (f.type === "period") {
        const p = periods.find((x) => x.slug === f.slug);
        if (p) zoomToYears(p.startYear - 12, p.endYear + 12);
      } else {
        const a = artists.find((x) => x.slug === f.slug);
        if (a) {
          const r = activeRange(a);
          zoomToYears(r.start - 26, r.end + 26);
        }
      }
    },
    [periods, artists, zoomToYears]
  );

  const lanesInfo = useMemo(() => assignLanes(periods), [periods]);
  const ticks = useMemo(() => ticksFor(size.w, t), [size.w, t]);

  const byPeriod = useMemo(() => {
    const m = new Map<string, Artist[]>();
    for (const p of periods) m.set(p.slug, []);
    for (const a of artists) m.get(a.periodSlug)?.push(a);
    return m;
  }, [periods, artists]);

  const isDimmed = useCallback(
    (kind: "period" | "artist", slug: string, periodSlug?: string): boolean => {
      if (!filter) return false;
      if (filter.type === "period") {
        return kind === "period"
          ? slug !== filter.slug
          : periodSlug !== filter.slug;
      }
      if (kind === "artist") return slug !== filter.slug;
      const owner = artists.find((a) => a.slug === filter.slug);
      return owner ? owner.periodSlug !== slug : false;
    },
    [filter, artists]
  );

  const viewProps = {
    periods,
    byPeriod,
    size,
    t,
    lanes: lanesInfo.lanes,
    laneCount: lanesInfo.laneCount,
    isDimmed,
    onArtist: setSelected,
    onPeriod: (p: Period) => zoomToYears(p.startYear - 12, p.endYear + 12),
  };

  if (!periods.length) {
    return (
      <div className="empty-state">
        <h1>The collection is still being hung</h1>
        <p>
          Run <code>npm run ingest</code> to pull the collection from Wikipedia,
          then reload.
        </p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`tl-root view-${view}`}>
      <div
        className={`tl-canvas${dragging ? " dragging" : ""}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {view === "wall" && <GalleryWallView {...viewProps} />}
        {view === "stars" && <StarMapView {...viewProps} />}
        {view === "river" && <RiverView {...viewProps} />}

        <div className="tl-axis">
          {ticks.map((year) => (
            <span
              key={year}
              className="tick"
              style={{ left: xOf(year, size.w, t) }}
            >
              {year}
            </span>
          ))}
        </div>
      </div>

      <header className="tl-header">
        <div className="tl-title">
          The Timeline Museum
          <small>A walkable history of art</small>
        </div>
        <nav className="tl-switcher">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`tl-switch${view === v.id ? " active" : ""}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <FilterDropdown
          periods={periods}
          artists={artists}
          filter={filter}
          onChange={onFilter}
        />
      </header>

      <div className="tl-hint">
        Scroll to travel through time · drag to pan · click a period to dive in
      </div>

      {selected && (
        <ArtistCard
          artist={selected}
          period={periods.find((p) => p.slug === selected.periodSlug)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
