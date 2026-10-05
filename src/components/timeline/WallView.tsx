"use client";

import { memo } from "react";
import type { Artist, Period } from "@/lib/types";
import type { ArtistMeta, PeriodStyle } from "./artist-meta";
import type { AxisTicks, Transform } from "./timeline-math";
import { xOf } from "./timeline-math";
import { textWidth } from "./text-measure";
import type { RowMode, WallLayout, WallRow } from "./wall-layout";

export interface ViewCommon {
  periods: Period[];
  meta: Map<string, ArtistMeta>;
  styles: Map<string, PeriodStyle>;
  w: number;
  h: number;
  top: number;
  t: Transform;
  ticks: AxisTicks;
  dimPeriod: (slug: string) => boolean;
  dimArtist: (a: Artist) => boolean;
  onArtist: (a: Artist, el: HTMLElement) => void;
  onPeriod: (p: Period) => void;
}

const OFF = "translate(-9999px,-9999px)";

/** Faint vertical rules at the axis' labelled years (centuries a touch stronger). */
export function GridLines({
  ticks,
  w,
  h,
  t,
  top,
  className,
}: {
  ticks: AxisTicks;
  w: number;
  h: number;
  t: Transform;
  top: number;
  className: string;
}) {
  let major = "";
  let century = "";
  for (const y of ticks.major) {
    const x = Math.round(xOf(y, w, t)) + 0.5;
    if (y % 100 === 0) century += `M${x} ${top}V${h}`;
    else major += `M${x} ${top}V${h}`;
  }
  return (
    <svg className={className} width={w} height={h} aria-hidden>
      <path className="g-major" d={major} />
      <path className="g-century" d={century} />
    </svg>
  );
}

// ------------------------------------------------------------------ rows

interface RowProps {
  meta: ArtistMeta;
  off: boolean;
  dimmed: boolean;
  c: string;
  x: number;
  y: number;
  width: number;
  R: number;
  lineTop: number;
  clip: string;
  in0: number;
  inW: number;
  nodeX: number;
  P: number;
  mode: RowMode;
  label: 0 | 1 | 2;
  dates: boolean;
  nameSize: number;
  dateSize: number;
  btnW: number;
  onArtist: (a: Artist, el: HTMLElement) => void;
}

function Portrait({ meta, P }: { meta: ArtistMeta; P: number }) {
  return (
    <span className="ring" style={{ width: P, height: P }}>
      {meta.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={meta.thumb}
          srcSet={meta.srcSet}
          width={P}
          height={P}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="initial" style={{ fontSize: P * 0.42 }}>
          {meta.initial}
        </span>
      )}
    </span>
  );
}

const ArtistRow = memo(function ArtistRow(r: RowProps) {
  const { meta } = r;
  const a = meta.a;
  const name = r.label === 2 ? a.name : r.label === 1 ? meta.short : "";
  const open = (e: React.MouseEvent<HTMLButtonElement>) => r.onArtist(a, e.currentTarget);
  if (r.off) {
    return (
      <div className="wall-row offscreen" style={{ transform: OFF }}>
        <button
          type="button"
          className="artist-node"
          data-slug={a.slug}
          aria-label={meta.aria}
          onClick={open}
        />
      </div>
    );
  }
  const dot = r.mode === "dot";
  const btnH = dot ? r.R - 2 : r.P + 4;
  const btnX = dot ? r.nodeX - 6 : r.nodeX - r.P / 2 - 2;
  const btnY = dot ? r.lineTop - btnH + 5 : r.lineTop - r.P / 2 - 2;
  const inlineYears = r.mode !== "full" && r.dates;
  return (
    <div
      className={`wall-row m-${r.mode}${r.dimmed ? " dimmed" : ""}`}
      style={{
        transform: `translate(${r.x}px,${r.y}px)`,
        width: r.width,
        height: r.R,
        ["--c" as string]: r.c,
      }}
    >
      <span className={`life${r.clip}`} style={{ top: r.lineTop }} />
      {r.inW > 1 && (
        <span className="life-in" style={{ top: r.lineTop, left: r.in0, width: r.inW }} />
      )}
      <button
        type="button"
        className={`artist-node${r.dimmed ? " dimmed" : ""}`}
        data-slug={a.slug}
        aria-label={meta.aria}
        title={r.label === 2 && r.dates ? undefined : meta.aria}
        onClick={open}
        style={{
          transform: `translate(${btnX}px,${btnY}px)`,
          width: r.btnW,
          height: btnH,
          ["--p" as string]: `${r.P}px`,
        }}
      >
        {dot ? (
          <span
            className="dot"
            style={{ width: r.P, height: r.P, left: 6 - r.P / 2, bottom: 5 - r.P / 2 }}
          />
        ) : (
          <Portrait meta={meta} P={r.P} />
        )}
        {name && (
          <span className="name" style={{ fontSize: r.nameSize }}>
            {name}
            {inlineYears && (
              <span className="years" style={{ fontSize: r.dateSize }}>
                {meta.years}
              </span>
            )}
          </span>
        )}
        {r.mode === "full" && r.dates && (
          <span className="years" style={{ fontSize: r.dateSize }}>
            {meta.years}
          </span>
        )}
      </button>
    </div>
  );
});

const OFF_ROW = {
  off: true,
  dimmed: false,
  c: "",
  x: 0,
  y: 0,
  width: 0,
  R: 0,
  lineTop: 0,
  clip: "",
  in0: 0,
  inW: 0,
  nodeX: 0,
  P: 0,
  mode: "dot" as RowMode,
  label: 0 as const,
  dates: false,
  nameSize: 0,
  dateSize: 0,
  btnW: 0,
};

function rowProps(
  r: WallRow,
  meta: ArtistMeta,
  c: string,
  dimmed: boolean,
  R: number,
  onArtist: RowProps["onArtist"]
): RowProps {
  if (!r.onScreen) return { ...OFF_ROW, meta, onArtist };
  const nameW =
    r.label === 2
      ? textWidth(meta.a.name, "serif", r.nameSize)
      : r.label === 1
        ? textWidth(meta.short, "serif", r.nameSize)
        : 0;
  const datesW = r.dates ? textWidth(meta.years, "sans", r.dateSize) : 0;
  const textW = r.mode === "full" ? Math.max(nameW, datesW) : nameW + (r.dates ? 8 + datesW : 0);
  const btnW =
    r.mode === "dot" ? 12 + (textW ? textW + 4 : 0) : r.P + 4 + (textW ? 10 + textW : 0);
  const x = Math.round(r.ls);
  return {
    meta,
    off: false,
    dimmed,
    c,
    x,
    y: Math.round(r.y),
    width: Math.max(2, Math.round(r.le - r.ls)),
    R: Math.round(R),
    lineTop: Math.round(r.lineY - r.y),
    clip: (r.clipL ? " cl" : "") + (r.clipR ? " cr" : ""),
    in0: Math.round(r.in0 - x),
    inW: Math.round(r.in1 - r.in0),
    nodeX: Math.round(r.nodeX - x),
    P: Math.round(r.P),
    mode: r.mode,
    label: r.label,
    dates: r.dates,
    nameSize: r.nameSize,
    dateSize: r.dateSize,
    btnW: Math.ceil(btnW),
    onArtist,
  };
}

// ------------------------------------------------------------------ view

export function WallView({
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
}: ViewCommon & { layout: WallLayout }) {
  const bandBy = new Map(layout.bands.map((b) => [b.p.slug, b]));
  const rowsBy = new Map<string, WallRow[]>();
  for (const r of layout.rows) {
    const l = rowsBy.get(r.p.slug);
    if (l) l.push(r);
    else rowsBy.set(r.p.slug, [r]);
  }

  return (
    <div className="tl-layer wall-layer">
      <GridLines ticks={ticks} w={w} h={h} t={t} top={top - 6} className="tl-grid" />
      {periods.map((p) => {
        const b = bandBy.get(p.slug)!;
        const st = styles.get(p.slug)!;
        const lab = layout.labels.get(p.slug);
        const dim = dimPeriod(p.slug);
        const bx0 = Math.max(b.dx0, -60);
        const bx1 = Math.min(b.dx1, w + 60);
        return (
          <div key={p.slug} className={`period-group${dim ? " dimmed" : ""}`}>
            {b.onScreen && (
              <div
                className="band"
                aria-hidden
                onClick={() => onPeriod(p)}
                style={{
                  transform: `translate(${Math.round(bx0)}px,${Math.round(b.top)}px)`,
                  width: Math.max(1, Math.round(bx1 - bx0)),
                  height: Math.round(b.height),
                  ["--c" as string]: st.c,
                  ["--tint" as string]: st.tint,
                  ["--tint2" as string]: st.tint2,
                  ["--edge" as string]: st.edge,
                  borderTopLeftRadius: b.dx0 < -60 ? 0 : undefined,
                  borderBottomLeftRadius: b.dx0 < -60 ? 0 : undefined,
                  borderTopRightRadius: b.dx1 > w + 60 ? 0 : undefined,
                  borderBottomRightRadius: b.dx1 > w + 60 ? 0 : undefined,
                }}
              />
            )}
            {b.onScreen && b.text && b.text.o > 0.02 && (
              <div
                className="wall-text"
                style={{
                  transform: `translate(${Math.round(b.text.x)}px,${Math.round(b.text.y)}px)`,
                  width: Math.round(b.text.w),
                  height: Math.round(b.text.h),
                  opacity: b.text.o,
                  ["--c" as string]: st.ink,
                }}
              >
                <p>{p.description}</p>
                {p.wikipediaUrl && (
                  <a href={p.wikipediaUrl} target="_blank" rel="noreferrer" tabIndex={b.text.o > 0.5 ? 0 : -1}>
                    {p.name} · Wikipedia ↗
                  </a>
                )}
              </div>
            )}
            <button
              type="button"
              className={`rail-label${lab ? (lab.callout ? " callout" : "") + (lab.ghost ? " ghost" : "") : " offscreen"}`}
              data-period={p.slug}
              aria-label={`${p.name}, ${p.startYear} to ${p.endYear}`}
              onClick={() => onPeriod(p)}
              style={
                lab
                  ? {
                      transform: `translate(${Math.round(lab.x)}px,${Math.round(lab.y)}px)`,
                      fontSize: lab.size,
                      color: st.ink,
                      ["--c" as string]: st.c,
                    }
                  : { transform: OFF }
              }
            >
              {lab?.ghost === -1 && <span className="yr">←</span>}
              <span className="nm">{p.name}</span>
              {lab?.years && (
                <span className="yr">
                  {p.startYear} – {p.endYear}
                </span>
              )}
              {lab?.ghost === 1 && <span className="yr">→</span>}
            </button>
            {(rowsBy.get(p.slug) ?? []).map((r) => {
              const m = meta.get(r.a.slug)!;
              return (
                <ArtistRow
                  key={r.a.slug}
                  {...rowProps(r, m, st.c, dim || dimArtist(r.a), layout.rowH, onArtist)}
                />
              );
            })}
          </div>
        );
      })}
      <svg className="wall-leaders" width={w} height={h} aria-hidden>
        {layout.leaders.map((l) => {
          const st = styles.get(l.slug)!;
          return (
            <g key={l.slug} className={dimPeriod(l.slug) ? "dimmed" : undefined}>
              <path
                d={`M${l.x1} ${l.y1}V${l.y2 + 3}L${l.x2} ${l.y2}`}
                stroke={st.line}
              />
              <circle cx={l.x1} cy={l.y1} r={2} fill={st.c} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
