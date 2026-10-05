// Procedural CanvasTextures — plaster, damask, wood grain, concrete, laylight
// glass and museum placards. Generated at runtime so the gallery needs no
// texture assets. Every surface texture tiles seamlessly in both directions
// (all noise is periodic, every shape is drawn with wrap copies).

import * as THREE from "three";

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d", { willReadFrequently: true })! };
}

// Deterministic PRNG so textures are stable between mounts.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Periodic 2D value noise: a lattice of `cells` × `cells` that wraps. */
function periodicNoise(seed: number, cellsX: number, cellsY = cellsX) {
  const r = rng(seed);
  const lat = new Float32Array(cellsX * cellsY);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  return (u: number, v: number) => {
    // u, v in [0, 1) — wraps
    const x = u * cellsX;
    const y = v * cellsY;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    let fx = x - x0;
    let fy = y - y0;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const xa = ((x0 % cellsX) + cellsX) % cellsX;
    const ya = ((y0 % cellsY) + cellsY) % cellsY;
    const xb = (xa + 1) % cellsX;
    const yb = (ya + 1) % cellsY;
    const a = lat[ya * cellsX + xa];
    const b = lat[ya * cellsX + xb];
    const c = lat[yb * cellsX + xa];
    const d = lat[yb * cellsX + xb];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Fractal sum of periodic noise octaves, normalised to ~[0, 1]. */
function periodicFbm(seed: number, baseCells: number, octaves: number, gain = 0.5) {
  const layers = Array.from({ length: octaves }, (_, i) =>
    periodicNoise(seed + i * 101, baseCells << i)
  );
  let norm = 0;
  for (let i = 0; i < octaves; i++) norm += Math.pow(gain, i);
  return (u: number, v: number) => {
    let s = 0;
    for (let i = 0; i < octaves; i++) s += layers[i](u, v) * Math.pow(gain, i);
    return s / norm;
  };
}

/** Tabulate a smooth periodic function on a small grid; sample it bilinearly. */
function tabulate(fn: (u: number, v: number) => number, gw: number, gh: number) {
  const t = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) t[y * gw + x] = fn(x / gw, y / gh);
  return (u: number, v: number) => {
    const x = u * gw;
    const y = v * gh;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const xa = ((x0 % gw) + gw) % gw;
    const ya = ((y0 % gh) + gh) % gh;
    const xb = (xa + 1) % gw;
    const yb = (ya + 1) % gh;
    const a = t[ya * gw + xa];
    const b = t[ya * gw + xb];
    const c = t[yb * gw + xa];
    const d = t[yb * gw + xb];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function finishTexture(
  c: HTMLCanvasElement,
  { srgb, anisotropy = 8 }: { srgb: boolean; anisotropy?: number }
): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

// The source canvases are cached (they are pure functions of their seed), but
// every caller gets its OWN texture object so it can set repeat and dispose it
// independently of other rooms.
const canvasCache = new Map<string, HTMLCanvasElement>();
function cachedCanvas(key: string, draw: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = canvasCache.get(key);
  if (!c) {
    c = draw();
    canvasCache.set(key, c);
  }
  return c;
}

// ------------------------------------------------------------------ plaster

/**
 * Lime-plaster / painted-wall albedo (near-white, multiplied by the wall
 * colour) and a matching height map for the bump. Very low contrast: the
 * eye should read "paint on a real wall", not "texture".
 */
export function plasterTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const S = 512;
  const albedo = cachedCanvas("plaster-albedo", () => {
    const { c, ctx } = makeCanvas(S, S);
    const img = ctx.createImageData(S, S);
    const broad = periodicFbm(11, 4, 4, 0.55);
    const fine = periodicNoise(12, 128);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const l = 0.955 + (broad(u, v) - 0.5) * 0.05 + (fine(u, v) - 0.5) * 0.018;
        const i = (y * S + x) * 4;
        img.data[i] = Math.round(255 * Math.min(1, l * 1.0));
        img.data[i + 1] = Math.round(255 * Math.min(1, l * 0.995));
        img.data[i + 2] = Math.round(255 * Math.min(1, l * 0.985));
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
  const height = cachedCanvas("plaster-height", () => {
    const { c, ctx } = makeCanvas(S, S);
    const img = ctx.createImageData(S, S);
    const trowel = periodicFbm(21, 6, 3, 0.5);
    const grain = periodicFbm(22, 64, 2, 0.6);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const h = 0.62 * trowel(u, v) + 0.38 * grain(u, v);
        const i = (y * S + x) * 4;
        const g = Math.round(255 * h);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
  return {
    map: finishTexture(albedo, { srgb: true }),
    bump: finishTexture(height, { srgb: false, anisotropy: 4 }),
  };
}

// ------------------------------------------------------------------- damask

/**
 * Silk damask wall covering: a tone-on-tone ogee-and-palmette repeat. The
 * satin figure is a touch lighter AND glossier than the matte ground, which
 * is how real damask reads — mostly through sheen as the light rakes it.
 * Returns albedo (near-white, multiplied by the wall colour) and a roughness
 * map (G channel: figure 0.62, ground 1.0 — multiplied by material.roughness).
 */
export function damaskTextures(): { map: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const TW = 512;
  const TH = 768;
  const mask = cachedCanvas("damask-mask", () => {
    const { c, ctx } = makeCanvas(TW, TH);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, TW, TH);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";

    // One mirrored palmette motif centred on (0, 0), ~380 px tall.
    const palmette = () => {
      for (const side of [1, -1]) {
        ctx.save();
        ctx.scale(side, 1);
        // outer ogee leaf
        ctx.beginPath();
        ctx.moveTo(0, -200);
        ctx.bezierCurveTo(40, -150, 120, -120, 118, -40);
        ctx.bezierCurveTo(116, 30, 60, 70, 70, 130);
        ctx.bezierCurveTo(76, 165, 40, 185, 0, 190);
        ctx.lineTo(0, 160);
        ctx.bezierCurveTo(28, 150, 40, 130, 34, 110);
        ctx.bezierCurveTo(20, 60, 86, 20, 84, -40);
        ctx.bezierCurveTo(82, -100, 30, -130, 0, -160);
        ctx.closePath();
        ctx.fill();
        // inner pomegranate
        ctx.beginPath();
        ctx.moveTo(0, -110);
        ctx.bezierCurveTo(30, -90, 58, -50, 52, 0);
        ctx.bezierCurveTo(48, 40, 22, 70, 0, 78);
        ctx.closePath();
        ctx.fill();
        // curling side fronds
        ctx.lineWidth = 9;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(110, -60);
        ctx.bezierCurveTo(170, -110, 220, -60, 196, -10);
        ctx.bezierCurveTo(182, 18, 150, 10, 160, -16);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(74, 120);
        ctx.bezierCurveTo(140, 110, 200, 160, 176, 220);
        ctx.stroke();
        // small leaves along the stem
        for (const [x, y, rot] of [
          [132, -140, -0.7],
          [150, 60, 0.5],
          [100, 210, 0.9],
        ] as const) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rot);
          ctx.beginPath();
          ctx.ellipse(0, 0, 26, 9, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      }
      // stem
      ctx.fillRect(-5, 186, 10, 50);
    };
    // Small half-drop fleuron between the palmettes.
    const fleuron = () => {
      for (const side of [1, -1]) {
        ctx.save();
        ctx.scale(side, 1);
        ctx.beginPath();
        ctx.moveTo(0, -70);
        ctx.bezierCurveTo(30, -40, 46, -6, 20, 26);
        ctx.bezierCurveTo(10, 38, 0, 40, 0, 52);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(44, 18, 22, 8, 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };
    // Draw with wrap copies so the tile is seamless.
    for (const dx of [-TW, 0, TW]) {
      for (const dy of [-TH, 0, TH]) {
        ctx.save();
        ctx.translate(TW / 2 + dx, TH / 2 + dy - 20);
        palmette();
        ctx.restore();
        ctx.save();
        ctx.translate(dx, dy);
        palmette();
        ctx.restore();
        ctx.save();
        ctx.translate(TW / 2 + dx, dy + 10);
        fleuron();
        ctx.restore();
        ctx.save();
        ctx.translate(dx, TH / 2 + dy);
        fleuron();
        ctx.restore();
      }
    }
    return c;
  });

  const albedo = cachedCanvas("damask-albedo", () => {
    const { c, ctx } = makeCanvas(TW, TH);
    ctx.fillStyle = "rgb(226,226,226)";
    ctx.fillRect(0, 0, TW, TH);
    ctx.filter = "blur(1.2px)";
    ctx.globalAlpha = 0.055;
    ctx.globalCompositeOperation = "lighter";
    // wrap copies so the blur is periodic too (no seam at the tile edge)
    for (const dx of [-TW, 0, TW]) for (const dy of [-TH, 0, TH]) ctx.drawImage(mask, dx, dy);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // woven texture: faint horizontal weft lines + periodic slub noise
    const img = ctx.getImageData(0, 0, TW, TH);
    const slub = periodicNoise(41, 64, 192);
    for (let y = 0; y < TH; y++) {
      const weft = y % 3 === 0 ? 0.985 : 1;
      for (let x = 0; x < TW; x++) {
        const i = (y * TW + x) * 4;
        const k = weft * (0.985 + 0.03 * slub(x / TW, y / TH));
        img.data[i] = Math.min(255, img.data[i] * k * 1.02);
        img.data[i + 1] = Math.min(255, img.data[i + 1] * k);
        img.data[i + 2] = Math.min(255, img.data[i + 2] * k * 0.99);
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
  const rough = cachedCanvas("damask-rough", () => {
    const { c, ctx } = makeCanvas(TW, TH);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, TW, TH);
    ctx.filter = "blur(1.2px)";
    ctx.globalCompositeOperation = "multiply";
    // figure: G = 0.62 → (158)
    const { c: tint, ctx: tctx } = makeCanvas(TW, TH);
    tctx.fillStyle = "rgb(158,158,158)";
    tctx.fillRect(0, 0, TW, TH);
    tctx.globalCompositeOperation = "destination-in";
    tctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    for (const dx of [-TW, 0, TW]) for (const dy of [-TH, 0, TH]) ctx.drawImage(tint, dx, dy);
    ctx.filter = "none";
    return c;
  });
  return {
    map: finishTexture(albedo, { srgb: true }),
    roughness: finishTexture(rough, { srgb: false, anisotropy: 4 }),
  };
}

// --------------------------------------------------------------- wood grain

/**
 * Oak grain for floor boards: light, near-white streaks (the floor tint is
 * applied by the material colour, per-board tone variation by the shader).
 * The 512² tile represents ~0.6 m × 1.2 m of grain; every board samples it
 * at its own random offset, so the repeat never lines up.
 */
export function woodGrainTexture(kind: "oak-dark" | "oak-light"): THREE.CanvasTexture {
  const W = 512;
  const H = 512;
  const c = cachedCanvas(`grain-${kind}`, () => {
    const { c, ctx } = makeCanvas(W, H);
    const img = ctx.createImageData(W, H);
    const NL = 72; // growth lines across the tile (~8.6 mm apart)
    // low-frequency fields are tabulated once and sampled bilinearly (fast)
    const sway = tabulate(periodicFbm(31, 2, 3, 0.5), 64, 64); // slow lateral wander
    const sway2 = tabulate(periodicNoise(35, 12, 2), 96, 16); // lines bunch and spread
    const tone = tabulate(periodicFbm(34, 2, 2, 0.5), 32, 32); // broad colour drift
    const lineVar = periodicNoise(32, NL, 3); // each line's strength along its length
    const pores = periodicNoise(33, 192, 24); // open pores, stretched along the grain
    const contrast = kind === "oak-dark" ? 0.3 : 0.22;
    const TWO_PI = Math.PI * 2;
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const w = u * NL + (sway(u, v) - 0.5) * 14 + (sway2(u, v) - 0.5) * 4.5;
        const f = w - Math.floor(w);
        // late-wood band: soft-edged dark stripe in each period
        const cb = 0.5 + 0.5 * Math.cos(TWO_PI * (f - 0.5));
        const cb2 = cb * cb;
        const band = cb2 * cb2;
        const lu = ((w / NL) % 1 + 1) % 1;
        const strength = 0.35 + 0.65 * lineVar(lu, v);
        const pore = Math.max(0, pores(lu, v) - 0.62) * 2.6;
        let l = 1 - contrast * band * strength - 0.07 * pore + (tone(u, v) - 0.5) * 0.08;
        l = l < 0 ? 0 : l > 1 ? 1 : l;
        const i = (y * W + x) * 4;
        // darker grain is warmer
        img.data[i] = 255 * l;
        img.data[i + 1] = 255 * l * (0.88 + 0.12 * l);
        img.data[i + 2] = 255 * l * (0.7 + 0.3 * l);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
  return finishTexture(c, { srgb: true, anisotropy: 16 });
}

// ----------------------------------------------------------------- concrete

/** Polished concrete: fine aggregate speckle and faint trowel clouds (1 m tile). */
export function concreteTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = cachedCanvas("concrete", () => {
    const { c, ctx } = makeCanvas(S, S);
    const img = ctx.createImageData(S, S);
    const cloud = periodicFbm(51, 4, 4, 0.55);
    const fine = periodicNoise(52, 170);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const l = 0.92 + (cloud(u, v) - 0.5) * 0.08 + (fine(u, v) - 0.5) * 0.05;
        const i = (y * S + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * l);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // exposed aggregate: small stones, a little darker or lighter, wrapped
    const r = rng(53);
    for (let k = 0; k < 2600; k++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 0.6 + Math.pow(r(), 3) * 3.2;
      const dark = r() > 0.45;
      const a = 0.05 + r() * 0.12;
      ctx.fillStyle = dark ? `rgba(60,58,54,${a})` : `rgba(255,253,248,${a})`;
      for (const dx of [-S, 0, S])
        for (const dy of [-S, 0, S]) {
          if (x + dx < -8 || x + dx > S + 8 || y + dy < -8 || y + dy > S + 8) continue;
          ctx.beginPath();
          ctx.ellipse(x + dx, y + dy, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
    }
    return c;
  });
  return finishTexture(c, { srgb: true, anisotropy: 16 });
}

// ------------------------------------------------------------ laylight glass

/**
 * One bay of a laylight: frosted, slightly milky glass panes held by thin
 * glazing bars, brightest in the middle of each pane. Used as an emissive map.
 */
export function laylightTexture(panesX: number, panesY: number): THREE.CanvasTexture {
  const S = 512;
  const c = cachedCanvas(`laylight-${panesX}x${panesY}`, () => {
    const { c, ctx } = makeCanvas(S, S);
    const img = ctx.createImageData(S, S);
    const cloud = periodicFbm(61, 3, 3, 0.5);
    const paneVar = periodicNoise(62, 8);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        // distance to the nearest glazing bar, in pane units
        const pu = u * panesX;
        const pv = v * panesY;
        const du = Math.min(pu - Math.floor(pu), Math.ceil(pu) - pu) / panesX;
        const dv = Math.min(pv - Math.floor(pv), Math.ceil(pv) - pv) / panesY;
        const d = Math.min(du, dv);
        const bar = d < 0.0045 ? 0.3 : 1;
        // light falls off a little toward each bar (the bars sit below the glass)
        const glow = 0.86 + 0.14 * Math.min(1, d / 0.06);
        const milk = 0.97 + (cloud(u, v) - 0.5) * 0.06;
        // the bay's outer frame is wider and darker
        const edge = Math.min(u, 1 - u, v, 1 - v);
        const frame = edge < 0.009 ? 0.22 : 1;
        // each pane's frosting is a touch different
        const pane = 0.97 + 0.06 * paneVar(Math.floor(pu) / panesX + 0.5 / panesX, Math.floor(pv) / panesY + 0.5 / panesY);
        const l = Math.min(bar, frame) * glow * milk * pane;
        const i = (y * S + x) * 4;
        img.data[i] = Math.round(255 * Math.max(0.12, l));
        img.data[i + 1] = Math.round(255 * Math.max(0.12, l));
        img.data[i + 2] = Math.round(255 * Math.max(0.12, l));
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
  const t = finishTexture(c, { srgb: true, anisotropy: 8 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
