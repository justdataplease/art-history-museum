// Post-processing passes over ingested artists, shared by the ingest
// (scripts/ingest.ts) and the in-place repair (scripts/repair-data.ts):
// drop non-artworks, check that each image shows its work, label works still
// in copyright, repair years, vet Commons-only stories, keep paged-document
// thumbnails renderable and attach image credits. Each pass mutates the
// artists in place and returns a list of human-readable changes.

import type { ArtistOut, PaintingOut } from "../ingest";
import { fetchFileMeta, wikiFileOf, type FileMeta, type ImageCredit } from "./credits";
import { canonicalImageUrl, createLimiter, createPacer, fetchJson, indexClaimsResponse, projectClaims, readCachedClaims, readItemCache, saveItemCache } from "./wiki";
import {
  IMAGE_REVIEW,
  artistInCopyright,
  imageMismatch,
  inceptionOf,
  leadYear,
  notAnArtwork,
  pickYear,
  usableCommonsDescription,
} from "./vet";

export type Claims = Record<string, any[]>;

const key = (a: { slug: string }, p: { slug: string }) => `${a.slug}/${p.slug}`;

function titleOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.pathname.startsWith("/wiki/") ? decodeURIComponent(u.pathname.slice(6)).replace(/_/g, " ") : null;
  } catch {
    return null;
  }
}

/** Wikidata claims (selected properties) for many items, 50 per request. */
export async function fetchClaims(
  qids: string[],
  props: string[],
  log?: (m: string) => void,
  pace?: ReturnType<typeof createPacer>
): Promise<Map<string, Claims>> {
  const list = [...new Set(qids.filter(Boolean))];
  const index = readItemCache<string>("claims-index-v1.json");
  const known = readCachedClaims(list, props, index);
  const need = list.filter(qid => !known.has(qid));
  const request = pace ?? createPacer(2, 250);
  const batchLimit = createLimiter(2);
  const batches = [];
  for (let i = 0; i < need.length; i += 50) {
    batches.push(need.slice(i, i + 50));
  }
  let done = known.size;
  const results = await Promise.all(batches.map(batch => batchLimit(async () => {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&formatversion=2&props=claims&ids=${batch.join("|")}`;
    const data = await fetchJson<{ entities?: Record<string, { claims?: Claims }> }>(
      url,
      {}, undefined, request
    );
    if (!data?.entities || typeof data.entities !== "object" || Array.isArray(data.entities)) throw new Error("wbgetentities returned nothing");
    indexClaimsResponse(index, batch, url);
    const out = new Map<string, Claims>();
    for (const q of batch) {
      out.set(q, projectClaims(data.entities[q]?.claims, props));
    }
    const before = done;
    done += batch.length;
    if (log && Math.floor(done / 1000) > Math.floor(before / 1000)) log(`  claims ${done}/${list.length}`);
    return [...out];
  })));
  for (const [qid, claims] of results.flat()) known.set(qid, claims);
  if (batches.length) saveItemCache("claims-index-v1.json", index);
  return new Map(list.map(qid => [qid, known.get(qid)!]));
}

/** Non-deprecated P31 classes of an item. */
export function classesOf(c: Claims | undefined): string[] | null {
  if (!c) return null;
  return (c.P31 ?? [])
    .filter((s) => s.rank !== "deprecated" && s.mainsnak?.datavalue?.value?.id)
    .map((s) => s.mainsnak.datavalue.value.id as string);
}

// ---------- 1. articles that are not artworks ----------

/** Drop biographies, lists, buildings, books, performances … (Wikidata P31 + the lead). */
export function dropNonArtworks(artists: ArtistOut[], claims: Map<string, Claims>): string[] {
  const out: string[] = [];
  for (const a of artists) {
    a.paintings = a.paintings.filter((p) => {
      const title = titleOf(p.wikipediaUrl);
      if (!title) return true; // Commons-only work: vetted by its Wikidata item at ingest
      const why = notAnArtwork({
        title,
        lead: p.story,
        qid: p.qid ?? null,
        classes: p.qid ? classesOf(claims.get(p.qid)) : null,
        artistTitle: a.wikiTitle,
        artistQid: a.qid,
      });
      if (why) out.push(`${key(a, p)} "${p.title}": ${why}`);
      return !why;
    });
  }
  return out;
}

/**
 * A series article's lead represents one of its members, sometimes through a
 * different scan. Explicit Wikidata membership decides, rather than matching
 * titles or files. A generic group of paintings is not proof of a series.
 * Physical assemblies remain intact even when also classified as a series.
 */
export function dropSeriesRepresentatives<T extends { slug: string; qid?: string | null }>(
  artists: { slug: string; paintings: T[] }[],
  claims: Map<string, Claims>
): string[] {
  const seriesClasses = new Set(["Q15727816", "Q19960510"]); // painting series; series of prints
  const assemblyClasses = new Set(["Q475476", "Q79218", "Q1278452", "Q15711026"]); // diptych; triptych; polyptych; altarpiece
  const ids = (item: Claims | undefined, prop: string): string[] => {
    const all = (item?.[prop] ?? []).filter(s => s.rank !== "deprecated" && s.mainsnak?.datavalue?.value?.id);
    const preferred = all.filter(s => s.rank === "preferred");
    return (preferred.length ? preferred : all).map(s => s.mainsnak.datavalue.value.id);
  };
  const removed: string[] = [];
  for (const artist of artists) {
    const series = new Set(artist.paintings.filter(p => {
      if (!p.qid) return false;
      const classes = classesOf(claims.get(p.qid)) ?? [];
      return classes.some(c => seriesClasses.has(c)) && !classes.some(c => assemblyClasses.has(c));
    }).map(p => p.qid!));
    const members = artist.paintings.filter(p => p.qid && !series.has(p.qid));
    const memberQids = new Set(members.map(p => p.qid!));
    const represented = new Set<string>();
    for (const member of members) {
      const item = claims.get(member.qid!);
      for (const parent of [...ids(item, "P179"), ...ids(item, "P361")]) {
        if (series.has(parent)) represented.add(parent);
      }
    }
    for (const parent of series) {
      if (ids(claims.get(parent), "P527").some(qid => memberQids.has(qid))) represented.add(parent);
    }
    artist.paintings = artist.paintings.filter(p => {
      if (!p.qid || !represented.has(p.qid)) return true;
      removed.push(key(artist, p));
      return false;
    });
  }
  return removed;
}

// ---------- 2. does the image show the work? ----------

export interface ReplacementImage {
  url: string;
  width: number;
  height: number;
  bytes: number | null;
}

/** imageinfo (url + size) of Commons files, keyed by file name. */
export async function commonsImageInfo(files: string[]): Promise<Map<string, ReplacementImage>> {
  const out = new Map<string, ReplacementImage>();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const qs = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "imageinfo",
      iiprop: "url|size",
      titles: batch.map((f) => `File:${f}`).join("|"),
    });
    const data = await fetchJson<{
      query?: {
        normalized?: { from: string; to: string }[];
        pages?: { title: string; imageinfo?: { url: string; width: number; height: number; size: number }[] }[];
      };
    }>(`https://commons.wikimedia.org/w/api.php?${qs}`);
    const norm = new Map((data?.query?.normalized ?? []).map((n) => [n.from, n.to]));
    const pages = new Map((data?.query?.pages ?? []).map((p) => [p.title, p]));
    for (const f of batch) {
      const ii = pages.get(norm.get(`File:${f}`) ?? `File:${f}`)?.imageinfo?.[0];
      // imageinfo URLs carry tracking parameters (?utm_source=…): keep the plain file URL
      if (ii?.url) out.set(f, { url: canonicalImageUrl(ii.url), width: ii.width, height: ii.height, bytes: ii.size ?? null });
    }
  }
  return out;
}

const fileNameOf = (url: string) => decodeURIComponent(url.split("/").pop() ?? "").replace(/_/g, " ");

/**
 * Check every image against its work (IMAGE_REVIEW first, then the
 * imageMismatch heuristic). A wrong image of a work still in copyright goes
 * (the work hangs as a © placard); a wrong image of a public-domain work is
 * replaced by the reviewed replacement, else the work is dropped. A heuristic
 * hit on a public-domain work that nobody reviewed is only reported.
 */
export function reviewImages(
  artists: ArtistOut[],
  meta: Map<string, FileMeta>,
  replacements: Map<string, ReplacementImage>,
  replacementMeta: Map<string, FileMeta>
): { changes: string[]; unreviewed: string[] } {
  const changes: string[] = [];
  const unreviewed: string[] = [];
  const names = artists.map((a) => a.name);
  for (const a of artists) {
    const inCopyright = artistInCopyright(a.birthYear, a.deathYear);
    a.paintings = a.paintings.filter((p) => {
      if (!p.imageUrl) return true;
      const k = key(a, p);
      const review = IMAGE_REVIEW[k];
      if (review === "ok") return true;
      const m = meta.get(p.imageUrl);
      const hit = m
        ? imageMismatch({
            artistName: a.name,
            artistWikiTitle: a.wikiTitle,
            otherArtists: names.filter((n) => n !== a.name),
            workTitle: p.title,
            story: p.story,
            copyrighted: inCopyright || !!p.copyrighted,
            meta: m,
            fileName: fileNameOf(p.imageUrl),
          })
        : null;
      if (!review && !hit) return true;
      const was = fileNameOf(p.imageUrl);
      const copyrighted = inCopyright || !!p.copyrighted;
      if (typeof review === "object") {
        const r = replacements.get(review.replace);
        if (r) {
          p.imageUrl = r.url;
          p.imageWidth = r.width;
          p.imageHeight = r.height;
          p.imageBytes = r.bytes;
          const rm = replacementMeta.get(r.url);
          if (rm) meta.set(r.url, rm);
          changes.push(`${k}: image replaced by the reviewed Commons image "${review.replace}" (was "${was}")`);
          return true;
        }
        if (!copyrighted) {
          unreviewed.push(`${k}: replacement "${review.replace}" not found on Commons — old image kept`);
          return true;
        }
      }
      if (!review && !copyrighted) {
        unreviewed.push(`${k}: ${hit} — kept, needs a look (add it to IMAGE_REVIEW)`);
        return true;
      }
      if (copyrighted) {
        p.imageUrl = null;
        p.imageWidth = null;
        p.imageHeight = null;
        p.imageBytes = null;
        p.copyrighted = true;
        changes.push(`${k}: image removed, hangs as a © placard (was "${was}"${hit ? `; ${hit}` : ""})`);
        return true;
      }
      changes.push(`${k} "${p.title}": dropped, its only image is wrong ("${was}")`);
      return false;
    });
  }
  return { changes, unreviewed };
}

// ---------- 2b. book covers, calligraphy, seals ----------

// Manuscript and scroll traditions: Commons often has the binding, a lacquer
// board, a text-only folio, a whole codex, a seal or colophon section or a box
// lid instead of the painting itself.
const BOOK_ART = new Set(["indian-painting", "persian-miniature"]);
const EAST_ASIAN_ART = new Set(["chinese-painting", "japanese-painting", "ukiyo-e"]);
const NOT_A_FOLIO =
  /\b(covers?|book ?covers?|bindings?|bookbinding|binding board|lacquer(?:ed)? (?:boards?|covers?)|doublures?|spine|codex|calligraph\w*|text (?:page|folio|only)|folio of text|endpapers?|box lid|lid)\b/i;
const NOT_A_FOLIO_CATEGORY = /^(Book covers|Bookbindings?|Lacquer|.*calligraphy|Islamic calligraphy|Codices)\b/i;
const NOT_A_SCROLL_PAINTING =
  /\b(colophons?|seal impressions?|seals? only|seal script|calligraph\w*|box lid|lid|inscription only)\b|題跋|款識/i;
const NOT_A_SCROLL_CATEGORY = /^(Colophons|Seals|Chinese seals|Japanese seals|.*calligraphy)\b/i;

/**
 * Drop (or, in copyright, blank) images that show a cover, binding, text
 * page, codex, seal, colophon or box lid instead of the painting. Returns the
 * changes and the number rejected per period.
 */
export function rejectNonPaintingImages(
  artists: ArtistOut[],
  meta: Map<string, FileMeta>
): { changes: string[]; perPeriod: Record<string, number> } {
  const changes: string[] = [];
  const perPeriod: Record<string, number> = {};
  for (const a of artists) {
    const book = BOOK_ART.has(a.periodSlug);
    const scroll = EAST_ASIAN_ART.has(a.periodSlug);
    if (!book && !scroll) continue;
    const copyrighted = artistInCopyright(a.birthYear, a.deathYear);
    a.paintings = a.paintings.filter((p) => {
      if (!p.imageUrl) return true;
      if (IMAGE_REVIEW[key(a, p)] === "ok") return true;
      const m = meta.get(p.imageUrl);
      const text = `${fileNameOf(p.imageUrl)} ${m?.objectName ?? ""}`;
      const cats = m?.categories ?? [];
      const hit = book
        ? NOT_A_FOLIO.test(text) || cats.some((c) => NOT_A_FOLIO_CATEGORY.test(c))
        : NOT_A_SCROLL_PAINTING.test(text) || cats.some((c) => NOT_A_SCROLL_CATEGORY.test(c));
      if (!hit) return true;
      perPeriod[a.periodSlug] = (perPeriod[a.periodSlug] ?? 0) + 1;
      const was = fileNameOf(p.imageUrl);
      if (copyrighted || p.copyrighted) {
        p.imageUrl = null;
        p.imageWidth = null;
        p.imageHeight = null;
        p.imageBytes = null;
        p.copyrighted = true;
        changes.push(`${key(a, p)}: image removed, not the painting ("${was}")`);
        return true;
      }
      changes.push(`${key(a, p)} "${p.title}": dropped, its image is not the painting ("${was}")`);
      return false;
    });
  }
  return { changes, perPeriod };
}

// ---------- 3. copyright labels ----------

/** Every work by an artist still in copyright is labelled ©, whatever the file's US status. */
export function labelCopyright(artists: ArtistOut[]): string[] {
  const out: string[] = [];
  for (const a of artists) {
    if (!artistInCopyright(a.birthYear, a.deathYear)) continue;
    for (const p of a.paintings) {
      if (p.copyrighted) continue;
      p.copyrighted = true;
      out.push(`${key(a, p)}: labelled © (${a.name} d. ${a.deathYear ?? "—"})`);
    }
  }
  return out;
}

// ---------- 4. years ----------

/**
 * Years from a decade / century Wikidata date are replaced by the lead's year
 * inside that span; missing years are recovered (exact inception, else the
 * lead); years outside the artist's life are replaced or cleared.
 */
export function repairYears(artists: ArtistOut[], claims: Map<string, Claims>, now = new Date()): string[] {
  const out: string[] = [];
  for (const a of artists) {
    const lo = a.birthYear != null ? a.birthYear + 5 : -Infinity;
    const hi = a.deathYear != null ? a.deathYear + 1 : now.getUTCFullYear();
    const inLife = (y: number | null) => y != null && y >= lo && y <= hi;
    for (const p of a.paintings) {
      // This composite scroll hangs as the individual painter's section. Its
      // unqualified global dates cannot supply that section's inception.
      const inc = p.qid && p.qid !== "Q132599105" ? inceptionOf(claims.get(p.qid)) : null;
      const before = p.year;
      let next = before;
      let why = "";
      if (before != null && inc && inc.precision < 9 && before === inc.year) {
        const y = pickYear(inc, p.story, a.birthYear, a.deathYear);
        if (y != null && y !== before) {
          next = y;
          why = `Wikidata date is only ${inc.precision === 8 ? "a decade" : "a century"}; ${
            y === inc.earliest ? "its earliest date" : "the lead's year"
          }`;
        }
      }
      if (next != null && !inLife(next)) {
        const exact = inc && inc.precision >= 9 && inLife(inc.year) ? inc.year : null;
        next = exact ?? leadYear(p.story, a.birthYear, a.deathYear);
        why = `outside ${a.birthYear ?? "?"}–${a.deathYear ?? "today"}`;
      }
      if (next == null) {
        const exact = inc && inc.precision >= 9 && inLife(inc.year) ? inc.year : null;
        const low = !exact && inc ? pickYear(inc, p.story, a.birthYear, a.deathYear) : null;
        const y = exact ?? (inLife(low) ? low : null) ?? leadYear(p.story, a.birthYear, a.deathYear);
        if (y != null) {
          next = y;
          why = exact != null ? "exact Wikidata inception" : "year in the lead";
        }
      }
      if (next !== before) {
        p.year = next;
        out.push(`${key(a, p)}: ${before ?? "null"} -> ${next ?? "null"} (${why})`);
      }
    }
  }
  return out;
}

// ---------- 5. Commons-only works ----------

/** A work without a Wikipedia article keeps its Commons description only when it is English prose. */
export function cleanCommonsStories(artists: ArtistOut[]): string[] {
  const out: string[] = [];
  for (const a of artists)
    for (const p of a.paintings) {
      if (p.wikipediaUrl || !p.story) continue;
      const s = usableCommonsDescription(p.story, p.title);
      if (s === p.story) continue;
      out.push(`${key(a, p)}: story ${s ? "tidied" : `dropped (${JSON.stringify(p.story.slice(0, 60))})`}`);
      p.story = s;
    }
  return out;
}

// ---------- 6. paged documents ----------

const PAGED = /\.(pdf|djvu)$/i;
const BUCKETS = [330, 500, 960, 1280, 1920, 3840];

/** A PDF / DjVu original can't be shown by a browser: use its rendered first page. */
export function fixPagedImages(artists: ArtistOut[]): string[] {
  const out: string[] = [];
  for (const a of artists)
    for (const p of a.paintings) {
      if (!p.imageUrl) continue;
      const m = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+\/)([0-9a-f]\/[0-9a-f]{2}\/([^/]+))$/.exec(p.imageUrl);
      if (!m || !PAGED.test(m[3])) continue;
      const w = [...BUCKETS].reverse().find((b) => !p.imageWidth || b <= p.imageWidth) ?? 330;
      const next = `${m[1]}thumb/${m[2]}/page1-${w}px-${m[3]}.jpg`;
      out.push(`${key(a, p)}: ${m[3]} -> page-1 rendering ${w}px`);
      p.imageUrl = next;
    }
  return out;
}

// ---------- all of the above ----------

/**
 * Re-check the whole collection (also what scripts/repair-data.ts runs on the
 * cached data): images against their works, © labels, Commons-only stories,
 * paged-document images. Returns the file metadata it fetched, reused by the
 * enrichment's credit lines.
 */
export async function vetCollection(artistsOut: ArtistOut[], problems: string[]): Promise<Map<string, FileMeta>> {
  let meta = await metaFor(allImageUrls(artistsOut), new Map(), (m) => console.log(m));
  const replaceFiles = Object.values(IMAGE_REVIEW).flatMap((r) => (typeof r === "object" ? [r.replace] : []));
  const replacements = await commonsImageInfo(replaceFiles);
  const replacementMeta = await metaFor([...replacements.values()].map((r) => r.url));
  const review = reviewImages(artistsOut, meta, replacements, replacementMeta);
  meta = new Map([...meta, ...replacementMeta]);
  for (const r of review.changes) problems.push(`image: ${r}`);
  for (const r of review.unreviewed) problems.push(`image check: ${r}`);
  const covers = rejectNonPaintingImages(artistsOut, meta);
  for (const r of covers.changes) problems.push(`image: ${r}`);
  for (const [period, n] of Object.entries(covers.perPeriod)) problems.push(`image filter: ${period} ${n} covers / text pages / seals rejected`);
  for (const r of labelCopyright(artistsOut)) problems.push(`©: ${r}`);
  for (const r of cleanCommonsStories(artistsOut)) problems.push(`commons story: ${r}`);
  for (const r of fixPagedImages(artistsOut)) problems.push(`paged image: ${r}`);
  return meta;
}

// ---------- 7. credits ----------

/** imageCredit on every painting with an image, portraitCredit on every artist with a portrait. */
export function attachCredits(artists: ArtistOut[], meta: Map<string, FileMeta>): { paintings: number; missing: string[] } {
  const missing: string[] = [];
  let paintings = 0;
  const credit = (url: string | null): ImageCredit | null => (url ? meta.get(url)?.credit ?? null : null);
  for (const a of artists) {
    a.portraitCredit = credit(a.portraitUrl);
    if (a.portraitUrl && !a.portraitCredit) missing.push(`${a.slug} (portrait)`);
    for (const p of a.paintings) {
      p.imageCredit = credit(p.imageUrl);
      if (p.imageCredit) paintings++;
      else if (p.imageUrl) missing.push(key(a, p));
    }
  }
  return { paintings, missing };
}

/** Every image URL (paintings + portraits) of the collection. */
export function allImageUrls(artists: ArtistOut[]): string[] {
  return artists.flatMap((a) => [a.portraitUrl, ...a.paintings.map((p) => p.imageUrl)]).filter((u): u is string => !!u);
}

/** extmetadata for the collection's images, reusing `known` entries. */
export async function metaFor(
  urls: string[],
  known: Map<string, FileMeta> = new Map(),
  log?: (m: string) => void
): Promise<Map<string, FileMeta>> {
  const need = urls.filter((u) => !known.has(u) && wikiFileOf(u));
  const got = need.length ? await fetchFileMeta(need, { log }) : new Map<string, FileMeta>();
  return new Map([...known, ...got]);
}

/** Canonical key order of a painting (ingest fields, enrichment, licence, credit). */
export function orderPainting(p: PaintingOut): PaintingOut {
  const order = [
    "slug", "title", "year", "imageUrl", "imageWidth", "imageHeight", "story", "facts", "wikipediaUrl", "sitelinks",
    "widthCm", "heightCm", "pageviews", "qid", "imageBytes", "copyrighted", "imageCredit",
  ];
  const rec = p as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of order) if (k in rec && !(k === "copyrighted" && rec[k] !== true)) out[k] = rec[k];
  for (const k of Object.keys(rec)) if (!(k in out) && !(k === "copyrighted" && rec[k] !== true)) out[k] = rec[k];
  return out as unknown as PaintingOut;
}

/** Canonical key order of an artist (portraitCredit next to the portrait). */
export function orderArtist(a: ArtistOut): ArtistOut {
  const order = [
    "slug", "periodSlug", "name", "wikiTitle", "qid", "birthYear", "deathYear", "tagline", "bio",
    "portraitUrl", "portraitWidth", "portraitHeight", "portraitCredit", "wikipediaUrl", "paintings",
  ];
  const rec = a as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of order) if (k in rec) out[k] = rec[k];
  for (const k of Object.keys(rec)) if (!(k in out)) out[k] = rec[k];
  (out as unknown as ArtistOut).paintings = a.paintings.map(orderPainting);
  return out as unknown as ArtistOut;
}
