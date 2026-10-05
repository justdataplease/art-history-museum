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
uniform vec3 uRoomHalf;  // (hallWidth/2, wallHeight, hallLength/2)
uniform vec3 uRoomAO;    // (strength, radius m, share applied to direct light)
varying vec3 vRoomPos;
varying vec3 vRoomNrm;
float roomEdge(float d) {
  return 1.0 - uRoomAO.x * exp(-max(d, 0.0) / uRoomAO.y);
}
float roomAO(vec3 p, vec3 n) {
  vec3 an = abs(n);
  float ax = roomEdge(uRoomHalf.x - abs(p.x));
  float ay = roomEdge(p.y) * roomEdge(uRoomHalf.y - p.y);
  float az = roomEdge(uRoomHalf.z - abs(p.z));
  return mix(ax, 1.0, an.x) * mix(ay, 1.0, an.y) * mix(az, 1.0, an.z);
}
`;

export const ROOM_AO_APPLY = /* glsl */ `
{
  float rAO = roomAO(vRoomPos, normalize(vRoomNrm));
  reflectedLight.indirectDiffuse *= rAO;
  reflectedLight.indirectSpecular *= mix(1.0, rAO, 0.6);
  reflectedLight.directDiffuse *= mix(1.0, rAO, uRoomAO.z);
  reflectedLight.directSpecular *= mix(1.0, rAO, uRoomAO.z);
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
