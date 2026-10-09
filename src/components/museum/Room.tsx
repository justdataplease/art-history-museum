"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { outerHalf, type GalleryLayout } from "./layout";
import type { GalleryTheme } from "./theme";
import type { SuiteRuntime } from "./suite-runtime";
import { setGalleryEnv } from "./env-store";
import {
  buildGlass,
  buildHall,
  ceilingSpecs,
  disposeHall,
  HALL_PARTS,
  setRoomWindow,
  type IndexRange,
} from "./room-geometry";
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
import { furnitureOf } from "./furniture";
import { RoomSigns } from "./room-signs";
import { CROSS_SLOTS, patchRoomMaterial, roomCross, setCrossWindow } from "./room-shading";
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
  runtime,
}: {
  layout: GalleryLayout;
  theme: GalleryTheme;
  /** True once the works the probe sees have settled: every painting in a
   *  single room, the visitor's room in a suite. */
  ready: boolean;
  /** Where the visitor is, and whether the lights have stopped fading. */
  runtime: SuiteRuntime;
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
    // Capture at rest, not while a painting is focused and the room dimmed,
    // and in a fully lit room: no spot or laylight still fading (in a suite
    // they follow the visitor). No frames are requested meanwhile: Lighting
    // and the runtime render every frame while they change, and this check
    // runs again on those.
    if (roomState.dim < 0.98 || !runtime.settled()) return;
    countdown.current = -1;
    captured.current = true;
    const pm = pmremRef.current ?? new THREE.PMREMGenerator(gl);
    // From the middle of the visitor's room, whose works and lights are all
    // up: every room of a suite shares the theme and section, so the one
    // probe stands for all of them (a probe of a room the visitor has left
    // would see it unlit, its exhibits unmounted).
    const probe = captureProbe(gl, pm, scene, layout, runtime.currentRoom());
    // test hook (see Gallery's SuiteDirector): where and when it was taken
    const w = window as unknown as { __MUSEUM_DEBUG__?: boolean; __museumProbe?: unknown };
    if (w.__MUSEUM_DEBUG__) w.__museumProbe = { room: runtime.currentRoom(), atMs: Math.round(performance.now()) };
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
 * the RectAreaLights that are their light. A fixed number of area lights for
 * the gallery's life (lights never change number at runtime): one per room
 * up to AREA_POOL, which then follow the visitor (the runtime's areaSlots:
 * a light leaving its room fades out, moves, and fades in on the next).
 * Lights, glass and environment dim together while a painting is focused.
 */
export function Lighting({
  layout,
  theme,
  focused,
  runtime,
}: {
  layout: GalleryLayout;
  theme: GalleryTheme;
  focused: boolean;
  runtime: SuiteRuntime;
}) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const areas = useRef<(THREE.RectAreaLight | null)[]>([]);
  const specs = useMemo(() => ceilingSpecs(layout, theme), [layout, theme]);
  // from the shared state, so a level left over anywhere is damped back to rest
  const level = useRef(roomState.dim);

  const glass = useMemo(() => {
    const geometry = buildGlass(specs);
    const map = laylightTexture(specs[0].panes[0], specs[0].panes[1]);
    const base = new THREE.Color(theme.room.daylight).multiplyScalar(theme.room.daylightLevel);
    const material = new THREE.MeshBasicMaterial({ color: base.clone(), map });
    // one quad (6 indices) per bay, room after room
    const ranges: IndexRange[] = [];
    let start = 0;
    for (const sp of specs) {
      ranges.push({ start, count: sp.bays.length * 6 });
      start += sp.bays.length * 6;
    }
    return { geometry, material, map, base, ranges };
  }, [specs, theme]);
  // a long suite: only the glass of the rooms around the visitor
  useEffect(() => {
    const apply = () => {
      setRoomWindow(glass.geometry, glass.ranges, runtime.archWindow());
      invalidate();
    };
    apply();
    return runtime.onWindowChange(apply);
  }, [glass, runtime, invalidate]);
  useEffect(
    () => () => {
      glass.geometry.dispose();
      glass.material.dispose();
      glass.map.dispose();
    },
    [glass]
  );

  const areaBase = theme.room.daylightLevel * (theme.room.ceiling === "lightbox" ? 1.25 : theme.room.ceiling === "vault" ? 1.15 : 1.0);
  // each pooled area light: over its room's glass, at its fade level
  const placeAreas = (k: number) => {
    runtime.areaSlots.forEach((slot, i) => {
      const a = areas.current[i];
      const sp = specs[slot.room];
      if (!a || !sp) return;
      const z = (sp.wellZ0 + sp.wellZ1) / 2;
      if (a.position.z !== z) {
        a.position.z = z;
        a.height = sp.wellZ1 - sp.wellZ0;
      }
      const f = slot.level >= 1 ? 1 : slot.level * slot.level * (3 - 2 * slot.level);
      a.intensity = areaBase * (0.1 + 0.9 * k) * f;
    });
  };
  const apply = (k: number) => {
    placeAreas(k);
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
      } else if (runtime.areaSlots.length < specs.length) {
        // a long suite's area lights may be moving between rooms
        placeAreas(cur);
      }
      return;
    }
    level.current = THREE.MathUtils.damp(cur, target, 4, Math.min(dt, 0.1));
    apply(level.current);
    state.invalidate();
  });

  return (
    <>
      {runtime.areaSlots.map((slot, i) => {
        const spec = specs[slot.room];
        return (
          <rectAreaLight
            key={i}
            ref={(el: THREE.RectAreaLight | null) => {
              areas.current[i] = el;
            }}
            args={[theme.room.daylight, areaBase, 2 * spec.wellX, spec.wellZ1 - spec.wellZ0]}
            position={[0, spec.yGlass - 0.04, (spec.wellZ0 + spec.wellZ1) / 2]}
            rotation-x={-Math.PI / 2}
          />
        );
      })}
      <mesh geometry={glass.geometry} material={glass.material} matrixAutoUpdate={false} />
    </>
  );
}

// -------------------------------------------------------------------- room

function useRoomMaterials(layout: GalleryLayout, theme: GalleryTheme) {
  return useMemo(() => {
    const { hallLength: L, wallHeight: H } = layout;
    // the room's height for the AO: a vault rises above the walls
    const top = Math.max(H, ...ceilingSpecs(layout, theme).map((sp) => (sp.kind === "vault" ? sp.yCeil : H)));
    const roomHalf = new THREE.Vector3(outerHalf(layout), top, L / 2);
    // shared with the floor and the films' corner (the window of cross walls moves for all of them)
    const cross = roomCross(layout);
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
      cross,
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
      theme.room.ceiling === "laylight" ? 0.3 : theme.room.ceiling === "vault" ? 0.36 : 0.5
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
        cross,
        ao: [0.42, 0.3, 0.25],
        mottle: 0.02,
        mottleScale: 0.35,
        extraUniforms: { uUplight: uplight },
        extraPars: "uniform vec3 uUplight;",
        extraColor: `{
  float dw = min(min(roomHalfX(vRoomPos.z) - abs(vRoomPos.x), uRoomHalf.z - abs(vRoomPos.z)), roomCrossFace(vRoomPos));
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
      { key: "trim", roomHalf, cross, ao: [0.45, 0.25, 0.3], mottle: stone ? 0.05 : 0.0, mottleScale: 2.2 }
    );

    const track = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.room.track),
      roughness: 0.38,
      metalness: 0.55,
    });

    // Seating (furniture.ts): wooden frames get grain projected in world space
    // (the merged primitives have no meaningful UVs); upholstery is plain;
    // lacquer, paint and steel have no grain. A wooden floor shares the same
    // grain texture (one canvas, one upload).
    const furniture = furnitureOf(theme);
    const grainy = furniture.wood.finish === "grain";
    const woodFloor = theme.floor.kind !== "concrete" && theme.floor.kind !== "marble";
    const grain =
      woodFloor || grainy
        ? woodGrainTexture(theme.floor.kind === "oak-dark" ? "oak-dark" : "oak-light")
        : null;
    if (grain) textures.push(grain);
    const woodGrain = (m: THREE.MeshStandardMaterial, key: string) => {
      m.map = grain;
      return patchRoomMaterial(m, {
        key,
        roomHalf,
        cross,
        ao: [0.0, 0.3, 0.0],
        replaceMap: `{
  vec3 an = abs(normalize(vRoomNrm));
  vec2 wuv = an.y > 0.5 ? vRoomPos.xz : (an.x > 0.5 ? vRoomPos.yz : vRoomPos.xy);
  diffuseColor *= texture2D(map, wuv / vec2(0.3, 0.6));
}`,
      });
    };
    // Upholstery: each piece's fabric is its vertex colour; velvet gets a sheen at grazing angles in the
    // pile's own colour, and the cloth a woven figure (damask) or a soft crush (velvet, leather) projected in
    // world space.
    const fabric = furniture.up;
    const benchSeat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: fabric.roughness,
      metalness: 0,
      sheen: fabric.sheen,
      sheenRoughness: 0.42,
      sheenColor: new THREE.Color(1, 1, 1),
    });
    if (fabric.weave === "damask") {
      const { map, roughness } = damaskTextures();
      benchSeat.map = map;
      textures.push(map, roughness);
    } else {
      benchSeat.map = plasterAlbedoTexture();
      textures.push(benchSeat.map);
    }
    const cloth = fabric.weave === "damask" ? "vec2(0.26, 0.39)" : "vec2(0.3, 0.3)";
    patchRoomMaterial(benchSeat, {
      key: `bench-up-${fabric.weave}`,
      roomHalf,
      cross,
      ao: [0.0, 0.3, 0.0],
      replaceMap: `{
  vec3 an = abs(normalize(vRoomNrm));
  vec2 wuv = an.y > 0.5 ? vRoomPos.xz : (an.x > 0.5 ? vRoomPos.zy : vRoomPos.xy);
  vec3 weave = texture2D(map, wuv / ${cloth}).rgb;
  diffuseColor.rgb *= mix(vec3(1.0), weave, ${fabric.weave === "damask" ? "0.85" : "0.6"});
}`,
    });
    {
      const room = benchSeat.onBeforeCompile;
      benchSeat.onBeforeCompile = (shader, renderer) => {
        room.call(benchSeat, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <lights_physical_fragment>",
          THREE.ShaderChunk.lights_physical_fragment.replace(
            "material.sheenColor = sheenColor;",
            "material.sheenColor = sheenColor * sqrt(max(vColor.rgb, vec3(0.0)));"
          )
        );
      };
    }
    const frameFinish = furniture.wood.finish;
    const benchFrame = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: { grain: 0.5, lacquer: 0.2, paint: 0.6, steel: 0.3 }[frameFinish],
      metalness: frameFinish === "steel" ? 1 : 0,
    });
    if (grainy) woodGrain(benchFrame, "bench-wood");
    const benchAccent = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: furniture.metal.roughness,
      metalness: furniture.metal.metalness,
    });

    // A palace's gilding (a vault's ribs and cornice bead, the columns' capitals) and its marble columns,
    // veined in world space.
    const gilt = patchRoomMaterial(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.room.gilt ?? theme.frame.color),
        metalness: 1,
        roughness: 0.32,
      }),
      { key: "gilt", roomHalf, cross, ao: [0.45, 0.35, 0.3] }
    );
    const marble = patchRoomMaterial(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.room.marble ?? "#d9d3c7"),
        metalness: 0,
        roughness: 0.18,
      }),
      {
        key: "marble",
        roomHalf,
        cross,
        ao: [0.4, 0.3, 0.2],
        extraColor: `{
  vec3 mp = vRoomPos * vec3(2.2, 0.55, 2.2);
  float n = roomNoise(mp) * 0.55 + roomNoise(mp * 2.3 + 3.1) * 0.3 + roomNoise(mp * 6.1 + 1.7) * 0.15;
  float vein = 1.0 - smoothstep(0.0, 0.03, abs(n - 0.5));
  float vein2 = 1.0 - smoothstep(0.0, 0.015, abs(roomNoise(mp * 3.7 + 9.0) - 0.5));
  diffuseColor.rgb *= 0.82 + 0.36 * n;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.82, 0.76), max(vein * 0.6, vein2 * 0.35));
}`,
      }
    );

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

    const all = [wall, ceiling, trim, track, benchSeat, benchFrame, benchAccent, benchShadow, gilt, marble];
    return {
      wall,
      ceiling,
      trim,
      track,
      benchSeat,
      benchFrame,
      benchAccent,
      benchShadow,
      gilt,
      marble,
      dimmers,
      floorGrain: woodFloor ? grain : null,
      cross,
      dispose() {
        all.forEach((m) => m.dispose());
        textures.forEach((t) => t.dispose());
      },
    };
  }, [layout, theme]);
}

export function Room({
  layout,
  theme,
  runtime,
}: {
  layout: GalleryLayout;
  theme: GalleryTheme;
  runtime: SuiteRuntime;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const hall = useMemo(() => buildHall(layout, theme), [layout, theme]);
  const mats = useRoomMaterials(layout, theme);
  useEffect(() => () => disposeHall(hall), [hall]);
  // A long suite draws only the rooms around the visitor (draw ranges over
  // the merged geometry), and the room AO follows the nearest cross walls.
  useEffect(() => {
    const apply = () => {
      const win = runtime.archWindow();
      for (const k of HALL_PARTS) setRoomWindow(hall[k], hall.ranges[k], win);
      setCrossWindow(mats.cross, layout, runtime.crossFirst(CROSS_SLOTS));
      invalidate();
    };
    apply();
    return runtime.onWindowChange(apply);
  }, [runtime, hall, mats, layout, invalidate]);
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
        W={2 * outerHalf(layout)}
        L={layout.hallLength}
        H={layout.wallHeight}
        theme={theme}
        grain={mats.floorGrain ?? undefined}
        cross={mats.cross}
      />
      <mesh geometry={hall.walls} material={mats.wall} matrixAutoUpdate={false} />
      <mesh geometry={hall.ceiling} material={mats.ceiling} matrixAutoUpdate={false} />
      <mesh geometry={hall.trim} material={mats.trim} matrixAutoUpdate={false} />
      <mesh geometry={hall.benchSeat} material={mats.benchSeat} matrixAutoUpdate={false} />
      <mesh geometry={hall.benchFrame} material={mats.benchFrame} matrixAutoUpdate={false} />
      <mesh geometry={hall.benchAccent} material={mats.benchAccent} matrixAutoUpdate={false} />
      <mesh geometry={hall.gilt} material={mats.gilt} matrixAutoUpdate={false} />
      <mesh geometry={hall.marble} material={mats.marble} matrixAutoUpdate={false} />
      {/* small props: skipped by the floor reflection */}
      <mesh geometry={hall.track} material={mats.track} matrixAutoUpdate={false} layers={1} />
      <mesh
        geometry={hall.benchShadow}
        material={mats.benchShadow}
        matrixAutoUpdate={false}
        layers={1}
        renderOrder={1}
      />
      {/* a suite's room numbers over the doorways */}
      <RoomSigns layout={layout} runtime={runtime} />
    </group>
  );
}
