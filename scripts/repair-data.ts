// Re-check the cached ingest in place, without re-running the two-hour ingest:
// the same vetting the ingest now applies (scripts/lib/passes.ts), run over
// data/cache/museum.json and every data/cache/artists/*.json.
//
//   npm run repair-data              # fetch, repair, write museum.json + artist caches + reports
//   npm run repair-data -- --dry-run # fetch and report, write nothing
//
// With WIKI_HTTP_CACHE=<dir> the API responses are kept on disk, so a dry run
// followed by the real run asks Wikimedia only once.
//
// What it does (every change is listed in data/cache/repair-report.json):
//   - period descriptions whose seed article changed (scripts/seed.ts)
//   - artist birth / death years: preferred-rank Wikidata statements, never deprecated ones
//   - drops articles that are not artworks (the artist's own biography, sitters,
//     lists, buildings, books, performances) — Wikidata P31 + the lead
//   - images that don't show their work (scripts/lib/vet.ts IMAGE_REVIEW + heuristics)
//   - "© In copyright" on every work by an artist still in copyright
//   - years: decade / century Wikidata dates resolved against the lead; missing
//     years recovered from the lead; years outside the artist's life
//   - Commons-only works: non-English / template / caption descriptions dropped
//   - PDF / DjVu originals replaced by their rendered first page
//   - sizes entered in the wrong unit in Wikidata (checked against the infobox)
//   - imageCredit / portraitCredit (author, licence, file page) on every image
// Everything written is copied from Wikipedia / Wikidata / Commons.

import "./lib/env"; // .env.local (WIKI_USER_AGENT) before anything reads it
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PERIODS } from "./seed";
import type { ArtistOut } from "./ingest";
import { crossCheckSmallDims } from "./lib/enrich";
import { bestTimeYear, getSummary } from "./lib/wiki";
import {
  allImageUrls,
  attachCredits,
  dropNonArtworks,
  dropSeriesRepresentatives,
  fetchClaims,
  metaFor,
  orderArtist,
  repairYears,
  vetCollection,
  type Claims,
} from "./lib/passes";
import type { FileMeta } from "./lib/credits";

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, "data", "cache");
const ARTIST_CACHE = path.join(CACHE, "artists");
const MUSEUM = path.join(CACHE, "museum.json");
const dryRun = process.argv.includes("--dry-run");
const log = (m: string) => console.log(m);

interface Museum {
  generatedAt: string;
  periods: { slug: string; name: string; description: string; wikipediaUrl: string | null }[];
  artists: ArtistOut[];
}

const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(f, "utf8")) as T;
const writeJson = (f: string, d: unknown) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

/** Run every pass over one set of artists; returns the change lists. */
async function repair(
  artists: ArtistOut[],
  claims: Map<string, Claims>,
  dates: Map<string, { birthYear: number | null; deathYear: number | null }>,
  meta: Map<string, FileMeta>
) {
  const changes: Record<string, string[]> = {};
  const add = (k: string, xs: string[]) => (changes[k] = [...(changes[k] ?? []), ...xs]);

  // artist dates first: © labels and year windows depend on them
  for (const a of artists) {
    const d = a.qid ? dates.get(a.qid) : undefined;
    if (!d) continue;
    if (d.birthYear !== a.birthYear || d.deathYear !== a.deathYear) {
      add("artistDates", [`${a.slug}: ${a.birthYear ?? "?"}–${a.deathYear ?? "?"} -> ${d.birthYear ?? "?"}–${d.deathYear ?? "?"}`]);
      a.birthYear = d.birthYear;
      a.deathYear = d.deathYear;
    }
  }
  add("removedNotArtworks", dropNonArtworks(artists, claims));
  const problems: string[] = [];
  const m = await vetCollection(artists, problems);
  add("removedSeriesRepresentatives", dropSeriesRepresentatives(artists, claims));
  for (const [k, v] of m) meta.set(k, v);
  add("images", problems.filter((p) => p.startsWith("image: ")).map((p) => p.slice(7)));
  add("imagesToCheck", problems.filter((p) => p.startsWith("image check: ")).map((p) => p.slice(13)));
  add("nonPaintingImages", problems.filter((p) => p.startsWith("image filter: ")).map((p) => p.slice(14)));
  add("copyrightLabels", problems.filter((p) => p.startsWith("©: ")).map((p) => p.slice(3)));
  add("commonsStories", problems.filter((p) => p.startsWith("commons story: ")).map((p) => p.slice(15)));
  add("pagedImages", problems.filter((p) => p.startsWith("paged image: ")).map((p) => p.slice(13)));
  add("years", repairYears(artists, claims));
  const report = { unitFixes: [] as string[], failures: [] as string[] };
  await crossCheckSmallDims(
    artists.flatMap((a) => a.paintings.map((p) => ({ artistSlug: a.slug, p }))),
    report
  );
  add("sizes", report.unitFixes);
  add("failures", report.failures);
  const credits = attachCredits(artists, await metaFor(allImageUrls(artists), meta, log));
  add("creditsMissing", credits.missing);
  return changes;
}

async function main() {
  const museum = readJson<Museum>(MUSEUM);
  const cacheFiles = fs.readdirSync(ARTIST_CACHE).filter((f) => f.endsWith(".json"));
  const cached = cacheFiles.map((f) => ({ file: path.join(ARTIST_CACHE, f), artist: readJson<ArtistOut>(path.join(ARTIST_CACHE, f)) }));
  const count = (as: ArtistOut[]) => ({
    artists: as.length,
    works: as.reduce((n, a) => n + a.paintings.length, 0),
    withImage: as.reduce((n, a) => n + a.paintings.filter((p) => p.imageUrl).length, 0),
    copyrighted: as.reduce((n, a) => n + a.paintings.filter((p) => p.copyrighted).length, 0),
    withYear: as.reduce((n, a) => n + a.paintings.filter((p) => p.year != null).length, 0),
  });
  const before = count(museum.artists);
  log(`museum.json: ${museum.periods.length} periods, ${before.artists} artists, ${before.works} works`);

  // ---- periods whose seed article differs from the stored one ----
  const periodChanges: string[] = [];
  for (const seed of PERIODS) {
    const p = museum.periods.find((x) => x.slug === seed.slug);
    if (!p) continue;
    const s = await getSummary(seed.wikiTitle);
    const url = s?.content_urls?.desktop?.page ?? null;
    if (!s || !url || url === p.wikipediaUrl) continue;
    periodChanges.push(`${seed.slug}: ${p.wikipediaUrl} -> ${url}`);
    p.description = s.extract;
    p.wikipediaUrl = url;
  }

  // ---- Wikidata: artists' life dates, works' classes and inception ----
  const artistQids = museum.artists.map((a) => a.qid).filter((q): q is string => !!q);
  const workQids = [
    ...museum.artists.flatMap((a) => a.paintings.map((p) => p.qid)),
    ...cached.flatMap((c) => c.artist.paintings.map((p) => p.qid)),
  ].filter((q): q is string => !!q);
  log(`fetching life dates for ${artistQids.length} artists`);
  const artistClaims = await fetchClaims(artistQids, ["P569", "P570"], log);
  const dates = new Map(
    [...artistClaims].map(([q, c]) => [q, { birthYear: bestTimeYear(c, "P569", 0) ?? null, deathYear: bestTimeYear(c, "P570", 0) ?? null }])
  );
  log(`fetching classes + inception for ${new Set(workQids).size} works`);
  const claims = await fetchClaims(workQids, ["P31", "P571", "P179", "P361", "P527"], log);

  // ---- run the passes on museum.json, then on each artist cache ----
  const pre = new Map(museum.artists.map((a) => [a.slug, JSON.stringify(a)]));
  const meta = new Map<string, FileMeta>();
  const changes = await repair(museum.artists, claims, dates, meta);
  museum.artists = museum.artists.map(orderArtist);
  const bySlug = new Map(museum.artists.map((a) => [a.slug, a]));
  const separate: string[] = [];
  for (const c of cached) {
    // identical to its museum.json entry before the repair (the usual case):
    // the cache becomes the repaired entry; otherwise it is repaired on its own
    if (pre.get(c.artist.slug) === JSON.stringify(c.artist)) {
      c.artist = bySlug.get(c.artist.slug)!;
      continue;
    }
    separate.push(c.artist.slug);
    await repair([c.artist], claims, dates, meta);
    c.artist = orderArtist(c.artist);
  }
  const after = count(museum.artists);

  // ---- reports (data/cache/report.json, enrich-report.json, repair-report.json) ----
  const repairReport = {
    generatedAt: new Date().toISOString(),
    before,
    after,
    periods: periodChanges,
    ...changes,
  };
  const problems: string[] = [];
  for (const a of museum.artists) {
    if (a.paintings.length < 8) problems.push(`thin gallery: ${a.name} has ${a.paintings.length} paintings`);
    if (!a.portraitUrl) problems.push(`no portrait: ${a.name}`);
    if (!a.birthYear) problems.push(`no birth year: ${a.name}`);
  }
  const live = museum.artists.flatMap((a) => a.paintings);
  problems.push(
    `licences: ${live.filter((p) => p.copyrighted).length} works labelled © In copyright (${live.filter((p) => p.copyrighted && !p.imageUrl).length} without an image)`,
    `coverage: dimensions ${live.filter((p) => p.widthCm != null && p.heightCm != null).length}/${live.length}, pageviews ${live.filter((p) => p.pageviews != null).length}/${live.length}, credits ${live.filter((p) => p.imageCredit).length}/${live.filter((p) => p.imageUrl).length}`,
    ...(changes.imagesToCheck ?? []).map((r) => `image check: ${r}`),
    ...(changes.failures ?? []).map((r) => `failure: ${r}`)
  );
  const enrichFile = path.join(CACHE, "enrich-report.json");
  const enrich = fs.existsSync(enrichFile) ? readJson<Record<string, any>>(enrichFile) : {};
  const liveKeys = new Set(museum.artists.flatMap((a) => a.paintings.map((p) => `${a.slug}/${p.slug}`)));
  const stillLive = (r: string) => liveKeys.has(r.split(/[ :]/)[0]);
  const enrichOut = {
    ...enrich,
    paintings: live.length,
    withArticle: live.filter((p) => p.wikipediaUrl).length,
    withQid: live.filter((p) => p.qid).length,
    withBothDims: live.filter((p) => p.widthCm != null && p.heightCm != null).length,
    withAnyDim: live.filter((p) => p.widthCm != null || p.heightCm != null).length,
    withPageviews: live.filter((p) => p.pageviews != null).length,
    withImageBytes: live.filter((p) => p.imageBytes != null).length,
    withCredit: live.filter((p) => p.imageCredit).length,
    rejectedDims: (enrich.rejectedDims ?? []).filter(stillLive),
    yearChanges: (enrich.yearChanges ?? []).filter(stillLive),
    creatorMismatch: (enrich.creatorMismatch ?? []).filter(stillLive),
    unitFixes: [...(enrich.unitFixes ?? []), ...(changes.sizes ?? [])],
    repairedAt: repairReport.generatedAt,
  };

  log(`\nbefore: ${JSON.stringify(before)}\nafter:  ${JSON.stringify(after)}`);
  for (const [k, v] of Object.entries({ periods: periodChanges, ...changes })) log(`  ${k}: ${v.length}`);
  if (separate.length) log(`  artist caches that differed from museum.json, repaired on their own: ${separate.join(", ")}`);
  if (dryRun) {
    const tmp = path.join(os.tmpdir(), "museum-repair-report.json");
    writeJson(tmp, repairReport);
    log(`\n--dry-run: nothing written to data/ (change list: ${tmp})`);
    return;
  }
  writeJson(MUSEUM, museum);
  for (const c of cached) writeJson(c.file, c.artist);
  writeJson(path.join(CACHE, "report.json"), problems);
  writeJson(enrichFile, enrichOut);
  writeJson(path.join(CACHE, "repair-report.json"), repairReport);
  log(`\nWrote museum.json, ${cached.length} artist caches, report.json, enrich-report.json, repair-report.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
