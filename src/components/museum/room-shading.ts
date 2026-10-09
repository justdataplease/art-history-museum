// Shader patches for the room's surfaces (walls, ceiling, trim, floor).
//
// Analytic ambient occlusion: the hall is a box, so the occlusion a point
// receives from the planes that meet it (floor/wall, wall/ceiling, corners)
// can be computed exactly enough from its world position — no SSAO pass, no
// baked maps, no extra texture units. A surface ignores its own plane via its
// normal. AO darkens mostly the indirect light (env/probe) and a little of the
// direct light, standing in for the missing inter-reflection in corners.
//
// World-space mottle: a cheap 3D value noise breaks up any texture repeat over
// metres-scale distances, so no tile can be spotted on a 28 m wall.

import * as THREE from "three";
import type { GalleryLayout } from "./layout";

export const ROOM_NOISE_GLSL = /* glsl */ `
float roomHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float roomNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(roomHash(i + vec3(0, 0, 0)), roomHash(i + vec3(1, 0, 0)), f.x),
        mix(roomHash(i + vec3(0, 1, 0)), roomHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(roomHash(i + vec3(0, 0, 1)), roomHash(i + vec3(1, 0, 1)), f.x),
        mix(roomHash(i + vec3(0, 1, 1)), roomHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float roomHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

export const ROOM_AO_PARS = /* glsl */ `
uniform vec3 uRoomHalf;  // (widest room's half width, wallHeight, hallLength/2)
uniform vec3 uRoomAO;    // (strength, radius m, share applied to direct light)
uniform vec4 uCross;     // the suite's cross walls nearest the visitor: centre planes (far away when absent)
uniform vec3 uDoor;      // their doorways: half width, height; the walls' half depth
uniform vec4 uDoorX;     // each doorway's centre (x)
uniform vec4 uHalfA;     // half the width of the room before the first of those walls, and after the next three
uniform vec2 uHalfB;     // (x) after the fourth
uniform vec4 uNook;      // the films' corner's floor: x0, x1 (the back of its wall), z0 (its open end), z1
uniform vec4 uNookK;     // how much of the room's light reaches into it: direct, indirect; its wall's top (y)
uniform vec4 uNookS;     // the centre of its screen (x, y, z)
uniform vec3 uNookGlow;  // the light the picture throws
varying vec3 vRoomPos;
varying vec3 vRoomNrm;
float roomEdge(float d) {
  return 1.0 - uRoomAO.x * exp(-max(d, 0.0) / uRoomAO.y);
}
// half the width of the room at depth z (rooms differ)
float roomHalfX(float z) {
  return z > uCross.x ? uHalfA.x : z > uCross.y ? uHalfA.y : z > uCross.z ? uHalfA.z : z > uCross.w ? uHalfA.w : uHalfB.x;
}
// distance to the solid part of the cross wall centred on plane c (the
// doorway opening, centred on x = cx, excepted; nothing from within the wall's own depth)
float roomCrossDist(float c, float cx, vec3 p) {
  float dz = abs(p.z - c) - uDoor.z;
  if (dz < 0.0) return 1e4;
  float dx = p.y < uDoor.y ? max(0.0, uDoor.x - abs(p.x - cx)) : 0.0;
  return length(vec2(dz, dx));
}
// how far into the films' corner (0 outside it): behind its wall, below the wall's top, in from its open end
float roomNook(vec3 p) {
  float behind = 1.0 - smoothstep(uNook.y - 0.02, uNook.y + 0.06, p.x);
  float within = smoothstep(uNook.z - 0.8, uNook.z + 1.6, p.z) * step(p.z, uNook.w + 0.3) * step(uNook.x - 0.3, p.x);
  float below = 1.0 - smoothstep(uNookK.z, uNookK.z + 0.9, p.y);
  return behind * within * below;
}
// distance to the nearest cross-wall face
float roomCrossFace(vec3 p) {
  return min(min(abs(p.z - uCross.x), abs(p.z - uCross.y)), min(abs(p.z - uCross.z), abs(p.z - uCross.w))) - uDoor.z;
}
float roomAO(vec3 p, vec3 n) {
  vec3 an = abs(n);
  float ax = roomEdge(roomHalfX(p.z) - abs(p.x));
  float ay = roomEdge(p.y) * roomEdge(uRoomHalf.y - p.y);
  float az = roomEdge(uRoomHalf.z - abs(p.z))
    * roomEdge(roomCrossDist(uCross.x, uDoorX.x, p))
    * roomEdge(roomCrossDist(uCross.y, uDoorX.y, p))
    * roomEdge(roomCrossDist(uCross.z, uDoorX.z, p))
    * roomEdge(roomCrossDist(uCross.w, uDoorX.w, p));
  return mix(ax, 1.0, an.x) * mix(ay, 1.0, an.y) * mix(az, 1.0, an.z);
}
`;

/**
 * Where the suite's cross walls stand, how wide its rooms are, and the films' corner, for ROOM_AO_PARS. The
 * same vectors are shared by every room material, so moving the window of four walls nearest the visitor
 * (setCrossWindow) updates them all at once; a single room keeps the walls far away. The films' corner's light
 * (nookK, nookGlow) changes with the film.
 */
export interface CrossWalls {
  cross: THREE.Vector4;
  door: THREE.Vector3;
  doorX: THREE.Vector4;
  halfA: THREE.Vector4;
  halfB: THREE.Vector2;
  nook: THREE.Vector4;
  nookK: THREE.Vector4;
  nookS: THREE.Vector4;
  nookGlow: THREE.Color;
}

const FAR_AWAY = 1e4;

/** Cross walls (doorways) the AO window holds at once. */
export const CROSS_SLOTS = 4;

/** How much of the room's light reaches behind the films' wall, direct and indirect, before a film dims it. */
export const NOOK_LIGHT: [number, number] = [0.18, 0.5];

type ShadedLayout = Pick<GalleryLayout, "doorways" | "rooms" | "hallWidth" | "nook">;

/** A room with no cross walls and no films' corner (any width: its AO from the box alone). */
const NO_WALLS: ShadedLayout = { doorways: [], rooms: [], hallWidth: 2 * FAR_AWAY, nook: null };

/** The shared vectors for a layout, holding its first CROSS_SLOTS cross walls. */
export function crossWalls(layout: ShadedLayout): CrossWalls {
  const d0 = layout.doorways[0];
  const n = layout.nook;
  const cw: CrossWalls = {
    cross: new THREE.Vector4(FAR_AWAY, FAR_AWAY, FAR_AWAY, FAR_AWAY),
    door: new THREE.Vector3(d0?.halfWidth ?? 0, d0?.height ?? 0, d0 ? d0.thickness / 2 : 0),
    doorX: new THREE.Vector4(),
    halfA: new THREE.Vector4(),
    halfB: new THREE.Vector2(),
    nook: n ? new THREE.Vector4(n.x0, n.x1, n.z0, n.z1) : new THREE.Vector4(FAR_AWAY, FAR_AWAY, FAR_AWAY, FAR_AWAY),
    nookK: new THREE.Vector4(NOOK_LIGHT[0], NOOK_LIGHT[1], n?.wall.height ?? 0, 0),
    nookS: n ? new THREE.Vector4(n.screen.cx, n.screen.bottom + n.screen.h / 2, n.screen.z, 0) : new THREE.Vector4(),
    nookGlow: new THREE.Color(0, 0, 0),
  };
  setCrossWindow(cw, layout, 0);
  return cw;
}

/** One set of shared vectors per layout: the room's materials, its floor and the films' corner's things. */
const shared = new WeakMap<object, CrossWalls>();
export function roomCross(layout: ShadedLayout): CrossWalls {
  let cw = shared.get(layout);
  if (!cw) shared.set(layout, (cw = crossWalls(layout)));
  return cw;
}

/** The shader uniforms over a set of shared vectors (by reference: they move together). */
export function crossUniforms(cw: CrossWalls): Record<string, THREE.IUniform> {
  return {
    uCross: { value: cw.cross },
    uDoor: { value: cw.door },
    uDoorX: { value: cw.doorX },
    uHalfA: { value: cw.halfA },
    uHalfB: { value: cw.halfB },
    uNook: { value: cw.nook },
    uNookK: { value: cw.nookK },
    uNookS: { value: cw.nookS },
    uNookGlow: { value: cw.nookGlow },
  };
}

/** Point the AO at the cross walls first..first+CROSS_SLOTS-1 (far away past the end), and at the widths of
 *  the rooms between them. A room outside the window takes the widest beyond it: an AO a little light there,
 *  never a dark band. */
export function setCrossWindow(cw: CrossWalls, layout: ShadedLayout, first: number): void {
  const z = (i: number) => layout.doorways[first + i]?.z ?? FAR_AWAY;
  const x = (i: number) => layout.doorways[first + i]?.x ?? 0;
  cw.cross.set(z(0), z(1), z(2), z(3));
  cw.doorX.set(x(0), x(1), x(2), x(3));
  const rooms = layout.rooms;
  const last = rooms.length - 1;
  const widest = (lo: number, hi: number) => {
    let m = 0;
    for (let i = Math.max(0, lo); i <= Math.min(last, hi); i++) m = Math.max(m, rooms[i].halfWidth);
    return m || layout.hallWidth / 2;
  };
  // before the window's first wall: that room and any before it; after its last: every room on
  const h = (i: number) => {
    const r = Math.min(first + i, last);
    if (i === 0) return widest(0, r);
    if (i === CROSS_SLOTS || r === last) return widest(r, last);
    return widest(r, r);
  };
  cw.halfA.set(h(0), h(1), h(2), h(3));
  cw.halfB.set(h(4), 0);
}

export const ROOM_AO_APPLY = /* glsl */ `
{
  float rAO = roomAO(vRoomPos, normalize(vRoomNrm));
  reflectedLight.indirectDiffuse *= rAO;
  reflectedLight.indirectSpecular *= mix(1.0, rAO, 0.6);
  reflectedLight.directDiffuse *= mix(1.0, rAO, uRoomAO.z);
  reflectedLight.directSpecular *= mix(1.0, rAO, uRoomAO.z);
  // behind the films' wall: the room's light reaches in dimly, and the picture lights what faces it
  float nk = roomNook(vRoomPos);
  if (nk > 0.0) {
    float kd = mix(1.0, uNookK.x, nk);
    float ki = mix(1.0, uNookK.y, nk);
    reflectedLight.directDiffuse *= kd;
    reflectedLight.directSpecular *= kd;
    reflectedLight.indirectDiffuse *= ki;
    reflectedLight.indirectSpecular *= ki;
    vec3 toS = uNookS.xyz - vRoomPos;
    float d2 = max(dot(toS, toS), 1e-4);
    float lam = max(0.0, dot(normalize(vRoomNrm), toS * inversesqrt(d2)));
    float front = smoothstep(0.0, 0.25, toS.z);
    reflectedLight.directDiffuse += diffuseColor.rgb * uNookGlow * (nk * lam * front / (1.0 + d2 * 0.3));
  }
}
`;

const VERT_PARS = /* glsl */ `
varying vec3 vRoomPos;
varying vec3 vRoomNrm;
`;
const VERT_APPLY = /* glsl */ `
vRoomPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vRoomNrm = normalize(mat3(modelMatrix) * objectNormal);
`;

export interface RoomPatchOptions {
  /** Unique key per shader variant (three caches programs by it). */
  key: string;
  roomHalf: THREE.Vector3;
  /** A suite's cross walls (see crossWalls); none when omitted. */
  cross?: CrossWalls;
  /** strength, radius (m), share of direct light affected */
  ao: [number, number, number];
  /** Albedo mottle amplitude (0 = off). */
  mottle?: number;
  /** World-space mottle frequency (1/m). */
  mottleScale?: number;
  /** Shadow-gap reveals at the foot / head of the wall (heights in m; 0 = none). */
  shadowGap?: { bottom: number; top: number };
  /** Extra GLSL injected after map_fragment (diffuseColor is in scope). */
  extraColor?: string;
  /** GLSL that REPLACES map_fragment (e.g. world-space projected grain). */
  replaceMap?: string;
  /** Extra GLSL injected after the lights, before AO (reflectedLight in scope). */
  extraDirect?: string;
  /** Extra GLSL injected after the AO step (reflectedLight is in scope). */
  extraLight?: string;
  extraUniforms?: Record<string, THREE.IUniform>;
  extraPars?: string;
}

/**
 * Patch a MeshStandardMaterial with analytic room AO (+ optional mottle and
 * shadow gaps). Uniforms are per material; programs are shared between
 * materials with the same `key`.
 */
export function patchRoomMaterial<T extends THREE.MeshStandardMaterial>(
  mat: T,
  opts: RoomPatchOptions
): T {
  const uniforms: Record<string, THREE.IUniform> = {
    uRoomHalf: { value: opts.roomHalf.clone() },
    uRoomAO: { value: new THREE.Vector3(...opts.ao) },
    // shared by reference: the window of cross walls moves for all materials
    ...crossUniforms(opts.cross ?? crossWalls({ ...NO_WALLS, hallWidth: 2 * opts.roomHalf.x })),
    uMottle: { value: new THREE.Vector2(opts.mottle ?? 0, opts.mottleScale ?? 0.45) },
    uShadowGap: {
      value: new THREE.Vector2(opts.shadowGap?.bottom ?? 0, opts.shadowGap?.top ?? 0),
    },
    ...(opts.extraUniforms ?? {}),
  };
  const useMottle = (opts.mottle ?? 0) > 0;
  const useGap = !!opts.shadowGap;
  mat.userData.roomUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_PARS}`)
      .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>\n${VERT_APPLY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
${ROOM_NOISE_GLSL}
${ROOM_AO_PARS}
uniform vec2 uMottle;
uniform vec2 uShadowGap;
${opts.extraPars ?? ""}`
      )
      .replace(
        "#include <map_fragment>",
        `${opts.replaceMap ?? "#include <map_fragment>"}
${
  useMottle
    ? `{
  vec3 mp = vRoomPos * uMottle.y;
  float mot = roomNoise(mp) * 0.6 + roomNoise(mp * 3.1 + 7.3) * 0.4;
  diffuseColor.rgb *= 1.0 + uMottle.x * (mot - 0.5) * 2.0;
}`
    : ""
}
${
  useGap
    ? `{
  float gw = fwidth(vRoomPos.y) * 0.75;
  float gapB = 1.0 - smoothstep(uShadowGap.x - gw, uShadowGap.x + gw, vRoomPos.y);
  float gapT = uShadowGap.y > 0.0
    ? smoothstep(uRoomHalf.y - uShadowGap.y - gw, uRoomHalf.y - uShadowGap.y + gw, vRoomPos.y)
    : 0.0;
  diffuseColor.rgb *= 1.0 - 0.93 * max(gapB, gapT);
}`
    : ""
}
${opts.extraColor ?? ""}`
      )
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
${opts.extraDirect ?? ""}
${ROOM_AO_APPLY}
${opts.extraLight ?? ""}`
      );
  };
  mat.customProgramCacheKey = () => `room:${opts.key}:${useMottle ? 1 : 0}${useGap ? 1 : 0}`;
  mat.needsUpdate = true;
  return mat;
}
