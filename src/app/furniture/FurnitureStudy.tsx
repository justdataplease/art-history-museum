"use client";

import { useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GeoBatch } from "@/components/museum/room-geometry";
import { buildBench, buildWallSeat, FURNITURE, type FurnitureSet } from "@/components/museum/furniture";
import { ROOM_STYLES } from "@/components/museum/theme";

// One room style at a time: its bench (left) and its wall piece (right, against a strip of wall).

function Piece({ set, x, z }: { set: FurnitureSet; x: number; z: number }) {
  const meshes = useMemo(() => {
    const out = { up: new GeoBatch(), wood: new GeoBatch(), metal: new GeoBatch() };
    buildBench(set, out, x - 1.1, z, set.bench.size[0], set.bench.size[1]);
    const wallZ = z - 1.2;
    buildWallSeat(set, out, {
      position: [x + 1.05, wallZ + set.wall.depth / 2],
      size: [Math.min(set.wall.width, 2.1), set.wall.depth],
      facing: 1,
    });
    const mats = {
      up: new THREE.MeshStandardMaterial({ color: set.up.color, roughness: set.up.roughness }),
      wood: new THREE.MeshStandardMaterial({
        color: set.wood.color,
        roughness: { grain: 0.5, lacquer: 0.2, paint: 0.6, steel: 0.3 }[set.wood.finish],
        metalness: set.wood.finish === "steel" ? 1 : 0,
      }),
      metal: new THREE.MeshStandardMaterial({
        color: set.metal.color,
        roughness: set.metal.roughness,
        metalness: set.metal.metalness,
      }),
    };
    return (["up", "wood", "metal"] as const).map((k) => ({ geometry: out[k].build(), material: mats[k], key: k }));
  }, [set, x, z]);
  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.key} geometry={m.geometry} material={m.material} />
      ))}
      <mesh position={[x + 1.05, 1.2, z - 1.2 - 0.02]}>
        <boxGeometry args={[2.3, 2.4, 0.04]} />
        <meshStandardMaterial color="#b9b2a6" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Env() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.background = new THREE.Color("#2a2826");
    pmrem.dispose();
  }, [gl, scene]);
  return null;
}

export function FurnitureStudy({ initial }: { initial: string }) {
  const [key, setKey] = useState(() => ROOM_STYLES.find((s) => s.key === initial)?.key ?? ROOM_STYLES[0].key);
  const style = ROOM_STYLES.find((s) => s.key === key)!;
  const set = FURNITURE[key];
  return (
    <div style={{ position: "fixed", inset: 0, background: "#2a2826" }}>
      <Canvas camera={{ position: [1.2, 2.1, 4.6], fov: 38 }} gl={{ toneMapping: THREE.NeutralToneMapping }}>
        <Env />
        <ambientLight intensity={0.25} />
        <directionalLight position={[3, 6, 5]} intensity={1.7} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial color="#6f655a" roughness={0.8} />
        </mesh>
        <Piece key={key} set={set} x={0} z={0} />
        <OrbitControls target={[0, 0.5, -0.4]} maxPolarAngle={Math.PI / 2 - 0.05} />
      </Canvas>
      <div style={{ position: "absolute", left: 16, top: 16, right: 16, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ROOM_STYLES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setKey(s.key);
              history.replaceState(null, "", `?s=${s.key}`);
            }}
            style={{
              padding: "6px 10px",
              font: "12px system-ui",
              color: s.key === key ? "#1a1816" : "#efe8dc",
              background: s.key === key ? "#e0c48a" : "rgba(0,0,0,0.4)",
              border: "1px solid rgba(239,232,220,0.3)",
              borderRadius: 999,
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p style={{ position: "absolute", left: 16, bottom: 16, margin: 0, color: "#efe8dc", font: "15px/1.4 Georgia, serif" }}>
        <b>{style.label}</b> · {set.name}
      </p>
    </div>
  );
}
