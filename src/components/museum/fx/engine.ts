// The studio engine: framework-free three.js glue between input (a screen
// point), the scene (raycast), the painters (2-D, per surface) and what
// flies, falls and is held. The R3F layer (Layer.tsx) drives update() from
// useFrame and calls invalidate() only while something is moving; the
// standalone harness drives it directly.
//
// Surfaces:
//   - every registered canvas mesh gets an overlay (allocated on its first
//     hit, sized to the work's physical size) sampled by its own material;
//   - everything else (walls, floor, frames, benches) gets projected decals
//     sharing one atlas and one draw call.
// A splat is defined once in splat space and rasterized into every surface
// it overlaps, so paint crossing a frame edge continues onto the frame.
// Free strokes (the brush, the spray can) paint off the works into square
// decal patches; as a stroke nears a patch's edge it carries on into the next
// (an existing one that covers it, or a new one set ahead of it).
//
// The room: on activation the lights dip for a beat (tone-mapping exposure,
// a uniform); sustained mess raises the "heat", and past a point a distant
// alarm rings and a slow amber/red beacon washes the room. The beacon is
// one point light added once, at activation (dark at rest, so no program
// ever recompiles for it); the alarm winds down when the mess stops. The
// conservator stops the alarm and dissolves the damage work by work.

import * as THREE from "three";
import { BrushStroke, type Grain } from "./brush";
import { CutRun, cutExtent, stampGouge, type CutSpec, type SurfaceKind } from "./cuts";
import { DART_COLORS, DartSystem, buildPuncture } from "./darts";
import { FoodDebris } from "./debris";
import { DecalManager, type SplatFrame } from "./decals";
import { DripRun } from "./drip";
import { buildFoodSplat, flavourOf, flecks, sliceAngle, type FoodKind } from "./food";
import { patchCanvasMaterial, unbindCanvas, type OverlayUniforms } from "./materials";
import { smoothstep } from "./noise";
import { Particles, Shape } from "./particles";
import { ProjectileSystem, type SplatKind } from "./projectiles";
import { Rig, SWORD_CUT, type HeldKind } from "./rig";
import { sfx } from "./sfx";
import { ShardSystem } from "./shards";
import { buildEggSplat, buildPaintSplat, buildPaintballSplat, stampShape, type Bounds, type DripSpec, type Receiver, type RGB, type SplatPlan } from "./splat";
import { SPRAY_LIMITS, SprayCan, type SprayTarget } from "./spray";
import type { Food } from "./store";
import { PaintSurface, type Rect } from "./surface";

export type Quality = "high" | "low";

const QUALITY = {
  // drying wakes the canvas only this often while nothing else moves
  high: { ppm: 1024, maxSide: 2048, maxPx: 2_200_000, budgetPx: 9_000_000, atlas: 2048, cell: 512, dryTick: 1.5 },
  low: { ppm: 560, maxSide: 1024, maxPx: 650_000, budgetPx: 2_600_000, atlas: 1024, cell: 256, dryTick: 2 },
} as const;

/** Layer for everything the engine adds (main camera only: no floor reflection, no raycast). */
const PROP_LAYER = 1;
/** Paintballs per hopper; rounds per second while the trigger is held. */
export const HOPPER = 200;
const MARKER_RATE = 8;
const REFILL_S = 0.9;
/** Paintball speed (m/s): fast, but a few frames in the air across a room. */
const BALL_SPEED = 30;

/** Per-hit size factor: [min, max] spread and the typical impact speed (m/s). */
const SHOT_SIZE: Record<SplatKind, { min: number; max: number; speed: number }> = {
  paint: { min: 0.5, max: 1.7, speed: 9 },
  egg: { min: 0.7, max: 1.4, speed: 9 },
  ball: { min: 0.55, max: 1.8, speed: BALL_SPEED },
  // a slice is a slice: its print must stay under it
  pizza: { min: 0.9, max: 1.15, speed: 9 },
  burger: { min: 0.8, max: 1.3, speed: 9 },
  icecream: { min: 0.8, max: 1.35, speed: 9 },
};
/** Darts fly flat and fast: flight time (s) = base + perM × distance, within [min, max]. */
const DART_T = { base: 0.06, perM: 0.04, min: 0.12, max: 0.3 };

function shotScale(seed: number, kind: SplatKind, speed: number): number {
  const { min, max, speed: v0 } = SHOT_SIZE[kind];
  // two independent draws from the seed, averaged: a bell around the middle
  const h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const u = ((h & 0xffff) / 0xffff + (h >>> 16) / 0xffff) / 2;
  // skew towards the smaller sizes so big bursts stay rare
  const t = Math.pow(u, 1.35);
  const hard = Math.min(1.25, Math.max(0.85, Math.sqrt(speed / v0)));
  return (min + (max - min) * t) * hard;
}
/** How far the blade reaches from the eye (m). */
const SWORD_REACH = 1.75;
/** The conservator: each item's dissolve, and the most the whole sequence may take. */
const CLEAN_ITEM_S = 1.15;
const CLEAN_SPAN_S = 2.8;
/** Escalation: heat half-life (s), alarm on / off thresholds, the alarm's ramp times. */
const HEAT_TAU = 16;
const HEAT_ON = 6;
const HEAT_OFF = 2.5;
const ALARM_UP_S = 2.5;
const ALARM_DOWN_S = 3.5;
/** The beacon: brightness (cd) at full alarm, and how fast it turns (rad/s). */
const BEACON_CD = 9;
const BEACON_SPIN = 2.6;
/** The unlock moment: how long the lights take to dip and come back. */
const DIP_S = 1.6;
const DIP_DEPTH = 0.62;

/** Paintball "team" colours (fill), bright and fluorescent. */
export const TEAM_COLORS = ["#ff5a14", "#ff2d87", "#f5e600", "#39d353", "#1e7bff", "#a23cff"];

export interface StatEvent {
  /** "work": a painting was touched for the first time this visit (`work` is its key) */
  kind: "paint" | "food" | "dart" | "ball" | "brush" | "spray" | "cut" | "work";
  /** throws / balls / cuts / works: 1; brush, spray: metres */
  amount: number;
  work?: string;
}

export interface EngineOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** request a frame (R3F's invalidate) */
  invalidate: () => void;
  quality?: Quality;
  floorY?: number;
  /** compile everything now in the scene (default: renderer.compileAsync) */
  compile?: () => Promise<void>;
  /** the first damage of a session (and after each clean) */
  onDamage?: () => void;
  /** the conservator has finished */
  onCleaned?: () => void;
  /** something was thrown / fired / painted / cut (for the counters) */
  onStat?: (e: StatEvent) => void;
  /** the marker's hopper changed */
  onHopper?: (s: { balls: number; cap: number; refilling: boolean }) => void;
  /** the alarm's level changed (0..1, for the music duck) */
  onAlarm?: (level: number) => void;
  /** refill by itself when the hopper runs dry (touch: there is no R key) */
  autoRefill?: boolean;
}

type CutPoint = { obj: THREE.Object3D; canvas: CanvasEntry | null; point: THREE.Vector3; normal: THREE.Vector3; uv: THREE.Vector2 | null };

/** Where the blade's edge passes across the view, u 0..1 (NDC, around `c`). */
function arcPoint(u: number, c: THREE.Vector2): THREE.Vector2 {
  const a = 1 - u;
  return new THREE.Vector2(a * a * 0.62 + 2 * a * u * -0.1 + u * u * -0.58 + c.x, a * a * 0.58 + 2 * a * u * 0.32 + u * u * -0.52 + c.y);
}

// A work's bitmap is closed once it is on the GPU (exhibit-texture.ts): its
// pixels are read back from there, drawn small into a target (the work's
// bottom on row 0, as its pre-flipped bitmap would draw). Rare (once per work,
// kept below), so nothing is kept for it: kept, it would hold the renderer.
const isClosed = (img: unknown) => typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap && !img.width;
function readBack(renderer: THREE.WebGLRenderer, tex: THREE.Texture, w: number, h: number): Uint8ClampedArray | null {
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { map: { value: tex } },
    vertexShader: "in vec3 position; in vec2 uv; out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    // (sampled linear from the sRGB texture, stored as sRGB again by the target: its own bytes)
    fragmentShader: "precision highp float; uniform sampler2D map; in vec2 vUv; out vec4 color; void main() { color = texture(map, vUv); }",
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const rt = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace });
  const prev = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(rt);
    renderer.render(new THREE.Scene().add(quad), new THREE.Camera());
    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    return new Uint8ClampedArray(px.buffer);
  } catch {
    return null;
  } finally {
    renderer.setRenderTarget(prev);
    rt.dispose();
    quad.geometry.dispose();
    material.dispose();
  }
}

// the work's own brushwork as a relief proxy: local contrast of its image
// (crests of impasto photograph light), at half the overlay's resolution
const grains = new WeakMap<object, Grain | null>();
function grainOf(renderer: THREE.WebGLRenderer, tex: THREE.Texture | null | undefined, w: number, h: number): Grain | null {
  const img = tex?.image as CanvasImageSource | undefined;
  if (!tex || !img || typeof document === "undefined") return null;
  const gw = Math.max(8, Math.ceil(w / 2));
  const gh = Math.max(8, Math.ceil(h / 2));
  const hit = grains.get(img as object);
  if (hit !== undefined && (!hit || (hit.w === gw && hit.h === gh))) return hit;
  let out: Grain | null = null;
  try {
    let px: Uint8ClampedArray;
    if (isClosed(img)) {
      const back = readBack(renderer, tex, gw, gh);
      if (!back) throw new Error("unreadable");
      // the work's top on row 0, as drawn below
      px = new Uint8ClampedArray(back.length);
      for (let y = 0; y < gh; y++) px.set(back.subarray((gh - 1 - y) * gw * 4, (gh - y) * gw * 4), y * gw * 4);
    } else {
      const c = document.createElement("canvas");
      c.width = gw;
      c.height = gh;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      // a pre-flipped ImageBitmap (the exhibits decode with flipY) has the work's bottom on row 0
      if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap && !tex.flipY) {
        g.translate(0, gh);
        g.scale(1, -1);
      }
      g.drawImage(img, 0, 0, gw, gh);
      px = g.getImageData(0, 0, gw, gh).data;
    }
    const n = gw * gh;
    const lum = new Float32Array(n);
    for (let i = 0; i < n; i++) lum[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    // box blur (r = 4) by running sums, rows then columns
    const R = 4;
    const tmp = new Float32Array(n);
    const blur = new Float32Array(n);
    for (let y = 0; y < gh; y++) {
      let acc = 0;
      for (let x = -R; x <= R; x++) acc += lum[y * gw + Math.min(gw - 1, Math.max(0, x))];
      for (let x = 0; x < gw; x++) {
        tmp[y * gw + x] = acc / (2 * R + 1);
        acc += lum[y * gw + Math.min(gw - 1, x + R + 1)] - lum[y * gw + Math.max(0, x - R)];
      }
    }
    for (let x = 0; x < gw; x++) {
      let acc = 0;
      for (let y = -R; y <= R; y++) acc += tmp[Math.min(gh - 1, Math.max(0, y)) * gw + x];
      for (let y = 0; y < gh; y++) {
        blur[y * gw + x] = acc / (2 * R + 1);
        acc += tmp[Math.min(gh - 1, y + R + 1) * gw + x] - tmp[Math.max(0, y - R) * gw + x];
      }
    }
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = Math.min(1, Math.max(0, 0.5 + 3 * (lum[i] - blur[i])));
    out = { w: gw, h: gh, data };
  } catch {
    out = null; // tainted or unreadable: noise alone
  }
  grains.set(img as object, out);
  return out;
}

// a small, cached thumbnail of each painting image for sampling colours
const thumbs = new WeakMap<object, { data: Uint8ClampedArray; n: number; flipped: boolean } | null>();
function sampleMap(renderer: THREE.WebGLRenderer, tex: THREE.Texture | null | undefined, u: number, v: number): THREE.Color | null {
  const img = tex?.image as (CanvasImageSource & { width?: number }) | undefined;
  if (!tex || !img || typeof document === "undefined") return null;
  let t = thumbs.get(img as object);
  if (t === undefined && isClosed(img)) {
    const back = readBack(renderer, tex, 48, 48);
    t = back && { data: back, n: 48, flipped: true };
    thumbs.set(img as object, t);
  }
  if (t === undefined) {
    try {
      const n = 48;
      const c = document.createElement("canvas");
      c.width = c.height = n;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, n, n);
      // a pre-flipped ImageBitmap (the exhibits decode with flipY) has the work's bottom on row 0
      const flipped = typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap && !tex.flipY;
      t = { data: g.getImageData(0, 0, n, n).data, n, flipped };
    } catch {
      t = null; // tainted or unreadable
    }
    thumbs.set(img as object, t);
  }
  if (!t) return null;
  const x = Math.min(t.n - 1, Math.max(0, Math.floor(u * t.n)));
  const yv = t.flipped ? v : 1 - v;
  const y = Math.min(t.n - 1, Math.max(0, Math.floor(yv * t.n)));
  const i = (y * t.n + x) * 4;
  return new THREE.Color().setRGB(t.data[i] / 255, t.data[i + 1] / 255, t.data[i + 2] / 255, THREE.SRGBColorSpace);
}

interface CanvasEntry {
  /** stable id (the painting's slug): paint survives the mesh being remounted */
  key: string;
  mesh: THREE.Mesh;
  material: THREE.Material;
  w: number;
  h: number;
  uniforms: OverlayUniforms | null;
  surface: PaintSurface | null;
  /** its moment in the conservator's sequence (s) */
  seq: number;
}

/** A canvas as the gallery registers it. */
export interface CanvasRef {
  key: string;
  mesh: THREE.Mesh;
  w: number;
  h: number;
}

interface Hit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  object: THREE.Object3D;
  uv: THREE.Vector2 | null;
  canvas: CanvasEntry | null;
  front: boolean;
  distance: number;
}

/**
 * Side of the square decal patches free strokes paint into off the works (m):
 * the brush's crisp; the spray's soft mist takes a coarser, larger one.
 */
const PATCH = { brush: 1.1, spray: 1.3 };
/** A new patch is centred this far (share of its side) ahead of where the stroke is heading. */
const PATCH_AHEAD = 0.25;
/** Room a spray patch keeps below the can on a wall, for the runs (m). */
const RUN_ROOM = 0.12;
/** A stroke jumping further than this between frames (a depth edge) lifts instead of carrying on (m). */
const STROKE_JUMP = 0.3;
/** The can rattles when it has not been shaken or used for this long (s). */
const SHAKE_S = 3;

/** A square of wall (floor, frame, bench) a free stroke paints into: a decal cell, projected along `frame`. */
interface Patch {
  /** origin at frame.origin */
  rcv: Receiver;
  frame: SplatFrame;
}

/** Where the brush paints this frame: a work's overlay or a patch, the point in its pixels. */
interface StrokeTarget {
  s: PaintSurface;
  e: CanvasEntry | null;
  patch: Patch | null;
  x: number;
  y: number;
  /** px per metre, and the pixels the stroke may paint */
  sx: number;
  sy: number;
  clip: Rect;
}

interface BrushState {
  ndc: THREE.Vector2;
  color: RGB;
  width: number;
  reach: number;
  stroke: BrushStroke | null;
  /** what the stroke paints: a work, or a patch of anything else */
  on: CanvasEntry | null;
  patch: Patch | null;
  /** the plane it has been moving in (kept across a frame's mouldings) */
  plane: THREE.Vector3 | null;
  load: number;
  lastPoint: THREE.Vector3 | null;
  lastT: number;
  speed: number;
  seed: number;
  /** metres not yet reported */
  pending: number;
}

interface SprayState {
  ndc: THREE.Vector2;
  can: SprayCan;
  /** the patch of wall around the works it last sprayed into, and the plane it has been moving in */
  patch: Patch | null;
  plane: THREE.Vector3 | null;
  /** the colour of the mist in the air (linear) */
  mist: THREE.Color;
  puff: number;
  lastPoint: THREE.Vector3 | null;
  /** metres not yet reported */
  pending: number;
}

const _ray = new THREE.Raycaster();
const _hits: THREE.Intersection[] = [];
const _v = new THREE.Vector3();
const _box = new THREE.Box3();
const _mbox = new THREE.Box3();
const _inv = new THREE.Matrix4();
const _GDOWN = new THREE.Vector3(0, -1, 0);
const AMBER = new THREE.Color("#ff8a1e");
const RED = new THREE.Color("#ff2a10");

function ignored(o: THREE.Object3D | null): boolean {
  for (let p = o; p; p = p.parent) {
    if (!p.visible || p.userData.fxIgnore) return true;
  }
  return false;
}

/** On the main layer, or a prop (sign, label, fixture) that opts in with userData.fxTarget. */
function reachable(o: THREE.Object3D): boolean {
  return o.layers.isEnabled(0) || o.userData.fxTarget === true;
}

function materialOk(m: THREE.Material | THREE.Material[]): boolean {
  const mat = Array.isArray(m) ? m[0] : m;
  if (!mat) return false;
  return !(mat.transparent && mat.opacity < 0.35);
}

export function hexRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export class FxEngine {
  private readonly o: EngineOptions;
  private readonly q: (typeof QUALITY)[Quality];
  private readonly canvases = new Map<THREE.Mesh, CanvasEntry>();
  /** surfaces of works whose mesh went away (another room), by key */
  private readonly parked = new Map<string, PaintSurface>();
  private readonly decals: DecalManager;
  private readonly projectiles = new ProjectileSystem();
  private readonly shards: ShardSystem;
  private readonly debris: FoodDebris;
  private readonly darts: DartSystem;
  /** darts thrown (their flights come in sets of three) */
  private dartsThrown = 0;
  private readonly particles: Particles;
  private readonly rig = new Rig();
  private readonly beacon: THREE.PointLight;
  private runs: DripRun[] = [];
  private cuts: CutRun[] = [];
  private brush: BrushState | null = null;
  private spray: SprayState | null = null;
  /** when the can was last shaken or used (s) */
  private shaken = -Infinity;
  private active = false;
  private last = 0;
  private wet = false;
  private damaged = false;
  private seed = (Math.random() * 0x7fffffff) | 0;
  // the marker and the blade
  private balls = HOPPER;
  private refillUntil: number | null = null;
  private trigger: { kind: HeldKind; ndc: THREE.Vector2; held: boolean; next: number } | null = null;
  private sword: { centre: THREE.Vector2; lastA: number; drag: boolean; pts: (CutPoint | null)[] } | null = null;
  private heldOn = true;
  private ballColor: () => { fill: string; shell: string } = () => ({ fill: TEAM_COLORS[0], shell: TEAM_COLORS[2] });
  // the room
  private heat = 0;
  private heatAt = 0;
  private alarm = 0;
  private alarmOn = false;
  private beaconA = 0;
  private dipT: number | null = null;
  private baseExposure = 1;
  // the conservator
  private cleanT: number | null = null;
  private cleanQueue: { at: number; sp: THREE.Vector3; done: boolean }[] = [];
  private cleanEnd = 0;
  /** works damaged this session (for "works touched") */
  private readonly touched = new Set<string>();

  constructor(opts: EngineOptions) {
    this.o = opts;
    this.q = QUALITY[opts.quality ?? "high"];
    this.decals = new DecalManager({ atlasW: this.q.atlas, atlasH: this.q.atlas, cell: this.q.cell });
    this.shards = new ShardSystem(opts.floorY ?? 0);
    this.shards.onClink = (p, speed) => sfx.clink(this.spatial(p), speed);
    this.particles = new Particles(600, opts.floorY ?? 0);
    this.projectiles.layer = PROP_LAYER;
    for (const o of [this.decals.mesh, this.projectiles.group, this.shards.group, this.particles.points]) o.layers.set(PROP_LAYER);
    this.shards.group.traverse((c) => c.layers.set(PROP_LAYER));
    const low = opts.quality === "low";
    this.debris = new FoodDebris(low);
    this.debris.onLand = (p, sound, speed) => sfx.foodLand(this.spatial(p), sound, speed);
    this.debris.onPeel = (p) => sfx.peel(this.spatial(p));
    this.darts = new DartSystem(low);
    for (const o of [this.debris.group, this.darts.group]) o.traverse((c) => c.layers.set(PROP_LAYER));
    // the alarm beacon: in the scene from activation on, dark at rest
    this.beacon = new THREE.PointLight(AMBER, 0, 16, 2);
    this.beacon.name = "fx-beacon";
    this.beacon.userData.fxIgnore = true;
  }

  get isActive(): boolean {
    return this.active;
  }

  // ------------------------------------------------------------ setup

  /** A painting's canvas (front face at local z = 0, w × h metres, uv 0..1). */
  registerCanvas(mesh: THREE.Mesh, w: number, h: number, key: string = mesh.uuid): () => void {
    const prev = this.canvases.get(mesh);
    if (prev) this.dropCanvas(prev);
    const entry: CanvasEntry = { key, mesh, material: mesh.material as THREE.Material, w, h, uniforms: null, surface: null, seq: 0 };
    this.canvases.set(mesh, entry);
    if (this.active) this.bindCanvas(entry);
    return () => {
      if (this.canvases.get(mesh) === entry) this.dropCanvas(entry);
    };
  }

  /**
   * Match the registered canvases to the gallery's current list: new works
   * are added, departed ones parked (their paint comes back with them), and
   * a canvas whose material was rebuilt is patched again.
   */
  syncCanvases(list: Iterable<CanvasRef>): void {
    const seen = new Set<THREE.Mesh>();
    for (const c of list) {
      seen.add(c.mesh);
      const e = this.canvases.get(c.mesh);
      if (!e || e.key !== c.key || e.w !== c.w || e.h !== c.h) {
        this.registerCanvas(c.mesh, c.w, c.h, c.key);
      } else if (e.material !== c.mesh.material) {
        e.material = c.mesh.material as THREE.Material;
        e.uniforms = null;
        if (this.active) this.bindCanvas(e);
      }
    }
    for (const e of [...this.canvases.values()]) if (!seen.has(e.mesh)) this.dropCanvas(e);
  }

  /** Patch the canvas material and point it at the work's paint (if any). */
  private bindCanvas(e: CanvasEntry): void {
    const u = (e.uniforms = patchCanvasMaterial(e.mesh.material as THREE.MeshStandardMaterial));
    const s = e.surface ?? this.parked.get(e.key) ?? null;
    if (s && s.w > 0) {
      this.parked.delete(e.key);
      e.surface = s;
      u.uOvlCol.value = s.colTex;
      u.uOvlMat.value = s.matTex;
      u.uOvlTexel.value.set(1 / s.w, 1 / s.h);
      u.uOvlOn.value = 1;
    }
  }

  private dropCanvas(e: CanvasEntry): void {
    if (this.brush?.stroke && this.brush.stroke.surface === e.surface) this.endStroke();
    if (e.surface?.painted) {
      // the exhibit went away (another room): keep the paint, free the GPU
      e.surface.releaseGpu();
      this.parked.set(e.key, e.surface);
    } else e.surface?.dispose();
    e.surface = null;
    this.canvases.delete(e.mesh);
  }

  /**
   * Arm the engine: patch the canvas materials (one new shared program),
   * add the decal / projectile / shard / held objects and the beacon, and
   * compile everything, so nothing later stalls on a shader compile.
   */
  async activate(): Promise<void> {
    if (this.active) return;
    this.active = true;
    for (const e of this.canvases.values()) this.bindCanvas(e);
    const { scene } = this.o;
    scene.add(this.decals.mesh, this.projectiles.group, this.shards.group, this.particles.points, this.beacon, ...this.rig.objects);
    // (their instanced meshes draw nothing until used, but compile now)
    scene.add(this.debris.group, this.darts.group);
    this.rig.warmup(true);
    // stand-ins so every material is in the scene for the compile
    const warm = this.projectiles.warmupObjects();
    for (const w of warm) {
      w.layers.set(PROP_LAYER);
      w.scale.setScalar(1e-4);
      w.position.set(0, -50, 0);
      this.projectiles.group.add(w);
    }
    const decalsVisible = this.decals.mesh.visible;
    this.decals.mesh.visible = true;
    const g = this.decals.mesh.geometry;
    if (!g.getAttribute("position")) {
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(9), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(6), 2));
      g.setAttribute("aOvlSeq", new THREE.BufferAttribute(new Float32Array(3), 1));
    }
    this.warmPainters();
    sfx.prepare();
    try {
      if (this.o.compile) await this.o.compile();
      else await this.o.renderer.compileAsync(scene, this.o.camera);
    } catch {
      // compile lazily then
    } finally {
      for (const w of warm) this.projectiles.group.remove(w);
      this.rig.warmup(false);
      this.decals.mesh.visible = decalsVisible && this.decals.count > 0;
      this.o.invalidate();
    }
  }

  /**
   * Run each painter once into a small scratch surface, so the first real
   * throw does not also pay for the JIT warming up (done inside the dip).
   */
  private warmPainters(): void {
    // big enough for the hot loops to reach the optimizing compiler
    const s = new PaintSurface(640, 640);
    const rcv: Receiver = { surface: s, ox: 320, oy: 280, sx: 1024, sy: 1024, clip: s.full };
    const plans = [
      buildPaintSplat({ seed: 1, radius: 0.12, dirX: 0, dirY: 1, oblique: 0.3, vertical: true, color: [200, 30, 30], amount: 0.8 }),
      buildEggSplat({ seed: 2, dirX: 0, dirY: 1, oblique: 0.2, vertical: true }),
      buildPaintballSplat({ seed: 3, dirX: 0, dirY: 1, oblique: 0.2, vertical: true, color: [255, 40, 120], shell: [240, 230, 0] }),
    ];
    for (const plan of plans) {
      for (const sh of plan.shapes) stampShape(sh, rcv, 0);
      for (const spec of plan.drips.slice(0, 2)) {
        const run = new DripRun(spec);
        s.addLive(run.view(rcv), 0);
        run.step(1);
        s.refreshLive(0);
      }
    }
    const can = new SprayCan([40, 120, 220], 0.07, 4, SPRAY_LIMITS.high);
    for (let i = 0; i < 6; i++) can.spray([{ rcv, feather: true }], 0.03, 1 / 60, i % 2 ? { x: -0.03, y: 0.01 } : null);
    s.dispose();
  }

  /** The unlock moment: the lights dip for a beat (and a low thud). */
  dip(): void {
    if (this.dipT === null) this.baseExposure = this.o.renderer.toneMappingExposure;
    this.dipT = 0;
    sfx.unlockThud();
    this.o.invalidate();
  }

  dispose(): void {
    this.endStroke();
    this.spray = null;
    if (this.dipT !== null) this.o.renderer.toneMappingExposure = this.baseExposure;
    sfx.setAlarm(0);
    const { scene } = this.o;
    scene.remove(this.decals.mesh, this.projectiles.group, this.shards.group, this.particles.points, this.beacon, ...this.rig.objects);
    scene.remove(this.debris.group, this.darts.group);
    for (const e of this.canvases.values()) {
      e.surface?.dispose();
      if (e.uniforms) unbindCanvas(e.uniforms);
    }
    this.canvases.clear();
    this.parked.forEach((p) => p.dispose());
    this.parked.clear();
    this.decals.dispose();
    this.projectiles.dispose();
    this.shards.dispose();
    this.debris.dispose();
    this.darts.dispose();
    this.particles.dispose();
    this.rig.dispose();
    this.beacon.dispose();
    sfx.brushStop();
    sfx.sprayStop();
  }

  // ---------------------------------------------------------- picking

  private pick(ndc: THREE.Vector2): Hit | null {
    const { camera, scene } = this.o;
    camera.updateMatrixWorld();
    _ray.setFromCamera(ndc, camera);
    _ray.layers.set(0);
    _ray.layers.enable(PROP_LAYER);
    _ray.far = 60;
    _hits.length = 0;
    _ray.intersectObjects(scene.children, true, _hits);
    for (const h of _hits) {
      const obj = h.object as THREE.Mesh;
      if (!obj.isMesh || !reachable(obj) || ignored(obj) || !materialOk(obj.material)) continue;
      if ((obj as unknown as THREE.InstancedMesh).isInstancedMesh) continue;
      const canvas = this.canvases.get(obj) ?? null;
      const n = h.face ? h.face.normal.clone().transformDirection(obj.matrixWorld) : new THREE.Vector3(0, 0, 1);
      if (n.dot(_ray.ray.direction) > 0) n.negate();
      return {
        point: h.point.clone(),
        normal: n,
        object: obj,
        uv: h.uv ? h.uv.clone() : null,
        canvas,
        front: !!h.face && h.face.normal.z > 0.5,
        distance: h.distance,
      };
    }
    return null;
  }

  private spatial(p: THREE.Vector3): { pan: number; dist: number } {
    const cam = this.o.camera;
    const right = _v.setFromMatrixColumn(cam.matrixWorld, 0);
    const to = p.clone().sub(cam.position);
    const dist = to.length();
    return { pan: dist > 1e-3 ? to.divideScalar(dist).dot(right) : 0, dist };
  }

  private nextSeed(mix: number): number {
    return (this.seed = (Math.imul(this.seed ^ mix, 1103515245) + 12345) >>> 0);
  }

  // ---------------------------------------------------------- throwing

  /** Throw at a screen point (NDC). False if nothing is there. */
  throwAt(ndc: THREE.Vector2, kind: "paint" | "egg", colorHex: string): boolean {
    if (!this.active || this.cleanT !== null) return false;
    const hit = this.pick(ndc);
    if (!hit) return false;
    const from = this.hand();
    const dist = from.distanceTo(hit.point);
    const T = THREE.MathUtils.clamp(0.2 + dist * 0.055, 0.25, 0.5);
    const seed = this.nextSeed(0x5bd1e995);
    this.projectiles.launch(kind, from, hit.point, T, colorHex, (vel) => this.impact(kind, hit, vel, colorHex, seed));
    this.o.onStat?.({ kind: kind === "egg" ? "food" : "paint", amount: 1 });
    this.addHeat(1);
    sfx.whoosh(T);
    this.o.invalidate();
    return true;
  }

  /** Where a throw leaves the hand: low and to the right of the eye. */
  private hand(): THREE.Vector3 {
    const cam = this.o.camera;
    const m = cam.matrixWorld;
    const right = new THREE.Vector3().setFromMatrixColumn(m, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(m, 1);
    const fwd = new THREE.Vector3().setFromMatrixColumn(m, 2).negate();
    return cam.position.clone().addScaledVector(right, 0.17).addScaledVector(up, -0.2).addScaledVector(fwd, 0.28);
  }

  /** Splat directly at a hit (no flight): for tests and the harness. */
  splatAt(ndc: THREE.Vector2, kind: SplatKind, colorHex: string, vel?: THREE.Vector3, seed?: number, shellHex?: string): boolean {
    const hit = this.pick(ndc);
    if (!hit) return false;
    const v = vel ?? hit.point.clone().sub(this.o.camera.position).normalize().multiplyScalar(6);
    this.impact(kind, hit, v, colorHex, seed ?? this.nextSeed(0x1b873593), shellHex);
    return true;
  }

  private impact(kind: SplatKind, hit: Hit, vel: THREE.Vector3, colorHex: string, seed: number, shellHex?: string): void {
    if (hit.canvas && !this.canvases.has(hit.canvas.mesh)) return; // the work left meanwhile
    if (this.cleanT !== null) return;
    const now = this.last || performance.now() / 1000;
    const n = hit.normal.clone();
    if (n.dot(vel) > 0) n.negate();
    const vertical = Math.abs(n.y) < 0.55;
    const frame = this.frameAt(hit.point, n, vel);
    const speed = vel.length() || 1;
    const vt = vel.clone().addScaledVector(n, -vel.dot(n));
    const sinI = vt.length() / speed;
    const tl = vt.length() || 1;
    const dirX = vt.dot(frame.right) / tl;
    const dirY = vt.dot(frame.down) / tl;
    const oblique = smoothstep(0.3, 0.97, sinI) * 0.85;

    // no two hits the same size: a skewed spread (mostly near typical, the odd
    // small break or big burst) times how hard it lands
    const size = shotScale(seed, kind, speed);
    let plan: SplatPlan;
    if (kind === "paint") {
      plan = buildPaintSplat({
        seed,
        radius: 0.12 * size,
        dirX,
        dirY,
        oblique,
        vertical,
        color: hexRgb(colorHex),
        amount: 0.65 + 0.35 * (((seed >>> 4) % 997) / 997),
      });
    } else if (kind === "ball") {
      plan = buildPaintballSplat({ seed, dirX, dirY, oblique, vertical, color: hexRgb(colorHex), shell: hexRgb(shellHex ?? colorHex), scale: size });
    } else if (kind === "egg") {
      plan = buildEggSplat({ seed, dirX, dirY, oblique, vertical, scale: size });
    } else plan = buildFoodSplat(kind, { seed, dirX, dirY, oblique, vertical, scale: size });

    const receivers = this.receivers(frame, plan.extent, hit, kind === "ball");
    for (const s of plan.shapes) for (const rcv of receivers) stampShape(s, rcv, now);
    for (const spec of plan.drips) {
      const run = new DripRun(spec);
      for (const rcv of receivers) rcv.surface.addLive(run.view(rcv), now);
      this.runs.push(run);
    }

    const sp = this.spatial(hit.point);
    if (kind === "egg") {
      this.shards.spawn(hit.point, n, vel, seed, !!plan.brown);
      this.shards.group.traverse((c) => c.layers.set(PROP_LAYER));
      sfx.egg(sp);
    } else if (kind === "ball") {
      this.particles.mist(hit.point, n, seed, new THREE.Color(colorHex));
      sfx.ballHit(sp);
    } else if (kind === "paint") {
      sfx.splat(sp, 0.7);
    } else this.foodLanded(kind, hit, frame, vel, seed, size);
    if (hit.canvas) this.touchWork(hit.canvas.key);
    this.markDamaged();
    this.o.invalidate();
  }

  private touchWork(key: string): void {
    if (this.touched.has(key)) return;
    this.touched.add(key);
    this.o.onStat?.({ kind: "work", amount: 1, work: key });
  }

  private markDamaged(): void {
    if (this.damaged) return;
    this.damaged = true;
    this.o.onDamage?.();
  }

  /** Splat frame for a hit: wall-like surfaces hang from gravity, floors follow `along`. */
  private frameAt(point: THREE.Vector3, normal: THREE.Vector3, along: THREE.Vector3): SplatFrame {
    const n = normal.clone();
    const down = new THREE.Vector3();
    if (Math.abs(n.y) < 0.55) down.copy(_GDOWN).addScaledVector(n, -_GDOWN.dot(n)).normalize();
    else {
      down.copy(along).addScaledVector(n, -along.dot(n));
      if (down.lengthSq() < 1e-6) down.set(0, 0, -1).addScaledVector(n, -n.z);
      down.normalize();
    }
    return { origin: point.clone(), right: new THREE.Vector3().crossVectors(n, down).normalize(), down, normal: n };
  }

  /** Every surface a splat (with its full drips) overlaps. */
  private receivers(frame: SplatFrame, ext: Bounds, hit: Hit, small: boolean): Receiver[] {
    const out: Receiver[] = [];
    let contained = false;
    for (const e of this.canvases.values()) {
      const r = this.canvasReceiver(e, frame, ext, hit);
      if (!r) continue;
      out.push(r.rcv);
      if (r.contained) contained = true;
    }
    if (!contained) {
      // small marks (paintballs) share a nearby decal instead of eating the atlas
      const re = small ? this.decals.reuse(frame.origin, frame.normal, ext) : null;
      if (re) out.push(re.rcv);
      else {
        const targets = this.decalTargets(frame, ext);
        if (targets.length) {
          const rcv = this.decals.add(frame, ext, targets, this.last, 0.32, small ? 0.5 : 0);
          if (rcv) out.push(rcv);
        }
      }
    }
    return out;
  }

  private canvasReceiver(e: CanvasEntry, frame: SplatFrame, ext: Bounds, hit: Hit): { rcv: Receiver; contained: boolean } | null {
    const mesh = e.mesh;
    mesh.updateMatrixWorld();
    const cn = _v.set(0, 0, 1).transformDirection(mesh.matrixWorld);
    if (cn.dot(frame.normal) < 0.8) return null;
    _inv.copy(mesh.matrixWorld).invert();
    const o = frame.origin.clone().applyMatrix4(_inv);
    if (o.z > 0.15 || o.z < -0.2) return null;
    // splat axes in canvas space: right ≈ +x, down ≈ −y on an upright wall
    const rl = frame.right.clone().transformDirection(_inv);
    if (rl.x < 0.9) return null;
    const x0 = o.x + ext.x0;
    const x1 = o.x + ext.x1;
    const y0 = o.y - ext.y1;
    const y1 = o.y - ext.y0;
    const hw = e.w / 2;
    const hh = e.h / 2;
    if (x1 < -hw || x0 > hw || y1 < -hh || y0 > hh) return null;
    const s = this.ensureSurface(e);
    if (!s) return null;
    let ox = (o.x / e.w + 0.5) * s.w;
    let oy = (0.5 - o.y / e.h) * s.h;
    if (hit.object === mesh && hit.uv && hit.front) {
      ox = hit.uv.x * s.w;
      oy = (1 - hit.uv.y) * s.h;
    }
    const m = 0.004;
    const contained = x0 > -hw + m && x1 < hw - m && y0 > -hh + m && y1 < hh - m;
    return { rcv: { surface: s, ox, oy, sx: s.w / e.w, sy: s.h / e.h, clip: s.full }, contained };
  }

  private ensureSurface(e: CanvasEntry): PaintSurface | null {
    if (e.surface) return e.surface;
    if (this.parked.has(e.key)) {
      this.bindCanvas(e);
      if (e.surface) return e.surface;
    }
    const q = this.q;
    let ppm: number = q.ppm;
    ppm = Math.min(ppm, q.maxSide / Math.max(e.w, e.h));
    ppm = Math.min(ppm, Math.sqrt(q.maxPx / (e.w * e.h)));
    const W = Math.max(64, Math.round(e.w * ppm));
    const H = Math.max(64, Math.round(e.h * ppm));
    // stay inside the memory budget: parked works (other rooms) go first,
    // then the least recently damaged is restored
    let used = 0;
    for (const c of this.canvases.values()) if (c.surface) used += c.surface.w * c.surface.h;
    for (const p of this.parked.values()) used += p.w * p.h;
    while (used + W * H > q.budgetPx) {
      let key: string | null = null;
      for (const [k, p] of this.parked) if (key === null || p.touched < this.parked.get(key)!.touched) key = k;
      if (key !== null) {
        const p = this.parked.get(key)!;
        used -= p.w * p.h;
        p.dispose();
        this.parked.delete(key);
        continue;
      }
      let lru: CanvasEntry | null = null;
      for (const c of this.canvases.values()) if (c.surface && (!lru || c.surface.touched < lru.surface!.touched)) lru = c;
      if (!lru) break;
      used -= lru.surface!.w * lru.surface!.h;
      this.releaseSurface(lru);
    }
    const s = new PaintSurface(W, H);
    e.surface = s;
    const u = e.uniforms ?? patchCanvasMaterial(e.mesh.material as THREE.MeshStandardMaterial);
    e.uniforms = u;
    u.uOvlCol.value = s.colTex;
    u.uOvlMat.value = s.matTex;
    u.uOvlTexel.value.set(1 / W, 1 / H);
    u.uOvlOn.value = 1;
    u.uOvlFade.value = 1;
    return s;
  }

  private releaseSurface(e: CanvasEntry): void {
    if (this.brush?.stroke && this.brush.stroke.surface === e.surface) this.endStroke();
    e.surface?.dispose();
    e.surface = null;
    if (e.uniforms) unbindCanvas(e.uniforms);
  }

  /** Non-canvas meshes the splat's projection box touches. */
  private decalTargets(frame: SplatFrame, ext: Bounds): THREE.Mesh[] {
    const depth = 0.16;
    _box.makeEmpty();
    for (const x of [ext.x0, ext.x1]) {
      for (const y of [ext.y0, ext.y1]) {
        for (const z of [-depth, depth]) {
          _box.expandByPoint(_v.copy(frame.origin).addScaledVector(frame.right, x).addScaledVector(frame.down, y).addScaledVector(frame.normal, z));
        }
      }
    }
    const out: THREE.Mesh[] = [];
    this.o.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
      if (!reachable(m) || this.canvases.has(m) || ignored(m) || !materialOk(m.material)) return;
      const g = m.geometry;
      if (!g.getAttribute("position")) return;
      if (!g.boundingBox) g.computeBoundingBox();
      _mbox.copy(g.boundingBox!).applyMatrix4(m.matrixWorld);
      if (_mbox.intersectsBox(_box)) out.push(m);
    });
    return out;
  }

  // ------------------------------------------------------------ brush

  brushDown(ndc: THREE.Vector2, colorHex: string, width: number, reach: number): void {
    if (!this.active || this.cleanT !== null) return;
    this.endStroke();
    this.brush = {
      ndc: ndc.clone(),
      color: hexRgb(colorHex),
      width,
      reach,
      stroke: null,
      on: null,
      patch: null,
      plane: null,
      load: 1,
      lastPoint: null,
      lastT: 0,
      speed: 0,
      seed: this.nextSeed(0x68e31da4),
      pending: 0,
    };
    this.sampleBrush(this.last || performance.now() / 1000);
    this.o.invalidate();
  }

  brushMove(ndc: THREE.Vector2): void {
    if (!this.brush) return;
    this.brush.ndc.copy(ndc);
    this.o.invalidate();
  }

  brushUp(): void {
    const b = this.brush;
    if (!b) return;
    this.endStroke();
    if (b.pending > 0) this.o.onStat?.({ kind: "brush", amount: b.pending });
    this.brush = null;
    sfx.brushStop();
    this.o.invalidate();
  }

  get brushing(): boolean {
    return this.brush !== null;
  }

  /** Lift the brush (`lift` false: it slides on onto another surface) and mark what its last stamps changed. */
  private endStroke(lift = true): void {
    const b = this.brush;
    if (!b?.stroke) return;
    const st = b.stroke;
    b.load = st.load;
    st.end(lift);
    const r = st.takeChanged();
    if (r) st.surface.touch(r, this.last || performance.now() / 1000);
    b.stroke = null;
  }

  private sampleBrush(now: number): void {
    const b = this.brush;
    if (!b) return;
    // the patch it was painting gave its cell to something else: stop there
    if (b.stroke && !b.on && b.patch && !this.decals.keep(b.patch.rcv, now)) {
      b.stroke.cancel();
      b.stroke = null;
    }
    const hit = this.pick(b.ndc);
    const at = hit && this.brushAt(hit, b);
    if (!hit || !at) {
      this.endStroke();
      sfx.brush(0);
      b.lastPoint = null;
      b.plane = null;
      return;
    }
    const { s, e, patch } = at;
    let from: BrushStroke | null = null;
    if (b.stroke && (e ? b.on !== e : b.on !== null || b.patch !== patch)) {
      // onto another surface: right next to the last point the brush slides
      // on without lifting; across a depth edge it lifts
      from = b.lastPoint && b.lastPoint.distanceTo(hit.point) < STROKE_JUMP ? b.stroke : null;
      this.endStroke(!from);
    }
    b.on = e;
    if (patch) b.patch = patch;
    if (!b.stroke) {
      const grain = e ? grainOf(this.o.renderer, (e.mesh.material as THREE.MeshStandardMaterial).map, s.w, s.h) : null;
      const spec = { color: b.color, width: b.width, reach: b.reach, seed: b.seed++ };
      b.stroke = new BrushStroke(s, at.sx, at.sy, spec, b.load, grain, { clip: at.clip, from });
      // start where the last stroke stopped (as seen: a frame stands proud of
      // the work), so the line runs on unbroken
      if (from && b.lastPoint) {
        const [lx, ly] = this.strokePx(at, this.onPlane(b.lastPoint, hit.point, b.plane ?? hit.normal));
        b.stroke.add(lx, ly, b.lastT);
      }
    }
    b.stroke.add(at.x, at.y, now);
    const changed = b.stroke.takeChanged();
    if (changed) {
      s.touch(changed, now);
      if (e) this.touchWork(e.key);
      this.markDamaged();
    }
    if (b.lastPoint && now > b.lastT) {
      const d = hit.point.distanceTo(b.lastPoint);
      b.speed = b.speed * 0.7 + (d / (now - b.lastT)) * 0.3;
      if (changed && d < STROKE_JUMP) {
        b.pending += d;
        this.addHeat(d * 0.6);
        if (b.pending > 0.25) {
          this.o.onStat?.({ kind: "brush", amount: b.pending });
          b.pending = 0;
        }
      }
    }
    b.lastPoint = hit.point.clone();
    b.lastT = now;
    sfx.brush(b.speed);
  }

  /**
   * Where the brush paints at a hit: the work's own overlay, else a patch
   * around the point (x, y in that surface's pixels; sx, sy px per metre).
   * A work's edge or back takes no paint.
   */
  private brushAt(hit: Hit, b: BrushState): StrokeTarget | null {
    const e = hit.canvas;
    if (e) {
      if (!hit.front || !hit.uv) return null;
      const s = this.ensureSurface(e);
      if (!s) return null;
      b.plane = this.planeAt(hit, null, null);
      return { s, e, patch: null, x: hit.uv.x * s.w, y: (1 - hit.uv.y) * s.h, sx: s.w / e.w, sy: s.h / e.h, clip: s.full };
    }
    const n = (b.plane = this.planeAt(hit, b.plane, b.lastPoint));
    const patch = this.patchAt(hit, n, b.patch, { margin: b.width * 0.6 + 0.01, side: PATCH.brush, prev: b.lastPoint });
    if (!patch) return null;
    const [x, y] = this.patchPx(patch, hit.point);
    const r = patch.rcv;
    return { s: r.surface, e: null, patch, x, y, sx: r.sx, sy: r.sy, clip: r.clip };
  }

  /** A world point in a stroke target's pixels (outside a work's rectangle is fine: the stroke clips). */
  private strokePx(t: StrokeTarget, p: THREE.Vector3): [number, number] {
    if (!t.e) return this.patchPx(t.patch!, p);
    const o = _v.copy(p).applyMatrix4(_inv.copy(t.e.mesh.matrixWorld).invert());
    return [(o.x / t.e.w + 0.5) * t.s.w, (0.5 - o.y / t.e.h) * t.s.h];
  }

  /**
   * Where the line of sight through `p` meets the plane through `at` with
   * normal `n`: a point carried onto a nearer or further surface without a
   * jump on screen.
   */
  private onPlane(p: THREE.Vector3, at: THREE.Vector3, n: THREE.Vector3): THREE.Vector3 {
    const eye = new THREE.Vector3().setFromMatrixPosition(this.o.camera.matrixWorld);
    const d = p.clone().sub(eye);
    const den = d.dot(n);
    if (Math.abs(den) < 1e-6) return p.clone();
    return eye.addScaledVector(d, _v.subVectors(at, eye).dot(n) / den);
  }

  // ---- off the works: patches

  /**
   * The plane a free stroke paints in at a hit: a work's own; else the one
   * it has been moving in (from `last`) while the surface only turns gently
   * (a frame's mouldings) or the point stays close to that plane (a small
   * face turned sideways); else, close to a work, the wall it hangs on.
   */
  private planeAt(hit: Hit, prev: THREE.Vector3 | null, last: THREE.Vector3 | null): THREE.Vector3 {
    if (hit.canvas) return new THREE.Vector3().setFromMatrixColumn(hit.canvas.mesh.matrixWorld, 2).normalize();
    const n = hit.normal;
    if (prev && (prev.dot(n) > 0.5 || (last && Math.abs(_v.subVectors(hit.point, last).dot(prev)) < 0.05))) return prev;
    for (const e of this.canvases.values()) {
      const m = e.mesh.matrixWorld;
      const cn = new THREE.Vector3().setFromMatrixColumn(m, 2).normalize();
      if (cn.dot(n) < 0.5) continue;
      _v.setFromMatrixPosition(m).sub(hit.point);
      if (Math.abs(_v.dot(cn)) < 0.2 && _v.length() < Math.hypot(e.w, e.h) / 2 + 0.4) return cn;
    }
    return n.clone();
  }

  /**
   * The patch a free stroke paints into at a hit (on plane `n`): the current
   * one while the point stays `margin` m inside it (`below` m more at the
   * bottom), else an existing one covering it as well, else a new one of
   * `side` m, set ahead of where the stroke is heading (from `prev`).
   */
  private patchAt(
    hit: Hit,
    n: THREE.Vector3,
    cur: Patch | null,
    { margin, below = 0, side, prev }: { margin: number; below?: number; side: number; prev: THREE.Vector3 | null },
  ): Patch | null {
    const now = this.last || performance.now() / 1000;
    if (cur && this.decals.keep(cur.rcv, now) && this.patchHolds(cur, hit.point, n, margin, below)) return cur;
    const box = { x0: -margin, y0: -margin, x1: margin, y1: margin + below };
    const re = this.decals.reuse(hit.point, n, box, { tol: 0.13, minDot: 0.9, minSide: PATCH.brush * 0.7 });
    if (re && this.decals.keep(re.rcv, now)) return re;
    const frame = this.frameAt(hit.point, n, hit.point.clone().sub(this.o.camera.position));
    // hung a little lower when there must be room below (the spray's runs),
    // and shifted toward where the stroke is going: fewer patches per stroke
    let ax = 0;
    let ay = below;
    if (prev) {
      _v.subVectors(hit.point, prev);
      const x = _v.dot(frame.right);
      const y = _v.dot(frame.down);
      const l = Math.hypot(x, y);
      if (l > 1e-4) {
        const lim = side / 2 - margin - below - 0.02;
        ax = THREE.MathUtils.clamp((x / l) * PATCH_AHEAD * side, -lim, lim);
        ay = THREE.MathUtils.clamp(below + (y / l) * PATCH_AHEAD * side, -lim, lim);
      }
    }
    const sq = { x0: ax - side / 2, y0: ay - side / 2, x1: ax + side / 2, y1: ay + side / 2 };
    const targets = this.decalTargets(frame, sq);
    const rcv = targets.length ? this.decals.add(frame, sq, targets, now, 0.32, side) : null;
    return rcv ? { rcv, frame } : null;
  }

  /** Whether a point on plane `n` lies on a patch, `margin` m inside its edges (`below` m more at the bottom). */
  private patchHolds(p: Patch, point: THREE.Vector3, n: THREE.Vector3, margin: number, below: number): boolean {
    const f = p.frame;
    // a frame's mouldings and the wall behind lie within the projection's depth
    if (f.normal.dot(n) < 0.9 || Math.abs(_v.subVectors(point, f.origin).dot(f.normal)) > 0.13) return false;
    const [x, y] = this.patchPx(p, point);
    const c = p.rcv.clip;
    const mx = margin * p.rcv.sx;
    const my = margin * p.rcv.sy;
    return x - mx > c.x0 && x + mx < c.x1 && y - my > c.y0 && y + my + below * p.rcv.sy < c.y1;
  }

  /** A world point in a patch's atlas pixels (projected along the patch's normal). */
  private patchPx(p: Patch, point: THREE.Vector3): [number, number] {
    const f = p.frame;
    _v.subVectors(point, f.origin);
    return [p.rcv.ox + _v.dot(f.right) * p.rcv.sx, p.rcv.oy + _v.dot(f.down) * p.rcv.sy];
  }

  /** A patch's receiver with its origin at a point on it (splat space around that point). */
  private patchRcv(p: Patch, point: THREE.Vector3): Receiver {
    const [ox, oy] = this.patchPx(p, point);
    const r = p.rcv;
    return { surface: r.surface, ox, oy, sx: r.sx, sy: r.sy, clip: r.clip };
  }

  // ------------------------------------------------------------- food

  /** Throw a food at a screen point (NDC): an egg, a slice of pizza, a burger, an ice cream. False if nothing is there. */
  throwFood(ndc: THREE.Vector2, food: Food): boolean {
    if (food === "egg") return this.throwAt(ndc, "egg", "#ffffff");
    if (!this.active || this.cleanT !== null) return false;
    const hit = this.pick(ndc);
    if (!hit) return false;
    const from = this.hand();
    // a slice floats a little, like a frisbee
    const T = THREE.MathUtils.clamp(0.2 + from.distanceTo(hit.point) * 0.055, 0.25, 0.5) * (food === "pizza" ? 1.12 : 1);
    const seed = this.nextSeed(0x7feb352d);
    // the flavour comes from the seed, so the scoop in the air matches its splat
    const look = food === "icecream" ? flavourOf(seed).id : "";
    this.projectiles.launch(food, from, hit.point, T, look, (vel) => this.impact(food, hit, vel, look, seed));
    this.o.onStat?.({ kind: "food", amount: 1 });
    this.addHeat(1);
    sfx.whoosh(T);
    this.o.invalidate();
    return true;
  }

  /** After a pizza, a burger or an ice cream has splatted: what falls off it, a few flecks, its sound. */
  private foodLanded(kind: FoodKind, hit: Hit, frame: SplatFrame, vel: THREE.Vector3, seed: number, size: number): void {
    const n = frame.normal;
    // pieces lie on the top they hit (a floor, a bench), else they fall to the floor
    const floor = n.y > 0.55 ? hit.point.y : (this.o.floorY ?? 0);
    const low = this.o.quality === "low";
    const sp = this.spatial(hit.point);
    if (kind === "pizza") {
      this.debris.slice(hit.point, frame, sliceAngle(seed, Math.abs(n.y) < 0.55), vel, size, floor, seed);
      sfx.pizza(sp);
    } else if (kind === "burger") {
      this.debris.burger(hit.point, n, vel, floor, seed, low);
      sfx.burger(sp);
    } else {
      this.debris.cone(hit.point, n, vel, floor, seed);
      sfx.icecream(sp);
    }
    const colors = flecks(kind, seed).map((c) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace));
    this.particles.crumbs(hit.point, n, seed, colors, (kind === "pizza" ? 6 : 14) >> (low ? 1 : 0));
  }

  // ------------------------------------------------------------ darts

  /** Throw a dart at a screen point (NDC): it sticks where it lands. False if nothing is there. */
  throwDart(ndc: THREE.Vector2): boolean {
    if (!this.active || this.cleanT !== null) return false;
    const hit = this.pick(ndc);
    if (!hit) return false;
    const from = this.hand();
    const T = THREE.MathUtils.clamp(DART_T.base + from.distanceTo(hit.point) * DART_T.perM, DART_T.min, DART_T.max);
    const seed = this.nextSeed(0x2c1b3c6d);
    const hex = DART_COLORS[Math.floor(this.dartsThrown++ / 3) % DART_COLORS.length];
    this.projectiles.launch("dart", from, hit.point, T, hex, (vel) => this.dartLanded(hit, vel, hex, seed));
    this.o.onStat?.({ kind: "dart", amount: 1 });
    this.addHeat(0.3);
    sfx.dartThrow();
    this.o.invalidate();
    return true;
  }

  /** The dart bites: stuck a little way in along its flight, a puncture under its point. */
  private dartLanded(hit: Hit, vel: THREE.Vector3, hex: string, seed: number): void {
    if (hit.canvas && !this.canvases.has(hit.canvas.mesh)) return; // the work left meanwhile
    if (this.cleanT !== null) return;
    const now = this.last || performance.now() / 1000;
    const n = hit.normal.clone();
    if (n.dot(vel) > 0) n.negate();
    const dir = vel.clone().normalize();
    // a grazing dart still bites: never flatter than ~20° to the surface
    const into = -dir.dot(n);
    if (into < 0.35) dir.addScaledVector(n, into - 0.35).normalize();
    const kind = this.surfaceKind(hit.object, hit.canvas, n);
    const depth = kind === "canvas" ? 0.018 : kind === "gilt" ? 0.008 : kind === "wood" ? 0.016 : 0.012;
    this.darts.stick(hit.point.clone().addScaledVector(dir, depth), dir, hex, seed);
    const frame = this.frameAt(hit.point, n, vel);
    const vt = dir.clone().addScaledVector(n, -dir.dot(n));
    const sinI = vt.length();
    const tl = sinI || 1;
    const plan = buildPuncture(seed, vt.dot(frame.right) / tl, vt.dot(frame.down) / tl, smoothstep(0.3, 0.97, sinI) * 0.85, kind === "canvas");
    for (const rcv of this.receivers(frame, plan.extent, hit, true)) for (const s of plan.shapes) stampShape(s, rcv, now);
    sfx.dartHit(this.spatial(hit.point), kind);
    if (hit.canvas) this.touchWork(hit.canvas.key);
    this.markDamaged();
    this.o.invalidate();
  }

  // ------------------------------------------------------------ spray

  /** Start spraying at a screen point (NDC) with the can's cone (`radius`, m at arm's length). */
  sprayDown(ndc: THREE.Vector2, colorHex: string, radius: number): void {
    if (!this.active || this.cleanT !== null) return;
    this.sprayUp();
    const now = this.last || performance.now() / 1000;
    // a can left alone for a while gets a shake first
    if (now - this.shaken > SHAKE_S) sfx.sprayShake();
    this.shaken = now;
    this.spray = {
      ndc: ndc.clone(),
      can: new SprayCan(hexRgb(colorHex), radius, this.nextSeed(0x2c1b3c6d), SPRAY_LIMITS[this.o.quality ?? "high"]),
      patch: null,
      plane: null,
      mist: new THREE.Color(colorHex),
      puff: 0,
      lastPoint: null,
      pending: 0,
    };
    this.o.invalidate();
  }

  sprayMove(ndc: THREE.Vector2): void {
    if (!this.spray) return;
    this.spray.ndc.copy(ndc);
    this.o.invalidate();
  }

  sprayUp(): void {
    const sp = this.spray;
    if (!sp) return;
    if (sp.pending > 0) this.o.onStat?.({ kind: "spray", amount: sp.pending });
    this.spray = null;
    this.shaken = this.last || performance.now() / 1000;
    sfx.sprayStop();
    this.o.invalidate();
  }

  get spraying(): boolean {
    return this.spray !== null;
  }

  /** One frame of the can: mist on everything the cone covers, paint building up into runs, the hiss. */
  private sampleSpray(now: number, dt: number): void {
    const sp = this.spray;
    if (!sp) return;
    const hit = this.pick(sp.ndc);
    const carry = hit ? sp.can.carry(hit.distance) : 0;
    // into the air, or at the edge of a work (which takes no paint): only the hiss
    if (!hit || carry <= 0 || (hit.canvas && !hit.front)) {
      sp.lastPoint = null;
      sp.plane = null;
      sfx.spray(0);
      return;
    }
    const sigma = sp.can.sigma(hit.distance);
    const reach = sp.can.reach(sigma);
    const n = (sp.plane = this.planeAt(hit, sp.plane, sp.lastPoint));
    const frame = this.frameAt(hit.point, n, hit.point.clone().sub(this.o.camera.position));
    const vertical = Math.abs(n.y) < 0.55;
    // where the axis was a frame ago, as seen on this surface (the mist is
    // laid along the way); a jump is a fresh start
    let back: { x: number; y: number } | null = null;
    if (sp.lastPoint && sp.lastPoint.distanceTo(hit.point) < STROKE_JUMP) {
      _v.subVectors(this.onPlane(sp.lastPoint, hit.point, n), hit.point);
      back = { x: _v.dot(frame.right), y: _v.dot(frame.down) };
    }
    // the works the cone reaches, and unless one takes all of it the patch of wall around
    const bx = back?.x ?? 0;
    const by = back?.y ?? 0;
    const ext = { x0: Math.min(bx, 0) - reach, y0: Math.min(by, 0) - reach, x1: Math.max(bx, 0) + reach, y1: Math.max(by, 0) + reach };
    const targets: SprayTarget[] = [];
    const works: (CanvasEntry | null)[] = [];
    let held = false;
    for (const e of this.canvases.values()) {
      const r = this.canvasReceiver(e, frame, ext, hit);
      if (!r) continue;
      targets.push({ rcv: r.rcv, feather: false });
      works.push(e);
      if (r.contained) held = true;
    }
    if (!held) {
      const p = this.patchAt(hit, n, sp.patch, { margin: Math.min(reach, 0.3), below: vertical ? RUN_ROOM : 0, side: PATCH.spray, prev: back && sp.lastPoint });
      if (p) {
        sp.patch = p;
        targets.push({ rcv: this.patchRcv(p, hit.point), feather: true });
        works.push(null);
      }
    }
    const k = dt * carry;
    const changed = sp.can.spray(targets, sigma, k, back);
    let painted = false;
    for (let i = 0; i < targets.length; i++) {
      const r = changed[i];
      if (!r) continue;
      targets[i].rcv.surface.touch(r, now);
      const e = works[i];
      if (e) this.touchWork(e.key);
      painted = true;
    }
    if (painted) {
      this.markDamaged();
      if (vertical) this.sprayRuns(sp.can.build(hit.point, frame.right, frame.down, sigma, k), targets, now);
      this.addHeat(dt * 0.15);
      if (sp.lastPoint) {
        const d = hit.point.distanceTo(sp.lastPoint);
        if (d < STROKE_JUMP) {
          sp.pending += d;
          this.addHeat(d * 0.5);
        }
        if (sp.pending > 0.25) {
          this.o.onStat?.({ kind: "spray", amount: sp.pending });
          sp.pending = 0;
        }
      }
    }
    sp.lastPoint = hit.point.clone();
    // a faint cloud of the colour hangs where the can is aimed
    if (this.o.quality !== "low" && (sp.puff += dt) > 0.05) {
      sp.puff = 0;
      const r = Math.random;
      this.particles.emit({
        pos: hit.point.clone().addScaledVector(n, 0.02 + 0.04 * r()),
        vel: n.clone().multiplyScalar(0.1 + 0.1 * r()).add(new THREE.Vector3(r() - 0.5, r() - 0.4, r() - 0.5).multiplyScalar(0.12)),
        life: 0.6 + 0.5 * r(),
        size0: sigma * 1.5,
        size1: sigma * 3.5,
        color: sp.mist,
        alpha: 0.05 * carry,
        gravity: 0,
        drag: 2.5,
        shape: Shape.Soft,
      });
    }
    sfx.spray(1 - smoothstep(0.5, 3.5, hit.distance));
  }

  /** Start the runs where the paint has built up, on every surface the cone covers. */
  private sprayRuns(specs: DripSpec[], targets: SprayTarget[], now: number): void {
    // over a wall patch the run carries on past a work's lower edge onto the
    // frame and wall; otherwise it ends before the edge of what it runs down
    const walled = targets.some((t) => t.feather);
    for (const spec of specs) {
      let room = Infinity;
      for (const t of targets) {
        if (walled && !t.feather) continue;
        const r = t.rcv;
        room = Math.min(room, (r.clip.y1 - 2 - (r.oy + spec.y * r.sy)) / r.sy - spec.bead * 1.5);
      }
      if (room < 0.01) continue;
      spec.len = Math.min(spec.len, room);
      const run = new DripRun(spec);
      for (const t of targets) t.rcv.surface.addLive(run.view(t.rcv), now);
      this.runs.push(run);
    }
  }

  // ------------------------------------------------- held: marker, sword

  get held(): HeldKind | null {
    return this.rig.held;
  }

  /** What is in hand (null: nothing; paint, eggs and the brush show nothing). */
  setHeld(kind: HeldKind | null): void {
    if (kind === this.rig.held) return;
    this.triggerUp();
    this.rig.setHeld(kind);
    if (kind === "marker") this.emitHopper();
    this.o.invalidate();
  }

  /** Tools usable (false while inspecting / flying): hides what is held. */
  setEnabled(on: boolean): void {
    if (on === this.heldOn) return;
    this.heldOn = on;
    if (!on) this.triggerUp();
    this.rig.setEnabled(on);
    this.o.invalidate();
  }

  /** Narrow / touch screens: a smaller viewmodel tucked into the corner. */
  setCompact(on: boolean): void {
    this.rig.setCompact(on);
  }

  /** Where the marker's paint comes from (the palette colour, or random team colours). */
  setBallColors(fn: () => { fill: string; shell: string }, hopperHex: string): void {
    this.ballColor = fn;
    this.rig.setBallColor(hopperHex);
    this.o.invalidate();
  }

  triggerDown(ndc: THREE.Vector2, kind: HeldKind): void {
    if (!this.active || this.cleanT !== null || !this.heldOn) return;
    if (this.rig.held !== kind) this.setHeld(kind);
    const now = this.last || performance.now() / 1000;
    if (kind === "sword") {
      if (this.rig.swingTime !== null) return;
      this.trigger = { kind, ndc: ndc.clone(), held: true, next: 0 };
      this.sword = { centre: ndc.clone(), lastA: 0, drag: false, pts: [] };
      this.rig.swing();
      sfx.swordWhoosh();
    } else {
      this.trigger = { kind, ndc: ndc.clone(), held: true, next: now + 1 / MARKER_RATE };
      this.fireBall(ndc, now);
    }
    this.o.invalidate();
  }

  triggerMove(ndc: THREE.Vector2): void {
    if (!this.trigger) return;
    this.trigger.ndc.copy(ndc);
    this.o.invalidate();
  }

  triggerUp(): void {
    const t = this.trigger;
    if (!t) return;
    t.held = false;
    if (t.kind === "sword" && this.sword?.drag) {
      this.finishCut();
      this.sword = null;
      this.rig.setThrust(false);
    }
    if (t.kind !== "sword") this.trigger = null;
    this.o.invalidate();
  }

  /** R: a fresh load in the hopper. */
  refill(): void {
    if (!this.active || this.rig.held !== "marker" || this.refillUntil !== null || this.balls === HOPPER) return;
    const now = this.last || performance.now() / 1000;
    this.refillUntil = now + REFILL_S;
    this.rig.refill(REFILL_S);
    sfx.refill(REFILL_S);
    if (this.trigger) this.trigger.held = false;
    this.emitHopper();
    this.o.invalidate();
  }

  private emitHopper(): void {
    this.o.onHopper?.({ balls: this.balls, cap: HOPPER, refilling: this.refillUntil !== null });
  }

  private fireBall(ndc: THREE.Vector2, now: number): void {
    if (this.refillUntil !== null) return;
    if (this.balls <= 0) {
      if (this.trigger) this.trigger.held = false;
      if (this.o.autoRefill) this.refill();
      return;
    }
    this.balls--;
    const cam = this.o.camera as THREE.PerspectiveCamera;
    // a small cone, opening a little in rapid fire
    const rapid = this.trigger && this.trigger.next < now + 0.5 / MARKER_RATE ? 1 : 0;
    const spreadDeg = 0.3 + 0.7 * rapid;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 55) / 2));
    const a = THREE.MathUtils.degToRad(spreadDeg) * Math.sqrt(Math.random());
    const th = Math.random() * Math.PI * 2;
    const aim = new THREE.Vector2(ndc.x + (Math.tan(a) * Math.cos(th)) / (tanHalf * (cam.aspect ?? 1)), ndc.y + (Math.tan(a) * Math.sin(th)) / tanHalf);
    const seed = this.nextSeed(0x9e3779b9);
    this.rig.fire(0.55);
    sfx.marker();
    // a little kick of the view
    cam.rotateX(0.0025);
    this.o.onStat?.({ kind: "ball", amount: 1 });
    this.addHeat(0.22);
    this.emitHopper();
    const hit = this.pick(aim);
    if (!hit) return;
    const from = this.rig.held ? this.rig.muzzleWorld() : cam.position.clone();
    if (from.lengthSq() === 0) from.copy(cam.position);
    const T = Math.max(0.03, from.distanceTo(hit.point) / BALL_SPEED);
    const { fill, shell } = this.ballColor();
    this.projectiles.launch("ball", from, hit.point, T, fill, (vel) => this.impact("ball", hit, vel, fill, seed, shell));
  }

  /** What a surface is made of (tagged by the gallery, else a guess). */
  private surfaceKind(obj: THREE.Object3D, canvas: CanvasEntry | null, normal: THREE.Vector3): SurfaceKind {
    const tag = obj.userData.fxSurface as SurfaceKind | undefined;
    if (tag) return tag;
    if (canvas) return "canvas";
    const m = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
    const mat = Array.isArray(m) ? m[0] : m;
    if (mat && (mat.metalness ?? 0) > 0.5) return "gilt";
    if (normal.y > 0.7) return "wood";
    return "plaster";
  }

  // ---- the blade

  private swordSample(ndc: THREE.Vector2): void {
    const sw = this.sword;
    if (!sw) return;
    const hit = this.pick(ndc);
    if (!hit || hit.distance > SWORD_REACH) {
      sw.pts.push(null);
      return;
    }
    sw.pts.push({ obj: hit.object, canvas: hit.canvas, point: hit.point, normal: hit.normal, uv: hit.uv });
  }

  /** Turn the blade's track into cuts, one per surface it crossed. */
  private finishCut(): void {
    const sw = this.sword;
    if (!sw) return;
    let run: CutPoint[] = [];
    const flush = () => {
      if (run.length >= 2) this.applyCut(run);
      run = [];
    };
    for (const p of sw.pts) {
      if (!p || (run.length && run[0].obj !== p.obj)) flush();
      if (p) run.push(p);
    }
    flush();
    sw.pts = [];
  }

  private applyCut(run: CutPoint[]): void {
    const now = this.last || performance.now() / 1000;
    let len = 0;
    for (let i = 1; i < run.length; i++) len += run[i].point.distanceTo(run[i - 1].point);
    if (len < 0.012) return;
    const seed = this.nextSeed(0x27d4eb2d);
    const first = run[0];
    const kind = this.surfaceKind(first.obj, first.canvas, first.normal);
    const along = run[run.length - 1].point.clone().sub(first.point);
    let frame: SplatFrame;
    if (first.canvas) {
      const m = first.canvas.mesh.matrixWorld;
      frame = {
        origin: first.point.clone(),
        right: new THREE.Vector3().setFromMatrixColumn(m, 0).normalize(),
        down: new THREE.Vector3().setFromMatrixColumn(m, 1).normalize().negate(),
        normal: new THREE.Vector3().setFromMatrixColumn(m, 2).normalize(),
      };
    } else frame = this.frameAt(first.point, first.normal.clone(), along);
    const toPts = (f: SplatFrame) =>
      run.map((p) => {
        _v.subVectors(p.point, f.origin);
        return { x: _v.dot(f.right), y: _v.dot(f.down) };
      });
    let spec: CutSpec = { seed, kind, pts: toPts(frame) };
    const sp = this.spatial(run[Math.floor(run.length / 2)].point);
    if (first.canvas) {
      const fakeHit: Hit = { point: first.point, normal: frame.normal, object: first.obj, uv: null, canvas: first.canvas, front: true, distance: 0 };
      const r = this.canvasReceiver(first.canvas, frame, cutExtent(spec), fakeHit);
      if (!r) return;
      const cut = new CutRun(spec);
      for (const v of cut.viewsFor(r.rcv)) r.rcv.surface.addLive(v, now);
      this.cuts.push(cut);
      sfx.rip(sp, len);
      const mid = run[Math.floor(run.length / 2)];
      // linen fibres, and flakes of the paint where the blade went in
      const colors = [new THREE.Color().setRGB(0.62, 0.55, 0.42)];
      const map = (first.canvas.mesh.material as THREE.MeshStandardMaterial).map;
      if (mid.uv) {
        const c = sampleMap(this.o.renderer, map, mid.uv.x, mid.uv.y);
        if (c) colors.push(c, c);
      }
      this.particles.flakes(mid.point, frame.normal, seed, colors);
      this.touchWork(first.canvas.key);
    } else {
      const ext = cutExtent(spec);
      const re = this.decals.reuse(frame.origin, frame.normal, ext);
      let rcv: Receiver | null = null;
      if (re) {
        rcv = re.rcv;
        spec = { seed, kind, pts: toPts(re.frame) };
      } else {
        const targets = this.decalTargets(frame, ext);
        rcv = targets.length ? this.decals.add(frame, ext, targets, this.last, 0.32, 0.6) : null;
      }
      if (rcv) stampGouge(rcv, spec, now);
      sfx.scrape(sp, kind === "gilt", len);
      for (let i = 0; i < run.length; i += 4) {
        const p = run[i];
        if (kind === "gilt") this.particles.dust(p.point, p.normal, seed + i, new THREE.Color(0.85, 0.66, 0.3), 0.3);
        else this.particles.dust(p.point, p.normal, seed + i, new THREE.Color(0.8, 0.78, 0.74), 0.25);
      }
    }
    this.o.onStat?.({ kind: "cut", amount: 1 });
    this.addHeat(0.9);
    this.markDamaged();
  }

  private updateHeld(dt: number, now: number): boolean {
    let busy = false;
    const k = this.rig.held;
    const t = this.trigger;
    // the marker keeps firing while held
    if (t && t.kind === "marker" && t.held && k === "marker") {
      while (t.held && now >= t.next) {
        this.fireBall(t.ndc, now);
        t.next += 1 / MARKER_RATE;
      }
      busy = true;
    }
    if (this.refillUntil !== null) {
      if (now >= this.refillUntil) {
        this.balls = HOPPER;
        this.refillUntil = null;
        this.emitHopper();
      }
      busy = true;
    }
    // the blade: sample its arc while the edge is cutting
    const sw = this.sword;
    if (sw && k === "sword") {
      const st = this.rig.swingTime;
      if (st !== null && !sw.drag) {
        const a = THREE.MathUtils.clamp((st - SWORD_CUT.from) / (SWORD_CUT.to - SWORD_CUT.from), 0, 1);
        if (a > sw.lastA) {
          const steps = Math.max(1, Math.ceil((a - sw.lastA) / 0.025));
          for (let i = 1; i <= steps; i++) this.swordSample(arcPoint(sw.lastA + ((a - sw.lastA) * i) / steps, sw.centre));
          sw.lastA = a;
        }
        if (st >= SWORD_CUT.to && sw.pts.length) this.finishCut();
        busy = true;
      } else if (!sw.drag) {
        this.finishCut();
        if (t?.held) {
          // still holding after the swing: drag the edge where you look
          sw.drag = true;
          this.rig.setThrust(true);
        } else {
          this.sword = null;
          this.trigger = null;
        }
      }
      if (sw.drag) {
        this.swordSample(t?.ndc ?? sw.centre);
        // long drags are cut in pieces as they go
        if (sw.pts.length > 40) {
          const tail = sw.pts[sw.pts.length - 1];
          this.finishCut();
          if (tail) sw.pts.push(tail);
        }
        busy = true;
      }
    }
    const cam = this.o.camera as THREE.PerspectiveCamera;
    this.particles.setViewport(this.o.renderer.domElement.height || 800, cam.fov ?? 55);
    if (this.rig.update(dt, cam)) busy = true;
    if (this.cuts.length) {
      for (const c of this.cuts) c.step(dt);
      this.cuts = this.cuts.filter((c) => !c.done);
      busy = true;
    }
    return busy;
  }

  // -------------------------------------------------------- the room

  /** Mess raises the heat; it cools by itself (computed lazily: no frames needed). */
  private addHeat(k: number): void {
    const now = this.last || performance.now() / 1000;
    this.coolTo(now);
    this.heat += k;
    if (!this.alarmOn && this.heat >= HEAT_ON && this.cleanT === null) {
      this.alarmOn = true;
      this.o.invalidate();
    }
  }

  private coolTo(now: number): void {
    if (this.heatAt) this.heat *= Math.exp(-Math.max(0, now - this.heatAt) / HEAT_TAU);
    this.heatAt = now;
  }

  /** The alarm's level (0..1). */
  get alarmLevel(): number {
    return this.alarm;
  }

  private updateRoom(dt: number, now: number): boolean {
    let busy = false;
    // the unlock dip: down fast, a held beat, back up slowly
    if (this.dipT !== null) {
      this.dipT += dt;
      const u = this.dipT / DIP_S;
      const k = u < 0.18 ? smoothstep(0, 0.18, u) : u < 0.42 ? 1 : 1 - smoothstep(0.42, 1, u);
      this.o.renderer.toneMappingExposure = this.baseExposure * (1 - DIP_DEPTH * k);
      if (u >= 1) {
        this.o.renderer.toneMappingExposure = this.baseExposure;
        this.dipT = null;
      }
      busy = true;
    }
    // escalation
    this.coolTo(now);
    if (this.alarmOn && (this.heat < HEAT_OFF || this.cleanT !== null)) this.alarmOn = false;
    const target = this.alarmOn ? 1 : 0;
    if (this.alarm !== target) {
      const rate = dt / (target > this.alarm ? ALARM_UP_S : this.cleanT !== null ? 1.2 : ALARM_DOWN_S);
      this.alarm = target > this.alarm ? Math.min(target, this.alarm + rate) : Math.max(target, this.alarm - rate);
      sfx.setAlarm(this.alarmOn ? Math.max(0.05, this.alarm) : 0);
      this.o.onAlarm?.(this.alarm);
    }
    if (this.alarm > 0) {
      // a slow turning beacon somewhere above: the wash sweeps the room,
      // breathing between amber and red
      const cam = this.o.camera;
      this.beaconA += dt * BEACON_SPIN;
      const a = this.beaconA;
      const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      this.beacon.position.set(
        cam.position.x + fwd.x * 1.6 + Math.cos(a) * 1.4,
        cam.position.y + 1.25,
        cam.position.z + fwd.z * 1.6 + Math.sin(a) * 1.4,
      );
      const pulse = 0.55 + 0.45 * Math.sin(a * 1.0) ** 2;
      this.beacon.color.copy(AMBER).lerp(RED, 0.5 + 0.5 * Math.sin(a * 0.5));
      this.beacon.intensity = BEACON_CD * this.alarm * pulse;
      sfx.tick();
      busy = true;
    } else if (this.beacon.intensity !== 0) {
      this.beacon.intensity = 0;
      busy = true;
    }
    return busy;
  }

  // ------------------------------------------------------------- clean

  /** Call the conservator: the alarm stops, the damage dissolves work by work, the surfaces are freed. */
  clean(): void {
    if (this.cleanT !== null) return;
    this.brushUp();
    this.sprayUp();
    this.triggerUp();
    this.sword = null;
    this.trigger = null;
    this.alarmOn = false;
    this.heat = 0;
    sfx.setAlarm(0);
    // everything damaged, nearest first
    const cam = this.o.camera.position;
    const items: { d: number; set: (t: number) => void; at: THREE.Vector3; work: boolean }[] = [];
    for (const e of this.canvases.values()) {
      if (!e.surface?.painted) continue;
      const at = new THREE.Vector3().setFromMatrixPosition(e.mesh.matrixWorld);
      items.push({ d: at.distanceTo(cam), set: (t) => (e.seq = t), at, work: true });
    }
    const decalSeq: number[] = [];
    for (const c of this.decals.centres()) items.push({ d: c.at.distanceTo(cam), set: (t) => (decalSeq[c.id] = t), at: c.at, work: false });
    const shardSeq: number[] = [];
    this.shards.positions().forEach((p, i) => items.push({ d: p.distanceTo(cam) + 0.5, set: (t) => (shardSeq[i] = t), at: p, work: false }));
    const debrisSeq: number[] = [];
    this.debris.positions().forEach((p, i) => items.push({ d: p.distanceTo(cam) + 0.5, set: (t) => (debrisSeq[i] = t), at: p, work: false }));
    const dartSeq: number[] = [];
    this.darts.positions().forEach((p, i) => items.push({ d: p.distanceTo(cam) + 0.3, set: (t) => (dartSeq[i] = t), at: p, work: false }));
    items.sort((a, b) => a.d - b.d);
    // a beat for the alarm to ring out, then one item after another
    const lead = this.alarm > 0.05 ? 0.6 : 0.25;
    const step = items.length > 1 ? Math.min(0.42, CLEAN_SPAN_S / (items.length - 1)) : 0;
    this.cleanQueue = [];
    items.forEach((it, i) => {
      const t = lead + i * step;
      it.set(t);
      if (it.work || (i % 3 === 0 && !items.some((x) => x.work))) this.cleanQueue.push({ at: t, sp: it.at, done: false });
    });
    this.decals.setSequence((id) => decalSeq[id] ?? lead);
    this.decals.uniforms.uOvlSeqDur.value = CLEAN_ITEM_S;
    this.shards.setSequence((i) => shardSeq[i] ?? lead, CLEAN_ITEM_S * 0.8);
    this.debris.setSequence((i) => debrisSeq[i] ?? lead, CLEAN_ITEM_S * 0.8);
    this.darts.setSequence((i) => dartSeq[i] ?? lead, CLEAN_ITEM_S * 0.6);
    this.cleanEnd = lead + Math.max(0, items.length - 1) * step + CLEAN_ITEM_S + 0.15;
    this.cleanT = 0;
    this.particles.clear();
    sfx.conservator();
    this.o.invalidate();
  }

  get cleaning(): boolean {
    return this.cleanT !== null;
  }

  private stepClean(dt: number): void {
    if (this.cleanT === null) return;
    const t = (this.cleanT += dt);
    for (const e of this.canvases.values()) {
      if (e.uniforms && e.surface) e.uniforms.uOvlFade.value = 1 - smoothstep(e.seq, e.seq + CLEAN_ITEM_S, t);
    }
    this.decals.uniforms.uOvlSeqT.value = t;
    this.shards.setClock(t);
    this.debris.setClock(t);
    this.darts.setClock(t);
    for (const q of this.cleanQueue) {
      if (!q.done && t >= q.at) {
        q.done = true;
        sfx.wipe(this.spatial(q.sp));
      }
    }
    if (t >= this.cleanEnd) {
      this.cleanT = null;
      this.wipe();
      sfx.restored();
      this.o.onCleaned?.();
    }
  }

  private wipe(): void {
    for (const e of this.canvases.values()) this.releaseSurface(e);
    this.parked.forEach((p) => p.dispose());
    this.parked.clear();
    this.decals.clear();
    this.decals.release();
    this.decals.uniforms.uOvlSeqT.value = -1;
    this.runs = [];
    this.cuts = [];
    this.projectiles.clear();
    this.shards.clear();
    this.debris.clear();
    this.darts.clear();
    this.particles.clear();
    this.cleanQueue = [];
    this.wet = false;
    this.damaged = false;
  }

  // ------------------------------------------------------------ frame

  /**
   * Advance to `now` (seconds) and upload what changed. Returns true while
   * something is animating (keep rendering); see wakeIn() for drying.
   */
  update(now: number): boolean {
    if (!this.active) return false;
    const dt = this.last ? Math.min(0.05, Math.max(0, now - this.last)) : 1 / 60;
    this.last = now;
    let busy = false;
    if (this.projectiles.update(dt)) busy = true;
    if (this.shards.update(dt)) busy = true;
    if (this.debris.update(dt)) busy = true;
    if (this.darts.update(dt)) busy = true;
    if (this.particles.update(dt)) busy = true;
    if (this.runs.length) {
      for (const r of this.runs) r.step(dt);
      // finished runs are committed by their surfaces' refresh below
      this.runs = this.runs.filter((r) => !r.done);
      busy = true;
    }
    if (this.brush) {
      this.sampleBrush(now);
      busy = true;
    }
    if (this.spray) {
      this.sampleSpray(now, dt);
      busy = true;
    }
    if (this.updateHeld(dt, now)) busy = true;
    if (this.cleanT !== null) {
      this.stepClean(dt);
      busy = true;
    }
    if (this.updateRoom(dt, now)) busy = true;
    let wet = false;
    const surfaces: PaintSurface[] = [];
    for (const e of this.canvases.values()) if (e.surface) surfaces.push(e.surface);
    if (this.decals.surface) surfaces.push(this.decals.surface);
    for (const s of surfaces) {
      if (s.hasLive()) s.refreshLive(now);
      if (s.dry(now, this.q.dryTick)) wet = true;
      s.flush(this.o.renderer);
    }
    this.wet = wet;
    return busy;
  }

  /** Seconds until the next drying step is due while idle (null: nothing wet). */
  wakeIn(): number | null {
    return this.wet ? this.q.dryTick : null;
  }

  /** Counts for tests: GPU-side objects and live work. */
  debug(): Record<string, number> {
    let surfaces = 0;
    for (const e of this.canvases.values()) if (e.surface) surfaces++;
    return {
      surfaces,
      parked: this.parked.size,
      decals: this.decals.count,
      shards: this.shards.count,
      debris: this.debris.count,
      darts: this.darts.count,
      runs: this.runs.length,
      cuts: this.cuts.length,
      heat: this.heat,
      alarm: this.alarm,
      balls: this.balls,
    };
  }
}
