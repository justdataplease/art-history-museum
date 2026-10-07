// One-time patches to three's built-in shader chunks. Import this module
// (for its side effect) before the first WebGL program is compiled.
//
// Spot cones: three's lights_fragment_begin evaluates the full BRDF
// (RE_Direct) for every light in every fragment, even when getSpotLightInfo
// has already decided the fragment lies outside the cone or beyond the light's
// distance (directLight.visible === false). The gallery has one narrow spot
// per painting, so most fragments are lit by 0-2 of ~12 spots; skipping the
// invisible ones cut main-pass GPU time by ~16 % in measurements (more on
// ALU-bound integrated GPUs). The point/directional loops get the same guard,
// which is a no-op for them (their lights are always "visible").
//
// The inserted `}` is never directly followed by `#pragma unroll_loop_end`,
// so three's loop unroller still matches the outer loop body.

import * as THREE from "three";

const CALL =
  "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
const GUARDED = `if ( directLight.visible ) { ${CALL} }`;

function patch(): void {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  // Idempotent: Fast Refresh may evaluate this module more than once.
  if (typeof chunk !== "string" || chunk.includes(GUARDED) || !chunk.includes(CALL)) return;
  THREE.ShaderChunk.lights_fragment_begin = chunk.split(CALL).join(GUARDED);
}

patch();
