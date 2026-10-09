"use client";

// The projector: a 1950s cinema projector, at 60% of a full 35 mm machine's size, on a slim cast-iron stand
// behind the chairs of a gallery's films' corner.
// Enamelled body, the lamp house behind it with its cooling fins and chimney (its slits glow while the lamp is
// on), the lens in front, two reels on their arms turning while the film runs, the film running down from the
// feed reel and up to the take-up reel, knobs, a pilot light, and its cable to the floor. Built from primitives
// like the museum's furniture; it faces the screen (-z). Its body sits as high as the lens wants: the machine is
// built at full size about its body's base and scaled as a whole; the stand is drawn at its scaled size.

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { CinemaRuntime } from "./cinema-runtime";

/** The machine's size against a full 35 mm projector's (the measures below are the full size). */
const SCALE = 0.6;
const BODY = { w: 0.36, h: 0.6, d: 0.62 };
/** The lens above the body's base. */
const LENS_UP = 0.52;
const REEL_R = 0.3;
const FEED_Z = -0.27;
const TAKE_Z = 0.42;

function reelGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.absarc(0, 0, REEL_R, 0, Math.PI * 2, false);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const h = new THREE.Path();
    h.absarc(Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.072, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const hub = new THREE.Path();
  hub.absarc(0, 0, 0.018, 0, Math.PI * 2, true);
  s.holes.push(hub);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1, curveSegments: 40 });
  g.center();
  g.rotateY(Math.PI / 2); // the disc in the y-z plane, turning about x
  return g;
}

/** A thin strip of film from a to b (metres, in the projector's frame). */
function strip(a: [number, number, number], b: [number, number, number]) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const len = va.distanceTo(vb);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return { position: mid, quaternion: q, len };
}

export interface ProjectorProps {
  runtime: RefObject<CinemaRuntime>;
  /** The stand's centre on the floor. */
  x: number;
  z: number;
  /** The lens (the beam's apex). */
  lens: [number, number, number];
  /** How far the cable runs along the floor to the wall (+x). */
  cable: number;
}

export function Projector({ runtime, x, z, lens, cable }: ProjectorProps) {
  // the body's base, in the stand's frame; above it, the machine's own frame (full size, scaled)
  const y0 = lens[1] - LENS_UP * SCALE;
  const reelY = BODY.h + 0.38;
  const feed = useRef<THREE.Group>(null);
  const take = useRef<THREE.Group>(null);
  const feedPack = useRef<THREE.Mesh>(null);
  const takePack = useRef<THREE.Mesh>(null);
  const lensMat = useRef<THREE.MeshStandardMaterial>(null);
  const slitMat = useRef<THREE.MeshStandardMaterial>(null);
  const pilotMat = useRef<THREE.MeshStandardMaterial>(null);

  const geo = useMemo(() => {
    const body = new RoundedBoxGeometry(BODY.w, BODY.h, BODY.d, 4, 0.035);
    const lampHouse = new THREE.CylinderGeometry(0.15, 0.15, 0.5, 40);
    const fin = new THREE.CylinderGeometry(0.19, 0.19, 0.012, 40);
    const chimney = new THREE.CylinderGeometry(0.055, 0.065, 0.2, 24);
    const cap = new THREE.CylinderGeometry(0.09, 0.07, 0.035, 24);
    const barrel = new THREE.CylinderGeometry(0.06, 0.068, 0.26, 40).rotateX(Math.PI / 2);
    const ring = new THREE.TorusGeometry(0.068, 0.009, 12, 40);
    const glass = new THREE.CircleGeometry(0.052, 40);
    const reel = reelGeometry();
    const pack = new THREE.CylinderGeometry(1, 1, 0.05, 48).rotateZ(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(0.035, 0.035, 0.09, 20).rotateZ(Math.PI / 2);
    const column = new THREE.CylinderGeometry(0.045, 0.057, y0 - 0.095, 24);
    const foot = new THREE.CylinderGeometry(0.021, 0.027, 0.03, 16);
    const knob = new THREE.CylinderGeometry(0.028, 0.028, 0.03, 20).rotateZ(Math.PI / 2);
    const wire = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.07, y0 + 0.03, 0.18),
        new THREE.Vector3(0.11, y0 - 0.25, 0.2),
        new THREE.Vector3(0.085, 0.5, 0.12),
        new THREE.Vector3(0.2, 0.015, 0.16),
        new THREE.Vector3(1.2, 0.012, 0.6),
        new THREE.Vector3(cable, 0.012, 0.9),
      ]),
      80, 0.011, 8
    );
    return { body, lampHouse, fin, chimney, cap, barrel, ring, glass, reel, pack, hub, column, foot, knob, cable: wire };
  }, [y0, cable]);

  const mat = useMemo(() => {
    const enamel = new THREE.MeshStandardMaterial({ color: "#2e3b37", metalness: 0.45, roughness: 0.38 });
    const iron = new THREE.MeshStandardMaterial({ color: "#121212", metalness: 0.6, roughness: 0.55 });
    const chrome = new THREE.MeshStandardMaterial({ color: "#d4d8dc", metalness: 1, roughness: 0.16 });
    const alu = new THREE.MeshStandardMaterial({ color: "#b8bdc2", metalness: 1, roughness: 0.32, side: THREE.DoubleSide });
    const film = new THREE.MeshStandardMaterial({ color: "#1d140e", metalness: 0.1, roughness: 0.35 });
    const rubber = new THREE.MeshStandardMaterial({ color: "#0b0b0b", metalness: 0, roughness: 0.8 });
    const brass = new THREE.MeshStandardMaterial({ color: "#a8823e", metalness: 1, roughness: 0.3 });
    return { enamel, iron, chrome, alu, film, rubber, brass };
  }, []);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  useEffect(() => () => Object.values(mat).forEach((m) => m.dispose()), [mat]);

  const strips = useMemo(
    () => [
      // feed reel -> the gate (down into the body's top front)
      strip([0.0, reelY - 0.2, FEED_Z + 0.05], [0.0, BODY.h + 0.005, -0.12]),
      // the body's top back -> take-up reel
      strip([0.0, BODY.h + 0.005, 0.18], [0.0, reelY - 0.12, TAKE_Z - 0.06]),
    ],
    [reelY]
  );

  useFrame(() => {
    const rt = runtime.current;
    if (!rt) return;
    if (feed.current) feed.current.rotation.x = -rt.reel;
    // the take-up reel turns slower as it fills (a fuller reel, a longer turn)
    if (take.current) take.current.rotation.x = -rt.reel * 1.35;
    const d = rt.deck.state;
    const p = d.duration > 0 ? Math.min(1, d.time / d.duration) : 0;
    const feedR = 0.08 + 0.17 * Math.sqrt(1 - p);
    const takeR = 0.08 + 0.17 * Math.sqrt(p);
    feedPack.current?.scale.set(1, feedR, feedR);
    takePack.current?.scale.set(1, takeR, takeR);
    const L = rt.level;
    if (lensMat.current) {
      lensMat.current.emissive.copy(rt.color).multiplyScalar(0.6).addScalar(0.4 * L);
      lensMat.current.emissiveIntensity = 0.2 + 7 * L;
    }
    if (slitMat.current) slitMat.current.emissiveIntensity = 0.05 + 2.2 * L;
    if (pilotMat.current) pilotMat.current.emissiveIntensity = rt.deck.state.film ? 2.5 : 0.2;
  });

  const lensLocalZ = (lens[2] - z) / SCALE;
  const fins = Array.from({ length: 7 }, (_, i) => 0.1 + i * 0.06);
  return (
    <group position={[x, 0, z]}>
      {/* the stand: a cross of feet, a column, a top plate */}
      <mesh geometry={geo.column} material={mat.iron} position={[0, 0.06 + (y0 - 0.095) / 2, 0]} />
      {[0, Math.PI / 2].map((r) => (
        <mesh key={r} material={mat.iron} position={[0, 0.036, 0]} rotation={[0, r + Math.PI / 4, 0]}>
          <boxGeometry args={[0.57, 0.042, 0.066]} />
        </mesh>
      ))}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} geometry={geo.foot} material={mat.rubber} position={[sx * 0.2, 0.015, sz * 0.2]} />
      ))}
      <mesh material={mat.iron} position={[0, y0 - 0.015, 0.05]}>
        <boxGeometry args={[0.3, 0.03, 0.6]} />
      </mesh>

      {/* the machine, about its body's base */}
      <group position={[0, y0, 0]} scale={SCALE}>
        {/* the body */}
        <mesh geometry={geo.body} material={mat.enamel} position={[0, BODY.h / 2, 0]} />
        {/* its side door's vents, and a brass maker's plate */}
        {Array.from({ length: 6 }, (_, i) => (
          <mesh key={i} material={mat.iron} position={[BODY.w / 2 + 0.002, 0.12 + i * 0.045, 0.12]}>
            <boxGeometry args={[0.004, 0.012, 0.2]} />
          </mesh>
        ))}
        <mesh material={mat.brass} position={[BODY.w / 2 + 0.003, 0.44, -0.12]}>
          <boxGeometry args={[0.004, 0.05, 0.14]} />
        </mesh>
        {[[-0.2, 0.28], [-0.05, 0.28], [0.1, 0.42]].map(([z, y], i) => (
          <mesh key={i} geometry={geo.knob} material={mat.chrome} position={[BODY.w / 2 + 0.018, y, z]} />
        ))}
        <mesh position={[BODY.w / 2 + 0.006, 0.52, 0.2]}>
          <sphereGeometry args={[0.011, 16, 12]} />
          <meshStandardMaterial ref={pilotMat} color="#3a0000" emissive="#ff2a1a" emissiveIntensity={0.2} />
        </mesh>

        {/* the lens */}
        <mesh geometry={geo.barrel} material={mat.chrome} position={[0, LENS_UP, lensLocalZ + 0.14]} />
        <mesh geometry={geo.ring} material={mat.iron} position={[0, LENS_UP, lensLocalZ + 0.012]} />
        <mesh geometry={geo.glass} position={[0, LENS_UP, lensLocalZ + 0.006]} rotation={[0, Math.PI, 0]}>
          <meshStandardMaterial ref={lensMat} color="#05070a" metalness={0.2} roughness={0.05} emissive="#ffffff" emissiveIntensity={0.2} />
        </mesh>

        {/* the lamp house behind, with fins, slits and its chimney */}
        <mesh geometry={geo.lampHouse} material={mat.enamel} position={[0, 0.28, 0.46]} />
        {fins.map((y) => (
          <mesh key={y} geometry={geo.fin} material={mat.iron} position={[0, y, 0.46]} />
        ))}
        <mesh position={[0.152, 0.28, 0.46]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[0.07, 0.24]} />
          <meshStandardMaterial ref={slitMat} color="#1a0d04" emissive="#ff9a3c" emissiveIntensity={0.05} />
        </mesh>
        <mesh geometry={geo.chimney} material={mat.enamel} position={[0, 0.63, 0.46]} />
        <mesh geometry={geo.cap} material={mat.iron} position={[0, 0.745, 0.46]} />

        {/* the reels' arms */}
        {[FEED_Z, TAKE_Z].map((z) => (
          <mesh key={z} material={mat.iron} position={[0.055, (BODY.h + reelY) / 2, z * 0.9]}>
            <boxGeometry args={[0.03, reelY - BODY.h + 0.04, 0.05]} />
          </mesh>
        ))}
        {/* the reels: two flanges, the film wound between them, turning about x */}
        <group ref={feed} position={[0, reelY, FEED_Z]}>
          <mesh geometry={geo.reel} material={mat.alu} position={[0.032, 0, 0]} />
          <mesh geometry={geo.reel} material={mat.alu} position={[-0.032, 0, 0]} />
          <mesh ref={feedPack} geometry={geo.pack} material={mat.film} />
          <mesh geometry={geo.hub} material={mat.chrome} position={[0.03, 0, 0]} />
      </group>
      <group ref={take} position={[0, reelY, TAKE_Z]}>
        <mesh geometry={geo.reel} material={mat.alu} position={[0.032, 0, 0]} />
        <mesh geometry={geo.reel} material={mat.alu} position={[-0.032, 0, 0]} />
        <mesh ref={takePack} geometry={geo.pack} material={mat.film} />
        <mesh geometry={geo.hub} material={mat.chrome} position={[0.03, 0, 0]} />
      </group>
      {strips.map((s, i) => (
        <mesh key={i} material={mat.film} position={s.position} quaternion={s.quaternion}>
          <boxGeometry args={[0.035, s.len, 0.002]} />
        </mesh>
      ))}
      </group>

      {/* the cable, down the column and along the floor to the wall */}
      <mesh geometry={geo.cable} material={mat.rubber} />
    </group>
  );
}
