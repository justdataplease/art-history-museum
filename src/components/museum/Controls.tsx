"use client";

import { useEffect, useMemo, useRef, type ComponentRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei/core/PointerLockControls";
import * as THREE from "three";
import gsap from "gsap";
import {
  confine,
  EYE_HEIGHT,
  firstWallHit,
  inspectMaxDist,
  inspectPanelInset,
  inspectPose,
  planRoute,
  seatNear,
  spawnZ,
  supportAt,
  type GalleryLayout,
  type Placement,
  type SeatSpot,
} from "./layout";
import { setInspectFlying, setMoving } from "./renderer-motion";
import { getSettings, PACE_SPEED, TAP_PACE_SPEED } from "./settings";

// Camera behaviour: the entry walk, first-person movement (pointer lock on
// desktop, drag-to-look + tap-to-walk on touch), and the inspect fly-to.
//
// The canvas renders on demand, so everything here that moves the camera
// calls invalidate() while it is still changing. Frame deltas are clamped:
// after an idle stretch R3F's clock reports the whole gap as one delta.

const MAX_DT = 1 / 30;
// walking pace: the visitor's setting (settings.ts, Slow / Normal / Fast); holding W runs at twice it
const RUN_FACTOR = 2;
const RUN_AFTER_MS = 3000;
const AIM_RANGE = 9; // m: furthest a crosshair click can inspect from
const TAP_RANGE = 16; // m: furthest a tap can inspect from
const TAP_SLOP = 9; // px a touch may wander and still count as a tap
const TAP_MAX_MS = 450;
const LOOK_SPEED = 0.0042; // rad per px of drag
const MAX_PITCH = 1.25; // rad
// Jump: a plain ballistic hop (~0.6 m peak, ~0.7 s in the air), no air
// control beyond the momentum at take-off; a slight eye dip on landing. High
// enough to land on a bench (its top ~0.45 m): one stands on it and walks
// off its end (supportAt, confine's `feet`).
const GRAVITY = 9.8; // m/s²
const JUMP_HEIGHT = 0.6; // m
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT); // ~2.97 m/s
const LAND_DIP = 0.05; // m, at full landing speed
const LAND_DIP_TAU = 0.07; // s: the dip is deepest then, gone after ~6x
// Crouch: the eye eases down to CROUCH_EYE, walking slows. The lowest
// ceiling is a doorway head (>= 3 m) and nothing in the hall is low enough to
// stand up into, so neither move can put the eye in geometry.
const CROUCH_EYE = 1.0; // m
const CROUCH_S = 0.25; // s to go down or up
const CROUCH_SPEED = 0.5; // walking speed factor, crouched
// Sitting: C beside a chair, a settee or a bench sits down in it, facing the
// way it faces; a walk key, Space or C stands up a step in front of it.
const SIT_EYE = 0.68; // m above the seat
const SIT_S = 0.6; // s to sit down
const STAND_S = 0.35; // s to step back out

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
/** Waypoints closer than this are reached (the last one eases in instead). */
const WAYPOINT_REACH = 0.12;
const _meshes: THREE.Object3D[] = [];

function collect(registry: Map<string, THREE.Mesh>): THREE.Object3D[] {
  _meshes.length = 0;
  registry.forEach((m) => _meshes.push(m));
  return _meshes;
}

/** Nearest painting under a ray, within `range` (monumental canvases can be
 *  picked from further away, in proportion to their size) and not behind a
 *  suite's cross wall (only through a doorway). */
function pickPainting(
  ray: THREE.Raycaster,
  registry: Map<string, THREE.Mesh>,
  range: number,
  layout: GalleryLayout
): { placement: Placement; distance: number } | null {
  _hits.length = 0;
  ray.far = range * 3;
  ray.intersectObjects(collect(registry), false, _hits);
  const hit = _hits[0];
  const placement = hit?.object.userData.placement as Placement | undefined;
  if (!hit || !placement) return null;
  if (hit.distance > Math.max(range, 1.8 * Math.max(placement.w, placement.h))) return null;
  if (firstWallHit(ray.ray.origin, hit.point, layout)) return null;
  return { placement, distance: hit.distance };
}

/**
 * The camera's flight from `from` to `to`: straight when nothing is in the
 * way (as in a single room), else a smooth curve through the doorways
 * (planRoute's floor waypoints, the height eased from start to end).
 */
function flightPath(
  from: THREE.Vector3,
  to: THREE.Vector3,
  layout: GalleryLayout
): { curve: THREE.Curve<THREE.Vector3> | null; length: number } {
  if (!firstWallHit(from, to, layout)) return { curve: null, length: from.distanceTo(to) };
  const floor = planRoute({ x: from.x, z: from.z }, { x: to.x, z: to.z }, layout);
  const plan = [{ x: from.x, z: from.z }, ...floor];
  let total = 0;
  const at = [0];
  for (let i = 1; i < plan.length; i++) {
    total += Math.hypot(plan[i].x - plan[i - 1].x, plan[i].z - plan[i - 1].z);
    at.push(total);
  }
  const pts = plan.map((p, i) => {
    const k = total > 0 ? at[i] / total : 1;
    return new THREE.Vector3(p.x, THREE.MathUtils.lerp(from.y, to.y, k), p.z);
  });
  pts[pts.length - 1].copy(to);
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  return { curve, length: curve.getLength() };
}

/** A flight's duration: the usual for a hop within a room, longer through doorways. */
function flightSeconds(base: number, length: number): number {
  return base * THREE.MathUtils.clamp(Math.sqrt(length / 7), 1, 1.9);
}

/** Move the camera to (x, z) on the floor, kept inside the hall and off the
 *  furniture (but over a bench the feet are up at), the eye `eye` metres up. */
function placeOnFloor(camera: THREE.Camera, x: number, z: number, layout: GalleryLayout, eye = EYE_HEIGHT, feet = 0) {
  _flat.x = x;
  _flat.z = z;
  confine(_flat, layout, feet);
  camera.position.set(_flat.x, eye, _flat.z);
}

/** Keys typed into a field, or meant for a focused control, are not moves. */
function isFieldOrControl(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest('input, textarea, select, button, a, [contenteditable=""], [contenteditable="true"], [role="option"]');
}

/** The body: crouch level, the feet's height (the floor, a bench top, a jump's arc), landing dip, a seat. */
interface Body {
  /** Crouch toggled on. */
  crouch: boolean;
  /** 0 standing .. 1 crouched (linear in time; eased when applied). */
  k: number;
  /** The feet's height above the floor, and their vertical speed. */
  fy: number;
  vy: number;
  airborne: boolean;
  /** Landing dip: its depth, and the time since touchdown (-1: none). */
  dip: number;
  dipT: number;
  /** Sitting: where, and the sit-down's progress from where the eye was. */
  seat: SeatSpot | null;
  sitT: number;
  sitFrom: THREE.Vector3;
  sitQ: THREE.Quaternion;
  /** Standing up: a short glide from the seat to a step in front of it. */
  glide: { x0: number; z0: number; x1: number; z1: number; t: number } | null;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Advance the body by dt over `ground` (the floor or a bench top under the feet); returns whether the eye
 *  is still moving. */
function stepBody(b: Body, dt: number, ground: number): boolean {
  let moving = false;
  const goal = b.crouch ? 1 : 0;
  if (b.k !== goal) {
    const step = dt / CROUCH_S;
    b.k = goal > b.k ? Math.min(goal, b.k + step) : Math.max(goal, b.k - step);
    moving = true;
  }
  if (!b.airborne && ground < b.fy - 0.005) {
    // walked off the end of a bench: fall
    b.airborne = true;
    b.vy = 0;
  }
  if (b.airborne) {
    // exact for constant gravity, whatever the frame rate
    b.fy += b.vy * dt - 0.5 * GRAVITY * dt * dt;
    b.vy -= GRAVITY * dt;
    if (b.vy <= 0 && b.fy <= ground) {
      // touchdown (on the floor, or on a bench): a dip in proportion to the landing speed
      b.dip = LAND_DIP * Math.min(1, -b.vy / JUMP_SPEED);
      b.dipT = 0;
      b.fy = ground;
      b.vy = 0;
      b.airborne = false;
    }
    moving = true;
  } else if (b.dipT >= 0) {
    b.dipT += dt;
    if (b.dipT > 6 * LAND_DIP_TAU) b.dipT = -1;
    moving = true;
  }
  return moving;
}

/** Eye height for the body's state. */
function eyeOf(b: Body): number {
  const base = THREE.MathUtils.lerp(EYE_HEIGHT, CROUCH_EYE, smooth(b.k));
  // a critically damped dip: down fast, eased back up
  const u = b.dipT >= 0 ? b.dipT / LAND_DIP_TAU : 0;
  const dip = b.dipT >= 0 ? b.dip * u * Math.exp(1 - u) : 0;
  return base + b.fy - dip;
}

/** Where the eye is, sitting in `s`: over the back half of the seat, facing the way it faces. */
const _seatPos = new THREE.Vector3();
const _seatQ = new THREE.Quaternion();
const _seatE = new THREE.Euler(0, 0, 0, "YXZ");
function seatPose(s: SeatSpot): void {
  _seatPos.set(s.x - Math.sin(s.ry) * 0.08, s.h + SIT_EYE, s.z - Math.cos(s.ry) * 0.08);
  _seatQ.setFromEuler(_seatE.set(-0.06, s.ry + Math.PI, 0));
}

// ------------------------------------------------------------- EntryDolly

/** Walk the camera through the doorway while the entry doors swing open (or out of the elevator, from fromX). */
export function EntryDolly({
  entering,
  layout,
  onArrived,
  fromX,
}: {
  entering: boolean;
  layout: GalleryLayout;
  onArrived: () => void;
  fromX?: number;
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
    if (fromX !== undefined) camera.position.x = fromX;
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
  }, [entering, camera, layout, invalidate, fromX]);
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
  /** Request pointer lock; call from a user gesture (a click, a key other than Esc). `early`: also while a
   *  painting is still being left (the close button's click), so the visitor walks on when it is. */
  lock(early?: boolean): void;
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
  const forwardSince = useRef<number | null>(null);
  const vel = useRef(new THREE.Vector3());
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const aimed = useRef(false);
  const aimPos = useRef(new THREE.Vector3(Infinity, 0, 0));
  const aimQuat = useRef(new THREE.Quaternion());
  const walkRef = useRef(walkEnabled);
  useEffect(() => {
    walkRef.current = walkEnabled;
  }, [walkEnabled]);
  const body = useRef<Body>({
    crouch: false, k: 0, fy: 0, vy: 0, airborne: false, dip: 0, dipT: -1,
    seat: null, sitT: 1, sitFrom: new THREE.Vector3(), sitQ: new THREE.Quaternion(), glide: null,
  });
  /** Where this component last left the camera (anything else moving it: a teleport, the elevator). */
  const lastXZ = useRef<[number, number] | null>(null);

  const isLocked = () => {
    const el = controls.current?.domElement;
    return !!el && document.pointerLockElement === el;
  };

  const halt = () => {
    pressed.current.clear();
    forwardSince.current = null;
    vel.current.set(0, 0, 0);
    setMoving(false);
  };

  // Keyboard. Keys are dropped whenever the window loses focus or the page is
  // hidden: the matching keyup goes to another app and would never arrive.
  // Space jumps (or stands up from a crouch); C, or Ctrl pressed and
  // released on its own (Ctrl+anything stays the browser's), toggles the
  // crouch. Only while walking with the pointer locked, never from a field
  // or a focused control.
  useEffect(() => {
    let bareCtrl = false;
    const active = (e: KeyboardEvent) => walkRef.current && isLocked() && !isFieldOrControl(e.target);
    /** Stand up from a seat: a step in front of it, the eye rising as from a crouch. */
    const standUp = () => {
      const b = body.current;
      const s = b.seat;
      if (!s) return;
      b.seat = null;
      _flat.x = s.x + Math.sin(s.ry) * 0.62;
      _flat.z = s.z + Math.cos(s.ry) * 0.62;
      confine(_flat, layout);
      b.glide = { x0: camera.position.x, z0: camera.position.z, x1: _flat.x, z1: _flat.z, t: 0 };
      b.fy = 0;
      b.crouch = false;
      // from about the seated eye height
      b.k = 0.67;
      invalidate();
    };
    /** C: sit down if a seat is in reach (standing on the floor), else crouch / stand. */
    const toggleCrouch = () => {
      const b = body.current;
      if (b.airborne || b.glide) return;
      if (b.seat) {
        standUp();
        return;
      }
      const s = !b.crouch && b.fy === 0 ? seatNear(layout, camera.position.x, camera.position.z) : null;
      if (s) {
        b.seat = s;
        b.sitT = 0;
        b.sitFrom.copy(camera.position);
        b.sitQ.copy(camera.quaternion);
        vel.current.set(0, 0, 0);
        invalidate();
        return;
      }
      b.crouch = !b.crouch;
      invalidate();
    };
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Control") bareCtrl = false;
      if (e.code === "Space") {
        if (!active(e) || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault(); // never scroll the page
        if (e.repeat) return;
        const b = body.current;
        if (b.seat) {
          standUp();
        } else if (b.crouch) {
          b.crouch = false; // stand up first
        } else if (!b.airborne && b.k === 0 && !b.glide) {
          b.airborne = true;
          b.vy = JUMP_SPEED;
          b.dipT = -1;
        }
        invalidate();
        return;
      }
      if (e.key === "Control") {
        bareCtrl = !e.repeat && !e.shiftKey && !e.altKey && !e.metaKey;
        return;
      }
      if (e.code === "KeyC" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (!active(e)) return;
        // Another handler may own C right now (it then prevents the
        // default): decide once every listener has seen the key.
        setTimeout(() => {
          if (!e.defaultPrevented) toggleCrouch();
        }, 0);
        return;
      }
      if (KEYS[e.code] && !e.ctrlKey && !e.metaKey && !e.altKey && walkRef.current && !isLocked() && !isFieldOrControl(e.target)) {
        lockApi.current?.lock();
      }
      if (!KEYS[e.code] || e.ctrlKey || e.metaKey || e.altKey || !active(e)) return;
      // a walk key gets up out of a seat (and walks on once standing)
      if (body.current.seat) standUp();
      if (e.code === "KeyW" && !pressed.current.has(e.code)) forwardSince.current = performance.now();
      pressed.current.add(e.code);
      invalidate();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyW") forwardSince.current = null;
      if (e.key === "Control") {
        if (bareCtrl && active(e)) toggleCrouch();
        bareCtrl = false;
        return;
      }
      if (pressed.current.delete(e.code)) invalidate();
    };
    // Ctrl+click is not a crouch either
    const pointer = () => {
      bareCtrl = false;
    };
    window.addEventListener("pointerdown", pointer, true);
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
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("blur", halt);
      document.removeEventListener("visibilitychange", onVis);
      halt();
    };
  }, [invalidate, lockApi, layout, camera]);

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
      lock(early = false) {
        const el = controls.current?.domElement as HTMLElement | undefined;
        if (!el || (!walkRef.current && !early) || document.pointerLockElement === el) return;
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
      // the click on "step inside" that took the lock, or on a HUD control,
      // is not aim
      const t = e.target as Element | null;
      if (t?.closest?.(".mus-click-to-start, button, a, nav, input")) return;
      camera.updateMatrixWorld();
      ray.setFromCamera(_CENTER, camera);
      const hit = pickPainting(ray, registry, AIM_RANGE, layout);
      if (!hit) return;
      halt();
      document.exitPointerLock?.();
      onSelect(hit.placement);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [camera, layout, onSelect, ray, registry]);

  useFrame((_, rawDt) => {
    if (!walkRef.current) return; // inspecting: the inspect camera has the eye
    const dt = Math.min(rawDt, MAX_DT);
    const b = body.current;
    const p = camera.position;
    // moved from outside (a room jump, the elevator): out of any seat, back on the floor
    const last = lastXZ.current;
    if (last && Math.hypot(p.x - last[0], p.z - last[1]) > 0.5) {
      b.seat = null;
      b.glide = null;
      b.fy = 0;
      b.vy = 0;
      b.airborne = false;
    }
    const done = () => {
      lastXZ.current = [p.x, p.z];
    };

    // sitting: ease into the seat, then only the mouse looks round
    if (b.seat) {
      if (b.sitT < 1) {
        b.sitT = Math.min(1, b.sitT + dt / SIT_S);
        const e = smooth(b.sitT);
        seatPose(b.seat);
        p.lerpVectors(b.sitFrom, _seatPos, e);
        camera.quaternion.slerpQuaternions(b.sitQ, _seatQ, e);
        invalidate();
      }
      setMoving(false);
      done();
      return;
    }
    // standing up: a short glide out of the seat while the eye rises
    if (b.glide) {
      const g = b.glide;
      g.t = Math.min(1, g.t + dt / STAND_S);
      const e = smooth(g.t);
      stepBody(b, dt, 0);
      p.set(g.x0 + (g.x1 - g.x0) * e, eyeOf(b), g.z0 + (g.z1 - g.z0) * e);
      if (g.t >= 1) b.glide = null;
      invalidate();
      done();
      return;
    }

    // The eye's height (crouch, jump, landing) settles even if the lock is
    // released mid-jump; frames are asked for only while it changes.
    const ctl = controls.current;
    if (!ctl?.isLocked) {
      const rising = stepBody(b, dt, supportAt(layout, p.x, p.z, b.fy));
      p.y = eyeOf(b);
      if (rising) invalidate();
      done();
      return;
    }

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
    if (_dir.lengthSq() > 0) {
      const running = mz < 0 && pressed.current.has("KeyW") && forwardSince.current !== null
        && performance.now() - forwardSince.current >= RUN_AFTER_MS && !b.crouch && b.k === 0;
      const walk = PACE_SPEED[getSettings().pace];
      _dir.normalize().multiplyScalar((running ? walk * RUN_FACTOR : walk) * THREE.MathUtils.lerp(1, CROUCH_SPEED, smooth(b.k)));
    }
    // in the air: the take-off's momentum, no steering
    if (!b.airborne) vel.current.lerp(_dir, 1 - Math.exp(-10 * dt));

    const walking = pressed.current.size > 0;
    // across the floor (over a bench the feet are up at), then the feet onto what is under them
    if (walking || b.airborne || vel.current.lengthSq() > 1e-4) {
      placeOnFloor(camera, p.x + vel.current.x * dt, p.z + vel.current.z * dt, layout, p.y, b.fy);
      invalidate();
    } else {
      vel.current.set(0, 0, 0);
    }
    const rising = stepBody(b, dt, supportAt(layout, p.x, p.z, b.fy));
    p.y = eyeOf(b);
    if (rising) invalidate();
    setMoving(walking);
    done();

    // crosshair aim: only when the view actually changed
    if (
      camera.position.distanceToSquared(aimPos.current) > 1e-6 ||
      Math.abs(camera.quaternion.dot(aimQuat.current)) < 0.999999
    ) {
      aimPos.current.copy(camera.position);
      aimQuat.current.copy(camera.quaternion);
      camera.updateMatrixWorld();
      ray.setFromCamera(_CENTER, camera);
      const a = !!pickPainting(ray, registry, AIM_RANGE, layout);
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
  /** Remaining waypoints of a tap-to-walk (through doorways, round benches). */
  const route = useRef<THREE.Vector3[]>([]);
  const enabled = useRef(false);
  useEffect(() => {
    enabled.current = walkEnabled && active;
    if (!enabled.current) {
      route.current = [];
      setMoving(false);
    }
  }, [walkEnabled, active]);
  // The flag is module state: leaving mid-walk must not carry it into the
  // next gallery (adaptive resolution would sample its idle frames).
  useEffect(() => () => setMoving(false), []);

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
      const hit = pickPainting(ray, registry, TAP_RANGE, layout);
      const floor = ray.ray.intersectPlane(_FLOOR, _floorHit);
      const floorDist = floor ? ray.ray.origin.distanceTo(floor) : Infinity;
      if (hit && hit.distance <= floorDist) {
        route.current = [];
        setMoving(false);
        onSelect(hit.placement);
        return;
      }
      if (floor) {
        _flat.x = floor.x;
        _flat.z = floor.z;
        // a tap on a cross wall: walk up to the foot of the wall instead
        const wall = firstWallHit(ray.ray.origin, floor, layout);
        if (wall) {
          _flat.x = wall.x;
          _flat.z = wall.z + wall.facing * 0.6;
        }
        confine(_flat, layout);
        const p = camera.position;
        route.current = planRoute({ x: p.x, z: p.z }, _flat, layout).map(
          (q) => new THREE.Vector3(q.x, EYE_HEIGHT, q.z)
        );
        setMoving(route.current.length > 0);
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

  const lastPos = useRef(new THREE.Vector3());
  useFrame((_, rawDt) => {
    const p = camera.position;
    // a jump to another room (the navigator) cancels a walk in progress
    const jumped = p.distanceToSquared(lastPos.current) > 4;
    lastPos.current.copy(p);
    if (jumped && route.current.length) {
      route.current = [];
      setMoving(false);
    }
    const t = route.current[0];
    if (!t) return;
    const dt = Math.min(rawDt, MAX_DT);
    const last = route.current.length === 1;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < (last ? 0.03 : WAYPOINT_REACH)) {
      route.current.shift();
      if (!route.current.length) setMoving(false);
      invalidate();
      return;
    }
    // full pace past waypoints; ease out over the last metre or so
    const tapSpeed = TAP_PACE_SPEED[getSettings().pace];
    const pace = last ? Math.min(tapSpeed, dist * 2.2 + 0.35) : tapSpeed;
    const step = Math.min(dist, pace * dt);
    const px = p.x;
    const pz = p.z;
    placeOnFloor(camera, px + (dx / dist) * step, pz + (dz / dist) * step, layout);
    if (Math.hypot(p.x - px, p.z - pz) < step * 0.2) {
      // blocked by a bench or wall: stop rather than grind against it
      route.current = [];
      setMoving(false);
    }
    invalidate();
  });

  return null;
}

// ---------------------------------------------------------- InspectCamera

/** Inspect zoom range: leaning out stops short of the opposite wall (not at
 *  all when the framing distance was already capped there). */
function clampZoom(f: { base: number; maxDist: number }, zoom: number): number {
  return THREE.MathUtils.clamp(zoom, 0.28, Math.min(1.15, f.maxDist / f.base));
}

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
  /** Settled inspect framing: target point, unit view direction, base
   *  distance, zoom factor, and the furthest the camera may stand from the
   *  work before leaving the hall. */
  const frame = useRef<{
    target: THREE.Vector3;
    normal: THREE.Vector3;
    base: number;
    zoom: number;
    maxDist: number;
  } | null>(null);
  /** End pose of the running fly-in; a resize mid-flight retargets it. */
  const flyEnd = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion } | null>(null);
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
    const maxDist = inspectMaxDist(pl, layout);
    const pose = inspectPose(pl, camera.fov, (width - inset.right) / height, {
      heightFrac: (height - inset.bottom) / height,
      maxDist,
    });
    const target = new THREE.Vector3(...pose.lookAt);
    const pos = new THREE.Vector3(...pose.position);
    const normal = pos.clone().sub(target);
    const base = normal.length();
    normal.normalize();
    // Matrix4.lookAt uses the camera convention (−z toward the target).
    const quat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(pos, target, camera.up)
    );
    return { target, normal, base, maxDist, pos, quat };
  };

  // Fly in / fly back.
  useEffect(() => {
    tween.current?.kill();
    tween.current = null;
    flyEnd.current = null;
    setInspectFlying(false);
    if (inspect) {
      if (!saved.current) {
        saved.current = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
      }
      const f = computeFrame(inspect);
      frame.current = { target: f.target, normal: f.normal, base: f.base, zoom: 1, maxDist: f.maxDist };
      const end = { pos: f.pos, quat: f.quat };
      flyEnd.current = end;
      const startPos = camera.position.clone();
      const startQuat = camera.quaternion.clone();
      const startK = offsetK.current;
      // through the doorways when the work hangs in another room
      const path = flightPath(startPos, end.pos, layout);
      const planned = end.pos.clone();
      setInspectFlying(true);
      tween.current = gsap.fromTo(
        prog.current,
        { p: 0 },
        {
          p: 1,
          duration: flightSeconds(1.35, path.length),
          ease: "power3.inOut",
          onUpdate: () => {
            const p = prog.current.p;
            if (path.curve) {
              // follow the curve; a resize retargeting the end blends in
              path.curve.getPointAt(p, camera.position);
              camera.position.addScaledVector(_dir.subVectors(end.pos, planned), p);
            } else camera.position.lerpVectors(startPos, end.pos, p);
            camera.quaternion.slerpQuaternions(startQuat, end.quat, p);
            applyOffset(startK + (1 - startK) * p);
            invalidate();
          },
          onComplete: () => {
            tween.current = null;
            setInspectFlying(false);
            if (flyEnd.current === end) flyEnd.current = null;
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
      const path = flightPath(startPos, s.pos, layout);
      setInspectFlying(true);
      tween.current = gsap.fromTo(
        prog.current,
        { p: 0 },
        {
          p: 1,
          duration: flightSeconds(1.1, path.length),
          ease: "power3.inOut",
          onUpdate: () => {
            const p = prog.current.p;
            if (path.curve) path.curve.getPointAt(p, camera.position);
            else camera.position.lerpVectors(startPos, s.pos, p);
            camera.quaternion.slerpQuaternions(startQuat, s.quat, p);
            applyOffset(startK * (1 - p));
            invalidate();
          },
          onComplete: () => {
            tween.current = null;
            setInspectFlying(false);
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
      setInspectFlying(false);
      if (camera.view?.enabled) camera.clearViewOffset();
    },
    [camera]
  );

  // Resize while inspecting: re-frame for the new viewport and panel size.
  // (R3F's own resize handling only updates aspect, leaving a stale offset.)
  // Mid fly-in, the running tween is retargeted so it lands on the new framing.
  useEffect(() => {
    sizeRef.current = size;
    if (offsetK.current > 0) applyOffset(offsetK.current);
    const f = frame.current;
    const end = flyEnd.current;
    if (inspect && f && (!tween.current || end)) {
      const n = computeFrame(inspect);
      f.base = n.base;
      f.maxDist = n.maxDist;
      f.zoom = clampZoom(f, f.zoom);
      if (tween.current && end) {
        end.pos.copy(n.pos);
        end.quat.copy(n.quat);
      } else {
        camera.position.copy(f.target).addScaledVector(f.normal, f.base * f.zoom);
      }
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
      f.zoom = clampZoom(f, f.zoom * factor);
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
