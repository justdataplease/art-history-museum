"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import type { ArtistWithPaintings } from "@/lib/types";
import type { GalleryLayout, Placement } from "./layout";
import type { GalleryTheme } from "./theme";
import { PaintingExhibit } from "./PaintingExhibit";
import { EnvSetup, Lighting, Room } from "./Room";
import { EntryDolly, InspectCamera, Player, TouchPlayer, type LockApi } from "./Controls";
import { useMoving } from "./renderer-motion";

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

/** Compile programs on the GPU's worker threads (KHR_parallel_shader_compile)
 *  instead of stalling the first frame. Both variants are needed: drei's
 *  floor reflector renders into a target (linear output, no tone mapping),
 *  the main pass to the screen.
 *
 *  gl.compile() only creates the programs (the driver links them in the
 *  background); readiness is then polled on the renderer's live program list.
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
    gl.compile(scene, rtCam);
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

/** Drop to 1x pixel ratio when walking runs below ~40 fps, back up when it
 *  holds 60. Only sampled while frames are continuous (walking): in demand
 *  mode an idle canvas would otherwise read as a slow one. */
function AdaptiveDpr({ onDprCap }: { onDprCap: (cap: number) => void }) {
  const moving = useMoving();
  const cap = useRef(1.5);
  const flips = useRef(0);
  const [settled, setSettled] = useState(false);
  if (!moving || settled) return null;
  const set = (v: number) => {
    if (cap.current === v) return;
    cap.current = v;
    onDprCap(v);
    if (++flips.current >= 4) {
      // it keeps flip-flopping: settle on the cheap setting
      cap.current = 1;
      onDprCap(1);
      setSettled(true);
    }
  };
  return <PerformanceMonitor onDecline={() => set(1)} onIncline={() => set(1.5)} />;
}
