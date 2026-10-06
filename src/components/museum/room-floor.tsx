"use client";

// The gallery floor: a fork of drei's MeshReflectorMaterial (10.7.7).
//
// drei multiplies the planar reflection into the albedo (tinted brown, lit a
// second time, no Fresnel) and samples its roughness mask with the raw vUv.
// Here the reflection instead REPLACES the environment radiance that feeds
// three's own split-sum specular (RE_IndirectSpecular), so it gets the right
// dielectric Fresnel and roughness response for free: ~4 % underfoot, a
// strong blurred sheen toward the far end — satin oak / polished concrete,
// not a mirror. No depth texture, 512² targets: the floor shader uses 8 of
// its 16 sampler units.
//
// The boards themselves are procedural in world space (per-board tone, hue,
// stagger, grooves and roughness from a hash), with the grain texture only
// supplying fibre detail — so there is no visible tile repeat anywhere.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BlurPass } from "@react-three/drei/materials/BlurPass";
import { crossWalls, ROOM_AO_APPLY, ROOM_AO_PARS, ROOM_NOISE_GLSL, type CrossWalls } from "./room-shading";
import { concreteTexture, woodGrainTexture } from "./textures";
import type { GalleryTheme } from "./theme";

const RESOLUTION = 512;

/** Live reflector materials — the probe capture switches their reflection off. */
const reflectors = new Set<{ uniforms: { uReflectMix: THREE.IUniform<number> }; mix: number }>();
export function setFloorReflectionsEnabled(on: boolean) {
  reflectors.forEach((r) => {
    r.uniforms.uReflectMix.value = on ? r.mix : 0;
  });
}

interface FloorProps {
  W: number;
  L: number;
  H: number;
  theme: GalleryTheme;
  /** A wooden floor's grain, owned by the caller (the benches share it). */
  grain?: THREE.Texture;
  /** A suite's cross walls (room AO along their foot). */
  cross?: CrossWalls;
}

function createFloorMaterial(
  { W, L, H, theme, grain, cross }: FloorProps,
  tReflect: THREE.Texture,
  tReflectBlur: THREE.Texture,
  textureMatrix: THREE.Matrix4
) {
  const kind = theme.floor.kind;
  const wood = kind !== "concrete";
  // only a map made here is disposed with the floor
  let ownMap: THREE.Texture | null = null;
  const map = wood && grain ? grain : (ownMap = wood ? woodGrainTexture(kind) : concreteTexture());
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(theme.floor.tint),
    map,
    roughness: theme.room.floorRoughness,
    metalness: 0,
  });
  const pw = theme.room.plankWidth;
  const uniforms = {
    tReflect: { value: tReflect },
    tReflectBlur: { value: tReflectBlur },
    textureMatrix: { value: textureMatrix },
    uReflectMix: { value: 0.92 },
    // wood: (board width, mean board length); concrete: (joint spacing x, z)
    uPlank: {
      value: wood
        ? new THREE.Vector2(pw, 2.3)
        : new THREE.Vector2(W / 3, L / Math.max(1, Math.round(L / 3.2))),
    },
    // grain / aggregate tile size in metres
    uGrain: { value: wood ? new THREE.Vector2(0.62, 1.2) : new THREE.Vector2(1.1, 1.1) },
    uPlankVar: { value: kind === "oak-dark" ? 0.16 : 0.12 },
    uOrigin: { value: new THREE.Vector2(-W / 2, -L / 2) },
    uRoomHalf: { value: new THREE.Vector3(W / 2, H, L / 2) },
    uRoomAO: { value: new THREE.Vector3(0.55, 0.32, 0.25) },
    // shared with the room materials (Room moves the window of cross walls)
    uCross: { value: (cross ?? crossWalls({ doorways: [] })).cross },
    uDoor: { value: (cross ?? crossWalls({ doorways: [] })).door },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform mat4 textureMatrix;
varying vec4 vReflUv;
varying vec3 vRoomPos;
varying vec3 vRoomNrm;`
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vRoomPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vRoomNrm = normalize(mat3(modelMatrix) * objectNormal);
vReflUv = textureMatrix * vec4(position, 1.0);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
${ROOM_NOISE_GLSL}
${ROOM_AO_PARS}
uniform sampler2D tReflect;
uniform sampler2D tReflectBlur;
uniform float uReflectMix;
uniform vec2 uPlank;
uniform vec2 uGrain;
uniform float uPlankVar;
uniform vec2 uOrigin;
varying vec4 vReflUv;
// 1 on the board face, 0 in a joint; fades to the joint's mean coverage
// once a pixel is wider than a fraction of the board (no moire far away).
float jointMask(float e, float halfW, float px, float span) {
  float m = smoothstep(halfW - 0.5 * px, halfW + 0.5 * px, e);
  return mix(m, 1.0 - 2.0 * halfW / span, smoothstep(0.12, 0.45, px / span));
}`
      )
      .replace(
        "#include <map_fragment>",
        wood
          ? `
float floorRough = 1.0;
float floorJoint = 1.0;
{
  vec2 fp = vRoomPos.xz - uOrigin;
  // boards run along z; each column gets its own stagger and board length
  float col = floor(fp.x / uPlank.x);
  float fx = fract(fp.x / uPlank.x);
  float hc = roomHash2(vec2(col, 3.7));
  float bl = uPlank.y * (0.75 + 0.6 * roomHash2(vec2(col, 9.1)));
  float zz = fp.y + hc * 17.0;
  float row = floor(zz / bl);
  float fz = fract(zz / bl);
  float h = roomHash2(vec2(col, row));
  float h2 = roomHash2(vec2(row * 1.37 + 0.5, col * 2.11 + 4.0));
  vec2 baseUv = fp / uGrain;
  vec2 guv = baseUv + vec2(h * 0.53, h2 * 7.31);
  vec4 grain = textureGrad(map, guv, dFdx(baseUv), dFdy(baseUv));
  float tone = 1.0 + (h - 0.5) * uPlankVar;
  vec3 hue = vec3(1.0 + (h2 - 0.5) * 0.05, 1.0, 1.0 - (h2 - 0.5) * 0.07);
  // large, slow variation in wear/colour across the hall
  float wear = roomNoise(vec3(fp * 0.21, 1.3)) * 0.6 + roomNoise(vec3(fp * 0.73, 7.7)) * 0.4;
  tone *= 1.0 + (wear - 0.5) * 0.08;
  float ex = min(fx, 1.0 - fx) * uPlank.x;
  float ez = min(fz, 1.0 - fz) * bl;
  float jx = jointMask(ex, 0.0011, fwidth(fp.x), uPlank.x);
  float jz = jointMask(ez, 0.0009, fwidth(fp.y), bl);
  floorJoint = jx * jz;
  diffuseColor.rgb *= grain.rgb * tone * hue * mix(0.35, 1.0, floorJoint);
  floorRough = (1.0 + (h2 - 0.5) * 0.16 + (wear - 0.5) * 0.12) * mix(1.6, 1.0, floorJoint);
}
`
          : `
float floorRough = 1.0;
float floorJoint = 1.0;
{
  vec2 fp = vRoomPos.xz - uOrigin;
  vec4 agg = texture2D(map, fp / uGrain);
  float n1 = roomNoise(vec3(fp * 0.32, 2.1)) * 0.55 + roomNoise(vec3(fp * 0.9, 5.3)) * 0.3 + roomNoise(vec3(fp * 2.7, 9.9)) * 0.15;
  float n2 = roomNoise(vec3(fp * 0.12, 4.4));
  float tone = 1.0 + (n1 - 0.5) * 0.14 + (n2 - 0.5) * 0.1;
  // saw-cut control joints
  vec2 cell = fp / uPlank;
  vec2 f = fract(cell);
  float ex = min(f.x, 1.0 - f.x) * uPlank.x;
  float ez = min(f.y, 1.0 - f.y) * uPlank.y;
  floorJoint = jointMask(ex, 0.0022, fwidth(fp.x), uPlank.x) * jointMask(ez, 0.0022, fwidth(fp.y), uPlank.y);
  diffuseColor.rgb *= agg.rgb * tone * mix(0.4, 1.0, floorJoint);
  floorRough = (1.0 + (n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.3) * mix(1.8, 1.0, floorJoint);
}
`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = clamp(roughness * floorRough, 0.05, 1.0);`
      )
      .replace(
        "#include <lights_fragment_maps>",
        `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
{
  vec3 rSharp = texture2DProj(tReflect, vReflUv).rgb;
  vec3 rBlur = texture2DProj(tReflectBlur, vReflUv).rgb;
  vec3 planar = mix(rSharp, rBlur, smoothstep(0.04, 0.24, roughnessFactor));
  radiance = mix(radiance, planar, uReflectMix * floorJoint);
}
#endif`
      )
      .replace("#include <aomap_fragment>", `#include <aomap_fragment>\n${ROOM_AO_APPLY}`);
  };
  mat.customProgramCacheKey = () => `room-floor:${wood ? "wood" : "concrete"}`;
  return { mat, ownMap, uniforms };
}

export function ReflectiveFloor(props: FloorProps) {
  const { W, L } = props;
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const meshRef = useRef<THREE.Mesh>(null);

  const tmp = useMemo(
    () => ({
      reflectorPlane: new THREE.Plane(),
      normal: new THREE.Vector3(),
      reflectorWorldPosition: new THREE.Vector3(),
      cameraWorldPosition: new THREE.Vector3(),
      rotationMatrix: new THREE.Matrix4(),
      lookAtPosition: new THREE.Vector3(0, 0, -1),
      clipPlane: new THREE.Vector4(),
      view: new THREE.Vector3(),
      target: new THREE.Vector3(),
      q: new THREE.Vector4(),
      textureMatrix: new THREE.Matrix4(),
      virtualCamera: new THREE.PerspectiveCamera(),
    }),
    []
  );

  const res = useMemo(() => {
    const params = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      generateMipmaps: false,
    };
    const fbo1 = new THREE.WebGLRenderTarget(RESOLUTION, RESOLUTION, { ...params, depthBuffer: true });
    const fbo2 = new THREE.WebGLRenderTarget(RESOLUTION, RESOLUTION, { ...params, depthBuffer: false });
    // Blur offsets are in UV units (1/width, 1/height), independent of resolution;
    // stronger along screen-y gives the streaky look of a satin floor.
    const blur = new BlurPass({ gl, resolution: RESOLUTION, width: 360, height: 110 });
    const { mat, ownMap, uniforms } = createFloorMaterial(props, fbo1.texture, fbo2.texture, tmp.textureMatrix);
    return { fbo1, fbo2, blur, mat, ownMap, uniforms };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, props.W, props.L, props.H, props.theme, props.grain, props.cross, tmp]);

  useEffect(() => {
    const entry = { uniforms: res.uniforms, mix: res.uniforms.uReflectMix.value };
    reflectors.add(entry);
    return () => {
      reflectors.delete(entry);
      res.fbo1.dispose();
      res.fbo2.dispose();
      res.blur.renderTargetA.dispose();
      res.blur.renderTargetB.dispose();
      res.blur.convolutionMaterial.dispose();
      res.blur.screen.geometry.dispose();
      res.mat.dispose();
      res.ownMap?.dispose();
    };
  }, [res]);

  // Mirror the main camera through the floor plane (drei's beforeRender,
  // with Lengyel's oblique near-plane clipping).
  const beforeRender = () => {
    const parent = meshRef.current;
    if (!parent) return false;
    // three refreshes the camera's matrixWorld only inside the main render,
    // after every useFrame: a pose set by a DOM handler (mouse-look, drag,
    // zoom) before this frame would otherwise be mirrored one frame late —
    // and the last frame before the canvas idles would keep that error
    camera.updateMatrixWorld();
    const t = tmp;
    t.reflectorWorldPosition.setFromMatrixPosition(parent.matrixWorld);
    t.cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
    t.rotationMatrix.extractRotation(parent.matrixWorld);
    t.normal.set(0, 0, 1).applyMatrix4(t.rotationMatrix);
    t.view.subVectors(t.reflectorWorldPosition, t.cameraWorldPosition);
    if (t.view.dot(t.normal) > 0) return false;
    t.view.reflect(t.normal).negate();
    t.view.add(t.reflectorWorldPosition);
    t.rotationMatrix.extractRotation(camera.matrixWorld);
    t.lookAtPosition.set(0, 0, -1);
    t.lookAtPosition.applyMatrix4(t.rotationMatrix);
    t.lookAtPosition.add(t.cameraWorldPosition);
    t.target.subVectors(t.reflectorWorldPosition, t.lookAtPosition);
    t.target.reflect(t.normal).negate();
    t.target.add(t.reflectorWorldPosition);
    const vc = t.virtualCamera;
    vc.position.copy(t.view);
    vc.up.set(0, 1, 0);
    vc.up.applyMatrix4(t.rotationMatrix);
    vc.up.reflect(t.normal);
    vc.lookAt(t.target);
    vc.far = (camera as THREE.PerspectiveCamera).far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    t.textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0);
    t.textureMatrix.multiply(vc.projectionMatrix);
    t.textureMatrix.multiply(vc.matrixWorldInverse);
    t.textureMatrix.multiply(parent.matrixWorld);
    t.reflectorPlane.setFromNormalAndCoplanarPoint(t.normal, t.reflectorWorldPosition);
    t.reflectorPlane.applyMatrix4(vc.matrixWorldInverse);
    t.clipPlane.set(
      t.reflectorPlane.normal.x,
      t.reflectorPlane.normal.y,
      t.reflectorPlane.normal.z,
      t.reflectorPlane.constant
    );
    const pm = vc.projectionMatrix;
    t.q.x = (Math.sign(t.clipPlane.x) + pm.elements[8]) / pm.elements[0];
    t.q.y = (Math.sign(t.clipPlane.y) + pm.elements[9]) / pm.elements[5];
    t.q.z = -1.0;
    t.q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    t.clipPlane.multiplyScalar(2.0 / t.clipPlane.dot(t.q));
    pm.elements[2] = t.clipPlane.x;
    pm.elements[6] = t.clipPlane.y;
    pm.elements[10] = t.clipPlane.z + 1.0;
    pm.elements[14] = t.clipPlane.w;
    return true;
  };

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || !beforeRender()) return;
    mesh.visible = false;
    const xr = gl.xr.enabled;
    gl.xr.enabled = false;
    gl.setRenderTarget(res.fbo1);
    gl.state.buffers.depth.setMask(true);
    if (!gl.autoClear) gl.clear();
    gl.render(scene, tmp.virtualCamera);
    res.blur.render(gl, res.fbo1, res.fbo2);
    gl.xr.enabled = xr;
    mesh.visible = true;
    gl.setRenderTarget(null);
  });

  return (
    <mesh ref={meshRef} rotation-x={-Math.PI / 2} material={res.mat}>
      <planeGeometry args={[W, L]} />
    </mesh>
  );
}
