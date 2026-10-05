"use client";

import { useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import type { Artist, Period } from "@/lib/types";
import { wikiSrcSet } from "@/lib/img";
import { artistYears } from "./artist-meta";

// Warm the 3D gallery's JavaScript (three.js + r3f + drei) once per session
// while the visitor reads the placard, so "Enter the Gallery" is instant.
let museumChunk: Promise<unknown> | null = null;
function warmMuseumChunk() {
  if (!museumChunk) {
    museumChunk = import("@/components/museum/MuseumApp").catch(() => {
      museumChunk = null;
    });
  }
}

export function ArtistCard({
  artist,
  period,
  onClose,
}: {
  artist: Artist;
  period?: Period;
  onClose: () => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const enterRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const router = useRouter();
  const titleId = useId();
  const href = `/museum/${artist.slug}`;

  useEffect(() => {
    closingRef.current = false;
    router.prefetch(href);
    const idle = (cb: () => void) => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(cb, { timeout: 1500 });
      else setTimeout(cb, 300);
    };
    // after the entrance animation, so parsing the chunk can't stutter it
    const warm = window.setTimeout(() => idle(warmMuseumChunk), 750);

    const tl = gsap.timeline();
    tl.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power2.out" })
      .fromTo(
        cardRef.current,
        { opacity: 0, y: 46, scale: 0.92, rotateX: 8 },
        { opacity: 1, y: 0, scale: 1, rotateX: 0, duration: 0.55, ease: "power3.out" },
        "-=0.2"
      )
      .fromTo(
        cardRef.current!.querySelectorAll(".card-inner > *"),
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.05, ease: "power2.out" },
        "-=0.3"
      );
    enterRef.current?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      // keep focus inside the dialog
      const f = cardRef.current?.querySelectorAll<HTMLElement>("button, a[href]");
      if (!f?.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(warm);
      tl.kill();
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artist.slug]);

  function close() {
    if (closingRef.current) return;
    closingRef.current = true;
    gsap.to(cardRef.current, { opacity: 0, y: 30, scale: 0.94, duration: 0.25, ease: "power2.in" });
    gsap.to(backdropRef.current, { opacity: 0, duration: 0.3, delay: 0.05, onComplete: onClose });
  }

  function enter() {
    if (closingRef.current) return;
    closingRef.current = true;
    // Navigate now: the current page stays up until the gallery commits, so
    // the fetch overlaps the fade instead of waiting for it.
    router.push(href);
    gsap.to(cardRef.current, { scale: 1.06, opacity: 0, duration: 0.45, ease: "power2.in" });
    gsap.to(backdropRef.current, { backgroundColor: "rgba(4,3,2,1)", duration: 0.5 });
  }

  const bioShort =
    artist.bio.length > 560
      ? artist.bio.slice(0, artist.bio.lastIndexOf(" ", 560)) + " …"
      : artist.bio;
  // Wikidata taglines often already carry the dates ("Italian painter (1571–1610)").
  const years = artistYears(artist);
  const showYears = !!years && !/\b1\d{3}\b|\b20\d{2}\b/.test(artist.tagline);
  // 168 x 200 arch, object-fit: cover -> ~200 css px wide is plenty at 1x
  const portrait = artist.portraitUrl ? wikiSrcSet(artist.portraitUrl, 200, artist.portraitWidth) : null;

  return (
    <div
      ref={backdropRef}
      className="card-backdrop"
      onPointerDown={(e) => {
        if (e.target === backdropRef.current) close();
      }}
    >
      <div
        ref={cardRef}
        className="card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button type="button" className="card-close" onClick={close} aria-label="Close">
          ✕
        </button>
        <div className="card-inner">
          <div className="card-portrait">
            {portrait && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={portrait.src}
                srcSet={portrait.srcSet}
                width={168}
                height={200}
                alt={`Portrait of ${artist.name}`}
                decoding="async"
              />
            )}
          </div>
          <h2 className="card-name" id={titleId}>
            {artist.name}
          </h2>
          <div className="card-sub">
            {artist.tagline}
            {showYears && (
              <>
                <br />
                {years}
              </>
            )}
          </div>
          <div className="card-rule" aria-hidden>
            ❦
          </div>
          <p className="card-bio">{bioShort}</p>
          {period && (
            <span
              className="card-period-tag"
              style={{ color: period.color, borderColor: `${period.color}88` }}
            >
              {period.name}
            </span>
          )}
          <button ref={enterRef} type="button" className="card-enter" onClick={enter}>
            Enter the Gallery →
          </button>
          <br />
          {artist.wikipediaUrl && (
            <a className="card-wiki" href={artist.wikipediaUrl} target="_blank" rel="noreferrer">
              Source · Wikipedia
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
