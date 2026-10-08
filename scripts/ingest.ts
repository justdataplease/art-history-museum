// Ingest all museum content from Wikipedia / Wikidata / Wikimedia Commons.
// Writes data/wikipedia/museum.json plus a report of anything thin or missing.
// Re-runnable: per-artist results are cached in data/wikipedia/artists/.
//
//   npm run ingest                # artists with a cache file are served from it
//   npm run ingest -- --refresh   # re-fetch every artist (ignore the per-artist caches)
//
// An artist whose fetch fails keeps its previous cache entry (or its entry in
// the previous museum.json), so one failed request never drops a gallery.
// Every run then re-checks the whole collection: images against their works,
// © labels, enrichment (sizes, pageviews) and image credit lines.

import "./lib/env"; // .env.local (WIKI_USER_AGENT) before anything reads it
import fs from "node:fs";
import path from "node:path";
import { COMMONS_CATALOGUES, EXTRA_PAINTINGS, PERIODS } from "./seed";
import { enrichArtists } from "./lib/enrich";
import type { ImageCredit } from "./lib/credits";
import { orderArtist, vetCollection } from "./lib/passes";
import {
  artistInCopyright,
  leadYear,
  notAnArtwork,
  pickYear,
  usableCommonsDescription,
} from "./lib/vet";
import { cleanArtistName, decodeEntities } from "../src/lib/text";
import {
  createLimiter,
  extractFacts,
  fetchJson,
  canonicalImageUrl,
  getCategoryMembers,
  getPageImageAny,
  getPaintingsByArtist,
  getPlainExtract,
  getSummary,
  getWikidataDates,
  nonFreeFiles,
  splitLongRequest,
  type SparqlPainting,
} from "./lib/wiki";

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, "data", "wikipedia");
const ARTIST_CACHE = path.join(CACHE, "artists");
fs.mkdirSync(ARTIST_CACHE, { recursive: true });
const REFRESH = process.argv.includes("--refresh");
// Older caches contain only article works and a small Commons top-up.
const INGEST_VERSION = 5;

const wikiLimit = createLimiter(5);
const sparqlLimit = createLimiter(1);
const artistLimit = createLimiter(3);

const MIN_PAINTINGS = 8;
const LANGUAGE_NAMES: Record<string, string> = { el: "Greek", fr: "French", de: "German", it: "Italian", es: "Spanish", pt: "Portuguese" };
// Candidate articles fetched concurrently (the limiter still caps requests).
const BATCH = 8;
// A series article sometimes leads with a montage of every version rather
// than one painting; such an image can't hang as a single canvas.
const MONTAGE = /collage|montage|compilation|comparison|all[ _]versions|mosaic[ _]of|grid/i;
// A Commons-only work (no article) is hung from its Wikidata image alone, so
// that image must be the whole work: not a detail, a preparatory sketch, the
// back, a technical image or a photo of the room it hangs in.
// Chinese and Japanese works on Commons are often split into sections of a
// scroll, close-ups, seals, colophons or calligraphy-only sheets: for those
// galleries a Commons-only image must name none of these.
const EAST_ASIAN = new Set(["chinese-painting", "japanese-painting", "ukiyo-e"]);
const EAST_ASIAN_SKIP =
  /\b(seals?|calligraph\w*|colophons?|inscriptions?|poems?|part|parts|section|sections|segment|fragment|cropped|crop|close-?up|enlarged|zoom)\b|部分|局部|書/i;
const COMMONS_ONLY_SKIP =
  /\b(details?|ausschnitt|particolare|d[ée]tail|frame[ds]?|rahmen|verso|reverse|x-ray|infrared|exhibition|ausstellung|installation|in situ)\b/i;

export interface PaintingOut {
  slug: string;
  title: string;
  year: number | null;
  /** Image Wikipedia shows (free, or non-free for a work still in copyright); null when the article has none. */
  imageUrl: string | null;
  /** Still in copyright: Wikipedia shows its image only under fair use (labelled © in the gallery). */
  copyrighted?: boolean;
  imageWidth: number | null;
  imageHeight: number | null;
  story: string;
  facts: string[];
  wikipediaUrl: string | null;
  sitelinks: number;
  // Filled by enrichArtists (scripts/lib/enrich.ts) from Wikidata / Wikimedia.
  widthCm?: number | null;
  heightCm?: number | null;
  pageviews?: number | null;
  qid?: string | null;
  imageBytes?: number | null;
  /** Author / licence / file page of the image (src/lib/types.ts ImageCredit). */
  imageCredit?: ImageCredit | null;
  /** Released by its rights holder under a free licence (a Commons catalogue): shown although the artist is
   *  still in copyright. */
  licensed?: boolean;
}

export interface ArtistOut {
  slug: string;
  periodSlug: string;
  name: string;
  wikiTitle: string;
  qid: string | null;
  birthYear: number | null;
  deathYear: number | null;
  tagline: string;
  bio: string;
  portraitUrl: string | null;
  portraitWidth: number | null;
  portraitHeight: number | null;
  portraitCredit?: ImageCredit | null;
  wikipediaUrl: string | null;
  paintings: PaintingOut[];
  ingestVersion?: number;
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function stripHtml(html: string): string {
  // every named / numeric entity ("&#039;" included), not a fixed list
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

interface CommonsFileInfo {
  url: string;
  width: number;
  height: number;
  description: string;
}

/** Choose the painter's own section of this later composite scroll. */
export function selectCatalogueSource(candidate: SparqlPainting, artistQid: string): SparqlPainting {
  if (candidate.qid !== "Q132599105") return candidate;
  // Each Commons Artwork template names its own creator, cites Q132599105,
  // and links Shanghai Museum's account of the four separately painted parts:
  // https://www.shanghaimuseum.net/mu/frontend/pg/article/id/CI00000871
  const files: Record<string, string> = {
    Q558863: "沈周仿宋李唐渔隐图.jpg",
    Q2248916: "唐寅文会图.jpg",
    Q306673: "文徵明有竹图.jpg",
    Q769372: "仇英访梅图.jpg",
  };
  const file = files[artistQid];
  if (!file) return candidate;
  const image = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`;
  // The item and its possible article describe the composite. The filename
  // identifies this painter's work without copying another section's title.
  return {
    ...candidate, label: file.replace(/\.[^.]+$/, ""), image, images: [image], article: undefined,
    // Its unqualified inception dates belong to different parts of the scroll.
    year: undefined, yearPrecision: undefined,
  };
}

// Commons catalogue files are fetched fifty at a time, rather than one
// request for every painting. Keys keep the Wikidata P18 URL the caller used.
async function commonsFileInfos(filePathUrls: string[]): Promise<Map<string, CommonsFileInfo>> {
  const requested = new Map(filePathUrls.map((url) => [url, decodeURIComponent(url.split("/Special:FilePath/").pop() ?? "").replace(/_/g, " ")]));
  const names = [...new Set(requested.values())].filter(Boolean);
  const byName = new Map<string, CommonsFileInfo>();
  const urlFor = (batch: string[]) => `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
      action: "query", format: "json", formatversion: "2", redirects: "1",
      prop: "imageinfo", iiprop: "url|size|extmetadata",
      iiextmetadatafilter: "ImageDescription|NonFree", iiextmetadatalanguage: "en",
      titles: batch.map((name) => `File:${name}`).join("|"),
  })}`;
  const batches = [];
  for (let i = 0; i < names.length; i += 50) batches.push(...splitLongRequest(names.slice(i, i + 50), urlFor));
  for (const { batch, url: requestUrl } of batches) {
    const data = await wikiLimit(() => fetchJson<any>(requestUrl));
    if (!Array.isArray(data?.query?.pages)) throw new Error("Commons imageinfo returned nothing");
    const aliases = new Map<string, string>([...(data.query.normalized ?? []), ...(data.query.redirects ?? [])].map((x) => [x.from, x.to]));
    const pages = new Map<string, any>(data.query.pages.map((p: any) => [p.title, p]));
    for (const name of batch) {
      let title = `File:${name}`;
      const seen = new Set<string>();
      while (aliases.has(title) && !seen.has(title)) {
        seen.add(title);
        title = aliases.get(title)!;
      }
      const info = pages.get(title)?.imageinfo?.[0];
      const flag = info?.extmetadata?.NonFree?.value;
      const url = info?.url && canonicalImageUrl(info.url);
      if (!url?.startsWith("https://upload.wikimedia.org/wikipedia/commons/") || (flag && flag !== "false")) continue;
      byName.set(name, { url, width: info.width, height: info.height, description: stripHtml(info.extmetadata?.ImageDescription?.value ?? "") });
    }
  }
  const out = new Map<string, CommonsFileInfo>();
  for (const [url, name] of requested) {
    const info = byName.get(name);
    if (info) out.set(url, info);
  }
  return out;
}

async function commonsFileInfo(filePathUrl: string): Promise<CommonsFileInfo | null> {
  return (await commonsFileInfos([filePathUrl])).get(filePathUrl) ?? null;
}

// Licences under which a rights holder releases a work still in copyright; Commons hosts such a work only with
// the holder's permission (VRT). Public-domain marks do not count: for these artists they mean "PD in the US".
const FREE_LICENCE = /^(CC[ -]?BY|CC0|CC[ -]?Zero)/i;

/**
 * Every work in a Commons category whose files carry a free licence: for an artist whose catalogue was released
 * on Commons without Wikidata items (seed.ts COMMONS_CATALOGUES). The title is the file's object name, else its
 * file name without the catalogue number ("Sans titre - 329 GAÏTIS.jpg" -> "Untitled (329)").
 */
async function commonsCatalogue(category: string, artist: ArtistContext): Promise<PaintingOut[]> {
  const files: string[] = [];
  let cont: Record<string, string> = {};
  for (;;) {
    const data = await wikiLimit(() => fetchJson<any>(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
      action: "query", format: "json", formatversion: "2", list: "categorymembers", cmtitle: category,
      cmtype: "file", cmlimit: "500", ...cont,
    })}`));
    files.push(...(data?.query?.categorymembers ?? []).map((m: any) => m.title as string));
    if (!data?.continue) break;
    cont = data.continue;
  }
  const out: PaintingOut[] = [];
  for (let i = 0; i < files.length; i += 50) {
    const data = await wikiLimit(() => fetchJson<any>(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
      action: "query", format: "json", formatversion: "2", prop: "imageinfo", iiprop: "url|size|extmetadata",
      iiextmetadatafilter: "LicenseShortName|ObjectName|DateTimeOriginal|ImageDescription",
      iiextmetadatalanguage: "en", titles: files.slice(i, i + 50).join("|"),
    })}`));
    for (const page of data?.query?.pages ?? []) {
      const info = page.imageinfo?.[0];
      const meta = info?.extmetadata ?? {};
      if (!info?.url || !FREE_LICENCE.test(meta.LicenseShortName?.value ?? "")) continue;
      const fileTitle = String(page.title).replace(/^File:/, "").replace(/\.[^.]+$/, "");
      // "Sans titre - 329 GAÏTIS", '"Luna Park" ou "Le manège" - 931': a catalogue number, maybe a name
      const tail = /\s*-\s*(\d+)(?:\s+[A-ZÀ-ÝΑ-Ω]+)?\s*$/u;
      const number = tail.exec(fileTitle)?.[1];
      let title = (stripHtml(meta.ObjectName?.value ?? "") || fileTitle).replace(tail, "").trim();
      // French alternative titles: '"A" ou "B"' -> "A (B)"
      const alt = /^["“]?(.+?)["”]?\s+ou\s+["“]?(.+?)["”]?$/.exec(title);
      title = (alt ? `${alt[1]} (${alt[2]})` : title).replace(/^["“ ]+|["” ]+$/g, "").trim();
      if (/^sans titre$/i.test(title)) title = "Untitled";
      // the catalogue number tells the many untitled works apart
      if (number && title === "Untitled") title = `Untitled (${number})`;
      const y = Number(/\b(1[89]\d\d|20\d\d)\b/.exec(stripHtml(meta.DateTimeOriginal?.value ?? ""))?.[1]);
      const year = y && (!artist.birthYear || y >= artist.birthYear) && (!artist.deathYear || y <= artist.deathYear) ? y : null;
      out.push({
        slug: number ? `${slugify(title.replace(` (${number})`, "")) || "work"}-${number}` : slugify(fileTitle),
        title,
        year,
        imageUrl: canonicalImageUrl(info.url),
        imageWidth: info.width,
        imageHeight: info.height,
        story: usableCommonsDescription(stripHtml(meta.ImageDescription?.value ?? ""), title),
        facts: [],
        wikipediaUrl: null,
        sitelinks: 0,
        licensed: true,
      });
    }
  }
  return out;
}

/** "fr:Yannis Gaïtis" -> ["fr", "Yannis Gaïtis"]; an English title has no prefix. */
function articleOf(seedTitle: string): [string, string] {
  const m = /^([a-z]{2,3}):(.+)$/.exec(seedTitle);
  return m ? [m[1], m[2]] : ["en", seedTitle];
}

/** The English Wikidata description ("Greek painter (1923–1984)"), for an artist without an English article. */
async function englishDescription(qid: string): Promise<string> {
  const data = await wikiLimit(() => fetchJson<any>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=descriptions&languages=en&ids=${qid}`));
  return data?.entities?.[qid]?.descriptions?.en?.value ?? "";
}

function usableCatalogueImage(cand: SparqlPainting, ci: CommonsFileInfo, periodSlug: string): boolean {
  const file = decodeURIComponent(ci.url.split("/").pop() ?? "");
  const text = `${file} ${cand.label}`;
  return Math.max(ci.width, ci.height) >= 600 && !COMMONS_ONLY_SKIP.test(text) && !MONTAGE.test(file)
    && !(EAST_ASIAN.has(periodSlug) && EAST_ASIAN_SKIP.test(text));
}

function cataloguePainting(cand: SparqlPainting, ci: CommonsFileInfo): PaintingOut {
  return {
    // Two museum versions can have exactly the same Wikidata label.
    slug: `${slugify(cand.label) || "painting"}-${cand.qid.toLowerCase()}`,
    title: cand.label,
    year: cand.year != null && (cand.yearPrecision ?? 9) >= 9 ? cand.year : null,
    imageUrl: ci.url,
    imageWidth: ci.width,
    imageHeight: ci.height,
    story: usableCommonsDescription(ci.description, cand.label),
    facts: [],
    wikipediaUrl: null,
    sitelinks: cand.sitelinks,
    qid: cand.qid,
  };
}

/** Non-deprecated P31 classes of an item (null when it can't be read). */
async function itemClasses(qid: string | undefined): Promise<string[] | null> {
  if (!qid) return null;
  const data = await wikiLimit(() =>
    fetchJson<any>(`https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&property=P31&entity=${qid}`)
  );
  const claims: any[] | undefined = data?.claims?.P31;
  if (!claims) return data?.claims ? [] : null;
  return claims
    .filter((c) => c.rank !== "deprecated" && c.mainsnak?.datavalue?.value?.id)
    .map((c) => c.mainsnak.datavalue.value.id as string);
}

interface ArtistContext {
  title: string;
  qid: string | null;
  birthYear: number | null;
  deathYear: number | null;
  inCopyright: boolean;
}

// Build a PaintingOut from a Wikipedia article title. An image is required,
// except for an artist still in copyright: an article without any image is
// then a work Wikipedia can't show either, and it hangs as a placeholder.
// Mutates `have` with the slugs it claims so callers can dedupe.
async function fetchArticlePainting(
  title: string,
  have: Set<string>,
  artist: ArtistContext
): Promise<PaintingOut | null> {
  const inCopyright = artist.inCopyright;
  const tSlug = slugify(title.replace(/\s*\([^)]*\)\s*$/, ""));
  if (have.has(tSlug) || have.has(slugify(title))) return null;
  const ps = await wikiLimit(() => getSummary(title));
  if (!ps) return null;
  if (ps.wikibase_item && have.has(ps.wikibase_item)) return null;
  const img = ps.originalimage ?? (await wikiLimit(() => getPageImageAny(ps.title)));
  if (!img && !inCopyright) return null;
  const slug = slugify(ps.title);
  if (have.has(slug)) return null;
  // Only artworks: a category or a redirect can land on the artist's own
  // biography, a sitter, a chapel, a list, a book or a performance. The
  // article's Wikidata class decides; without an artwork class the lead must
  // present one (src: scripts/lib/vet.ts notAnArtwork).
  const why = notAnArtwork({
    title: ps.title,
    lead: ps.extract,
    qid: ps.wikibase_item ?? null,
    classes: await itemClasses(ps.wikibase_item),
    artistTitle: artist.title,
    artistQid: artist.qid,
  });
  if (why) {
    console.log(`     skip "${ps.title}": ${why}`);
    return null;
  }
  const full = await wikiLimit(() => getPlainExtract(ps.title));
  const facts = full ? extractFacts(full, ps.extract) : [];
  const year = leadYear(ps.extract, artist.birthYear, artist.deathYear);
  have.add(slug);
  have.add(tSlug);
  if (ps.wikibase_item) have.add(ps.wikibase_item);
  return {
    slug,
    title: ps.displaytitle ? stripHtml(ps.displaytitle) : ps.title,
    year,
    imageUrl: img ? canonicalImageUrl(img.source) : null,
    ...(img ? {} : { copyrighted: true }),
    imageWidth: img?.width ?? null,
    imageHeight: img?.height ?? null,
    story: ps.extract,
    facts,
    wikipediaUrl: ps.content_urls?.desktop?.page ?? null,
    sitelinks: 0,
    qid: ps.wikibase_item ?? null,
  };
}

export async function ingestArtist(
  wikiTitle: string,
  periodSlug: string
): Promise<ArtistOut | null> {
  const [lang, articleTitle] = articleOf(wikiTitle);
  const slug = slugify(articleTitle);
  const cacheFile = path.join(ARTIST_CACHE, `${slug}.json`);
  if (!REFRESH && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as ArtistOut;
    if (cached.ingestVersion === INGEST_VERSION) return cached;
  }

  const summary = await wikiLimit(() => getSummary(articleTitle, lang));
  if (!summary) {
    console.error(`!! artist summary missing: ${wikiTitle}`);
    return null;
  }
  const qid = summary.wikibase_item ?? null;
  const dates = qid ? await wikiLimit(() => getWikidataDates(qid)) : {};

  let paintings: PaintingOut[] = [];
  const inCopyright = artistInCopyright(dates.birthYear, dates.deathYear);
  const ctx: ArtistContext = {
    title: summary.title,
    qid,
    birthYear: dates.birthYear ?? null,
    deathYear: dates.deathYear ?? null,
    inCopyright,
  };
  if (qid) {
    // the ukiyo-e masters' works are woodblock prints; everyone else hangs paintings only
    const candidates = (await sparqlLimit(() => getPaintingsByArtist(qid, { prints: periodSlug === "ukiyo-e" })))
      .map(candidate => selectCatalogueSource(candidate, qid));
    const withArticle = candidates.filter((c) => c.article);
    withArticle.sort((a, b) => Number(a.series) - Number(b.series));
    const imageOnly = candidates.filter((c) => !c.article && c.image);
    const seriesQids = new Set(candidates.filter((c) => c.series).map((c) => c.qid));

    const fetchCandidate = async (cand: (typeof withArticle)[number]): Promise<PaintingOut | null> => {
      const ownImage = async (): Promise<PaintingOut | null> => {
        const files = await commonsFileInfos(cand.images ?? (cand.image ? [cand.image] : []));
        for (const ci of files.values()) {
          if (usableCatalogueImage(cand, ci, periodSlug)) return cataloguePainting(cand, ci);
        }
        return null;
      };
      const ps = await wikiLimit(() => getSummary(cand.article!));
      if (!ps) return ownImage();
      // The item is a painting, but its article can redirect elsewhere (the
      // artist's own biography, a sitter, a building): vet what we landed on.
      if (ps.title === summary.title || (ps.wikibase_item && ps.wikibase_item !== cand.qid)) {
        const why = notAnArtwork({
          title: ps.title,
          lead: ps.extract,
          qid: ps.wikibase_item ?? null,
          classes: await itemClasses(ps.wikibase_item),
          artistTitle: summary.title,
          artistQid: qid,
        });
        if (why) {
          console.log(`     skip "${ps.title}" (from ${cand.qid}): ${why}`);
        }
        // A version can redirect to the series article. Its lead image and
        // date describe the series; use this version's own Wikidata image.
        return ownImage();
      }
      const img = ps.originalimage;
      let imageUrl = img?.source ?? null;
      let w = img?.width ?? null;
      let h = img?.height ?? null;
      if (!imageUrl && cand.image) {
        const ci = await commonsFileInfo(cand.image);
        if (ci) {
          imageUrl = ci.url;
          w = ci.width;
          h = ci.height;
        }
      }
      if (!imageUrl) {
        // no free image anywhere: a non-free lead image means the work is
        // still in copyright — it hangs labelled © (classifyLicences)
        const any = await wikiLimit(() => getPageImageAny(ps.title));
        if (any) {
          imageUrl = any.source;
          w = any.width;
          h = any.height;
        }
      }
      if (!imageUrl) {
        const fallback = await ownImage();
        if (fallback) return fallback;
        if (!inCopyright) return null;
      }
      if (imageUrl && MONTAGE.test(decodeURIComponent(imageUrl))) return ownImage();
      imageUrl = canonicalImageUrl(imageUrl);
      const full = await wikiLimit(() => getPlainExtract(cand.article!));
      const facts = full ? extractFacts(full, ps.extract) : [];
      // A year-precision inception wins; a decade / century one ("1800s")
      // only bounds the lead's year (scripts/lib/vet.ts pickYear), else it
      // stands as the approximate year.
      const inc =
        cand.year != null ? { year: cand.year, precision: cand.yearPrecision ?? 9 } : null;
      const year = inc
        ? pickYear(inc, ps.extract, ctx.birthYear, ctx.deathYear) ?? inc.year
        : leadYear(ps.extract, ctx.birthYear, ctx.deathYear);
      return {
        slug: slugify(ps.title),
        title: ps.displaytitle ? stripHtml(ps.displaytitle) : ps.title,
        year,
        imageUrl,
        ...(imageUrl ? {} : { copyrighted: true }),
        imageWidth: w,
        imageHeight: h,
        story: ps.extract,
        facts,
        wikipediaUrl: ps.content_urls?.desktop?.page ?? null,
        sitelinks: cand.sitelinks,
        qid: cand.qid,
      };
    };
    // Most-famous first, in small concurrent batches; results keep that order.
    const seenSlug = new Set<string>();
    const seenImage = new Set<string>();
    for (let i = 0; i < withArticle.length; i += BATCH) {
      const got = await Promise.all(withArticle.slice(i, i + BATCH).map(fetchCandidate));
      for (const p of got) {
        if (!p) continue;
        // two Wikidata items (a work and its series) can share an article or a lead image
        if (seenSlug.has(p.slug) || (p.imageUrl && seenImage.has(p.imageUrl))) continue;
        seenSlug.add(p.slug);
        if (p.imageUrl) seenImage.add(p.imageUrl);
        paintings.push(p);
      }
    }

    // Hand-curated catch-up titles for artists with patchy Wikidata coverage.
    {
      const have = new Set(paintings.flatMap((p) => [p.slug, ...(p.qid ? [p.qid] : [])]));
      for (const title of EXTRA_PAINTINGS[summary.title] ?? []) {
        const p = await fetchArticlePainting(title, have, ctx);
        if (p) paintings.push(p);
      }
    }

    // Top up from the enwiki "Paintings by X" category (catches works whose
    // Wikidata items aren't linked to the artist or lack P31=painting).
    if (lang === "en") {
      const have = new Set(paintings.flatMap((p) => [p.slug, ...(p.qid ? [p.qid] : [])]));
      const haveImage = new Set(paintings.map((p) => p.imageUrl));
      const titles = await wikiLimit(() =>
        getCategoryMembers(`Category:Paintings by ${summary.title}`, summary.title)
      );
      for (const title of titles) {
        if (/^List of/i.test(title) || title === summary.title) continue;
        const p = await fetchArticlePainting(title, have, ctx);
        if (!p) continue;
        if (!p.imageUrl) {
          paintings.push(p); // copyright placeholder
        } else if (!haveImage.has(p.imageUrl) && !MONTAGE.test(decodeURIComponent(p.imageUrl))) {
          haveImage.add(p.imageUrl);
          paintings.push(p);
        }
      }
    }

    // Every Commons-only painting (image + the Commons description when it is
    // English prose — not a caption, a template or another language).
    // Only whole works: no details, sketches, montages, frames or gallery views.
    {
      const haveQid = new Set(paintings.map((p) => p.qid));
      const byImage = new Map(paintings.filter((p) => p.imageUrl).map((p) => [p.imageUrl!, p]));
      // Individual versions are admitted before their series representatives.
      imageOnly.sort((a, b) => Number(a.series) - Number(b.series));
      for (let i = 0; i < imageOnly.length; i += 50) {
        const batch = imageOnly.slice(i, i + 50).filter((cand) => !haveQid.has(cand.qid));
        const files = await commonsFileInfos(batch.flatMap((cand) => cand.images ?? [cand.image!]));
        for (const cand of batch) {
          for (const file of cand.images ?? [cand.image!]) {
            const ci = files.get(file);
            if (!ci || !usableCatalogueImage(cand, ci, periodSlug)) continue;
            const duplicate = byImage.get(ci.url);
            // A series article's representative image is the same physical
            // canvas; retain the individual work's identity and dimensions.
            if (duplicate && (!duplicate.qid || !seriesQids.has(duplicate.qid) || cand.series)) continue;
            const p = cataloguePainting(cand, ci);
            if (duplicate) {
              paintings[paintings.indexOf(duplicate)] = p;
              haveQid.delete(duplicate.qid);
            } else paintings.push(p);
            haveQid.add(cand.qid);
            byImage.set(ci.url, p);
            break;
          }
        }
      }
    }
  }

  // A catalogue released on Commons under a free licence (seed.ts COMMONS_CATALOGUES)
  for (const category of COMMONS_CATALOGUES[wikiTitle] ?? []) {
    const haveImage = new Set(paintings.map((p) => p.imageUrl));
    const works = (await commonsCatalogue(category, ctx)).filter((p) => !haveImage.has(p.imageUrl));
    console.log(`     ${category}: ${works.length} freely licensed works`);
    paintings.push(...works);
  }

  // Dedupe article/category repeats without losing same-titled versions.
  const seen = new Set<string>();
  paintings = paintings.filter((p) => {
    const identity = p.qid ?? p.slug;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });

  // Portrait: the article's lead image, unless that is the artist's signature
  // (Franz Marc's article leads with his autograph) — then Wikidata's image (P18).
  let portrait = summary.originalimage
    ? { url: summary.originalimage.source, width: summary.originalimage.width, height: summary.originalimage.height }
    : null;
  if (qid && (!portrait || /autograph|signature|signatur/i.test(decodeURIComponent(portrait.url)))) {
    const claims = await wikiLimit(() =>
      fetchJson<any>(
        `https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&property=P18&entity=${qid}`
      )
    );
    const file: string | undefined = claims?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    const ci = file
      ? await commonsFileInfo(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`)
      : null;
    if (ci) portrait = { url: ci.url.split("?")[0], width: ci.width, height: ci.height };
  }

  const artist: ArtistOut = {
    slug,
    periodSlug,
    // display name without a "(artist)" disambiguator; wikiTitle keeps the article title
    name: cleanArtistName(stripHtml(summary.displaytitle ?? summary.title)),
    wikiTitle: lang === "en" ? summary.title : wikiTitle,
    qid,
    birthYear: dates.birthYear ?? null,
    deathYear: dates.deathYear ?? null,
    tagline: lang === "en" ? summary.description ?? "" : (qid ? await englishDescription(qid) : ""),
    // no English article: the English description, and the article in its own language is linked
    bio: lang === "en" ? summary.extract
      : `${cleanArtistName(stripHtml(summary.displaytitle ?? summary.title))}: ${qid ? await englishDescription(qid) : ""}. `
        + `There is no English Wikipedia article yet; the biography is on the ${LANGUAGE_NAMES[lang] ?? lang} Wikipedia.`,
    portraitUrl: portrait?.url ?? null,
    portraitWidth: portrait?.width ?? null,
    portraitHeight: portrait?.height ?? null,
    wikipediaUrl: summary.content_urls?.desktop?.page ?? null,
    paintings,
    ingestVersion: INGEST_VERSION,
  };
  fs.writeFileSync(cacheFile, JSON.stringify(artist, null, 2));
  console.log(
    `   ${artist.name}: ${paintings.length} paintings (${paintings.filter((p) => p.wikipediaUrl).length} with articles)`
  );
  return artist;
}

/** English-Wikipedia-local file name behind an upload.wikimedia.org URL. */
function enwikiFile(url: string | null): string | null {
  const m = url && /^https:\/\/upload\.wikimedia\.org\/wikipedia\/en\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]).replace(/_/g, " ") : null;
}

/**
 * Normalise every image URL and classify licences. Commons hosts only free
 * files; a file on English Wikipedia itself may be non-free (a work still in
 * copyright, shown on Wikipedia under fair use). Such a work keeps its image
 * and is flagged `copyrighted` — the gallery labels it "© In copyright" and
 * src/lib/takedowns.ts withholds it on a rights holder's request. A non-free
 * portrait is dropped.
 */
export async function classifyLicences(artists: ArtistOut[]): Promise<{ paintings: number; portraits: number }> {
  for (const a of artists) {
    a.portraitUrl = canonicalImageUrl(a.portraitUrl);
    for (const p of a.paintings) p.imageUrl = canonicalImageUrl(p.imageUrl);
  }
  const files = artists.flatMap((a) => [
    enwikiFile(a.portraitUrl),
    ...a.paintings.map((p) => enwikiFile(p.imageUrl)),
  ]).filter((f): f is string => !!f);
  const nonFree = await nonFreeFiles(files);
  let paintings = 0;
  let portraits = 0;
  for (const a of artists) {
    const pf = enwikiFile(a.portraitUrl);
    if (pf && nonFree.has(pf)) {
      a.portraitUrl = null;
      a.portraitWidth = null;
      a.portraitHeight = null;
      portraits++;
    }
    for (const p of a.paintings) {
      const f = enwikiFile(p.imageUrl);
      if (f && nonFree.has(f)) p.copyrighted = true;
      if (p.copyrighted) paintings++;
    }
  }
  console.log(`   ${files.length} English-Wikipedia files checked: ${paintings} copyrighted paintings, ${portraits} non-free portraits`);
  return { paintings, portraits };
}

/** The previous run's entry for an artist: its cache file, else its entry in museum.json. */
function previousArtist(wikiTitle: string, previous: Map<string, ArtistOut>): ArtistOut | null {
  const file = path.join(ARTIST_CACHE, `${slugify(wikiTitle)}.json`);
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as ArtistOut;
    } catch {
      /* fall through */
    }
  }
  return previous.get(wikiTitle) ?? null;
}

async function main() {
  const periodsOut = [];
  const artistsOut: ArtistOut[] = [];
  const problems: string[] = [];
  // The previous snapshot: a failed fetch falls back to it.
  const prevFile = path.join(CACHE, "museum.json");
  const prev = fs.existsSync(prevFile)
    ? (JSON.parse(fs.readFileSync(prevFile, "utf8")) as { periods: any[]; artists: ArtistOut[] })
    : { periods: [], artists: [] };
  const prevArtists = new Map(prev.artists.map((a) => [a.wikiTitle, a]));
  const prevPeriods = new Map(prev.periods.map((p) => [p.slug, p]));

  for (const period of PERIODS) {
    console.log(`\n== ${period.name} ==`);
    const ps = await wikiLimit(() => getSummary(period.wikiTitle)).catch(() => null);
    const old = prevPeriods.get(period.slug);
    periodsOut.push({
      slug: period.slug,
      name: period.name,
      startYear: period.startYear,
      endYear: period.endYear,
      color: period.color,
      description: ps?.extract ?? old?.description ?? "",
      wikipediaUrl: ps?.content_urls?.desktop?.page ?? old?.wikipediaUrl ?? null,
    });
    if (!ps) problems.push(`period summary missing: ${period.wikiTitle}${old ? " (previous text kept)" : ""}`);

    // Preserve seed order while overlapping independent article/file fetches.
    // The shared Wikimedia and WDQS limiters still bound provider requests.
    const periodArtists = await Promise.all(period.artists.map((artistTitle) => artistLimit(async () => {
      let artist: ArtistOut | null = null;
      try {
        artist = await ingestArtist(artistTitle, period.slug);
        if (!artist) problems.push(`artist missing: ${artistTitle}`);
      } catch (err) {
        problems.push(`artist failed: ${artistTitle}: ${err}`);
        console.error(`!! ${artistTitle} failed`, err);
      }
      if (!artist) {
        // never drop a gallery for one failed request (load-db would delete it)
        artist = previousArtist(artistTitle, prevArtists);
        if (!artist) return null;
        artist.periodSlug = period.slug;
        problems.push(`kept the previous entry for ${artistTitle}`);
      }
      return artist;
    })));
    for (const artist of periodArtists) {
      if (!artist) continue;
      artistsOut.push(artist);
      if (artist.paintings.length < MIN_PAINTINGS)
        problems.push(`thin gallery: ${artist.name} has ${artist.paintings.length} paintings`);
      if (!artist.portraitUrl) problems.push(`no portrait: ${artist.name}`);
      if (!artist.birthYear) problems.push(`no birth year: ${artist.name}`);
    }
  }

  // Canonical image URLs; a non-free (fair-use) image of a work stays, labelled ©.
  console.log("\n== Licences (non-free images -> labelled © In copyright) ==");
  const lic = await classifyLicences(artistsOut);
  problems.push(`licences: ${lic.paintings} works still in copyright (labelled ©), ${lic.portraits} non-free portraits dropped`);

  console.log("\n== Vetting (images vs works, © labels, Commons stories) ==");
  const fileMeta = await vetCollection(artistsOut, problems);

  // Physical size (Wikidata P2049/P2048), 12-month pageviews, Wikidata item,
  // year sanity, image credit lines — same pass as `npm run enrich`.
  console.log("\n== Enrich (Wikidata dimensions + pageviews + credits) ==");
  const enrich = await enrichArtists(artistsOut, { fileMeta });
  for (const r of enrich.failures) problems.push(`enrich: ${r}`);
  for (const r of enrich.removed) problems.push(`removed (by another artist): ${r}`);
  for (const r of enrich.removedSeries) problems.push(`removed (series represented by individual works): ${r}`);
  for (const r of enrich.yearChanges) problems.push(`year: ${r}`);
  for (const r of enrich.imageChanges) problems.push(`image re-uploaded: ${r}`);
  for (const r of enrich.unitFixes) problems.push(`size: ${r}`);
  problems.push(
    `enrich coverage: dimensions ${enrich.withBothDims}/${enrich.paintings}, pageviews ${enrich.withPageviews}/${enrich.paintings}, credits ${enrich.withCredit}/${artistsOut.reduce((n, a) => n + a.paintings.filter((p) => p.imageUrl).length, 0)}`
  );
  for (let i = 0; i < artistsOut.length; i++) artistsOut[i] = orderArtist(artistsOut[i]);
  for (const a of artistsOut)
    fs.writeFileSync(path.join(ARTIST_CACHE, `${a.slug}.json`), JSON.stringify(a, null, 2));
  fs.writeFileSync(path.join(CACHE, "enrich-report.json"), JSON.stringify(enrich, null, 2));

  const out = {
    generatedAt: new Date().toISOString(),
    periods: periodsOut,
    artists: artistsOut,
  };
  fs.writeFileSync(path.join(CACHE, "museum.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(
    path.join(CACHE, "report.json"),
    JSON.stringify(problems, null, 2)
  );

  const totalPaintings = artistsOut.reduce((n, a) => n + a.paintings.length, 0);
  console.log(
    `\nDone: ${periodsOut.length} periods, ${artistsOut.length} artists, ${totalPaintings} paintings`
  );
  console.log(`Problems (${problems.length}):`);
  for (const p of problems) console.log("  - " + p);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
