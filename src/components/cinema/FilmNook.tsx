"use client";

// The films about the artist (archive/films.py, artist.films), in a corner of the gallery itself (layout.ts
// FilmNook): behind a free-standing wall of the room's works, two rows of the room style's chairs (the hall's own
// furniture) face a plain screen on the room's near wall, the projector on its stand behind them, its beam over
// their heads to the screen. The room's light reaches in dimly (room-shading's roomNook) and the picture lights
// the corner in its own colours; while a film runs the corner grows darker.
//
// - the picture: a projected film is a video texture on the screen, an embedded one (YouTube, Vimeo,
//   Dailymotion) the provider's player behind a hole in the canvas exactly where the picture falls (drei Html,
//   blending occlusion);
// - the beam: the pyramid of light from the lens to the picture, ray-marched through a faint haze in a shader,
//   coloured by the picture itself (a tiny copy of the frame);
// - no lights of their own (the gallery's number of lights never changes): the corner's light is the room
//   materials' shared uniforms (roomCross), which the director sets each frame.
//
// The screen faces −z (the corner opens toward the room's far end): everything here is built as if it faced
// +z, in a group turned half round about the screen's centre, so a point's local (x, z) is (2·cx − x, 2·sz − z)
// in the gallery.

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { inNook, outerHalf, type FilmNook as Nook, type GalleryLayout } from "@/components/museum/layout";
import { NOOK_LIGHT, patchRoomMaterial, roomCross } from "@/components/museum/room-shading";
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

type Rt = RefObject<CinemaRuntime | null>;

/** The corner in its group's frame (facing +z): the screen where it is, the projector mirrored through it. */
interface Local {
  screen: Nook["screen"];
  projector: { x: number; z: number; lens: [number, number, number] };
  /** The gallery's (x, z) → the group's. */
  toLocal: (v: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3;
}

function localOf(nook: Nook): Local {
  const { cx, z: sz } = nook.screen;
  const p = nook.projector;
  return {
    screen: nook.screen,
    projector: { x: 2 * cx - p.x, z: 2 * sz - p.z, lens: [2 * cx - p.lens[0], p.lens[1], 2 * sz - p.lens[2]] },
    toLocal: (v, out) => out.set(2 * cx - v.x, v.y, 2 * sz - v.z),
  };
}

const centreY = (n: Local) => n.screen.bottom + n.screen.h / 2;

// ------------------------------------------------------------------------------------------------ the director

/** Each frame while one is in the corner (or a film runs): the light from the deck, the volume from where one
 *  stands, the corner's light. The gallery renders on demand: this keeps frames coming while there is something
 *  to see move. Whoever walks out of the corner (or is taken elsewhere) leaves the film paused. */
function Director({ layout, nook, runtime, onInside }: { layout: GalleryLayout; nook: Nook; runtime: Rt; onInside: (inside: boolean) => void }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const said = useRef<boolean | null>(null);
  const cw = useMemo(() => roomCross(layout), [layout]);
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const rt = runtime.current;
      const p = camera.position;
      // in a step past its open end (and out again a step back: no flicker on the line)
      const inside = inNook(layout, p.x, p.z, said.current ? 0.1 : 0.6);
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
  // leaving the gallery: the corner's light back as it was
  useEffect(
    () => () => {
      cw.nookK.x = NOOK_LIGHT[0];
      cw.nookK.y = NOOK_LIGHT[1];
      cw.nookGlow.setRGB(0, 0, 0);
    },
    [cw]
  );
  useFrame((_, dt) => {
    const rt = runtime.current;
    if (!rt) return;
    stepRuntime(rt, Math.min(dt, 1 / 20), performance.now());
    const s = nook.screen;
    const d = Math.hypot(camera.position.x - s.cx, camera.position.y - (s.bottom + s.h / 2), camera.position.z - s.z);
    rt.deck.setVolume(Math.max(0.45, Math.min(1, 1.15 - d / 16)));
    // the room's light in the corner dims as the film starts (the house lights), and the picture lights it
    cw.nookK.x = NOOK_LIGHT[0] * (0.3 + 0.7 * rt.house);
    cw.nookK.y = NOOK_LIGHT[1] * (0.45 + 0.55 * rt.house);
    cw.nookGlow.copy(rt.color).multiplyScalar(1.2 * rt.level);
  });
  return null;
}

// ------------------------------------------------------------------------------------------------- the screen

/** A plain projection screen on the near wall: a matt white board in a narrow black border. */
function ScreenBoard({ local }: { local: Local }) {
  const { w, h, z, cx } = local.screen;
  const cy = centreY(local);
  const mats = useMemo(
    () => ({
      white: new THREE.MeshStandardMaterial({ color: "#e4e2dc", roughness: 0.95, metalness: 0 }),
      black: new THREE.MeshStandardMaterial({ color: "#0b0b0c", roughness: 0.9, metalness: 0 }),
    }),
    []
  );
  useEffect(() => () => (mats.white.dispose(), mats.black.dispose()), [mats]);
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
 *  lamp's white (the leader). Added to the screen, whose own light (the room's, reaching in) it takes down as the
 *  house lights go down: a projected black is the screen in the dark. */
function Picture({ runtime, local }: { runtime: Rt; local: Local }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => {
    const m = additive(
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: null }, uHasMap: { value: 0 }, uLevel: { value: 0 }, uGain: { value: 0.92 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap; uniform float uHasMap; uniform float uLevel; uniform float uGain;
          varying vec2 vUv;
          void main() {
            vec2 c = (vUv - 0.5) * vec2(1.0, 0.75);
            float hot = 1.0 - 0.35 * dot(c, c);   // a little brighter in the middle, as a lamp throws it
            // a video texture comes undecoded (three decodes it in its own materials' shaders): to linear here
            vec3 pic = uHasMap > 0.5 ? sRGBTransferEOTF(texture2D(uMap, vUv)).rgb : vec3(0.42, 0.41, 0.39);
            gl_FragColor = vec4(pic * hot * uLevel * uGain, 0.0);
            #include <colorspace_fragment>
            // how much of the screen's own light goes (blended as 1 - alpha; the canvas's alpha is left alone)
            gl_FragColor.a = 0.85 * uLevel;
          }`,
      })
    );
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    return m;
  }, []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    const rt = runtime.current;
    const m = mesh.current;
    if (!rt || !m) return;
    const show = rt.textured && rt.level > 0.002;
    m.visible = show;
    if (!show) return;
    m.scale.set(rt.rect.w, rt.rect.h, 1);
    m.position.set(rt.rect.cx, rt.rect.cy, local.screen.z + 0.006);
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
function Embed({ runtime, local, origin, inside }: { runtime: Rt; local: Local; origin: string; inside: boolean }) {
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
      position={[rt.rect.cx, rt.rect.cy, local.screen.z + 0.012]}
      distanceFactor={(rt.rect.w * 400) / w}
      pointerEvents="none"
      // drei lifts the canvas to half the range's top and puts the player under it: both stay under the HUD
      zIndexRange={[16, 0]}
      // out in the room the player stays loaded (and paused), out of sight
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
 *  colours; brightest by the lens. Ray-marched in the group's frame (the eye brought into it). */
function Beam({ runtime, local }: { runtime: Rt; local: Local }) {
  const camera = useThree((s) => s.camera);
  const mesh = useRef<THREE.Mesh>(null);
  const lastRect = useRef({ w: 0, h: 0 });
  const lens = local.projector.lens;
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
            uScreenZ: { value: local.screen.z },
            uRect: { value: new THREE.Vector4() },
            uPlanes: { value: Array.from({ length: 5 }, () => new THREE.Vector4()) },
            uEye: { value: new THREE.Vector3() },
            uImage: { value: null },
            uTextured: { value: 0 },
            uColor: { value: new THREE.Color() },
            uLevel: { value: 0 },
            uTime: { value: 0 },
            uGain: { value: 0.5 },
          },
          vertexShader: /* glsl */ `
            varying vec3 vLocal;
            void main() {
              vLocal = position;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
          fragmentShader: /* glsl */ `
            ${PROJECT_GLSL}
            ${NOISE_GLSL}
            uniform vec4 uPlanes[5];
            uniform vec3 uEye;
            uniform sampler2D uImage;
            uniform float uTextured;
            uniform vec3 uColor;
            uniform float uLevel;
            uniform float uTime;
            uniform float uGain;
            varying vec3 vLocal;
            void main() {
              vec3 ro = uEye;
              vec3 rd = normalize(vLocal - ro);
              float t0 = 0.0;
              float t1 = length(vLocal - ro);
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
                // not right before one's eyes: looking along the beam, its haze would veil the picture
                float seen = smoothstep(0.4, 2.0, distance(p, ro));
                // dust throws light on forward: bright looking toward the lens, faint looking down the beam at the
                // picture
                float toward = 0.5 - 0.5 * dot(rd, normalize(p - uLens));
                acc += col * haze * fall * edge * nearScreen * seen * (0.12 + 0.88 * toward);
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
    local.toLocal(camera.position, mat.uniforms.uEye.value as THREE.Vector3);
    const { w, h, cx, cy } = rt.rect;
    const seen = lastRect.current;
    if (Math.abs(w - seen.w) > 5e-4 || Math.abs(h - seen.h) > 5e-4) {
      seen.w = w;
      seen.h = h;
      const z = local.screen.z + 0.03;
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
    // an embedded film, the leader: the lamp's light, its colour from the picture's
    (mat.uniforms.uColor.value as THREE.Color).copy(rt.color).multiplyScalar(1.5).addScalar(0.1);
    mat.uniforms.uLevel.value = rt.level;
    mat.uniforms.uTime.value = rt.time;
  });
  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />;
}

/** The lens glows when one looks into the beam. */
function LensGlow({ runtime, local }: { runtime: Rt; local: Local }) {
  const camera = useThree((s) => s.camera);
  const sprite = useRef<THREE.Sprite>(null);
  const tex = useMemo(() => glowTexture(), []);
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), [tex]);
  useEffect(() => () => (tex.dispose(), mat.dispose()), [tex, mat]);
  const lens = local.projector.lens;
  const beamDir = useMemo(
    () => new THREE.Vector3(local.screen.cx - lens[0], centreY(local) - lens[1], local.screen.z - lens[2]).normalize(),
    [local, lens]
  );
  const v = useMemo(() => new THREE.Vector3(), []);
  const at = useMemo(() => new THREE.Vector3(...lens), [lens]);
  useFrame(() => {
    const rt = runtime.current;
    const s = sprite.current;
    if (!rt || !s) return;
    local.toLocal(camera.position, v).sub(at).normalize();
    const facing = Math.max(0, v.dot(beamDir));
    mat.opacity = Math.min(1, rt.level * (0.1 + 0.7 * Math.pow(facing, 6)));
    mat.color.copy(rt.color).multiplyScalar(0.5).addScalar(0.6);
    const size = 0.16 + 0.9 * Math.pow(facing, 10) * rt.level;
    s.scale.set(size, size, 1);
    s.visible = rt.level > 0.01;
  });
  return <sprite ref={sprite} material={mat} position={[lens[0], lens[1], lens[2] - 0.02]} renderOrder={7} />;
}

// ----------------------------------------------------------------------------------------- the corner, whole

/** With the cursor captured, a click on the screen (or the projector) starts or pauses the film. */
function ScreenClick({ layout, nook, onScreen }: { layout: GalleryLayout; nook: Nook; onScreen: () => void }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const ray = new THREE.Raycaster();
    const s = nook.screen;
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -s.z);
    const hit = new THREE.Vector3();
    const body = new THREE.Vector3(nook.projector.x, nook.projector.lens[1], nook.projector.z);
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !document.pointerLockElement || !inNook(layout, camera.position.x, camera.position.z)) return;
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      const near = ray.ray.distanceToPoint(body) < 0.55 && camera.position.distanceTo(body) < 3.5;
      const onWall =
        ray.ray.intersectPlane(plane, hit) &&
        Math.abs(hit.x - s.cx) < s.w / 2 + 0.25 &&
        Math.abs(hit.y - (s.bottom + s.h / 2)) < s.h / 2 + 0.25;
      if (near || onWall) onScreen();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [camera, layout, nook, onScreen]);
  return null;
}

export interface FilmNookProps {
  layout: GalleryLayout;
  runtime: Rt;
  origin: string;
  /** The deck's state changed (an embed mounts or unmounts). */
  deckKey: string;
  /** The visitor is in the corner (onInside's last word). */
  inside: boolean;
  /** The visitor came into the corner, or left it. */
  onInside: (inside: boolean) => void;
  /** A click on the screen or the projector. */
  onScreen: () => void;
}

export function FilmNook({ layout, runtime, origin, deckKey, inside, onInside, onScreen }: FilmNookProps) {
  const nook = layout.nook!;
  const local = useMemo(() => localOf(nook), [nook]);
  const group = useRef<THREE.Group>(null);
  // the screen and the projector take the corner's light, as the room's own surfaces do
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    const roomHalf = new THREE.Vector3(outerHalf(layout), layout.wallHeight, layout.hallLength / 2);
    const cross = roomCross(layout);
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!m || !(m instanceof THREE.MeshStandardMaterial) || m.userData.roomUniforms) return;
      patchRoomMaterial(m, { key: "film-nook", roomHalf, cross, ao: [0, 0.3, 0] });
    });
  }, [layout]);
  const { cx, z: sz } = nook.screen;
  // the projector's cable runs along the floor to the room's left wall (its local +x)
  const cable = nook.projector.x - nook.x0 - 0.05;
  return (
    <group>
      <Director layout={layout} nook={nook} runtime={runtime} onInside={onInside} />
      <ScreenClick layout={layout} nook={nook} onScreen={onScreen} />
      <group ref={group} position={[2 * cx, 0, 2 * sz]} rotation={[0, Math.PI, 0]}>
        <ScreenBoard local={local} />
        <Picture runtime={runtime} local={local} />
        {runtime.current && <Embed key={deckKey} runtime={runtime} local={local} origin={origin} inside={inside} />}
        {runtime.current && (
          <Projector runtime={runtime as RefObject<CinemaRuntime>} x={local.projector.x} z={local.projector.z} lens={local.projector.lens} cable={cable} />
        )}
        <Beam runtime={runtime} local={local} />
        <LensGlow runtime={runtime} local={local} />
      </group>
    </group>
  );
}
