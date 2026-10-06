// Ingest all museum content from Wikipedia / Wikidata / Wikimedia Commons.
// Writes data/cache/museum.json plus a report of anything thin or missing.
// Re-runnable: per-artist results are cached in data/cache/artists/.

import fs from "node:fs";
import path from "node:path";
import { EXTRA_PAINTINGS, PERIODS } from "./seed";
import { enrichArtists } from "./lib/enrich";
import { cleanArtistName, decodeEntities } from "../src/lib/text";
import {
  createLimiter,
  extractFacts,
  fetchJson,
  getCategoryMembers,
  getPaintingsByArtist,
  getPlainExtract,
  getSummary,
  getWikidataDates,
} from "./lib/wiki";

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, "data", "cache");
const ARTIST_CACHE = path.join(CACHE, "artists");
fs.mkdirSync(ARTIST_CACHE, { recursive: true });

const wikiLimit = createLimiter(5);
const sparqlLimit = createLimiter(1);

const MIN_PAINTINGS = 8;
const MAX_PAINTINGS = 12;

export interface PaintingOut {
  slug: string;
  title: string;
  year: number | null;
  imageUrl: string;
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
    url: info.url,
    width: info.width,
    height: info.height,
    description: desc ? stripHtml(desc) : "",
  };
}

// Build a PaintingOut from a Wikipedia article title (image required).
// Mutates `have` with the slugs it claims so callers can dedupe.
async function fetchArticlePainting(
  title: string,
  have: Set<string>
): Promise<PaintingOut | null> {
  const tSlug = slugify(title.replace(/\s*\([^)]*\)\s*$/, ""));
  if (have.has(tSlug) || have.has(slugify(title))) return null;
  const ps = await wikiLimit(() => getSummary(title));
  if (!ps?.originalimage) return null;
  const slug = slugify(ps.title);
  if (have.has(slug)) return null;
  // Guard against redirects that land on a non-painting page (e.g. a road).
  if (!/painting|portrait|panel|canvas|mural|drawing|art\b/i.test(ps.extract.slice(0, 300)))
    return null;
  const full = await wikiLimit(() => getPlainExtract(ps.title));
  const facts = full ? extractFacts(full, ps.extract) : [];
  let year: number | null = null;
  const m = /\b(1[2-9]\d{2}|20[0-2]\d)\b/.exec(ps.extract);
  if (m) year = parseInt(m[1], 10);
  have.add(slug);
  have.add(tSlug);
  return {
    slug,
    title: ps.displaytitle ? stripHtml(ps.displaytitle) : ps.title,
    year,
    imageUrl: ps.originalimage.source,
    imageWidth: ps.originalimage.width,
    imageHeight: ps.originalimage.height,
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
  if (fs.existsSync(cacheFile)) {
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
  if (qid) {
    const candidates = await sparqlLimit(() => getPaintingsByArtist(qid));
    const withArticle = candidates.filter((c) => c.article);
    const imageOnly = candidates.filter((c) => !c.article && c.image);

    for (const cand of withArticle) {
      if (paintings.length >= MAX_PAINTINGS) break;
      const ps = await wikiLimit(() => getSummary(cand.article!));
      if (!ps) continue;
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
      if (!imageUrl) continue;
      const full = await wikiLimit(() => getPlainExtract(cand.article!));
      const facts = full ? extractFacts(full, ps.extract) : [];
      let year = cand.year ?? null;
      if (year == null) {
        const m = /\b(1[2-9]\d{2}|20[0-2]\d)\b/.exec(ps.extract);
        if (m) year = parseInt(m[1], 10);
      }
      paintings.push({
        slug: slugify(ps.title),
        title: ps.displaytitle ? stripHtml(ps.displaytitle) : ps.title,
        year,
        imageUrl,
        imageWidth: w,
        imageHeight: h,
        story: ps.extract,
        facts,
        wikipediaUrl: ps.content_urls?.desktop?.page ?? null,
        sitelinks: cand.sitelinks,
      });
    }

    // Hand-curated catch-up titles for artists with patchy Wikidata coverage.
    {
      const have = new Set(paintings.map((p) => p.slug));
      for (const title of EXTRA_PAINTINGS[summary.title] ?? []) {
        if (paintings.length >= MAX_PAINTINGS) break;
        const p = await fetchArticlePainting(title, have);
        if (p) paintings.push(p);
      }
    }

    // Top up from the enwiki "Paintings by X" category (catches works whose
    // Wikidata items aren't linked to the artist or lack P31=painting).
    if (paintings.length < MIN_PAINTINGS + 2) {
      const have = new Set(paintings.map((p) => p.slug));
      const titles = await wikiLimit(() =>
        getCategoryMembers(`Category:Paintings by ${summary.title}`)
      );
      for (const title of titles) {
        if (paintings.length >= MAX_PAINTINGS) break;
        if (/^List of/i.test(title)) continue;
        const p = await fetchArticlePainting(title, have);
        if (p) paintings.push(p);
      }
    }

    // Top up with Commons-only paintings (image + verbatim Commons description).
    if (paintings.length < MIN_PAINTINGS) {
      for (const cand of imageOnly) {
        if (paintings.length >= MIN_PAINTINGS + 2) break;
        const ci = await commonsFileInfo(cand.image!);
        if (!ci || ci.width < 600) continue;
        paintings.push({
          slug: slugify(cand.label),
          title: cand.label,
          year: cand.year ?? null,
          imageUrl: ci.url,
          imageWidth: ci.width,
          imageHeight: ci.height,
          story: ci.description,
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

async function main() {
  const periodsOut = [];
  const artistsOut: ArtistOut[] = [];
  const problems: string[] = [];

  for (const period of PERIODS) {
    console.log(`\n== ${period.name} ==`);
    const ps = await wikiLimit(() => getSummary(period.wikiTitle));
    periodsOut.push({
      slug: period.slug,
      name: period.name,
      startYear: period.startYear,
      endYear: period.endYear,
      color: period.color,
      description: ps?.extract ?? "",
      wikipediaUrl: ps?.content_urls?.desktop?.page ?? null,
    });
    if (!ps) problems.push(`period summary missing: ${period.wikiTitle}`);

    for (const artistTitle of period.artists) {
      try {
        const artist = await ingestArtist(artistTitle, period.slug);
        if (!artist) {
          problems.push(`artist missing: ${artistTitle}`);
          continue;
        }
        artistsOut.push(artist);
        if (artist.paintings.length < MIN_PAINTINGS)
          problems.push(
            `thin gallery: ${artist.name} has ${artist.paintings.length} paintings`
          );
        if (!artist.portraitUrl) problems.push(`no portrait: ${artist.name}`);
        if (!artist.birthYear) problems.push(`no birth year: ${artist.name}`);
      } catch (err) {
        problems.push(`artist failed: ${artistTitle}: ${err}`);
        console.error(`!! ${artistTitle} failed`, err);
      }
    }
  }

  // Physical size (Wikidata P2049/P2048), 12-month pageviews, Wikidata item,
  // year sanity — same pass as `npm run enrich`.
  console.log("\n== Enrich (Wikidata dimensions + pageviews) ==");
  const enrich = await enrichArtists(artistsOut);
  for (const r of enrich.failures) problems.push(`enrich: ${r}`);
  for (const r of enrich.removed) problems.push(`removed (by another artist): ${r}`);
  for (const r of enrich.yearChanges) problems.push(`year: ${r}`);
  for (const r of enrich.imageChanges) problems.push(`image re-uploaded: ${r}`);
  problems.push(
    `enrich coverage: dimensions ${enrich.withBothDims}/${enrich.paintings}, pageviews ${enrich.withPageviews}/${enrich.paintings}`
  );
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
