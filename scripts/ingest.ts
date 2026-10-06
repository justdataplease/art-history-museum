// Ingest all museum content from Wikipedia / Wikidata / Wikimedia Commons.
// Writes data/cache/museum.json plus a report of anything thin or missing.
// Re-runnable: per-artist results are cached in data/cache/artists/.
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
import { EXTRA_PAINTINGS, PERIODS } from "./seed";
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
} from "./lib/wiki";

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, "data", "cache");
const ARTIST_CACHE = path.join(CACHE, "artists");
fs.mkdirSync(ARTIST_CACHE, { recursive: true });
const REFRESH = process.argv.includes("--refresh");

const wikiLimit = createLimiter(5);
const sparqlLimit = createLimiter(1);

const MIN_PAINTINGS = 8;
// No curatorial cap: every work with an illustrated English Wikipedia article
// hangs (the gallery splits big collections into a suite of rooms). The bound
// only guards against a runaway query.
const MAX_PAINTINGS = 1000;
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
  /\b(details?|ausschnitt|particolare|d[ée]tail|sketch|esquisse|skizze|study for|frame[ds]?|rahmen|verso|reverse|x-ray|infrared|exhibition|ausstellung|installation|in situ)\b/i;

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

// Resolve a Commons Special:FilePath value into a direct URL + dimensions + description.
async function commonsFileInfo(filePathUrl: string): Promise<{
  url: string;
  width: number;
  height: number;
  description: string;
} | null> {
  const fileName = decodeURIComponent(filePathUrl.split("/Special:FilePath/").pop() ?? "");
  if (!fileName) return null;
  const api =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&titles=" +
    encodeURIComponent("File:" + fileName);
  const data = await wikiLimit(() => fetchJson<any>(api));
  const info = data?.query?.pages?.[0]?.imageinfo?.[0];
  if (!info?.url) return null;
  const desc = info.extmetadata?.ImageDescription?.value;
  return {
    url: canonicalImageUrl(info.url),
    width: info.width,
    height: info.height,
    description: desc ? stripHtml(desc) : "",
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
  };
}

export async function ingestArtist(
  wikiTitle: string,
  periodSlug: string
): Promise<ArtistOut | null> {
  const slug = slugify(wikiTitle);
  const cacheFile = path.join(ARTIST_CACHE, `${slug}.json`);
  if (!REFRESH && fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  }

  const summary = await wikiLimit(() => getSummary(wikiTitle));
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
    const candidates = await sparqlLimit(() => getPaintingsByArtist(qid, { prints: periodSlug === "ukiyo-e" }));
    const withArticle = candidates.filter((c) => c.article);
    const imageOnly = candidates.filter((c) => !c.article && c.image);

    const fetchCandidate = async (cand: (typeof withArticle)[number]): Promise<PaintingOut | null> => {
      const ps = await wikiLimit(() => getSummary(cand.article!));
      if (!ps) return null;
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
          return null;
        }
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
      if (!imageUrl && !inCopyright) return null;
      if (imageUrl && MONTAGE.test(decodeURIComponent(imageUrl))) return null;
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
      };
    };
    // Most-famous first, in small concurrent batches; results keep that order.
    const seenSlug = new Set<string>();
    const seenImage = new Set<string>();
    for (let i = 0; i < withArticle.length && paintings.length < MAX_PAINTINGS; i += BATCH) {
      const got = await Promise.all(withArticle.slice(i, i + BATCH).map(fetchCandidate));
      for (const p of got) {
        if (!p || paintings.length >= MAX_PAINTINGS) continue;
        // two Wikidata items (a work and its series) can share an article or a lead image
        if (seenSlug.has(p.slug) || (p.imageUrl && seenImage.has(p.imageUrl))) continue;
        seenSlug.add(p.slug);
        if (p.imageUrl) seenImage.add(p.imageUrl);
        paintings.push(p);
      }
    }

    // Hand-curated catch-up titles for artists with patchy Wikidata coverage.
    {
      const have = new Set(paintings.map((p) => p.slug));
      for (const title of EXTRA_PAINTINGS[summary.title] ?? []) {
        if (paintings.length >= MAX_PAINTINGS) break;
        const p = await fetchArticlePainting(title, have, ctx);
        if (p) paintings.push(p);
      }
    }

    // Top up from the enwiki "Paintings by X" category (catches works whose
    // Wikidata items aren't linked to the artist or lack P31=painting).
    if (paintings.length < MAX_PAINTINGS) {
      const have = new Set(paintings.map((p) => p.slug));
      const haveImage = new Set(paintings.map((p) => p.imageUrl));
      const titles = await wikiLimit(() =>
        getCategoryMembers(`Category:Paintings by ${summary.title}`, summary.title)
      );
      for (const title of titles) {
        if (paintings.length >= MAX_PAINTINGS) break;
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

    // Top up with Commons-only paintings (image + the Commons description when
    // it is English prose — not a caption, a template or another language).
    // Only whole works: no details, sketches, montages, frames or gallery views.
    if (paintings.length < MIN_PAINTINGS) {
      const haveSlug = new Set(paintings.map((p) => p.slug));
      const haveImage = new Set(paintings.map((p) => p.imageUrl));
      for (const cand of imageOnly) {
        if (paintings.length >= MIN_PAINTINGS + 2) break;
        const file = decodeURIComponent(cand.image!.split("/").pop() ?? "");
        if (COMMONS_ONLY_SKIP.test(`${file} ${cand.label}`) || MONTAGE.test(file)) continue;
        if (EAST_ASIAN.has(periodSlug) && EAST_ASIAN_SKIP.test(`${file} ${cand.label}`)) continue;
        if (haveSlug.has(slugify(cand.label))) continue;
        const ci = await commonsFileInfo(cand.image!);
        if (!ci || ci.width < 600 || haveImage.has(ci.url)) continue;
        haveSlug.add(slugify(cand.label));
        haveImage.add(ci.url);
        paintings.push({
          slug: slugify(cand.label),
          title: cand.label,
          year: cand.year != null && (cand.yearPrecision ?? 9) >= 9 ? cand.year : null,
          imageUrl: ci.url,
          imageWidth: ci.width,
          imageHeight: ci.height,
          story: usableCommonsDescription(ci.description, cand.label),
          facts: [],
          wikipediaUrl: null,
          sitelinks: cand.sitelinks,
        });
      }
    }
  }

  // Dedupe by slug (different Wikidata items can share a display title).
  const seen = new Set<string>();
  paintings = paintings.filter((p) => {
    if (seen.has(p.slug)) return false;
    seen.add(p.slug);
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
    wikiTitle: summary.title,
    qid,
    birthYear: dates.birthYear ?? null,
    deathYear: dates.deathYear ?? null,
    tagline: summary.description ?? "",
    bio: summary.extract,
    portraitUrl: portrait?.url ?? null,
    portraitWidth: portrait?.width ?? null,
    portraitHeight: portrait?.height ?? null,
    wikipediaUrl: summary.content_urls?.desktop?.page ?? null,
    paintings,
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

    for (const artistTitle of period.artists) {
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
        if (!artist) continue;
        artist.periodSlug = period.slug;
        problems.push(`kept the previous entry for ${artistTitle}`);
      }
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
