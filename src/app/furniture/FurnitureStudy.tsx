"use client";

import { useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GeoBatch } from "@/components/museum/room-geometry";
import { buildFurnishing, FURNITURE, type FurnitureSet } from "@/components/museum/furniture";
import type { Furnishing } from "@/components/museum/layout";
import { ROOM_STYLES } from "@/components/museum/theme";

// One room style at a time, every piece it has: the pieces for the middle of a room (front row), the armchairs
// (middle row, each in two of the style's fabrics), the pieces against a wall (back, against a strip of wall).

function Pieces({ set }: { set: FurnitureSet }) {
  const meshes = useMemo(() => {
    const out = { up: new GeoBatch(null, true), wood: new GeoBatch(null, true), metal: new GeoBatch(null, true) };
    const row = (kind: Furnishing["kind"], list: FurnitureSet["centre"], z: number, gap: number, copies = 1) => {
      const items = list.flatMap((p, index) => Array.from({ length: copies }, (_, c) => ({ p, index, c })));
      const widths = items.map(({ p }) => (kind === "centre" ? p.size[0] : Math.min(p.size[0], 2.1)));
      let x = -(widths.reduce((s, w) => s + w, 0) + gap * (items.length - 1)) / 2;
      items.forEach(({ p, index, c }, i) => {
        const w = widths[i];
        buildFurnishing(set, out, {
          kind,
          index,
          position: [x + w / 2, z + (kind === "wall" ? p.size[1] / 2 : 0)],
          rotation: kind === "chair" ? (c ? -0.35 : 0.35) : 0,
          size: [w, p.size[1]],
          room: 0,
          tint: c * 0.5 + 0.13,
        });
        x += w + gap;
      });
    };
    row("centre", set.centre, 1.4, 0.8);
    row("chair", set.chairs, 0, 0.5, 2);
    row("wall", set.wall, -1.6, 0.6);
    const mats = {
      up: new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: set.up.roughness,
        sheen: set.up.sheen,
        sheenRoughness: 0.42,
        sheenColor: new THREE.Color(0.6, 0.6, 0.6),
      }),
      wood: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: { grain: 0.5, lacquer: 0.2, paint: 0.6, steel: 0.3 }[set.wood.finish],
        metalness: set.wood.finish === "steel" ? 1 : 0,
      }),
      metal: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: set.metal.roughness,
        metalness: set.metal.metalness,
      }),
    };
    return (["up", "wood", "metal"] as const).map((k) => ({ geometry: out[k].build(), material: mats[k], key: k }));
  }, [set]);
  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.key} geometry={m.geometry} material={m.material} />
      ))}
      <mesh position={[0, 1.2, -1.62]}>
        <boxGeometry args={[7, 2.4, 0.04]} />
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
      <Canvas camera={{ position: [0.6, 2.6, 6.2], fov: 42 }} gl={{ toneMapping: THREE.NeutralToneMapping }}>
        <Env />
        <ambientLight intensity={0.25} />
        <directionalLight position={[3, 6, 5]} intensity={1.7} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial color="#6f655a" roughness={0.8} />
        </mesh>
        <Pieces key={key} set={set} />
        <OrbitControls target={[0, 0.5, -0.2]} maxPolarAngle={Math.PI / 2 - 0.05} />
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
