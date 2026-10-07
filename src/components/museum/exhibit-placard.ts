// Wall labels: an ivory card with the artist in spaced capitals over a gold
// rule, the title in italic serif and the year — drawn once the page's web
// fonts have actually loaded (canvas text never re-renders on font load).

import * as THREE from "three";

/** Texture resolution (card size on the wall: layout's PLACARD_W × PLACARD_H). */
export const PLACARD_TEX_W = 512;
export const PLACARD_TEX_H = 277;
export const PLACARD_T = 0.006; // card thickness

let families: { serif: string; sans: string } | null = null;

/** Resolve the next/font family lists once (each lookup forces a style recalc). */
export function fontFamilies(): { serif: string; sans: string } {
  if (families) return families;
  const resolve = (cssVar: string, fallback: string) => {
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
  };
  families = {
    serif: resolve("--font-serif", "Georgia, serif"),
    sans: resolve("--font-sans", "system-ui, sans-serif"),
  };
  return families;
}

// Font specs at 512 px card width (768-px design scaled by 2/3).
const ARTIST_FONT = (sans: string) => `500 23px ${sans}`;
const TITLE_FONT = (serif: string) => `italic 600 35px ${serif}`;
const YEAR_FONT = (sans: string) => `400 25px ${sans}`;

let fontsReady: Promise<void> | null = null;

/** Resolves once the three placard faces are loaded (or after a 3 s safety timeout). */
export function placardFontsReady(): Promise<void> {
  if (fontsReady) return fontsReady;
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts) return (fontsReady = Promise.resolve());
  const { serif, sans } = fontFamilies();
  const load = Promise.all([
    fonts.load(ARTIST_FONT(sans), "AZ"),
    fonts.load(TITLE_FONT(serif), "Ag"),
    fonts.load(YEAR_FONT(sans), "19"),
  ])
    .then(() => fonts.ready)
    .then(() => undefined)
    .catch(() => undefined);
  const timeout = new Promise<void>((r) => setTimeout(r, 3000));
  fontsReady = Promise.race([load, timeout]);
  return fontsReady;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const word of words) {
    const probe = line ? line + " " + word : word;
    if (ctx.measureText(probe).width <= maxWidth || !line) {
      line = probe;
      used++;
    } else {
      lines.push(line);
      if (lines.length === maxLines) break;
      line = word;
      used++;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (used < words.length || lines.length > maxLines) {
    let last = lines[maxLines - 1] ?? "";
    while (ctx.measureText(last + "…").width > maxWidth && last.includes(" ")) {
      last = last.slice(0, last.lastIndexOf(" "));
    }
    lines.length = Math.min(lines.length, maxLines);
    lines[lines.length - 1] = last + "…";
  }
  return lines;
}

/**
 * Wikipedia article titles carry disambiguators — "The Fortune Teller
 * (Caravaggio)", "Sunflowers (Van Gogh series)". A wall label names the work
 * only, so drop a trailing parenthetical that names the artist or the medium
 * ("painting", "pair of paintings", "mural"); any other stays in the title.
 */
export function displayTitle(title: string, artist: string): string {
  const m = /^(.*\S)\s*\(([^()]*)\)\s*$/.exec(title);
  if (!m) return title;
  const inner = m[2].toLowerCase();
  const names = artist
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((w) => w.length > 2 && !["van", "von", "der", "del", "della", "de", "the"].includes(w));
  const namesArtist = names.some((n) => inner.includes(n));
  return namesArtist || /\b(paintings?|series|artworks?|pictures?|murals?|frescos|frescoes|fresco)\b/.test(inner)
    ? m[1]
    : title;
}

/** Draw the label. Call after placardFontsReady(). A work still in
 *  copyright gets "© In copyright" on the year line, as museums credit it. */
export function drawPlacard(
  artist: string,
  title: string,
  year: number | null,
  copyrighted = false,
  dimensions = ""
): THREE.CanvasTexture {
  const W = PLACARD_TEX_W;
  const H = PLACARD_TEX_H;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const { serif, sans } = fontFamilies();

  // card
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#f8f3e7");
  bg.addColorStop(1, "#efe8d6");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(110,92,58,0.32)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  const PAD = 36;
  const ls = (px: string) => {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = px;
  };

  // lay out first so the text block sits centred on the card
  ctx.font = TITLE_FONT(serif);
  const lines = wrapLines(ctx, displayTitle(title, artist), W - PAD * 2, 2);
  const ARTIST_CAP = 17; // cap height of the 23 px artist line
  ctx.font = `22px ${sans}`;
  const dimensionLines = dimensions ? wrapLines(ctx, dimensions, W - PAD * 2, 2) : [];
  const block = ARTIST_CAP + 17 + 2 + 50 + (lines.length - 1) * 41 + 9 + 41 + dimensionLines.length * 30;
  let y = Math.round((H - block) / 2 + ARTIST_CAP);

  // artist — spaced capitals
  ctx.fillStyle = "#4a4233";
  ctx.font = ARTIST_FONT(sans);
  ls("4.6px");
  ctx.fillText(artist.toUpperCase(), PAD, y, W - PAD * 2);
  ls("0px");

  // gold rule
  y += 17;
  const rule = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  rule.addColorStop(0, "rgba(168,133,60,0.85)");
  rule.addColorStop(1, "rgba(168,133,60,0.1)");
  ctx.fillStyle = rule;
  ctx.fillRect(PAD, y, W - PAD * 2, 2);

  // title — italic serif, up to two lines
  y += 52;
  ctx.fillStyle = "#211d18";
  ctx.font = TITLE_FONT(serif);
  lines.forEach((line, i) => {
    if (i) y += 41;
    ctx.fillText(line, PAD, y);
  });

  // year
  y += 50;
  ctx.fillStyle = "#463d2f";
  ctx.font = YEAR_FONT(sans);
  ls("2.6px");
  ctx.fillText(year ? String(year) : "date unknown", PAD, y);
  if (copyrighted) {
    ctx.fillStyle = "#7c5d2e";
    ls("2.2px");
    ctx.textAlign = "right";
    ctx.fillText("© IN COPYRIGHT", W - PAD, y);
    ctx.textAlign = "left";
  }
  ls("0px");

  ctx.font = `22px ${sans}`;
  ctx.fillStyle = "#645b4b";
  for (const line of dimensionLines) {
    y += 30;
    ctx.fillText(line, PAD, y);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

let primed: THREE.DataTexture | null = null;
/** Plain primed linen, shown for the instant before a withheld work's canvas is drawn. */
export function primedCanvasTexture(): THREE.DataTexture {
  if (primed) return primed;
  primed = new THREE.DataTexture(new Uint8Array([226, 219, 203, 255]), 1, 1);
  primed.colorSpace = THREE.SRGBColorSpace;
  primed.needsUpdate = true;
  return primed;
}

/**
 * What hangs in place of a work still in copyright (Wikipedia shows such
 * works only under fair use, which does not extend to this site): a primed,
 * unpainted linen canvas of the work's own proportions with a large embossed
 * ©, the title, the year, and a line saying why, pointing to Wikipedia.
 * Call after placardFontsReady().
 */
export function drawWithheldCanvas(
  artist: string,
  title: string,
  year: number | null,
  aspect: number,
): THREE.CanvasTexture {
  // Sized by the canvas's own aspect (never clamped, which would stretch the
  // lettering): a 1024 px long side, longer for a very thin canvas so its
  // short side keeps ~256 px for the text (up to 4096 px).
  const k = Math.max(1e-3, Math.min(aspect, 1 / aspect));
  const long = Math.min(4096, Math.max(1024, 256 / k));
  const short = Math.max(1, Math.round(long * k));
  const W = aspect >= 1 ? Math.round(long) : short;
  const H = aspect >= 1 ? short : Math.round(long);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const { serif, sans } = fontFamilies();
  const ls = (px: string) => {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = px;
  };
  const S = Math.min(W, H);

  // primed linen: warm ground, a soft vignette, a faint weave
  const bg = ctx.createLinearGradient(0, 0, W * 0.3, H);
  bg.addColorStop(0, "#ebe5d8");
  bg.addColorStop(1, "#ddd5c4");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const vig = ctx.createRadialGradient(W / 2, H / 2, S * 0.2, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  vig.addColorStop(0, "rgba(255,255,255,0)");
  vig.addColorStop(1, "rgba(120,104,78,0.16)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#6b5d45";
  for (let x = 0; x < W; x += 3) ctx.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.globalAlpha = 1;
  // a fine ruled border, as on a museum panel
  ctx.strokeStyle = "rgba(110,92,58,0.28)";
  ctx.lineWidth = Math.max(2, S * 0.004);
  const inset = S * 0.06;
  ctx.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const cx = W / 2;
  // the embossed ©: light from the top left
  const big = Math.round(S * 0.34);
  const cy = H * 0.42;
  ctx.font = `400 ${big}px ${serif}`;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText("©", cx - S * 0.004, cy - S * 0.004);
  ctx.fillStyle = "rgba(70,58,38,0.32)";
  ctx.fillText("©", cx + S * 0.005, cy + S * 0.005);
  ctx.fillStyle = "#e2dbcb";
  ctx.fillText("©", cx, cy);

  // the title, up to three lines, then the year
  const maxW = W - 2 * inset - S * 0.1;
  const tSize = Math.round(S * 0.062);
  ctx.font = `italic 600 ${tSize}px ${serif}`;
  const lines = wrapLines(ctx, displayTitle(title, artist), maxW, 3);
  let y = cy + S * 0.15;
  ctx.fillStyle = "#2a241c";
  for (const line of lines) {
    ctx.fillText(line, cx, y);
    y += tSize * 1.18;
  }
  ctx.font = `400 ${Math.round(S * 0.034)}px ${sans}`;
  ls(`${Math.round(S * 0.006)}px`);
  ctx.fillStyle = "#4a4233";
  ctx.fillText(year ? String(year) : "date unknown", cx, y + S * 0.01);
  ls("0px");

  // why, and where to see it
  const small = Math.round(S * 0.028);
  ctx.font = `400 ${small}px ${sans}`;
  ctx.fillStyle = "#5c5342";
  const why = wrapLines(ctx, "Still in copyright \u2014 this work can\u2019t be shown here.", maxW, 2);
  let wy = H - inset - S * 0.13 - (why.length - 1) * small * 1.3;
  for (const line of why) {
    ctx.fillText(line, cx, wy);
    wy += small * 1.3;
  }
  ctx.font = `500 ${small}px ${sans}`;
  ls(`${Math.round(S * 0.005)}px`);
  ctx.fillStyle = "#8a6a32";
  ctx.fillText("SEE IT ON WIKIPEDIA", cx, H - inset - S * 0.06);
  ls("0px");

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

let blank: THREE.DataTexture | null = null;
/** Plain card colour shown for the instant before the fonts are ready. */
export function blankPlacardTexture(): THREE.DataTexture {
  if (blank) return blank;
  blank = new THREE.DataTexture(new Uint8Array([244, 238, 223, 255]), 1, 1);
  blank.colorSpace = THREE.SRGBColorSpace;
  blank.needsUpdate = true;
  return blank;
}

/** Free the blank card from every renderer that uploaded it (exhibit-shared.ts); it stays usable. */
export function disposeBlankPlacardTexture(): void {
  blank?.dispose();
  primed?.dispose();
}
