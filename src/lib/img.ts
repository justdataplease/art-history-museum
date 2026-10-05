import type { Painting } from "./types";

// Client-safe image URL helpers (used by the server page for preload hints
// and by the gallery / timeline in the browser - keep this module pure).

// ---- Wikimedia thumbnails ----------------------------------------------
// upload.wikimedia.org only renders a fixed set of thumbnail widths; any other
// width is HTTP 400. Verified with curl (UA "TimelineMuseum/1.0", Oct 2026):
// 60, 120, 250, 330, 500, 960, 1280, 1920, 3840 -> 200; 400, 640, 800, 1024,
// 1600, 2560 -> 400. Wikimedia now *upscales* when a thumb is wider than the
// original (a 1920 thumb of a 1772 px file is a blurry 1920 px JPEG), so we
// never ask for one: if the original is no wider than the bucket, use the
// original file itself.
export const WIKIMEDIA_THUMB_WIDTHS = [60, 120, 250, 330, 500, 960, 1280, 1920, 3840] as const;

// Formats every browser decodes natively (TIFF / PDF / DjVu / SVG must go through a thumb).
const WEB_FORMAT = /\.(jpe?g|png|gif|webp)$/i;
// "<N>px-", "lossy-page1-<N>px-", "lossless-page1-<N>px-" thumbnail prefixes.
const THUMB_PREFIX = /^((?:lossy-|lossless-)?(?:page\d+-)?)(\d+)px-/;

interface WikiFile {
  u: URL;
  project: string; // commons | en | ...
  hashPath: string; // "a/ab"
  file: string; // URL-encoded file name
  thumbPrefix: string | null; // e.g. "lossless-page1-" when the given URL was such a thumb
}

function parseWikimedia(url: string): WikiFile | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "upload.wikimedia.org") return null;
    // /wikipedia/<project>/thumb/a/ab/File.jpg/<prefix><N>px-File.jpg
    let m = /^\/wikipedia\/([^/]+)\/thumb\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const pm = THUMB_PREFIX.exec(m[4]);
      return { u, project: m[1], hashPath: m[2], file: m[3], thumbPrefix: pm ? pm[1] : null };
    }
    // /wikipedia/<project>/a/ab/File.jpg
    m = /^\/wikipedia\/([^/]+)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/.exec(u.pathname);
    if (m) return { u, project: m[1], hashPath: m[2], file: m[3], thumbPrefix: null };
    return null;
  } catch {
    return null;
  }
}

function thumbOf(f: WikiFile, width: number): string {
  const u = new URL(f.u.toString());
  const suffix = /\.svg$/i.test(f.file) ? ".png" : "";
  const prefix = f.thumbPrefix ?? "";
  // Rasterised paged formats (TIFF/PDF) keep their page prefix and type suffix.
  const tail =
    f.thumbPrefix !== null
      ? f.u.pathname.split("/").pop()!.replace(THUMB_PREFIX, `${prefix}${width}px-`)
      : `${width}px-${f.file}${suffix}`;
  u.pathname = `/wikipedia/${f.project}/thumb/${f.hashPath}/${f.file}/${tail}`;
  return u.toString();
}

function originalOf(f: WikiFile): string {
  const u = new URL(f.u.toString());
  u.pathname = `/wikipedia/${f.project}/${f.hashPath}/${f.file}`;
  return u.toString();
}

/**
 * The upload.wikimedia.org URL that is at least `width` px wide (the smallest
 * allowed thumbnail bucket >= width) - or, when the original is not wider than
 * that bucket, the original file. Never upscales, never returns less than the
 * requested width when the original has it. Non-Wikimedia URLs pass through.
 */
export function wikiThumb(url: string, width: number, originalWidth?: number | null): string {
  const f = parseWikimedia(url);
  if (!f) return url;
  const max = WIKIMEDIA_THUMB_WIDTHS[WIKIMEDIA_THUMB_WIDTHS.length - 1];
  const bucket = WIKIMEDIA_THUMB_WIDTHS.find((b) => b >= width) ?? max;
  const vector = /\.svg$/i.test(f.file);
  if (!vector && originalWidth && originalWidth > 0 && originalWidth <= bucket) {
    // A thumb this wide would be an upscale: serve the file itself when the
    // browser can decode it, else the largest thumb that is still a downscale.
    if (WEB_FORMAT.test(decodeURIComponent(f.file))) return originalOf(f);
    const below = WIKIMEDIA_THUMB_WIDTHS.filter((b) => b < originalWidth).pop();
    return below ? thumbOf(f, below) : url;
  }
  return thumbOf(f, bucket);
}

/** `src` / `srcSet` for an <img> shown at `cssPx` wide: 1x and 2x buckets. */
export function wikiSrcSet(
  url: string,
  cssPx: number,
  originalWidth?: number | null
): { src: string; srcSet: string | undefined } {
  const x1 = wikiThumb(url, cssPx, originalWidth);
  const x2 = wikiThumb(url, cssPx * 2, originalWidth);
  return { src: x1, srcSet: x1 === x2 ? undefined : `${x1} 1x, ${x2} 2x` };
}

// ---- painting textures -------------------------------------------------
// One place decides which URL a painting texture is fetched from, so the
// server page can emit preload hints for exactly what the gallery requests.
//
// Textures load straight from upload.wikimedia.org (CORS: *). Proxying them
// through Next's image optimizer was measured and rejected: the optimizer
// fetches upstream with Node's default "node" User-Agent, which Wikimedia
// answers with "429 Your request does not comply with our robot policy"
// (10 of 12 cold textures failed), and next.config cannot set that header.

// Viewing model for wall textures. The gallery renders at dpr <= 1.75 with a
// 62 deg vertical fov; a ~1.5x display gives a framebuffer ~1000-1400 px tall,
// and the view spans 2*d*tan(31 deg) = 1.2*d metres, so a visitor 1.5-2 m from
// the wall resolves roughly 450-780 px per metre. Texels beyond that are only
// ever minified (and cost bytes, decode time and VRAM).
const WALL_PX_PER_M = 700;
const WALL_MIN_PX = 500;
const WALL_MAX_PX = 1280;
// A bucket may undershoot the target by this much before we step up to the
// next (much larger) one: Wikimedia's buckets jump 500 -> 960 -> 1280.
const WALL_UNDERSHOOT = 0.8;
// Inspect textures: as large as the source allows, but the long side stays
// within 4096 px (texture size every WebGL2 GPU we target handles, ~90 MB of
// VRAM with mipmaps at most).
const INSPECT_MAX_LONG_SIDE = 4096;

function aspectOf(p: Painting): number {
  if (p.imageWidth && p.imageHeight) return p.imageWidth / p.imageHeight;
  if (p.widthCm && p.heightCm) return p.widthCm / p.heightCm;
  return 0.8;
}

/** Approximate width (m) the work hangs at: its real size (Wikidata), else the gallery's aspect heuristic. */
function wallWidthM(p: Painting): number {
  if (p.widthCm && p.widthCm > 0) return Math.max(0.25, p.widthCm / 100);
  const aspect = aspectOf(p);
  if (aspect >= 1.4) return Math.min(2.9, 1.1 * aspect + 0.6);
  return (aspect < 0.8 ? 1.75 : 1.55) * aspect;
}

/**
 * Texture width (px) to hang a work at while walking the hall: size-aware
 * (a 39 cm Vermeer needs far fewer texels than a 4 m Rembrandt), snapped to a
 * Wikimedia thumbnail bucket, 500-1280 px.
 */
export function wallTexturePx(p: Painting): number {
  const target = Math.min(WALL_MAX_PX, Math.max(WALL_MIN_PX, wallWidthM(p) * WALL_PX_PER_M));
  return (
    WIKIMEDIA_THUMB_WIDTHS.find((b) => b >= target * WALL_UNDERSHOOT && b <= WALL_MAX_PX) ?? WALL_MAX_PX
  );
}

/**
 * Texture width (px) to stream in when the work is inspected up close: the
 * whole original when it fits (long side <= 4096), else the largest
 * Wikimedia bucket that does (3840 / 1920 ...).
 */
export function inspectTexturePx(p: Painting): number {
  const wall = wallTexturePx(p);
  const ow = p.imageWidth ?? 0;
  if (ow <= 0) return Math.max(wall, 1920);
  const maxW = Math.min(3840, Math.floor(INSPECT_MAX_LONG_SIDE * Math.min(1, aspectOf(p))));
  if (ow <= maxW) return Math.max(wall, ow); // wikiThumb serves the original file for this
  const bucket = [...WIKIMEDIA_THUMB_WIDTHS].reverse().find((b) => b <= maxW) ?? wall;
  return Math.max(wall, bucket);
}

/** The URL a painting texture of (at least) `px` wide is fetched from. */
export function paintingTextureUrl(p: Painting, px: number): string {
  return wikiThumb(p.imageUrl, px, p.imageWidth);
}
