"use client";

import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  FLAGSHIP_THUMB_PX,
  inspectTexturePx,
  nearTexturePx,
  paintingTextureUrl,
  THUMB_PX,
  wallTexturePx,
} from "@/lib/img";
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
import {
  acquireTexture,
  placeholderTexture,
  releaseTexture,
  scheduleUpload,
  type FetchPriority,
} from "./exhibit-texture";
import {
  PLACARD_T,
  blankPlacardTexture,
  drawPlacard,
  drawWithheldCanvas,
  primedCanvasTexture,
  placardFontsReady,
} from "./exhibit-placard";
import { canvasGeometry, fixtureGeometry, placardGeometry } from "./exhibit-geometry";
import type { ExhibitLights } from "./exhibit-lights";
import { createShadowMaterial, shadowQuad } from "./exhibit-shadow";
import { retainExhibitResources } from "./exhibit-shared";
import { isInspectFlying } from "./renderer-motion";
import type { Lod, SuiteRuntime } from "./suite-runtime";

// ------------------------------------------------------------------ tuning

/** The inspect fly-in's shortest duration: the hi-res upload never comes
 *  sooner, and after it, waits for the flight to land (isInspectFlying). */
const INSPECT_TWEEN_MS = 1400;
/** While the upload is held, check again this often. */
const HOLD_POLL_MS = 100;
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
// props that surface effects may land on (the soft shadows stay out)
const FX_TARGET = { fxTarget: true };

export interface PaintingExhibitProps {
  placement: Placement;
  artistName: string;
  focusSlug: string | null;
  registry: Map<string, THREE.Mesh>;
  theme: GalleryTheme;
  /** Its track heads (exhibit-lights.ts). Their lights belong to the runtime's pool. */
  lights: ExhibitLights;
  /** Spot levels, focus gains, texture tiers and visibility (suite-runtime.ts). */
  runtime: SuiteRuntime;
  /** "lite" (a long suite's rooms two away): frame and canvas only. */
  lod?: Lod;
  /** Fires exactly once, when the first wall texture has loaded or failed. */
  onSettled?: (slug: string) => void;
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
  // shared frames, maps and placeholders: released when the last exhibit leaves
  const gl = useThree((s) => s.gl);
  useEffect(() => retainExhibitResources(gl), [gl]);

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
  lights,
  runtime,
  lod = "full",
  settle,
}: PaintingExhibitProps & { settle: () => void }) {
  const full = lod === "full";
  const { painting, w, h } = placement;
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const env = useGalleryEnv();
  const isFocused = focusSlug === painting.slug;
  const live = runtime.state(painting.slug);

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

  // ---- track heads (one per work; two for monumental works). Their lights
  // are pooled in the runtime, which also fades them on and off.
  const fixtureOrigin = lights.heads[0].plan.mount;
  const fixtureGeo = useMemo(
    () => fixtureGeometry(lights.heads.map((l) => l.plan), lights.heads[0].plan.mount),
    [lights],
  );
  useEffect(() => () => fixtureGeo.dispose(), [fixtureGeo]);
  const trackColor = theme.room?.track ?? "#1c1c1d";
  const fixtureMat = useMemo(() => createFixtureMaterial(trackColor, theme.light.spot), [trackColor, theme.light.spot]);
  useEffect(() => () => fixtureMat.dispose(), [fixtureMat]);

  // ---- analytic wall shadow
  const shadowMat = useMemo(() => createShadowMaterial(), []);
  useEffect(() => () => shadowMat.dispose(), [shadowMat]);
  const shadowGeo = useMemo(() => {
    const fr = { cx: 0, cy: 0, hw: w / 2 + frame.outer, hh: h / 2 + frame.outer, depth: frame.depth };
    const k = placement.label ?? 1;
    const cd = { cx: card.x, cy: card.y, hw: (PLACARD_W * k) / 2, hh: (PLACARD_H * k) / 2, depth: PLACARD_T };
    const local = lights.local;
    const drop = (frame.depth * (local.y - fr.cy)) / Math.max(0.3, local.z + WALL_GAP - frame.depth);
    const u = shadowMat.uniforms;
    u.uLight.value.set(local.x, local.y, local.z + WALL_GAP);
    u.uFrame.value.set(fr.cx, fr.cy, fr.hw, fr.hh);
    // gilt: the outer drop is lower than the crest, so the effective occluding
    // edge sits a little below it; floater: the canvas box face is the occluder
    u.uFrameDepth.value = frame.canvasDepth > 0 ? frame.canvasZ + WALL_GAP : frame.depth * 0.85;
    u.uCard.value.set(cd.cx, cd.cy, cd.hw, cd.hh);
    u.uCardDepth.value = PLACARD_T;
    return shadowQuad(fr, cd, Math.max(0, drop) + 0.05);
  }, [w, h, frame, card, lights, shadowMat, placement.label]);
  useEffect(() => () => shadowGeo.dispose(), [shadowGeo]);

  // ---- portal culling: the runtime hides the exhibit while no doorway shows it
  const groupRef = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    runtime.attach(painting.slug, groupRef.current);
    return () => runtime.attach(painting.slug, null);
  }, [runtime, painting.slug]);

  // ---- the spot's level and focus gain (both animated by the runtime) drive
  // the cast shadow and the lens glow. At rest (full light, no focus) the
  // materials keep their own defaults.
  const shown = useRef({ gain: 1, level: 1 });
  useFrame((state) => {
    // The frame binds the probe explicitly (own strength); follow the room's
    // environment dimming (scene.environmentIntensity, 1 at rest) so gilt
    // dims with the hall while a work is inspected.
    if (frameMat.envMap) frameMat.envMapIntensity = frameEnvStrength * state.scene.environmentIntensity;
    const gain = live?.gain ?? 1;
    const level = live?.level ?? 1;
    const s = shown.current;
    if (gain === s.gain && level === s.level) return;
    s.gain = gain;
    s.level = level;
    shadowMat.uniforms.uCast.value = CAST_SHADOW * Math.min(1.2, gain) * level;
    // a lamp that is off keeps only a faint glint in its lens
    const lamp = level >= 1 ? 1 : 0.06 + 0.94 * level;
    fixtureMat.emissiveIntensity = LENS_GLOW * (0.15 + 0.85 * Math.min(1.3, gain)) * lamp;
  });

  return (
    <group ref={groupRef}>
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
          runtime={runtime}
          artistName={artistName}
        />
        {full && (
          <Placard artistName={artistName} title={painting.title} year={painting.year} copyrighted={painting.copyrighted === true} dimensions={placardDimensions(placement)} position={[card.x, card.y, card.z]} scale={placement.label ?? 1} />
        )}
        {full && (
          <mesh geometry={shadowGeo} material={shadowMat} position-z={-WALL_GAP + 0.0012} layers={PROP_LAYER} renderOrder={1} />
        )}
      </group>

      {/* track heads: adapter on the rail, stem, knuckle, can aimed at the work */}
      {full && <mesh geometry={fixtureGeo} material={fixtureMat} position={fixtureOrigin} layers={PROP_LAYER} userData={FX_TARGET} />}
    </group>
  );
}

// ------------------------------------------------------------------ canvas

/**
 * Load `url` (decode off-thread, staggered single upload). Switching to
 * another url keeps the current texture on show until the new one is up (a
 * thumbnail stays until its wall-resolution version arrives, and back);
 * a null url drops it. Null until the first texture is ready.
 *
 * Transient failures are retried by the loader (per-URL backoff, see
 * exhibit-texture.ts); onError fires on the first one (so nothing waits on
 * it meanwhile) or on a permanent failure. Asking for the url again (the
 * visitor coming back: the tier changes away and back) retries a spent one.
 */
function useStreamedTexture(
  url: string | null,
  opts: {
    track: boolean;
    priority?: FetchPriority;
    /** No upload before this time (performance.now())... */
    notBefore?: number;
    /** ...nor while this holds (polled). */
    hold?: () => boolean;
    /** A change asks again for a url that failed (the visitor came closer). */
    epoch?: string;
    onLoad?: () => void;
    onError?: () => void;
  },
): THREE.Texture | null {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  // the texture on show holds one cache reference until it is replaced
  const [shown, setShown] = useState<{ url: string; tex: THREE.Texture } | null>(null);
  const shownUrl = useRef<string | null>(null);
  shownUrl.current = shown?.url ?? null;
  const cbs = useRef(opts);
  cbs.current = opts;
  const { track, priority, epoch } = opts;

  useEffect(() => {
    if (!shown) return;
    return () => releaseTexture(shown.url);
  }, [shown]);

  useEffect(() => {
    if (!url) {
      // nothing wanted any more: drop (and so release) what is on show
      const t = setTimeout(() => setShown(null), 0);
      return () => clearTimeout(t);
    }
    if (shownUrl.current === url) return;
    let alive = true;
    let owned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const upload = (tex: THREE.Texture) =>
      scheduleUpload(() => {
        if (!alive) return;
        gl.initTexture(tex);
        owned = true;
        setShown({ url, tex });
        invalidate();
        cbs.current.onLoad?.();
      });
    // wait out notBefore, then poll the hold, then queue the upload
    const whenFree = (tex: THREE.Texture) => {
      if (!alive) return;
      const wait = Math.max(0, (cbs.current.notBefore ?? 0) - performance.now());
      if (wait > 0) timer = setTimeout(() => whenFree(tex), wait);
      else if (cbs.current.hold?.()) timer = setTimeout(() => whenFree(tex), HOLD_POLL_MS);
      else upload(tex);
    };
    acquireTexture(
      url,
      {
        track,
        priority,
        maxSize: gl.capabilities.maxTextureSize,
        // the renderer's best: canvases are mostly seen at an angle down the walls
        anisotropy: gl.capabilities.getMaxAnisotropy(),
      },
      () => {
        // retrying after a transient failure: report it, the loader keeps at it
        if (alive) cbs.current.onError?.();
      },
    ).then(whenFree, (err) => {
      if (!alive || (err as { name?: string })?.name === "AbortError") return;
      console.warn("[exhibit] texture failed:", url, err);
      cbs.current.onError?.();
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (!owned) releaseTexture(url);
    };
  }, [url, track, priority, gl, invalidate, epoch]);

  return url && shown ? shown.tex : null;
}

function CanvasSurface({
  placement,
  isFocused,
  registry,
  theme,
  z,
  depth,
  settle,
  runtime,
  artistName,
}: {
  placement: Placement;
  isFocused: boolean;
  registry: Map<string, THREE.Mesh>;
  theme: GalleryTheme;
  z: number;
  depth: number;
  settle: () => void;
  runtime: SuiteRuntime;
  artistName: string;
}) {
  const { painting, w, h } = placement;
  const slug = painting.slug;
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<THREE.Mesh>(null);

  // Texture tier from the runtime: wall resolution near the visitor, a
  // thumbnail rooms away, nothing yet for a suite's far rooms before the
  // doors open.
  const subscribe = useCallback((cb: () => void) => runtime.subscribeTier(slug, cb), [runtime, slug]);
  const tier = useSyncExternalStore(subscribe, () => runtime.tier(slug), () => runtime.tier(slug));
  const gate = runtime.state(slug)?.gate ?? false;

  const baseUrl = useMemo(() => paintingTextureUrl(painting, wallTexturePx(painting)), [painting]);
  const nearUrl = useMemo(() => paintingTextureUrl(painting, nearTexturePx(painting)), [painting]);
  const flagship = placement === runtime.layout.placements[0];
  const thumbUrl = useMemo(
    () => paintingTextureUrl(painting, flagship ? FLAGSHIP_THUMB_PX : THUMB_PX),
    [painting, flagship],
  );
  // Inspect: the full original or the 3840 bucket where the GPU takes it
  // (long side up to 6144 on desktop; 4096 on touch devices, whose memory is
  // tighter). One hi-res scan at a time, released after leaving inspect.
  const gl = useThree((s) => s.gl);
  const maxLong = useMemo(() => {
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    return Math.min(gl.capabilities.maxTextureSize, coarse ? 4096 : 6144);
  }, [gl]);
  const hiUrl = useMemo(() => paintingTextureUrl(painting, inspectTexturePx(painting, maxLong)), [painting, maxLong]);

  // No image to show (the article has none, or a rights holder's takedown):
  // nothing to fetch or wait for. The © canvas is drawn here instead.
  const withheld = !baseUrl;
  const [panel, setPanel] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    if (!withheld) return;
    settle();
    let alive = true;
    let tex: THREE.CanvasTexture | null = null;
    placardFontsReady().then(() => {
      if (!alive) return;
      tex = drawWithheldCanvas(artistName, painting.title, painting.year, w / h);
      setPanel(tex);
      invalidate();
    });
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, [withheld, settle, artistName, painting.title, painting.year, w, h, invalidate]);
  const wantUrl = tier === "near" ? nearUrl : tier === "wall" ? baseUrl : tier === "thumb" ? thumbUrl : null;
  const base = useStreamedTexture(wantUrl, {
    track: tier === "wall",
    priority: gate ? "high" : tier === "thumb" ? "low" : "auto",
    epoch: tier,
    onLoad: settle,
    onError: settle,
  });

  // Hi-res: requested on inspect, uploaded once the fly-in has landed,
  // released a moment after leaving inspect.
  const [hiWanted, setHiWanted] = useState(false);
  const focusAt = useRef(0);
  useEffect(() => {
    if (!hiUrl || hiUrl === baseUrl || hiUrl === wantUrl) return;
    if (isFocused) {
      focusAt.current = performance.now();
      setHiWanted(true);
      return;
    }
    const id = setTimeout(() => setHiWanted(false), HIRES_LINGER_MS);
    return () => clearTimeout(id);
  }, [isFocused, hiUrl, baseUrl, wantUrl]);
  const hi = useStreamedTexture(hiWanted ? hiUrl : null, {
    track: false,
    notBefore: focusAt.current + INSPECT_TWEEN_MS,
    hold: isInspectFlying,
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

  const map = withheld ? (panel ?? primedCanvasTexture()) : (hi ?? base ?? placeholderTexture());
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

function placardDimensions({ painting, w, h }: Placement): string {
  const { widthCm, heightCm } = painting;
  if (!(widthCm && widthCm > 0 && heightCm && heightCm > 0)) {
    return "Dimensions unavailable (estimated size)";
  }
  const widthScale = (w * 100) / widthCm;
  const heightScale = (h * 100) / heightCm;
  const original = Math.abs(widthScale - 1) <= 0.01 && Math.abs(heightScale - 1) <= 0.01;
  const tag = original ? "original scale" : widthScale > 1 && heightScale > 1 ? "enlarged to fit" : "resized to fit";
  return `${heightCm} × ${widthCm} cm (H × W) · (${tag})`;
}

function Placard({
  artistName,
  title,
  year,
  copyrighted,
  dimensions,
  position,
  scale = 1,
}: {
  artistName: string;
  title: string;
  year: number | null;
  copyrighted: boolean;
  dimensions: string;
  position: [number, number, number];
  /** A smaller card beside prints and miniatures (the layout's label scale). */
  scale?: number;
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
      tex = drawPlacard(artistName, title, year, copyrighted, dimensions);
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
  }, [artistName, title, year, copyrighted, dimensions, material, invalidate]);

  return <mesh geometry={geometry} material={material} position={position} scale={[scale, scale, 1]} layers={PROP_LAYER} userData={FX_TARGET} />;
}
