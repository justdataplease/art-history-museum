"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { INSPECT_SHEET_BREAKPOINT, type Placement } from "./layout";
import { displayTitle } from "./exhibit-placard";
import { inspectTexturePx, paintingTextureUrl, wikiFilePage } from "@/lib/img";
import type { Painting, WorkAbout } from "@/lib/types";
import styles from "./museum.module.css";

const TEXT_LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

const isPublicDomain = (license: string) => /^\s*(pd\b|public[\s-]*domain)/i.test(license);

/** "Wikimedia Commons", "WikiArt" or "Wikipedia", from the file page's host. */
function sourceName(page: string): string {
  try {
    const host = new URL(page).hostname;
    if (host === "www.wikiart.org") return "WikiArt";
    return host === "commons.wikimedia.org" ? "Wikimedia Commons" : "Wikipedia";
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

/** More about the work (src/lib/rooms.ts workAbout), fetched when it is inspected; kept for the visit. */
const aboutCache = new Map<string, Promise<WorkAbout | null>>();
function fetchAbout(artist: string, slug: string): Promise<WorkAbout | null> {
  const key = `${artist}/${slug}`;
  let p = aboutCache.get(key);
  if (!p) {
    p = fetch(`/api/work/${artist}/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? (r.json() as Promise<WorkAbout>) : null))
      .catch(() => null)
      .then((a) => {
        if (!a) aboutCache.delete(key); // tried again next time
        return a;
      });
    aboutCache.set(key, p);
  }
  return p;
}

/** A tag's kind, as shown on it. */
const TAG_KIND: Record<string, string> = {
  era: "Era",
  tradition: "Tradition",
  period: "Period",
  umbrella: "Movement",
  movement: "Movement",
  school: "School",
  group: "Group",
  academy: "Academy",
  exhibition: "Exhibition",
  genre: "Genre",
  country: "Country",
};

/** The work in context: its movement, genre and museum; the artist's works hung before and after it (a click
 *  goes to them); what others painted the same year. */
function About({
  painting: p,
  artistSlug,
  artistName,
  before,
  after,
  onPick,
}: {
  painting: Painting;
  artistSlug: string;
  artistName: string;
  before: Placement | null;
  after: Placement | null;
  onPick: (pl: Placement) => void;
}) {
  const [about, setAbout] = useState<WorkAbout | null>(null);
  useEffect(() => {
    let alive = true;
    setAbout(null);
    fetchAbout(artistSlug, p.slug).then((a) => alive && setAbout(a));
    return () => {
      alive = false;
    };
  }, [artistSlug, p.slug]);
  const facts: [string, string][] = [];
  const tags = about?.tags ?? [];
  if (about?.museums.length) facts.push([about.museums.length > 1 ? "Collections" : "Collection", about.museums.join(", ")]);
  const step = (pl: Placement | null, label: string) =>
    pl && (
      <button type="button" className={styles.aboutStep} onClick={() => onPick(pl)}>
        <small>{label}</small>
        {displayTitle(pl.painting.title, artistName)}
        {pl.painting.year ? `, ${pl.painting.year}` : ""}
      </button>
    );
  if (!facts.length && !tags.length && !before && !after && !about?.sameYear.length) return null;
  return (
    <div className={styles.about}>
      <h3>About this work</h3>
      {tags.length > 0 && (
        <ul className={styles.tags} aria-label="Era, period, movement, school, genre, country">
          {tags.map((t) => (
            <li key={`${t.kind}:${t.name}`} title={TAG_KIND[t.kind] ?? t.kind}>
              <small>{TAG_KIND[t.kind] ?? t.kind}</small>
              {t.name}
            </li>
          ))}
        </ul>
      )}
      {facts.length > 0 && (
        <dl>
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {(before || after) && (
        <div className={styles.aboutSteps}>
          {step(before, `Before it, by ${artistName}`)}
          {step(after, `After it, by ${artistName}`)}
        </div>
      )}
      {about && about.sameYear.length > 0 && p.year && (
        <div className={styles.aboutYear}>
          <small>Painted the same year, {p.year}</small>
          <ul>
            {about.sameYear.map((w) => (
              <li key={`${w.artistSlug}/${w.slug}`}>
                <i>{w.title}</i> by {w.artistName}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The image as it is: flat on the screen, no room light, weave or varnish (Esc or a click closes it). */
function Original({ painting: p, title, onClose }: { painting: Painting; title: string; onClose: () => void }) {
  const url = paintingTextureUrl(p, inspectTexturePx(p));
  const page = p.imageCredit?.page || (p.imageUrl ? wikiFilePage(p.imageUrl) : null);
  useEffect(() => {
    // before the gallery's own Esc (which would leave the painting)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  if (!url) return null;
  return createPortal(
    <div className={styles.original} role="dialog" aria-label={`${title}: the original image`} onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={title} decoding="async" />
      <div className={styles.originalBar} onClick={(e) => e.stopPropagation()}>
        <span>{title}</span>
        {page && (
          <a href={page} {...ext}>
            The file ↗
          </a>
        )}
        <button type="button" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </div>,
    document.body
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
  artistSlug = "",
  around,
  onPick,
}: {
  placement: Placement | null;
  onClose: () => void;
  touch?: boolean;
  /** The gallery's artist (a custom room's works name their own): drops Wikipedia's "(Artist)" disambiguator
   *  from titles, as the wall labels do, and finds the work's details. */
  artistName?: string;
  artistSlug?: string;
  /** The artist's works hung before and after this one, by year. */
  around?: { before: Placement | null; after: Placement | null };
  /** Inspect another work (the camera flies there). */
  onPick?: (pl: Placement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Keep the last placement so content stays during the exit slide.
  const [shown, setShown] = useState<Placement | null>(null);
  const placementRef = useRef(placement);
  const visible = useRef(false);
  const [original, setOriginal] = useState<string | null>(null);

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
  // a custom room's work names its own artist; a gallery's is the gallery's
  const who = p?.artistName ?? artistName;
  const whoSlug = p?.artistSlug ?? artistSlug;
  const title = p ? displayTitle(p.title, who) : "";

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
            <h2 className="insp-title">{title}</h2>
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
            {p.imageUrl && !p.copyrighted && (
              <button type="button" className={`insp-wiki ${styles.originalBtn}`} onClick={() => setOriginal(p.slug)}>
                View the original image
              </button>
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
            {whoSlug && onPick && (
              <About
                painting={p}
                artistSlug={whoSlug}
                artistName={who}
                before={placement ? (around?.before ?? null) : null}
                after={placement ? (around?.after ?? null) : null}
                onPick={onPick}
              />
            )}
            <Credits painting={p} />
          </div>
          {placement && original === p.slug && (
            <Original painting={p} title={title} onClose={() => setOriginal(null)} />
          )}
          <div className="insp-zoom-hint">
            {touch ? "Pinch to lean in · ✕ to step back" : "Scroll to lean in · Esc to step back"}
          </div>
        </>
      )}
    </div>
  );
}
