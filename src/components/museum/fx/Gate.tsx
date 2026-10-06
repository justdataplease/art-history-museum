"use client";

// P (not while typing) shows a slim, unlabeled field near the bottom centre.
// The right phrase loads the studio (palette, tools, engine) on demand;
// anything else and the field shudders and is gone, no hint. Once unlocked
// for the visit, P shows / hides the palette instead. On touch screens a
// long press on the gallery's title card does what P does (the field is
// focused inside that gesture, so the on-screen keyboard comes up).

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { matchesCode } from "./hash";
import { latch, useUnlocked } from "./latch";
import styles from "./gate.module.css";

const Hud = lazy(() => import("./Hud"));

const LONG_PRESS_MS = 900;
const WRONG_MS = 460;

/** What the studio needs from the museum's own audio. */
export interface FxAudioBridge {
  /** Duck the gallery music to `level` (0..1 of its normal level) over `seconds`. */
  duck(level: number, seconds: number): void;
  /** The museum is muted (M). */
  muted(): boolean;
}

export interface FxGateProps {
  /** the visitor is in the gallery (doors open) */
  ready: boolean;
  /** a painting is open in the inspect view (tools are hidden meanwhile) */
  inspecting: boolean;
  touch: boolean;
  /** touch screens: long-pressing this element opens the field (the title card) */
  secretTarget?: () => Element | null;
  audio?: FxAudioBridge;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

export function FxGate({ ready, inspecting, touch, secretTarget, audio }: FxGateProps) {
  const unlocked = useUnlocked();
  const [open, setOpen] = useState(false);
  const [wrong, setWrong] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const checking = useRef(false);
  const openedAt = useRef(0);
  const openRef = useRef(false);
  openRef.current = open;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const show = useCallback(() => {
    if (latch.unlocked) {
      latch.toggle();
      return;
    }
    // free the cursor so the visitor can type
    if (document.pointerLockElement) document.exitPointerLock?.();
    setOpen(true);
    openedAt.current = performance.now();
    const el = input.current;
    if (el) {
      el.value = "";
      el.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!readyRef.current || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "p" && e.key !== "P") return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      show();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  // touch: a long press on the title card
  useEffect(() => {
    if (!touch || !secretTarget) return;
    // Touch events, not pointer events: a long press the page does not own
    // ends in pointercancel, but touchend still arrives (and counts as a user
    // gesture, so focusing the field brings up the keyboard).
    let start: { x: number; y: number; t: number; id: number } | null = null;
    const inside = (x: number, y: number) => {
      const el = secretTarget();
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const down = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!readyRef.current || e.touches.length !== 1 || !t) {
        start = null;
        return;
      }
      start = inside(t.clientX, t.clientY) ? { x: t.clientX, y: t.clientY, t: performance.now(), id: t.identifier } : null;
    };
    const move = (e: TouchEvent) => {
      const s = start;
      if (!s) return;
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === s.id && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 12) start = null;
      }
    };
    const up = (e: TouchEvent) => {
      const s = start;
      start = null;
      if (!s || performance.now() - s.t < LONG_PRESS_MS) return;
      if (!Array.from(e.changedTouches).some((t) => t.identifier === s.id)) return;
      // no compat mouse events / click after this touch: they would take the focus away
      if (e.cancelable) e.preventDefault();
      show();
    };
    const menu = (e: Event) => {
      if (start) e.preventDefault();
    };
    const passive = { capture: true, passive: true } as const;
    const cap = { capture: true } as const;
    window.addEventListener("touchstart", down, passive);
    window.addEventListener("touchmove", move, passive);
    window.addEventListener("touchend", up, cap);
    window.addEventListener("touchcancel", up, cap);
    window.addEventListener("contextmenu", menu, cap);
    return () => {
      window.removeEventListener("touchstart", down, passive);
      window.removeEventListener("touchmove", move, passive);
      window.removeEventListener("touchend", up, cap);
      window.removeEventListener("touchcancel", up, cap);
      window.removeEventListener("contextmenu", menu, cap);
    };
  }, [touch, secretTarget, show]);

  // leaving the gallery forgets the visit
  useEffect(() => () => latch.reset(), []);

  const close = useCallback(() => {
    const el = input.current;
    if (el) {
      el.value = "";
      el.blur();
    }
    setOpen(false);
  }, []);

  const submit = useCallback(async () => {
    const el = input.current;
    if (!el || checking.current) return;
    checking.current = true;
    latch.primeAudio(); // inside the key gesture: Safari starts no audio later
    const ok = await matchesCode(el.value);
    checking.current = false;
    if (ok) {
      el.value = "";
      el.blur();
      setOpen(false);
      latch.unlock();
      return;
    }
    latch.releaseAudio();
    setWrong(true);
    setTimeout(() => {
      setWrong(false);
      close();
    }, WRONG_MS);
  }, [close]);

  return (
    <>
      <input
        ref={input}
        className={styles.field}
        data-open={open}
        data-wrong={wrong}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="go"
        maxLength={64}
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        onKeyDown={(e) => {
          // the gallery must not react to anything typed here
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        onKeyUp={(e) => e.stopPropagation()}
        onBlur={() => {
          if (checking.current || wrong) return;
          // focus lost to the tail of the gesture that opened the field: take it back
          if (performance.now() - openedAt.current < 500) {
            setTimeout(() => openRef.current && input.current?.focus({ preventScroll: true }), 0);
            return;
          }
          setTimeout(() => openRef.current && close(), 120);
        }}
      />
      {unlocked && (
        <Suspense fallback={null}>
          <Hud ready={ready} inspecting={inspecting} touch={touch} audio={audio} />
        </Suspense>
      )}
    </>
  );
}
