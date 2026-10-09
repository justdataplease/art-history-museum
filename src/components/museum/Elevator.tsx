"use client";

// A custom room's elevator (a room with more than one floor): in the entrance wall beside the doors, as in a
// museum's lift lobby. A car behind the wall, centre-opening doors that slide into the wall, a floor indicator
// over the frame, call buttons (up where there is a floor above, down where there is one below) and a floor
// directory. Pressing a button (aim and click, or the HUD's buttons and E / Q) lights it, the car arrives with a
// chime and the doors open; MuseumApp then fades and takes the visitor to the other floor.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { RoomFloor } from "@/lib/types";
import type { ElevatorSpot } from "./layout";
import type { GalleryTheme } from "./theme";
import type { SuiteRuntime } from "./suite-runtime";
import { musicMuted } from "./MuseumAudio";

export type LiftDirection = "up" | "down";

export interface ElevatorApi {
  /** Light the button, bring the car, open the doors; resolves once they are open. */
  call(dir: LiftDirection): Promise<void>;
}

/** How close (m) and how squarely the visitor must stand to use the elevator. */
const NEAR = 3.4;
const FACING = 0.3;
const CLICK_RANGE = 4;
const DOOR_SPEED = 1.1; // of the full travel per second

const AMBER = "#ffb44a";

export function Elevator({
  spot,
  hallLength,
  theme,
  floors,
  floor,
  runtime,
  enabled,
  apiRef,
  onNear,
  onPress,
}: {
  spot: ElevatorSpot;
  hallLength: number;
  theme: GalleryTheme;
  floors: RoomFloor[];
  /** This floor, 1-based. */
  floor: number;
  runtime: SuiteRuntime;
  /** Walking (not inspecting, not riding): clicks on the buttons count. */
  enabled: boolean;
  apiRef: RefObject<ElevatorApi | null>;
  onNear: (near: boolean) => void;
  onPress: (dir: LiftDirection) => void;
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const zw = hallLength / 2;
  const { x: X, halfWidth: hw, height: H } = spot;
  const hasUp = floor < floors.length;
  const hasDown = floor > 1;

  // drawn only while the entrance room's architecture is (a long suite hides far rooms)
  const [visible, setVisible] = useState(() => runtime.archWindow()[0] === 0);
  useEffect(() => runtime.onWindowChange(() => setVisible(runtime.archWindow()[0] === 0)), [runtime]);

  // ---- materials: brass in the classical rooms, brushed steel in the modern ones
  const mats = useMemo(() => {
    const classical = theme.room.classical;
    const metal = new THREE.MeshStandardMaterial({
      color: classical ? "#b89553" : "#b8bcc0",
      metalness: 1,
      roughness: classical ? 0.32 : 0.36,
    });
    const leaf = new THREE.MeshStandardMaterial({
      color: classical ? "#a7884f" : "#a9adb1",
      metalness: 1,
      roughness: 0.42,
    });
    const car = new THREE.MeshStandardMaterial({
      color: classical ? "#6b4a30" : "#8d8f90",
      roughness: 0.55,
      metalness: classical ? 0 : 0.5,
      emissive: new THREE.Color(classical ? "#3a2618" : "#3c3d3e"),
      side: THREE.BackSide,
    });
    const glow = new THREE.MeshBasicMaterial({ color: "#fff3df", toneMapped: false });
    const dark = new THREE.MeshStandardMaterial({ color: "#151413", roughness: 0.3, metalness: 0.2 });
    const buttonOff = new THREE.MeshStandardMaterial({ color: "#d8d4cc", roughness: 0.3, metalness: 0.6 });
    const buttonLit = new THREE.MeshStandardMaterial({
      color: "#ffe2b0",
      emissive: new THREE.Color(AMBER),
      emissiveIntensity: 1.6,
      toneMapped: false,
    });
    return { metal, leaf, car, glow, dark, buttonOff, buttonLit };
  }, [theme.room.classical]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // ---- the indicator (floor number, arrow) and the floor directory: canvases
  const [pressed, setPressed] = useState<LiftDirection | null>(null);
  const indicator = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 96;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { c, tex };
  }, []);
  useEffect(() => {
    const g = indicator.c.getContext("2d");
    if (!g) return;
    g.fillStyle = "#0b0a09";
    g.fillRect(0, 0, 256, 96);
    g.fillStyle = AMBER;
    g.font = "bold 64px ui-monospace, 'Courier New', monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(floors[floor - 1]?.number ?? floor), 128, 52);
    const arrow = (up: boolean, x: number, lit: boolean) => {
      g.fillStyle = lit ? AMBER : "#3a2a16";
      g.beginPath();
      if (up) {
        g.moveTo(x, 26);
        g.lineTo(x + 18, 52);
        g.lineTo(x - 18, 52);
      } else {
        g.moveTo(x, 70);
        g.lineTo(x + 18, 44);
        g.lineTo(x - 18, 44);
      }
      g.fill();
    };
    if (hasUp) arrow(true, 46, pressed === "up");
    if (hasDown) arrow(false, 210, pressed === "down");
    indicator.tex.needsUpdate = true;
    invalidate();
  }, [indicator, floors, floor, pressed, hasUp, hasDown, invalidate]);

  const directory = useMemo(() => {
    if (spot.directoryX === null) return null;
    const c = document.createElement("canvas");
    const rows = floors.length;
    c.width = 640;
    c.height = 150 + rows * 92;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "#1a1816";
      g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = "rgba(220, 196, 150, 0.5)";
      g.lineWidth = 3;
      g.strokeRect(10, 10, c.width - 20, c.height - 20);
      g.fillStyle = "#e9e1d0";
      g.font = "500 30px Georgia, serif";
      g.textBaseline = "middle";
      g.fillText("FLOORS", 40, 66);
      // top floor first, as on a lobby board
      for (let i = rows - 1, row = 0; i >= 0; i--, row++) {
        const y = 140 + row * 92;
        const here = i + 1 === floor;
        if (here) {
          g.fillStyle = "rgba(255, 180, 74, 0.16)";
          g.fillRect(24, y - 38, c.width - 48, 80);
        }
        g.fillStyle = here ? AMBER : "#e9e1d0";
        g.font = "600 44px Georgia, serif";
        g.fillText(String(floors[i].number ?? i + 1), 44, y);
        const label = floors[i].label.replace(/^Floor -?\d+ · /, "");
        // the whole name: a size smaller where it is long, cut with an ellipsis only past that
        const room = c.width - 104 - 36;
        let size = 30;
        g.font = `${size}px Georgia, serif`;
        while (size > 23 && g.measureText(label).width > room) g.font = `${--size}px Georgia, serif`;
        let text = label;
        while (g.measureText(text).width > room && text.length > 4) text = `${text.replace(/…$/, "").slice(0, -1).trimEnd()}…`;
        g.fillText(text, 104, y - 12);
        g.fillStyle = here ? "rgba(255, 196, 120, 0.85)" : "rgba(233, 225, 208, 0.55)";
        g.font = "20px system-ui, sans-serif";
        g.fillText(here ? "You are here" : `${floors[i].works} works`, 104, y + 22);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { tex, aspect: c.height / c.width };
  }, [spot.directoryX, floors, floor]);
  useEffect(
    () => () => {
      indicator.tex.dispose();
      directory?.tex.dispose();
    },
    [indicator, directory]
  );

  // ---- the doors: 0 closed .. 1 open, eased toward the goal frame by frame
  const leafL = useRef<THREE.Mesh>(null);
  const leafR = useRef<THREE.Mesh>(null);
  const door = useRef({ open: 0, goal: 0 });
  const place = (open: number) => {
    const shift = hw * Math.min(1, open) * 0.98;
    leafL.current?.position.setX(X - hw / 2 - shift);
    leafR.current?.position.setX(X + hw / 2 + shift);
  };
  const upBtn = useRef<THREE.Mesh>(null);
  const downBtn = useRef<THREE.Mesh>(null);
  const plate = useRef<THREE.Mesh>(null);
  const nearRef = useRef(false);
  const onNearRef = useRef(onNear);
  const onPressRef = useRef(onPress);
  useEffect(() => {
    onNearRef.current = onNear;
    onPressRef.current = onPress;
  }, [onNear, onPress]);
  const tmp = useMemo(() => ({ fwd: new THREE.Vector3() }), []);

  useFrame((_, dt) => {
    const d = door.current;
    if (d.open !== d.goal) {
      const step = Math.min(0.1, dt) * DOOR_SPEED;
      d.open = d.goal > d.open ? Math.min(d.goal, d.open + step) : Math.max(d.goal, d.open - step);
      // ease: slow start and stop, as a door operator does
      place(0.5 - 0.5 * Math.cos(Math.PI * d.open));
      invalidate();
    }
    // is the visitor standing at the elevator, facing it?
    const dx = X - camera.position.x;
    const dz = zw - camera.position.z;
    const dist = Math.hypot(dx, dz);
    camera.getWorldDirection(tmp.fwd);
    const facing = dist > 1e-3 ? (tmp.fwd.x * dx + tmp.fwd.z * dz) / (dist * Math.hypot(tmp.fwd.x, tmp.fwd.z) || 1) : 1;
    const near = visible && dist < NEAR && facing > FACING;
    if (near !== nearRef.current) {
      nearRef.current = near;
      onNearRef.current(near);
    }
  });
  useEffect(
    () => () => {
      if (nearRef.current) onNearRef.current(false);
    },
    []
  );

  // ---- the api: call the car
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const api: ElevatorApi = {
      call(dir) {
        setPressed(dir);
        return new Promise((resolve) => {
          timers.push(
            setTimeout(() => {
              chime();
              door.current.goal = 1;
              invalidate();
            }, 650),
            setTimeout(resolve, 650 + 1000 / DOOR_SPEED)
          );
        });
      },
    };
    apiRef.current = api;
    return () => {
      timers.forEach(clearTimeout);
      if (apiRef.current === api) apiRef.current = null;
    };
  }, [apiRef, invalidate]);

  // ---- aim and click a button (pointer locked)
  useEffect(() => {
    if (!enabled) return;
    const ray = new THREE.Raycaster();
    ray.far = CLICK_RANGE;
    const centre = new THREE.Vector2(0, 0);
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || !document.pointerLockElement) return;
      const targets = [plate.current, upBtn.current, downBtn.current].filter((m): m is THREE.Mesh => !!m);
      if (!targets.length || !(hasUp || hasDown)) return;
      camera.updateMatrixWorld();
      ray.setFromCamera(centre, camera);
      // the buttons are small: a hit anywhere on the plate counts, the upper half up
      const hit = ray.intersectObjects(targets, false)[0];
      if (!hit) return;
      const dir: LiftDirection = hasUp && hasDown ? (hit.point.y >= 1.1 ? "up" : "down") : hasUp ? "up" : "down";
      onPressRef.current(dir);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [enabled, camera, hasUp, hasDown]);

  const lit = (dir: LiftDirection) => (pressed === dir ? mats.buttonLit : mats.buttonOff);
  const front = zw - 0.012; // the frame's face, in front of the wall
  const carDepth = 1.5;
  const carW = 2 * hw + 0.3;
  const btnY = (dir: LiftDirection) => (hasUp && hasDown ? (dir === "up" ? 1.16 : 1.04) : 1.1);

  return (
    <group visible={visible}>
      {/* the car behind the wall: lit panelling, a ceiling light, a handrail */}
      <mesh position={[X, (H + 0.25) / 2, zw + carDepth / 2 + 0.06]} material={mats.car}>
        <boxGeometry args={[carW, H + 0.25, carDepth]} />
      </mesh>
      <mesh position={[X, H + 0.24, zw + carDepth / 2 + 0.06]} rotation={[Math.PI / 2, 0, 0]} material={mats.glow}>
        <planeGeometry args={[carW * 0.7, carDepth * 0.7]} />
      </mesh>
      <mesh position={[X, 0.92, zw + carDepth + 0.02]} rotation={[0, 0, Math.PI / 2]} material={mats.metal}>
        <cylinderGeometry args={[0.018, 0.018, carW * 0.8, 10]} />
      </mesh>
      {/* the doors, sliding into the wall */}
      <mesh ref={leafL} position={[X - hw / 2, H / 2, zw + 0.035]} material={mats.leaf}>
        <boxGeometry args={[hw + 0.012, H, 0.025]} />
      </mesh>
      <mesh ref={leafR} position={[X + hw / 2, H / 2, zw + 0.035]} material={mats.leaf}>
        <boxGeometry args={[hw + 0.012, H, 0.025]} />
      </mesh>
      {/* the reveal, and the frame round the opening */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[X + s * (hw + 0.01), H / 2, zw + 0.03]} material={mats.metal}>
          <boxGeometry args={[0.02, H, 0.06]} />
        </mesh>
      ))}
      <mesh position={[X, H + 0.01, zw + 0.03]} material={mats.metal}>
        <boxGeometry args={[2 * hw + 0.04, 0.02, 0.06]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`f${s}`} position={[X + s * (hw + 0.05), (H + 0.1) / 2, front]} material={mats.metal}>
          <boxGeometry args={[0.1, H + 0.1, 0.024]} />
        </mesh>
      ))}
      <mesh position={[X, H + 0.05, front]} material={mats.metal}>
        <boxGeometry args={[2 * hw + 0.2, 0.1, 0.024]} />
      </mesh>
      {/* the floor indicator over the frame */}
      <mesh position={[X, H + 0.3, zw - 0.012]} material={mats.metal}>
        <boxGeometry args={[0.46, 0.2, 0.02]} />
      </mesh>
      <mesh position={[X, H + 0.3, zw - 0.025]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.4, 0.15]} />
        <meshBasicMaterial map={indicator.tex} toneMapped={false} />
      </mesh>
      {/* the call buttons */}
      <mesh ref={plate} position={[spot.panelX, 1.1, zw - 0.006]} material={mats.metal}>
        <boxGeometry args={[0.11, hasUp && hasDown ? 0.3 : 0.2, 0.012]} />
      </mesh>
      {hasUp && (
        <mesh ref={upBtn} position={[spot.panelX, btnY("up"), zw - 0.016]} rotation={[Math.PI / 2, 0, 0]} material={lit("up")}>
          <cylinderGeometry args={[0.026, 0.026, 0.012, 20]} />
        </mesh>
      )}
      {hasDown && (
        <mesh ref={downBtn} position={[spot.panelX, btnY("down"), zw - 0.016]} rotation={[Math.PI / 2, 0, 0]} material={lit("down")}>
          <cylinderGeometry args={[0.026, 0.026, 0.012, 20]} />
        </mesh>
      )}
      {hasUp && <Arrow x={spot.panelX} y={btnY("up")} z={zw - 0.024} up />}
      {hasDown && <Arrow x={spot.panelX} y={btnY("down")} z={zw - 0.024} up={false} />}
      {/* the floor directory */}
      {directory && spot.directoryX !== null && (
        <group position={[spot.directoryX, 1.55, zw - 0.006]} rotation={[0, Math.PI, 0]}>
          <mesh material={mats.metal}>
            <boxGeometry args={[spot.directoryWidth, (spot.directoryWidth - 0.04) * directory.aspect + 0.06, 0.008]} />
          </mesh>
          <mesh position={[0, 0, 0.006]}>
            <planeGeometry args={[spot.directoryWidth - 0.04, (spot.directoryWidth - 0.04) * directory.aspect]} />
            <meshStandardMaterial map={directory.tex} roughness={0.6} />
          </mesh>
        </group>
      )}
    </group>
  );
}

/** The engraved arrow on a call button (a small dark triangle). */
function Arrow({ x, y, z, up }: { x: number; y: number; z: number; up: boolean }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    const h = 0.011;
    s.moveTo(0, up ? h : -h);
    s.lineTo(h, up ? -h * 0.7 : h * 0.7);
    s.lineTo(-h, up ? -h * 0.7 : h * 0.7);
    s.closePath();
    return s;
  }, [up]);
  return (
    <mesh position={[x, y, z]} rotation={[0, Math.PI, 0]}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial color="#2a2018" />
    </mesh>
  );
}

let chimeCtx: AudioContext | null = null;

/** The arrival chime: two soft bell tones (none while the music is muted). */
function chime(): void {
  if (musicMuted()) return;
  try {
    chimeCtx ??= new AudioContext();
    const ctx = chimeCtx;
    void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    [
      [659.25, 0],
      [523.25, 0.32],
    ].forEach(([f, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(0.16, t0 + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0008, t0 + at + 1.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 1.5);
    });
  } catch {
    // no Web Audio
  }
}
