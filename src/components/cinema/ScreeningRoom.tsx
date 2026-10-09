"use client";

// A gallery's screening room (layout.ts Screening): a small room beside the gallery, in its style, where the
// films about the artist play (archive/films.py, artist.films). The gallery's wall colour, floor and trim; two
// rows of the room style's own chairs facing a plain screen on the far wall; the projector on its stand behind
// them, its beam over their heads to the screen. While a film runs the ceiling lights dim, and the picture
// lights the room in its own colours (a projected film; an embedded player's light is a neutral flicker).
//
// - the picture: a projected film is a video texture on the screen, an embedded one (YouTube, Vimeo,
//   Dailymotion) the provider's player behind a hole in the canvas exactly where the picture falls (drei Html,
//   blending occlusion);
// - the beam: the pyramid of light from the lens to the picture, ray-marched through a faint haze in a shader,
//   coloured by the picture itself (a tiny copy of the frame);
// - the room is built far from the hall, so the gallery's lights do not reach it nor its own the gallery; all
//   its lights exist from the start (only their intensity changes: no shader recompiles), and its surfaces'
//   share of the gallery's environment light dims with the ceiling lights.
//
// ScreeningDoor is its doorway in the gallery's wall: a velvet curtain in a casing of the gallery's trim, a card
// over it; the same curtain hangs inside. Walking into either curtain takes one through (ScreeningPassage).

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { GalleryLayout, Screening } from "@/components/museum/layout";
import { WALL_MARGIN, inScreening } from "@/components/museum/layout";
import type { GalleryTheme } from "@/components/museum/theme";
import { GeoBatch } from "@/components/museum/room-geometry";
import { buildFurnishing, furnitureOf } from "@/components/museum/furniture";
import { concreteTexture, woodGrainTexture } from "@/components/museum/textures";
import { stepRuntime, type CinemaRuntime } from "./cinema-runtime";
import { embedSrc } from "./film-deck";
import { glowTexture } from "./cinema-textures";
import { Projector } from "./Projector";

/** Additive light that leaves the canvas's alpha alone (an embedded player shows through a transparent hole). */
function additive(m: THREE.ShaderMaterial): THREE.ShaderMaterial {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.toneMapped = false;
  return m;
}

const PROJECT_GLSL = /* glsl */ `
  uniform vec3 uLens;
  uniform float uScreenZ;
  uniform vec4 uRect;
  // where the line from the lens through p meets the picture (0..1 inside it)
  vec2 pictureUv(vec3 p) {
    float s = (uScreenZ - uLens.z) / (p.z - uLens.z);
    vec2 q = uLens.xy + (p.xy - uLens.xy) * s;
    return (q - uRect.xy) / uRect.zw + 0.5;
  }
`;

const NOISE_GLSL = /* glsl */ `
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;

type Room = Screening;
type Rt = RefObject<CinemaRuntime | null>;
const centreY = (r: Room) => r.screen.bottom + r.screen.h / 2;

// ------------------------------------------------------------------------------------------------ the director

/** Each frame while one is in the room (or a film runs): the light from the deck, the volume from where one
 *  stands, the surfaces' environment light with the ceiling lights. The gallery renders on demand: this keeps
 *  frames coming while there is something to see move. Whoever leaves the room (through the curtain, by the
 *  room navigator) leaves the film paused. */
function Director({ layout, runtime, materials, lamps, onInside }: { layout: GalleryLayout; runtime: Rt; materials: RefObject<THREE.MeshStandardMaterial[]>; lamps: RefObject<THREE.MeshStandardMaterial[]>; onInside: (inside: boolean) => void }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const room = layout.screening!;
  const said = useRef<boolean | null>(null);
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const rt = runtime.current;
      const inside = inScreening(layout, camera.position.x);
      if (inside !== said.current) {
        said.current = inside;
        onInside(inside);
      }
      const status = rt?.deck.state.status;
      if (!inside && rt && (status === "playing" || status === "loading")) rt.deck.pause();
      if (inside || (rt && rt.level > 0.002)) invalidate();
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [layout, camera, runtime, invalidate, onInside]);
  useFrame((_, dt) => {
    const rt = runtime.current;
    if (!rt) return;
    stepRuntime(rt, Math.min(dt, 1 / 20), performance.now());
    const d = Math.hypot(camera.position.x - room.screen.cx, camera.position.y - centreY(room), camera.position.z - room.screen.z);
    rt.deck.setVolume(Math.max(0.45, Math.min(1, 1.15 - d / 16)));
    const env = 0.03 + 0.6 * rt.house + 0.25 * rt.lum * rt.level;
    for (const m of materials.current ?? []) m.envMapIntensity = env;
    for (const m of lamps.current ?? []) m.emissiveIntensity = 1.2 * rt.house;
  });
  return null;
}

// ---------------------------------------------------------------------------------------------- the room

/** The gallery's floor, as the room style lays it (wood, stone, concrete), at the scale of a room. */
function floorMaterial(theme: GalleryTheme): { mat: THREE.MeshStandardMaterial; map: THREE.Texture | null } {
  const kind = theme.floor.kind;
  const map = kind === "concrete" ? concreteTexture() : kind === "marble" ? null : woodGrainTexture(kind === "oak-dark" ? "oak-dark" : "oak-light");
  if (map) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(kind === "concrete" ? 2 : 4, kind === "concrete" ? 2 : 2.5);
  }
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(theme.floor.tint),
    map,
    roughness: Math.max(0.35, theme.room.floorRoughness),
    metalness: 0,
  });
  return { mat, map };
}

function Shell({ room, theme, register, lamps }: { room: Room; theme: GalleryTheme; register: (m: THREE.MeshStandardMaterial) => void; lamps: RefObject<THREE.MeshStandardMaterial[]> }) {
  const { x0, x1, z0, z1, height: H, doorZ } = room;
  const W = x1 - x0;
  const L = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const dh = room.door.halfWidth;
  const DH = room.door.height;
  const mats = useMemo(() => {
    // the gallery's wall paint, a shade deeper (a room for the dark)
    const wall = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.wall.color).multiplyScalar(0.72), roughness: Math.max(0.7, theme.wall.roughness) });
    const ceiling = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.ceiling).multiplyScalar(0.5), roughness: 0.95 });
    const trim = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.trim), roughness: 0.55 });
    const floor = floorMaterial(theme);
    const lamp = new THREE.MeshStandardMaterial({ color: "#f4efe6", emissive: new THREE.Color("#ffe3bd"), emissiveIntensity: 1.2, roughness: 0.6 });
    return { wall, ceiling, trim, floor: floor.mat, map: floor.map, lamp };
  }, [theme]);
  useEffect(() => {
    [mats.wall, mats.ceiling, mats.trim, mats.floor].forEach(register);
    lamps.current = [mats.lamp];
    return () => {
      [mats.wall, mats.ceiling, mats.trim, mats.floor, mats.lamp].forEach((m) => m.dispose());
      mats.map?.dispose();
    };
  }, [mats, register, lamps]);
  const skirt = 0.12;
  // the left wall in three pieces round the doorway: before it, after it, above it
  const before = doorZ - dh - z0;
  const after = z1 - (doorZ + dh);
  return (
    <group>
      <mesh material={mats.floor} position={[cx, 0, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, L]} />
      </mesh>
      <mesh material={mats.ceiling} position={[cx, H, cz]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, L]} />
      </mesh>
      {/* the screen wall (−z), the back wall, the right wall */}
      <mesh material={mats.wall} position={[cx, H / 2, z0]}>
        <planeGeometry args={[W, H]} />
      </mesh>
      <mesh material={mats.wall} position={[cx, H / 2, z1]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[W, H]} />
      </mesh>
      <mesh material={mats.wall} position={[x1, H / 2, cz]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[L, H]} />
      </mesh>
      <mesh material={mats.wall} position={[x0, H / 2, z0 + before / 2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[before, H]} />
      </mesh>
      <mesh material={mats.wall} position={[x0, H / 2, z1 - after / 2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[after, H]} />
      </mesh>
      <mesh material={mats.wall} position={[x0, (DH + H) / 2, doorZ]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2 * dh, H - DH]} />
      </mesh>
      {/* the skirting, round the room and either side of the doorway */}
      <mesh material={mats.trim} position={[cx, skirt / 2, z0 + 0.012]}>
        <boxGeometry args={[W, skirt, 0.024]} />
      </mesh>
      <mesh material={mats.trim} position={[cx, skirt / 2, z1 - 0.012]}>
        <boxGeometry args={[W, skirt, 0.024]} />
      </mesh>
      <mesh material={mats.trim} position={[x1 - 0.012, skirt / 2, cz]}>
        <boxGeometry args={[0.024, skirt, L]} />
      </mesh>
      <mesh material={mats.trim} position={[x0 + 0.012, skirt / 2, z0 + before / 2]}>
        <boxGeometry args={[0.024, skirt, before]} />
      </mesh>
      <mesh material={mats.trim} position={[x0 + 0.012, skirt / 2, z1 - after / 2]}>
        <boxGeometry args={[0.024, skirt, after]} />
      </mesh>
      {/* the doorway's casing and its curtain, from inside */}
      <DoorCase x={x0} z={doorZ} facing={1} halfWidth={dh} height={DH} material={mats.trim} />
      <Curtain x={x0 + 0.06} z={doorZ} facing={1} halfWidth={dh} height={DH} />
      {/* two ceiling lights */}
      {[cz - L / 4, cz + L / 4].map((z) => (
        <mesh key={z} material={mats.lamp} position={[cx, H - 0.02, z]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.28, 40]} />
        </mesh>
      ))}
    </group>
  );
}

/** A doorway's casing in a wall of constant x (facing: +1 into +x, −1 into −x). */
function DoorCase({ x, z, facing, halfWidth, height, material }: { x: number; z: number; facing: 1 | -1; halfWidth: number; height: number; material: THREE.Material }) {
  const w = 0.11;
  const d = 0.06;
  const xc = x + facing * (d / 2);
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} material={material} position={[xc, (height + w) / 2, z + s * (halfWidth + w / 2)]}>
          <boxGeometry args={[d, height + w, w]} />
        </mesh>
      ))}
      <mesh material={material} position={[xc, height + w / 2, z]}>
        <boxGeometry args={[d, w, 2 * halfWidth + 2 * w]} />
      </mesh>
    </group>
  );
}

function velvetFolds(w: number, h: number, folds: number, depth: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h, folds * 8, 12);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    // deeper folds toward the floor, where the cloth hangs free
    const k = 0.75 + 0.25 * (1 - (y + h / 2) / h);
    p.setZ(i, Math.sin((x / w) * Math.PI * 2 * folds) * depth * k + Math.sin((x / w) * Math.PI * 2 * folds * 2.3 + 1.1) * depth * 0.18);
  }
  g.computeVertexNormals();
  return g;
}

/** The black velvet curtain that keeps the gallery's light out, hung in a doorway of a wall of constant x. */
function Curtain({ x, z, facing, halfWidth, height }: { x: number; z: number; facing: 1 | -1; halfWidth: number; height: number }) {
  const geo = useMemo(() => velvetFolds(2 * halfWidth + 0.04, height - 0.02, 6, 0.035), [halfWidth, height]);
  const mat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: "#141113", roughness: 0.85, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color("#6d6470") }),
    []
  );
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat]);
  return <mesh geometry={geo} material={mat} position={[x, height / 2, z]} rotation={[0, facing * (Math.PI / 2), 0]} />;
}

// ------------------------------------------------------------------------------------------------- the chairs

/** The room style's chairs in their rows, built as the gallery builds its seating (furniture.ts), in the
 *  style's fabric, wood and metal. */
function Chairs({ room, theme, register }: { room: Room; theme: GalleryTheme; register: (m: THREE.MeshStandardMaterial) => void }) {
  const built = useMemo(() => {
    const set = furnitureOf(theme);
    const boxes = new Map<string, THREE.BufferGeometry>();
    const up = new GeoBatch(boxes, true);
    const wood = new GeoBatch(boxes, true);
    const metal = new GeoBatch(boxes, true);
    for (const f of room.chairs) buildFurnishing(set, { up, wood, metal }, f);
    boxes.forEach((g) => g.dispose());
    const fabric = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, vertexColors: true, roughness: set.up.roughness, metalness: 0,
      sheen: set.up.sheen, sheenRoughness: 0.42, sheenColor: new THREE.Color(0.6, 0.6, 0.6),
    });
    const finish = set.wood.finish;
    const frame = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: { grain: 0.5, lacquer: 0.2, paint: 0.6, steel: 0.3 }[finish], metalness: finish === "steel" ? 1 : 0,
    });
    const accent = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: set.metal.roughness, metalness: set.metal.metalness });
    return [
      { geo: up.build(), mat: fabric },
      { geo: wood.build(), mat: frame },
      { geo: metal.build(), mat: accent },
    ];
  }, [room, theme]);
  useEffect(() => {
    built.forEach((b) => register(b.mat));
    return () => built.forEach((b) => (b.geo.dispose(), b.mat.dispose()));
  }, [built, register]);
  return (
    <group>
      {built.map((b, i) => (
        <mesh key={i} geometry={b.geo} material={b.mat} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------------------------------------------- the screen

/** A plain projection screen on the far wall: a matt white board in a narrow black border. */
function ScreenBoard({ room, register }: { room: Room; register: (m: THREE.MeshStandardMaterial) => void }) {
  const { w, h, z, cx } = room.screen;
  const cy = centreY(room);
  const mats = useMemo(
    () => ({
      white: new THREE.MeshStandardMaterial({ color: "#e4e2dc", roughness: 0.95, metalness: 0 }),
      black: new THREE.MeshStandardMaterial({ color: "#0b0b0c", roughness: 0.9, metalness: 0 }),
    }),
    []
  );
  useEffect(() => {
    register(mats.white);
    register(mats.black);
    return () => (mats.white.dispose(), mats.black.dispose());
  }, [mats, register]);
  const b = 0.07;
  return (
    <group>
      <mesh material={mats.black} position={[cx, cy, z - 0.03]}>
        <boxGeometry args={[w + 2 * b, h + 2 * b, 0.05]} />
      </mesh>
      <mesh material={mats.white} position={[cx, cy, z]}>
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  );
}

/** A projected film's picture: the frame on the screen, with the lamp's hot spot; before the first frame, the
 *  lamp's white (the leader). Added to the lit screen. */
function Picture({ runtime, room }: { runtime: Rt; room: Room }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () =>
      additive(
        new THREE.ShaderMaterial({
          uniforms: { uMap: { value: null }, uHasMap: { value: 0 }, uLevel: { value: 0 }, uGain: { value: 0.78 } },
          vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: /* glsl */ `
            uniform sampler2D uMap; uniform float uHasMap; uniform float uLevel; uniform float uGain;
            varying vec2 vUv;
            void main() {
              vec2 c = (vUv - 0.5) * vec2(1.0, 0.75);
              float hot = 1.0 - 0.35 * dot(c, c);   // a little brighter in the middle, as a lamp throws it
              vec3 pic = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : vec3(0.42, 0.41, 0.39);
              gl_FragColor = vec4(pic * hot * uLevel * uGain, 0.0);
              #include <colorspace_fragment>
              gl_FragColor.a = 0.0;
            }`,
        })
      ),
    []
  );
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    const rt = runtime.current;
    const m = mesh.current;
    if (!rt || !m) return;
    const show = rt.textured && rt.level > 0.002;
    m.visible = show;
    if (!show) return;
    m.scale.set(rt.rect.w, rt.rect.h, 1);
    m.position.set(rt.rect.cx, rt.rect.cy, room.screen.z + 0.006);
    const v = rt.deck.video;
    const ready = !!v && v.readyState >= 2 && v.videoWidth > 0;
    mat.uniforms.uMap.value = ready ? rt.deck.texture : null;
    mat.uniforms.uHasMap.value = ready ? 1 : 0;
    mat.uniforms.uLevel.value = rt.level;
  });
  return (
    <mesh ref={mesh} material={mat} visible={false}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

/** An embedded film (or a file its host would not let us read): the provider's player in the picture's place,
 *  behind a hole in the canvas. 1280 CSS pixels across, scaled to the picture. */
function Embed({ runtime, room, origin, inside }: { runtime: Rt; room: Room; origin: string; inside: boolean }) {
  const rt = runtime.current!;
  const film = rt.deck.state.film;
  const mode = rt.deck.state.mode;
  const status = rt.deck.state.status;
  const holder = useRef<HTMLDivElement>(null);
  const src = film && mode === "dom" && film.kind !== "file" && film.kind !== "hls" ? embedSrc(film, origin) : null;
  // a Dailymotion frame takes no orders: pausing takes it down
  const show = !!film && mode === "dom" && !(film.kind === "dailymotion" && status === "paused");
  const domVideo = !!film && mode === "dom" && (film.kind === "file" || film.kind === "hls");
  useEffect(() => {
    const v = rt.deck.video;
    if (!domVideo || !v || !holder.current) return;
    v.style.width = "100%";
    v.style.height = "100%";
    v.style.objectFit = "contain";
    v.style.background = "#000";
    holder.current.appendChild(v);
    return () => {
      v.remove();
    };
  }, [domVideo, rt]);
  if (!show) return null;
  const w = 1280;
  const h = Math.round(w / (rt.rect.w / rt.rect.h));
  return (
    <Html
      transform
      occlude="blending"
      position={[rt.rect.cx, rt.rect.cy, room.screen.z + 0.012]}
      distanceFactor={(rt.rect.w * 400) / w}
      pointerEvents="none"
      // drei lifts the canvas to half the range's top and puts the player under it: both stay under the HUD
      zIndexRange={[16, 0]}
      // out in the gallery the player stays loaded (and paused), out of sight
      style={{ visibility: inside ? "visible" : "hidden" }}
    >
      {src ? (
        <iframe
          key={film!.id}
          ref={(el) => rt.deck.register(el)}
          src={src}
          width={w}
          height={h}
          title={film!.title}
          allow="autoplay; encrypted-media; picture-in-picture"
          onLoad={() => rt.deck.frameLoaded()}
          style={{ border: 0, display: "block", background: "#000", pointerEvents: "none" }}
        />
      ) : (
        <div ref={holder} style={{ width: w, height: h, background: "#000", pointerEvents: "none" }} />
      )}
    </Html>
  );
}

// --------------------------------------------------------------------------------------------------- the beam

/** The projector's beam: the light between the lens and the picture, seen in a faint haze, in the picture's
 *  colours; brightest by the lens. */
function Beam({ runtime, room }: { runtime: Rt; room: Room }) {
  const mesh = useRef<THREE.Mesh>(null);
  const lastRect = useRef("");
  const lens = room.projector.lens;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(5 * 3), 3));
    // the apex (0), the picture's corners (1..4): four sides and the base
    g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 1, 3, 2, 1, 4, 3]);
    return g;
  }, []);
  const mat = useMemo(
    () =>
      additive(
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          uniforms: {
            uLens: { value: new THREE.Vector3(...lens) },
            uScreenZ: { value: room.screen.z },
            uRect: { value: new THREE.Vector4() },
            uPlanes: { value: Array.from({ length: 5 }, () => new THREE.Vector4()) },
            uImage: { value: null },
            uTextured: { value: 0 },
            uColor: { value: new THREE.Color() },
            uLevel: { value: 0 },
            uTime: { value: 0 },
            uGain: { value: 0.5 },
          },
          vertexShader: /* glsl */ `
            varying vec3 vWorld;
            void main() {
              vec4 w = modelMatrix * vec4(position, 1.0);
              vWorld = w.xyz;
              gl_Position = projectionMatrix * viewMatrix * w;
            }`,
          fragmentShader: /* glsl */ `
            ${PROJECT_GLSL}
            ${NOISE_GLSL}
            uniform vec4 uPlanes[5];
            uniform sampler2D uImage;
            uniform float uTextured;
            uniform vec3 uColor;
            uniform float uLevel;
            uniform float uTime;
            uniform float uGain;
            varying vec3 vWorld;
            void main() {
              vec3 ro = cameraPosition;
              vec3 rd = normalize(vWorld - ro);
              float t0 = 0.0;
              float t1 = length(vWorld - ro);
              // the ray's stretch inside the pyramid (its planes face out)
              for (int i = 0; i < 5; i++) {
                vec3 n = uPlanes[i].xyz;
                float denom = dot(n, rd);
                float dist = dot(n, ro) - uPlanes[i].w;
                if (abs(denom) < 1e-5) { if (dist > 0.0) discard; continue; }
                float t = -dist / denom;
                if (denom < 0.0) t0 = max(t0, t); else t1 = min(t1, t);
              }
              if (t1 <= t0) discard;
              const int N = 20;
              float dt = (t1 - t0) / float(N);
              float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
              vec3 acc = vec3(0.0);
              for (int i = 0; i < N; i++) {
                vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt);
                vec2 uv = pictureUv(p);
                float edge = smoothstep(0.0, 0.03, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
                vec3 col = uTextured > 0.5 ? texture2D(uImage, uv).rgb : uColor;
                float d = distance(p, uLens);
                // a faint haze, drifting slowly
                vec3 drift = vec3(uTime * 0.01, uTime * 0.03, -uTime * 0.02);
                float haze = 0.45 + 0.55 * noise3(p * 1.3 + drift);
                float fall = 1.0 / (0.5 + d * d);
                float nearScreen = smoothstep(0.0, 0.8, p.z - uScreenZ);
                acc += col * haze * fall * edge * nearScreen;
              }
              gl_FragColor = vec4(acc * dt * uLevel * uGain, 0.0);
              #include <colorspace_fragment>
              gl_FragColor.a = 0.0;
            }`,
        })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat]);
  useFrame(() => {
    const rt = runtime.current;
    const m = mesh.current;
    if (!rt || !m) return;
    m.visible = rt.level > 0.003;
    const { w, h, cx, cy } = rt.rect;
    const key = `${w.toFixed(3)}x${h.toFixed(3)}`;
    if (key !== lastRect.current) {
      lastRect.current = key;
      const z = room.screen.z + 0.03;
      const apex = new THREE.Vector3(...lens);
      const c = [
        new THREE.Vector3(cx - w / 2, cy - h / 2, z),
        new THREE.Vector3(cx + w / 2, cy - h / 2, z),
        new THREE.Vector3(cx + w / 2, cy + h / 2, z),
        new THREE.Vector3(cx - w / 2, cy + h / 2, z),
      ];
      const pos = geo.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, apex.x, apex.y, apex.z);
      c.forEach((v, i) => pos.setXYZ(i + 1, v.x, v.y, v.z));
      pos.needsUpdate = true;
      geo.computeBoundingSphere();
      // the four sides' planes (outward) and the screen's
      const centre = new THREE.Vector3(cx, cy, (z + apex.z) / 2);
      const planes = mat.uniforms.uPlanes.value as THREE.Vector4[];
      for (let i = 0; i < 4; i++) {
        const pl = new THREE.Plane().setFromCoplanarPoints(apex, c[i], c[(i + 1) % 4]);
        if (pl.distanceToPoint(centre) > 0) pl.negate();
        planes[i].set(pl.normal.x, pl.normal.y, pl.normal.z, -pl.constant);
      }
      planes[4].set(0, 0, -1, -z);
      (mat.uniforms.uRect.value as THREE.Vector4).set(cx, cy, w, h);
    }
    mat.uniforms.uImage.value = rt.deck.small;
    mat.uniforms.uTextured.value = rt.textured ? 1 : 0;
    // an embedded film, the leader: the lamp's light, its colour from the room's
    (mat.uniforms.uColor.value as THREE.Color).copy(rt.color).multiplyScalar(1.5).addScalar(0.1);
    mat.uniforms.uLevel.value = rt.level;
    mat.uniforms.uTime.value = rt.time;
  });
  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />;
}

/** The lens glows when one looks into the beam. */
function LensGlow({ runtime, room }: { runtime: Rt; room: Room }) {
  const camera = useThree((s) => s.camera);
  const sprite = useRef<THREE.Sprite>(null);
  const tex = useMemo(() => glowTexture(), []);
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), [tex]);
  useEffect(() => () => (tex.dispose(), mat.dispose()), [tex, mat]);
  const lens = room.projector.lens;
  const beamDir = useMemo(() => new THREE.Vector3(room.screen.cx - lens[0], centreY(room) - lens[1], room.screen.z - lens[2]).normalize(), [room, lens]);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const rt = runtime.current;
    const s = sprite.current;
    if (!rt || !s) return;
    v.set(camera.position.x - lens[0], camera.position.y - lens[1], camera.position.z - lens[2]).normalize();
    const facing = Math.max(0, v.dot(beamDir));
    mat.opacity = Math.min(1, rt.level * (0.1 + 0.7 * Math.pow(facing, 6)));
    mat.color.copy(rt.color).multiplyScalar(0.5).addScalar(0.6);
    const size = 0.16 + 0.9 * Math.pow(facing, 10) * rt.level;
    s.scale.set(size, size, 1);
    s.visible = rt.level > 0.01;
  });
  return <sprite ref={sprite} material={mat} position={[lens[0], lens[1], lens[2] - 0.02]} renderOrder={7} />;
}

// ------------------------------------------------------------------------------------------------- the lights

/** The ceiling lights (they dim while a film runs) and the screen's light thrown back over the chairs. Point
 *  and spot lights with a reach: none of it gets as far as the gallery. */
function Lights({ runtime, room }: { runtime: Rt; room: Room }) {
  const bounce = useRef<THREE.SpotLight>(null);
  const house = useRef<(THREE.PointLight | null)[]>([]);
  const { x0, x1, z0, z1, height: H } = room;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const L = z1 - z0;
  useLayoutEffect(() => {
    const b = bounce.current;
    if (!b) return;
    b.target.position.set(cx, 0.6, z1);
    b.target.updateMatrixWorld();
  }, [cx, z1]);
  useFrame(() => {
    const rt = runtime.current;
    if (!rt) return;
    const film = rt.level * (0.12 + 1.3 * rt.lum);
    if (bounce.current) {
      bounce.current.color.copy(rt.color).multiplyScalar(1 / Math.max(0.05, rt.lum)).lerp(new THREE.Color(1, 1, 1), 0.25);
      bounce.current.intensity = 14 * film;
    }
    house.current.forEach((l) => l && (l.intensity = 5 * rt.house));
  });
  return (
    <group>
      <spotLight ref={bounce} position={[cx, centreY(room), room.screen.z + 0.25]} angle={1.15} penumbra={1} distance={L + 2} decay={1.6} intensity={0} />
      {[cz - L / 4, cz + L / 4].map((z, i) => (
        <pointLight key={z} ref={(l) => void (house.current[i] = l)} position={[cx, H - 0.35, z]} color="#ffd9b0" intensity={5} distance={9} decay={2} />
      ))}
    </group>
  );
}

// -------------------------------------------------------------------------------------------- the room, whole

/** With the cursor captured, a click on the screen (or the projector) starts or pauses the film. */
function ScreenClick({ layout, onScreen }: { layout: GalleryLayout; onScreen: () => void }) {
  const camera = useThree((s) => s.camera);
  const room = layout.screening!;
  useEffect(() => {
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -room.screen.z);
    const hit = new THREE.Vector3();
    const body = new THREE.Vector3(room.projector.x, room.projector.lens[1], room.projector.z);
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !document.pointerLockElement || !inScreening(layout, camera.position.x)) return;
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      const near = ray.ray.distanceToPoint(body) < 0.55 && camera.position.distanceTo(body) < 3.5;
      const onWall =
        ray.ray.intersectPlane(plane, hit) &&
        Math.abs(hit.x - room.screen.cx) < room.screen.w / 2 + 0.25 &&
        Math.abs(hit.y - centreY(room)) < room.screen.h / 2 + 0.25;
      if (near || onWall) onScreen();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [camera, layout, room, onScreen]);
  return null;
}

export interface ScreeningRoomProps {
  layout: GalleryLayout;
  theme: GalleryTheme;
  runtime: Rt;
  origin: string;
  /** The deck's state changed (an embed mounts or unmounts). */
  deckKey: string;
  /** The visitor is in the room (onInside's last word). */
  inside: boolean;
  /** The visitor came into the room, or left it. */
  onInside: (inside: boolean) => void;
  /** A click on the screen or the projector. */
  onScreen: () => void;
}

export function ScreeningRoom({ layout, theme, runtime, origin, deckKey, inside, onInside, onScreen }: ScreeningRoomProps) {
  const room = layout.screening!;
  const materials = useRef<THREE.MeshStandardMaterial[]>([]);
  const lamps = useRef<THREE.MeshStandardMaterial[]>([]);
  const register = useMemo(() => (m: THREE.MeshStandardMaterial) => void materials.current.push(m), []);
  const cable = room.x1 - 0.05 - room.projector.x;
  return (
    <group>
      <Director layout={layout} runtime={runtime} materials={materials} lamps={lamps} onInside={onInside} />
      <ScreenClick layout={layout} onScreen={onScreen} />
      <Shell room={room} theme={theme} register={register} lamps={lamps} />
      <Chairs room={room} theme={theme} register={register} />
      <ScreenBoard room={room} register={register} />
      <Picture runtime={runtime} room={room} />
      {runtime.current && <Embed key={deckKey} runtime={runtime} room={room} origin={origin} inside={inside} />}
      {runtime.current && <Projector runtime={runtime as RefObject<CinemaRuntime>} x={room.projector.x} z={room.projector.z} lens={room.projector.lens} cable={cable} />}
      <Beam runtime={runtime} room={room} />
      <LensGlow runtime={runtime} room={room} />
      <Lights runtime={runtime} room={room} />
    </group>
  );
}

// ------------------------------------------------------------------------------------- the doorway, in the gallery

/** A card over the doorway: "Films", and how many. */
function cardTexture(count: number, trim: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f3efe6";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = trim;
  g.lineWidth = 4;
  g.strokeRect(6, 6, c.width - 12, c.height - 12);
  g.fillStyle = "#1d1a17";
  g.textAlign = "center";
  g.font = "600 58px Georgia, 'Times New Roman', serif";
  g.fillText("Films", c.width / 2, 78);
  g.font = "28px Georgia, 'Times New Roman', serif";
  g.fillStyle = "#4a443c";
  g.fillText(`${count} film${count === 1 ? "" : "s"} about the artist`, c.width / 2, 124);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The screening room's doorway in the gallery's right wall: a velvet curtain in a casing of the gallery's
 *  trim, the card over it. */
export function ScreeningDoor({ layout, theme, films }: { layout: GalleryLayout; theme: GalleryTheme; films: number }) {
  const room = layout.screening!;
  const x = layout.hallWidth / 2;
  const { z, halfWidth, height } = room.door;
  const trim = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.trim), roughness: 0.55 }), [theme]);
  const card = useMemo(() => {
    const map = cardTexture(films, theme.trim);
    return { map, mat: new THREE.MeshStandardMaterial({ map, roughness: 0.8 }) };
  }, [films, theme]);
  useEffect(() => () => (trim.dispose(), card.map.dispose(), card.mat.dispose()), [trim, card]);
  return (
    <group>
      <DoorCase x={x} z={z} facing={-1} halfWidth={halfWidth} height={height} material={trim} />
      <Curtain x={x - 0.07} z={z} facing={-1} halfWidth={halfWidth} height={height} />
      <mesh material={card.mat} position={[x - 0.012, height + 0.42, z]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[0.84, 0.2625]} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------ the passage

/** Walking into either curtain takes one through it (the caller fades around the move). */
export function ScreeningPassage({ layout, enabled, onPass }: { layout: GalleryLayout; enabled: boolean; onPass: (into: boolean) => void }) {
  const camera = useThree((s) => s.camera);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const armed = useRef(true);
  const room = layout.screening!;
  useFrame(() => {
    if (!enabled) return;
    const p = camera.position;
    camera.getWorldDirection(dir);
    const inside = inScreening(layout, p.x);
    const edge = inside ? room.x0 + WALL_MARGIN + 0.04 : layout.hallWidth / 2 - WALL_MARGIN - 0.04;
    const z = inside ? room.doorZ : room.door.z;
    const at = Math.abs(p.z - z) < room.door.halfWidth - 0.05 && (inside ? p.x <= edge : p.x >= edge);
    const toward = inside ? dir.x < -0.25 : dir.x > 0.25;
    if (!at) armed.current = true;
    else if (armed.current && toward) {
      armed.current = false;
      onPass(!inside);
    }
  });
  return null;
}

/** Where one stands on coming through: just inside the room, looking toward the screen; or back in the gallery,
 *  a step from the curtain, looking into the room. */
export function screeningArrival(layout: GalleryLayout, into: boolean): { x: number; z: number; yaw: number } {
  const room = layout.screening!;
  if (into) return { x: room.x0 + 0.95, z: room.doorZ, yaw: -0.3 };
  return { x: layout.hallWidth / 2 - 1.4, z: room.door.z, yaw: Math.PI / 2 };
}
