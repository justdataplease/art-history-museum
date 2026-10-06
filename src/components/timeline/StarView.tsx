"use client";

import { memo, useLayoutEffect, useRef } from "react";
import type { Artist } from "@/lib/types";
import type { ArtistMeta } from "./artist-meta";
import { jitter, pxPerYear, Transform, yearAt } from "./timeline-math";
import type { StarLayout, StarNode } from "./star-layout";
import { GridLines, ViewCommon } from "./WallView";

const OFF = "translate(-9999px,-9999px)";

// ------------------------------------------------------------ starfield
// Three pre-rendered SVG tiles repeated as backgrounds. Each layer moves with
// one compositor-only transform (parallax + a gentle zoom), and the two
// brighter layers twinkle with a CSS opacity animation — nothing repaints.

const TILE_W = 1100;
const TILE_H = 900;

function tile(n: number, salt: number, rMin: number, rMax: number, oMin: number, oMax: number, glow: boolean) {
  const cols = ["#f3ead4", "#f3ead4", "#f3ead4", "#d6defc", "#ffe2b8"];
  let s = `<svg xmlns='http://www.w3.org/2000/svg' width='${TILE_W}' height='${TILE_H}'>`;
  for (let i = 0; i < n; i++) {
    const x = ((jitter(`x${i}`, salt) + 1) / 2) * TILE_W;
    const y = ((jitter(`y${i}`, salt) + 1) / 2) * TILE_H;
    const r = rMin + ((jitter(`r${i}`, salt) + 1) / 2) * (rMax - rMin);
    const o = oMin + ((jitter(`o${i}`, salt) + 1) / 2) * (oMax - oMin);
    const c = cols[Math.floor(((jitter(`c${i}`, salt) + 1) / 2) * cols.length) % cols.length];
    if (glow) s += `<circle cx='${x.toFixed(1)}' cy='${y.toFixed(1)}' r='${(r * 3.2).toFixed(1)}' fill='${c}' opacity='${(o * 0.12).toFixed(2)}'/>`;
    s += `<circle cx='${x.toFixed(1)}' cy='${y.toFixed(1)}' r='${r.toFixed(2)}' fill='${c}' opacity='${o.toFixed(2)}'/>`;
  }
  s += "</svg>";
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(s)}")`;
}

const LAYERS = [
  { img: tile(150, 11, 0.35, 0.8, 0.18, 0.55, false), par: 0.02, zoom: 0.04, cls: "" },
  { img: tile(46, 23, 0.6, 1.15, 0.45, 0.85, false), par: 0.045, zoom: 0.08, cls: " tw-a" },
  { img: tile(14, 37, 0.9, 1.5, 0.6, 0.95, true), par: 0.08, zoom: 0.13, cls: " tw-b" },
];

export function Starfield({ w, h, t }: { w: number; h: number; t: Transform }) {
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  // Parallax follows panning only: the travel of the centre year in screen px,
  // accumulated per commit. (The raw t.x jumps by thousands of px on one
  // cursor-anchored wheel notch at depth, which would whip the field sideways.)
  const pan = useRef<{ x: number; c: number } | null>(null);
  useLayoutEffect(() => {
    const c = yearAt(w / 2, w, t);
    const p = pan.current;
    if (!p) pan.current = { x: t.x, c };
    else {
      p.x += (p.c - c) * pxPerYear(w, t.k);
      p.c = c;
    }
    const px = pan.current!.x;
    LAYERS.forEach((L, i) => {
      const el = layers.current[i];
      if (!el) return;
      const s = 1 + L.zoom * Math.log(t.k);
      const tw = TILE_W * s;
      const off = (((-px * L.par) % tw) + tw) % tw;
      el.style.transform = `translate3d(${(-off).toFixed(1)}px,0,0) scale(${s.toFixed(4)})`;
    });
  }, [w, t]);
  return (
    <div className="starfield" aria-hidden>
      {LAYERS.map((L, i) => {
        const s = 1 + L.zoom * Math.log(t.k);
        const tw = TILE_W * s;
        return (
          <div
            key={i}
            ref={(el) => {
              layers.current[i] = el;
            }}
            className={`sf-layer${L.cls}`}
            style={{
              backgroundImage: L.img,
              backgroundSize: `${TILE_W}px ${TILE_H}px`,
              width: Math.ceil((w + tw) / s) + 2,
              height: Math.ceil(h / s) + 2,
            }}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- stars

interface StarProps {
  meta: ArtistMeta;
  off: boolean;
  dimmed: boolean;
  x: number;
  y: number;
  r: number;
  P: number;
  c: string;
  label: StarNode["label"];
  tw: string;
  onArtist: (a: Artist, el: HTMLElement) => void;
}

const Star = memo(function Star(s: StarProps) {
  const a = s.meta.a;
  const open = (e: React.MouseEvent<HTMLButtonElement>) => s.onArtist(a, e.currentTarget);
  if (s.off) {
    return (
      <button
        type="button"
        className="star artist-node offscreen"
        data-slug={a.slug}
        aria-label={s.meta.aria}
        onClick={open}
        style={{ transform: OFF }}
      />
    );
  }
  const hit = Math.max(22, s.P + 6);
  return (
    <button
      type="button"
      className={`star artist-node${s.dimmed ? " dimmed" : ""}${s.P ? " has-portrait" : ""}`}
      data-slug={a.slug}
      aria-label={s.meta.aria}
      onClick={open}
      style={{
        transform: `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px)`,
        ["--c" as string]: s.c,
      }}
    >
      <span className="hit" style={{ width: hit, height: hit }} />
      <span className="halo" style={{ width: s.r * 9, height: s.r * 9, animationDelay: s.tw }} />
      <span className="core" style={{ width: s.r * 2.2, height: s.r * 2.2 }} />
      {s.P > 0 && (
        <span className="ring" style={{ width: s.P, height: s.P }}>
          {s.meta.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.meta.thumb}
              srcSet={s.meta.srcSet}
              width={s.P}
              height={s.P}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="initial" style={{ fontSize: s.P * 0.42 }}>
              {s.meta.initial}
            </span>
          )}
        </span>
      )}
      {s.label && (
        <span
          className="star-label"
          style={{
            transform: `translate(${s.label.dx.toFixed(1)}px,${s.label.dy.toFixed(1)}px)`,
            width: Math.ceil(s.label.w),
          }}
        >
          <span className="name" style={{ fontSize: s.label.size }}>
            {s.label.name}
          </span>
          {s.label.dates && <span className="years">{s.meta.years}</span>}
        </span>
      )}
    </button>
  );
});

// ------------------------------------------------------------------ view

export function StarView({
  layout,
  periods,
  meta,
  styles,
  w,
  h,
  top,
  t,
  ticks,
  dimPeriod,
  dimArtist,
  onArtist,
  onPeriod,
}: ViewCommon & { layout: StarLayout }) {
  const nodesBy = new Map<string, StarNode[]>();
  for (const n of layout.nodes) {
    const l = nodesBy.get(n.p.slug);
    if (l) l.push(n);
    else nodesBy.set(n.p.slug, [n]);
  }
  const cap = layout.caption;

  return (
    <div className="tl-layer star-layer">
      <Starfield w={w} h={h} t={t} />
      {layout.nebulae.map((n) => {
        const st = styles.get(n.p.slug)!;
        const x0 = Math.max(n.cx - n.rx, -w);
        const x1 = Math.min(n.cx + n.rx, 2 * w);
        return (
          <div
            key={n.p.slug}
            className={`neb${dimPeriod(n.p.slug) ? " dimmed" : ""}`}
            aria-hidden
            style={{
              transform: `translate(${Math.round(x0)}px,${Math.round(n.cy - n.ry)}px)`,
              width: Math.max(1, Math.round(x1 - x0)),
              height: Math.round(n.ry * 2),
              ["--c" as string]: st.c,
            }}
          />
        );
      })}
      <GridLines ticks={ticks} w={w} h={h} t={t} top={top - 6} className="tl-grid star-grid" />
      <svg className="constellations" width={w} height={h} aria-hidden>
        {layout.lines.map((l) => (
          <path key={l.slug} d={l.d} className={dimPeriod(l.slug) ? "dimmed" : undefined} />
        ))}
        {layout.leaders.map((l) => (
          <line
            key={`ld-${l.slug}`}
            className={`leader${dimPeriod(l.slug) ? " dimmed" : ""}`}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
          />
        ))}
      </svg>
      {periods.map((p) => {
        const st = styles.get(p.slug)!;
        const lab = layout.labels.get(p.slug);
        const dim = dimPeriod(p.slug);
        return (
          <div key={p.slug} className={`period-group${dim ? " dimmed" : ""}`}>
            <button
              type="button"
              className={`neb-label${lab ? "" : " offscreen"}`}
              data-period={p.slug}
              aria-label={`${p.name}, ${p.startYear} to ${p.endYear}`}
              onClick={() => onPeriod(p)}
              style={
                lab
                  ? {
                      transform: `translate(${Math.round(lab.x)}px,${Math.round(lab.y)}px)`,
                      width: Math.ceil(lab.w),
                      fontSize: lab.size,
                      ["--c" as string]: st.c,
                    }
                  : { transform: OFF }
              }
            >
              <span className="nm">{p.name}</span>
              {lab?.years && (
                <small>
                  {p.startYear} – {p.endYear}
                </small>
              )}
            </button>
            {(nodesBy.get(p.slug) ?? []).map((n) => {
              const m = meta.get(n.a.slug)!;
              return n.onScreen ? (
                <Star
                  key={n.a.slug}
                  meta={m}
                  off={false}
                  dimmed={dim || dimArtist(n.a)}
                  x={n.x}
                  y={n.y}
                  r={n.r}
                  P={n.P}
                  c={st.c}
                  label={n.label}
                  tw={`${(-((jitter(n.a.slug, 9) + 1) * 3.2)).toFixed(2)}s`}
                  onArtist={onArtist}
                />
              ) : (
                <Star
                  key={n.a.slug}
                  meta={m}
                  off
                  dimmed={false}
                  x={0}
                  y={0}
                  r={0}
                  P={0}
                  c=""
                  label={null}
                  tw=""
                  onArtist={onArtist}
                />
              );
            })}
          </div>
        );
      })}
      {cap && cap.o > 0.02 && (
        <aside
          className="star-caption"
          style={{
            transform: `translate(${cap.box.x0}px,${cap.box.y0}px)`,
            width: cap.box.x1 - cap.box.x0,
            height: cap.box.y1 - cap.box.y0,
            opacity: Math.pow(cap.o, 1.5),
            ["--c" as string]: styles.get(cap.p.slug)?.c,
          }}
        >
          <h3>
            {cap.p.name}
            <span>
              {cap.p.startYear} – {cap.p.endYear}
            </span>
          </h3>
          <p>{cap.p.description}</p>
          {cap.p.wikipediaUrl && (
            <a href={cap.p.wikipediaUrl} target="_blank" rel="noreferrer" tabIndex={cap.o > 0.5 ? 0 : -1}>
              Wikipedia ↗
            </a>
          )}
        </aside>
      )}
    </div>
  );
}
