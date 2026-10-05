"use client";

import { memo } from "react";
import type { Artist, Period } from "@/lib/types";
import { wikiThumb } from "@/lib/img";
import {
  activeRange,
  jitter,
  layoutArtists,
  Transform,
  xOf,
} from "./timeline-math";

export interface ViewProps {
  periods: Period[];
  byPeriod: Map<string, Artist[]>;
  size: { w: number; h: number };
  t: Transform;
  lanes: Map<string, number>;
  laneCount: number;
  isDimmed: (
    kind: "period" | "artist",
    slug: string,
    periodSlug?: string
  ) => boolean;
  onArtist: (a: Artist) => void;
  onPeriod: (p: Period) => void;
}

/** 0..1 — how revealed a period's artists are at this zoom level. */
function reveal(
  p: Period,
  size: { w: number },
  t: Transform,
  nArtists: number
): number {
  const px = xOf(p.endYear, size.w, t) - xOf(p.startYear, size.w, t);
  const threshold = 340 + nArtists * 60;
  return Math.min(1, Math.max(0, (px - threshold) / 260));
}

function ease(v: number): number {
  return v * v * (3 - 2 * v);
}

/** Keep a label on screen while its period band spans wider than the viewport. */
function clampLabelX(left: number, right: number, w: number): number {
  const mid = (left + right) / 2;
  return Math.min(Math.max(mid, Math.max(left + 70, 90)), Math.min(right - 70, w - 90));
}

// ---------------------------------------------------------------- ArtistNode

export const ArtistNode = memo(function ArtistNode({
  artist,
  x,
  y,
  px,
  visible,
  dimmed,
  onClick,
}: {
  artist: Artist;
  x: number;
  y: number;
  px: number;
  visible: number;
  dimmed: boolean;
  onClick: (a: Artist) => void;
}) {
  if (visible <= 0.02) return null;
  const years =
    artist.birthYear != null
      ? `${artist.birthYear} — ${artist.deathYear ?? ""}`
      : "";
  return (
    <div
      className={`artist-node${dimmed ? " dimmed" : ""}`}
      style={{
        left: x,
        top: y,
        opacity: dimmed ? undefined : visible,
        pointerEvents: visible > 0.45 && !dimmed ? "auto" : "none",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick(artist);
      }}
    >
      <span className="ring">
        {artist.portraitUrl ? (
          <img
            src={wikiThumb(artist.portraitUrl, 160, artist.portraitWidth)}
            width={px}
            height={px}
            alt={artist.name}
            draggable={false}
            loading="lazy"
          />
        ) : (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: px,
              height: px,
              borderRadius: "50%",
              background: "#d8cdb4",
              fontFamily: "var(--serif)",
              fontSize: px * 0.4,
              color: "#6b5d3e",
            }}
          >
            {artist.name[0]}
          </span>
        )}
      </span>
      <span className="name">{artist.name}</span>
      {years && <span className="years">{years}</span>}
    </div>
  );
});

// ------------------------------------------------------------- Gallery Wall

export function GalleryWallView({
  periods,
  byPeriod,
  size,
  t,
  lanes,
  laneCount,
  isDimmed,
  onArtist,
  onPeriod,
}: ViewProps) {
  const top = 150;
  const usable = size.h - top - 80;
  const baseH = Math.min(72, Math.max(52, usable / laneCount - 130));
  const gap = 16;

  return (
    <div className="tl-layer">
      {periods.map((p) => {
        const left = xOf(p.startYear, size.w, t);
        const right = xOf(p.endYear, size.w, t);
        if (right < -300 || left > size.w + 300) return null;
        const lane = lanes.get(p.slug) ?? 0;
        const artists = byPeriod.get(p.slug) ?? [];
        const vis = ease(reveal(p, size, t, artists.length));
        const bandH = baseH + vis * 168;
        const laneSlot = usable / laneCount;
        const bandTop =
          top + lane * laneSlot + (laneSlot - baseH) / 2 - vis * 60 + t.y;
        const dim = isDimmed("period", p.slug);
        const labelLeft = Math.max(18, -left + 18);
        const bandW = right - left;
        const placed = vis > 0.03 ? layoutArtists(artists, size.w, t, 120) : [];

        return (
          <div key={p.slug}>
            <div
              className={`band${dim ? " dimmed" : ""}`}
              style={{
                left,
                top: bandTop,
                width: bandW,
                height: bandH,
                borderColor: `${p.color}59`,
                background: `linear-gradient(180deg, ${p.color}21, ${p.color}0d)`,
                cursor: "pointer",
              }}
              onClick={() => onPeriod(p)}
            >
              {bandW > 76 && (
                <span
                  className="band-label"
                  style={{
                    color: p.color,
                    marginLeft: labelLeft,
                    fontSize: Math.min(15, Math.max(10, bandW / 16)),
                    letterSpacing: bandW < 170 ? "0.1em" : "0.24em",
                  }}
                >
                  {p.name}
                  {bandW > 290 && (
                    <span className="band-years">
                      {p.startYear} – {p.endYear}
                    </span>
                  )}
                </span>
              )}
            </div>
            {placed.map(({ artist, x, row }) => (
              <ArtistNode
                key={artist.slug}
                artist={artist}
                x={x}
                y={bandTop + 86 + row * 78}
                px={56}
                visible={vis}
                dimmed={isDimmed("artist", artist.slug, artist.periodSlug)}
                onClick={onArtist}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------- Star Map

const STARS = Array.from({ length: 150 }, (_, i) => ({
  x: (jitter(`sx${i}`) + 1) / 2,
  y: (jitter(`sy${i}`) + 1) / 2,
  s: 1 + ((jitter(`ss${i}`) + 1) / 2) * 1.8,
  o: 0.15 + ((jitter(`so${i}`) + 1) / 2) * 0.5,
}));

export function StarMapView({
  periods,
  byPeriod,
  size,
  t,
  lanes,
  laneCount,
  isDimmed,
  onArtist,
  onPeriod,
}: ViewProps) {
  const top = 150;
  const usable = size.h - top - 80;
  const laneH = usable / laneCount;

  return (
    <div className="tl-layer">
      {/* distant starfield with gentle parallax */}
      {STARS.map((s, i) => (
        <span
          key={i}
          className="star-dot"
          style={{
            left: ((s.x * size.w + t.x * 0.06) % (size.w + 40)) - 20,
            top: s.y * size.h,
            width: s.s,
            height: s.s,
            opacity: s.o,
            boxShadow: "none",
          }}
        />
      ))}

      {periods.map((p) => {
        const left = xOf(p.startYear, size.w, t);
        const right = xOf(p.endYear, size.w, t);
        if (right < -500 || left > size.w + 500) return null;
        const lane = lanes.get(p.slug) ?? 0;
        const cy = top + (lane + 0.5) * laneH + t.y;
        const artists = byPeriod.get(p.slug) ?? [];
        const vis = ease(reveal(p, size, t, artists.length));
        const dim = isDimmed("period", p.slug);
        const pxW = right - left;
        const labelX = clampLabelX(left, right, size.w);
        const placed = layoutArtists(artists, size.w, t, 130);

        return (
          <div key={p.slug}>
            <div
              className={`neb${dim ? " dimmed" : ""}`}
              style={{
                left,
                top: cy - laneH * 0.62,
                width: pxW,
                height: laneH * 1.24,
                background: `radial-gradient(closest-side, ${p.color}80, ${p.color}2e 55%, transparent 75%)`,
              }}
            />
            <span
              className="neb-label"
              style={{
                left: labelX,
                top: cy - (vis > 0.1 ? laneH * 0.34 : 0),
                fontSize: Math.min(26, 12 + pxW / 90),
                opacity: dim ? 0.18 : 0.55 + vis * 0.45,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onPeriod(p);
              }}
            >
              {p.name}
              <small>
                {p.startYear} – {p.endYear}
              </small>
            </span>

            {placed.map(({ artist, x, row }) => {
              const jy = jitter(artist.slug) * laneH * 0.22;
              const y = cy + jy + (row === 1 ? 64 : 0);
              const dimA = isDimmed("artist", artist.slug, artist.periodSlug);
              return (
                <span key={artist.slug}>
                  {vis < 0.95 && (
                    <span
                      className="star-dot"
                      style={{ left: x, top: y, opacity: dimA ? 0.1 : 1 - vis }}
                    />
                  )}
                  <ArtistNode
                    artist={artist}
                    x={x}
                    y={y}
                    px={62}
                    visible={vis}
                    dimmed={dimA}
                    onClick={onArtist}
                  />
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------------- River

function streamPath(
  p: Period,
  size: { w: number; h: number },
  t: Transform,
  cy: number,
  maxTh: number
): string {
  const N = 26;
  const topPts: string[] = [];
  const botPts: string[] = [];
  const meanderAmp = 14 + jitter(p.slug, 7) * 8;
  const phase = jitter(p.slug, 3) * Math.PI;
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    const year = p.startYear + f * (p.endYear - p.startYear);
    const x = xOf(year, size.w, t);
    const center = cy + Math.sin(f * Math.PI * 1.6 + phase) * meanderAmp;
    const th = Math.max(2.5, maxTh * Math.sin(Math.PI * (0.06 + f * 0.88)));
    topPts.push(`${x.toFixed(1)},${(center - th).toFixed(1)}`);
    botPts.unshift(`${x.toFixed(1)},${(center + th).toFixed(1)}`);
  }
  return `M${topPts.join(" L")} L${botPts.join(" L")} Z`;
}

function streamCenterY(
  p: Period,
  year: number,
  cy: number
): number {
  const f = (year - p.startYear) / (p.endYear - p.startYear);
  const meanderAmp = 14 + jitter(p.slug, 7) * 8;
  const phase = jitter(p.slug, 3) * Math.PI;
  return cy + Math.sin(f * Math.PI * 1.6 + phase) * meanderAmp;
}

export function RiverView({
  periods,
  byPeriod,
  size,
  t,
  lanes,
  laneCount,
  isDimmed,
  onArtist,
  onPeriod,
}: ViewProps) {
  const top = 150;
  const usable = size.h - top - 80;
  const laneH = usable / laneCount;

  return (
    <div className="tl-layer">
      <svg className="river-svg" width={size.w} height={size.h}>
        <defs>
          {periods.map((p) => (
            <linearGradient key={p.slug} id={`grad-${p.slug}`} x1="0" x2="1">
              <stop offset="0%" stopColor={p.color} stopOpacity="0.34" />
              <stop offset="40%" stopColor={p.color} stopOpacity="0.85" />
              <stop offset="100%" stopColor={p.color} stopOpacity="0.42" />
            </linearGradient>
          ))}
        </defs>
        {periods.map((p) => {
          const left = xOf(p.startYear, size.w, t);
          const right = xOf(p.endYear, size.w, t);
          if (right < -500 || left > size.w + 500) return null;
          const lane = lanes.get(p.slug) ?? 0;
          const cy = top + (lane + 0.5) * laneH + t.y;
          const vis = ease(
            reveal(p, size, t, (byPeriod.get(p.slug) ?? []).length)
          );
          const maxTh = laneH * 0.3 + vis * 26;
          const dim = isDimmed("period", p.slug);
          const labelX = clampLabelX(left, right, size.w);
          return (
            <g key={p.slug} className={`stream${dim ? " dimmed" : ""}`}>
              <path
                d={streamPath(p, size, t, cy, maxTh)}
                fill={`url(#grad-${p.slug})`}
                onClick={() => onPeriod(p)}
              />
              <text
                className="stream-label"
                x={labelX}
                y={streamCenterY(p, (p.startYear + p.endYear) / 2, cy) + 5}
                textAnchor="middle"
                fontSize={Math.min(22, 11 + (right - left) / 110)}
                opacity={dim ? 0.2 : 0.85}
              >
                {p.name}
              </text>
            </g>
          );
        })}
      </svg>

      {periods.map((p) => {
        const left = xOf(p.startYear, size.w, t);
        const right = xOf(p.endYear, size.w, t);
        if (right < -500 || left > size.w + 500) return null;
        const lane = lanes.get(p.slug) ?? 0;
        const cy = top + (lane + 0.5) * laneH + t.y;
        const artists = byPeriod.get(p.slug) ?? [];
        const vis = ease(reveal(p, size, t, artists.length));
        const placed = layoutArtists(artists, size.w, t, 120);
        return (
          <span key={p.slug}>
            {placed.map(({ artist, x, row }) => {
              const y =
                streamCenterY(p, activeRange(artist).mid, cy) +
                (row === 1 ? 70 : 0) +
                jitter(artist.slug, 11) * 10;
              const dimA = isDimmed("artist", artist.slug, artist.periodSlug);
              return (
                <span key={artist.slug}>
                  {vis < 0.95 && (
                    <span
                      className="star-dot"
                      style={{
                        left: x,
                        top: y,
                        opacity: dimA ? 0.1 : Math.max(0.5, 1 - vis),
                        background: p.color,
                        boxShadow: `0 0 9px 2px ${p.color}aa`,
                      }}
                    />
                  )}
                  <ArtistNode
                    artist={artist}
                    x={x}
                    y={y}
                    px={58}
                    visible={vis}
                    dimmed={dimA}
                    onClick={onArtist}
                  />
                </span>
              );
            })}
          </span>
        );
      })}
    </div>
  );
}
