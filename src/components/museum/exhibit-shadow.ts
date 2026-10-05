// Analytic soft shadows on the wall — no shadow maps.
//
// One quad per exhibit, lying on the wall behind the frame and placard. The
// fragment shader treats the frame (and the label card) as a rectangle held
// `depth` metres off the wall and projects it away from the spotlight onto
// the wall plane: the drop shadow lands below the frame by depth × (rise /
// throw) and spreads at the corners, with a penumbra that widens with the
// distance from the occluder's edge. A tight contact term darkens the wall
// right where the moulding meets it, and a faint wide halo stands in for the
// ambient occlusion of a heavy frame.
//
// Blending is multiplicative (dst × src), so the wall is darkened and tinted
// slightly cool (shadow is lit by the bluish fill rather than the warm spot).

import * as THREE from "three";

export interface ShadowRect {
  /** Centre on the wall plane (exhibit-local x, y). */
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  /** Height of the occluding edge above the wall (m). */
  depth: number;
}

const vert = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
varying vec2 vP;
uniform vec3 uLight;      // light position: x, y on the wall plane, z = distance off the wall
uniform vec4 uFrame;      // cx, cy, hw, hh
uniform float uFrameDepth;
uniform vec4 uCard;
uniform float uCardDepth;
uniform float uCast;      // cast-shadow strength (follows the spot intensity)
uniform float uContact;   // contact / ambient-occlusion strength
uniform vec3 uTint;

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Darkening (0..1) from one rectangular occluder.
float occluder(vec4 r, float depth, float castK, float contactK, float haloK) {
  float sdIn = sdBox(vP - r.xy, r.zw);
  if (sdIn < 0.0) return 0.0;                       // under the object itself
  float f = uLight.z / max(uLight.z - depth, 1e-3); // projection scale
  vec2 c = uLight.xy + (r.xy - uLight.xy) * f;
  float sdCast = sdBox(vP - c, r.zw * f);
  float pen = 0.003 + 0.24 * sdIn;                 // penumbra grows away from the edge
  float drop = 1.0 - smoothstep(-pen, pen, sdCast);
  float contact = exp(-sdIn / (0.0035 + 0.06 * depth));
  float halo = exp(-sdIn / (0.02 + 0.5 * depth));
  float a = 1.0 - (1.0 - drop * castK) * (1.0 - contact * contactK) * (1.0 - halo * haloK);
  return a;
}

void main() {
  float a = occluder(uFrame, uFrameDepth, uCast, 0.55 * uContact, 0.12 * uContact);
  float b = occluder(uCard, uCardDepth, uCast * 0.8, 0.35 * uContact, 0.05 * uContact);
  float dark = 1.0 - (1.0 - a) * (1.0 - b);
  if (dark < 0.002) discard;
  gl_FragColor = vec4(mix(vec3(1.0), uTint, dark), 1.0);
}`;

export function createShadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uLight: { value: new THREE.Vector3(0, 2.5, 1.9) },
      uFrame: { value: new THREE.Vector4(0, 0, 0.5, 0.5) },
      uFrameDepth: { value: 0.07 },
      uCard: { value: new THREE.Vector4(10, 10, 0.1, 0.05) },
      uCardDepth: { value: 0.006 },
      uCast: { value: 0.6 },
      uContact: { value: 1 },
      uTint: { value: new THREE.Color(0.24, 0.25, 0.29) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
    fog: false,
  });
}

/** Wall-plane quad (exhibit-local) that covers both shadows with margin. */
export function shadowQuad(frame: ShadowRect, card: ShadowRect, lightDrop: number): THREE.PlaneGeometry {
  const m = 0.12;
  const x0 = Math.min(frame.cx - frame.hw, card.cx - card.hw) - m;
  const x1 = Math.max(frame.cx + frame.hw, card.cx + card.hw) + m;
  const y0 = Math.min(frame.cy - frame.hh, card.cy - card.hh) - m - lightDrop;
  const y1 = Math.max(frame.cy + frame.hh, card.cy + card.hh) + m;
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
  return g;
}
