"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshReflectorMaterial, PointerLockControls } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import gsap from "gsap";
import type { ArtistWithPaintings } from "@/lib/types";
import type { GalleryLayout, Placement } from "./layout";
import { inspectPose } from "./layout";
import { PaintingExhibit } from "./PaintingExhibit";
import { plankTextures, plasterTexture } from "./textures";

interface GalleryProps {
  artist: ArtistWithPaintings;
  layout: GalleryLayout;
  inspect: Placement | null;
  onSelect: (pl: Placement) => void;
  onAim: (aimed: boolean) => void;
  onLockChange: (locked: boolean) => void;
  walkEnabled: boolean;
  entering: boolean;
}

export function Gallery(props: GalleryProps) {
  const { artist, layout } = props;
  const meshRegistry = useRef(new Map<string, THREE.Mesh>());

  return (
    <>
      <EnvSetup />
      <Lighting layout={layout} focused={!!props.inspect} />
      <Room layout={layout} />
      {layout.placements.map((pl, i) => (
        <PaintingExhibit
          key={pl.painting.slug}
          placement={pl}
          artistName={artist.name}
          focusSlug={props.inspect?.painting.slug ?? null}
          registry={meshRegistry.current}
          // Each shadow map costs a texture unit in every shader (and the
          // rect-area light's LTC tables take two more); GPUs commonly cap
          // fragment samplers at 16, so only 6 spots get real shadows.
          castShadows={i < 6}
        />
      ))}
      <Player {...props} registry={meshRegistry.current} />
      <InspectCamera inspect={props.inspect} layout={layout} />
      <EntryDolly entering={props.entering} layout={layout} />
    </>
  );
}

// Walk the camera through the doorway while the entry doors swing open.
function EntryDolly({
  entering,
  layout,
}: {
  entering: boolean;
  layout: GalleryLayout;
}) {
  const { camera } = useThree();
  const done = useRef(false);
  useEffect(() => {
    if (!entering || done.current) return;
    done.current = true;
    gsap.to(camera.position, {
      z: layout.hallLength / 2 - 3.1,
      duration: 3.0,
      ease: "power2.inOut",
      delay: 0.45,
    });
  }, [entering, camera, layout]);
  return null;
}

// Procedural environment map — believable reflections without any HDR download.
function EnvSetup() {
  const { gl, scene } = useThree();
  useEffect(() => {
    RectAreaLightUniformsLib.init();
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.18;
    return () => {
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Lighting({
  layout,
  focused,
}: {
  layout: GalleryLayout;
  focused: boolean;
}) {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const area = useRef<THREE.RectAreaLight>(null);
  useFrame((_, dt) => {
    if (hemi.current)
      hemi.current.intensity = THREE.MathUtils.damp(
        hemi.current.intensity, focused ? 0.03 : 0.16, 4, dt);
    if (amb.current)
      amb.current.intensity = THREE.MathUtils.damp(
        amb.current.intensity, focused ? 0.015 : 0.055, 4, dt);
    if (area.current)
      area.current.intensity = THREE.MathUtils.damp(
        area.current.intensity, focused ? 0.12 : 1.5, 4, dt);
  });
  return (
    <>
      <hemisphereLight
        ref={hemi}
        args={["#f3e8d4", "#241c12", 0.16]}
        position={[0, layout.wallHeight, 0]}
      />
      <ambientLight ref={amb} intensity={0.055} color="#efe4cd" />
      {/* soft warm wash from the ceiling cove */}
      <rectAreaLight
        ref={area}
        args={["#f4e7ce", 1.5, layout.hallWidth - 2.4, layout.hallLength - 2.5]}
        position={[0, layout.wallHeight - 0.12, 0]}
        rotation-x={-Math.PI / 2}
      />
    </>
  );
}

// ------------------------------------------------------------------- Room

function FloorMesh({ W, L }: { W: number; L: number }) {
  const { map, roughnessMap } = useMemo(() => {
    const { map, roughnessMap } = plankTextures();
    const m = map.clone();
    const r = roughnessMap.clone();
    // ~0.2 m planks running the length of the hall
    m.repeat.set(W / 1.4, L / 2.9);
    r.repeat.set(W / 1.4, L / 2.9);
    m.needsUpdate = true;
    r.needsUpdate = true;
    return { map: m, roughnessMap: r };
  }, [W, L]);
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[W, L]} />
      <MeshReflectorMaterial
        blur={[400, 130]}
        resolution={1024}
        mixBlur={1}
        mixStrength={0.38}
        roughness={0.85}
        depthScale={1.1}
        minDepthThreshold={0.4}
        maxDepthThreshold={1.4}
        map={map}
        roughnessMap={roughnessMap}
        color="#9a8568"
        metalness={0}
      />
    </mesh>
  );
}

function Room({ layout }: { layout: GalleryLayout }) {
  const { hallWidth: W, hallLength: L, wallHeight: H } = layout;

  const wallMat = useMemo(() => {
    const map = plasterTexture().clone();
    map.repeat.set(Math.round(L / 3), 2);
    map.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      color: "#e6decb",
      map,
      roughness: 0.93,
      metalness: 0,
    });
  }, [L]);
  const darkWood = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#3a2c1e",
        roughness: 0.55,
        metalness: 0.08,
      }),
    []
  );
  const ceilMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ color: "#efe8d8", roughness: 0.95 }),
    []
  );
  const benchLeather = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#4a3526",
        roughness: 0.42,
        clearcoat: 0.35,
        clearcoatRoughness: 0.3,
      }),
    []
  );

  // coffered ceiling beams
  const beams = useMemo(() => {
    const items: { pos: [number, number, number]; size: [number, number, number] }[] = [];
    const step = 3.6;
    for (let z = -L / 2 + step; z < L / 2; z += step) {
      items.push({ pos: [0, H - 0.14, z], size: [W, 0.28, 0.3] });
    }
    items.push({ pos: [-W / 4, H - 0.14, 0], size: [0.3, 0.28, L] });
    items.push({ pos: [W / 4, H - 0.14, 0], size: [0.3, 0.28, L] });
    return items;
  }, [W, L, H]);

  const benches = useMemo(() => {
    const out: number[] = [];
    const count = Math.max(1, Math.floor(L / 9));
    for (let i = 0; i < count; i++) {
      out.push(-L / 2 + (i + 0.5) * (L / count) + 1);
    }
    return out;
  }, [L]);

  return (
    <group>
      {/* reflective plank floor */}
      <FloorMesh W={W} L={L} />

      {/* walls */}
      <mesh position={[-W / 2 - 0.1, H / 2, 0]} material={wallMat} receiveShadow castShadow>
        <boxGeometry args={[0.2, H, L]} />
      </mesh>
      <mesh position={[W / 2 + 0.1, H / 2, 0]} material={wallMat} receiveShadow castShadow>
        <boxGeometry args={[0.2, H, L]} />
      </mesh>
      <mesh position={[0, H / 2, -L / 2 - 0.1]} material={wallMat} receiveShadow castShadow>
        <boxGeometry args={[W + 0.4, H, 0.2]} />
      </mesh>
      <mesh position={[0, H / 2, L / 2 + 0.1]} material={wallMat} receiveShadow castShadow>
        <boxGeometry args={[W + 0.4, H, 0.2]} />
      </mesh>

      {/* entry doorway silhouette on the near wall */}
      <mesh position={[0, 1.45, L / 2 - 0.005]} material={darkWood}>
        <boxGeometry args={[2.6, 2.9, 0.08]} />
      </mesh>

      {/* baseboards & picture rail */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * (W / 2 - 0.04), 0.09, 0]} material={darkWood}>
            <boxGeometry args={[0.08, 0.18, L]} />
          </mesh>
          <mesh position={[s * (W / 2 - 0.025), H - 0.55, 0]} material={darkWood}>
            <boxGeometry args={[0.05, 0.07, L]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.09, -L / 2 + 0.04]} material={darkWood}>
        <boxGeometry args={[W, 0.18, 0.08]} />
      </mesh>

      {/* ceiling + coffers */}
      <mesh rotation-x={Math.PI / 2} position={[0, H, 0]} material={ceilMat}>
        <planeGeometry args={[W + 0.4, L + 0.4]} />
      </mesh>
      {beams.map((b, i) => (
        <mesh key={i} position={b.pos} material={ceilMat}>
          <boxGeometry args={b.size} />
        </mesh>
      ))}

      {/* glowing cove strips where the ceiling meets the walls */}
      {[-1, 1].map((s) => (
        <mesh key={`cove${s}`} position={[s * (W / 2 - 0.3), H - 0.18, 0]}>
          <boxGeometry args={[0.05, 0.04, L - 0.6]} />
          <meshStandardMaterial
            color="#2a241c"
            emissive="#ffdfb0"
            emissiveIntensity={2.6}
          />
        </mesh>
      ))}

      {/* lighting track rails */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * (W / 2 - 2.0), H - 0.32, 0]}
          rotation-x={Math.PI / 2}
        >
          <cylinderGeometry args={[0.035, 0.035, L - 1, 10]} />
          <meshStandardMaterial color="#1c1812" roughness={0.4} metalness={0.6} />
        </mesh>
      ))}

      {/* benches */}
      {benches.map((z) => (
        <group key={z} position={[0, 0, z]}>
          <mesh position={[0, 0.46, 0]} material={benchLeather} castShadow receiveShadow>
            <boxGeometry args={[0.62, 0.14, 1.9]} />
          </mesh>
          {[-0.75, 0.75].map((dz) => (
            <mesh key={dz} position={[0, 0.2, dz]} material={darkWood} castShadow>
              <boxGeometry args={[0.5, 0.4, 0.12]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------ Player

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

function Player({
  layout,
  onSelect,
  onAim,
  onLockChange,
  walkEnabled,
  registry,
}: GalleryProps & { registry: Map<string, THREE.Mesh> }) {
  const { camera } = useThree();
  const controls = useRef<any>(null);
  const pressed = useRef(new Set<string>());
  const vel = useRef(new THREE.Vector3());
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const aimedRef = useRef(false);
  const frame = useRef(0);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (KEYS[e.code]) pressed.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => pressed.current.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Click while locked = inspect what the crosshair is over.
  useEffect(() => {
    const onClick = () => {
      if (!controls.current?.isLocked || !walkEnabled) return;
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      const meshes = [...registry.values()];
      const hits = ray.intersectObjects(meshes, false);
      if (hits[0] && hits[0].distance < 9) {
        const slug = hits[0].object.userData.slug as string;
        const pl = (hits[0].object.userData.placement ?? null) as Placement | null;
        if (pl) {
          controls.current.unlock();
          onSelect(pl);
        }
      }
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [camera, onSelect, ray, registry, walkEnabled]);

  useFrame((_, dt) => {
    if (!controls.current?.isLocked) return;
    // movement
    const dir = new THREE.Vector3();
    let mx = 0;
    let mz = 0;
    pressed.current.forEach((code) => {
      const k = KEYS[code];
      if (k) {
        mx += k[0];
        mz += k[1];
      }
    });
    const speed = 3.1;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const rightv = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    dir.addScaledVector(forward, -mz).addScaledVector(rightv, mx);
    if (dir.lengthSq() > 0) dir.normalize();
    vel.current.lerp(dir.multiplyScalar(speed), 1 - Math.exp(-10 * dt));
    camera.position.addScaledVector(vel.current, dt);
    // confine to the hall
    const m = 0.55;
    camera.position.x = THREE.MathUtils.clamp(
      camera.position.x,
      -layout.hallWidth / 2 + m,
      layout.hallWidth / 2 - m
    );
    camera.position.z = THREE.MathUtils.clamp(
      camera.position.z,
      -layout.hallLength / 2 + m,
      layout.hallLength / 2 - m
    );
    camera.position.y = 1.65;

    // crosshair aim check (every 6th frame)
    if (frame.current++ % 6 === 0) {
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hits = ray.intersectObjects([...registry.values()], false);
      const aimed = !!hits[0] && hits[0].distance < 9;
      if (aimed !== aimedRef.current) {
        aimedRef.current = aimed;
        onAim(aimed);
      }
    }
  });

  return (
    <PointerLockControls
      ref={controls}
      enabled={walkEnabled}
      onLock={() => onLockChange(true)}
      onUnlock={() => onLockChange(false)}
    />
  );
}

// ---------------------------------------------------------- InspectCamera

function InspectCamera({
  inspect,
  layout,
}: {
  inspect: Placement | null;
  layout: GalleryLayout;
}) {
  const { camera, size } = useThree();
  const saved = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion } | null>(null);
  const zoomBase = useRef(0);
  const tweenObj = useRef({ p: 0 });

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (inspect) {
      saved.current = {
        pos: camera.position.clone(),
        quat: camera.quaternion.clone(),
      };
      const pose = inspectPose(inspect, cam.fov, size.width / size.height);
      const startPos = camera.position.clone();
      const startQuat = camera.quaternion.clone();
      const endPos = new THREE.Vector3(...pose.position);
      const probe = camera.clone();
      probe.position.copy(endPos);
      probe.lookAt(new THREE.Vector3(...pose.lookAt));
      const endQuat = probe.quaternion.clone();
      zoomBase.current = endPos.distanceTo(new THREE.Vector3(...pose.lookAt));
      tweenObj.current.p = 0;
      gsap.to(tweenObj.current, {
        p: 1,
        duration: 1.35,
        ease: "power3.inOut",
        onUpdate: () => {
          const p = tweenObj.current.p;
          camera.position.lerpVectors(startPos, endPos, p);
          camera.quaternion.slerpQuaternions(startQuat, endQuat, p);
        },
      });

      // scroll = dolly into the brushwork
      const target = new THREE.Vector3(...pose.lookAt);
      const onWheel = (e: WheelEvent) => {
        const dir = camera.position.clone().sub(target);
        const dist = dir.length();
        const next = THREE.MathUtils.clamp(
          dist * Math.exp(e.deltaY * 0.001),
          zoomBase.current * 0.28,
          zoomBase.current * 1.15
        );
        camera.position.copy(target).addScaledVector(dir.normalize(), next);
      };
      window.addEventListener("wheel", onWheel, { passive: true });
      return () => window.removeEventListener("wheel", onWheel);
    } else if (saved.current) {
      const s = saved.current;
      const startPos = camera.position.clone();
      const startQuat = camera.quaternion.clone();
      tweenObj.current.p = 0;
      gsap.to(tweenObj.current, {
        p: 1,
        duration: 1.1,
        ease: "power3.inOut",
        onUpdate: () => {
          const p = tweenObj.current.p;
          camera.position.lerpVectors(startPos, s.pos, p);
          camera.quaternion.slerpQuaternions(startQuat, s.quat, p);
        },
      });
      saved.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspect]);

  return null;
}
