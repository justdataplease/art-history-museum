"use client";

// The walking stick on a touch screen, bottom left in the thumb's reach: push the knob the way to go (forward,
// back, a step aside, as one faces), as far as it is pushed, that fast; let go to stop. Dragging anywhere else
// looks round (TouchPlayer, which reads the push each frame from `stick`).

import { useEffect, useRef } from "react";
import { stick } from "./Controls";
import styles from "./museum.module.css";

/** How far the knob travels from the centre, px. */
const REACH = 42;

export function TouchStick() {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = base.current;
    const k = knob.current;
    if (!el || !k) return;
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    const push = (x: number, y: number) => {
      const d = Math.hypot(x, y);
      const f = d > REACH ? REACH / d : 1;
      k.style.transform = `translate(${x * f}px, ${y * f}px)`;
      stick.x = (x * f) / REACH;
      stick.y = (-y * f) / REACH;
      stick.wake?.();
    };
    const down = (e: PointerEvent) => {
      if (id !== null) return;
      id = e.pointerId;
      const r = el.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // capture is best-effort
      }
      el.dataset.active = "true";
      stick.active = true;
      push(e.clientX - cx, e.clientY - cy);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === id) push(e.clientX - cx, e.clientY - cy);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      delete el.dataset.active;
      k.style.transform = "";
      stick.active = false;
      stick.x = 0;
      stick.y = 0;
      stick.wake?.();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      stick.active = false;
      stick.x = 0;
      stick.y = 0;
    };
  }, []);
  return (
    <div ref={base} className={styles.stick} aria-hidden="true">
      <div ref={knob} className={styles.stickKnob} />
    </div>
  );
}
