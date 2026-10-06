"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import type { GalleryLayout } from "./layout";
import type { GalleryTheme } from "./theme";
import { setGalleryEnv } from "./env-store";
import { buildGlass, buildHall, ceilingSpec, disposeHall } from "./room-geometry";
import {
  captureProbe,
  ENV_INTENSITY,
  initialEnvironment,
  placeholderEnvironment,
  precompileProbeShader,
  roomDimmers,
  roomState,
} from "./room-env";
import { ReflectiveFloor } from "./room-floor";
import { patchRoomMaterial } from "./room-shading";
import {
  damaskTextures,
  laylightTexture,
  plasterAlbedoTexture,
  plasterBumpTexture,
  proceduralTexturesPending,
  subscribeProceduralTextures,
  woodGrainTexture,
} from "./textures";

// The architecture of the hall: environment, ceiling light, floor, walls,
// mouldings, laylight / lightbox, lighting track and benches.

// LTC tables for the laylight's RectAreaLight — once, at module load (they
// are plain DataTextures, so this is safe during SSR evaluation too).
RectAreaLightUniformsLib.init();

// ------------------------------------------------------------- environment

export function EnvSetup({
  layout,
  theme,
  ready,
}: {
  layout: GalleryLayout;
  theme: GalleryTheme;
  /** True once every painting texture has settled (the reflection probe is captured then). */
  ready: boolean;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const envRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const captured = useRef(false);
  const countdown = useRef(-1);
  const retired = useRef<Retired>([]);

  // A lost and restored WebGL context keeps no render-target contents: the
  // proxy and the probe come back empty. Rebuild both from scratch.
  const [contextGen, setContextGen] = useState(0);
  useEffect(() => {
    const canvas = gl.domElement;
    const onRestored = () => setContextGen((g) => g + 1);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => canvas.removeEventListener("webglcontextrestored", onRestored);
  }, [gl]);

  // Synchronously, inside the commit that adds the room: the first frame
  // already sees an environment of the final shape, so no program is ever
  // compiled without one. Its contents (the proxy room) are built below.
  const pmremRef = useRef<THREE.PMREMGenerator | null>(null);
  const buildProxy = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    // one generator for the proxy and the probe: its blur programs compile once
    const pm = new THREE.PMREMGenerator(gl);
    pmremRef.current = pm;
    const stand = placeholderEnvironment(gl);
    envRef.current = stand;
    captured.current = false;
    countdown.current = -1;
    scene.environment = stand.texture;
    scene.environmentIntensity = ENV_INTENSITY * envDimFactor(roomState.dim);
    setGalleryEnv(stand.texture);
    const pending = retired.current;
    let built = false;
    buildProxy.current = () => {
      // once; never over a probe that got there first
      if (built || captured.current) return;
      built = true;
      swapEnvironment(scene, envRef, pending, initialEnvironment(pm, layout, theme));
      precompileProbeShader(gl, pm);
      invalidate();
    };
    invalidate();
    return () => {
      built = true;
      buildProxy.current = null;
      pm.dispose();
      pmremRef.current = null;
      if (scene.environment === envRef.current?.texture) scene.environment = null;
      setGalleryEnv(null);
      envRef.current?.dispose();
      envRef.current = null;
      pending.forEach((p) => {
        clearTimeout(p.timer);
        p.rt.dispose();
      });
      pending.length = 0;
    };
  }, [gl, scene, invalidate, layout, theme, contextGen]);

  // The proxy PMREM's GGX program compiles synchronously (~350 ms on a cold
  // GPU shader cache): build it only after this commit's effects have run —
  // the exhibits' among them, which start the painting fetches.
  useEffect(() => {
    const t = setTimeout(() => buildProxy.current?.(), 0);
    return () => clearTimeout(t);
  }, [gl, scene, invalidate, layout, theme, contextGen]);

  // The probe should see the walls and floor with their procedural maps drawn.
  const texturesDrawn = useSyncExternalStore(
    subscribeProceduralTextures,
    () => !proceduralTexturesPending(),
    () => false
  );

  // Safety net: if `ready` never arrives, capture the hall anyway.
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFallback(true), 15000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (((ready && texturesDrawn) || fallback) && !captured.current && countdown.current < 0) {
      // let the freshly settled canvases commit and upload first
      countdown.current = 3;
      invalidate();
    }
    // re-armed when the room is rebuilt (a new layout/theme gets its own
    // probe, a restored context a fresh one)
  }, [ready, texturesDrawn, fallback, invalidate, layout, theme, contextGen]);

  useFrame((state) => {
    if (countdown.current < 0 || captured.current) return;
    if (countdown.current > 0) {
      countdown.current--;
      state.invalidate();
      return;
    }
    // Capture at rest, not while a painting is focused and the room dimmed.
    // No frames are requested meanwhile: Lighting renders every frame while
    // it brings the room back up, and this check runs again on those.
    if (roomState.dim < 0.98) return;
    countdown.current = -1;
    captured.current = true;
    const pm = pmremRef.current ?? new THREE.PMREMGenerator(gl);
    const probe = captureProbe(gl, pm, scene, layout);
    // the generator's work is done: free its internal targets and programs
    pm.dispose();
    pmremRef.current = null;
    swapEnvironment(scene, envRef, retired.current, probe);
    state.invalidate();
  });

  return null;
}

type Retired = { rt: THREE.WebGLRenderTarget; timer: ReturnType<typeof setTimeout> }[];

/** Make `rt` the gallery environment; the one it replaces is retired. */
function swapEnvironment(
  scene: THREE.Scene,
  envRef: { current: THREE.WebGLRenderTarget | null },
  retired: Retired,
  rt: THREE.WebGLRenderTarget
) {
  const old = envRef.current;
  envRef.current = rt;
  scene.environment = rt.texture;
  setGalleryEnv(rt.texture);
  if (old) {
    // exhibits re-bind on their next React commit; free the old one after that
    const entry = {
      rt: old,
      timer: setTimeout(() => {
        old.dispose();
        const i = retired.indexOf(entry);
        if (i >= 0) retired.splice(i, 1);
      }, 2500),
    };
    retired.push(entry);
  }
}

/** Environment strength while a painting is focused (dim = 0) vs at rest (1). */
function envDimFactor(dim: number) {
  return 0.3 + 0.7 * dim;
}

// ---------------------------------------------------------------- lighting

/**
 * The laylight (or modern lightbox): emissive glass panes in the ceiling and
 * the RectAreaLight that is their light. Both — and the environment — dim
 * together while a painting is focused.
 */
export function Lighting({
  layout,
  theme,
  focused,
}: {
  layout: GalleryLayout;
  theme: GalleryTheme;
  focused: boolean;
}) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const area = useRef<THREE.RectAreaLight>(null);
  const spec = useMemo(() => ceilingSpec(layout, theme), [layout, theme]);
  // from the shared state, so a level left over anywhere is damped back to rest
  const level = useRef(roomState.dim);

  const glass = useMemo(() => {
    const geometry = buildGlass(spec);
    const map = laylightTexture(spec.panes[0], spec.panes[1]);
    const base = new THREE.Color(theme.room.daylight).multiplyScalar(theme.room.daylightLevel);
    const material = new THREE.MeshBasicMaterial({ color: base.clone(), map });
    return { geometry, material, map, base };
  }, [spec, theme]);
  useEffect(
    () => () => {
      glass.geometry.dispose();
      glass.material.dispose();
      glass.map.dispose();
    },
    [glass]
  );

  const areaBase = theme.room.daylightLevel * (theme.room.ceiling === "laylight" ? 1.0 : 1.25);
  const apply = (k: number) => {
    if (area.current) area.current.intensity = areaBase * (0.1 + 0.9 * k);
    glass.material.color.copy(glass.base).multiplyScalar(0.22 + 0.78 * k);
    scene.environmentIntensity = ENV_INTENSITY * envDimFactor(k);
    roomDimmers.forEach((d) => d.uniform.value.copy(d.base).multiplyScalar(0.25 + 0.75 * k));
    roomState.dim = k;
  };

  useEffect(() => {
    invalidate();
  }, [focused, invalidate]);

  useEffect(
    () => () => {
      // Leaving the gallery (even mid-inspect): the next one must start at
      // rest. roomState outlives this canvas, and the next room builds its
      // materials and environment from it before any frame runs.
      roomState.dim = 1;
      // The LTC tables are three's module singletons: free them from this
      // renderer (they upload again on the next one's first use) so their
      // dispose listeners do not keep it alive.
      const lib = THREE.UniformsLib as unknown as Record<string, THREE.Texture | undefined>;
      for (const k of ["LTC_FLOAT_1", "LTC_FLOAT_2", "LTC_HALF_1", "LTC_HALF_2"]) lib[k]?.dispose();
    },
    []
  );

  useFrame((state, dt) => {
    const target = focused ? 0 : 1;
    const cur = level.current;
    if (Math.abs(cur - target) < 0.001) {
      if (cur !== target) {
        level.current = target;
        apply(target);
      }
      return;
    }
    level.current = THREE.MathUtils.damp(cur, target, 4, Math.min(dt, 0.1));
    apply(level.current);
    state.invalidate();
  });

  const glassLen = spec.wellZ1 - spec.wellZ0;
  return (
    <>
      <rectAreaLight
        ref={area}
        args={[theme.room.daylight, areaBase, 2 * spec.wellX, glassLen]}
        position={[0, spec.yGlass - 0.04, (spec.wellZ0 + spec.wellZ1) / 2]}
        rotation-x={-Math.PI / 2}
      />
      <mesh geometry={glass.geometry} material={glass.material} matrixAutoUpdate={false} />
    </>
  );
}

// -------------------------------------------------------------------- room

function useRoomMaterials(layout: GalleryLayout, theme: GalleryTheme) {
  return useMemo(() => {
    const { hallWidth: W, hallLength: L, wallHeight: H } = layout;
    const roomHalf = new THREE.Vector3(W / 2, H, L / 2);
    const textures: THREE.Texture[] = [];
    const finish = theme.room.wallFinish;

    // walls — UVs are in metres, so repeat = 1 / tile size
    const wall = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.wall.color),
      roughness: theme.wall.roughness,
      metalness: 0,
    });
    if (finish === "damask") {
      const { map, roughness } = damaskTextures();
      map.repeat.set(1 / 0.56, 1 / 0.84);
      roughness.repeat.copy(map.repeat);
      wall.map = map;
      wall.roughnessMap = roughness;
      textures.push(map, roughness);
    } else {
      const bump = plasterBumpTexture();
      if (finish === "plaster") {
        // lime plaster: soft trowel undulation plus fine grain
        const map = plasterAlbedoTexture();
        map.repeat.set(1 / 2.2, 1 / 2.2);
        bump.repeat.set(1 / 1.3, 1 / 1.3);
        wall.map = map;
        wall.bumpScale = 0.6;
        textures.push(map);
      } else {
        // painted board: even colour, only a fine orange-peel texture
        bump.repeat.set(1 / 0.35, 1 / 0.35);
        wall.bumpScale = 0.12;
      }
      wall.bumpMap = bump;
      textures.push(bump);
    }
    // Modern rooms: track-mounted asymmetric wall-washers give the white cube
    // its even, bright walls (an even vertical wash, softening toward the
    // floor). Classical rooms get their wash from the laylight instead.
    const washBase = new THREE.Color(theme.light.ambient).multiplyScalar(theme.room.wallWash);
    const wash = { value: washBase.clone().multiplyScalar(0.25 + 0.75 * roomState.dim) };
    const useWash = theme.room.wallWash > 0;
    patchRoomMaterial(wall, {
      key: `wall-${finish}-${useWash ? "wash" : "nowash"}`,
      roomHalf,
      ao: [0.5, 0.38, 0.3],
      mottle: finish === "paint" ? 0.006 : 0.03,
      mottleScale: 0.4,
      shadowGap: theme.room.classical ? undefined : { bottom: 0.045, top: 0.018 },
      extraUniforms: { uWash: wash },
      extraPars: "uniform vec3 uWash;",
      extraDirect: useWash
        ? `{
  float t = clamp(vRoomPos.y / uRoomHalf.y, 0.0, 1.0);
  float wsh = mix(0.6, 1.0, smoothstep(0.0, 0.75, t)) * (1.0 - 0.3 * smoothstep(0.85, 1.0, t));
  reflectedLight.directDiffuse += diffuseColor.rgb * uWash * wsh;
}`
        : "",
    });

    // Concealed uplighting on top of the cornice (and the bounce it gives):
    // brightest in the cove, fading across the ceiling band. Dims with the
    // laylight while a painting is focused.
    const uplightBase = new THREE.Color(theme.room.daylight).multiplyScalar(
      theme.room.ceiling === "laylight" ? 0.3 : 0.5
    );
    const uplight = { value: uplightBase.clone().multiplyScalar(0.25 + 0.75 * roomState.dim) };
    const dimmers = [
      { uniform: uplight, base: uplightBase },
      { uniform: wash, base: washBase },
    ];
    const ceiling = patchRoomMaterial(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.ceiling),
        roughness: 0.95,
        metalness: 0,
      }),
      {
        key: "ceiling",
        roomHalf,
        ao: [0.42, 0.3, 0.25],
        mottle: 0.02,
        mottleScale: 0.35,
        extraUniforms: { uUplight: uplight },
        extraPars: "uniform vec3 uUplight;",
        extraColor: `{
  float dw = min(uRoomHalf.x - abs(vRoomPos.x), uRoomHalf.z - abs(vRoomPos.z));
  float up = exp(-max(dw, 0.0) / 1.2);
  totalEmissiveRadiance += diffuseColor.rgb * uUplight * (0.3 + 0.7 * up);
}`,
      }
    );

    const stone = theme.era === "sacred";
    const trim = patchRoomMaterial(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.trim),
        roughness: stone ? 0.82 : theme.room.classical ? 0.42 : 0.6,
        metalness: 0,
      }),
      { key: "trim", roomHalf, ao: [0.45, 0.25, 0.3], mottle: stone ? 0.05 : 0.0, mottleScale: 2.2 }
    );

    const track = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.room.track),
      roughness: 0.38,
      metalness: 0.55,
    });

    // Benches: wooden parts get oak grain projected in world space (the
    // merged rounded boxes have no meaningful UVs); leather is plain satin.
    // A wooden floor shares the same grain texture (one canvas, one upload).
    const oakSeat = theme.room.bench === "oak-block";
    const steel = theme.room.bench === "modern-leather";
    const woodFloor = theme.floor.kind !== "concrete";
    const grain =
      woodFloor || oakSeat || !steel
        ? woodGrainTexture(theme.floor.kind === "oak-dark" ? "oak-dark" : "oak-light")
        : null;
    if (grain) textures.push(grain);
    const woodGrain = (m: THREE.MeshStandardMaterial, key: string) => {
      m.map = grain;
      return patchRoomMaterial(m, {
        key,
        roomHalf,
        ao: [0.0, 0.3, 0.0],
        replaceMap: `{
  vec3 an = abs(normalize(vRoomNrm));
  vec2 wuv = an.y > 0.5 ? vRoomPos.xz : (an.x > 0.5 ? vRoomPos.yz : vRoomPos.xy);
  diffuseColor *= texture2D(map, wuv / vec2(0.3, 0.6));
}`,
      });
    };
    const benchSeat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.room.benchSeat),
      roughness: oakSeat ? 0.5 : 0.46,
      metalness: 0,
    });
    if (oakSeat) woodGrain(benchSeat, "bench-wood");
    const benchFrame = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.room.benchFrame),
      roughness: steel ? 0.3 : 0.5,
      metalness: steel ? 1 : 0,
    });
    if (!steel) woodGrain(benchFrame, "bench-wood");

    // soft contact shadow under each bench: an SDF blob, no texture, no pass
    const benchShadow = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { uOpacity: { value: 0.72 } },
      vertexShader: /* glsl */ `
        attribute vec2 aLocal;
        attribute vec2 aHalf;
        varying vec2 vLocal;
        varying vec2 vHalf;
        void main() {
          vLocal = aLocal;
          vHalf = aHalf;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec2 vLocal;
        varying vec2 vHalf;
        float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
        void main() {
          // umbra under the seat, a soft penumbra spilling ~35 cm past it
          float d = sdBox(vLocal, vHalf - 0.03);
          float umbra = 1.0 - smoothstep(-0.18, 0.04, d);
          float penumbra = 1.0 - smoothstep(-0.02, 0.36, d);
          float a = uOpacity * (0.6 * umbra + 0.4 * penumbra);
          gl_FragColor = vec4(0.0, 0.0, 0.0, a);
        }`,
    });

    const all = [wall, ceiling, trim, track, benchSeat, benchFrame, benchShadow];
    return {
      wall,
      ceiling,
      trim,
      track,
      benchSeat,
      benchFrame,
      benchShadow,
      dimmers,
      floorGrain: woodFloor ? grain : null,
      dispose() {
        all.forEach((m) => m.dispose());
        textures.forEach((t) => t.dispose());
      },
    };
  }, [layout, theme]);
}

export function Room({ layout, theme }: { layout: GalleryLayout; theme: GalleryTheme }) {
  const invalidate = useThree((s) => s.invalidate);
  const hall = useMemo(() => buildHall(layout, theme), [layout, theme]);
  const mats = useRoomMaterials(layout, theme);
  useEffect(() => () => disposeHall(hall), [hall]);
  // the procedural maps are drawn after mount: show each one as it lands
  useEffect(() => subscribeProceduralTextures(() => invalidate()), [invalidate]);
  useEffect(() => {
    mats.dimmers.forEach((d) => roomDimmers.add(d));
    return () => {
      mats.dimmers.forEach((d) => roomDimmers.delete(d));
      mats.dispose();
    };
  }, [mats]);

  return (
    <group>
      <ReflectiveFloor
        W={layout.hallWidth}
        L={layout.hallLength}
        H={layout.wallHeight}
        theme={theme}
        grain={mats.floorGrain ?? undefined}
      />
      <mesh geometry={hall.walls} material={mats.wall} matrixAutoUpdate={false} />
      <mesh geometry={hall.ceiling} material={mats.ceiling} matrixAutoUpdate={false} />
      <mesh geometry={hall.trim} material={mats.trim} matrixAutoUpdate={false} />
      <mesh geometry={hall.benchSeat} material={mats.benchSeat} matrixAutoUpdate={false} />
      <mesh geometry={hall.benchFrame} material={mats.benchFrame} matrixAutoUpdate={false} />
      {/* small props: skipped by the floor reflection */}
      <mesh geometry={hall.track} material={mats.track} matrixAutoUpdate={false} layers={1} />
      <mesh
        geometry={hall.benchShadow}
        material={mats.benchShadow}
        matrixAutoUpdate={false}
        layers={1}
        renderOrder={1}
      />
    </group>
  );
}
