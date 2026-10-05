"use client";

import { useEffect, useMemo, useRef, type ComponentRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";
import {
  confine,
  EYE_HEIGHT,
  inspectMaxDist,
  inspectPanelInset,
  inspectPose,
  spawnZ,
  type GalleryLayout,
  type Placement,
} from "./layout";
import { setMoving } from "./renderer-motion";

// Camera behaviour: the entry walk, first-person movement (pointer lock on
// desktop, drag-to-look + tap-to-walk on touch), and the inspect fly-to.
//
// The canvas renders on demand, so everything here that moves the camera
// calls invalidate() while it is still changing. Frame deltas are clamped:
// after an idle stretch R3F's clock reports the whole gap as one delta.

const MAX_DT = 1 / 30;
const WALK_SPEED = 3.1; // m/s
const TAP_WALK_SPEED = 2.4; // m/s
const AIM_RANGE = 9; // m: furthest a crosshair click can inspect from
const TAP_RANGE = 16; // m: furthest a tap can inspect from
const TAP_SLOP = 9; // px a touch may wander and still count as a tap
const TAP_MAX_MS = 450;
const LOOK_SPEED = 0.0042; // rad per px of drag
const MAX_PITCH = 1.25; // rad

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _CENTER = new THREE.Vector2(0, 0);
const _ndc = new THREE.Vector2();
const _floorHit = new THREE.Vector3();
const _FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _flat = { x: 0, z: 0 };
const _hits: THREE.Intersection[] = [];
const _meshes: THREE.Object3D[] = [];

function collect(registry: Map<string, THREE.Mesh>): THREE.Object3D[] {
  _meshes.length = 0;
  registry.forEach((m) => _meshes.push(m));
  return _meshes;
}

/** Nearest painting under a ray, within `range` (monumental canvases can be
 *  picked from further away, in proportion to their size). */
function pickPainting(
  ray: THREE.Raycaster,
  registry: Map<string, THREE.Mesh>,
  range: number
): { placement: Placement; distance: number } | null {
  _hits.length = 0;
  ray.far = range * 3;
  ray.intersectObjects(collect(registry), false, _hits);
  const hit = _hits[0];
  const placement = hit?.object.userData.placement as Placement | undefined;
  if (!hit || !placement) return null;
  if (hit.distance > Math.max(range, 1.8 * Math.max(placement.w, placement.h))) return null;
  return { placement, distance: hit.distance };
}

/** Move the camera to (x, z) on the floor, kept inside the hall and off the benches. */
function placeOnFloor(camera: THREE.Camera, x: number, z: number, layout: GalleryLayout) {
  _flat.x = x;
  _flat.z = z;
  confine(_flat, layout);
  camera.position.set(_flat.x, EYE_HEIGHT, _flat.z);
}

// ------------------------------------------------------------- EntryDolly

/** Walk the camera through the doorway while the entry doors swing open. */
export function EntryDolly({
  entering,
  layout,
  onArrived,
}: {
  entering: boolean;
  layout: GalleryLayout;
  onArrived: () => void;
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const arrived = useRef(false);
  const onArrivedRef = useRef(onArrived);
  useEffect(() => {
    onArrivedRef.current = onArrived;
  }, [onArrived]);

  useEffect(() => {
    if (!entering || arrived.current) return;
    const tween = gsap.to(camera.position, {
      z: spawnZ(layout),
      duration: 3.0,
      ease: "power2.inOut",
      delay: 0.45,
      onUpdate: invalidate,
      onComplete: () => {
        arrived.current = true;
        onArrivedRef.current();
      },
    });
    // Killed on unmount, and between React's StrictMode double-invoke (the
    // re-run starts a fresh tween from wherever the camera is).
    return () => {
      tween.kill();
    };
  }, [entering, camera, layout, invalidate]);
  return null;
}

// ----------------------------------------------------------------- Player

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

export interface LockApi {
  /** Request pointer lock; call from a user gesture (click). */
  lock(): void;
}

type PLC = ComponentRef<typeof PointerLockControls>;

/** Desktop first-person: pointer-lock mouse look, WASD, click to inspect. */
export function Player({
  layout,
  registry,
  walkEnabled,
  onSelect,
  onAim,
  onLockChange,
  lockApi,
}: {
  layout: GalleryLayout;
  registry: Map<string, THREE.Mesh>;
  walkEnabled: boolean;
  onSelect: (pl: Placement) => void;
  onAim: (aimed: boolean) => void;
  onLockChange: (locked: boolean) => void;
  lockApi: RefObject<LockApi | null>;
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<PLC>(null);
  const pressed = useRef(new Set<string>());
  const vel = useRef(new THREE.Vector3());
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const aimed = useRef(false);
  const aimPos = useRef(new THREE.Vector3(Infinity, 0, 0));
  const aimQuat = useRef(new THREE.Quaternion());
  const walkRef = useRef(walkEnabled);
  useEffect(() => {
    walkRef.current = walkEnabled;
  }, [walkEnabled]);

  const isLocked = () => {
    const el = controls.current?.domElement;
    return !!el && document.pointerLockElement === el;
  };

  const halt = () => {
    pressed.current.clear();
    vel.current.set(0, 0, 0);
    setMoving(false);
  };

  // Keyboard. Keys are dropped whenever the window loses focus or the page is
  // hidden: the matching keyup goes to another app and would never arrive.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!KEYS[e.code] || e.ctrlKey || e.metaKey || e.altKey) return;
      pressed.current.add(e.code);
      invalidate();
    };
    const up = (e: KeyboardEvent) => {
      if (pressed.current.delete(e.code)) invalidate();
    };
    const onVis = () => {
      if (document.hidden) halt();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", halt);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", halt);
      document.removeEventListener("visibilitychange", onVis);
      halt();
    };
  }, [invalidate]);

  // Lock state comes from the document itself, whether or not drei's controls
  // are currently connected (they disconnect during inspect).
  useEffect(() => {
    const sync = () => {
      const locked = isLocked();
      if (controls.current) controls.current.isLocked = locked;
      if (!locked) halt();
      onLockChange(locked);
    };
    document.addEventListener("pointerlockchange", sync);
    sync();
    return () => document.removeEventListener("pointerlockchange", sync);
  }, [onLockChange, walkEnabled]);

  // Explicit lock for the "step inside" overlay (drei's document-wide
  // click-to-lock is disabled via an empty `selector`).
  useEffect(() => {
    const api: LockApi = {
      lock() {
        const el = controls.current?.domElement as HTMLElement | undefined;
        if (!el || !walkRef.current || document.pointerLockElement === el) return;
        try {
          const r = el.requestPointerLock() as unknown as Promise<void> | undefined;
          // Chrome rejects a re-lock within ~1 s of an Esc exit; the overlay stays up.
          r?.catch?.(() => {});
        } catch {
          // pointer lock unsupported
        }
      },
    };
    lockApi.current = api;
    return () => {
      if (lockApi.current === api) lockApi.current = null;
    };
  }, [lockApi]);

  // Click while locked = inspect what the crosshair is over.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || !walkRef.current || !isLocked()) return;
      camera.updateMatrixWorld();
      ray.setFromCamera(_CENTER, camera);
      const hit = pickPainting(ray, registry, AIM_RANGE);
      if (!hit) return;
      halt();
      document.exitPointerLock?.();
      onSelect(hit.placement);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [camera, onSelect, ray, registry]);

  useFrame((_, rawDt) => {
    const ctl = controls.current;
    if (!ctl?.isLocked || !walkRef.current) return;
    const dt = Math.min(rawDt, MAX_DT);

    let mx = 0;
    let mz = 0;
    pressed.current.forEach((code) => {
      const k = KEYS[code];
      if (k) {
        mx += k[0];
        mz += k[1];
      }
    });
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.crossVectors(_fwd, _UP);
    _dir.set(0, 0, 0).addScaledVector(_fwd, -mz).addScaledVector(_right, mx);
    if (_dir.lengthSq() > 0) _dir.normalize().multiplyScalar(WALK_SPEED);
    vel.current.lerp(_dir, 1 - Math.exp(-10 * dt));

    const walking = pressed.current.size > 0;
    if (walking || vel.current.lengthSq() > 1e-4) {
      const p = camera.position;
      placeOnFloor(camera, p.x + vel.current.x * dt, p.z + vel.current.z * dt, layout);
      invalidate();
    } else {
      vel.current.set(0, 0, 0);
    }
    setMoving(walking);

    // crosshair aim: only when the view actually changed
    if (
      camera.position.distanceToSquared(aimPos.current) > 1e-6 ||
      Math.abs(camera.quaternion.dot(aimQuat.current)) < 0.999999
    ) {
      aimPos.current.copy(camera.position);
      aimQuat.current.copy(camera.quaternion);
      camera.updateMatrixWorld();
      ray.setFromCamera(_CENTER, camera);
      const a = !!pickPainting(ray, registry, AIM_RANGE);
      if (a !== aimed.current) {
        aimed.current = a;
        onAim(a);
      }
    }
  });

  // selector matches nothing: no document-wide click → lock() listener.
  return <PointerLockControls ref={controls} enabled={walkEnabled} selector="#plc-none" />;
}

// ------------------------------------------------------------ TouchPlayer

/** Touch first-person: drag to look, tap the floor to walk there, tap a
 *  painting to inspect it. Raycasts are done here from the tap position
 *  (drei's PointerLockControls is not mounted, so R3F events stay uncentred). */
export function TouchPlayer({
  layout,
  registry,
  walkEnabled,
  active,
  onSelect,
}: {
  layout: GalleryLayout;
  registry: Map<string, THREE.Mesh>;
  walkEnabled: boolean;
  /** The visitor has dismissed the "step inside" overlay. */
  active: boolean;
  onSelect: (pl: Placement) => void;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const target = useRef<THREE.Vector3 | null>(null);
  const enabled = useRef(false);
  useEffect(() => {
    enabled.current = walkEnabled && active;
    if (!enabled.current) {
      target.current = null;
      setMoving(false);
    }
  }, [walkEnabled, active]);

  useEffect(() => {
    const el = (gl.domElement.parentElement ?? gl.domElement) as HTMLElement;
    const prevTouchAction = el.style.touchAction;
    el.style.touchAction = "none";
    const euler = new THREE.Euler(0, 0, 0, "YXZ");
    let drag: {
      id: number;
      x0: number;
      y0: number;
      x: number;
      y: number;
      t0: number;
      moved: boolean;
    } | null = null;

    const tap = (cx: number, cy: number) => {
      const rect = el.getBoundingClientRect();
      _ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      camera.updateMatrixWorld();
      ray.setFromCamera(_ndc, camera);
      const hit = pickPainting(ray, registry, TAP_RANGE);
      const floor = ray.ray.intersectPlane(_FLOOR, _floorHit);
      const floorDist = floor ? ray.ray.origin.distanceTo(floor) : Infinity;
      if (hit && hit.distance <= floorDist) {
        target.current = null;
        setMoving(false);
        onSelect(hit.placement);
        return;
      }
      if (floor) {
        _flat.x = floor.x;
        _flat.z = floor.z;
        confine(_flat, layout);
        target.current = new THREE.Vector3(_flat.x, EYE_HEIGHT, _flat.z);
        setMoving(true);
        invalidate();
      }
    };

    const down = (e: PointerEvent) => {
      if (!enabled.current || drag) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drag = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        x: e.clientX,
        y: e.clientY,
        t0: performance.now(),
        moved: false,
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // capture is best-effort
      }
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < TAP_SLOP) return;
      drag.moved = true;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (!enabled.current) return;
      euler.setFromQuaternion(camera.quaternion);
      euler.y += dx * LOOK_SPEED;
      euler.x = THREE.MathUtils.clamp(euler.x + dy * LOOK_SPEED, -MAX_PITCH, MAX_PITCH);
      euler.z = 0;
      camera.quaternion.setFromEuler(euler);
      invalidate();
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const wasTap = !drag.moved && performance.now() - drag.t0 < TAP_MAX_MS;
      drag = null;
      if (wasTap && enabled.current) tap(e.clientX, e.clientY);
    };
    const cancel = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) drag = null;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      el.style.touchAction = prevTouchAction;
    };
  }, [camera, gl, invalidate, layout, onSelect, ray, registry]);

  useFrame((_, rawDt) => {
    const t = target.current;
    if (!t) return;
    const dt = Math.min(rawDt, MAX_DT);
    const p = camera.position;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.03) {
      target.current = null;
      setMoving(false);
      return;
    }
    // ease out over the last metre or so
    const step = Math.min(dist, Math.min(TAP_WALK_SPEED, dist * 2.2 + 0.35) * dt);
    const px = p.x;
    const pz = p.z;
    placeOnFloor(camera, px + (dx / dist) * step, pz + (dz / dist) * step, layout);
    if (Math.hypot(p.x - px, p.z - pz) < step * 0.2) {
      // blocked by a bench or wall: stop rather than grind against it
      target.current = null;
      setMoving(false);
    }
    invalidate();
  });

  return null;
}

// ---------------------------------------------------------- InspectCamera

/** Fly to a painting (framed in the part of the screen the inspect panel
 *  leaves free), zoom with wheel / pinch, and fly back on close. */
export function InspectCamera({
  inspect,
  layout,
  onReturned,
}: {
  inspect: Placement | null;
  layout: GalleryLayout;
  onReturned: () => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const sizeRef = useRef(size);
  const saved = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion } | null>(null);
  const tween = useRef<gsap.core.Tween | null>(null);
  const prog = useRef({ p: 0 });
  /** How far the view offset (panel compensation) is applied, 0..1. */
  const offsetK = useRef(0);
  /** Settled inspect framing: target point, unit view direction, base distance, zoom factor. */
  const frame = useRef<{
    target: THREE.Vector3;
    normal: THREE.Vector3;
    base: number;
    zoom: number;
  } | null>(null);
  const onReturnedRef = useRef(onReturned);
  useEffect(() => {
    onReturnedRef.current = onReturned;
  }, [onReturned]);

  const applyOffset = (k: number) => {
    offsetK.current = k;
    const { width, height } = sizeRef.current;
    const inset = inspectPanelInset(width, height);
    if (k <= 1e-4 || (inset.right === 0 && inset.bottom === 0)) {
      if (camera.view?.enabled) camera.clearViewOffset();
      return;
    }
    // A positive offset shifts the frustum right/down, so the framed
    // painting lands centred in the area left of / above the panel.
    camera.setViewOffset(width, height, (inset.right / 2) * k, (inset.bottom / 2) * k, width, height);
  };

  const computeFrame = (pl: Placement) => {
    const { width, height } = sizeRef.current;
    const inset = inspectPanelInset(width, height);
    const pose = inspectPose(pl, camera.fov, (width - inset.right) / height, {
      heightFrac: (height - inset.bottom) / height,
      maxDist: inspectMaxDist(pl, layout),
    });
    const target = new THREE.Vector3(...pose.lookAt);
    const pos = new THREE.Vector3(...pose.position);
    const normal = pos.clone().sub(target);
    const base = normal.length();
    normal.normalize();
    return { target, normal, base, pos };
  };

  // Fly in / fly back.
  useEffect(() => {
    tween.current?.kill();
    tween.current = null;
    if (inspect) {
      if (!saved.current) {
        saved.current = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
      }
      const f = computeFrame(inspect);
      frame.current = { target: f.target, normal: f.normal, base: f.base, zoom: 1 };
      const startPos = camera.position.clone();
      const startQuat = camera.quaternion.clone();
      // Matrix4.lookAt uses the camera convention (−z toward the target).
      const endQuat = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(f.pos, f.target, camera.up)
      );
      const startK = offsetK.current;
      tween.current = gsap.fromTo(
        prog.current,
        { p: 0 },
        {
          p: 1,
          duration: 1.35,
          ease: "power3.inOut",
          onUpdate: () => {
            const p = prog.current.p;
            camera.position.lerpVectors(startPos, f.pos, p);
            camera.quaternion.slerpQuaternions(startQuat, endQuat, p);
            applyOffset(startK + (1 - startK) * p);
            invalidate();
          },
          onComplete: () => {
            tween.current = null;
          },
        }
      );
    } else if (saved.current) {
      const s = saved.current;
      saved.current = null;
      frame.current = null;
      const startPos = camera.position.clone();
      const startQuat = camera.quaternion.clone();
      const startK = offsetK.current;
      tween.current = gsap.fromTo(
        prog.current,
        { p: 0 },
        {
          p: 1,
          duration: 1.1,
          ease: "power3.inOut",
          onUpdate: () => {
            const p = prog.current.p;
            camera.position.lerpVectors(startPos, s.pos, p);
            camera.quaternion.slerpQuaternions(startQuat, s.quat, p);
            applyOffset(startK * (1 - p));
            invalidate();
          },
          onComplete: () => {
            tween.current = null;
            applyOffset(0);
            onReturnedRef.current();
          },
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspect]);

  useEffect(
    () => () => {
      tween.current?.kill();
      tween.current = null;
      if (camera.view?.enabled) camera.clearViewOffset();
    },
    [camera]
  );

  // Resize while inspecting: re-frame for the new viewport and panel size.
  // (R3F's own resize handling only updates aspect, leaving a stale offset.)
  useEffect(() => {
    sizeRef.current = size;
    if (offsetK.current > 0) applyOffset(offsetK.current);
    const f = frame.current;
    if (inspect && f && !tween.current) {
      const n = computeFrame(inspect);
      f.base = n.base;
      camera.position.copy(f.target).addScaledVector(f.normal, f.base * f.zoom);
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  // Lean in: wheel over the canvas (never over the panel), or pinch on touch.
  useEffect(() => {
    if (!inspect) return;
    const el = (gl.domElement.parentElement ?? gl.domElement) as HTMLElement;
    const zoomBy = (factor: number) => {
      const f = frame.current;
      if (!f || tween.current) return;
      f.zoom = THREE.MathUtils.clamp(f.zoom * factor, 0.28, 1.15);
      camera.position.copy(f.target).addScaledVector(f.normal, f.base * f.zoom);
      invalidate();
    };
    const onWheel = (e: WheelEvent) => {
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      zoomBy(Math.exp(dy * 0.001));
    };
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const spread = () => {
      const [a, b] = [...pts.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pinch = spread();
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const d = spread();
      if (pinch > 0 && d > 0) zoomBy(pinch / d);
      pinch = d;
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      pinch = spread();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [inspect, gl, camera, invalidate]);

  return null;
}
