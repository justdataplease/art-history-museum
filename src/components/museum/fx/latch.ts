// The one bit of hidden-studio state the main bundle carries: whether the
// access phrase was given this visit. Everything else (tools, engine, HUD)
// is loaded on demand once it flips, and registers its own handlers here.

import { useSyncExternalStore } from "react";

let unlocked = false;
const listeners = new Set<() => void>();
let toggleHandler: (() => void) | null = null;
let audio: AudioContext | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export const latch = {
  get unlocked(): boolean {
    return unlocked;
  },
  unlock(): void {
    if (unlocked) return;
    unlocked = true;
    listeners.forEach((l) => l());
  },
  /** Forget the visit (leaving the gallery): the studio's audio context
   *  is closed too (a live one keeps the audio thread running). */
  reset(): void {
    if (audio) {
      audio.close().catch(() => {});
      audio = null;
    }
    if (!unlocked) return;
    unlocked = false;
    listeners.forEach((l) => l());
  },
  subscribe,
  /** The loaded HUD installs what P does once unlocked (show / hide the palette). */
  onToggle(fn: (() => void) | null): void {
    toggleHandler = fn;
  },
  toggle(): void {
    toggleHandler?.();
  },
  /** Start an audio context inside a user gesture (the studio's sound uses it). */
  primeAudio(): void {
    if (audio || typeof window === "undefined") return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      audio = new AC();
      audio.resume().catch(() => {});
    } catch {
      audio = null;
    }
  },
  /** A wrong phrase: no context left running. */
  releaseAudio(): void {
    if (!audio || unlocked) return;
    audio.close().catch(() => {});
    audio = null;
  },
  get audio(): AudioContext | null {
    return audio;
  },
};

export function useUnlocked(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => unlocked,
    () => false,
  );
}
