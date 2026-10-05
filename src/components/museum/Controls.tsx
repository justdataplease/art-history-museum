"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";
import type { GalleryLayout, Placement } from "./layout";
import { inspectPose } from "./layout";
import type { GalleryProps } from "./Gallery";

// Camera behaviour: the entry walk, first-person movement, inspect fly-to.

// Walk the camera through the doorway while the entry doors swing open.
export function EntryDolly({
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

export function Player({
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

export function InspectCamera({
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
