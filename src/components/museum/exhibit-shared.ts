// Lifetime of the exhibits' module-level GPU resources.
//
// The placeholder and blank-card textures, the procedural maps, the
// per-theme frame materials and the cached paintings are module singletons
// that outlive any one gallery. Every WebGLRenderer that uploads one adds a
// 'dispose' listener to it, and R3F never disposes a renderer (it only forces
// a context loss), so those listeners would pin each past renderer, its
// canvas and the detached gallery DOM for the life of the tab.
//
// Exhibits ref-count themselves here; once the last one has unmounted the
// shared objects are disposed. dispose() only frees each renderer's GPU copy
// and removes its listener: the objects stay valid and the next renderer
// uploads them again on first use.

import * as THREE from "three";
import { disposeSharedMaterials, sharedFrameMaterials } from "./exhibit-materials";
import { disposeBlankPlacardTexture } from "./exhibit-placard";
import { disposeCachedTextures, disposePlaceholderTexture } from "./exhibit-texture";

let users = 0;
let pending: ReturnType<typeof setTimeout> | null = null;
/** three's split-sum DFG table: a singleton of its own, bound to every PBR material. */
let dfgLut: THREE.Texture | null = null;

/** Register a mounted exhibit; the returned function unregisters it. */
export function retainExhibitResources(gl: THREE.WebGLRenderer): () => void {
  users++;
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  return () => {
    users = Math.max(0, users - 1);
    if (users > 0) return;
    if (pending) clearTimeout(pending);
    // Deferred, so a remount in the same commit (StrictMode, a new layout)
    // keeps everything; the closure holds `gl` only until it runs.
    pending = setTimeout(() => {
      pending = null;
      if (users === 0) releaseShared(gl);
    }, 0);
  };
}

function releaseShared(gl: THREE.WebGLRenderer) {
  // three doesn't export the DFG table, and it holds the same listeners; it
  // is set on the uniforms of every PBR material drawn, so read it off one.
  if (!dfgLut) {
    for (const m of sharedFrameMaterials()) {
      if (!gl.properties.has(m)) continue;
      const props = gl.properties.get(m) as { uniforms?: { dfgLUT?: { value?: unknown } } };
      const lut = props.uniforms?.dfgLUT?.value;
      if (lut instanceof THREE.Texture) {
        dfgLut = lut;
        break;
      }
    }
  }
  disposeSharedMaterials();
  disposePlaceholderTexture();
  disposeCachedTextures();
  disposeBlankPlacardTexture();
  dfgLut?.dispose();
}
