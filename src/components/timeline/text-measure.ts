// Label widths for collision-free placement. Measured with a 2D canvas in the
// real web fonts once they are loaded; a per-face estimate before that (and on
// the server, where nothing is rendered from it).

export type Face = "serif" | "serif-caps" | "serif-italic-caps" | "sans" | "sans-caps";

interface FontSpec {
  family: "serif" | "sans";
  weight: number;
  italic?: boolean;
  caps?: boolean;
  /** letter-spacing in em */
  track: number;
  /** rough advance per char in em (fallback estimate) */
  est: number;
}

const FACES: Record<Face, FontSpec> = {
  serif: { family: "serif", weight: 600, track: 0.04, est: 0.5 },
  "serif-caps": { family: "serif", weight: 600, caps: true, track: 0.2, est: 0.7 },
  "serif-italic-caps": { family: "serif", weight: 500, italic: true, caps: true, track: 0.26, est: 0.66 },
  sans: { family: "sans", weight: 400, track: 0.12, est: 0.55 },
  "sans-caps": { family: "sans", weight: 400, caps: true, track: 0.16, est: 0.66 },
};

let ctx: CanvasRenderingContext2D | null = null;
let families: { serif: string; sans: string } | null = null;
let ready = false;
const cache = new Map<string, number>();

function getCtx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!ctx) {
    ctx = document.createElement("canvas").getContext("2d");
    const cs = getComputedStyle(document.documentElement);
    families = {
      serif: cs.getPropertyValue("--font-serif").trim() || "Georgia, serif",
      sans: cs.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif",
    };
  }
  return ctx;
}

/** Width in px of `text` set in `face` at `size` px (including letter-spacing). */
export function textWidth(text: string, face: Face, size: number): number {
  const spec = FACES[face];
  const s = spec.caps ? text.toUpperCase() : text;
  const key = `${face}|${size}|${s}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const c = ready ? getCtx() : null;
  let w: number;
  if (c && families) {
    c.font = `${spec.italic ? "italic " : ""}${spec.weight} ${size}px ${families[spec.family]}`;
    w = c.measureText(s).width + s.length * spec.track * size;
  } else {
    w = s.length * (spec.est + spec.track) * size;
  }
  w = Math.ceil(w) + 1;
  cache.set(key, w);
  return w;
}

/** Resolve once the page fonts are usable; switches to exact measurement. */
export function whenFontsReady(cb: () => void): void {
  if (typeof document === "undefined") return;
  const done = () => {
    ready = true;
    ctx = null;
    cache.clear();
    cb();
  };
  if (ready) return;
  if (document.fonts?.ready) document.fonts.ready.then(done, done);
  else done();
}

/** "Leonardo da Vinci" → "da Vinci", "Élisabeth Vigée Le Brun" → "Le Brun". */
export function shortName(name: string): string {
  const parts = name.split(/\s+/);
  if (parts.length <= 2 && /^(el|fra|la|le)$/i.test(parts[0])) return name;
  if (parts.length === 1) return name;
  const particles = /^(van|von|de|da|di|del|della|du|des|le|la|ten|ter)$/i;
  let i = parts.length - 1;
  while (i > 0 && particles.test(parts[i - 1])) i--;
  return parts.slice(i).join(" ");
}
