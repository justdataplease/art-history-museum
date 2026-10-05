"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { inspectTexturePx, paintingTextureUrl, wallTexturePx } from "@/lib/img";
import { PLACARD_H, PLACARD_W, WALL_GAP, frameAllowance, placardLocal, type Placement } from "./layout";
import type { GalleryTheme } from "./theme";
import { useGalleryEnv } from "./env-store";
import { buildFrame } from "./frames";
import {
  bindEnv,
  canvasRoughness,
  canvasWeaveTexture,
  canvasWhiteBalance,
  createFixtureMaterial,
  LENS_GLOW,
  frameMaterial,
  hasWeave,
} from "./exhibit-materials";
import { acquireTexture, placeholderTexture, releaseTexture, scheduleUpload } from "./exhibit-texture";
import {
  PLACARD_T,
  blankPlacardTexture,
  drawPlacard,
  placardFontsReady,
} from "./exhibit-placard";
import {
  canvasGeometry,
  fixtureGeometry,
  hallFromPlacement,
  placardGeometry,
  planLights,
  type HallDims,
} from "./exhibit-geometry";
import { createShadowMaterial, shadowQuad } from "./exhibit-shadow";

// ------------------------------------------------------------------ tuning

/**
 * Target illuminance-like level at the aim point (spot intensity is solved
 * per fixture as E·d²/cosθ so every work gets the same light, whatever its
 * throw). Tuned for NeutralToneMapping at exposure 1.0.
 */
const SPOT_E = 3.4;
const FOCUS_GAIN = 1.3; // the inspected work
const DIM_GAIN = 0.07; // everything else while inspecting
const SPOT_PENUMBRA = 0.3;
/**
 * Pale "white cube" walls (early-modern, post-war) show a spot's pool far more
 * than dark silk or distemper does, and their rooms already have a wall-wash:
 * a softer, slightly dimmer beam keeps the pool from reading as a hard disc.
 */
function spotTune(era: GalleryTheme["era"]): { level: number; penumbra: number } {
  return era === "early-modern" || era === "postwar"
    ? { level: 0.85, penumbra: 0.45 }
    : { level: 1, penumbra: SPOT_PENUMBRA };
}
/** A single head covers works up to this cone half-angle; bigger works get two heads. */
const SPLIT_HALF_ANGLE = THREE.MathUtils.degToRad(33);
/** Never open a cone wider than this (it would wash neighbours and the floor). */
const MAX_HALF_ANGLE = THREE.MathUtils.degToRad(52);
/** A failed image is retried this many times (after a short, jittered wait). */
const MAX_RETRIES = 1;
/** Seconds the inspect fly-in takes; the hi-res upload waits until it lands. */
const INSPECT_TWEEN_MS = 1400;
/** Keep the hi-res scan this long after leaving inspect, then release it. */
const HIRES_LINGER_MS = 1500;
/** Varnish reflectance relative to a clean dielectric (F0 0.04). */
const VARNISH_SPECULAR = 0.4;
/** Canvas-weave relief (normal-map scale). */
const WEAVE_STRENGTH = 0.32;
/** Strength of the cast wall shadow at rest. */
const CAST_SHADOW = 0.62;

// Layer 1: seen by the main camera, skipped by the floor reflection.
const PROP_LAYER = 1;

export interface PaintingExhibitProps {
  placement: Placement;
  artistName: string;
  focusSlug: string | null;
  registry: Map<string, THREE.Mesh>;
  theme: GalleryTheme;
  /** Fires exactly once, when the wall texture has loaded or failed. */
  onSettled?: (slug: string) => void;
  /** Hall dimensions (for the lighting track); derived from the placement when omitted. */
  layout?: Partial<HallDims>;
}

export function PaintingExhibit(props: PaintingExhibitProps) {
  const slug = props.placement.painting.slug;
  const settled = useRef(false);
  const onSettledRef = useRef(props.onSettled);
  onSettledRef.current = props.onSettled;
  const settle = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    onSettledRef.current?.(slug);
  }, [slug]);

  return (
    <ExhibitBoundary onError={settle} fallback={<ExhibitFallback placement={props.placement} />}>
      <ExhibitBody {...props} settle={settle} />
    </ExhibitBoundary>
  );
}

// One broken exhibit must never take the gallery down.
class ExhibitBoundary extends Component<
  { fallback: ReactNode; onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[exhibit] failed, showing fallback:", err);
    this.props.onError();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ExhibitFallback({ placement }: { placement: Placement }) {
  return (
    <mesh position={placement.position} rotation-y={placement.rotationY}>
      <planeGeometry args={[placement.w, placement.h]} />
      <meshStandardMaterial color="#c4bcac" roughness={0.95} />
    </mesh>
  );
}

// -------------------------------------------------------------------- body

function ExhibitBody({
  placement,
  artistName,
  focusSlug,
  registry,
  theme,
  layout,
  settle,
}: PaintingExhibitProps & { settle: () => void }) {
  const { painting, w, h } = placement;
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const env = useGalleryEnv();
  const isFocused = focusSlug === painting.slug;
  const somethingFocused = focusSlug !== null;

  // Props live on layer 1; the main camera must see it (idempotent).
  useEffect(() => {
    camera.layers.enable(PROP_LAYER);
    invalidate();
  }, [camera, invalidate]);

  // ---- frame
  const frame = useMemo(
    () => buildFrame(theme.frame.style, w, h, theme.frame.width, frameAllowance(w, h)),
    [theme.frame.style, theme.frame.width, w, h],
  );
  useEffect(() => () => frame.geometry.dispose(), [frame]);
  const frameMat = frameMaterial(theme);
  const frameEnvStrength = (frameMat.userData.envBase as number | undefined) ?? 1;
  useEffect(() => {
    bindEnv(frameMat, env);
    invalidate();
  }, [frameMat, env, invalidate]);

  // ---- placard: right of the frame where the layout reserved room for it
  const card = useMemo(() => {
    const { x, y } = placardLocal(placement, frame.outer);
    return { x, y, z: -WALL_GAP };
  }, [placement, frame.outer]);

  // ---- fixtures + spotlights (one per work; two for monumental works)
  const hall = useMemo(() => hallFromPlacement(placement, layout), [placement, layout]);
  const spot = spotTune(theme.era);
  const light = useMemo(() => {
    const outer = { x0: -w / 2 - frame.outer, x1: w / 2 + frame.outer, y0: -h / 2 - frame.outer, y1: h / 2 + frame.outer };
    const heads = planLights(placement, hall, outer, frame.canvasZ, {
      level: SPOT_E * spot.level,
      penumbra: spot.penumbra,
      splitAt: SPLIT_HALF_ANGLE,
      maxHalf: MAX_HALF_ANGLE,
    });
    // mean lens position in exhibit-local coordinates (for the analytic shadow)
    const mean = new THREE.Vector3();
    heads.forEach((l) => mean.add(l.plan.lens));
    mean.divideScalar(heads.length).sub(new THREE.Vector3(...placement.position));
    const c = Math.cos(placement.rotationY);
    const s = Math.sin(placement.rotationY);
    const local = new THREE.Vector3(mean.x * c - mean.z * s, mean.y, mean.x * s + mean.z * c);
    const targets = heads.map((l) => {
      const o = new THREE.Object3D();
      o.position.copy(l.plan.target);
      o.updateMatrixWorld();
      return o;
    });
    return { heads, targets, local };
  }, [placement, hall, h, w, frame, spot.level, spot.penumbra]);

  const fixtureOrigin = light.heads[0].plan.mount;
  const fixtureGeo = useMemo(
    () => fixtureGeometry(light.heads.map((l) => l.plan), light.heads[0].plan.mount),
    [light],
  );
  useEffect(() => () => fixtureGeo.dispose(), [fixtureGeo]);
  const trackColor = theme.room?.track ?? "#1c1c1d";
  const fixtureMat = useMemo(() => createFixtureMaterial(trackColor, theme.light.spot), [trackColor, theme.light.spot]);
  useEffect(() => () => fixtureMat.dispose(), [fixtureMat]);
  const spots = useRef<(THREE.SpotLight | null)[]>([]);
  const gainRef = useRef(1);

  // ---- analytic wall shadow
  const shadowMat = useMemo(() => createShadowMaterial(), []);
  useEffect(() => () => shadowMat.dispose(), [shadowMat]);
  const shadowGeo = useMemo(() => {
    const fr = { cx: 0, cy: 0, hw: w / 2 + frame.outer, hh: h / 2 + frame.outer, depth: frame.depth };
    const cd = { cx: card.x, cy: card.y, hw: PLACARD_W / 2, hh: PLACARD_H / 2, depth: PLACARD_T };
    const drop = (frame.depth * (light.local.y - fr.cy)) / Math.max(0.3, light.local.z + WALL_GAP - frame.depth);
    const u = shadowMat.uniforms;
    u.uLight.value.set(light.local.x, light.local.y, light.local.z + WALL_GAP);
    u.uFrame.value.set(fr.cx, fr.cy, fr.hw, fr.hh);
    // gilt: the outer drop is lower than the crest, so the effective occluding
    // edge sits a little below it; floater: the canvas box face is the occluder
    u.uFrameDepth.value = frame.canvasDepth > 0 ? frame.canvasZ + WALL_GAP : frame.depth * 0.85;
    u.uCard.value.set(cd.cx, cd.cy, cd.hw, cd.hh);
    u.uCardDepth.value = PLACARD_T;
    return shadowQuad(fr, cd, Math.max(0, drop) + 0.05);
  }, [w, h, frame, card, light, shadowMat]);
  useEffect(() => () => shadowGeo.dispose(), [shadowGeo]);

  // ---- focus dimming: damp toward the goal, keep rendering while it moves
  useEffect(() => {
    invalidate();
  }, [focusSlug, invalidate]);
  useFrame((state, dt) => {
    // The frame binds the probe explicitly (own strength); follow the room's
    // environment dimming (scene.environmentIntensity, 1 at rest) so gilt
    // dims with the hall while a work is inspected.
    if (frameMat.envMap) frameMat.envMapIntensity = frameEnvStrength * state.scene.environmentIntensity;
    const goal = somethingFocused ? (isFocused ? FOCUS_GAIN : DIM_GAIN) : 1;
    const cur = gainRef.current;
    let next = THREE.MathUtils.damp(cur, goal, 3.5, Math.min(dt, 0.1));
    if (Math.abs(next - goal) < 0.003) next = goal;
    else state.invalidate();
    if (next === cur && spots.current[0]?.intensity === light.heads[0].intensity * next) return;
    gainRef.current = next;
    light.heads.forEach((l, i) => {
      const sp = spots.current[i];
      if (sp) sp.intensity = l.intensity * next;
    });
    shadowMat.uniforms.uCast.value = CAST_SHADOW * Math.min(1.2, next);
    fixtureMat.emissiveIntensity = LENS_GLOW * (0.15 + 0.85 * Math.min(1.3, next));
  });

  return (
    <group>
      <group position={placement.position} rotation-y={placement.rotationY}>
        <mesh geometry={frame.geometry} material={frameMat} />
        <CanvasSurface
          placement={placement}
          isFocused={isFocused}
          registry={registry}
          theme={theme}
          z={frame.canvasZ}
          depth={frame.canvasDepth}
          settle={settle}
        />
        <Placard artistName={artistName} title={painting.title} year={painting.year} position={[card.x, card.y, card.z]} />
        <mesh geometry={shadowGeo} material={shadowMat} position-z={-WALL_GAP + 0.0012} layers={PROP_LAYER} renderOrder={1} />
      </group>

      {/* track heads: adapter on the rail, stem, knuckle, can aimed at the work */}
      <mesh geometry={fixtureGeo} material={fixtureMat} position={fixtureOrigin} layers={PROP_LAYER} />
      {light.heads.map((l, i) => (
        <group key={i}>
          <primitive object={light.targets[i]} />
          <spotLight
            ref={(el: THREE.SpotLight | null) => {
              spots.current[i] = el;
            }}
            position={l.plan.lens}
            target={light.targets[i]}
            angle={l.angle}
            penumbra={spot.penumbra}
            decay={2}
            distance={0}
            intensity={l.intensity * gainRef.current}
            color={theme.light.spot}
            castShadow={false}
          />
        </group>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------ canvas

/** Load `url` (decode off-thread, staggered single upload); null until ready or on failure. */
function useStreamedTexture(
  url: string | null,
  opts: { track: boolean; notBefore?: number; onLoad?: () => void; onError?: () => void },
): THREE.Texture | null {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [state, setState] = useState<{ url: string; tex: THREE.Texture } | null>(null);
  // one delayed retry after a failure (Wikimedia answers bursts with 429s)
  const [attempt, setAttempt] = useState(0);
  const cbs = useRef(opts);
  cbs.current = opts;
  const track = opts.track;

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    acquireTexture(url, {
      track,
      maxSize: gl.capabilities.maxTextureSize,
      anisotropy: Math.min(8, gl.capabilities.getMaxAnisotropy()),
    }).then(
      (tex) => {
        if (!alive) return;
        const wait = Math.max(0, (cbs.current.notBefore ?? 0) - performance.now());
        timer = setTimeout(
          () =>
            scheduleUpload(() => {
              if (!alive) return;
              gl.initTexture(tex);
              setState({ url, tex });
              invalidate();
              cbs.current.onLoad?.();
            }),
          wait,
        );
      },
      (err) => {
        if (!alive) return;
        console.warn("[exhibit] texture failed:", url, err);
        cbs.current.onError?.();
        if (attempt < MAX_RETRIES) retry = setTimeout(() => setAttempt((a) => a + 1), 2500 + Math.random() * 2500);
      },
    );
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (retry) clearTimeout(retry);
      releaseTexture(url);
    };
  }, [url, track, gl, invalidate, attempt]);

  return state && state.url === url ? state.tex : null;
}

function CanvasSurface({
  placement,
  isFocused,
  registry,
  theme,
  z,
  depth,
  settle,
}: {
  placement: Placement;
  isFocused: boolean;
  registry: Map<string, THREE.Mesh>;
  theme: GalleryTheme;
  z: number;
  depth: number;
  settle: () => void;
}) {
  const { painting, w, h } = placement;
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<THREE.Mesh>(null);

  const baseUrl = useMemo(() => paintingTextureUrl(painting, wallTexturePx(painting)), [painting]);
  const hiUrl = useMemo(() => paintingTextureUrl(painting, inspectTexturePx(painting)), [painting]);

  const base = useStreamedTexture(baseUrl, { track: true, onLoad: settle, onError: settle });

  // Hi-res: requested on inspect, uploaded once the fly-in has landed,
  // released a moment after leaving inspect.
  const [hiWanted, setHiWanted] = useState(false);
  const focusAt = useRef(0);
  useEffect(() => {
    if (hiUrl === baseUrl) return;
    if (isFocused) {
      focusAt.current = performance.now();
      setHiWanted(true);
      return;
    }
    const id = setTimeout(() => setHiWanted(false), HIRES_LINGER_MS);
    return () => clearTimeout(id);
  }, [isFocused, hiUrl, baseUrl]);
  const hi = useStreamedTexture(hiWanted ? hiUrl : null, {
    track: false,
    notBefore: focusAt.current + INSPECT_TWEEN_MS,
  });

  const geometry = useMemo(() => canvasGeometry(w, h, depth), [w, h, depth]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // The paint layer takes the room's environment as-is (scene.environment at
  // the room's physical intensity, dimmed by the room during inspect): its
  // varnish sheen is the plain dielectric response, nothing added on top.
  const material = useMemo(() => {
    const weave = hasWeave(theme.era);
    return new THREE.MeshPhysicalMaterial({
      map: placeholderTexture(),
      color: canvasWhiteBalance(theme.light.spot),
      // thin, aged varnish: a third of a fresh dielectric's reflectance, so a
      // lamp's reflection is a soft sheen rather than a glare that washes the paint
      specularIntensity: VARNISH_SPECULAR,
      roughness: canvasRoughness(theme.era),
      metalness: 0,
      normalMap: weave ? canvasWeaveTexture() : null,
      normalScale: new THREE.Vector2(WEAVE_STRENGTH, WEAVE_STRENGTH),
    });
  }, [theme.era, theme.light.spot]);
  useEffect(() => () => material.dispose(), [material]);

  const map = hi ?? base ?? placeholderTexture();
  useEffect(() => {
    if (material.map !== map) {
      material.map = map;
      invalidate();
    }
  }, [material, map, invalidate]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.userData.slug = painting.slug;
    mesh.userData.placement = placement;
    registry.set(painting.slug, mesh);
    return () => {
      if (registry.get(painting.slug) === mesh) registry.delete(painting.slug);
    };
  }, [painting.slug, placement, registry]);

  return <mesh ref={meshRef} geometry={geometry} material={material} position-z={z} />;
}

// ----------------------------------------------------------------- placard

function Placard({
  artistName,
  title,
  year,
  position,
}: {
  artistName: string;
  title: string;
  year: number | null;
  position: [number, number, number];
}) {
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => placardGeometry(PLACARD_W, PLACARD_H, PLACARD_T), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      map: blankPlacardTexture(),
      roughness: 0.82,
      metalness: 0,
      // a whisper of self-light stands in for the label wash outside the spot's cone
      emissive: new THREE.Color("#fff6e8"),
      emissiveIntensity: 0.07,
      emissiveMap: blankPlacardTexture(),
    });
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    let alive = true;
    let tex: THREE.CanvasTexture | null = null;
    placardFontsReady().then(() => {
      if (!alive) return;
      tex = drawPlacard(artistName, title, year);
      material.map = tex;
      material.emissiveMap = tex;
      invalidate();
    });
    return () => {
      alive = false;
      if (tex) {
        if (material.map === tex) material.map = blankPlacardTexture();
        if (material.emissiveMap === tex) material.emissiveMap = blankPlacardTexture();
        tex.dispose();
      }
    };
  }, [artistName, title, year, material, invalidate]);

  return <mesh geometry={geometry} material={material} position={position} layers={PROP_LAYER} />;
}
