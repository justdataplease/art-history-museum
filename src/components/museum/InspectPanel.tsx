"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import type { Placement } from "./layout";

export function InspectPanel({
  placement,
  onClose,
}: {
  placement: Placement | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the last placement so content stays during the exit slide.
  const [shown, setShown] = useState<Placement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (placement) {
      setShown(placement);
      gsap.to(el, {
        x: 0,
        duration: 0.85,
        delay: 0.5,
        ease: "power3.out",
      });
      gsap.fromTo(
        el.querySelectorAll(".insp-scroll > *"),
        { opacity: 0, y: 18 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.07, delay: 0.75, ease: "power2.out" }
      );
    } else {
      gsap.to(el, {
        x: "105%",
        duration: 0.5,
        ease: "power3.in",
        onComplete: () => setShown(null),
      });
    }
  }, [placement]);

  const p = (placement ?? shown)?.painting;

  return (
    <div className="insp-panel" ref={ref} style={{ transform: "translateX(105%)" }}>
      {p && (
        <>
          <button className="insp-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
          <div className="insp-scroll">
            <div className="insp-eyebrow">From the collection</div>
            <h2 className="insp-title">{p.title}</h2>
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
              <a
                className="insp-wiki"
                href={p.wikipediaUrl}
                target="_blank"
                rel="noreferrer"
              >
                Source · Wikipedia
              </a>
            )}
          </div>
          <div className="insp-zoom-hint">Scroll to lean in · Esc to step back</div>
        </>
      )}
    </div>
  );
}
