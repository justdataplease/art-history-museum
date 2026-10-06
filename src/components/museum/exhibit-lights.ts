// The lighting plan of every exhibit: which track heads light it, from
// where, how wide and how bright. Planned once per gallery (pure maths, no
// GPU objects) so the spotlight pool (suite-runtime.ts) knows every head up
// front, and each exhibit draws its fixtures and wall shadow from the same plan.

import * as THREE from "three";
import { frameAllowance, type GalleryLayout, type Placement } from "./layout";
import type { GalleryTheme } from "./theme";
import { frameMetrics } from "./frames";
import { hallFromPlacement, planLights, type HallDims, type LightPlan } from "./exhibit-geometry";

/**
 * Target illuminance-like level at the aim point (spot intensity is solved
 * per fixture as E·d²/cosθ so every work gets the same light, whatever its
 * throw). Tuned for NeutralToneMapping at exposure 1.0.
 */
const SPOT_E = 3.4;
const SPOT_PENUMBRA = 0.3;
/** A single head covers works up to this cone half-angle; bigger works get two heads. */
const SPLIT_HALF_ANGLE = THREE.MathUtils.degToRad(33);
/** Never open a cone wider than this (it would wash neighbours and the floor). */
const MAX_HALF_ANGLE = THREE.MathUtils.degToRad(52);

/**
 * Pale "white cube" walls (early-modern, post-war) show a spot's pool far more
 * than dark silk or distemper does, and their rooms already have a wall-wash:
 * a softer, slightly dimmer beam keeps the pool from reading as a hard disc.
 */
export function spotTune(era: GalleryTheme["era"]): { level: number; penumbra: number } {
  return era === "early-modern" || era === "postwar"
    ? { level: 0.85, penumbra: 0.45 }
    : { level: 1, penumbra: SPOT_PENUMBRA };
}

export interface ExhibitLights {
  /** One head per work; two for monumental works. */
  heads: LightPlan[];
  penumbra: number;
  /** Mean lens position in exhibit-local coordinates (the analytic wall shadow). */
  local: THREE.Vector3;
}

/** The hall a placement's fixtures hang in: its own room's rails (the
 *  flagship's screen has a cross rail of its own, in front of its face). */
export function roomDims(layout: GalleryLayout, pl: Placement): HallDims {
  const room = layout.rooms[pl.room];
  const screen = layout.screen && pl === layout.placements[0] ? layout.screen : null;
  return {
    hallWidth: layout.hallWidth,
    hallLength: layout.hallLength,
    wallHeight: layout.wallHeight,
    roomZ0: screen ? screen.z + screen.thickness / 2 : room?.z0,
    roomZ1: room?.z1,
  };
}

export function planExhibitLights(
  placement: Placement,
  theme: GalleryTheme,
  dims?: Partial<HallDims>,
): ExhibitLights {
  const { w, h } = placement;
  const frame = frameMetrics(theme.frame.style, w, h, theme.frame.width, frameAllowance(w, h));
  const spot = spotTune(theme.era);
  const hall = hallFromPlacement(placement, dims);
  const outer = { x0: -w / 2 - frame.outer, x1: w / 2 + frame.outer, y0: -h / 2 - frame.outer, y1: h / 2 + frame.outer };
  const heads = planLights(placement, hall, outer, frame.canvasZ, {
    level: SPOT_E * spot.level,
    penumbra: spot.penumbra,
    splitAt: SPLIT_HALF_ANGLE,
    maxHalf: MAX_HALF_ANGLE,
  });
  const mean = new THREE.Vector3();
  heads.forEach((l) => mean.add(l.plan.lens));
  mean.divideScalar(heads.length).sub(new THREE.Vector3(...placement.position));
  const c = Math.cos(placement.rotationY);
  const s = Math.sin(placement.rotationY);
  const local = new THREE.Vector3(mean.x * c - mean.z * s, mean.y, mean.x * s + mean.z * c);
  return { heads, penumbra: spot.penumbra, local };
}
