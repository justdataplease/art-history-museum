"use client";

import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { Artist, Period } from "@/lib/types";
import { wikiSrcSet } from "@/lib/img";

export type Filter =
  | { type: "period"; slug: string }
  | { type: "artist"; slug: string }
  | null;

export const FilterDropdown = memo(function FilterDropdown({
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const panelId = useId();

  // Panel entrance.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !open) return;
    closingRef.current = false;
    gsap.fromTo(
      panel,
      { opacity: 0, scale: 0.86, y: -12, rotateX: -10 },
      { opacity: 1, scale: 1, y: 0, rotateX: 0, duration: 0.42, ease: "back.out(1.5)" }
    );
    gsap.fromTo(
      panel.querySelectorAll(".filter-item"),
      { opacity: 0, x: 18 },
      { opacity: 1, x: 0, duration: 0.32, stagger: 0.018, ease: "power2.out", delay: 0.06 }
    );
    panel.querySelector<HTMLElement>(".filter-tab.active")?.focus({ preventScroll: true });
  }, [open]);

  // Content swap between tabs.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !open) return;
    list.scrollTop = 0;
    gsap.fromTo(
      list.querySelectorAll(".filter-item"),
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.3, stagger: 0.016, ease: "power2.out" }
    );
  }, [tab, open]);

  // Close on outside pointer (capture phase: nothing on the page can swallow it) / Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close(refocus: boolean) {
    if (closingRef.current) return;
    closingRef.current = true;
    const panel = panelRef.current;
    const done = () => {
      setOpen(false);
      if (refocus) btnRef.current?.focus({ preventScroll: true });
    };
    if (!panel) return done();
    gsap.to(panel, {
      opacity: 0,
      scale: 0.9,
      y: -8,
      duration: 0.22,
      ease: "power2.in",
      onComplete: done,
    });
  }

  const label =
    filter?.type === "period"
      ? periods.find((p) => p.slug === filter.slug)?.name
      : filter?.type === "artist"
        ? artists.find((a) => a.slug === filter.slug)?.name
        : null;

  const sortedArtists = useMemo(
    () => [...artists].sort((a, b) => (a.birthYear ?? 3000) - (b.birthYear ?? 3000)),
    [artists]
  );

  return (
    <div className="filter-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`filter-btn${open ? " open" : ""}${filter ? " has-filter" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span className="filter-btn-label">{label ?? "Explore"}</span>
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="filter-panel" ref={panelRef} id={panelId} role="dialog" aria-label="Explore the collection">
          <div className="filter-tabs">
            <button
              type="button"
              aria-pressed={tab === "periods"}
              className={`filter-tab${tab === "periods" ? " active" : ""}`}
              onClick={() => setTab("periods")}
            >
              Periods <span className="count" aria-hidden>{periods.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={tab === "artists"}
              className={`filter-tab${tab === "artists" ? " active" : ""}`}
              onClick={() => setTab("artists")}
            >
              Artists <span className="count" aria-hidden>{artists.length}</span>
            </button>
          </div>

          <div className="filter-list" ref={listRef}>
            {tab === "periods"
              ? periods.map((p) => (
                  <button
                    type="button"
                    key={p.slug}
                    className={`filter-item${
                      filter?.type === "period" && filter.slug === p.slug ? " selected" : ""
                    }`}
                    onClick={(e) => {
                      onChange({ type: "period", slug: p.slug });
                      close(e.detail === 0); // keyboard: hand focus back to the button
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
                    type="button"
                    key={a.slug}
                    className={`filter-item${
                      filter?.type === "artist" && filter.slug === a.slug ? " selected" : ""
                    }`}
                    onClick={() => {
                      onChange({ type: "artist", slug: a.slug });
                      close(false);
                    }}
                  >
                    {a.portraitUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        {...wikiSrcSet(a.portraitUrl, 34, a.portraitWidth)}
                        alt=""
                        width={34}
                        height={34}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="chip" style={{ background: "#b8a87e" }} />
                    )}
                    <span>
                      <span className="fi-name">{a.name}</span>
                      <br />
                      <span className="fi-sub">
                        {a.birthYear ?? "?"} – {a.deathYear ?? "today"}
                      </span>
                    </span>
                  </button>
                ))}
          </div>

          {filter && (
            <button
              type="button"
              className="filter-clear"
              onClick={(e) => {
                onChange(null);
                close(e.detail === 0);
              }}
            >
              Clear · show everything
            </button>
          )}
        </div>
      )}
    </div>
  );
});
