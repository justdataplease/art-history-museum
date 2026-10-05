// Enrich the ingest cache with real reference data from Wikidata / Wikimedia:
// physical size (widthCm / heightCm), 12-month enwiki pageviews and the
// painting's Wikidata item (qid). Re-runnable: pageviews are refreshed on
// every run; a failed lookup never overwrites values from an earlier run.
//
//   npm run enrich                # update data/cache/museum.json + data/cache/artists/*.json
//   npm run enrich -- --dry-run   # fetch and report, write nothing
//   npm run enrich -- --keep-years    # don't repair out-of-lifetime years
//   npm run enrich -- --keep-foreign  # don't drop works Wikidata + title attribute to another artist
//
// Only the new fields change, plus (unless disabled) out-of-lifetime years and
// works by another artist; everything else is written back unchanged in the
// same JSON layout.

import fs from "node:fs";
import path from "node:path";
import { enrichArtists, type EnrichableArtist, type EnrichablePainting } from "./lib/enrich";

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, "data", "cache");
const ARTIST_CACHE = path.join(CACHE, "artists");
const MUSEUM = path.join(CACHE, "museum.json");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const fixYears = !args.has("--keep-years");
const dropForeign = !args.has("--keep-foreign");

const ENRICHED = ["widthCm", "heightCm", "pageviews", "qid"] as const;
const key = (artistSlug: string, p: EnrichablePainting) => `${artistSlug}\u0000${p.slug}\u0000${p.imageUrl}`;

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}
function writeJson(file: string, data: unknown) {
  // Same layout ingest.ts writes (2-space indent, no trailing newline).
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function main() {
  if (!fs.existsSync(MUSEUM)) {
    console.error("No ingest cache found. Run `npm run ingest` first.");
    process.exit(1);
  }
  const museum = readJson<{ artists: EnrichableArtist[] }>(MUSEUM);
  const cacheFiles = fs.existsSync(ARTIST_CACHE)
    ? fs.readdirSync(ARTIST_CACHE).filter((f) => f.endsWith(".json"))
    : [];
  const cached = cacheFiles.map((f) => ({ file: path.join(ARTIST_CACHE, f), artist: readJson<EnrichableArtist>(path.join(ARTIST_CACHE, f)) }));

  // Enrich each distinct painting once: the per-artist caches, plus any
  // museum.json painting that has no identical counterpart in them.
  const targets: EnrichableArtist[] = cached.map((c) => c.artist);
  const known = new Set(targets.flatMap((a) => a.paintings.map((p) => key(a.slug, p))));
  for (const a of museum.artists) {
    const extra = a.paintings.filter((p) => !known.has(key(a.slug, p)));
    if (extra.length) targets.push({ ...a, paintings: extra });
  }

  const report = await enrichArtists(targets, { fixYears, dropForeign });

  // Propagate onto museum.json (same painting objects where they were enriched directly).
  const byKey = new Map<string, EnrichablePainting>();
  for (const a of targets) for (const p of a.paintings) byKey.set(key(a.slug, p), p);
  const removed = new Set(report.removed);
  for (const a of museum.artists) {
    a.paintings = a.paintings.filter((p) => !removed.has(`${a.slug}/${p.slug}`));
    for (const p of a.paintings) {
      const src = byKey.get(key(a.slug, p));
      if (!src || src === p) continue;
      const rec = p as unknown as Record<string, unknown>;
      p.year = src.year;
      for (const k of ENRICHED) {
        delete rec[k];
        rec[k] = (src as unknown as Record<string, unknown>)[k] ?? null;
      }
    }
  }

  // Coverage over the live collection (museum.json), plus the run summary.
  const live = museum.artists.flatMap((a) => a.paintings);
  const coverage = {
    paintings: live.length,
    withQid: live.filter((p) => p.qid).length,
    withBothDims: live.filter((p) => p.widthCm != null && p.heightCm != null).length,
    withAnyDim: live.filter((p) => p.widthCm != null || p.heightCm != null).length,
    withPageviews: live.filter((p) => p.pageviews != null).length,
  };

  console.log("\nRun:", {
    paintings: report.paintings,
    withArticle: report.withArticle,
    withQid: report.withQid,
    qidFromImage: report.qidFromImage,
    withBothDims: report.withBothDims,
    withPageviews: report.withPageviews,
  });
  console.log("museum.json coverage:", coverage);
  if (report.rejectedDims.length) {
    console.log(`\nDimension notes (transposed / rejected / partial) (${report.rejectedDims.length}):`);
    for (const r of report.rejectedDims) console.log("  - " + r);
  }
  if (report.yearChanges.length) {
    console.log(`\nYear repairs (${report.yearChanges.length}):`);
    for (const r of report.yearChanges) console.log("  - " + r);
  }
  if (report.removed.length) {
    console.log(`\nRemoved, attributed to another artist (${report.removed.length}):`);
    for (const r of report.removed) console.log("  - " + r);
  }
  if (report.creatorMismatch.length) {
    console.log(`\nCreator mismatches, flagged only (${report.creatorMismatch.length}):`);
    for (const r of report.creatorMismatch) console.log("  - " + r);
  }
  if (report.failures.length) {
    console.log(`\nFailures (${report.failures.length}) - earlier values kept:`);
    for (const r of report.failures) console.log("  - " + r);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written");
    return;
  }
  for (const c of cached) writeJson(c.file, c.artist);
  writeJson(MUSEUM, museum);
  writeJson(path.join(CACHE, "enrich-report.json"), { ...report, coverage });
  console.log(`\nWrote ${cached.length} artist caches, museum.json and enrich-report.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
