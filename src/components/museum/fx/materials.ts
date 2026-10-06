// Shader side of the overlay.
//
// Paintings: the canvas's own material samples the work's overlay (colour +
// material textures, see surface.ts) in its existing draw — no extra draw
// call, the source image untouched. Paint is composited over the map
// (white-balanced like the painting), thickness becomes relief (a bump from
// the height channel, physically scaled through the uv → surface tangent
// frame), and paint swaps the aged varnish for its own response: a wet
// gloss that settles to a semi-gloss. Egg white is a clear film: it darkens
// and deepens what it wets and adds gloss. A tear shows the shadowed cavity
// behind the canvas.
//
// Other surfaces: one merged decal mesh with a MeshStandardMaterial
// (transparent, polygon-offset) patched the same way over an atlas.
//
// The conservator dissolves everything through a soft noise threshold with
// a thin glint of solvent at the front: per canvas through its own uniform,
// on the decal mesh per decal (a per-vertex sequence key against one clock).

import * as THREE from "three";
import { THICK_M } from "./surface";

export interface OverlayUniforms {
  uOvlCol: { value: THREE.Texture };
  uOvlMat: { value: THREE.Texture };
  uOvlOn: { value: number };
  uOvlTexel: { value: THREE.Vector2 };
  /** canvases: 1 = shown … 0 = dissolved */
  uOvlFade: { value: number };
  /** decals: the conservator's clock (s, < 0 = not running) and each decal's dissolve time */
  uOvlSeqT: { value: number };
  uOvlSeqDur: { value: number };
}

let blankCol: THREE.DataTexture | null = null;
let blankMat: THREE.DataTexture | null = null;
/** 1×1 transparent stand-ins for canvases nobody has hit yet. */
export function blankOverlay(): { col: THREE.DataTexture; mat: THREE.DataTexture } {
  if (!blankCol || !blankMat) {
    blankCol = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    blankCol.colorSpace = THREE.SRGBColorSpace;
    blankCol.needsUpdate = true;
    blankMat = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    blankMat.needsUpdate = true;
  }
  return { col: blankCol, mat: blankMat };
}

export function createOverlayUniforms(): OverlayUniforms {
  const b = blankOverlay();
  return {
    uOvlCol: { value: b.col },
    uOvlMat: { value: b.mat },
    uOvlOn: { value: 0 },
    uOvlTexel: { value: new THREE.Vector2(1, 1) },
    uOvlFade: { value: 1 },
    uOvlSeqT: { value: -1 },
    uOvlSeqDur: { value: 1 },
  };
}

// ------------------------------------------------------------------ GLSL

const pars = (fade: string) => /* glsl */ `
uniform sampler2D uOvlCol;
uniform sampler2D uOvlMat;
uniform float uOvlOn;
uniform vec2 uOvlTexel;
uniform float uOvlFade;
uniform float uOvlSeqT;
uniform float uOvlSeqDur;
varying vec2 vOvlUv;
varying float vOvlSeq;
vec4 ovlC = vec4( 0.0 );
vec4 ovlM = vec4( 0.0 );
float ovlMask = 0.0;
float ovlKeep = 1.0;
float ovlWet = 0.0;
float ovlHole = 0.0;
float ovlFront = 0.0;
float ovlCav = 0.0;

float ovlHash( vec2 p ) {
	p = fract( p * vec2( 123.34, 456.21 ) );
	p += dot( p, p + 45.32 );
	return fract( p.x * p.y );
}
float ovlNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	float a = ovlHash( i );
	float b = ovlHash( i + vec2( 1.0, 0.0 ) );
	float c = ovlHash( i + vec2( 0.0, 1.0 ) );
	float d = ovlHash( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
float ovlFadeNow() {
	${fade}
}
// the conservator's solvent: paint lifts in soft patches, not as a uniform fade
float ovlDissolve( vec2 uv, float fade ) {
	if ( fade >= 1.0 ) return 1.0;
	float n = 0.6 * ovlNoise( uv / ( 40.0 * uOvlTexel ) ) + 0.3 * ovlNoise( uv / ( 11.0 * uOvlTexel ) ) + 0.1 * ovlNoise( uv / ( 3.0 * uOvlTexel ) );
	return clamp( ( fade * 1.3 - n ) / 0.16, 0.0, 1.0 );
}
float ovlH( vec2 uv ) {
	return texture2D( uOvlMat, uv ).r * ${THICK_M.toFixed(5)} * ovlKeep;
}
// Height field → perturbed normal. The uv → surface tangent frame comes from
// screen derivatives (exact on planar pieces), so the relief has true
// physical slope whatever the overlay's resolution; central differences use
// at least the screen footprint, so distant paint does not sparkle.
vec3 ovlBump( vec3 N, vec3 pos, vec2 uv ) {
	vec3 q0 = dFdx( pos );
	vec3 q1 = dFdy( pos );
	vec2 st0 = dFdx( uv );
	vec2 st1 = dFdy( uv );
	float det = st0.x * st1.y - st0.y * st1.x;
	if ( abs( det ) < 1e-14 ) return N;
	vec3 T = ( q0 * st1.y - q1 * st0.y ) / det;
	vec3 B = ( q1 * st0.x - q0 * st1.x ) / det;
	vec2 e = max( uOvlTexel, max( abs( st0 ), abs( st1 ) ) );
	float hu = ( ovlH( uv + vec2( e.x, 0.0 ) ) - ovlH( uv - vec2( e.x, 0.0 ) ) ) / ( 2.0 * e.x );
	float hv = ( ovlH( uv + vec2( 0.0, e.y ) ) - ovlH( uv - vec2( 0.0, e.y ) ) ) / ( 2.0 * e.y );
	vec3 g = hu * T / max( dot( T, T ), 1e-12 ) + hv * B / max( dot( B, B ), 1e-12 );
	return normalize( N - g );
}
// what shows through a tear: the shadowed cavity behind the canvas, a touch
// lighter toward the torn edge
vec3 ovlGap( float h ) {
	return mix( vec3( 0.03, 0.025, 0.02 ), vec3( 0.008, 0.0065, 0.0055 ), smoothstep( 0.4, 1.0, h ) );
}
`;

const SAMPLE = /* glsl */ `
	if ( uOvlOn > 0.5 ) {
		float ovlF = ovlFadeNow();
		ovlKeep = ovlDissolve( vOvlUv, ovlF );
		ovlFront = ovlF < 1.0 ? ovlKeep * ( 1.0 - ovlKeep ) * 4.0 : 0.0;
		ovlC = texture2D( uOvlCol, vOvlUv );
		ovlM = texture2D( uOvlMat, vOvlUv );
		ovlFront *= max( ovlC.a, max( ovlM.b, ovlM.a ) );
		ovlC.a *= ovlKeep;
		ovlM.gb *= ovlKeep;
		ovlMask = clamp( max( ovlC.a, ovlM.b ) * 1.15, 0.0, 1.0 );
		ovlWet = max( smoothstep( 0.0, 0.85, max( ovlM.g, ovlM.b ) ), ovlFront );
		ovlHole = smoothstep( 0.2, 0.75, ovlM.a ) * ovlKeep;
		// relief cavity: hollows in the paint sit a little darker, crests a touch lighter
		vec2 cx = vec2( uOvlTexel.x * 2.0, 0.0 );
		vec2 cy = vec2( 0.0, uOvlTexel.y * 2.0 );
		float hn = texture2D( uOvlMat, vOvlUv + cx ).r + texture2D( uOvlMat, vOvlUv - cx ).r + texture2D( uOvlMat, vOvlUv + cy ).r + texture2D( uOvlMat, vOvlUv - cy ).r;
		ovlCav = clamp( ( ovlM.r * 4.0 - hn ) * 5.0, -1.0, 1.0 ) * ovlKeep;
	}
`;

/** Roughness: wet gloss settling to a semi-gloss; egg white stays slick. */
const ROUGH = /* glsl */ `
	{
		float ovlR = mix( 0.4, 0.07, ovlWet );
		ovlR = mix( ovlR, 0.05, ovlM.b * 0.9 );
		roughnessFactor = mix( roughnessFactor, ovlR, max( ovlMask, ovlFront ) );
	}
`;

const NORMAL = /* glsl */ `
	if ( uOvlOn > 0.5 ) {
		// thick paint fills the canvas weave
		normal = normalize( mix( normal, nonPerturbedNormal, smoothstep( 0.0, 0.1, ovlM.r * ovlKeep ) * ovlC.a ) );
		normal = ovlBump( normal, - vViewPosition, vOvlUv );
	}
`;

const SPECULAR = /* glsl */ `
	// fresh paint and egg white: a clean dielectric (F0 ≈ 0.04), not aged varnish
	{
		float ovlS = max( ovlMask, ovlFront );
		vec3 ovlF0 = vec3( mix( 0.028, 0.045, ovlWet ) );
		material.specularColor = mix( material.specularColor, ovlF0, ovlS );
		material.specularColorBlended = mix( material.specularColorBlended, ovlF0, ovlS );
		material.specularF90 = mix( material.specularF90, 1.0, ovlS );
	}
`;

/** Diffuse: paint over the map, egg white wetting it. */
const DIFFUSE = /* glsl */ `
	{
		// a wet film deepens what it covers: darker, a little richer
		float film = ovlM.b * ( 1.0 - ovlC.a );
		vec3 base = diffuseColor.rgb;
		float l = dot( base, vec3( 0.2126, 0.7152, 0.0722 ) );
		base = mix( vec3( l ), base, 1.0 + 0.25 * film ) * ( 1.0 - 0.13 * film );
		// wet paint reads a shade deeper than dry
		vec3 paint = ovlC.rgb * diffuse * ( 1.0 - 0.07 * ovlWet ) * ( 1.0 + ( ovlCav > 0.0 ? 0.08 : 0.2 ) * ovlCav );
		diffuseColor.rgb = mix( base, paint, ovlC.a );
	}
`;

function patchVertex(vs: string, uvExpr: string, seq: string): string {
  return vs
    .replace("#include <common>", "#include <common>\nvarying vec2 vOvlUv;\nvarying float vOvlSeq;\n" + (seq ? "attribute float aOvlSeq;" : ""))
    .replace("#include <uv_vertex>", `#include <uv_vertex>\n\tvOvlUv = ${uvExpr};\n\tvOvlSeq = ${seq || "0.0"};`);
}

// ------------------------------------------------------------- canvases

export const CANVAS_PATCH_KEY = "ovl-canvas-3";

/**
 * Install the overlay on a canvas material (idempotent). Chains any existing
 * onBeforeCompile; the first canvas to switch compiles one new program that
 * every other canvas then shares.
 */
export function patchCanvasMaterial(m: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial): OverlayUniforms {
  const ud = m.userData as { ovl?: OverlayUniforms };
  if (ud.ovl) return ud.ovl;
  const u = createOverlayUniforms();
  ud.ovl = u;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    // canvas uv: v = 0 at the bottom; overlay rows run top-down
    sh.vertexShader = patchVertex(sh.vertexShader, "vec2( uv.x, 1.0 - uv.y )", "");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${pars("return uOvlFade;")}`)
      .replace("#include <map_fragment>", `${SAMPLE}\n#include <map_fragment>\n${DIFFUSE}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${ROUGH}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${NORMAL}`)
      .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>\n${SPECULAR}`)
      .replace("#include <opaque_fragment>", "outgoingLight = mix( outgoingLight, ovlGap( ovlM.a ), ovlHole );\n#include <opaque_fragment>");
  };
  m.customProgramCacheKey = () => `${prevKey()}|${CANVAS_PATCH_KEY}`;
  m.needsUpdate = true;
  return u;
}

/** Put a canvas back to "nothing on it" (its program stays: no recompile). */
export function unbindCanvas(u: OverlayUniforms): void {
  const b = blankOverlay();
  u.uOvlCol.value = b.col;
  u.uOvlMat.value = b.mat;
  u.uOvlOn.value = 0;
  u.uOvlFade.value = 1;
}

// --------------------------------------------------------------- decals

/**
 * Decals: the atlas colour is the map (alpha = coverage). A clear film (egg
 * white) still needs to read as a wet, glossy darkening of the wall, so the
 * output alpha is lifted where there is film and the colour pulled dark.
 */
export function createDecalMaterial(col: THREE.Texture, mat: THREE.Texture, texel: THREE.Vector2): {
  material: THREE.MeshStandardMaterial;
  uniforms: OverlayUniforms;
} {
  const u = createOverlayUniforms();
  u.uOvlCol.value = col;
  u.uOvlMat.value = mat;
  u.uOvlOn.value = 1;
  u.uOvlTexel.value = texel;
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    // premultiplied: diffuse is weighted by coverage, reflections by the film
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  m.name = "fx-decals";
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = patchVertex(sh.vertexShader, "uv", "aOvlSeq");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${pars("return uOvlSeqT < 0.0 ? 1.0 : 1.0 - smoothstep( vOvlSeq, vOvlSeq + uOvlSeqDur, uOvlSeqT );")}`,
      )
      .replace(
        "#include <map_fragment>",
        `${SAMPLE}
	float ovlSpecA = max( max( ovlC.a, ovlM.b ), max( ovlHole, ovlFront * 0.5 ) );
	{
		// a clear film (egg white) darkens the wall a little, like any wet patch
		float film = ovlM.b;
		float a = max( max( ovlC.a, film * 0.2 ), ovlHole );
		vec3 c = mix( vec3( 0.0 ), ovlC.rgb, ovlC.a / max( a, 1e-4 ) );
		diffuseColor = vec4( c * diffuse * ( 1.0 - 0.07 * ovlWet ) * ( 1.0 + ( ovlCav > 0.0 ? 0.08 : 0.2 ) * ovlCav ), a * opacity );
	}`,
      )
      .replace(
        "#include <opaque_fragment>",
        "gl_FragColor = vec4( totalDiffuse * diffuseColor.a + totalSpecular * ovlSpecA + totalEmissiveRadiance, diffuseColor.a );\n" +
          "gl_FragColor = mix( gl_FragColor, vec4( ovlGap( ovlM.a ), 1.0 ), ovlHole );",
      )
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${ROUGH}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${NORMAL}`);
  };
  m.customProgramCacheKey = () => "ovl-decal-3";
  return { material: m, uniforms: u };
}
