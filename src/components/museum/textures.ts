// Procedural CanvasTextures — plaster walls, plank floor, museum placards.
// Generated at runtime so the gallery needs no texture assets.

import * as THREE from "three";

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d")! };
}

// Deterministic PRNG so textures are stable between mounts.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

let wallTex: THREE.CanvasTexture | null = null;
export function plasterTexture(): THREE.CanvasTexture {
  if (wallTex) return wallTex;
  const { c, ctx } = makeCanvas(512, 512);
  ctx.fillStyle = "#e9e1d0";
  ctx.fillRect(0, 0, 512, 512);
  const r = rng(7);
  // fine plaster speckle
  for (let i = 0; i < 9000; i++) {
    const v = r();
    ctx.fillStyle =
      v > 0.5
        ? `rgba(255,252,240,${0.02 + r() * 0.05})`
        : `rgba(94,82,60,${0.015 + r() * 0.04})`;
    ctx.fillRect(r() * 512, r() * 512, 1 + r() * 1.6, 1 + r() * 1.6);
  }
  // soft mottling
  for (let i = 0; i < 26; i++) {
    const g = ctx.createRadialGradient(
      r() * 512, r() * 512, 0,
      r() * 512, r() * 512, 60 + r() * 130
    );
    const dark = r() > 0.5;
    g.addColorStop(0, dark ? "rgba(120,105,78,0.045)" : "rgba(255,250,238,0.05)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  }
  wallTex = new THREE.CanvasTexture(c);
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.colorSpace = THREE.SRGBColorSpace;
  wallTex.anisotropy = 4;
  return wallTex;
}

let floorTex: THREE.CanvasTexture | null = null;
let floorRough: THREE.CanvasTexture | null = null;
export function plankTextures(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  if (floorTex && floorRough) return { map: floorTex, roughnessMap: floorRough };
  const SIZE = 1024;
  const { c, ctx } = makeCanvas(SIZE, SIZE);
  const { c: cr, ctx: ctxR } = makeCanvas(SIZE, SIZE);
  const r = rng(23);
  const COLS = 7;
  const plankW = SIZE / COLS;
  ctx.fillStyle = "#5d4730";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctxR.fillStyle = "#8c8c8c";
  ctxR.fillRect(0, 0, SIZE, SIZE);

  for (let col = 0; col < COLS; col++) {
    let y = -r() * 300;
    while (y < SIZE) {
      const len = 260 + r() * 420;
      // plank base tone
      const base = 78 + r() * 38; // lightness seed
      ctx.fillStyle = `rgb(${base + 16},${base - 10},${base - 38})`;
      ctx.fillRect(col * plankW, y, plankW, len);
      // grain streaks
      for (let g = 0; g < 26; g++) {
        const gx = col * plankW + r() * plankW;
        ctx.strokeStyle = `rgba(${40 + r() * 30},${28 + r() * 22},${14 + r() * 14},${0.08 + r() * 0.14})`;
        ctx.lineWidth = 0.7 + r() * 1.6;
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.bezierCurveTo(
          gx + (r() - 0.5) * 14, y + len * 0.33,
          gx + (r() - 0.5) * 14, y + len * 0.66,
          gx + (r() - 0.5) * 10, y + len
        );
        ctx.stroke();
      }
      // occasional knot
      if (r() > 0.72) {
        const kx = col * plankW + plankW * (0.25 + r() * 0.5);
        const ky = y + len * (0.2 + r() * 0.6);
        const kr = 4 + r() * 7;
        const kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.4);
        kg.addColorStop(0, "rgba(38,26,14,0.85)");
        kg.addColorStop(0.5, "rgba(58,42,24,0.4)");
        kg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = kg;
        ctx.fillRect(kx - kr * 3, ky - kr * 3, kr * 6, kr * 6);
        ctxR.fillStyle = "rgba(255,255,255,0.25)";
        ctxR.beginPath();
        ctxR.arc(kx, ky, kr, 0, Math.PI * 2);
        ctxR.fill();
      }
      // butt joint shadow + slight sheen variation per plank
      ctx.fillStyle = "rgba(20,12,5,0.55)";
      ctx.fillRect(col * plankW, y + len - 1.6, plankW, 1.6);
      ctxR.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},0.06)`;
      ctxR.fillRect(col * plankW, y, plankW, len);
      y += len;
    }
    // plank gap
    ctx.fillStyle = "rgba(18,11,5,0.7)";
    ctx.fillRect(col * plankW - 1, 0, 2, SIZE);
    ctxR.fillStyle = "rgba(255,255,255,0.3)";
    ctxR.fillRect(col * plankW - 1, 0, 2, SIZE);
  }

  floorTex = new THREE.CanvasTexture(c);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.anisotropy = 8;
  floorRough = new THREE.CanvasTexture(cr);
  floorRough.wrapS = floorRough.wrapT = THREE.RepeatWrapping;
  return { map: floorTex, roughnessMap: floorRough };
}

// Resolve the page's next/font families for canvas drawing.
function cssFamily(cssVar: string, fallback: string): string {
  try {
    const el = document.createElement("span");
    el.style.fontFamily = `var(${cssVar})`;
    document.body.appendChild(el);
    const fam = getComputedStyle(el).fontFamily;
    el.remove();
    return fam || fallback;
  } catch {
    return fallback;
  }
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const probe = line ? line + " " + word : word;
    if (ctx.measureText(probe).width <= maxWidth || !line) {
      line = probe;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    const rest = words.slice(lines.join(" ").split(" ").length).join(" ");
    if (rest) {
      let last = lines[maxLines - 1];
      while (ctx.measureText(last + "…").width > maxWidth && last.includes(" ")) {
        last = last.slice(0, last.lastIndexOf(" "));
      }
      lines[maxLines - 1] = last + "…";
    }
  }
  return lines;
}

/** A wall label drawn like a real museum placard: artist, title, year. */
export function placardTexture(
  artist: string,
  title: string,
  year: number | null
): THREE.CanvasTexture {
  const W = 768;
  const H = 416;
  const { c, ctx } = makeCanvas(W, H);
  const serif = cssFamily("--font-serif", "Georgia, serif");
  const sans = cssFamily("--font-sans", "system-ui, sans-serif");

  // card
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#f8f3e7");
  bg.addColorStop(1, "#efe8d6");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // edge shading so the card reads as a physical object
  ctx.strokeStyle = "rgba(110,92,58,0.35)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);

  const PAD = 54;
  let y = 108;

  // artist — small caps feel
  ctx.fillStyle = "#5a5140";
  ctx.font = `500 34px ${sans}`;
  (ctx as any).letterSpacing = "7px";
  ctx.fillText(artist.toUpperCase(), PAD, y);
  (ctx as any).letterSpacing = "0px";
  // gold rule
  y += 26;
  const rule = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  rule.addColorStop(0, "rgba(168,133,60,0.85)");
  rule.addColorStop(1, "rgba(168,133,60,0.1)");
  ctx.fillStyle = rule;
  ctx.fillRect(PAD, y, W - PAD * 2, 3);

  // title — italic serif
  y += 78;
  ctx.fillStyle = "#2b2620";
  ctx.font = `italic 600 52px ${serif}`;
  const lines = wrapLines(ctx, title, W - PAD * 2, 2);
  for (const line of lines) {
    ctx.fillText(line, PAD, y);
    y += 62;
  }

  // year
  y += 14;
  ctx.fillStyle = "#6e6450";
  ctx.font = `300 38px ${sans}`;
  (ctx as any).letterSpacing = "4px";
  ctx.fillText(year ? String(year) : "date unknown", PAD, y);
  (ctx as any).letterSpacing = "0px";

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
