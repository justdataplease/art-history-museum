// Materials and procedural detail maps for the exhibits: real gold leaf,
// hardwood, the floater's matte tray, and the painted canvas itself.
// Everything is generated at runtime (no texture downloads) and shared per
// theme, so a gallery's twelve frames use one material and one shader.

import * as THREE from "three";
import type { EraKey, GalleryTheme } from "./theme";

// --------------------------------------------------------------- utilities

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Tileable value noise on a size×size lattice of `cells` cells. */
function valueNoise(size: number, cellsX: number, cellsY: number, seed: number): Float32Array {
  const r = rng(seed);
  const lattice = new Float32Array(cellsX * cellsY).map(() => r());
  const out = new Float32Array(size * size);
  const at = (x: number, y: number) => lattice[((y + cellsY) % cellsY) * cellsX + ((x + cellsX) % cellsX)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cellsX;
      const fy = (y / size) * cellsY;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      let tx = fx - ix;
      let ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const a = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
      const b = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
      out[y * size + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

function dataTexture(
  data: Uint8Array,
  w: number,
  h: number,
  opts: { colorSpace?: THREE.ColorSpace; wrapT?: THREE.Wrapping } = {},
): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = opts.wrapT ?? THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = opts.colorSpace ?? THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Height field → tangent-space normal map (OpenGL convention, +Y up). */
function heightToNormal(
  hgt: Float32Array,
  w: number,
  h: number,
  strength: number,
  wrapY: boolean,
): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const H = (x: number, y: number) => {
    x = (x + w) % w;
    y = wrapY ? (y + h) % h : Math.min(h - 1, Math.max(0, y));
    return hgt[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

// ------------------------------------------------------- procedural maps

let weaveTex: THREE.DataTexture | null = null;
/** Physical tile of the weave normal map: 16 threads at ~1.1 mm pitch (coarse linen). */
export const WEAVE_TILE_M = 0.0176;

/** Plain-weave linen canvas, tangent-space normal map (tile = WEAVE_TILE_M). */
export function canvasWeaveTexture(): THREE.DataTexture {
  if (weaveTex) return weaveTex;
  const S = 256;
  const N = 16;
  const r = rng(91);
  // per-thread thickness irregularity (slubs) so the weave isn't mechanical
  const warp = Array.from({ length: N }, () => 0.75 + 0.5 * r());
  const weft = Array.from({ length: N }, () => 0.75 + 0.5 * r());
  const slub = valueNoise(S, 8, 32, 5);
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * N;
      const v = (y / S) * N;
      const iu = Math.floor(u);
      const iv = Math.floor(v);
      const fu = u - iu;
      const fv = v - iv;
      const over = (iu + iv) % 2 === 0;
      const warpH = Math.sin(Math.PI * fu) * warp[iu] * (over ? 0.62 + 0.38 * Math.sin(Math.PI * fv) : 0.35);
      const weftH = Math.sin(Math.PI * fv) * weft[iv] * (!over ? 0.62 + 0.38 * Math.sin(Math.PI * fu) : 0.35);
      hgt[y * S + x] = Math.max(warpH, weftH) * (0.85 + 0.3 * slub[y * S + x]);
    }
  }
  weaveTex = dataTexture(heightToNormal(hgt, S, S, 2.2, true), S, S);
  weaveTex.channel = 1; // canvases carry a uv1 set in weave tiles
  return weaveTex;
}

let carveTex: THREE.DataTexture | null = null;
/**
 * Carved ornament for gilt frames, one row per band:
 *   v 0.0–0.5  leaf-and-dart (on the ogee / hollow)
 *   v 0.5–1.0  pearl bead (four pearls per tile)
 * u repeats along the moulding (see CARVE_PERIOD_M).
 */
export const CARVE_PERIOD_M = 0.052;
export function carveNormalTexture(): THREE.DataTexture {
  if (carveTex) return carveTex;
  const W = 256;
  const H = 128;
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = (y + 0.5) / H;
      let h = 0;
      if (v < 0.5) {
        // leaf-and-dart: t = 0 at the sight side of the band, 1 at the outer side
        const t = THREE.MathUtils.clamp((v - 0.02) / 0.46, 0, 1);
        const lx = Math.abs(u - 0.5);
        const halfW = 0.46 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.06)), 0.55) * (0.45 + 0.55 * t);
        if (halfW > 1e-3 && lx < halfW) {
          const e = 1 - (lx / halfW) ** 2;
          h = Math.pow(e, 0.5) * (0.6 + 0.4 * t);
          h -= 0.22 * Math.exp(-((lx / 0.02) ** 2)) * Math.min(1, t * 3); // midrib
          // lobed edge
          h *= 0.88 + 0.12 * Math.cos(t * Math.PI * 7);
        }
        // dart between leaves
        const dx = Math.min(u, 1 - u);
        if (dx < 0.05 && t > 0.08 && t < 0.85) h = Math.max(h, 0.55 * (1 - dx / 0.05) * Math.sin(Math.PI * (t - 0.08) / 0.77));
      } else {
        // pearls: four per tile, round in u (the bead's roundness across v is real geometry)
        const lx = (u * 4) % 1;
        const px = (lx - 0.5) / 0.46;
        h = Math.sqrt(Math.max(0, 1 - px * px));
      }
      hgt[y * W + x] = h;
    }
  }
  carveTex = dataTexture(heightToNormal(hgt, W, H, 3.2, false), W, H, { wrapT: THREE.ClampToEdgeWrapping });
  carveTex.channel = 1;
  carveTex.repeat.set(1 / CARVE_PERIOD_M, 1);
  return carveTex;
}

let patinaTex: THREE.DataTexture | null = null;
/** Gold-leaf colour variation: leaf squares with faint seams and soft tarnish (linear multiplier). */
export const LEAF_TILE_M = 0.34;
function giltPatinaTexture(): THREE.DataTexture {
  if (patinaTex) return patinaTex;
  const S = 256;
  const r = rng(17);
  const n1 = valueNoise(S, 6, 6, 3);
  const n2 = valueNoise(S, 24, 24, 4);
  const LEAVES = 4; // ~8.5 cm leaves
  const tone = Array.from({ length: LEAVES * LEAVES }, () => 0.955 + 0.045 * r());
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // staggered leaf courses, like real gilding
      const row = Math.floor((y / S) * LEAVES);
      const col = Math.floor(((x / S) * LEAVES + (row % 2) * 0.5) % LEAVES);
      const fx = ((x / S) * LEAVES + (row % 2) * 0.5) % 1;
      const fy = ((y / S) * LEAVES) % 1;
      const seam = Math.min(fx, 1 - fx, fy, 1 - fy) < 0.012 ? 0.93 : 1;
      const tarnish = 0.9 + 0.1 * n1[i] - 0.04 * n2[i];
      const v = tone[row * LEAVES + col] * seam * tarnish;
      // tarnish shifts slightly toward brown (less blue)
      data[i * 4] = Math.round(255 * Math.min(1, v));
      data[i * 4 + 1] = Math.round(255 * Math.min(1, v * (0.985 + 0.015 * n1[i])));
      data[i * 4 + 2] = Math.round(255 * Math.min(1, v * (0.95 + 0.05 * n1[i])));
      data[i * 4 + 3] = 255;
    }
  }
  patinaTex = dataTexture(data, S, S);
  patinaTex.repeat.set(1 / LEAF_TILE_M, 1 / LEAF_TILE_M);
  return patinaTex;
}

let giltRoughTex: THREE.DataTexture | null = null;
/** Burnishing variation: streaks along the moulding (G channel = roughness factor 0.6–1). */
function giltRoughnessTexture(): THREE.DataTexture {
  if (giltRoughTex) return giltRoughTex;
  const S = 256;
  const streak = valueNoise(S, 4, 48, 8); // long along u, tight across
  const blot = valueNoise(S, 10, 10, 9);
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const v = 0.6 + 0.28 * streak[i] + 0.12 * blot[i];
    const b = Math.round(255 * v);
    data[i * 4] = b;
    data[i * 4 + 1] = b;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  giltRoughTex = dataTexture(data, S, S);
  giltRoughTex.repeat.set(1 / 0.6, 1 / 0.25);
  return giltRoughTex;
}

let grainTex: THREE.DataTexture | null = null;
/** Hardwood grain running along each rail (linear multiplier 0.72–1). */
function woodGrainTexture(): THREE.DataTexture {
  if (grainTex) return grainTex;
  const S = 256;
  const warpN = valueNoise(S, 3, 8, 21);
  const fine = valueNoise(S, 64, 128, 22);
  const pores = rng(23);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const ring = (y / S) * 11 + warpN[i] * 2.4;
      const f = ring - Math.floor(ring);
      // late wood bands: sharp dark edge, soft fade
      const late = Math.pow(1 - f, 6) * 0.6 + Math.pow(f, 14) * 0.25;
      let v = 0.97 - 0.2 * late - 0.06 * fine[i];
      if (pores() < 0.015) v -= 0.08;
      const b = Math.round(255 * Math.max(0.55, Math.min(1, v)));
      data[i * 4] = b;
      data[i * 4 + 1] = Math.round(b * 0.985);
      data[i * 4 + 2] = Math.round(b * 0.96);
      data[i * 4 + 3] = 255;
    }
  }
  grainTex = dataTexture(data, S, S);
  grainTex.repeat.set(1 / 0.9, 1 / 0.06);
  return grainTex;
}

// ------------------------------------------------------- frame materials

/**
 * Per-vertex frame attributes (aFrame, from buildFrame): x scales roughness
 * (burnished highs, matte recesses), y gates the carved normal map to its
 * bands, z flags the mat. Mat vertices (a print's or miniature's mat, an East
 * Asian silk mount) are drawn in `mat` (linear), matte and non-metallic,
 * whatever the moulding's own material.
 */
function patchFrameShader(m: THREE.MeshStandardMaterial, key: string, mat: THREE.Color | null = null) {
  const uMat = { value: mat ?? new THREE.Color(0, 0, 0) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMat = uMat;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aFrame;\nvarying vec3 vFrame;")
      .replace("#include <color_vertex>", "#include <color_vertex>\n\tvFrame = aFrame;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFrame;\nuniform vec3 uMat;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n\tdiffuseColor.rgb = mix( diffuseColor.rgb, uMat * vColor.rgb, vFrame.z );",
      )
      .replace(
        "#include <metalnessmap_fragment>",
        "#include <metalnessmap_fragment>\n\tmetalnessFactor *= 1.0 - vFrame.z;",
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\n\troughnessFactor = mix( clamp( roughnessFactor * vFrame.x, 0.06, 1.0 ), 0.9, vFrame.z );",
      )
      .replace(
        "#include <normal_fragment_maps>",
        THREE.ShaderChunk.normal_fragment_maps.replace("mapN.xy *= normalScale;", "mapN.xy *= normalScale * vFrame.y;"),
      );
  };
  m.customProgramCacheKey = () => `exhibit-frame:${key}`;
}

const GOLD_F0 = new THREE.Color().setRGB(1.0, 0.766, 0.336); // linear working space

/** Gold F0 nudged toward the theme's gilding hue (red gold / pale gold), kept at gold's brightness. */
function giltColor(themeColor: string): THREE.Color {
  const t = new THREE.Color(themeColor); // sRGB hex → linear
  const m = Math.max(t.r, t.g, t.b, 1e-4);
  const hue = new THREE.Color(t.r / m, t.g / m, t.b / m);
  return GOLD_F0.clone().lerp(hue, 0.25);
}

export const GILT_ENV_INTENSITY = 1.0;

const frameMats = new Map<string, THREE.MeshStandardMaterial>();

export function isGilt(style: GalleryTheme["frame"]["style"]): boolean {
  return style === "baroque" || style === "tabernacle" || style === "gilt-simple" || style === "miniature";
}

/** The shared material for a theme's frames (gilt, hardwood or floater tray). */
export function frameMaterial(theme: GalleryTheme): THREE.MeshStandardMaterial {
  const f = theme.frame;
  const key = `${f.style}|${f.color}|${f.roughness}|${f.metalness}|${f.mat ?? ""}|${f.mat ? theme.light.spot : ""}`;
  const hit = frameMats.get(key);
  if (hit) return hit;
  // the mat reads white to an eye adapted to the warm light, as the canvas
  // does (canvasWhiteBalance), only a little less
  const mat = f.mat ? new THREE.Color(f.mat).multiply(canvasWhiteBalance(theme.light.spot, 0.6)) : null;
  let m: THREE.MeshStandardMaterial;
  if (isGilt(f.style)) {
    m = new THREE.MeshStandardMaterial({
      color: giltColor(f.color),
      metalness: 1,
      roughness: Math.min(1, f.roughness / 0.78),
      map: giltPatinaTexture(),
      roughnessMap: giltRoughnessTexture(),
      normalMap: carveNormalTexture(),
      normalScale: new THREE.Vector2(0.85, 0.85),
      vertexColors: true,
      envMapIntensity: GILT_ENV_INTENSITY,
    });
    patchFrameShader(m, "gilt", mat);
  } else if (f.style === "print") {
    // black lacquer: smooth, a soft sheen
    m = new THREE.MeshStandardMaterial({
      color: f.color,
      metalness: 0,
      roughness: f.roughness,
      vertexColors: true,
      envMapIntensity: 0.7,
    });
    patchFrameShader(m, "lacquer", mat);
  } else if (f.style === "wood" || f.style === "mount") {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(f.color).multiplyScalar(1.12),
      metalness: 0,
      roughness: f.roughness,
      map: woodGrainTexture(),
      vertexColors: true,
      envMapIntensity: 0.6,
    });
    patchFrameShader(m, "wood", mat);
  } else {
    m = new THREE.MeshStandardMaterial({
      color: f.color,
      metalness: 0,
      roughness: Math.max(0.7, f.roughness),
      vertexColors: true,
      envMapIntensity: 0.3,
    });
    patchFrameShader(m, "tray");
  }
  m.name = `frame:${f.style}`;
  // the material's own reflection strength at rest (exhibits scale it by the room's env dimming)
  m.userData.envBase = m.envMapIntensity;
  frameMats.set(key, m);
  return m;
}

/** The cached frame materials (exhibit-shared.ts reads renderer state off them). */
export function sharedFrameMaterials(): THREE.MeshStandardMaterial[] {
  return [...frameMats.values()];
}

/**
 * Free the shared maps and frame materials from every renderer that used
 * them (exhibit-shared.ts). The maps stay valid and upload again on their
 * next use; the frame materials are dropped, so the next gallery builds
 * fresh ones rather than inheriting the last one's probe binding.
 */
export function disposeSharedMaterials(): void {
  for (const m of frameMats.values()) m.dispose();
  frameMats.clear();
  for (const t of [weaveTex, carveTex, patinaTex, giltRoughTex, grainTex]) t?.dispose();
}

/**
 * Bind the gallery's reflection probe explicitly (r184: a material with
 * envMap === null samples scene.environment at scene.environmentIntensity and
 * ignores its own envMapIntensity).
 */
export function bindEnv(m: THREE.MeshStandardMaterial, env: THREE.Texture | null): void {
  if (m.envMap === env) return;
  m.envMap = env;
  m.needsUpdate = true;
}

// ------------------------------------------------------- painted surface

/** Varnish: Old Masters glossier, modern work matte. Roughness of the paint layer. */
export function canvasRoughness(era: EraKey): number {
  // Broad enough that a lamp's reflection is a soft sheen, never a glare
  // spot that washes out the paint (GGX peak ∝ 1/roughness⁴).
  switch (era) {
    case "sacred":
      return 0.5;
    case "old-master":
    case "northern":
      return 0.5;
    case "eighteenth":
    // the custom rooms' styles that mostly hang old varnished paintings
    case "museum":
    case "palace":
    case "salon":
      return 0.52;
    case "nineteenth":
    case "victorian":
      return 0.54;
    case "impressionist":
    case "secession":
      return 0.6;
    case "early-modern":
      return 0.62;
    // ink and colour on silk or paper, unvarnished
    case "east-asian":
    case "print-room":
      return 0.82;
    // opaque watercolour and gold on burnished paper: a faint sheen
    case "court-miniature":
      return 0.7;
    default:
      return 0.78;
  }
}

/**
 * Chromatic adaptation for the paint layer. A visitor's eye adapts to the
 * warm gallery light, so a painting's whites still read as white; a renderer
 * has no such adaptation and would tint every work amber. The canvas colour
 * is set to the (luminance-preserving) inverse of the spot colour, applied
 * `amount` of the way, so the artwork's own colours stay faithful while
 * walls and gilding keep the warm light.
 */
export function canvasWhiteBalance(spotHex: string, amount = 0.8): THREE.Color {
  const s = new THREE.Color(spotHex); // linear
  const lum = 0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b;
  const inv = (c: number) => lum / Math.max(0.05, c);
  return new THREE.Color(
    1 + (inv(s.r) - 1) * amount,
    1 + (inv(s.g) - 1) * amount,
    1 + (inv(s.b) - 1) * amount,
  );
}

/** Canvas weave only on canvas: sacred-era works are tempera on gessoed
 *  panel, East Asian painting, prints and miniatures silk or paper. */
export function hasWeave(era: EraKey): boolean {
  return era !== "sacred" && era !== "east-asian" && era !== "print-room" && era !== "court-miniature";
}

// ------------------------------------------------------- track fixtures

/** Lens radiance at rest (× the spot colour); scaled by the exhibit's dimming. */
export const LENS_GLOW = 4;

/**
 * One material for an exhibit's track heads: the body in the room's track
 * colour, the lens disc (aLens = 1 in fixtureGeometry) glowing in the spot
 * colour. Per exhibit, because the glow follows that exhibit's dimming.
 */
export function createFixtureMaterial(trackColor: string, spotColor: string): THREE.MeshStandardMaterial {
  const c = new THREE.Color(trackColor);
  const light = c.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5;
  const m = new THREE.MeshStandardMaterial({
    color: c,
    roughness: light ? 0.5 : 0.42,
    metalness: light ? 0.1 : 0.55,
    emissive: new THREE.Color(spotColor),
    emissiveIntensity: LENS_GLOW,
    envMapIntensity: 0.6,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aLens;\nvarying float vLens;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvLens = aLens;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vLens;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n\tdiffuseColor.rgb *= 1.0 - vLens;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vLens;");
  };
  m.customProgramCacheKey = () => "exhibit-fixture";
  m.name = "fixture";
  return m;
}
