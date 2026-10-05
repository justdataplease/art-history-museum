// The gallery's reflection environment.
//
// 1. Before the first frame: a PMREM of a tiny proxy room (walls, floor,
//    ceiling and a glowing laylight in the theme's colours at roughly the
//    radiance the real hall will have). It exists before any shader compiles,
//    so every program is built once with USE_ENVMAP / CUBEUV at 256 — no
//    second compile when the real probe arrives.
// 2. Once every painting has settled: ONE capture of the gallery itself from
//    the hall centre at eye height (CubeCamera, 256², HalfFloat) → PMREM at the
//    same size, so the program keys are unchanged and nothing recompiles.
//    The capture never nulls scene.environment (that would compile env-less
//    variants of every program): it zeroes scene.environmentIntensity and the
//    envMapIntensity of materials that bind their own envMap instead, and
//    switches the floor's planar reflection off (its texture matrix belongs
//    to the main camera, not to the cube faces).

import * as THREE from "three";
import type { GalleryLayout } from "./layout";
import type { GalleryTheme } from "./theme";
import { setFloorReflectionsEnabled } from "./room-floor";
import { ceilingSpec } from "./room-geometry";

export const ENV_SIZE = 256;
/** scene.environmentIntensity at rest (the probe is one bounce of real light). */
export const ENV_INTENSITY = 1;
/** Eye height of the probe. */
const PROBE_Y = 1.6;

/** Shared between Lighting (writes) and EnvSetup (reads before capture). */
export const roomState = { dim: 1 };

/** Ceiling "light" uniforms (cove uplight) that dim with the laylight. */
export const roomDimmers = new Set<{ uniform: THREE.IUniform<THREE.Color>; base: THREE.Color }>();

function lin(hex: string, k = 1): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}

/**
 * Proxy-room PMREM. The radiance constants approximate what the probe sees
 * (walls lit by the laylight plus the spot pools, a dark floor, a ceiling lit
 * by bounce), so the swap to the real probe is barely visible.
 */
export function initialEnvironment(
  pm: THREE.PMREMGenerator,
  layout: GalleryLayout,
  theme: GalleryTheme
): THREE.WebGLRenderTarget {
  const { hallWidth: W, hallLength: L, wallHeight: H } = layout;
  const spec = ceilingSpec(layout, theme);
  const s = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const add = (geo: THREE.BufferGeometry, color: THREE.Color, pos: [number, number, number], rotX = 0, rotY = 0) => {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(pos[0], pos[1] - PROBE_Y, pos[2]);
    mesh.rotation.set(rotX, rotY, 0);
    s.add(mesh);
    disposables.push(geo, m);
  };
  const wallK = 0.32;
  const wall = lin(theme.wall.color, wallK);
  const floor = lin(theme.floor.tint, theme.floor.kind === "concrete" ? 0.6 : 0.5);
  const ceil = lin(theme.ceiling, 0.45);
  // walls
  add(new THREE.PlaneGeometry(L, H), wall, [-W / 2, H / 2, 0], 0, Math.PI / 2);
  add(new THREE.PlaneGeometry(L, H), wall, [W / 2, H / 2, 0], 0, -Math.PI / 2);
  add(new THREE.PlaneGeometry(W, H), wall, [0, H / 2, -L / 2]);
  add(new THREE.PlaneGeometry(W, H), wall, [0, H / 2, L / 2], 0, Math.PI);
  // floor + ceiling
  add(new THREE.PlaneGeometry(W, L), floor, [0, 0, 0], -Math.PI / 2);
  add(new THREE.PlaneGeometry(W, L), ceil, [0, H, 0], Math.PI / 2);
  // the laylight / lightbox glass (just under the proxy ceiling plane)
  add(
    new THREE.PlaneGeometry(2 * spec.wellX, spec.wellZ1 - spec.wellZ0),
    lin(theme.room.daylight, theme.room.daylightLevel * 0.55),
    [0, H - 0.02, (spec.wellZ0 + spec.wellZ1) / 2],
    Math.PI / 2
  );
  // warm spot pools on the walls where the paintings hang
  const pool = lin(theme.light.spot, 0.45);
  for (const pl of layout.placements) {
    const g = new THREE.PlaneGeometry(pl.w + 0.6, pl.h + 0.8);
    const [x, y, z] = pl.position;
    const inset = 0.01;
    add(g, pool, [x - Math.sin(pl.rotationY) * -inset, y, z + Math.cos(pl.rotationY) * inset], 0, pl.rotationY);
  }
  const rt = pm.fromScene(s, 0.02, 0.05, 100, { size: ENV_SIZE });
  disposables.forEach((d) => d.dispose());
  return rt;
}

/** One-time capture of the real gallery into a PMREM of the same size. */
export function captureProbe(
  gl: THREE.WebGLRenderer,
  pm: THREE.PMREMGenerator,
  scene: THREE.Scene,
  layout: GalleryLayout
): THREE.WebGLRenderTarget {
  const cubeRT = new THREE.WebGLCubeRenderTarget(ENV_SIZE, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
  });
  const cam = new THREE.CubeCamera(0.05, Math.max(60, layout.hallLength * 2), cubeRT);
  cam.position.set(0, PROBE_Y, 0);
  cam.updateMatrixWorld(true);

  // Direct light + emissive only: no env contribution during the capture.
  const prevIntensity = scene.environmentIntensity;
  scene.environmentIntensity = 0;
  const saved: [THREE.MeshStandardMaterial, number][] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm && sm.envMap && typeof sm.envMapIntensity === "number") {
        saved.push([sm, sm.envMapIntensity]);
        sm.envMapIntensity = 0;
      }
    }
  });
  setFloorReflectionsEnabled(false);
  const prevTarget = gl.getRenderTarget();
  try {
    cam.update(gl, scene);
  } finally {
    setFloorReflectionsEnabled(true);
    for (const [m, v] of saved) m.envMapIntensity = v;
    scene.environmentIntensity = prevIntensity;
    gl.setRenderTarget(prevTarget);
  }

  const envRT = pm.fromCubemap(cubeRT.texture);
  cubeRT.dispose();
  return envRT;
}
