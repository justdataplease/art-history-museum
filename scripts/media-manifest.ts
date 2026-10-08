// Every upload.wikimedia.org URL the museum can request, computed with the
// site's own helpers (src/lib/img.ts): the links the warehouse keeps
// (wikipedia.media) and what a mirror would copy.
//
//   npx tsx scripts/media-manifest.ts <out.tsv>
//
// One line per work (or portrait) and use, tab-separated:
//   artist_slug, work_slug (empty for a portrait), kind, url, bytes
// Kinds: thumb and thumb_flagship (rooms away), wall, near (close), inspect
// (desktop GPU) and inspect_touch, original (the file itself; bytes is its
// recorded size), portrait_<css px> and portrait_<css px>_2x. The same URL
// can serve several kinds.

import fs from "node:fs";
import path from "node:path";
import type { Artist, Painting } from "../src/lib/types";
import {
  FLAGSHIP_THUMB_PX,
  THUMB_PX,
  inspectTexturePx,
  nearTexturePx,
  paintingTextureUrl,
  wallTexturePx,
  wikiThumb,
} from "../src/lib/img";

type CachedArtist = Artist & { paintings: Painting[] };

const out = process.argv[2];
if (!out) throw new Error("usage: tsx scripts/media-manifest.ts <out.tsv>");

const museum = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "wikipedia", "museum.json"), "utf8"),
) as { artists: CachedArtist[] };

const lines: string[] = [];
const counts: Record<string, number> = {};
const add = (artist: string, work: string, kind: string, url: string | null | undefined, bytes: number | null = null) => {
  if (!url || !url.startsWith("https://upload.wikimedia.org/")) return;
  lines.push([artist, work, kind, url, bytes ?? ""].join("\t"));
  counts[kind] = (counts[kind] ?? 0) + 1;
};

for (const a of museum.artists) {
  if (a.portraitUrl) {
    for (const css of [30, 52, 200]) {
      add(a.slug, "", `portrait_${css}`, wikiThumb(a.portraitUrl, css, a.portraitWidth));
      add(a.slug, "", `portrait_${css}_2x`, wikiThumb(a.portraitUrl, css * 2, a.portraitWidth));
    }
  }
  for (const p of a.paintings) {
    if (!p.imageUrl || p.copyrighted) continue;
    add(a.slug, p.slug, "thumb", paintingTextureUrl(p, THUMB_PX));
    add(a.slug, p.slug, "thumb_flagship", paintingTextureUrl(p, FLAGSHIP_THUMB_PX));
    add(a.slug, p.slug, "wall", paintingTextureUrl(p, wallTexturePx(p)));
    add(a.slug, p.slug, "near", paintingTextureUrl(p, nearTexturePx(p)));
    add(a.slug, p.slug, "inspect", paintingTextureUrl(p, inspectTexturePx(p, 6144)));
    add(a.slug, p.slug, "inspect_touch", paintingTextureUrl(p, inspectTexturePx(p, 4096)));
    add(a.slug, p.slug, "original", p.imageUrl, p.imageBytes ?? null);
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, "artist_slug\twork_slug\tkind\turl\tbytes\n" + lines.join("\n") + "\n");
console.log(`${lines.length} links (${new Set(lines.map((l) => l.split("\t")[3])).size} distinct URLs)`, counts);
