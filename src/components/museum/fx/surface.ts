// A paintable surface: CPU-side RGBA + material arrays mirrored into two GPU
// textures, updated by dirty rectangle (one texSubImage2D per texture per
// flush, never a full re-upload).
//
// Texture layout (8 bit each, image row 0 = TOP of the surface; shaders
// sample at (u, 1 − v) so the data needs no flip):
//   col  (sRGB)   rgb = paint colour (straight alpha), a = coverage
//   mat  (linear) r = thickness (1.0 = THICK_M metres), g = wetness,
//                 b = glaze (clear wet film: egg white),
//                 a = hole (the support is gone: a tear in the canvas)
//
// Live items (running drips, a sliding yolk) change shape every frame and
// can shrink locally (a drip's bead moves down, leaving a narrower trail).
// Each gets a small snapshot window of the committed paint under its whole
// reach; when it changes, its bounds are restored from the window and every
// live item there is drawn again. Static paint (a new splat, brush paint) is
// composited into the shown arrays and into any window it overlaps, so the
// windows always hold "everything but the live items".

import * as THREE from "three";

export interface Rect {
  x0: number;
  y0: number;
  x1: number; // exclusive
  y1: number; // exclusive
}

/** Metres of paint represented by a thickness of 1.0. */
export const THICK_M = 0.005;
/** Seconds for fresh paint to go from wet gloss to its dry sheen. */
export const DRY_SECONDS = 26;

export function rectUnion(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export function rectIntersect(a: Rect, b: Rect): Rect | null {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}

/** Arrays covering `rect` (row stride = rect width). */
export interface Target {
  col: Uint8ClampedArray;
  mat: Uint8ClampedArray;
  rect: Rect;
}

// ---------------------------------------------------------------- layers

/**
 * One painter's contribution over a pixel rectangle, in floats. Painters
 * fill it, the surface composites it ("over", with thickness adding up).
 */
export class Layer {
  x0 = 0;
  y0 = 0;
  w = 0;
  h = 0;
  /** coverage / opacity 0..1 */
  a = new Float32Array(0);
  /** thickness 0..1 (× THICK_M) */
  t = new Float32Array(0);
  /** film presence 0..1 (carries glaze; equals coverage for opaque paint) */
  f = new Float32Array(0);
  /** hole 0..1 (used when `holes` is set) */
  hole = new Float32Array(0);
  holes = false;
  /** per-pixel sRGB colour 0..255, used when `perPixel` is set */
  rgb = new Float32Array(0);
  perPixel = false;
  color: [number, number, number] = [0, 0, 0];
  /** 0..1, or −1 to leave the wetness under it alone (a tear is not paint) */
  wet = 1;
  glaze = 0;
  /** the same paint flowing on (a drip leaving its splat): thickness is not added */
  thickMax = false;

  reset(rect: Rect, perPixel = false): this {
    this.x0 = rect.x0;
    this.y0 = rect.y0;
    this.w = Math.max(0, rect.x1 - rect.x0);
    this.h = Math.max(0, rect.y1 - rect.y0);
    const n = this.w * this.h;
    if (this.a.length < n) {
      const cap = Math.ceil(n * 1.25);
      this.a = new Float32Array(cap);
      this.t = new Float32Array(cap);
      this.f = new Float32Array(cap);
      this.hole = new Float32Array(cap);
    } else {
      this.a.fill(0, 0, n);
      this.t.fill(0, 0, n);
      this.f.fill(0, 0, n);
      this.hole.fill(0, 0, n);
    }
    this.holes = false;
    this.perPixel = perPixel;
    if (perPixel) {
      if (this.rgb.length < n * 3) this.rgb = new Float32Array(Math.ceil(n * 3 * 1.25));
      else this.rgb.fill(0, 0, n * 3);
    }
    this.wet = 1;
    this.glaze = 0;
    this.thickMax = false;
    return this;
  }

  get rect(): Rect {
    return { x0: this.x0, y0: this.y0, x1: this.x0 + this.w, y1: this.y0 + this.h };
  }
}

const layerPool: Layer[] = [];
export function acquireLayer(): Layer {
  return layerPool.pop() ?? new Layer();
}
export function releaseLayer(l: Layer): void {
  if (layerPool.length < 4) layerPool.push(l);
}

// ------------------------------------------------------------ live items

export interface LiveItem {
  /** Current pixel bounds on this surface (null: nothing to draw). */
  bounds(): Rect | null;
  /** Bounds over the item's whole life (its snapshot window). */
  maxBounds(): Rect | null;
  /** Composite the current state, clipped to `clip`, into `target`. */
  draw(clip: Rect, target: Target): void;
  /** Set by the owner whenever the appearance changed since the last refresh. */
  changed: boolean;
  /** Set by the owner when the item is final: it is then committed. */
  done: boolean;
}

interface LiveEntry {
  item: LiveItem;
  prev: Rect | null;
  win: Target;
}

// --------------------------------------------------------------- surface

function makeTex(data: Uint8ClampedArray, w: number, h: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.flipY = false;
  t.unpackAlignment = 4;
  return t;
}

// cheap per-pixel dither so 8-bit thickness does not terrace in highlights
function dither(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h >>> 0) / 4294967296 - 0.5) * 0.9;
}

/** "Over" with thickness accumulation, one pixel at byte index i. */
function blendAt(
  col: Uint8ClampedArray,
  mat: Uint8ClampedArray,
  i: number,
  a: number,
  t: number,
  f: number,
  pr: number,
  pg: number,
  pb: number,
  wet: number,
  glaze: number,
  dith: number,
  tmax = false,
  hole = 0,
): void {
  if (hole > 1 / 512) {
    const h = hole * 255;
    if (h > mat[i + 3]) mat[i + 3] = h;
  }
  const A0 = col[i + 3] * (1 / 255);
  if (a < 1 / 512 && f < 1 / 512 && t < 1 / 512) {
    // colour bleed into empty texels: no dark fringe when filtering
    if (A0 === 0 && (pr || pg || pb)) {
      col[i] = pr;
      col[i + 1] = pg;
      col[i + 2] = pb;
    }
    return;
  }
  const An = a + A0 * (1 - a);
  if (A0 === 0) {
    col[i] = pr;
    col[i + 1] = pg;
    col[i + 2] = pb;
  } else if (An > 1e-5) {
    const w1 = a / An;
    const w0 = 1 - w1;
    col[i] = pr * w1 + col[i] * w0;
    col[i + 1] = pg * w1 + col[i + 1] * w0;
    col[i + 2] = pb * w1 + col[i + 2] * w0;
  }
  col[i + 3] = An * 255;
  const T0 = mat[i] * (1 / 255);
  mat[i] = (tmax ? Math.max(T0, t) : T0 * (1 - 0.3 * a) + t) * 255 + dith;
  if (wet >= 0) {
    const W0 = mat[i + 1] * (1 / 255);
    const m = Math.min(1, Math.max(a, f) * 1.6);
    mat[i + 1] = (W0 + (wet - W0) * m) * 255;
  }
  const G0 = mat[i + 2] * (1 / 255);
  mat[i + 2] = (G0 * (1 - a) + glaze * f) * 255;
}

export class PaintSurface {
  readonly w: number;
  readonly h: number;
  readonly col: Uint8ClampedArray;
  readonly mat: Uint8ClampedArray;
  readonly colTex: THREE.DataTexture;
  readonly matTex: THREE.DataTexture;
  /** never uploaded: the source handle for sub-rectangle copies */
  private readonly colSrc: THREE.DataTexture;
  private readonly matSrc: THREE.DataTexture;
  private dirtyCol: Rect | null = null;
  private dirtyMat: Rect | null = null;
  private live: LiveEntry[] = [];
  private wetRect: Rect | null = null;
  private wetUntil = 0;
  private dryClock = 0;
  /** Anything painted since the last clear. */
  painted = false;
  /** Last time (s) anything was added; used for eviction. */
  touched = 0;

  constructor(w: number, h: number) {
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    const n = this.w * this.h * 4;
    this.col = new Uint8ClampedArray(n);
    this.mat = new Uint8ClampedArray(n);
    this.colTex = makeTex(this.col, this.w, this.h, true);
    this.matTex = makeTex(this.mat, this.w, this.h, false);
    this.colSrc = makeTex(this.col, this.w, this.h, true);
    this.matSrc = makeTex(this.mat, this.w, this.h, false);
    this.colTex.needsUpdate = true;
    this.matTex.needsUpdate = true;
  }

  get full(): Rect {
    return { x0: 0, y0: 0, x1: this.w, y1: this.h };
  }

  /** The shown arrays as a draw target. */
  get shown(): Target {
    return { col: this.col, mat: this.mat, rect: this.full };
  }

  /** CPU + GPU bytes held (approx., GPU with mips). */
  get bytes(): number {
    return this.w * this.h * 8 * 2.33;
  }

  clip(r: Rect): Rect | null {
    return rectIntersect(r, this.full);
  }

  markDirty(r: Rect, colToo = true): void {
    const c = this.clip(r);
    if (!c) return;
    this.dirtyMat = rectUnion(this.dirtyMat, c);
    if (colToo) this.dirtyCol = rectUnion(this.dirtyCol, c);
  }

  // --------------------------------------------------------- painting

  /**
   * Composite a finished painter layer. With `freeze`, live items under it
   * stop where they are (new paint lands on top of a running drip).
   */
  addStatic(layer: Layer, now: number, freeze = true): void {
    const r = this.clip(layer.rect);
    if (!r) return;
    if (freeze && this.live.length) {
      this.refreshLive(now);
      for (let k = this.live.length - 1; k >= 0; k--) {
        const e = this.live[k];
        if (e.prev && rectIntersect(e.prev, r)) this.commit(e, k);
      }
    }
    this.blendLayer(layer, this.shown);
    for (const e of this.live) if (rectIntersect(e.win.rect, r)) this.blendLayer(layer, e.win);
    this.markDirty(r);
    this.noteWet(r, now);
  }

  /** Blend one pixel (x, y) straight into the shown arrays and any window over it. */
  blendPixel(x: number, y: number, a: number, t: number, f: number, r: number, g: number, b: number, wet: number, glaze: number): void {
    const i = (y * this.w + x) * 4;
    const d = dither(i);
    blendAt(this.col, this.mat, i, a, t, f, r, g, b, wet, glaze, d);
    for (const e of this.live) {
      const wr = e.win.rect;
      if (x < wr.x0 || y < wr.y0 || x >= wr.x1 || y >= wr.y1) continue;
      blendAt(e.win.col, e.win.mat, ((y - wr.y0) * (wr.x1 - wr.x0) + (x - wr.x0)) * 4, a, t, f, r, g, b, wet, glaze, d);
    }
  }

  /** Note pixels changed by blendPixel. */
  touch(r: Rect, now: number): void {
    const c = this.clip(r);
    if (!c) return;
    this.markDirty(c);
    this.noteWet(c, now);
  }

  addLive(item: LiveItem, now: number): void {
    const m = item.maxBounds();
    const r = m && this.clip(m);
    if (!r) return;
    const ww = r.x1 - r.x0;
    const win: Target = {
      col: new Uint8ClampedArray(ww * (r.y1 - r.y0) * 4),
      mat: new Uint8ClampedArray(ww * (r.y1 - r.y0) * 4),
      rect: r,
    };
    copyRect(this.shown, win, r);
    // where another live item is drawn, its window holds what lies beneath
    for (const e of this.live) {
      const o = rectIntersect(e.win.rect, r);
      if (o) copyRect(e.win, win, o);
    }
    this.live.push({ item, prev: null, win });
    item.changed = true;
    this.noteWet(r, now);
  }

  hasLive(): boolean {
    return this.live.length > 0;
  }

  /** Forget live items matching `pred` (their pixels stay as last drawn). */
  dropLive(pred: (item: LiveItem) => boolean): void {
    this.live = this.live.filter((e) => !pred(e.item));
  }

  /** Re-composite changed live items; commit finished ones. */
  refreshLive(now: number): void {
    if (this.live.length === 0) return;
    const work: { region: Rect; win: Target }[] = [];
    const finished: LiveEntry[] = [];
    for (const e of this.live) {
      const it = e.item;
      if (!it.changed && !it.done) continue;
      const cur = it.bounds();
      const region = rectUnion(e.prev, cur);
      e.prev = cur;
      it.changed = false;
      const c = region && rectIntersect(region, e.win.rect);
      if (c) work.push({ region: c, win: e.win });
      if (it.done) finished.push(e);
    }
    for (const { region, win } of work) {
      copyRect(win, this.shown, region);
      for (const e of this.live) {
        const ir = e.prev && rectIntersect(e.prev, region);
        if (ir) e.item.draw(ir, this.shown);
      }
      this.markDirty(region);
      this.noteWet(region, now);
    }
    for (const e of finished) {
      const k = this.live.indexOf(e);
      if (k >= 0) this.commit(e, k);
    }
  }

  /** Make a live item's current state permanent (it is already shown). */
  private commit(e: LiveEntry, k: number): void {
    this.live.splice(k, 1);
    if (!e.prev) return;
    for (const o of this.live) {
      const ir = rectIntersect(o.win.rect, e.prev);
      if (ir) e.item.draw(ir, o.win);
    }
  }

  private noteWet(r: Rect, now: number): void {
    this.wetRect = rectUnion(this.wetRect, r);
    this.wetUntil = Math.max(this.wetUntil, now + DRY_SECONDS + 2);
    this.painted = true;
    this.touched = now;
  }

  /** Drying: true while wet paint remains (the caller should come back). */
  dry(now: number, tick = 0.5): boolean {
    if (!this.wetRect) return false;
    if (this.dryClock === 0) this.dryClock = now;
    const elapsed = now - this.dryClock;
    if (elapsed < tick) return true;
    this.dryClock = now;
    const step = Math.max(1, Math.round((255 * elapsed) / DRY_SECONDS));
    dryRect(this.shown, this.wetRect, step);
    for (const e of this.live) dryRect(e.win, e.win.rect, step);
    this.markDirty(this.wetRect, false);
    if (now > this.wetUntil && this.live.length === 0) {
      this.wetRect = null;
      this.dryClock = 0;
      return false;
    }
    return true;
  }

  /** Upload what changed. */
  flush(renderer: THREE.WebGLRenderer): void {
    if (this.dirtyCol) this.copy(renderer, this.colSrc, this.colTex, this.dirtyCol);
    if (this.dirtyMat) this.copy(renderer, this.matSrc, this.matTex, this.dirtyMat);
    this.dirtyCol = null;
    this.dirtyMat = null;
  }

  private copy(renderer: THREE.WebGLRenderer, src: THREE.DataTexture, dst: THREE.DataTexture, r: Rect) {
    const props = renderer.properties.get(dst) as { __webglTexture?: WebGLTexture; __version?: number };
    if (!props.__webglTexture || props.__version !== dst.version) {
      // first use: one full upload of the data as it is now
      renderer.initTexture(dst);
      return;
    }
    _box.min.set(r.x0, r.y0);
    _box.max.set(r.x1, r.y1);
    _pos.set(r.x0, r.y0);
    renderer.copyTextureToTexture(src, dst, _box, _pos);
  }

  /** Wipe a rectangle (a recycled decal cell). */
  clearRect(r: Rect): void {
    const c = this.clip(r);
    if (!c) return;
    this.dropLive((it) => {
      const b = it.maxBounds();
      return !!b && !!rectIntersect(b, c);
    });
    for (let y = c.y0; y < c.y1; y++) {
      const s = (y * this.w + c.x0) * 4;
      const e = (y * this.w + c.x1) * 4;
      this.col.fill(0, s, e);
      this.mat.fill(0, s, e);
    }
    this.markDirty(c);
  }

  /** Wipe everything (the conservator has been). */
  clear(): void {
    this.col.fill(0);
    this.mat.fill(0);
    this.live.length = 0;
    this.wetRect = null;
    this.dryClock = 0;
    this.painted = false;
    this.markDirty(this.full);
  }

  dispose(): void {
    this.colTex.dispose();
    this.matTex.dispose();
    this.live.length = 0;
  }

  /**
   * Free the GPU copies only (the work left the visitor's rooms); the paint
   * stays in the arrays and is uploaded again in full on its next flush.
   */
  releaseGpu(): void {
    this.colTex.dispose();
    this.matTex.dispose();
    this.dirtyCol = this.full;
    this.dirtyMat = this.full;
  }

  // ------------------------------------------------------------ blending

  /** Composite `L` into a target (clipped to the target, the surface and `clip`). */
  blendLayer(L: Layer, tgt: Target, clip?: Rect): void {
    let r = rectIntersect(L.rect, tgt.rect);
    if (r) r = this.clip(r);
    if (r && clip) r = rectIntersect(r, clip);
    if (!r) return;
    const tw = tgt.rect.x1 - tgt.rect.x0;
    const [cr, cg, cb] = L.color;
    const per = L.perPixel;
    const wet = L.wet;
    const glaze = L.glaze;
    const tmax = L.thickMax;
    const holes = L.holes;
    const SW = this.w;
    for (let y = r.y0; y < r.y1; y++) {
      let j = (y - L.y0) * L.w + (r.x0 - L.x0);
      let i = ((y - tgt.rect.y0) * tw + (r.x0 - tgt.rect.x0)) * 4;
      let si = (y * SW + r.x0) * 4;
      for (let x = r.x0; x < r.x1; x++, j++, i += 4, si += 4) {
        if (per) {
          blendAt(tgt.col, tgt.mat, i, L.a[j], L.t[j], L.f[j], L.rgb[j * 3], L.rgb[j * 3 + 1], L.rgb[j * 3 + 2], wet, glaze, dither(si), tmax, holes ? L.hole[j] : 0);
        } else {
          blendAt(tgt.col, tgt.mat, i, L.a[j], L.t[j], L.f[j], cr, cg, cb, wet, glaze, dither(si), tmax, holes ? L.hole[j] : 0);
        }
      }
    }
  }
}

function copyRect(from: Target, to: Target, r: Rect): void {
  const fw = from.rect.x1 - from.rect.x0;
  const tw = to.rect.x1 - to.rect.x0;
  const x0 = Math.max(r.x0, from.rect.x0, to.rect.x0);
  const x1 = Math.min(r.x1, from.rect.x1, to.rect.x1);
  const y0 = Math.max(r.y0, from.rect.y0, to.rect.y0);
  const y1 = Math.min(r.y1, from.rect.y1, to.rect.y1);
  if (x1 <= x0) return;
  for (let y = y0; y < y1; y++) {
    const s = ((y - from.rect.y0) * fw + (x0 - from.rect.x0)) * 4;
    const d = ((y - to.rect.y0) * tw + (x0 - to.rect.x0)) * 4;
    const n = (x1 - x0) * 4;
    to.col.set(from.col.subarray(s, s + n), d);
    to.mat.set(from.mat.subarray(s, s + n), d);
  }
}

function dryRect(t: Target, r: Rect, step: number): void {
  const c = rectIntersect(r, t.rect);
  if (!c) return;
  const tw = t.rect.x1 - t.rect.x0;
  const m = t.mat;
  for (let y = c.y0; y < c.y1; y++) {
    let i = ((y - t.rect.y0) * tw + (c.x0 - t.rect.x0)) * 4 + 1;
    const end = i + (c.x1 - c.x0) * 4;
    for (; i < end; i += 4) {
      const v = m[i];
      if (v) m[i] = v - step;
    }
  }
}

const _box = new THREE.Box2();
const _pos = new THREE.Vector2();
