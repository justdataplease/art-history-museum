// The visitor's gallery settings, kept in this browser: walking pace, the canvas surface (weave and varnish),
// whether the on-screen controls show, the graphics (quality.ts), and the audio guide's voice and speed. Controls
// reads the pace each frame (getSettings); every painting renders with the surface, the HUD with `hud` (useSetting); the guide reads its
// voice when it speaks (voice.ts). The kind of voice is kept under a key of its own (VOICE_KEY).

import { useSyncExternalStore } from "react";
import type { GraphicsChoice } from "./quality";
import { NATURAL_VOICES, voiceInfo } from "./voice";

export type Pace = "walk" | "run";
/** natural: the natural voice (voice.ts, Pocket), downloaded and run on this device, the default wherever it can
 *  run; browser: the browser's own voice (the one chosen from its list, else the most natural it has). */
export type GuideVoice = "natural" | "browser";
export const GUIDE_SPEEDS = [0.85, 1, 1.15, 1.3, 1.5] as const;

export interface MuseumSettings {
  pace: Pace;
  /** The linen weave and varnish sheen on canvases; off shows the image plain and matte. */
  surface: boolean;
  /** The on-screen controls (title, navigator, hints, guide and music buttons). */
  hud: boolean;
  /** How much the gallery draws (quality.ts): auto chooses for this computer. */
  graphics: GraphicsChoice;
  guideVoice: GuideVoice;
  /** Always the natural voice: it never gives way to the browser's, even when it has trouble here (voice.ts). */
  naturalLock: boolean;
  /** The AI voice (one of Pocket's, voice.ts NATURAL_VOICES) and the browser's (its voiceURI; "": the best it
   *  has). */
  aiVoice: string;
  browserVoice: string;
  /** The guide's reading speed (1: as recorded). */
  guideSpeed: number;
}

/** Speed, m/s: a run by default, twice the walk; walking, holding W runs. */
export const PACE_SPEED: Record<Pace, number> = { walk: 4.0, run: 8.0 };
/** Tap-to-walk and the stick on touch, a little slower. */
export const TAP_PACE_SPEED: Record<Pace, number> = { walk: 3.0, run: 6.0 };
/** Speeds saved before the two (Stroll, Walk, Brisk, Run; then Sprint). */
const OLD_PACE: Record<string, Pace> = { slow: "walk", normal: "walk", fast: "run", sprint: "run" };

const KEY = "timeline-museum:settings";
/** The kind of voice ("natural" or "browser"), apart since the natural voice became the default (2026-10-13): the
 *  `guideVoice` saved in KEY before, "auto" (the browser's) for most, is not read, so every visitor starts on it. */
const VOICE_KEY = "timeline-museum:guide-voice";
const DEFAULTS: MuseumSettings = {
  pace: "run", surface: true, hud: true, graphics: "auto", guideVoice: "natural", naturalLock: false,
  aiVoice: NATURAL_VOICES[0].id, browserVoice: "", guideSpeed: 1,
};

/** As saved: the speed is `walk`, so a `pace` saved before running was the default (by any setting saved, H
 *  included) gives way to it once; the AI voice is `aiVoice`, and only a Pocket voice is kept: one since removed
 *  (or "", the best of those for this computer) gives Alba. The kind of voice is in VOICE_KEY. */
interface Saved {
  walk?: string;
  surface?: boolean;
  hud?: boolean;
  graphics?: GraphicsChoice;
  naturalLock?: boolean;
  aiVoice?: string;
  browserVoice?: string;
  guideSpeed?: number;
}

let current: MuseumSettings | null = null;
const listeners = new Set<() => void>();

function load(): MuseumSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Saved;
    const ai = typeof saved.aiVoice === "string" && voiceInfo(saved.aiVoice) ? saved.aiVoice : null;
    return {
      pace: saved.walk && saved.walk in PACE_SPEED ? (saved.walk as Pace) : (saved.walk && OLD_PACE[saved.walk]) || DEFAULTS.pace,
      surface: typeof saved.surface === "boolean" ? saved.surface : DEFAULTS.surface,
      hud: typeof saved.hud === "boolean" ? saved.hud : DEFAULTS.hud,
      graphics: saved.graphics === "fast" || saved.graphics === "full" ? saved.graphics : DEFAULTS.graphics,
      guideVoice: localStorage.getItem(VOICE_KEY) === "browser" ? "browser" : DEFAULTS.guideVoice,
      naturalLock: saved.naturalLock === true,
      aiVoice: ai ?? DEFAULTS.aiVoice,
      browserVoice: typeof saved.browserVoice === "string" ? saved.browserVoice : DEFAULTS.browserVoice,
      guideSpeed:
        typeof saved.guideSpeed === "number" && saved.guideSpeed >= 0.5 && saved.guideSpeed <= 2 ? saved.guideSpeed : DEFAULTS.guideSpeed,
    };
  } catch {
    return DEFAULTS;
  }
}

export function getSettings(): MuseumSettings {
  if (typeof window === "undefined") return DEFAULTS;
  return (current ??= load());
}

export function setSettings(patch: Partial<MuseumSettings>) {
  current = { ...getSettings(), ...patch };
  try {
    const { pace: walk, surface, hud, graphics, guideVoice, naturalLock, aiVoice, browserVoice, guideSpeed } = current;
    const saved: Saved = { walk, surface, hud, graphics, naturalLock, aiVoice, browserVoice, guideSpeed };
    localStorage.setItem(KEY, JSON.stringify(saved));
    localStorage.setItem(VOICE_KEY, guideVoice);
  } catch {
    // no storage: the setting lasts this visit
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const serverSnapshot = () => DEFAULTS;

export function useSettings(): MuseumSettings {
  return useSyncExternalStore(subscribe, getSettings, serverSnapshot);
}

/** One setting: a component re-renders only when it changes. */
export function useSetting<K extends keyof MuseumSettings>(key: K): MuseumSettings[K] {
  return useSyncExternalStore(subscribe, () => getSettings()[key], () => DEFAULTS[key]);
}
