// How much the gallery draws, for the computer it runs on. Two tiers:
// - full: edges smoothed (MSAA), up to 1.5 device pixels per CSS pixel, the floor's reflection, a ceiling area
//   light in the visitor's room, the one behind and the two ahead, close-up textures at the works one stands at;
// - fast: for weak graphics (older Intel HD / UHD, software renderers) and small machines (4 cores or 4 GB or
//   fewer): no smoothing, 1 pixel per CSS pixel (0.75 if walking still stutters), no floor reflection (its pass
//   draws the whole scene a second time: half the work of a frame), two area lights (each costs every lit pixel),
//   no close-up textures (the largest uploads), less anisotropic filtering.
// Settings → Graphics chooses: Auto (the default) picks fast where the graphics or the machine look weak, and
// steps down while walking stutters (Gallery's AdaptiveDpr): the reflection goes at once, and the next gallery
// starts fast (remembered on this device). Smoothing and the light count are fixed for a gallery's life (three.js
// compiles its programs for a light count; the canvas is created smoothed or not), so a change of tier takes them
// from the next gallery; the reflection and the resolution follow at once.

import { getSettings } from "./settings";

export type GraphicsChoice = "auto" | "fast" | "full";
export type QualityTier = "fast" | "full";

export interface Quality {
  tier: QualityTier;
  antialias: boolean;
  /** Device-pixel-ratio range (adaptive resolution works within it). */
  dprMax: number;
  dprMin: number;
  /** Ceiling area lights (a suite's pool; a single room has one). */
  areaLights: number;
  /** Close-up textures for the works the visitor stands at. */
  near: boolean;
  anisotropy: number;
}

const TIERS: Record<QualityTier, Quality> = {
  full: { tier: "full", antialias: true, dprMax: 1.5, dprMin: 1, areaLights: 4, near: true, anisotropy: 16 },
  fast: { tier: "fast", antialias: false, dprMax: 1, dprMin: 0.75, areaLights: 2, near: false, anisotropy: 4 },
};

/** Auto stepped down on this device (walking stuttered at full). */
const STEPPED_KEY = "timeline-museum:graphics-stepped-down";
/** The graphics' name, once per visit (reading it takes a throwaway WebGL context). */
const GPU_KEY = "timeline-museum:gpu";

/** Graphics too weak for the full tier: Intel's older integrated (HD, UHD, Iris Plus; Iris Xe and Arc are fine),
 *  software renderers, low-end phone GPUs. */
const WEAK_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|intel.{0,12}\b(hd|uhd)\b|iris\(?r?\)? plus|iris pro|mali-[gt]?\d{2}\b|adreno[^\d]*[2-5]\d\d\b|powervr/i;

function gpuName(): string {
  try {
    const kept = sessionStorage.getItem(GPU_KEY);
    if (kept !== null) return kept;
  } catch {}
  let name = "";
  try {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {}
  try {
    sessionStorage.setItem(GPU_KEY, name);
  } catch {}
  return name;
}

/** Why Auto chose fast here (null: it chose full). */
export function weakReason(): string | null {
  if (typeof window === "undefined") return null;
  try {
    if (localStorage.getItem(STEPPED_KEY) === "1") return "walking stuttered here at full";
  } catch {}
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((navigator.hardwareConcurrency ?? 8) <= 4) return "a processor of 4 cores or fewer";
  if ((nav.deviceMemory ?? 8) <= 4) return "4 GB of memory or less";
  if (WEAK_GPU.test(gpuName())) return "its graphics";
  return null;
}

/** The tier for the visitor's choice. */
export function tierFor(choice: GraphicsChoice): QualityTier {
  if (choice !== "auto") return choice;
  return weakReason() ? "fast" : "full";
}

let current: Quality = TIERS.full;

/** The settings a gallery starts with (read once, as its canvas is created; kept for what reads it later). */
export function galleryQuality(): Quality {
  if (typeof window === "undefined") return TIERS.full;
  return (current = TIERS[tierFor(getSettings().graphics)]);
}

/** The tier the gallery on screen started with (its textures' filtering follows it). */
export function currentQuality(): Quality {
  return current;
}

export function qualityOf(tier: QualityTier): Quality {
  return TIERS[tier];
}

// ---- what follows a change at once: the floor's reflection (room-floor.tsx reads it each frame)

let reflection = true;
const listeners = new Set<() => void>();

export function reflectionOn(): boolean {
  return reflection;
}
export function setReflection(on: boolean) {
  if (reflection === on) return;
  reflection = on;
  listeners.forEach((f) => f());
}
export function onReflection(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Auto found walking too slow at full: from the next gallery, fast (until the visitor chooses Full). */
export function rememberSteppedDown() {
  try {
    localStorage.setItem(STEPPED_KEY, "1");
  } catch {}
}
/** The visitor chose a tier themselves: Auto starts afresh. */
export function forgetSteppedDown() {
  try {
    localStorage.removeItem(STEPPED_KEY);
  } catch {}
}
