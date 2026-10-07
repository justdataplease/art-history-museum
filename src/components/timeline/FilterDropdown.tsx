"use client";

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { Artist, Period } from "@/lib/types";
import { wikiSrcSet } from "@/lib/img";
import { WelcomeHint, WELCOME_SEEN_KEY } from "./WelcomeHint";

export type Filter =
  | { type: "period"; slug: string }
  | { type: "artist"; slug: string }
  | null;

/** Only the first rows animate in; the rest are below the fold anyway. */
const STAGGERED = 14;

const ordinal = (n: number) => {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
};

interface PeriodGroup {
  from: number;
  to: number;
  items: Period[];
}

const centuryLabel = (g: PeriodGroup) =>
  g.from === g.to ? `${ordinal(g.from)} century` : `${ordinal(g.from)} – ${ordinal(g.to)} century`;

/**
 * Periods grouped by the century they begin in; thin centuries merge into
 * the next one so every group holds a few entries ("16th – 17th century").
 */
function groupPeriods(periods: Period[]): { label: string; items: Period[] }[] {
  const byC = new Map<number, Period[]>();
  for (const p of periods) {
    const c = Math.floor(p.startYear / 100) + 1;
    const l = byC.get(c);
    if (l) l.push(p);
    else byC.set(c, [p]);
  }
  const groups: PeriodGroup[] = [];
  let run: PeriodGroup | null = null;
  for (const c of [...byC.keys()].sort((a, b) => a - b)) {
    if (!run) run = { from: c, to: c, items: [] };
    run.to = c;
    run.items.push(...byC.get(c)!);
    if (run.items.length >= 3) {
      groups.push(run);
      run = null;
    }
  }
  if (run) {
    // a short tail joins the group before it
    const last = groups.pop();
    groups.push(last ? { from: last.from, to: run.to, items: [...last.items, ...run.items] } : run);
  }
  return groups.map((g) => ({ label: centuryLabel(g), items: g.items }));
}

/** Case- and accent-insensitive ("Dürer" matches "durer", "Gérôme" "gerome"). */
const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Hyphens and dashes, apostrophes and quotes, periods and commas. */
const PUNCT = /[-‐-―−'‘’ʼ`´".,]/g;

/** Punctuation as word breaks: "Jean-Léon" → "jean leon", "J. M. W." → "j m w". */
const spaced = (s: string) => fold(s).replace(PUNCT, " ").replace(/\s+/g, " ").trim();
/** Punctuation dropped: "O'Keeffe" → "okeeffe", "Jean-Léon" → "jeanleon". */
const joined = (s: string) => fold(s).replace(PUNCT, "").replace(/\s+/g, " ").trim();
/** No spaces at all: "J. M. W. Turner" → "jmwturner". */
const squashed = (s: string) => joined(s).replace(/ /g, "");

/**
 * Search keys for a name. It matches where one of its words starts with the
 * query ("gogh", "van g"), however the visitor types the punctuation:
 * "jean-léon", "jean leon", "o'keeffe", "okeeffe", "o keeffe", "j.m.w.
 * turner", "jmw turner". The query is normalised the same three ways ("|"
 * keeps one variant from running on into the next).
 */
const nameKey = (name: string) => ` ${spaced(name)} | ${joined(name)} | ${squashed(name)} |`;
const queryKeys = (q: string) => {
  const out = new Set<string>();
  for (const k of [spaced(q), joined(q), squashed(q)]) if (k) out.add(" " + k);
  return [...out];
};

export const FilterDropdown = memo(function FilterDropdown({
  periods,
  artists,
  filter,
  onChange,
  hidden,
  showAll,
  onCollection,
}: {
  periods: Period[];
  artists: Artist[];
  filter: Filter;
  onChange: (f: Filter) => void;
  hidden: boolean;
  showAll: boolean;
  onCollection: (all: boolean) => void;
}) {
  const [activePanel, setActivePanel] = useState<"explore" | "welcome" | null>(null);
  const open = activePanel === "explore";
  const welcomeRequested = useRef(false);
  const [tab, setTab] = useState<"periods" | "artists">("periods");
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const panelId = useId();
  const searchId = useId();

  useEffect(() => {
    try {
      if (localStorage.getItem(WELCOME_SEEN_KEY) === "1") return;
    } catch {}
    setActivePanel("welcome");
  }, []);

  const dismissWelcome = useCallback((refocus: boolean) => {
    try { localStorage.setItem(WELCOME_SEEN_KEY, "1"); } catch {}
    setActivePanel(null);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  }, []);

  // Keep the panel on screen. It hangs from the button's right edge, but the
  // button is not always at the right of the header (a long selection can
  // wrap it under the title on a phone), so measure and shift it into view,
  // before it paints and before the entrance animation scales it.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const wrap = wrapRef.current;
    if (!panel || !wrap || !open) return;
    const place = () => {
      const vw = document.documentElement.clientWidth;
      const r = wrap.getBoundingClientRect();
      const m = vw <= 720 ? 12 : 16;
      const width = Math.min(380, vw - 2 * m);
      // `right` is measured from the wrapper's right edge: 0 keeps it flush with the button
      const right = Math.min(Math.max(0, r.right - (vw - m)), r.right - width - m);
      panel.style.width = `${width}px`;
      panel.style.right = `${right}px`;
      panel.style.maxHeight = `${Math.min(620, Math.max(120, window.innerHeight - r.bottom - 24))}px`;
      const bx = (btnRef.current?.getBoundingClientRect().left ?? r.left) + (btnRef.current?.offsetWidth ?? 0) / 2;
      panel.style.transformOrigin = `${Math.round(bx - (r.right - right - width))}px 0`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

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
      [...panel.querySelectorAll(".filter-item")].slice(0, STAGGERED),
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
      [...list.querySelectorAll(".filter-item")].slice(0, STAGGERED),
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

  function close(refocus: boolean, next: "welcome" | null = null) {
    if (closingRef.current) return;
    closingRef.current = true;
    const panel = panelRef.current;
    const done = () => {
      setActivePanel(next);
      setQuery("");
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

  const periodGroups = useMemo(() => groupPeriods(periods), [periods]);

  // artists under their period, in period order, each group by birth
  const artistGroups = useMemo(() => {
    const by = new Map<string, Artist[]>();
    for (const a of artists) {
      const l = by.get(a.periodSlug);
      if (l) l.push(a);
      else by.set(a.periodSlug, [a]);
    }
    const birth = (a: Artist) => a.birthYear ?? 3000;
    return periods
      .filter((p) => by.has(p.slug))
      .map((p) => {
        const items = [...by.get(p.slug)!].sort((a, b) => birth(a) - birth(b) || a.name.localeCompare(b.name));
        return { p, items, keys: items.map((a) => nameKey(a.name)) };
      });
  }, [periods, artists]);

  const q = spaced(query);
  const shown = useMemo(() => {
    const ks = queryKeys(query);
    return artistGroups
      .map((g) => ({
        p: g.p,
        items: ks.length ? g.items.filter((_, i) => ks.some((k) => g.keys[i].includes(k))) : g.items,
      }))
      .filter((g) => g.items.length);
  }, [artistGroups, query]);
  const matches = shown.reduce((n, g) => n + g.items.length, 0);

  const pickArtist = (a: Artist) => {
    onChange({ type: "artist", slug: a.slug });
    close(false);
  };

  return (
    <div className="filter-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`filter-btn${open ? " open" : ""}${filter ? " has-filter" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={activePanel !== null && !hidden}
        aria-controls={hidden ? undefined : open ? panelId : activePanel === "welcome" ? "timeline-welcome" : undefined}
        onClick={() => {
          if (open) return close(false);
          if (activePanel === "welcome") dismissWelcome(false);
          setActivePanel("explore");
        }}
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

          {tab === "artists" && (
            <div className="filter-search">
              <input
                id={searchId}
                type="search"
                aria-label="Find an artist"
                placeholder={showAll ? `Find one of ${artists.length} artists` : "Find a featured artist"}
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (listRef.current) listRef.current.scrollTop = 0;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && shown.length) {
                    e.preventDefault();
                    pickArtist(shown[0].items[0]);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    listRef.current?.querySelector<HTMLElement>(".filter-item")?.focus();
                  }
                }}
              />
              {q && (
                <>
                  <span className="filter-search-n" aria-live="polite">
                    {matches ? `${matches} found` : "none"}
                  </span>
                  <button
                    type="button"
                    className="filter-search-x"
                    aria-label="Clear the search"
                    onClick={(e) => {
                      setQuery("");
                      (e.currentTarget.parentElement?.querySelector("input") as HTMLInputElement | null)?.focus();
                    }}
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          )}

          <div className="filter-list" ref={listRef}>
            {tab === "periods"
              ? periodGroups.map((g) => (
                  <section key={g.label} className="filter-group" aria-label={g.label}>
                    <h3 className="filter-group-h" aria-hidden>
                      {g.label}
                    </h3>
                    {g.items.map((p) => (
                      <button
                        type="button"
                        key={p.slug}
                        className={`filter-item fi-period${
                          filter?.type === "period" && filter.slug === p.slug ? " selected" : ""
                        }`}
                        onClick={(e) => {
                          onChange({ type: "period", slug: p.slug });
                          close(e.detail === 0); // keyboard: hand focus back to the button
                        }}
                      >
                        <span className="chip" style={{ background: p.color }} />
                        <span className="fi-name">{p.name}</span>
                        <span className="fi-sub">
                          {p.startYear} – {p.endYear}
                        </span>
                      </button>
                    ))}
                  </section>
                ))
              : shown.map((g) => (
                  <section key={g.p.slug} className="filter-group" aria-label={g.p.name}>
                    <h3 className="filter-group-h" aria-hidden>
                      <span className="chip" style={{ background: g.p.color }} />
                      {g.p.name}
                    </h3>
                    {g.items.map((a) => (
                      <button
                        type="button"
                        key={a.slug}
                        className={`filter-item fi-artist${
                          filter?.type === "artist" && filter.slug === a.slug ? " selected" : ""
                        }`}
                        onClick={() => pickArtist(a)}
                      >
                        {a.portraitUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            {...wikiSrcSet(a.portraitUrl, 30, a.portraitWidth)}
                            alt=""
                            width={30}
                            height={30}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="fi-initial" aria-hidden>
                            {a.name.replace(/^(el|fra)\s+/i, "")[0] ?? "?"}
                          </span>
                        )}
                        <span className="fi-name">{a.name}</span>
                        <span className="fi-sub">
                          {a.birthYear ?? "?"} – {a.deathYear ?? "today"}
                        </span>
                      </button>
                    ))}
                  </section>
                ))}
            {tab === "artists" && !shown.length && (
              <p className="filter-empty">
                {showAll ? "No artist by that name." : <>No match in Featured. <button type="button" className="filter-all" onClick={() => {
                  onCollection(true);
                  document.getElementById(searchId)?.focus();
                }}>Search all artists</button></>}
              </p>
            )}
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
              Clear selection
            </button>
          )}
          <button type="button" className="filter-help" onClick={() => {
            welcomeRequested.current = true;
            close(false, "welcome");
          }}>How to explore <span aria-hidden>→</span></button>
        </div>
      )}
      {activePanel === "welcome" && !hidden && (
        <WelcomeHint focusOnOpen={welcomeRequested.current} onDismiss={dismissWelcome} />
      )}
    </div>
  );
});
