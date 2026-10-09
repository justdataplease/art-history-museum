// The visitor's gallery settings, kept in this browser: walking pace, the canvas surface (weave and varnish) and
// whether the on-screen controls show. Controls reads the pace each frame (getSettings); every painting renders
// with the surface, the HUD with `hud` (useSetting).

import { useSyncExternalStore } from "react";

export type Pace = "slow" | "normal" | "fast" | "run";

export interface MuseumSettings {
  pace: Pace;
  /** The linen weave and varnish sheen on canvases; off shows the image plain and matte. */
  surface: boolean;
  /** The on-screen controls (title, navigator, hints, guide and music buttons). */
  hud: boolean;
}

/** Speed, m/s (a museum stroll is 1.0–1.4): a run by default; at a walking speed, holding W runs at twice it. */
export const PACE_SPEED: Record<Pace, number> = { slow: 1.3, normal: 2.0, fast: 3.1, run: 4.0 };
/** Tap-to-walk on touch, a little slower. */
export const TAP_PACE_SPEED: Record<Pace, number> = { slow: 1.1, normal: 1.7, fast: 2.4, run: 3.0 };

const KEY = "timeline-museum:settings";
const DEFAULTS: MuseumSettings = { pace: "run", surface: true, hud: true };

/** As saved: the speed is `walk`, so a `pace` saved before running was the default (by any setting saved, H
 *  included) gives way to it once. */
interface Saved {
  walk?: Pace;
  surface?: boolean;
  hud?: boolean;
}

let current: MuseumSettings | null = null;
const listeners = new Set<() => void>();

function load(): MuseumSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Saved;
    return {
      pace: saved.walk && saved.walk in PACE_SPEED ? saved.walk : DEFAULTS.pace,
      surface: typeof saved.surface === "boolean" ? saved.surface : DEFAULTS.surface,
      hud: typeof saved.hud === "boolean" ? saved.hud : DEFAULTS.hud,
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
    const saved: Saved = { walk: current.pace, surface: current.surface, hud: current.hud };
    localStorage.setItem(KEY, JSON.stringify(saved));
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
