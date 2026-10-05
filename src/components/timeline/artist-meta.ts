import type { Artist, Period } from "@/lib/types";
import { wikiSrcSet } from "@/lib/img";
import { cleanArtistName, decodeEntities } from "@/lib/text";
import { activeRange, lifeRange } from "./timeline-math";
import { shortName } from "./text-measure";

/** Everything about an artist the views need that never changes per frame. */
export interface ArtistMeta {
  a: Artist;
  short: string;
  years: string;
  aria: string;
  life: { start: number; end: number };
  active: { start: number; end: number; mid: number };
  /** portrait thumb for nodes up to ~52px: the smallest Wikimedia bucket that covers 1x, and 2x */
  thumb: string | null;
  srcSet: string | undefined;
  initial: string;
}

export { decodeEntities };

/** Display form of an artist: entities decoded, Wikipedia disambiguators dropped
 *  (the data layer already does this; kept for data loaded before that). */
export function cleanArtist(a: Artist): Artist {
  const name = cleanArtistName(a.name);
  const tagline = decodeEntities(a.tagline);
  const bio = decodeEntities(a.bio);
  return name === a.name && tagline === a.tagline && bio === a.bio ? a : { ...a, name, tagline, bio };
}

export function artistYears(a: Artist): string {
  if (a.birthYear == null) return a.deathYear != null ? `d. ${a.deathYear}` : "";
  if (a.deathYear == null) return `b. ${a.birthYear}`;
  return `${a.birthYear} – ${a.deathYear}`;
}

export function buildArtistMeta(artists: Artist[]): Map<string, ArtistMeta> {
  const m = new Map<string, ArtistMeta>();
  for (const a of artists) {
    const years = artistYears(a);
    const ss = a.portraitUrl ? wikiSrcSet(a.portraitUrl, 52, a.portraitWidth) : null;
    m.set(a.slug, {
      a,
      short: shortName(a.name),
      years,
      aria: years ? `${a.name}, ${years}` : a.name,
      life: lifeRange(a),
      active: activeRange(a),
      thumb: ss?.src ?? null,
      srcSet: ss?.srcSet,
      initial: a.name.replace(/^(el|fra)\s+/i, "")[0] ?? "?",
    });
  }
  return m;
}

/** Static per-period colour tokens (hex + alpha), built once. */
export interface PeriodStyle {
  c: string;
  tint: string;
  tint2: string;
  edge: string;
  line: string;
  ink: string;
}

function darken(hex: string, f: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function buildPeriodStyles(periods: Period[]): Map<string, PeriodStyle> {
  const m = new Map<string, PeriodStyle>();
  for (const p of periods) {
    const c = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#8a7a5a";
    m.set(p.slug, {
      c,
      tint: `${c}24`,
      tint2: `${c}0d`,
      edge: `${c}55`,
      line: `${c}8c`,
      ink: darken(c, 0.72),
    });
  }
  return m;
}
