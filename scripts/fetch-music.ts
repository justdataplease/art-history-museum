// Mirror the gallery music into public/audio/ so the site serves it itself.
//
// For every track in src/components/museum/music.ts: download the original
// upload from Wikimedia Commons (the best-quality source), loudness-normalise
// it (EBU R128, so every room plays at the same level) and encode it to AAC
// (.m4a, 96 kb/s stereo, faststart). MuseumAudio plays the local file first
// and falls back to Commons. Also writes public/audio/CREDITS.md — the CC BY
// and CC BY-SA licences require the attribution to travel with the files.
//
//   npm run fetch-music            # skips files that already exist
//   npm run fetch-music -- --force # re-encode everything
//   npm run fetch-music -- --credits-only # only rewrite public/audio/CREDITS.md
//
// Needs ffmpeg with the native "aac" encoder (FFMPEG=/path/to/ffmpeg in the
// environment or .env.local, else ffmpeg on PATH). Each file is encoded to a
// temporary name and renamed when complete, so an interrupted run never
// leaves a truncated .m4a that a later run would take as done.

import "./lib/env"; // .env.local (FFMPEG, WIKI_USER_AGENT) before they are read
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ERA_MUSIC, licenseUrl, localAudioFile, type Track } from "../src/components/museum/music";
import { UA, sleep } from "./lib/wiki";

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public", "audio");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const force = process.argv.includes("--force");
const creditsOnly = process.argv.includes("--credits-only");

async function download(url: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (res.ok) {
      fs.writeFileSync(to, Buffer.from(await res.arrayBuffer()));
      return;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new Error(`${res.status} for ${url}`);
  }
}

function credit(t: Track): string {
  const by = t.performer ? ` — ${t.performer}` : "";
  const url = licenseUrl(t.license);
  const lic = url ? `[${t.license}](${url})` : t.license;
  return `- \`${localAudioFile(t)}\`: ${t.composer}, *${t.title}*${by}. ${lic}. Source: ${t.page}`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "museum-audio-"));
  const unique = new Map<string, Track>();
  for (const tracks of Object.values(ERA_MUSIC)) for (const t of tracks) unique.set(t.original, t);

  let done = 0;
  for (const t of unique.values()) {
    const target = path.join(OUT, localAudioFile(t));
    if (creditsOnly || (!force && fs.existsSync(target))) {
      done++;
      continue;
    }
    const src = path.join(tmp, path.basename(new URL(t.original).pathname));
    // ffmpeg picks the container from the extension: keep ".m4a" last
    const partial = path.join(tmp, `partial-${localAudioFile(t)}`);
    console.log(`↓ ${t.composer} — ${t.title}`);
    await download(t.original, src);
    execFileSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", src,
      "-vn", "-map_metadata", "-1",
      "-af", "loudnorm=I=-20:TP=-2:LRA=11",
      "-ar", "44100", "-ac", "2",
      "-c:a", "aac", "-b:a", "96k",
      "-movflags", "+faststart",
      "-metadata", `title=${t.title}`,
      "-metadata", `artist=${t.performer ?? t.composer}`,
      "-metadata", `composer=${t.composer}`,
      "-metadata", `copyright=${t.license} — ${t.page}`,
      partial,
    ]);
    // rename is atomic on the same volume; across volumes (tmpdir on another
    // drive) copy to a sibling temp name first, then rename into place
    try {
      fs.renameSync(partial, target);
    } catch {
      const sibling = `${target}.partial`;
      fs.copyFileSync(partial, sibling);
      fs.renameSync(sibling, target);
      fs.rmSync(partial, { force: true });
    }
    fs.rmSync(src, { force: true });
    done++;
    console.log(`  → ${path.relative(ROOT, target)} (${(fs.statSync(target).size / 1e6).toFixed(1)} MB)`);
    await sleep(500);
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  const lines = [...unique.values()].map(credit);
  fs.writeFileSync(
    path.join(OUT, "CREDITS.md"),
    `# Gallery music\n\nRecordings mirrored from Wikimedia Commons by \`npm run fetch-music\`\n` +
      `(loudness-normalised and re-encoded to AAC; otherwise unmodified). Each file\n` +
      `keeps the licence of its source recording — attribution below.\n\n${lines.join("\n")}\n`
  );
  const total = fs.readdirSync(OUT).filter((f) => f.endsWith(".m4a")).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`\n${done}/${unique.size} tracks in public/audio (${(total / 1e6).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
