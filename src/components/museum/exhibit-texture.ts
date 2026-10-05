// Painting texture loading for the exhibits.
//
// - Decodes off the main thread: fetch → blob → createImageBitmap (flipY and
//   premultiply handled by the decoder, so the GPU upload is a plain copy).
//   Falls back to an <img> when createImageBitmap is unavailable.
// - Every texture is fully configured (colour space, anisotropy, filtering)
//   before its one and only upload.
// - Uploads are staggered: one gl.initTexture per animation frame, so twelve
//   paintings arriving together don't stall a single frame.
// - Ref-counted cache with a short release delay: StrictMode's double effects
//   and quick back-navigation reuse the decoded image; unused textures are
//   disposed (and their bitmaps closed) shortly after the last user leaves.
// - Failures reject (no Suspense, no thrown render errors) and are not cached,
//   so a later visit retries.

import * as THREE from "three";

interface Entry {
  refs: number;
  promise: Promise<THREE.Texture>;
  texture: THREE.Texture | null;
  bitmap: ImageBitmap | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry>();
const RELEASE_DELAY_MS = 4000;

export interface LoadOptions {
  /** Report progress to three's DefaultLoadingManager (drei useProgress). */
  track?: boolean;
  /** Longest side allowed (renderer maxTextureSize); larger images are downscaled while decoding. */
  maxSize?: number;
  anisotropy?: number;
}

function hasBitmapDecode(): boolean {
  return typeof createImageBitmap === "function" && typeof fetch === "function";
}

async function decodeBitmap(url: string, maxSize: number): Promise<ImageBitmap> {
  const res = await fetch(url, { mode: "cors", credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  const blob = await res.blob();
  const opts: ImageBitmapOptions = {
    imageOrientation: "flipY",
    premultiplyAlpha: "none",
    colorSpaceConversion: "default",
  };
  let bmp = await createImageBitmap(blob, opts);
  const long = Math.max(bmp.width, bmp.height);
  if (long > maxSize) {
    // Downscale off-thread rather than letting three resize on a 2D canvas.
    const s = maxSize / long;
    const resized = await createImageBitmap(bmp, {
      resizeWidth: Math.max(1, Math.floor(bmp.width * s)),
      resizeHeight: Math.max(1, Math.floor(bmp.height * s)),
      resizeQuality: "high",
      premultiplyAlpha: "none",
    });
    bmp.close();
    bmp = resized;
  }
  return bmp;
}

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      // make sure the pixels are decoded before the upload touches them
      (img.decode ? img.decode() : Promise.resolve()).then(() => resolve(img), () => resolve(img));
    };
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

/** Did the server page emit `<link rel=preload as=image>` for this URL? Then reuse that response. */
function hasImagePreload(url: string): boolean {
  try {
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]');
    for (const l of links) if (l.href === url || l.getAttribute("href") === url) return true;
  } catch {
    /* ignore */
  }
  return false;
}

async function decodeSource(url: string, maxSize: number): Promise<ImageBitmap | HTMLImageElement> {
  if (!hasBitmapDecode()) return decodeImage(url);
  if (!hasImagePreload(url)) return decodeBitmap(url, maxSize);
  // An image preload only matches an <img> request: load through one, then
  // convert to a flipped bitmap so the upload stays a plain copy.
  const img = await decodeImage(url);
  try {
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    const s = long > maxSize ? maxSize / long : 1;
    return await createImageBitmap(img, {
      imageOrientation: "flipY",
      premultiplyAlpha: "none",
      colorSpaceConversion: "default",
      ...(s < 1
        ? {
            resizeWidth: Math.max(1, Math.floor(img.naturalWidth * s)),
            resizeHeight: Math.max(1, Math.floor(img.naturalHeight * s)),
            resizeQuality: "high" as const,
          }
        : {}),
    });
  } catch {
    return img;
  }
}

function makeTexture(src: ImageBitmap | HTMLImageElement, anisotropy: number): THREE.Texture {
  const t = new THREE.Texture(src as unknown as HTMLImageElement);
  // ImageBitmaps were flipped by the decoder; <img> sources flip on upload.
  t.flipY = !(typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** Load (or reuse) the texture for `url`. Pair every call with releaseTexture(url). */
export function acquireTexture(url: string, opts: LoadOptions = {}): Promise<THREE.Texture> {
  const existing = entries.get(url);
  if (existing) {
    existing.refs++;
    if (existing.timer) {
      clearTimeout(existing.timer);
      existing.timer = null;
    }
    return existing.promise;
  }
  const manager = THREE.DefaultLoadingManager;
  const track = !!opts.track;
  if (track) manager.itemStart(url);
  const entry: Entry = { refs: 1, promise: null as unknown as Promise<THREE.Texture>, texture: null, bitmap: null, timer: null };
  entry.promise = (async () => {
    try {
      const maxSize = opts.maxSize ?? 4096;
      const src = await decodeSource(url, maxSize);
      if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) entry.bitmap = src;
      const tex = makeTexture(src, opts.anisotropy ?? 8);
      tex.name = url;
      entry.texture = tex;
      if (track) manager.itemEnd(url);
      if (entries.get(url) !== entry) {
        // Everyone let go (and the entry was evicted) while it was loading.
        tex.dispose();
        entry.bitmap?.close();
        entry.texture = null;
        entry.bitmap = null;
      } else if (entry.refs <= 0) {
        scheduleRelease(url, entry);
      }
      return tex;
    } catch (err) {
      if (entries.get(url) === entry) entries.delete(url); // don't cache failures
      if (track) {
        manager.itemError(url);
        manager.itemEnd(url);
      }
      throw err;
    }
  })();
  entries.set(url, entry);
  return entry.promise;
}

function scheduleRelease(url: string, entry: Entry) {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (entry.refs > 0 || entries.get(url) !== entry) return;
    entries.delete(url);
    entry.texture?.dispose();
    entry.bitmap?.close();
    entry.texture = null;
    entry.bitmap = null;
  }, RELEASE_DELAY_MS);
}

export function releaseTexture(url: string): void {
  const entry = entries.get(url);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) scheduleRelease(url, entry);
}

// ------------------------------------------------------- staggered uploads

const queue: (() => void)[] = [];
let pumping = false;

function pump() {
  const job = queue.shift();
  if (job) {
    try {
      job();
    } catch (e) {
      console.error(e);
    }
  }
  if (queue.length) next();
  else pumping = false;
}

function next() {
  // rAF paces uploads to frames; the timeout keeps the queue moving in a
  // hidden/background tab where rAF is paused.
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    pump();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(go);
  setTimeout(go, 120);
}

/** Run `job` (typically gl.initTexture + setState) on a later frame, one job per frame. */
export function scheduleUpload(job: () => void): void {
  queue.push(job);
  if (!pumping) {
    pumping = true;
    next();
  }
}

// ------------------------------------------------------------ placeholder

let placeholder: THREE.DataTexture | null = null;
/** Neutral 1×1 ground shown until (or instead of, on failure) the painting loads. */
export function placeholderTexture(): THREE.DataTexture {
  if (placeholder) return placeholder;
  const t = new THREE.DataTexture(new Uint8Array([112, 106, 97, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  placeholder = t;
  return t;
}
