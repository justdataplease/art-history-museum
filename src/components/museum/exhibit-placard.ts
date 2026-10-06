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
function fontFamilies(): { serif: string; sans: string } {
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
 * only, so drop a trailing parenthetical that names the artist or says
 * "painting"; any other parenthetical is part of the title and stays.
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
  return namesArtist || /\b(painting|series|artwork|picture)\b/.test(inner) ? m[1] : title;
}

/** Draw the label. Call after placardFontsReady(). */
export function drawPlacard(artist: string, title: string, year: number | null): THREE.CanvasTexture {
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
  const block = ARTIST_CAP + 17 + 2 + 50 + (lines.length - 1) * 41 + 9 + 41;
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
}
