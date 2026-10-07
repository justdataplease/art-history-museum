"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./WelcomeHint.module.css";

const SEEN_KEY = "timeline-museum:welcome-seen:v1";

export function WelcomeHint({ hidden }: { hidden: boolean }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const helpRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(SEEN_KEY) !== "1");
    } catch {
      setOpen(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    try { localStorage.setItem(SEEN_KEY, "1"); } catch {}
    if (panelRef.current?.contains(document.activeElement)) helpRef.current?.focus({ preventScroll: true });
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open || hidden) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hidden, dismiss]);

  return (
    <>
      <button ref={helpRef} type="button" className={styles.help} aria-expanded={open && !hidden} aria-controls="timeline-welcome" onClick={() => {
        setOpen(true);
        requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
      }}>
        How to explore
      </button>
      {open && !hidden && (
        <aside ref={panelRef} id="timeline-welcome" className={styles.panel} aria-labelledby="timeline-welcome-title">
          <button ref={closeRef} type="button" className={styles.close} aria-label="Close welcome hint" onClick={dismiss}>×</button>
          <p className={styles.eyebrow}>Your first visit</p>
          <h2 id="timeline-welcome-title">From timeline to gallery.</h2>
          <ol>
            <li><strong>Zoom into a period</strong>Click a period name, scroll, or pinch.</li>
            <li><strong>Choose an artist</strong>Click or tap an artist, then “Enter the Gallery.”</li>
            <li><strong>Step inside and explore</strong>Walk among their works in a 3D gallery.</li>
          </ol>
          <button type="button" className={styles.start} onClick={dismiss}>Got it — let’s explore →</button>
          <p className={styles.once}>Shown once · “How to explore” brings it back</p>
        </aside>
      )}
    </>
  );
}
