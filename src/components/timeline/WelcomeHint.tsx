"use client";

import { useCallback, useEffect, useRef } from "react";
import styles from "./WelcomeHint.module.css";

export const WELCOME_SEEN_KEY = "timeline-museum:welcome-seen:v1";

export function WelcomeHint({ focusOnOpen, onDismiss }: {
  focusOnOpen: boolean;
  onDismiss: (refocus: boolean) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusOnOpen) closeRef.current?.focus({ preventScroll: true });
  }, [focusOnOpen]);

  const dismiss = useCallback(() => {
    onDismiss(!!panelRef.current?.contains(document.activeElement));
  }, [onDismiss]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  return (
    <aside ref={panelRef} id="timeline-welcome" role="dialog" className={styles.panel} aria-labelledby="timeline-welcome-title">
      <button ref={closeRef} type="button" className={styles.close} aria-label="Close welcome hint" onClick={dismiss}>×</button>
      <p className={styles.eyebrow}>How to explore</p>
      <h2 id="timeline-welcome-title">From timeline to gallery.</h2>
      <ol>
        <li><strong>Zoom into a period</strong>Click a period name, scroll, or pinch.</li>
        <li><strong>Choose an artist</strong>Click or tap an artist, then “Enter the Gallery.”</li>
        <li><strong>Step inside and explore</strong>Walk among their works in a 3D gallery.</li>
      </ol>
      <button type="button" className={styles.start} onClick={dismiss}>Got it — let’s explore →</button>
      <p className={styles.once}>Find this guide again in Explore → How to explore</p>
    </aside>
  );
}
