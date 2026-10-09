// The gallery's reflection environment.
//
// 0. Before the first frame: an empty CubeUV target of exactly the PMREM's
//    shape, so every program is built once with USE_ENVMAP / CUBEUV at 256 —
//    no second compile when the real environment arrives.
// 1. Right after the mount commit: a PMREM of a tiny proxy room (walls, floor,
//    ceiling and a glowing laylight in the theme's colours at roughly the
//    radiance the real hall will have). Not inside the commit: its GGX
//    program compiles synchronously (~350 ms on a cold GPU shader cache),
//    which would hold up the painting fetches the exhibits start there.
// 2. Once the works around the visitor have settled and the lights are up:
//    ONE capture of the gallery itself from the centre of the visitor's room
//    at eye height (in a suite every room shares the theme and section, so
//    one fully lit room stands for all; a fixed entrance-room probe taken
//    after the visitor had walked on saw that room dark and unhung)
//    (CubeCamera, 256², HalfFloat) → PMREM at the same size, so the program
//    keys are unchanged and nothing recompiles.
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

/** The middle of a room (the whole hall, for a single room): where the
 *  probe is captured, and the proxy room (the entrance room) centred. */
function probeZ(layout: GalleryLayout, room = 0): number {
  const r = layout.rooms[room] ?? layout.rooms[0];
  return r ? (r.z0 + r.z1) / 2 : 0;
}

/** Shared between Lighting (writes) and EnvSetup (reads before capture). */
export const roomState = { dim: 1 };

/** Ceiling "light" uniforms (cove uplight) that dim with the laylight. */
export const roomDimmers = new Set<{ uniform: THREE.IUniform<THREE.Color>; base: THREE.Color }>();

function lin(hex: string, k = 1): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}

/**
 * An empty stand-in shaped like the PMREM of ENV_SIZE (three's CubeUV layout:
 * 3·max(size, 112) × 4·size, HalfFloat). Programs key on the mapping and the
 * height only, so everything compiled against it fits the real environment.
 */
export function placeholderEnvironment(gl: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(3 * Math.max(ENV_SIZE, 16 * 7), 4 * ENV_SIZE, {
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    generateMipmaps: false,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: false,
  });
  rt.texture.mapping = THREE.CubeUVReflectionMapping;
  rt.texture.name = "PMREM.cubeUv";
  // allocated (zero-filled, black) rather than sampled unbound
  gl.initRenderTarget(rt);
  return rt;
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
  // the entrance room (the probe's), as a closed box
  const room = layout.rooms[0];
  const H = layout.wallHeight;
  const W = 2 * (room?.halfWidth ?? layout.hallWidth / 2);
  const L = room ? room.z1 - room.z0 : layout.hallLength;
  const zc = probeZ(layout);
  const spec = ceilingSpec(layout, theme);
  const s = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const add = (geo: THREE.BufferGeometry, color: THREE.Color, pos: [number, number, number], rotX = 0, rotY = 0) => {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(pos[0], pos[1] - PROBE_Y, pos[2] - zc);
    mesh.rotation.set(rotX, rotY, 0);
    s.add(mesh);
    disposables.push(geo, m);
  };
  const wallK = 0.32;
  const wall = lin(theme.wall.color, wallK);
  const floor = lin(theme.floor.tint, theme.floor.kind === "concrete" || theme.floor.kind === "marble" ? 0.6 : 0.5);
  const ceil = lin(theme.ceiling, 0.45);
  // walls
  add(new THREE.PlaneGeometry(L, H), wall, [-W / 2, H / 2, zc], 0, Math.PI / 2);
  add(new THREE.PlaneGeometry(L, H), wall, [W / 2, H / 2, zc], 0, -Math.PI / 2);
  add(new THREE.PlaneGeometry(W, H), wall, [0, H / 2, zc - L / 2]);
  add(new THREE.PlaneGeometry(W, H), wall, [0, H / 2, zc + L / 2], 0, Math.PI);
  // floor + ceiling
  add(new THREE.PlaneGeometry(W, L), floor, [0, 0, zc], -Math.PI / 2);
  add(new THREE.PlaneGeometry(W, L), ceil, [0, H, zc], Math.PI / 2);
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
    if (pl.room !== 0) continue;
    const g = new THREE.PlaneGeometry(pl.w + 0.6, pl.h + 0.8);
    const [x, y, z] = pl.position;
    const inset = 0.01;
    add(g, pool, [x - Math.sin(pl.rotationY) * -inset, y, z + Math.cos(pl.rotationY) * inset], 0, pl.rotationY);
  }
  const rt = pm.fromScene(s, 0.02, 0.05, 100, { size: ENV_SIZE });
  disposables.forEach((d) => d.dispose());
  return rt;
}

/**
 * Link the probe's cubemap → CubeUV program now, in parallel with the
 * warm-up, rather than synchronously on the capture frame. compile() builds
 * the variant for the bound target (screen: tone-mapped sRGB), so bind one as
 * fromCubemap() will (linear, no tone mapping) — or it would link twice.
 */
export function precompileProbeShader(gl: THREE.WebGLRenderer, pm: THREE.PMREMGenerator): void {
  const prev = gl.getRenderTarget();
  const rt = new THREE.WebGLRenderTarget(1, 1);
  try {
    gl.setRenderTarget(rt);
    pm.compileCubemapShader();
  } finally {
    gl.setRenderTarget(prev);
    rt.dispose();
  }
}

/** One-time capture of the real gallery, from the middle of `room`, into a PMREM of the same size. */
export function captureProbe(
  gl: THREE.WebGLRenderer,
  pm: THREE.PMREMGenerator,
  scene: THREE.Scene,
  layout: GalleryLayout,
  room = 0
): THREE.WebGLRenderTarget {
  const cubeRT = new THREE.WebGLCubeRenderTarget(ENV_SIZE, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
  });
  const cam = new THREE.CubeCamera(0.05, Math.max(60, layout.hallLength * 2), cubeRT);
  cam.position.set(0, PROBE_Y, probeZ(layout, room));
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
