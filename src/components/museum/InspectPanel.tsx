"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { INSPECT_SHEET_BREAKPOINT, type Placement } from "./layout";
import { displayTitle } from "./exhibit-placard";
import styles from "./museum.module.css";

/** The story card beside an inspected painting: a right-hand column on wide
 *  screens, a bottom sheet on narrow ones (see inspectPanelInset in layout.ts,
 *  which the inspect camera uses to frame the painting in the free area). */
export function InspectPanel({
  placement,
  onClose,
  touch = false,
  artistName = "",
}: {
  placement: Placement | null;
  onClose: () => void;
  touch?: boolean;
  /** Used to drop Wikipedia's "(Artist)" disambiguator from titles, as the wall labels do. */
  artistName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Keep the last placement so content stays during the exit slide.
  const [shown, setShown] = useState<Placement | null>(null);
  const placementRef = useRef(placement);
  const visible = useRef(false);

  useLayoutEffect(() => {
    placementRef.current = placement;
    const el = ref.current;
    if (!el) return;
    const narrow = window.matchMedia(`(max-width: ${INSPECT_SHEET_BREAKPOINT}px)`).matches;
    const items = el.querySelectorAll(".insp-scroll > *");
    // A new open/close supersedes whatever is still animating.
    gsap.killTweensOf(el);
    gsap.killTweensOf(items);
    const hidden = narrow
      ? { x: 0, y: 0, xPercent: 0, yPercent: 105 }
      : { x: 0, y: 0, xPercent: 105, yPercent: 0 };

    if (placement) {
      setShown(placement);
      scrollRef.current?.scrollTo(0, 0);
      if (!visible.current) gsap.set(el, hidden);
      visible.current = true;
      gsap.to(el, {
        x: 0,
        y: 0,
        xPercent: 0,
        yPercent: 0,
        duration: 0.85,
        delay: 0.5,
        ease: "power3.out",
      });
      gsap.fromTo(
        items,
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.07, delay: 0.75, ease: "power2.out" }
      );
    } else if (visible.current) {
      gsap.to(el, {
        ...hidden,
        duration: 0.5,
        ease: "power3.in",
        onComplete: () => {
          visible.current = false;
          if (!placementRef.current) setShown(null);
        },
      });
    }
  }, [placement]);

  useEffect(
    () => () => {
      const el = ref.current;
      if (el) gsap.killTweensOf(el);
    },
    []
  );

  const p = (placement ?? shown)?.painting;

  return (
    <div
      className={`insp-panel ${styles.panel}`}
      ref={ref}
      style={{ transform: "translateX(105%)" }}
      aria-hidden={!placement}
    >
      {p && (
        <>
          <button className="insp-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
          <div className="insp-scroll" ref={scrollRef} key={p.slug}>
            <div className="insp-eyebrow">From the collection</div>
            <h2 className="insp-title">{displayTitle(p.title, artistName)}</h2>
            {p.year && <div className="insp-year">{p.year}</div>}
            <p className="insp-story">{p.story}</p>
            {p.facts.length > 0 && (
              <div className="insp-facts">
                <h3>Worth knowing</h3>
                {p.facts.map((f, i) => (
                  <p key={i} className="insp-fact">
                    {f}
                  </p>
                ))}
              </div>
            )}
            {p.wikipediaUrl && (
              <a className="insp-wiki" href={p.wikipediaUrl} target="_blank" rel="noreferrer">
                Source · Wikipedia
              </a>
            )}
          </div>
          <div className="insp-zoom-hint">
            {touch ? "Pinch to lean in · ✕ to step back" : "Scroll to lean in · Esc to step back"}
          </div>
        </>
      )}
    </div>
  );
}
