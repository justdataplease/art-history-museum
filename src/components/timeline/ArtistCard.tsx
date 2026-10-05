"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import type { Artist, Period } from "@/lib/types";
import { wikiThumb } from "@/lib/img";

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
  const router = useRouter();

  useEffect(() => {
    router.prefetch(`/museum/${artist.slug}`);
    const tl = gsap.timeline();
    tl.fromTo(
      backdropRef.current,
      { opacity: 0 },
      { opacity: 1, duration: 0.35, ease: "power2.out" }
    )
      .fromTo(
        cardRef.current,
        { opacity: 0, y: 46, scale: 0.92, rotateX: 8 },
        { opacity: 1, y: 0, scale: 1, rotateX: 0, duration: 0.55, ease: "power3.out" },
        "-=0.2"
      )
      .fromTo(
        cardRef.current!.querySelectorAll(".card-inner > *"),
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.055, ease: "power2.out" },
        "-=0.3"
      );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artist.slug]);

  function close() {
    gsap.to(cardRef.current, {
      opacity: 0,
      y: 30,
      scale: 0.94,
      duration: 0.25,
      ease: "power2.in",
    });
    gsap.to(backdropRef.current, {
      opacity: 0,
      duration: 0.3,
      delay: 0.05,
      onComplete: onClose,
    });
  }

  function enter() {
    // The card recedes; the museum page opens behind its doors.
    gsap.to(cardRef.current, {
      scale: 1.06,
      opacity: 0,
      duration: 0.45,
      ease: "power2.in",
    });
    gsap.to(backdropRef.current, {
      backgroundColor: "rgba(4,3,2,1)",
      duration: 0.5,
      onComplete: () => router.push(`/museum/${artist.slug}`),
    });
  }

  const bioShort =
    artist.bio.length > 560 ? artist.bio.slice(0, artist.bio.lastIndexOf(" ", 560)) + " …" : artist.bio;

  return (
    <div
      ref={backdropRef}
      className="card-backdrop"
      onPointerDown={(e) => {
        if (e.target === backdropRef.current) close();
      }}
    >
      <div ref={cardRef} className="card">
        <button className="card-close" onClick={close} aria-label="Close">
          ✕
        </button>
        <div className="card-inner">
          <div className="card-portrait">
            {artist.portraitUrl && (
              <img
                src={wikiThumb(artist.portraitUrl, 400, artist.portraitWidth)}
                alt={artist.name}
              />
            )}
          </div>
          <h2 className="card-name">{artist.name}</h2>
          <div className="card-sub">
            {artist.tagline}
            {artist.birthYear != null && (
              <>
                <br />
                {artist.birthYear} — {artist.deathYear ?? ""}
              </>
            )}
          </div>
          <div className="card-rule">❦</div>
          <p className="card-bio">{bioShort}</p>
          {period && (
            <span
              className="card-period-tag"
              style={{ color: period.color, borderColor: `${period.color}88` }}
            >
              {period.name}
            </span>
          )}
          <button className="card-enter" onClick={enter}>
            Enter the Gallery →
          </button>
          <br />
          {artist.wikipediaUrl && (
            <a
              className="card-wiki"
              href={artist.wikipediaUrl}
              target="_blank"
              rel="noreferrer"
            >
              Source · Wikipedia
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
