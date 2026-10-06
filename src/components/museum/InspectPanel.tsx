"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { INSPECT_SHEET_BREAKPOINT, type Placement } from "./layout";
import { displayTitle } from "./exhibit-placard";
import { wikiFilePage } from "@/lib/img";
import type { Painting } from "@/lib/types";
import styles from "./museum.module.css";

const TEXT_LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

const isPublicDomain = (license: string) => /^\s*(pd\b|public[\s-]*domain)/i.test(license);

/** "Wikimedia Commons" or "Wikipedia", from the file page's host. */
function sourceName(page: string): string {
  try {
    return new URL(page).hostname === "commons.wikimedia.org" ? "Wikimedia Commons" : "Wikipedia";
  } catch {
    return "Wikimedia Commons";
  }
}

/** Image and text attribution under the story: who made the photograph or
 *  scan and under what licence, and the licence of Wikipedia's text. */
function Credits({ painting: p }: { painting: Painting }) {
  const credit = p.imageCredit ?? null;
  const page = credit?.page || (p.imageUrl ? wikiFilePage(p.imageUrl) : null);
  let image: ReactNode = null;
  if (p.imageUrl && p.copyrighted) {
    image = (
      <>
        Image: as shown on{" "}
        {page ? (
          <a href={page} {...ext}>
            Wikipedia
          </a>
        ) : (
          "Wikipedia"
        )}{" "}
        (fair use)
      </>
    );
  } else if (p.imageUrl) {
    const license = credit?.license?.trim() || "";
    const pd = license !== "" && isPublicDomain(license);
    const parts: ReactNode[] = [];
    if (credit?.author) parts.push(<span key="a">{credit.author}</span>);
    if (pd) parts.push(<span key="l">Public domain</span>);
    else if (license)
      parts.push(
        credit?.licenseUrl ? (
          <a key="l" href={credit.licenseUrl} {...ext}>
            {license}
          </a>
        ) : (
          <span key="l">{license}</span>
        )
      );
    if (page)
      parts.push(
        <a key="s" href={page} {...ext}>
          {sourceName(page)}
        </a>
      );
    if (parts.length)
      image = (
        <>
          Image:{" "}
          {parts.map((x, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {x}
            </span>
          ))}
        </>
      );
  }
  return (
    <div className={styles.credits}>
      {image && <p>{image}</p>}
      <p>
        Text:{" "}
        {p.wikipediaUrl ? (
          <a href={p.wikipediaUrl} {...ext}>
            Wikipedia
          </a>
        ) : (
          "Wikipedia"
        )}
        ,{" "}
        <a href={TEXT_LICENSE_URL} {...ext}>
          CC BY-SA 4.0
        </a>
      </p>
    </div>
  );
}

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
            {p.copyrighted && (
              <div
                className={styles.copyrightTag}
                title={
                  p.imageUrl
                    ? "This work is still in copyright. Image as shown on Wikipedia, for education only."
                    : "This work is still in copyright: its image isn't shown here"
                }
              >
                © In copyright
              </div>
            )}
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
            {p.wikipediaUrl && p.copyrighted && !p.imageUrl && (
              <a className={`insp-wiki ${styles.wikiView}`} href={p.wikipediaUrl} target="_blank" rel="noreferrer">
                View on Wikipedia ↗
              </a>
            )}
            {p.wikipediaUrl && (!p.copyrighted || p.imageUrl) && (
              <a className="insp-wiki" href={p.wikipediaUrl} target="_blank" rel="noreferrer">
                Source · Wikipedia
              </a>
            )}
            <Credits painting={p} />
          </div>
          <div className="insp-zoom-hint">
            {touch ? "Pinch to lean in · ✕ to step back" : "Scroll to lean in · Esc to step back"}
          </div>
        </>
      )}
    </div>
  );
}
