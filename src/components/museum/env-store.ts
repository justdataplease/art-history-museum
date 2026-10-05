// The gallery's reflection environment, shared between the room (which
// captures it) and the exhibits (whose gilt and varnish bind it explicitly).
//
// Why explicit binding: in three r184 a material with envMap === null samples
// scene.environment at scene.environmentIntensity, ignoring its own
// envMapIntensity. Materials that need their own reflection strength must set
// material.envMap themselves — subscribe with useGalleryEnv().

import { useSyncExternalStore } from "react";
import type * as THREE from "three";

let current: THREE.Texture | null = null;
const listeners = new Set<() => void>();

export function setGalleryEnv(tex: THREE.Texture | null): void {
  current = tex;
  listeners.forEach((l) => l());
}

export function getGalleryEnv(): THREE.Texture | null {
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The current gallery environment map (null until the room has made one). */
export function useGalleryEnv(): THREE.Texture | null {
  return useSyncExternalStore(subscribe, getGalleryEnv, () => null);
}
