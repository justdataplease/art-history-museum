// Studio state shared by the HUD (palette, tally) and the 3-D side (engine,
// input). Tiny external stores: React reads them through hooks, event
// handlers read them with .get() without re-rendering anything. The tally
// (counts, the hopper) changes fast, so it lives in its own store.

import { useSyncExternalStore } from "react";
import type { FxAudioBridge } from "./Gate";

export type Tool = "paint" | "brush" | "egg" | "marker" | "sword";

/** Palette order (keys 1–5; the mouse wheel steps through them). */
export const TOOL_ORDER: Tool[] = ["paint", "brush", "egg", "marker", "sword"];

export function isHeld(t: Tool | null): t is "marker" | "sword" {
  return t === "marker" || t === "sword";
}

/** Classic artists' colours (sRGB hex). */
export const PAINT_COLORS: { name: string; hex: string }[] = [
  { name: "Cadmium red", hex: "#c8201e" },
  { name: "Cadmium orange", hex: "#ec6a16" },
  { name: "Cadmium yellow", hex: "#f4c20d" },
  { name: "Viridian", hex: "#0f7a4f" },
  { name: "Ultramarine", hex: "#1d3594" },
  { name: "Magenta", hex: "#c4166d" },
  { name: "Titanium white", hex: "#f3f0e8" },
  { name: "Ivory black", hex: "#17161a" },
];

/** Brush widths (m) and how far a full load lasts (m), small → large. */
export const BRUSH_SIZES: { width: number; reach: number; label: string }[] = [
  { width: 0.016, reach: 0.5, label: "Small" },
  { width: 0.04, reach: 0.75, label: "Medium" },
  { width: 0.085, reach: 1.0, label: "Large" },
];

export interface FxState {
  /** the palette is open */
  open: boolean;
  /** tool in hand (null: tools down, normal click-to-inspect) */
  tool: Tool | null;
  color: string;
  brush: number;
  /** the marker shoots random team colours instead of the palette colour */
  team: boolean;
  /** the conservator is at work */
  cleaning: boolean;
  /** anything has been damaged since the last clean (for the conservator button) */
  dirty: boolean;
  /** when the conservator last finished (ms, performance.now; 0: never) */
  restoredAt: number;
}

function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T>): void {
      const next = { ...state, ...patch };
      if ((Object.keys(patch) as (keyof T)[]).every((k) => next[k] === state[k])) return;
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    initial,
  };
}

const main = createStore<FxState>({
  open: false,
  tool: null,
  color: PAINT_COLORS[0].hex,
  brush: 1,
  team: false,
  cleaning: false,
  dirty: false,
  restoredAt: 0,
});

export interface Tally {
  paint: number;
  egg: number;
  ball: number;
  cut: number;
  /** metres of brush on canvas */
  brush: number;
  /** distinct works touched */
  works: number;
  balls: number;
  cap: number;
  refilling: boolean;
}

const tally = createStore<Tally>({ paint: 0, egg: 0, ball: 0, cut: 0, brush: 0, works: 0, balls: 0, cap: 0, refilling: false });

type Listener = () => void;
const cleanListeners = new Set<Listener>();
const refillListeners = new Set<Listener>();
let audio: FxAudioBridge | null = null;
/** a duck asked for before the bridge arrived (the chunks load in any order) */
let lastDuck: [number, number] | null = null;

function on(set: Set<Listener>, cb: Listener): () => void {
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

export const fx = {
  get: main.get,
  subscribe: main.subscribe,
  /** First unlock: the palette opens with the paint in hand. */
  start: () => main.set({ open: true, tool: main.get().tool ?? "paint" }),
  /** P after unlocking: show / hide the palette (hiding puts the tools down). */
  togglePalette: () => {
    const s = main.get();
    if (s.open) main.set({ open: false, tool: null });
    else main.set({ open: true, tool: s.tool ?? "paint" });
  },
  setTool: (tool: Tool | null) => main.set({ tool, open: main.get().open || tool !== null }),
  /** Step through the tools (the mouse wheel). */
  cycleTool: (dir: 1 | -1) => {
    const s = main.get();
    const n = TOOL_ORDER.length;
    const i = s.tool ? TOOL_ORDER.indexOf(s.tool) : dir > 0 ? -1 : 0;
    main.set({ tool: TOOL_ORDER[(i + dir + n) % n] });
  },
  putDown: () => main.set({ tool: null }),
  setColor: (color: string) => main.set({ color, team: false }),
  setTeam: (team: boolean) => main.set({ team }),
  cycleColor: (dir: 1 | -1) => {
    const s = main.get();
    const i = PAINT_COLORS.findIndex((c) => c.hex === s.color);
    const n = PAINT_COLORS.length;
    main.set({ color: PAINT_COLORS[((i < 0 ? 0 : i + dir) + n) % n].hex, team: false });
  },
  setBrush: (brush: number) => main.set({ brush: Math.max(0, Math.min(BRUSH_SIZES.length - 1, brush)) }),
  markDirty: () => main.set({ dirty: true }),
  /** Ask the engine to clean up (it calls cleaned() when done). */
  requestClean: () => {
    if (main.get().cleaning) return;
    main.set({ cleaning: true });
    cleanListeners.forEach((l) => l());
  },
  cleaned: () => main.set({ cleaning: false, dirty: false, restoredAt: performance.now() }),
  onClean: (cb: Listener) => on(cleanListeners, cb),
  /** R: refill the marker's hopper. */
  requestRefill: () => refillListeners.forEach((l) => l()),
  onRefill: (cb: Listener) => on(refillListeners, cb),
  /** Leaving the gallery: forget the visit (the paint goes with the scene). */
  reset: () => {
    main.set({ ...main.initial });
    tally.set({ ...tally.initial });
  },
  // ---- the museum's music
  setAudio: (a: FxAudioBridge | null) => {
    audio = a;
    if (a && lastDuck) a.duck(lastDuck[0], lastDuck[1]);
  },
  duck: (level: number, seconds: number) => {
    lastDuck = [level, seconds];
    audio?.duck(level, seconds);
  },
  muted: () => audio?.muted() ?? null,
};

export const fxTally = {
  get: tally.get,
  subscribe: tally.subscribe,
  add(kind: "paint" | "egg" | "ball" | "cut" | "brush" | "works", amount: number): void {
    tally.set({ [kind]: tally.get()[kind] + amount } as Partial<Tally>);
  },
  hopper(balls: number, cap: number, refilling: boolean): void {
    tally.set({ balls, cap, refilling });
  },
};

export function useFx(): FxState {
  return useSyncExternalStore(main.subscribe, main.get, () => main.initial);
}

export function useTally(): Tally {
  return useSyncExternalStore(tally.subscribe, tally.get, () => tally.initial);
}

/** A tool is in hand: clicks / taps throw, paint, shoot or cut instead of inspecting. */
export function armed(): boolean {
  const s = main.get();
  return s.open && s.tool !== null && !s.cleaning;
}
