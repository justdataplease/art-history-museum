"use client";

// Two independent touch sticks: movement on the left, camera look on the right.
// TouchPlayer reads their pushes each frame; releasing either thumb stops that input.

import { useEffect, useRef } from "react";
import { lookStick, stick } from "./Controls";
import styles from "./museum.module.css";

/** How far the knob travels from the centre, px. */
const REACH = 42;

export function TouchStick({ mode = "move" }: { mode?: "move" | "look" }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = base.current;
    const k = knob.current;
    if (!el || !k) return;
    const control = mode === "look" ? lookStick : stick;
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    const push = (x: number, y: number) => {
      const d = Math.hypot(x, y);
      const f = d > REACH ? REACH / d : 1;
      k.style.transform = `translate(${x * f}px, ${y * f}px)`;
      control.x = (x * f) / REACH;
      control.y = (-y * f) / REACH;
      control.wake?.();
    };
    const down = (e: PointerEvent) => {
      if (id !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
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
      control.active = true;
      push(e.clientX - cx, e.clientY - cy);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === id) push(e.clientX - cx, e.clientY - cy);
    };
    const reset = () => {
      const captured = id;
      id = null;
      delete el.dataset.active;
      k.style.transform = "";
      control.active = false;
      control.x = 0;
      control.y = 0;
      if (captured !== null && el.hasPointerCapture(captured)) el.releasePointerCapture(captured);
      control.wake?.();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === id) reset();
    };
    const onVisibility = () => {
      if (document.hidden) reset();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("lostpointercapture", up);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", onVisibility);
      reset();
    };
  }, [mode]);
  return (
    <div ref={base} className={`${styles.stick}${mode === "look" ? ` ${styles.stickLook}` : ""}`} data-touch-stick={mode} role="group" aria-label={mode === "look" ? "Look joystick" : "Movement joystick"}>
      <span className={styles.stickLabel}>{mode === "look" ? "Look" : "Move"}</span>
      <div ref={knob} className={styles.stickKnob} />
    </div>
  );
}
