import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/** The hosts the artists' films stream from (archive/site.py: data/site/film-hosts.json); none without it. */
function filmHosts(): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "site", "film-hosts.json"), "utf8"));
    return Array.isArray(list) ? list.filter((h): h is string => typeof h === "string" && /^[a-z0-9.-]+$/i.test(h)) : [];
  } catch {
    return [];
  }
}

const isDev = process.env.NODE_ENV === "development";

// Static Content-Security-Policy (no nonces: a nonce forces every page to
// render dynamically, which would undo the prerendered/ISR galleries).
// - images, portraits and painting textures (fetch -> connect-src): Wikimedia.
//   upload.wikimedia.org can answer a thumbnail request with a redirect to
//   thumb.wikimedia.org (same files, CORS-enabled), so both hosts are allowed.
// - media: the gallery music is served from /audio (public/), with Commons as
//   a fallback (MuseumAudio)
// - 'unsafe-eval' only in dev (React's dev tooling); 'unsafe-inline' scripts
//   are required for Next's inline RSC payload without nonces.
// - works only WikiArt has (archive/site.py) load from its image hosts,
//   uploads0..uploads8.wikiart.org (CORS: *).
const WIKIMEDIA = "https://upload.wikimedia.org https://thumb.wikimedia.org";
const WIKIART = "https://*.wikiart.org";
// the galleries' screening rooms (src/components/cinema): films play from where they live. Projected: ERT's archive
// (HLS, fetched by hls.js), Wikimedia Commons and the Internet Archive; embedded: the video sites' own players.
const FILM_MEDIA = [
  "https://mediastream.ert.gr https://archive.org https://*.archive.org",
  // and wherever else a film found through the artists' articles plays from (archive/site.py writes the list)
  ...filmHosts().map((h) => `https://${h}`),
].join(" ");
const FILM_FRAMES = "https://www.youtube-nocookie.com https://player.vimeo.com https://www.dailymotion.com https://geo.dailymotion.com";
// the audio guide's natural voice (src/components/museum/voice): the model runs in the visitor's browser, its code
// from jsdelivr, its weights and voices from Hugging Face (WebAssembly needs 'wasm-unsafe-eval')
const VOICE_CODE = "https://cdn.jsdelivr.net";
const VOICE_DATA = "https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${VOICE_CODE}${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${WIKIMEDIA} ${WIKIART}`,
  `media-src 'self' blob: https://upload.wikimedia.org ${FILM_MEDIA}`,
  `connect-src 'self' ${WIKIMEDIA} ${WIKIART} ${FILM_MEDIA} ${VOICE_DATA}`,
  `frame-src ${FILM_FRAMES}`,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,

  // Read by path at run time, so the standalone trace would miss them: the custom rooms' index (src/lib/rooms.ts;
  // the timeline reads its artists' nationalities too, src/lib/data.ts) and the audio guide's scripts
  // (archive/guide.py, served by /api/guide/<artist>). Written by archive/site.py, archive/guide.py and archive/phases.py;
  // data/site/museum.json is traced from src/lib/data.ts.
  outputFileTracingIncludes: {
    "/": ["./data/site/rooms.json"],
    "/room": ["./data/site/rooms.json"],
    "/rooms": ["./data/site/rooms.json"],
    "/api/room": ["./data/site/rooms.json"],
    "/api/room/works": ["./data/site/rooms.json"],
    "/api/guide/*": ["./data/site/guide/*.json"],
    // an artist's phases (archive/phases.py, src/lib/phases.ts) when a gallery regenerates; a work's details
    // for the inspect panel (/api/work/<artist>/<work>, src/lib/rooms.ts workAbout)
    "/museum/*": ["./data/site/phases.json"],
    "/api/work/*/*": ["./data/site/rooms.json"],
  },

  // No images config: painting textures and portraits load straight from
  // upload.wikimedia.org (see src/lib/img.ts for why they are not proxied
  // through /_next/image).

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
