"use client";

// The studio's place inside the gallery's <Canvas>. Reserve its dark alarm
// light from the first frame: adding a light at unlock changes the light
// count and recompiles every lit room material. The engine still loads only
// after the access phrase is given.

import { lazy, Suspense, useRef, type RefObject } from "react";
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

export interface FxLayerProps extends FxSlotProps {
  beacon: RefObject<THREE.PointLight | null>;
}

export function FxSlot(props: FxSlotProps) {
  const unlocked = useUnlocked();
  const beacon = useRef<THREE.PointLight>(null);
  return (
    <>
      <pointLight ref={beacon} name="fx-beacon" color="#ff8a1e" intensity={0} distance={16} decay={2} userData={{ fxIgnore: true }} />
      {unlocked && (
        <Suspense fallback={null}>
          <Layer {...props} beacon={beacon} />
        </Suspense>
      )}
    </>
  );
}
