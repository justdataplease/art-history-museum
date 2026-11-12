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
//
// Real loops: three writes each light's code out once per light (its
// "unrolled" loops), so a lit program with 16 spots and 4 area lights is a
// very long shader. On Windows every browser compiles shaders through
// Direct3D's compiler, which takes 0.5-0.9 s for each such program; Chrome
// does that on other threads, Firefox on the page's own, one program after
// another: a gallery's 35 lit programs froze the page for 21 s before its
// doors opened (measured, 2026-11-12). With the spot and area lights as loops
// the same programs take a third of that, and a frame costs the graphics card
// about 13 % less. Only on Windows (where it was measured), and only for
// programs without spot shadows or spot light maps, whose samplers three
// addresses by the unrolled index (the gallery has neither).

import * as THREE from "three";

const CALL =
  "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
const GUARDED = `if ( directLight.visible ) { ${CALL} }`;

const AREA_CALL =
  "RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";

/** three's unrolled loop over one kind of light (its pragmas included). */
const unrolled = (count: string) =>
  new RegExp(`#pragma unroll_loop_start\\s+for \\( int i = 0; i < ${count}; i \\+\\+ \\) \\{[\\s\\S]+?#pragma unroll_loop_end`);

const SPOT_LOOP = `// museum: spot lights in a loop
	#if ( NUM_SPOT_LIGHT_SHADOWS > 0 ) || ( NUM_SPOT_LIGHT_MAPS > 0 )
	$&
	#else
	for ( int l = 0; l < NUM_SPOT_LIGHTS; l ++ ) {

		spotLight = spotLights[ l ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		${GUARDED}

	}
	#endif`;

// (a dark area light, one of the pool that is faded out, is not evaluated)
const AREA_LOOP = `// museum: area lights in a loop
	for ( int l = 0; l < NUM_RECT_AREA_LIGHTS; l ++ ) {

		rectAreaLight = rectAreaLights[ l ];
		if ( rectAreaLight.color.r + rectAreaLight.color.g + rectAreaLight.color.b > 0.0 ) {
			${AREA_CALL}
		}

	}`;

/** Shaders go through Direct3D's compiler here (any browser on Windows). */
function direct3D(): boolean {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent ?? "");
}

function patch(): void {
  let chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (typeof chunk !== "string") return;
  // Idempotent: Fast Refresh may evaluate this module more than once.
  if (!chunk.includes(GUARDED) && chunk.includes(CALL)) chunk = chunk.split(CALL).join(GUARDED);
  if (direct3D() && !chunk.includes("// museum: spot lights in a loop")) {
    const spot = unrolled("NUM_SPOT_LIGHTS");
    const area = unrolled("NUM_RECT_AREA_LIGHTS");
    // (only if both are as expected: a three.js that words them differently keeps its own loops)
    if (spot.test(chunk) && area.test(chunk) && chunk.includes(AREA_CALL)) {
      chunk = chunk.replace(spot, SPOT_LOOP).replace(area, AREA_LOOP);
    }
  }
  THREE.ShaderChunk.lights_fragment_begin = chunk;
}

patch();
