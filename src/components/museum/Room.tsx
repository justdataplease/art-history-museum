"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshReflectorMaterial } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import type { GalleryLayout } from "./layout";
import type { GalleryTheme } from "./theme";
import { plankTextures, plasterTexture } from "./textures";

// The architecture of the hall: environment, ambient/ceiling light, floor,
// walls, trim, ceiling, track rails and benches.

// Procedural environment map — believable reflections without any HDR download.
export function EnvSetup(_props: {
  layout: GalleryLayout;
  theme: GalleryTheme;
  /** True once every painting texture has settled (a reflection probe may be captured then). */
  ready: boolean;
}) {
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

export function Lighting({
  layout,
  focused,
}: {
  layout: GalleryLayout;
  theme: GalleryTheme;
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

export function Room({ layout }: { layout: GalleryLayout; theme: GalleryTheme }) {
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

  const benches = layout.benches.map((b) => b.position[1]);

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

