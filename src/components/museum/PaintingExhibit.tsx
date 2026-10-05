"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { wikiThumb } from "@/lib/img";
import { WALL_GAP, type Placement } from "./layout";
import { placardTexture } from "./textures";
import type { GalleryTheme } from "./theme";

const FRAME_DEPTH = 0.085;
const FRAME_BORDER = 0.085;
const MATTE = 0.012;

const goldMat = new THREE.MeshPhysicalMaterial({
  color: "#8f6f33",
  metalness: 0.82,
  roughness: 0.34,
  clearcoat: 0.65,
  clearcoatRoughness: 0.22,
  envMapIntensity: 1.4,
});
const goldInnerMat = new THREE.MeshPhysicalMaterial({
  color: "#b9954e",
  metalness: 0.85,
  roughness: 0.25,
  clearcoat: 0.8,
  clearcoatRoughness: 0.15,
  envMapIntensity: 1.7,
});
const backingMat = new THREE.MeshStandardMaterial({ color: "#241c12", roughness: 0.8 });
const placardEdgeMat = new THREE.MeshStandardMaterial({ color: "#d9d0ba", roughness: 0.8 });

export function PaintingExhibit({
  placement,
  artistName,
  focusSlug,
  registry,
  castShadows,
}: {
  placement: Placement;
  artistName: string;
  focusSlug: string | null;
  registry: Map<string, THREE.Mesh>;
  theme: GalleryTheme;
  castShadows?: boolean;
}) {
  const { painting, w, h } = placement;
  const spot = useRef<THREE.SpotLight>(null);
  const spotTarget = useMemo(() => new THREE.Object3D(), []);
  const isFocused = focusSlug === painting.slug;
  const somethingFocused = focusSlug !== null;

  // Spotlight breathes down when another painting takes the stage.
  useFrame((_, dt) => {
    if (!spot.current) return;
    const target = somethingFocused ? (isFocused ? 118 : 4) : 76;
    spot.current.intensity = THREE.MathUtils.damp(
      spot.current.intensity,
      target,
      3.5,
      dt
    );
  });

  // Light fixture hangs from the track, aimed down at the canvas.
  const fixture = useMemo(() => {
    const nx = Math.sin(placement.rotationY);
    const nz = Math.cos(placement.rotationY);
    const pos = new THREE.Vector3(
      placement.position[0] + nx * 2.05,
      4.2,
      placement.position[2] + nz * 2.05,
    );
    const throwDist = pos.distanceTo(new THREE.Vector3(...placement.position));
    return { pos, throwDist };
  }, [placement]);

  return (
    <group>
      <group position={placement.position} rotation-y={placement.rotationY}>
        {/* frame */}
        <FrameBox w={w} h={h} />
        {/* canvas */}
        <Suspense fallback={<CanvasFallback w={w} h={h} />}>
          <CanvasPlane
            placement={placement}
            isFocused={isFocused}
            registry={registry}
          />
        </Suspense>
        {/* wall label */}
        <Placard
          artistName={artistName}
          title={painting.title}
          year={painting.year}
          x={w / 2 + 0.34}
          y={-Math.max(h / 2 - 0.28, 0.22)}
          z={0.007 - WALL_GAP}
        />
      </group>

      {/* spotlight from the ceiling track */}
      <primitive object={spotTarget} position={placement.position} />
      <spotLight
        ref={spot}
        position={fixture.pos.toArray()}
        target={spotTarget}
        angle={Math.atan2(Math.max(w, h) * 0.62, fixture.throwDist)}
        penumbra={0.5}
        decay={1.1}
        distance={14}
        intensity={76}
        color="#ffdcab"
        castShadow={castShadows}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-radius={4}
      />
      {/* visible fixture head */}
      <group position={fixture.pos.toArray()}>
        <mesh
          rotation-x={Math.PI / 3.2}
          rotation-y={placement.rotationY}
        >
          <cylinderGeometry args={[0.05, 0.07, 0.22, 12]} />
          <meshStandardMaterial color="#15110c" roughness={0.4} metalness={0.7} />
        </mesh>
      </group>
    </group>
  );
}

// A physical wall label: ivory card, artist in small caps over a gold rule,
// title in italic serif, year — rendered to a CanvasTexture for crisp type.
function Placard({
  artistName,
  title,
  year,
  x,
  y,
  z,
}: {
  artistName: string;
  title: string;
  year: number | null;
  x: number;
  y: number;
  z: number;
}) {
  const tex = useMemo(
    () => placardTexture(artistName, title, year),
    [artistName, title, year]
  );
  useEffect(() => () => tex.dispose(), [tex]);
  const W = 0.40;
  const H = W * (416 / 768);
  return (
    <group position={[x, y, z]}>
      {/* card body gives the label real thickness and an edge shadow */}
      <mesh material={placardEdgeMat} castShadow>
        <boxGeometry args={[W, H, 0.012]} />
      </mesh>
      <mesh position={[0, 0, 0.0065]}>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial map={tex} roughness={0.85} />
      </mesh>
    </group>
  );
}

function FrameBox({ w, h }: { w: number; h: number }) {
  const W = w + FRAME_BORDER * 2;
  const H = h + FRAME_BORDER * 2;
  return (
    <group>
      {/* backing board */}
      <mesh position={[0, 0, -0.012]} material={backingMat} castShadow>
        <boxGeometry args={[W, H, 0.024]} />
      </mesh>
      {/* outer frame rails */}
      <mesh position={[0, H / 2 - FRAME_BORDER / 2, FRAME_DEPTH / 2 - 0.012]} material={goldMat} castShadow>
        <boxGeometry args={[W, FRAME_BORDER, FRAME_DEPTH]} />
      </mesh>
      <mesh position={[0, -(H / 2 - FRAME_BORDER / 2), FRAME_DEPTH / 2 - 0.012]} material={goldMat} castShadow>
        <boxGeometry args={[W, FRAME_BORDER, FRAME_DEPTH]} />
      </mesh>
      <mesh position={[-(W / 2 - FRAME_BORDER / 2), 0, FRAME_DEPTH / 2 - 0.012]} material={goldMat} castShadow>
        <boxGeometry args={[FRAME_BORDER, H - FRAME_BORDER * 2, FRAME_DEPTH]} />
      </mesh>
      <mesh position={[W / 2 - FRAME_BORDER / 2, 0, FRAME_DEPTH / 2 - 0.012]} material={goldMat} castShadow>
        <boxGeometry args={[FRAME_BORDER, H - FRAME_BORDER * 2, FRAME_DEPTH]} />
      </mesh>
      {/* inner lip catches the spotlight glare */}
      <mesh position={[0, h / 2 + MATTE, 0.022]} material={goldInnerMat}>
        <boxGeometry args={[w + MATTE * 2 + 0.02, 0.02, 0.025]} />
      </mesh>
      <mesh position={[0, -(h / 2 + MATTE), 0.022]} material={goldInnerMat}>
        <boxGeometry args={[w + MATTE * 2 + 0.02, 0.02, 0.025]} />
      </mesh>
      <mesh position={[-(w / 2 + MATTE), 0, 0.022]} material={goldInnerMat}>
        <boxGeometry args={[0.02, h + MATTE * 2, 0.025]} />
      </mesh>
      <mesh position={[w / 2 + MATTE, 0, 0.022]} material={goldInnerMat}>
        <boxGeometry args={[0.02, h + MATTE * 2, 0.025]} />
      </mesh>
    </group>
  );
}

function CanvasFallback({ w, h }: { w: number; h: number }) {
  return (
    <mesh position={[0, 0, 0.018]}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial color="#d9d0bb" roughness={0.95} />
    </mesh>
  );
}

function CanvasPlane({
  placement,
  isFocused,
  registry,
}: {
  placement: Placement;
  isFocused: boolean;
  registry: Map<string, THREE.Mesh>;
}) {
  const { painting, w, h } = placement;
  const url = useMemo(
    () => wikiThumb(painting.imageUrl, 1280, painting.imageWidth),
    [painting]
  );
  const base = useTexture(url);
  const [hi, setHi] = useState<THREE.Texture | null>(null);
  const requested = useRef(false);
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    base.colorSpace = THREE.SRGBColorSpace;
    base.anisotropy = 8;
    base.needsUpdate = true;
  }, [base]);

  // Stream in a high-res scan the first time the work is inspected.
  useEffect(() => {
    if (!isFocused || requested.current) return;
    requested.current = true;
    const hiUrl = wikiThumb(painting.imageUrl, 2600, painting.imageWidth);
    if (hiUrl === url) return;
    new THREE.TextureLoader().load(hiUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      setHi(t);
    });
  }, [isFocused, painting, url]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.userData.slug = painting.slug;
    mesh.userData.placement = placement;
    registry.set(painting.slug, mesh);
    return () => {
      registry.delete(painting.slug);
    };
  }, [painting.slug, placement, registry]);

  return (
    <mesh ref={meshRef} position={[0, 0, 0.018]} receiveShadow>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial
        map={hi ?? base}
        roughness={0.62}
        metalness={0}
        envMapIntensity={0.32}
      />
    </mesh>
  );
}
