// The visitor's gallery settings, kept in this browser: walking pace, the canvas surface (weave and varnish) and
// whether the on-screen controls show. Read every frame by Controls (pace) and by every painting (surface).

import { useSyncExternalStore } from "react";

export type Pace = "slow" | "normal" | "fast";

export interface MuseumSettings {
  pace: Pace;
  /** The linen weave and varnish sheen on canvases; off shows the image plain and matte. */
  surface: boolean;
  /** The on-screen controls (title, navigator, hints, guide and music buttons). */
  hud: boolean;
}

/** Walking speed, m/s (a museum stroll is 1.0–1.4); holding W runs at twice it. */
export const PACE_SPEED: Record<Pace, number> = { slow: 1.3, normal: 2.0, fast: 3.1 };
/** Tap-to-walk on touch, a little slower than walking. */
export const TAP_PACE_SPEED: Record<Pace, number> = { slow: 1.1, normal: 1.7, fast: 2.4 };

const KEY = "timeline-museum:settings";
const DEFAULTS: MuseumSettings = { pace: "normal", surface: true, hud: true };

let current: MuseumSettings | null = null;
const listeners = new Set<() => void>();

function load(): MuseumSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<MuseumSettings>;
    return {
      pace: saved.pace && saved.pace in PACE_SPEED ? saved.pace : DEFAULTS.pace,
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
    localStorage.setItem(KEY, JSON.stringify(current));
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
