"use client";

import { memo, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ArtistWithPaintings } from "@/lib/types";
import type { GalleryLayout, Placement } from "./layout";
import type { GalleryTheme } from "./theme";
import { PaintingExhibit } from "./PaintingExhibit";
import { EnvSetup, Lighting, Room } from "./Room";
import { EntryDolly, InspectCamera, Player, TouchPlayer, type LockApi } from "./Controls";
import { isMoving } from "./renderer-motion";

export type { LockApi };

export interface WarmupApi {
  /** Compile every material currently in the scene (screen and reflection
   *  variants) without blocking; resolves when the programs are linked. */
  run(): Promise<void>;
}

export interface GalleryProps {
  artist: ArtistWithPaintings;
  layout: GalleryLayout;
  theme: GalleryTheme;
  inspect: Placement | null;
  onSelect: (pl: Placement) => void;
  onAim: (aimed: boolean) => void;
  onLockChange: (locked: boolean) => void;
  walkEnabled: boolean;
  entering: boolean;
  /** Every painting texture has settled (loaded or failed). */
  ready?: boolean;
  /** A painting's wall texture loaded or failed (fires once per painting). */
  onSettled: (slug: string) => void;
  /** The entry walk through the doorway has finished. */
  onArrived: () => void;
  /** The camera is back from an inspect fly-to. */
  onReturned: () => void;
  /** Filled by the desktop Player: request pointer lock from a click. */
  lockApi: RefObject<LockApi | null>;
  /** Filled by Warmup: async shader compile behind the closed doors. */
  warmApi: RefObject<WarmupApi | null>;
  /** Adaptive resolution: the highest device-pixel-ratio worth rendering at. */
  onDprCap: (cap: number) => void;
  /** Touch device: drag to look, tap to walk / inspect (no pointer lock). */
  touch: boolean;
  /** Touch mode: the visitor has dismissed the "step inside" overlay. */
  touchActive: boolean;
}

export const Gallery = memo(function Gallery(props: GalleryProps) {
  const { artist, layout, theme } = props;
  const meshRegistry = useRef(new Map<string, THREE.Mesh>());
  const focusSlug = props.inspect?.painting.slug ?? null;

  return (
    <>
      <CameraLayers />
      <EnvSetup layout={layout} theme={theme} ready={!!props.ready} />
      <Lighting layout={layout} theme={theme} focused={!!props.inspect} />
      <Room layout={layout} theme={theme} />
      {layout.placements.map((pl) => (
        <PaintingExhibit
          key={pl.painting.slug}
          placement={pl}
          artistName={artist.name}
          focusSlug={focusSlug}
          registry={meshRegistry.current}
          theme={theme}
          layout={layout}
          onSettled={props.onSettled}
        />
      ))}
      {props.touch ? (
        <TouchPlayer
          layout={layout}
          registry={meshRegistry.current}
          walkEnabled={props.walkEnabled}
          active={props.touchActive}
          onSelect={props.onSelect}
        />
      ) : (
        <Player
          layout={layout}
          registry={meshRegistry.current}
          walkEnabled={props.walkEnabled}
          onSelect={props.onSelect}
          onAim={props.onAim}
          onLockChange={props.onLockChange}
          lockApi={props.lockApi}
        />
      )}
      <InspectCamera inspect={props.inspect} layout={layout} onReturned={props.onReturned} />
      <EntryDolly entering={props.entering} layout={layout} onArrived={props.onArrived} />
      <AdaptiveDpr onDprCap={props.onDprCap} />
      {/* last, so its effect runs after the room and exhibits have set up */}
      <Warmup api={props.warmApi} />
    </>
  );
});

/** The main camera also sees layer 1: small props that should not appear in
 *  the floor reflection live there (drei's reflector camera sees layer 0). */
function CameraLayers() {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    camera.layers.enable(1);
  }, [camera]);
  return null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const drawable = (o: THREE.Object3D) =>
  !!(
    (o as THREE.Mesh).isMesh ||
    (o as THREE.Points).isPoints ||
    (o as THREE.Line).isLine ||
    (o as THREE.Sprite).isSprite
  );

/** Compile programs on the GPU's worker threads (KHR_parallel_shader_compile)
 *  instead of stalling the first frame. Both variants are needed: drei's
 *  floor reflector renders into a target (linear output, no tone mapping),
 *  the main pass to the screen.
 *
 *  gl.compile() only creates the programs (the driver links them in the
 *  background); readiness is then polled on the renderer's live program list.
 *  The reflection variant is compiled object by object, only for layer 0:
 *  compile() filters lights by the camera's layers but not meshes, so the
 *  layer-1 props would get render-target programs that are never drawn.
 *  (compileAsync's own poll dereferences each material's current program and
 *  throws if a material is disposed meanwhile, e.g. an exhibit swapping its
 *  fallback for the loaded canvas.) */
async function precompile(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): Promise<void> {
  const rt = new THREE.WebGLRenderTarget(1, 1);
  // the reflector's virtual camera is a fresh camera: layer 0 only
  const rtCam = camera.clone();
  rtCam.layers.set(0);
  const prev = gl.getRenderTarget();
  try {
    gl.setRenderTarget(rt);
    scene.traverse((o) => {
      if (drawable(o) && o.layers.test(rtCam.layers)) gl.compile(o, rtCam, scene);
    });
    gl.setRenderTarget(prev);
    gl.compile(scene, camera);
  } finally {
    gl.setRenderTarget(prev);
    rt.dispose();
  }
  const deadline = performance.now() + 8000;
  const ready = () =>
    // entries can be released (undefined) while this polls
    (gl.info.programs ?? []).every(
      (p) => (p as unknown as { isReady?(): boolean } | undefined)?.isReady?.() ?? true
    );
  while (performance.now() < deadline && !ready()) await sleep(16);
}

function Warmup({ api }: { api: RefObject<WarmupApi | null> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const warm: WarmupApi = { run: () => precompile(gl, scene, camera) };
    api.current = warm;
    // Start right away (in parallel with the image downloads); MuseumApp
    // runs it again once the first works have arrived, which then only has
    // the newly mounted canvas materials left to compile.
    const t = setTimeout(() => {
      warm.run().catch(() => {});
    }, 0);
    return () => {
      clearTimeout(t);
      if (api.current === warm) api.current = null;
    };
  }, [gl, scene, camera, api]);
  return null;
}

const DPR_WINDOW_MS = 250; // one frame-rate sample
const DPR_WINDOWS = 10; // samples per decision: 2.5 s of walking in all
const DPR_MAX_GAP_MS = 250; // a slower frame is a stall or an idle canvas, not a rate

/** Drop to 1x pixel ratio when walking runs below ~40 fps, back up when it
 *  holds 60 (drei PerformanceMonitor's bounds and 3/4 majority). Only sampled
 *  while frames are continuous (walking): in demand mode an idle canvas, or
 *  one redrawn per look event, would otherwise read as a slow one. Finished
 *  samples are kept across walking bursts, so short hops add up to a
 *  decision; only the sample in progress is dropped when walking stops. */
function AdaptiveDpr({ onDprCap }: { onDprCap: (cap: number) => void }) {
  const st = useRef({
    cap: 1.5,
    flips: 0,
    settled: false,
    t0: 0, // start of the sample in progress (0: none)
    last: 0,
    frames: 0,
    fps: [] as number[],
    refresh: 0, // highest rate seen: tells a 120 Hz screen from a 60 Hz one
  });

  const set = (v: number) => {
    const s = st.current;
    if (s.cap === v) return;
    s.cap = v;
    onDprCap(v);
    if (++s.flips >= 4) {
      // it keeps flip-flopping: settle on the cheap setting
      s.cap = 1;
      onDprCap(1);
      s.settled = true;
    }
  };

  useFrame(() => {
    const s = st.current;
    if (s.settled) return;
    if (!isMoving()) {
      s.t0 = 0;
      return;
    }
    const now = performance.now();
    if (s.t0 === 0 || now - s.last > DPR_MAX_GAP_MS) {
      s.t0 = s.last = now;
      s.frames = 0;
      return;
    }
    s.last = now;
    s.frames += 1;
    if (now - s.t0 < DPR_WINDOW_MS) return;
    const fps = (s.frames * 1000) / (now - s.t0);
    s.t0 = now;
    s.frames = 0;
    s.refresh = Math.max(s.refresh, fps);
    s.fps.push(fps);
    if (s.fps.length < DPR_WINDOWS) return;
    const [lower, upper] = s.refresh > 100 ? [60, 100] : [40, 60];
    // a screen's full rate measures a little under it (the odd dropped frame)
    const fast = s.fps.filter((v) => v >= upper * 0.9).length;
    const slow = s.fps.filter((v) => v < lower).length;
    s.fps.length = 0;
    if (slow > DPR_WINDOWS * 0.75) set(1);
    else if (fast > DPR_WINDOWS * 0.75) set(1.5);
  });
  return null;
}
