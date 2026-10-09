"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ArtistWithPaintings, GalleryLink, RoomFloor } from "@/lib/types";
import {
  confine,
  entryGate,
  entryZ,
  EYE_HEIGHT,
  spawnZ,
  type GalleryLayout,
  type Placement,
} from "./layout";
import type { GalleryTheme } from "./theme";
import { PaintingExhibit } from "./PaintingExhibit";
import { EnvSetup, Lighting, Room } from "./Room";
import { EntryDolly, InspectCamera, Player, TouchPlayer, type LockApi } from "./Controls";
import { isMoving } from "./renderer-motion";
import { planExhibitLights, roomDims } from "./exhibit-lights";
import { lodAt, SuiteRuntime, type Lod } from "./suite-runtime";
import { textureStats } from "./exhibit-texture";
import { FxSlot } from "./fx/Slot";
import { Elevator, type ElevatorApi, type LiftDirection } from "./Elevator";
import { ExitDoors, type ExitSide } from "./ExitDoors";

export type { LockApi };

/** Exhibits mounted per frame while a long suite's window moves (the rest
 *  of the window follows over the next frames, nearest rooms first). */
const MOUNTS_PER_FRAME = 3;

export interface TeleportApi {
  /** Put the visitor at the entrance of `room`, facing into it. */
  go(room: number): void;
  /** Put the visitor in front of the elevator, facing it (a custom room's floors). */
  toElevator(): void;
  /** The room's lights are up and its works hung: the fade may clear. */
  settled(): boolean;
}

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
  /** The works the reflection probe sees have settled (loaded or failed):
   *  every painting in a single room, the visitor's room in a suite. */
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
  /** The visitor walked into another room of a suite (index, entrance room 0). */
  onRoom?: (room: number) => void;
  /** Filled here: the room navigator's jump (MuseumApp fades around it). */
  teleportApi?: RefObject<TeleportApi | null>;
  /** Filled here: the camera, for the audio guide (it checks what the visitor stands near). */
  cameraRef?: RefObject<THREE.Camera | null>;
  /** A custom room's floors: the elevator beside the entrance doors (layout.elevator). */
  lift?: {
    floors: RoomFloor[];
    /** This floor, 1-based. */
    floor: number;
    /** The visitor came up (or down) by the elevator: step out of it rather than in through the doors. */
    arrivedByLift: boolean;
    apiRef: RefObject<ElevatorApi | null>;
    onNear: (near: boolean) => void;
    onPress: (dir: LiftDirection) => void;
  };
  /** An artist's gallery: the doors to the artists before and after (layout.exits). */
  exits?: {
    prev: GalleryLink | null;
    next: GalleryLink | null;
    onThrough: (side: ExitSide) => void;
    onNear: (near: boolean) => void;
  };
}

export const Gallery = memo(function Gallery(props: GalleryProps) {
  const { artist, layout, theme } = props;
  const meshRegistry = useRef(new Map<string, THREE.Mesh>());
  const focusSlug = props.inspect?.painting.slug ?? null;

  // Every exhibit's track heads, planned up front; their lights are a fixed
  // pool in the runtime (one per head in a single room, POOL_MAX in a suite).
  const lights = useMemo(
    () => layout.placements.map((pl) => planExhibitLights(pl, theme, roomDims(layout, pl))),
    [layout, theme]
  );
  const runtime = useMemo(
    () =>
      new SuiteRuntime(layout, lights, {
        color: theme.light.spot,
        gate: entryGate(layout),
        start: { x: 0, z: entryZ(layout) },
      }),
    [layout, lights, theme.light.spot]
  );
  useEffect(() => () => runtime.dispose(), [runtime]);

  // ---- which exhibits exist: a long suite hangs only the rooms around the
  // visitor (full detail next door, frame + canvas two rooms away). When the
  // visitor changes rooms, the window moves; newcomers mount a few per frame.
  const [room, setRoom] = useState(() => runtime.currentRoom());
  useEffect(() => runtime.onWindowChange(() => setRoom(runtime.currentRoom())), [runtime]);
  const target = useMemo(() => {
    const t = new Map<string, Lod>();
    // nearest rooms first: the order newcomers are mounted in
    const byNear = [...layout.placements].sort((a, b) => Math.abs(a.room - room) - Math.abs(b.room - room));
    for (const pl of byNear) {
      const lod = lodAt(pl.room, room);
      if (lod) t.set(pl.painting.slug, lod);
    }
    return t;
  }, [layout, room]);
  const [mounted, setMounted] = useState(target);
  const mountedRef = useRef(mounted);
  const targetRef = useRef(target);
  targetRef.current = target;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const prev = mountedRef.current;
      const next = new Map(prev);
      let changed = false;
      // leaving the window, or dropping to frame + canvas: at once (frees memory)
      for (const [slug, lod] of prev) {
        const t = target.get(slug);
        if (!t) {
          next.delete(slug);
          changed = true;
        } else if (t === "lite" && lod === "full") {
          next.set(slug, "lite");
          changed = true;
        }
      }
      let budget = MOUNTS_PER_FRAME;
      for (const [slug, t] of target) {
        if (budget === 0) break;
        if (next.get(slug) === t) continue;
        next.set(slug, t);
        changed = true;
        budget--;
      }
      if (!changed) return;
      mountedRef.current = next;
      setMounted(next);
      invalidate();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, invalidate]);

  // ---- the room navigator's jump
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const ref = props.cameraRef;
    if (!ref) return;
    ref.current = camera;
    return () => {
      if (ref.current === camera) ref.current = null;
    };
  }, [props.cameraRef, camera]);
  useEffect(() => {
    const api = props.teleportApi;
    if (!api) return;
    const tp: TeleportApi = {
      go(r: number) {
        const n = layout.rooms.length;
        const to = Math.max(0, Math.min(n - 1, r));
        // just inside the room's doorway (the spawn point in the first room),
        // facing down the room
        const d = layout.doorways[to - 1];
        const p = { x: 0, z: to === 0 ? spawnZ(layout) : d.z - d.thickness / 2 - 1.6 };
        confine(p, layout);
        camera.position.set(p.x, EYE_HEIGHT, p.z);
        camera.rotation.set(0, 0, 0, "YXZ");
        camera.updateMatrixWorld();
        runtime.teleport(to);
        invalidate();
      },
      toElevator() {
        const lift = layout.elevator;
        if (!lift) return this.go(0);
        const p = { x: lift.x, z: layout.hallLength / 2 - 2.1 };
        confine(p, layout);
        camera.position.set(p.x, EYE_HEIGHT, p.z);
        camera.rotation.set(0, Math.PI, 0, "YXZ");
        camera.updateMatrixWorld();
        runtime.teleport(0);
        invalidate();
      },
      settled() {
        // the window's newcomers are mounted and the lights have come up
        if (!runtime.settled()) return false;
        const want = targetRef.current;
        const have = mountedRef.current;
        if (have.size !== want.size) return false;
        for (const [slug, lod] of want) if (have.get(slug) !== lod) return false;
        return true;
      },
    };
    api.current = tp;
    return () => {
      if (api.current === tp) api.current = null;
    };
  }, [props.teleportApi, layout, camera, runtime, invalidate]);

  return (
    <>
      <CameraLayers />
      <EnvSetup layout={layout} theme={theme} ready={!!props.ready} runtime={runtime} />
      <Lighting layout={layout} theme={theme} focused={!!props.inspect} runtime={runtime} />
      <Room layout={layout} theme={theme} runtime={runtime} />
      {/* the spotlight pool: a fixed count from the first frame */}
      <primitive object={runtime.root} />
      {layout.placements.map((pl, i) => {
        const lod = mounted.get(pl.painting.slug);
        return lod ? (
          <PaintingExhibit
            key={pl.painting.slug}
            placement={pl}
            artistName={pl.painting.artistName ?? artist.name}
            focusSlug={focusSlug}
            registry={meshRegistry.current}
            theme={theme}
            lights={lights[i]}
            runtime={runtime}
            lod={lod}
            onSettled={props.onSettled}
          />
        ) : null;
      })}
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
      <EntryDolly
        entering={props.entering}
        layout={layout}
        onArrived={props.onArrived}
        fromX={props.lift?.arrivedByLift && layout.elevator ? layout.elevator.x : undefined}
      />
      {layout.elevator && props.lift && (
        <Elevator
          spot={layout.elevator}
          hallLength={layout.hallLength}
          theme={theme}
          floors={props.lift.floors}
          floor={props.lift.floor}
          runtime={runtime}
          enabled={props.walkEnabled}
          apiRef={props.lift.apiRef}
          onNear={props.lift.onNear}
          onPress={props.lift.onPress}
        />
      )}
      {layout.exits && props.exits && (
        <ExitDoors
          spot={layout.exits}
          hallLength={layout.hallLength}
          runtime={runtime}
          prev={props.exits.prev}
          next={props.exits.next}
          enabled={props.walkEnabled}
          onThrough={props.exits.onThrough}
          onNear={props.exits.onNear}
        />
      )}
      {/* after the controls: it reads the camera they have just moved */}
      <SuiteDirector
        runtime={runtime}
        focusSlug={focusSlug}
        open={props.entering}
        onRoom={props.onRoom}
      />
      <AdaptiveDpr onDprCap={props.onDprCap} />
      <FxSlot
        registry={meshRegistry.current}
        enabled={props.walkEnabled}
        touch={props.touch}
        compile={() => props.warmApi.current?.run() ?? Promise.resolve()}
      />
      {/* last, so its effect runs after the room and exhibits have set up */}
      <Warmup api={props.warmApi} />
    </>
  );
});

/** Drives the runtime each rendered frame: spot fades and focus gains,
 *  texture tiers, portal culling and the current room. */
function SuiteDirector({
  runtime,
  focusSlug,
  open,
  onRoom,
}: {
  runtime: SuiteRuntime;
  focusSlug: string | null;
  open: boolean;
  onRoom?: (room: number) => void;
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    runtime.setFocus(focusSlug);
    invalidate();
  }, [runtime, focusSlug, invalidate]);
  useEffect(() => {
    runtime.setOpen(open);
    invalidate();
  }, [runtime, open, invalidate]);
  useEffect(() => (onRoom ? runtime.onRoomChange(onRoom) : undefined), [runtime, onRoom]);
  // Test hook: an init script sets window.__MUSEUM_DEBUG__ to reach the
  // camera, layout and runtime from automation (nothing is exposed otherwise).
  useEffect(() => {
    const w = window as unknown as { __MUSEUM_DEBUG__?: boolean; __museum?: unknown };
    if (!w.__MUSEUM_DEBUG__) return;
    w.__museum = { camera, layout: runtime.layout, runtime, invalidate, textureStats };
    return () => {
      w.__museum = undefined;
    };
  }, [camera, runtime, invalidate]);
  useFrame((state, dt) => {
    if (runtime.update(camera.position, dt)) state.invalidate();
  });
  return null;
}

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
