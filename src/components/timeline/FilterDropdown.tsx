"use client";

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { Artist, Period } from "@/lib/types";
import { CONTINENTS, type Continent } from "@/lib/countries";
import { wikiSrcSet } from "@/lib/img";
import { WelcomeHint, WELCOME_SEEN_KEY } from "./WelcomeHint";
import { findNames, nameEntry, spaced } from "./artist-search";

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

/** Close matches of a search: the better known first (more works hung). */
const moreWorks = (a: Artist, b: Artist) => b.paintingCount - a.paintingCount;

/** Continent chips: the long names shortened to fit a phone. */
const SHORT: Partial<Record<Continent, string>> = { "North America": "N. America", "South America": "S. America" };

/** A list group: a period's artists matching the search, or the close matches after them. */
interface ArtistGroup {
  key: string;
  label: string;
  color: string | null;
  items: Artist[];
}

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
  // where the listed artists are from (kept while the panel is closed, unlike the search text)
  const [pickedContinent, setContinent] = useState<Continent | null>(null);
  const [pickedCountry, setCountry] = useState<string | null>(null);
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
        return { p, items };
      });
  }, [periods, artists]);

  // every artist in that order, with what its name is searched by
  const ordered = useMemo(() => artistGroups.flatMap((g) => g.items), [artistGroups]);
  const entries = useMemo(() => ordered.map((a) => nameEntry(a.name)), [ordered]);
  const found = useMemo(() => findNames(ordered, entries, query, moreWorks), [ordered, entries, query]);

  // the continents and countries on offer: those of the artists listed, whatever the search
  const places = useMemo(() => {
    const countries = new Map<string, Continent>();
    for (const a of artists) if (a.country && a.continent) countries.set(a.country, a.continent);
    return {
      continents: CONTINENTS.filter((c) => [...countries.values()].includes(c)),
      countries: [...countries.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [artists]);
  // a pick the listed artists no longer offer (Featured after All) lapses
  const continent = pickedContinent && places.continents.includes(pickedContinent) ? pickedContinent : null;
  const country = pickedCountry && places.countries.some(([k]) => k === pickedCountry) ? pickedCountry : null;

  // how many of the artists the search finds are from each
  const counts = useMemo(() => {
    const all = [...found.exact, ...found.close];
    const continents = new Map<string, number>();
    const countries = new Map<string, number>();
    for (const a of all) {
      if (a.continent) continents.set(a.continent, (continents.get(a.continent) ?? 0) + 1);
      if (a.country) countries.set(a.country, (countries.get(a.country) ?? 0) + 1);
    }
    return { all: all.length, continents, countries };
  }, [found]);

  const q = spaced(query);
  const shown = useMemo(() => {
    const here = (a: Artist) => (!continent || a.continent === continent) && (!country || a.country === country);
    const exact = new Set(found.exact.filter(here));
    const groups: ArtistGroup[] = artistGroups
      .map((g) => ({ key: g.p.slug, label: g.p.name, color: g.p.color, items: g.items.filter((a) => exact.has(a)) }))
      .filter((g) => g.items.length);
    const close = found.close.filter(here);
    if (close.length) groups.push({ key: "close", label: "Close matches", color: null, items: close });
    return groups;
  }, [artistGroups, found, continent, country]);
  const matches = shown.reduce((n, g) => n + g.items.length, 0);
  const place = country ?? continent;

  const pickPlace = (c: Continent | null, k: string | null) => {
    setContinent(c);
    setCountry(k);
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const countryOptions = (c: Continent) =>
    places.countries
      .filter(([, of]) => of === c)
      .map(([k]) => (
        <option key={k} value={k}>
          {k} ({counts.countries.get(k) ?? 0})
        </option>
      ));

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

          {tab === "artists" && places.continents.length > 0 && (
            <div className="filter-places" role="group" aria-label="Where the artists are from">
              <button
                type="button"
                className="filter-chip"
                aria-pressed={!place}
                onClick={() => pickPlace(null, null)}
              >
                All <span className="count">{counts.all}</span>
              </button>
              {places.continents.map((c) => {
                const n = counts.continents.get(c) ?? 0;
                return (
                  <button
                    type="button"
                    key={c}
                    className={`filter-chip${n ? "" : " none"}`}
                    aria-pressed={continent === c}
                    aria-label={`${c}, ${n}`}
                    onClick={() => (continent === c ? pickPlace(null, null) : pickPlace(c, null))}
                  >
                    {SHORT[c] ?? c} <span className="count">{n}</span>
                  </button>
                );
              })}
              <select
                className={`filter-country${country ? " active" : ""}`}
                aria-label="Country"
                value={country ?? ""}
                onChange={(e) => {
                  const k = e.target.value || null;
                  pickPlace(k ? (places.countries.find(([name]) => name === k)?.[1] ?? null) : continent, k);
                }}
              >
                <option value="">
                  {continent ? `All of ${continent}` : "Every country"} ({continent ? (counts.continents.get(continent) ?? 0) : counts.all})
                </option>
                {continent
                  ? countryOptions(continent)
                  : places.continents.map((c) => (
                      <optgroup key={c} label={c}>
                        {countryOptions(c)}
                      </optgroup>
                    ))}
              </select>
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
                  <section key={g.key} className="filter-group" aria-label={g.label}>
                    <h3 className="filter-group-h" aria-hidden>
                      {g.color ? <span className="chip" style={{ background: g.color }} /> : <span className="fi-near">≈</span>}
                      {g.label}
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
                        <span className="fi-main">
                          <span className="fi-name">{a.name}</span>
                          {a.country && !country && <span className="fi-country">{a.country}</span>}
                        </span>
                        <span className="fi-sub">
                          {a.birthYear ?? "?"} – {a.deathYear ?? "today"}
                        </span>
                      </button>
                    ))}
                  </section>
                ))}
            {tab === "artists" && !shown.length && (
              <p className="filter-empty">
                {!showAll ? (
                  <>
                    No match in Featured{place ? ` from ${place}` : ""}.{" "}
                    <button
                      type="button"
                      className="filter-all"
                      onClick={() => {
                        onCollection(true);
                        document.getElementById(searchId)?.focus();
                      }}
                    >
                      Search all artists
                    </button>
                  </>
                ) : place ? (
                  <>
                    No artist {q ? "by that name " : ""}from {place}.{" "}
                    <button type="button" className="filter-all" onClick={() => pickPlace(null, null)}>
                      Search everywhere
                    </button>
                  </>
                ) : (
                  "No artist by that name."
                )}
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
