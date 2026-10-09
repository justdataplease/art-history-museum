"use client";

// The cinema, in 3D: a dark auditorium with rows of velvet seats, curtains either side of the screen, sconces
// on fabric walls, and the projector on its stand behind the last row. While a film runs:
// - the picture: a projected film is a video texture on the screen (with the projector's hot spot), an embedded
//   one the provider's player behind a hole in the canvas exactly where the picture falls (drei Html, blending
//   occlusion); the side masking closes in to frame a 4:3 film;
// - the beam: the pyramid of light from the lens to the picture, ray-marched through slowly moving haze in a
//   shader, coloured by the picture itself (a tiny copy of the frame), brightest by the lens;
// - the dust: specks drifting in the air, lit only where the beam crosses them, in the picture's colours;
// - the room: the house lights dim, and the screen throws the film's light back over the seats and walls (an
//   area light the colour of the frame's average); the lens glares when one looks into it.
// All lights exist from the start (only their intensity changes: no shader recompiles).

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EntryDolly, Player, TouchPlayer, type LockApi } from "@/components/museum/Controls";
import type { GalleryLayout } from "@/components/museum/layout";
import { DOOR, HALL, LENS, PROJECTOR, ROWS, SCREEN, SCREEN_CY, SEAT_H, STAGE, blockX, rowZ, seatCentres } from "./cinema-layout";
import { stepRuntime, type CinemaRuntime } from "./cinema-runtime";
import { embedSrc } from "./film-deck";
import { carpetTexture, exitTexture, fabricTexture, glowTexture, woodTexture } from "./cinema-textures";
import { Projector } from "./Projector";

RectAreaLightUniformsLib.init();

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

// ------------------------------------------------------------------------------------------------ the director

/** Each frame: the room's light from the deck, the volume from where the visitor stands. */
function Director({ runtime, onLeave, armed }: { runtime: RefObject<CinemaRuntime>; onLeave: () => void; armed: boolean }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const left = useRef(false);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  // Test hook, as the gallery's (Gallery.tsx): an init script sets window.__MUSEUM_DEBUG__
  useEffect(() => {
    const w = window as unknown as { __MUSEUM_DEBUG__?: boolean; __cinema?: unknown };
    if (!w.__MUSEUM_DEBUG__) return;
    w.__cinema = { camera, scene, runtime: runtime.current, deck: runtime.current?.deck };
    return () => {
      w.__cinema = undefined;
    };
  }, [camera, scene, runtime]);
  useFrame((_, dt) => {
    const rt = runtime.current;
    if (!rt) return;
    stepRuntime(rt, Math.min(dt, 1 / 20), performance.now());
    scene.environmentIntensity = 0.06 + 0.5 * rt.house + 0.5 * rt.lum * rt.level;
    const d = Math.hypot(camera.position.x, camera.position.y - SCREEN_CY, camera.position.z - SCREEN.z);
    rt.deck.setVolume(Math.max(0.35, Math.min(1, 1.2 - d / 26)));
    // back out through the door one came in by
    if (armed && !left.current && camera.position.z > HALL.L / 2 - 0.75 && Math.abs(camera.position.x - DOOR.x) < DOOR.halfWidth) {
      left.current = true;
      onLeave();
    }
  });
  return null;
}

// ---------------------------------------------------------------------------------------------------- the hall

function Hall({ runtime }: { runtime: RefObject<CinemaRuntime> }) {
  const tex = useMemo(() => {
    const fabric = fabricTexture("#3a1a1f");
    fabric.repeat.set(6, 3);
    const back = fabricTexture("#16090b");
    back.repeat.set(5, 3);
    const carpet = carpetTexture();
    carpet.repeat.set(HALL.W / 1.6, HALL.L / 1.6);
    const wood = woodTexture();
    wood.repeat.set(3, 1);
    const stageWood = woodTexture();
    stageWood.repeat.set(4, 1);
    return { fabric, back, carpet, wood, stageWood, exit: exitTexture() };
  }, []);
  useEffect(() => () => Object.values(tex).forEach((t) => t.dispose()), [tex]);
  const sconceMat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    const rt = runtime.current;
    if (rt && sconceMat.current) sconceMat.current.emissiveIntensity = 0.15 + 3.2 * rt.house;
  });

  const { W, L, H } = HALL;
  const dado = 1.1;
  const sconces: [number, number][] = [];
  for (const z of [-5.8, -1.6, 2.6, 6.8]) for (const side of [-1, 1]) sconces.push([side, z]);
  return (
    <group>
      {/* floor: carpet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, L]} />
        <meshStandardMaterial map={tex.carpet} roughness={0.95} metalness={0} />
      </mesh>
      {/* ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, H, 0]}>
        <planeGeometry args={[W, L]} />
        <meshStandardMaterial color="#0f0c0e" roughness={0.95} />
      </mesh>
      {/* side walls: wood dado, fabric above, pilasters between the panels */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * (W / 2), 0, 0]} rotation={[0, -side * (Math.PI / 2), 0]}>
          <mesh position={[0, dado / 2, 0]}>
            <planeGeometry args={[L, dado]} />
            <meshStandardMaterial map={tex.wood} roughness={0.55} metalness={0.05} />
          </mesh>
          <mesh position={[0, dado + (H - dado) / 2, 0]}>
            <planeGeometry args={[L, H - dado]} />
            <meshStandardMaterial map={tex.fabric} roughness={1} />
          </mesh>
          <mesh position={[0, dado, 0.03]}>
            <boxGeometry args={[L, 0.06, 0.06]} />
            <meshStandardMaterial color="#6b4a22" metalness={0.8} roughness={0.35} />
          </mesh>
          {[-8.2, -3.7, 0.5, 4.7, 8.6].map((z) => (
            <mesh key={z} position={[z, H / 2, 0.06]}>
              <boxGeometry args={[0.3, H, 0.12]} />
              <meshStandardMaterial map={tex.wood} roughness={0.6} />
            </mesh>
          ))}
        </group>
      ))}
      {/* the screen wall: black velvet; the entrance wall: dark fabric */}
      <mesh position={[0, H / 2, -L / 2]}>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color="#070607" roughness={1} />
      </mesh>
      <mesh position={[0, H / 2, L / 2]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial map={tex.back} roughness={1} />
      </mesh>
      {/* the door we came in by, and its EXIT sign */}
      <group position={[DOOR.x, 0, L / 2 - 0.02]} rotation={[0, Math.PI, 0]}>
        {[-0.47, 0.47].map((x) => (
          <mesh key={x} position={[x, 1.25, 0]}>
            <boxGeometry args={[0.92, 2.5, 0.05]} />
            <meshStandardMaterial map={tex.wood} roughness={0.5} />
          </mesh>
        ))}
        {[-0.12, 0.12].map((x) => (
          <mesh key={x} position={[x, 1.15, 0.04]}>
            <boxGeometry args={[0.03, 0.4, 0.03]} />
            <meshStandardMaterial color="#c9a45c" metalness={1} roughness={0.25} />
          </mesh>
        ))}
        <mesh position={[0, 2.85, 0.02]}>
          <planeGeometry args={[0.6, 0.225]} />
          <meshStandardMaterial color="#000000" emissive="#ffffff" emissiveMap={tex.exit} emissiveIntensity={1.6} />
        </mesh>
      </group>
      {/* the stage */}
      <mesh position={[0, STAGE.h / 2, -L / 2 + STAGE.depth / 2]}>
        <boxGeometry args={[STAGE.w, STAGE.h, STAGE.depth]} />
        <meshStandardMaterial map={tex.stageWood} roughness={0.45} />
      </mesh>
      <mesh position={[0, STAGE.h - 0.02, -L / 2 + STAGE.depth + 0.005]}>
        <boxGeometry args={[STAGE.w, 0.04, 0.02]} />
        <meshStandardMaterial color="#6b4a22" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* sconces: brass back plates, glowing glass shades (they dim with the house lights) */}
      {sconces.map(([side, z]) => (
        <group key={`${side}${z}`} position={[side * (W / 2 - 0.08), 3.1, z]}>
          <mesh>
            <boxGeometry args={[0.04, 0.4, 0.16]} />
            <meshStandardMaterial color="#8a6a32" metalness={1} roughness={0.3} />
          </mesh>
          <mesh position={[-side * 0.1, 0.08, 0]}>
            <cylinderGeometry args={[0.1, 0.06, 0.22, 24, 1, true]} />
            <meshStandardMaterial ref={side === -1 && z === -5.8 ? sconceMat : undefined} color="#2a1c10" emissive="#ffb76b" emissiveIntensity={3} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      <SconceGlow runtime={runtime} sconces={sconces} />
      {/* aisle lights by every row's end, always on (low, amber) */}
      {Array.from({ length: ROWS.count }, (_, r) =>
        [-1, 1].map((side) => (
          <mesh key={`${r}${side}`} position={[side * (ROWS.aisle / 2 + 0.02), 0.1, rowZ(r) + 0.2]}>
            <boxGeometry args={[0.02, 0.03, 0.12]} />
            <meshStandardMaterial color="#000" emissive="#ffae4a" emissiveIntensity={4} />
          </mesh>
        ))
      )}
    </group>
  );
}

/** Every sconce's shade shares the first one's material through this (one material per shade, all driven). */
function SconceGlow({ runtime, sconces }: { runtime: RefObject<CinemaRuntime>; sconces: [number, number][] }) {
  const group = useRef<THREE.Group>(null);
  const tex = useMemo(() => glowTexture(), []);
  const mat = useMemo(() => {
    const m = new THREE.SpriteMaterial({ map: tex, color: "#ffcf96", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    return m;
  }, [tex]);
  useEffect(() => () => (tex.dispose(), mat.dispose()), [tex, mat]);
  useFrame(() => {
    const rt = runtime.current;
    if (rt) mat.opacity = 0.05 + 0.55 * rt.house;
  });
  return (
    <group ref={group}>
      {sconces.map(([side, z]) => (
        <sprite key={`${side}${z}`} material={mat} position={[side * (HALL.W / 2 - 0.2), 3.2, z]} scale={[0.9, 0.9, 1]} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------------- the seats

function Seats() {
  const seats = useMemo(() => seatCentres(), []);
  const parts = useMemo(() => {
    const cushion = new RoundedBoxGeometry(0.5, 0.11, 0.48, 3, 0.04);
    const back = new RoundedBoxGeometry(0.52, 0.62, 0.11, 3, 0.04);
    const shell = new RoundedBoxGeometry(0.54, 0.66, 0.04, 2, 0.015);
    const arm = new RoundedBoxGeometry(0.07, 0.05, 0.5, 2, 0.02);
    const standard = new THREE.BoxGeometry(0.05, 0.62, 0.5);
    const velvet = new THREE.MeshPhysicalMaterial({ color: "#6e0f18", roughness: 0.82, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color("#ff5a64") });
    const wood = new THREE.MeshStandardMaterial({ color: "#2b1a10", roughness: 0.5, metalness: 0.05 });
    const iron = new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.6, metalness: 0.5 });
    return { cushion, back, shell, arm, standard, velvet, wood, iron };
  }, []);
  // the arms and standards: one between every two seats and at each block's ends
  const arms = useMemo(() => {
    const out: [number, number][] = [];
    for (let r = 0; r < ROWS.count; r++) {
      for (const side of [-1, 1] as const) {
        const x0 = blockX(side) - (ROWS.perBlock * ROWS.seatW) / 2;
        for (let i = 0; i <= ROWS.perBlock; i++) out.push([x0 + i * ROWS.seatW, rowZ(r)]);
      }
    }
    return out;
  }, []);
  const refs = {
    cushion: useRef<THREE.InstancedMesh>(null),
    back: useRef<THREE.InstancedMesh>(null),
    shell: useRef<THREE.InstancedMesh>(null),
    arm: useRef<THREE.InstancedMesh>(null),
    standard: useRef<THREE.InstancedMesh>(null),
  };
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.16, 0, 0));
    const one = new THREE.Vector3(1, 1, 1);
    seats.forEach((s, i) => {
      refs.cushion.current?.setMatrixAt(i, m.makeTranslation(s.x, SEAT_H - 0.04, s.z - 0.04));
      refs.back.current?.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, SEAT_H + 0.33, s.z + 0.24), q, one));
      refs.shell.current?.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, SEAT_H + 0.31, s.z + 0.31), q, one));
    });
    arms.forEach(([x, z], i) => {
      refs.arm.current?.setMatrixAt(i, m.makeTranslation(x, SEAT_H + 0.2, z));
      refs.standard.current?.setMatrixAt(i, m.makeTranslation(x, 0.31, z + 0.02));
    });
    Object.values(refs).forEach((r) => r.current && (r.current.instanceMatrix.needsUpdate = true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats, arms]);
  return (
    <group>
      <instancedMesh ref={refs.cushion} args={[parts.cushion, parts.velvet, seats.length]} />
      <instancedMesh ref={refs.back} args={[parts.back, parts.velvet, seats.length]} />
      <instancedMesh ref={refs.shell} args={[parts.shell, parts.wood, seats.length]} />
      <instancedMesh ref={refs.arm} args={[parts.arm, parts.wood, arms.length]} />
      <instancedMesh ref={refs.standard} args={[parts.standard, parts.iron, arms.length]} />
    </group>
  );
}

// ------------------------------------------------------------------------------ the curtains, screen and masking

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

function Curtains() {
  const geo = useMemo(
    () => ({ side: velvetFolds(1.9, HALL.H - STAGE.h, 7, 0.09), valance: velvetFolds(HALL.W, 0.75, 26, 0.05) }),
    []
  );
  const mat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: "#5c0b13", roughness: 0.8, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color("#ff4652"), side: THREE.DoubleSide }),
    []
  );
  const z = -HALL.L / 2 + 0.45;
  return (
    <group>
      {[-1, 1].map((side) => (
        <mesh key={side} geometry={geo.side} material={mat} position={[side * (SCREEN.w / 2 + 1.0), STAGE.h + (HALL.H - STAGE.h) / 2, z]} />
      ))}
      <mesh geometry={geo.valance} material={mat} position={[0, HALL.H - 0.38, z + 0.1]} />
    </group>
  );
}

const MASK_W = 1.6;

function Screen({ runtime }: { runtime: RefObject<CinemaRuntime> }) {
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const rt = runtime.current;
    if (!rt) return;
    // the side masking frames the picture (a 4:3 film: it closes in), at a motor's pace
    const target = rt.deck.state.film ? rt.rect.w / 2 + MASK_W / 2 : SCREEN.w / 2 + MASK_W / 2;
    for (const [m, s] of [[left.current, -1], [right.current, 1]] as const) {
      if (!m) continue;
      const x = Math.abs(m.position.x);
      const nx = x + Math.max(-0.6 * dt, Math.min(0.6 * dt, target - x));
      m.position.x = s * nx;
    }
  });
  const z = SCREEN.z;
  return (
    <group>
      {/* the screen: a matt white surface a little larger than the largest picture */}
      <mesh position={[0, SCREEN_CY, z]}>
        <planeGeometry args={[SCREEN.w + 0.2, SCREEN.h + 0.2]} />
        <meshStandardMaterial color="#d8d5ce" roughness={0.92} metalness={0} />
      </mesh>
      {/* the masking: black velvet top and bottom, and the sides that move */}
      <mesh position={[0, SCREEN_CY + SCREEN.h / 2 + 0.25, z + 0.04]}>
        <boxGeometry args={[SCREEN.w + 2 * MASK_W, 0.5, 0.05]} />
        <meshStandardMaterial color="#050505" roughness={1} />
      </mesh>
      <mesh position={[0, SCREEN.bottom - 0.2, z + 0.04]}>
        <boxGeometry args={[SCREEN.w + 2 * MASK_W, 0.4, 0.05]} />
        <meshStandardMaterial color="#050505" roughness={1} />
      </mesh>
      <mesh ref={left} position={[-(SCREEN.w / 2 + MASK_W / 2), SCREEN_CY, z + 0.05]}>
        <boxGeometry args={[MASK_W, SCREEN.h + 0.2, 0.05]} />
        <meshStandardMaterial color="#050505" roughness={1} />
      </mesh>
      <mesh ref={right} position={[SCREEN.w / 2 + MASK_W / 2, SCREEN_CY, z + 0.05]}>
        <boxGeometry args={[MASK_W, SCREEN.h + 0.2, 0.05]} />
        <meshStandardMaterial color="#050505" roughness={1} />
      </mesh>
    </group>
  );
}

/** A projected film's picture: the frame on the screen, with the lamp's hot spot; before the first frame, the
 *  lamp's white (the leader). Added to the lit screen. */
function Picture({ runtime }: { runtime: RefObject<CinemaRuntime> }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () =>
      additive(
        new THREE.ShaderMaterial({
          uniforms: { uMap: { value: null }, uHasMap: { value: 0 }, uLevel: { value: 0 }, uGain: { value: 0.95 } },
          vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: /* glsl */ `
            uniform sampler2D uMap; uniform float uHasMap; uniform float uLevel; uniform float uGain;
            varying vec2 vUv;
            void main() {
              vec2 c = (vUv - 0.5) * vec2(1.0, 0.75);
              float hot = 1.0 - 0.55 * dot(c, c);   // brightest in the middle, as a lamp throws it
              vec3 pic = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : vec3(0.42, 0.41, 0.39);
              gl_FragColor = vec4(pic * hot * uLevel * uGain, 0.0);
              #include <colorspace_fragment>
              gl_FragColor.a = 0.0;
            }`,
        })
      ),
    []
  );
  useFrame(() => {
    const rt = runtime.current;
    const m = mesh.current;
    if (!rt || !m) return;
    const show = rt.textured && rt.level > 0.002;
    m.visible = show;
    if (!show) return;
    m.scale.set(rt.rect.w, rt.rect.h, 1);
    m.position.set(rt.rect.cx, rt.rect.cy, SCREEN.z + 0.006);
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
function Embed({ runtime, origin }: { runtime: RefObject<CinemaRuntime>; origin: string }) {
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
      position={[rt.rect.cx, rt.rect.cy, SCREEN.z + 0.012]}
      distanceFactor={(rt.rect.w * 400) / w}
      pointerEvents="none"
      // drei lifts the canvas to half the range's top and puts the player under it: both stay under the HUD (20+)
      zIndexRange={[16, 0]}
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

// ------------------------------------------------------------------------------------------------ the beam

function Beam({ runtime }: { runtime: RefObject<CinemaRuntime> }) {
  const mesh = useRef<THREE.Mesh>(null);
  const lastRect = useRef("");
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
            uLens: { value: new THREE.Vector3(...LENS) },
            uScreenZ: { value: SCREEN.z },
            uRect: { value: new THREE.Vector4() },
            uPlanes: { value: Array.from({ length: 5 }, () => new THREE.Vector4()) },
            uImage: { value: null },
            uTextured: { value: 0 },
            uColor: { value: new THREE.Color() },
            uLevel: { value: 0 },
            uTime: { value: 0 },
            uGain: { value: 0.95 },
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
              const int N = 24;
              float dt = (t1 - t0) / float(N);
              float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
              vec3 acc = vec3(0.0);
              for (int i = 0; i < N; i++) {
                vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt);
                vec2 uv = pictureUv(p);
                float edge = smoothstep(0.0, 0.025, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
                vec3 col = uTextured > 0.5 ? texture2D(uImage, uv).rgb : uColor;
                float d = distance(p, uLens);
                // haze: smoke drifting up and toward the screen, in slow curls
                vec3 drift = vec3(uTime * 0.013, uTime * 0.045, -uTime * 0.03);
                float haze = 0.18 + 0.82 * noise3(p * 1.6 + drift) * (0.55 + 0.45 * noise3(p * 0.42 - drift * 0.6));
                haze *= 0.7 + 0.3 * noise3(p * 5.0 + drift * 2.0);
                float fall = 1.0 / (0.6 + d * d);
                float nearScreen = smoothstep(0.0, 1.5, p.z - uScreenZ);
                acc += col * haze * fall * edge * nearScreen;
              }
              gl_FragColor = vec4(acc * dt * uLevel * uGain, 0.0);
              #include <colorspace_fragment>
              gl_FragColor.a = 0.0;
            }`,
        })
      ),
    []
  );
  useFrame(() => {
    const rt = runtime.current;
    const m = mesh.current;
    if (!rt || !m) return;
    m.visible = rt.level > 0.003;
    const { w, h, cx, cy } = rt.rect;
    const key = `${w.toFixed(3)}x${h.toFixed(3)}`;
    if (key !== lastRect.current) {
      lastRect.current = key;
      const z = SCREEN.z + 0.03;
      const lens = new THREE.Vector3(...LENS);
      const c = [
        new THREE.Vector3(cx - w / 2, cy - h / 2, z),
        new THREE.Vector3(cx + w / 2, cy - h / 2, z),
        new THREE.Vector3(cx + w / 2, cy + h / 2, z),
        new THREE.Vector3(cx - w / 2, cy + h / 2, z),
      ];
      const pos = geo.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, lens.x, lens.y, lens.z);
      c.forEach((v, i) => pos.setXYZ(i + 1, v.x, v.y, v.z));
      pos.needsUpdate = true;
      geo.computeBoundingSphere();
      // the four sides' planes (outward) and the screen's
      const centre = new THREE.Vector3(cx, cy, (z + lens.z) / 2);
      const planes = mat.uniforms.uPlanes.value as THREE.Vector4[];
      for (let i = 0; i < 4; i++) {
        const pl = new THREE.Plane().setFromCoplanarPoints(lens, c[i], c[(i + 1) % 4]);
        if (pl.distanceToPoint(centre) > 0) pl.negate();
        planes[i].set(pl.normal.x, pl.normal.y, pl.normal.z, -pl.constant);
      }
      planes[4].set(0, 0, -1, -z);
      (mat.uniforms.uRect.value as THREE.Vector4).set(cx, cy, w, h);
    }
    mat.uniforms.uImage.value = rt.deck.small;
    mat.uniforms.uTextured.value = rt.textured ? 1 : 0;
    // an embedded film, the leader: the lamp's light, its colour from the room's
    (mat.uniforms.uColor.value as THREE.Color).copy(rt.color).multiplyScalar(1.6).addScalar(0.12);
    mat.uniforms.uLevel.value = rt.level;
    mat.uniforms.uTime.value = rt.time;
  });
  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />;
}

// ------------------------------------------------------------------------------------------------ the dust

const DUST = 4200;

function Dust({ runtime }: { runtime: RefObject<CinemaRuntime> }) {
  const gl = useThree((s) => s.gl);
  const geo = useMemo(() => {
    const pos = new Float32Array(DUST * 3);
    const seed = new Float32Array(DUST);
    let s = 1;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const lens = new THREE.Vector3(...LENS);
    for (let i = 0; i < DUST; i++) {
      if (i < DUST * 0.75) {
        // along the beam (more where it is narrow), spread a little past its edges
        const t = Math.pow(r(), 0.8);
        const target = new THREE.Vector3((r() - 0.5) * SCREEN.w * 1.15, SCREEN_CY + (r() - 0.5) * SCREEN.h * 1.15, SCREEN.z);
        const p = lens.clone().lerp(target, 0.03 + t * 0.95);
        pos.set([p.x + (r() - 0.5) * 0.3, p.y + (r() - 0.5) * 0.3, p.z], i * 3);
      } else {
        pos.set([(r() - 0.5) * (HALL.W - 1), 0.6 + r() * (HALL.H - 1), (r() - 0.5) * (HALL.L - 1)], i * 3);
      }
      seed[i] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);
  const mat = useMemo(
    () =>
      additive(
        new THREE.ShaderMaterial({
          uniforms: {
            uLens: { value: new THREE.Vector3(...LENS) },
            uScreenZ: { value: SCREEN.z },
            uRect: { value: new THREE.Vector4() },
            uImage: { value: null },
            uTextured: { value: 0 },
            uColor: { value: new THREE.Color() },
            uLevel: { value: 0 },
            uHouse: { value: 1 },
            uTime: { value: 0 },
            uPx: { value: 30 },
          },
          vertexShader: /* glsl */ `
            ${PROJECT_GLSL}
            attribute float aSeed;
            uniform sampler2D uImage;
            uniform float uTextured;
            uniform vec3 uColor;
            uniform float uLevel;
            uniform float uHouse;
            uniform float uTime;
            uniform float uPx;
            varying vec3 vCol;
            void main() {
              vec3 p = position;
              float s = aSeed * 6.2831853;
              p += vec3(sin(uTime * 0.11 + s * 3.0) * 0.28, sin(uTime * 0.07 + s * 5.0) * 0.2, cos(uTime * 0.09 + s * 2.0) * 0.28);
              // a slow fall, round again from the top
              p.y = 0.6 + mod(p.y - 0.6 - uTime * 0.012 * (0.4 + aSeed), 5.0);
              vec2 uv = pictureUv(p);
              float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0)
                           * step(p.z, uLens.z - 0.05) * step(uScreenZ, p.z);
              vec3 col = uTextured > 0.5 ? texture2D(uImage, clamp(uv, 0.0, 1.0)).rgb : uColor;
              float d = distance(p, uLens);
              float twinkle = 0.55 + 0.45 * sin(uTime * (1.3 + aSeed * 2.7) + s * 9.0);
              vCol = col * inside * uLevel * twinkle * 4.0 / (0.5 + d * d * 0.18) + vec3(0.9, 0.78, 0.6) * uHouse * 0.012;
              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              gl_Position = projectionMatrix * mv;
              // fine specks: a mote by one's face stays a speck, not a blot
              gl_PointSize = min(uPx * 0.22, uPx * (0.35 + aSeed * aSeed * 0.6) / max(0.5, -mv.z));
            }`,
          fragmentShader: /* glsl */ `
            varying vec3 vCol;
            void main() {
              float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
              gl_FragColor = vec4(vCol * a, 0.0);
              #include <colorspace_fragment>
              gl_FragColor.a = 0.0;
            }`,
        })
      ),
    []
  );
  useFrame(() => {
    const rt = runtime.current;
    if (!rt) return;
    const u = mat.uniforms;
    (u.uRect.value as THREE.Vector4).set(rt.rect.cx, rt.rect.cy, rt.rect.w, rt.rect.h);
    u.uImage.value = rt.deck.small;
    u.uTextured.value = rt.textured ? 1 : 0;
    (u.uColor.value as THREE.Color).copy(rt.color).multiplyScalar(1.6).addScalar(0.12);
    u.uLevel.value = rt.level;
    u.uHouse.value = rt.house;
    u.uTime.value = rt.time;
    u.uPx.value = 26 * gl.getPixelRatio();
  });
  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={6} />;
}

/** The lens glares when one looks into the beam. */
function LensGlare({ runtime }: { runtime: RefObject<CinemaRuntime> }) {
  const camera = useThree((s) => s.camera);
  const sprite = useRef<THREE.Sprite>(null);
  const tex = useMemo(() => glowTexture(), []);
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), [tex]);
  useEffect(() => () => (tex.dispose(), mat.dispose()), [tex, mat]);
  const beamDir = useMemo(() => new THREE.Vector3(0, SCREEN_CY - LENS[1], SCREEN.z - LENS[2]).normalize(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const rt = runtime.current;
    const s = sprite.current;
    if (!rt || !s) return;
    v.copy(camera.position).sub(new THREE.Vector3(...LENS)).normalize();
    const facing = Math.max(0, v.dot(beamDir));
    const k = rt.level * (0.15 + 0.85 * Math.pow(facing, 6));
    mat.opacity = Math.min(1, k);
    mat.color.copy(rt.color).multiplyScalar(0.5).addScalar(0.6);
    const size = 0.25 + 1.6 * Math.pow(facing, 10) * rt.level;
    s.scale.set(size, size, 1);
    s.visible = rt.level > 0.01;
  });
  return <sprite ref={sprite} material={mat} position={[LENS[0], LENS[1], LENS[2] - 0.02]} renderOrder={7} />;
}

// ------------------------------------------------------------------------------------------------ the lights

function Lights({ runtime }: { runtime: RefObject<CinemaRuntime> }) {
  const bounce = useRef<THREE.RectAreaLight>(null);
  const spill = useRef<THREE.RectAreaLight>(null);
  const house = useRef<(THREE.PointLight | null)[]>([]);
  const ceiling = useRef<(THREE.RectAreaLight | null)[]>([]);
  useLayoutEffect(() => {
    // the screen shines back over the seats; a little of it falls on the stage
    bounce.current?.lookAt(0, 1.2, 2);
    spill.current?.lookAt(0, 0, -HALL.L / 2 + 0.5);
    ceiling.current.forEach((l) => l?.lookAt(l.position.x, 0, l.position.z));
  }, []);
  useFrame(() => {
    const rt = runtime.current;
    if (!rt) return;
    const film = rt.level * (0.15 + 1.4 * rt.lum);
    if (bounce.current) {
      bounce.current.color.copy(rt.color).multiplyScalar(1 / Math.max(0.05, rt.lum)).lerp(new THREE.Color(1, 1, 1), 0.25);
      bounce.current.intensity = 2.4 * film;
      bounce.current.width = rt.rect.w;
      bounce.current.height = rt.rect.h;
    }
    if (spill.current) {
      spill.current.color.copy(bounce.current?.color ?? rt.color);
      spill.current.intensity = 1.2 * film;
    }
    house.current.forEach((l) => l && (l.intensity = 9 * rt.house));
    ceiling.current.forEach((l) => l && (l.intensity = 1.6 * rt.house));
  });
  return (
    <group>
      <rectAreaLight ref={bounce} position={[0, SCREEN_CY, SCREEN.z + 0.15]} width={SCREEN.w} height={SCREEN.h} intensity={0} />
      <rectAreaLight ref={spill} position={[0, SCREEN.bottom - 0.1, SCREEN.z + 0.3]} width={SCREEN.w} height={0.6} intensity={0} />
      {[[-1, -3.6], [1, -3.6], [-1, 4.7], [1, 4.7]].map(([side, z], i) => (
        <pointLight key={i} ref={(l) => void (house.current[i] = l)} position={[side * (HALL.W / 2 - 0.45), 3.3, z]} color="#ffc58a" intensity={9} distance={0} decay={2} />
      ))}
      {[-3, 3.5].map((z, i) => (
        <rectAreaLight key={z} ref={(l) => void (ceiling.current[i] = l)} position={[0, HALL.H - 0.02, z]} width={3.5} height={3.5} color="#ffd9ad" intensity={1.6} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------------------------------------------ the click

/** With the pointer locked, a click on the screen (or the projector) starts or pauses the film. */
function ScreenClick({ onScreen, enabled }: { onScreen: () => void; enabled: boolean }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!enabled) return;
    const ray = new THREE.Raycaster();
    const screen = new THREE.Plane(new THREE.Vector3(0, 0, 1), -SCREEN.z);
    const hit = new THREE.Vector3();
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !document.pointerLockElement) return;
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      const near = ray.ray.distanceToPoint(new THREE.Vector3(PROJECTOR.x, BODY_MID, PROJECTOR.z)) < 0.6 && camera.position.distanceTo(new THREE.Vector3(PROJECTOR.x, BODY_MID, PROJECTOR.z)) < 4;
      const onWall = ray.ray.intersectPlane(screen, hit) && Math.abs(hit.x) < SCREEN.w / 2 + 0.3 && Math.abs(hit.y - SCREEN_CY) < SCREEN.h / 2 + 0.3;
      if (near || onWall) onScreen();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [camera, enabled, onScreen]);
  return null;
}
const BODY_MID = 2.1;

// ------------------------------------------------------------------------------------------------ the scene

export interface CinemaSceneProps {
  runtime: RefObject<CinemaRuntime>;
  layout: GalleryLayout;
  walkEnabled: boolean;
  entering: boolean;
  arrived: boolean;
  onArrived: () => void;
  touch: boolean;
  touchActive: boolean;
  onLockChange: (locked: boolean) => void;
  lockApi: RefObject<LockApi | null>;
  onScreen: () => void;
  onLeave: () => void;
  origin: string;
  /** The deck's state changed (an embed mounts or unmounts). */
  deckKey: string;
}

export function CinemaScene(props: CinemaSceneProps) {
  const { runtime, layout } = props;
  const registry = useMemo(() => new Map<string, THREE.Mesh>(), []);
  const noop = useMemo(() => () => {}, []);
  return (
    <>
      <Director runtime={runtime} onLeave={props.onLeave} armed={props.arrived} />
      <Hall runtime={runtime} />
      <Seats />
      <Curtains />
      <Screen runtime={runtime} />
      <Picture runtime={runtime} />
      <Embed key={props.deckKey} runtime={runtime} origin={props.origin} />
      <Projector runtime={runtime} />
      <Beam runtime={runtime} />
      <Dust runtime={runtime} />
      <LensGlare runtime={runtime} />
      <Lights runtime={runtime} />
      <ScreenClick onScreen={props.onScreen} enabled={props.walkEnabled && !props.touch} />
      {props.touch ? (
        <TouchPlayer layout={layout} registry={registry} walkEnabled={props.walkEnabled} active={props.touchActive} onSelect={noop} />
      ) : (
        <Player
          layout={layout}
          registry={registry}
          walkEnabled={props.walkEnabled}
          onSelect={noop}
          onAim={noop}
          onLockChange={props.onLockChange}
          lockApi={props.lockApi}
        />
      )}
      <EntryDolly entering={props.entering} layout={layout} onArrived={props.onArrived} />
    </>
  );
}
