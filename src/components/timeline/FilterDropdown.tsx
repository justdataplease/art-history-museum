"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import type { Artist, Period } from "@/lib/types";
import { wikiThumb } from "@/lib/img";

export type Filter =
  | { type: "period"; slug: string }
  | { type: "artist"; slug: string }
  | null;

export function FilterDropdown({
  periods,
  artists,
  filter,
  onChange,
}: {
  periods: Period[];
  artists: Artist[];
  filter: Filter;
  onChange: (f: Filter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"periods" | "artists">("periods");
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Panel entrance / exit.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (open) {
      gsap.fromTo(
        panel,
        { opacity: 0, scale: 0.82, y: -14, rotateX: -12 },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          rotateX: 0,
          duration: 0.45,
          ease: "back.out(1.6)",
        }
      );
      gsap.fromTo(
        panel.querySelectorAll(".filter-item"),
        { opacity: 0, x: 22 },
        { opacity: 1, x: 0, duration: 0.35, stagger: 0.022, ease: "power2.out", delay: 0.08 }
      );
    }
  }, [open]);

  // Content swap between tabs.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !open) return;
    gsap.fromTo(
      list.querySelectorAll(".filter-item"),
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.32, stagger: 0.018, ease: "power2.out" }
    );
  }, [tab, open]);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    const panel = panelRef.current;
    if (!panel) {
      setOpen(false);
      return;
    }
    gsap.to(panel, {
      opacity: 0,
      scale: 0.86,
      y: -10,
      duration: 0.25,
      ease: "power2.in",
      onComplete: () => setOpen(false),
    });
  }

  const label =
    filter?.type === "period"
      ? periods.find((p) => p.slug === filter.slug)?.name
      : filter?.type === "artist"
        ? artists.find((a) => a.slug === filter.slug)?.name
        : null;

  const sortedArtists = [...artists].sort((a, b) =>
    (a.birthYear ?? 3000) - (b.birthYear ?? 3000)
  );

  return (
    <div className="filter-wrap" ref={wrapRef}>
      <button
        className={`filter-btn${open ? " open" : ""}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {label ?? "Explore"}
        <span className="chev">▼</span>
      </button>

      {open && (
        <div className="filter-panel" ref={panelRef}>
          <div className="filter-tabs">
            <button
              className={`filter-tab${tab === "periods" ? " active" : ""}`}
              onClick={() => setTab("periods")}
            >
              Periods
            </button>
            <button
              className={`filter-tab${tab === "artists" ? " active" : ""}`}
              onClick={() => setTab("artists")}
            >
              Artists
            </button>
          </div>

          <div className="filter-list" ref={listRef}>
            {tab === "periods"
              ? periods.map((p) => (
                  <button
                    key={p.slug}
                    className={`filter-item${
                      filter?.type === "period" && filter.slug === p.slug
                        ? " selected"
                        : ""
                    }`}
                    onClick={() => {
                      onChange({ type: "period", slug: p.slug });
                      close();
                    }}
                  >
                    <span className="chip" style={{ background: p.color }} />
                    <span>
                      <span className="fi-name">{p.name}</span>
                      <br />
                      <span className="fi-sub">
                        {p.startYear} – {p.endYear}
                      </span>
                    </span>
                  </button>
                ))
              : sortedArtists.map((a) => (
                  <button
                    key={a.slug}
                    className={`filter-item${
                      filter?.type === "artist" && filter.slug === a.slug
                        ? " selected"
                        : ""
                    }`}
                    onClick={() => {
                      onChange({ type: "artist", slug: a.slug });
                      close();
                    }}
                  >
                    {a.portraitUrl ? (
                      <img
                        src={wikiThumb(a.portraitUrl, 80, a.portraitWidth)}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="chip" style={{ background: "#b8a87e" }} />
                    )}
                    <span>
                      <span className="fi-name">{a.name}</span>
                      <br />
                      <span className="fi-sub">
                        {a.birthYear ?? "?"} – {a.deathYear ?? "now"}
                      </span>
                    </span>
                  </button>
                ))}
          </div>

          {filter && (
            <button
              className="filter-clear"
              onClick={() => {
                onChange(null);
                close();
              }}
            >
              Clear · show everything
            </button>
          )}
        </div>
      )}
    </div>
  );
}
