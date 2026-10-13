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
//   and quick back-navigation reuse the texture; unused textures are disposed
//   shortly after the last user leaves.
// - A bitmap is closed once it has been uploaded (three's onUpdate): the GPU's
//   copy is the only one kept, not the decoded image as well (as large again,
//   in the page's memory). Such a texture cannot be uploaded again, so it is
//   reused only by a renderer that still holds it; anywhere else (another
//   gallery's renderer, its GPU copy freed, a lost and restored context:
//   PaintingExhibit) it is loaded anew, from the browser's cache.
// - Transient failures (HTTP 429 / 5xx, network errors: Wikimedia answers
//   bursts with 429s) are retried with exponential backoff and jitter,
//   honouring Retry-After when the response exposes it: MAX_ATTEMPTS over
//   roughly a minute and a half. The backoff is kept per URL, not per
//   exhibit, so remounts and other users of the same image wait their turn
//   instead of hammering it. Once the budget is spent the load rejects (no
//   Suspense, no thrown render errors) and is not cached; the next acquire
//   (the visitor coming back) starts a new budget after a short cool-off.
// - A load nobody wants any more (its exhibit unmounted, its tier changed) is
//   aborted after a short grace, which StrictMode's double effects and a quick
//   tier flip back fall within.

import * as THREE from "three";

interface Entry {
  refs: number;
  promise: Promise<THREE.Texture>;
  texture: THREE.Texture | null;
  bitmap: ImageBitmap | null;
  /** The bitmap was closed after its upload: the GPU holds the only copy. */
  closed: boolean;
  /** The image's size (a closed bitmap reads 0 × 0). */
  width: number;
  height: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Aborts the fetch (and any backoff wait) while still loading. */
  abort: AbortController;
  loading: boolean;
  /** A transient failure happened: retries are under way. */
  stalled: boolean;
  stallSubs: Set<() => void>;
}

const entries = new Map<string, Entry>();
const RELEASE_DELAY_MS = 4000;
/** A load whose last user left is aborted after this grace. */
const ABORT_GRACE_MS = 300;

// ---- retry budget, per URL
/** Fetch attempts per approach (the first included). */
const MAX_ATTEMPTS = 6;
/** First backoff step; doubles per failure (3, 6, 12, 24, 48 s; ~1-1.5 min with jitter). */
const BACKOFF_BASE_MS = 3000;
const BACKOFF_MAX_MS = 60000;
/** Wait before a new approach may retry a URL that spent its budget. */
const COOL_OFF_MS = 15000;

interface Backoff {
  failures: number;
  /** performance.now() before which the URL is not fetched again. */
  nextAt: number;
}
const backoff = new Map<string, Backoff>();

export type FetchPriority = "high" | "low" | "auto";

export interface LoadOptions {
  /** Report progress to three's DefaultLoadingManager (drei useProgress). */
  track?: boolean;
  /** Fetch priority hint: the doors' gate works first, far rooms' thumbnails last. */
  priority?: FetchPriority;
  /** Longest side allowed (renderer maxTextureSize); larger images are downscaled while decoding. */
  maxSize?: number;
  anisotropy?: number;
  /** The renderer it is for: a texture whose bitmap is closed is reused only where this still holds it. */
  renderer?: THREE.WebGLRenderer;
}

/** A response that was not ok, with the server's Retry-After (ms) when readable. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
    url: string,
  ) {
    super(`HTTP ${status} loading ${url}`);
  }
}

/** Decoding (not fetching) failed: retrying would not help. */
class DecodeError extends Error {}

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

function isAbort(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "AbortError";
}

function retryable(err: unknown): boolean {
  if (isAbort(err) || err instanceof DecodeError) return false;
  if (err instanceof HttpError) {
    return err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500;
  }
  return true; // a network error (fetch's TypeError, or an <img> error)
}

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function hasBitmapDecode(): boolean {
  return typeof createImageBitmap === "function" && typeof fetch === "function";
}

async function decodeBitmap(
  url: string,
  maxSize: number,
  priority: FetchPriority,
  signal: AbortSignal,
): Promise<ImageBitmap> {
  const res = await fetch(url, { mode: "cors", credentials: "same-origin", priority, signal });
  if (!res.ok) throw new HttpError(res.status, parseRetryAfter(res.headers.get("Retry-After")), url);
  const blob = await res.blob();
  const opts: ImageBitmapOptions = {
    imageOrientation: "flipY",
    premultiplyAlpha: "none",
    colorSpaceConversion: "default",
  };
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, opts);
  } catch (err) {
    throw new DecodeError(`Could not decode ${url}: ${(err as Error)?.message ?? err}`);
  }
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

async function decodeSource(
  url: string,
  maxSize: number,
  priority: FetchPriority,
  signal: AbortSignal,
): Promise<ImageBitmap | HTMLImageElement> {
  if (!hasBitmapDecode()) return decodeImage(url);
  if (!hasImagePreload(url)) return decodeBitmap(url, maxSize, priority, signal);
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

/**
 * Fetch and decode `url`, retrying transient failures within the URL's
 * budget (see the header). Rejects with the last error once it is spent, at
 * once for a permanent one, and with an AbortError when aborted.
 */
async function loadWithRetry(
  url: string,
  maxSize: number,
  priority: FetchPriority,
  signal: AbortSignal,
  onStall: () => void,
): Promise<ImageBitmap | HTMLImageElement> {
  for (let attempt = 1; ; attempt++) {
    const b = backoff.get(url);
    const now = performance.now();
    if (b && b.nextAt > now) await sleep(b.nextAt - now, signal);
    try {
      const src = await decodeSource(url, maxSize, priority, signal);
      backoff.delete(url);
      return src;
    } catch (err) {
      if (signal.aborted || isAbort(err)) throw abortError();
      if (!retryable(err)) throw err;
      const st = backoff.get(url) ?? { failures: 0, nextAt: 0 };
      st.failures++;
      const step = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (st.failures - 1));
      // "equal jitter": half the step fixed, half random
      let wait = step / 2 + Math.random() * (step / 2);
      const ra = err instanceof HttpError ? err.retryAfterMs : null;
      if (ra != null) wait = Math.min(2 * BACKOFF_MAX_MS, Math.max(wait, ra));
      const spent = attempt >= MAX_ATTEMPTS;
      // a spent budget: the next approach starts afresh after a cool-off
      if (spent) st.failures = 0;
      st.nextAt = performance.now() + (spent ? Math.max(COOL_OFF_MS, ra ?? 0) : wait);
      backoff.set(url, st);
      if (spent) throw err;
      onStall();
    }
  }
}

/**
 * Load (or reuse) the texture for `url`. Pair every call with releaseTexture(url).
 * `onStall` fires (once) when a transient failure has the load retrying,
 * so a caller waiting on it can stop waiting while the retries go on.
 */
export function acquireTexture(url: string, opts: LoadOptions = {}, onStall?: () => void): Promise<THREE.Texture> {
  let existing = entries.get(url);
  if (existing?.closed && existing.refs === 0 && opts.renderer && !opts.renderer.properties.has(existing.texture!)) {
    // nothing left to upload it from: loaded anew
    evict(url, existing);
    existing = undefined;
  }
  if (existing) {
    existing.refs++;
    if (existing.timer) {
      clearTimeout(existing.timer);
      existing.timer = null;
    }
    if (onStall) {
      if (existing.stalled && existing.loading) queueMicrotask(onStall);
      else if (existing.loading) existing.stallSubs.add(onStall);
    }
    return existing.promise;
  }
  const manager = THREE.DefaultLoadingManager;
  const track = !!opts.track;
  if (track) manager.itemStart(url);
  const entry: Entry = {
    refs: 1,
    promise: null as unknown as Promise<THREE.Texture>,
    texture: null,
    bitmap: null,
    closed: false,
    width: 0,
    height: 0,
    timer: null,
    abort: new AbortController(),
    loading: true,
    stalled: false,
    stallSubs: new Set(onStall ? [onStall] : []),
  };
  const stall = () => {
    if (entry.stalled) return;
    entry.stalled = true;
    const subs = [...entry.stallSubs];
    entry.stallSubs.clear();
    subs.forEach((cb) => cb());
  };
  entry.promise = (async () => {
    try {
      const maxSize = opts.maxSize ?? 4096;
      const src = await loadWithRetry(url, maxSize, opts.priority ?? "auto", entry.abort.signal, stall);
      entry.loading = false;
      entry.stallSubs.clear();
      if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) entry.bitmap = src;
      const tex = makeTexture(src, opts.anisotropy ?? 8);
      tex.name = url;
      entry.texture = tex;
      entry.width = src.width;
      entry.height = src.height;
      const bmp = entry.bitmap;
      if (bmp) {
        // uploaded (three calls this once it is): the bitmap goes, the GPU's copy stays
        tex.onUpdate = () => {
          tex.onUpdate = null;
          bmp.close();
          if (entry.bitmap === bmp) entry.bitmap = null;
          entry.closed = true;
          // were three to upload it again, it would leave it blank rather than read a closed bitmap
          tex.source.dataReady = false;
        };
      }
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
      entry.loading = false;
      entry.stallSubs.clear();
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      if (entries.get(url) === entry) entries.delete(url); // don't cache failures
      if (track) {
        if (!isAbort(err)) manager.itemError(url);
        manager.itemEnd(url);
      }
      throw err;
    }
  })();
  entries.set(url, entry);
  return entry.promise;
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

function scheduleRelease(url: string, entry: Entry) {
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.loading) {
    // nobody wants it any more: stop the download (and any backoff wait)
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (entry.refs > 0 || !entry.loading) return;
      if (entries.get(url) === entry) entries.delete(url);
      entry.abort.abort();
    }, ABORT_GRACE_MS);
    return;
  }
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (entry.refs > 0 || entries.get(url) !== entry) return;
    evict(url, entry);
  }, RELEASE_DELAY_MS);
}

/** Out of the cache for good, nobody holding it: its GPU copy and its bitmap go. */
function evict(url: string, entry: Entry) {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  if (entries.get(url) === entry) entries.delete(url);
  entry.texture?.dispose();
  entry.bitmap?.close();
  entry.texture = null;
  entry.bitmap = null;
}

/**
 * Free the cached paintings' GPU copies once no exhibit is left (exhibit-shared.ts):
 * each renderer's dispose listener goes with them, so a texture reused by the
 * next gallery doesn't pin the last one's renderer. The release timers run as
 * before; a texture picked up again uploads anew from its bitmap, or, its
 * bitmap closed, is loaded anew (acquireTexture).
 */
export function disposeCachedTextures(): void {
  for (const e of entries.values()) if (e.refs === 0) e.texture?.dispose();
}

/** Painting textures alive in the cache and their estimated GPU bytes
 *  (RGBA8 with mipmaps): what the gallery holds right now. */
export function textureStats(): { textures: number; held: number; mb: number; loading: number; backoff: number } {
  let textures = 0;
  let held = 0;
  let bytes = 0;
  let loading = 0;
  for (const e of entries.values()) {
    if (e.loading) loading++;
    if (!e.texture || !e.width || !e.height) continue;
    textures++;
    if (e.refs > 0) held++;
    bytes += e.width * e.height * 4 * (4 / 3);
  }
  return { textures, held, mb: +(bytes / 1e6).toFixed(1), loading, backoff: backoff.size };
}

export function releaseTexture(url: string): void {
  const entry = entries.get(url);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) scheduleRelease(url, entry);
}

// ------------------------------------------------------- staggered uploads

const priorities = ["high", "auto", "low"] as const;
const uploads: Record<FetchPriority, Set<() => void>> = {
  high: new Set(),
  auto: new Set(),
  low: new Set(),
};
let pumping = false;

function pump() {
  for (const priority of priorities) {
    const queue = uploads[priority];
    const job = queue.values().next().value;
    if (!job) continue;
    queue.delete(job);
    try {
      job();
    } catch (e) {
      console.error(e);
    }
    break;
  }
  if (priorities.some((p) => uploads[p].size)) next();
  else pumping = false;
}

function next() {
  // rAF paces uploads to frames; the timeout keeps the queue moving in a
  // hidden/background tab where rAF is paused.
  let done = false;
  let frame: number | undefined;
  const go = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    pump();
  };
  const timer = setTimeout(go, 120);
  if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(go);
}

/** One upload per frame, entrance/inspect first. Cancelling removes the job without spending a frame on it. */
export function scheduleUpload(run: () => void, priority: FetchPriority = "auto"): () => void {
  const queue = uploads[priority];
  const job = () => run();
  queue.add(job);
  if (!pumping) {
    pumping = true;
    next();
  }
  return () => { queue.delete(job); };
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

/** Free the placeholder from every renderer that uploaded it (exhibit-shared.ts); it stays usable. */
export function disposePlaceholderTexture(): void {
  placeholder?.dispose();
}
