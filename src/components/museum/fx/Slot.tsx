"use client";

// The studio's place inside the gallery's <Canvas>: nothing at all until the
// access phrase is given, then the 3-D layer (engine, input, frames) is
// loaded on demand.

import { lazy, Suspense } from "react";
import type * as THREE from "three";
import { useUnlocked } from "./latch";

const Layer = lazy(() => import("./Layer"));

export interface FxSlotProps {
  /** the gallery's slug → canvas mesh map (mesh.userData.placement has w, h) */
  registry: Map<string, THREE.Mesh>;
  /** tools work (walking, not inspecting / flying) */
  enabled: boolean;
  touch: boolean;
  /** compile everything in the scene, both variants (the gallery's warm-up); optional */
  compile?: () => Promise<void>;
  floorY?: number;
}

export function FxSlot(props: FxSlotProps) {
  const unlocked = useUnlocked();
  if (!unlocked) return null;
  return (
    <Suspense fallback={null}>
      <Layer {...props} />
    </Suspense>
  );
}
