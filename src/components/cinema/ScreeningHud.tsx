"use client";

// The films' corner's player and HUD. useScreening keeps one film deck for the gallery (film-deck.ts) and the
// runtime the corner's 3D reads (cinema-runtime.ts), and plays the artist's films in order; ScreeningHud shows
// what the projector shows (bottom left) and the artist's films to choose from (F).

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Film } from "@/lib/types";
import type { GalleryLayout } from "@/components/museum/layout";
import { FilmDeck, type DeckState } from "./film-deck";
import { createRuntime, type CinemaRuntime } from "./cinema-runtime";
import styles from "./screening.module.css";

const LANG: Record<string, string> = { el: "Greek", en: "English", fr: "French", de: "German", it: "Italian", es: "Spanish", nl: "Dutch", ru: "Russian" };

function length(s?: number): string | null {
  if (!s) return null;
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.max(1, m)} min`;
}

export function filmMeta(f: Film): string {
  return [f.year, length(f.seconds), f.lang && f.lang !== "en" ? LANG[f.lang] ?? f.lang : null, f.channel ?? f.source]
    .filter(Boolean)
    .join(" · ");
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  return h ? `${h}:${String(m % 60).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const IDLE: DeckState = { film: null, status: "idle", mode: null, time: 0, duration: 0, error: null };
const noSubscribe = () => () => {};
const idle = () => IDLE;

export interface Screening {
  deck: FilmDeck | null;
  runtime: React.RefObject<CinemaRuntime | null>;
  state: DeckState;
  films: Film[];
  /** ERT's films that play in Greece only cannot play elsewhere (its player shows a notice instead). */
  playable: (f: Film) => boolean;
  playFilm: (f: Film) => void;
  next: () => void;
  toggle: () => void;
  /** Coming into the corner: the film that was showing goes on, else the first. */
  start: () => void;
  origin: string;
  /** Changes when an embedded player mounts or unmounts. */
  deckKey: string;
}

export function useScreening(films: Film[], layout: GalleryLayout): Screening {
  const room = layout.nook;
  const [deck] = useState(() => (room && films.length && typeof document !== "undefined" ? new FilmDeck() : null));
  const [rt] = useState(() => (deck && room ? createRuntime(deck, room.screen) : null));
  const runtime = useRef<CinemaRuntime | null>(rt);
  const state = useSyncExternalStore(deck?.subscribe ?? noSubscribe, deck?.getState ?? idle, idle);
  const [greece, setGreece] = useState<boolean | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    if (!deck) return;
    setOrigin(window.location.origin);
    if (!films.some((f) => f.geo)) return;
    fetch("/api/films/where")
      .then((r) => r.json())
      .then((d: { greece: boolean | null }) => setGreece(d.greece))
      .catch(() => {});
  }, [deck, films]);
  useEffect(() => () => deck?.dispose(), [deck]);

  const playable = useCallback((f: Film) => !f.geo || greece !== false, [greece]);
  const current = state.film;
  const playFilm = useCallback((f: Film) => void (deck && playable(f) && deck.load(f, true)), [deck, playable]);
  const next = useCallback(() => {
    const list = films.filter(playable);
    if (!list.length) return;
    const i = current ? list.findIndex((f) => f.id === current.id) : -1;
    playFilm(list[(i + 1) % list.length]);
  }, [films, playable, current, playFilm]);
  const start = useCallback(() => {
    if (!deck) return;
    if (deck.state.film && deck.state.status !== "ended" && deck.state.status !== "error") deck.play();
    else if (deck.state.film) next();
    else {
      const first = films.find(playable);
      if (first) playFilm(first);
    }
  }, [deck, films, playable, playFilm, next]);
  const toggle = useCallback(() => {
    if (!deck) return;
    if (!deck.state.film) start();
    else deck.toggle();
  }, [deck, start]);
  const deckKey = `${current?.id ?? "none"}:${state.mode ?? ""}:${current?.kind === "dailymotion" && state.status === "paused" ? "down" : ""}`;
  return useMemo(
    () => ({ deck, runtime, state, films, playable, playFilm, next, toggle, start, origin, deckKey }),
    [deck, state, films, playable, playFilm, next, toggle, start, origin, deckKey]
  );
}

export function ScreeningHud({
  screening: s,
  artistName,
  engaged,
  programme,
  onProgramme,
}: {
  screening: Screening;
  artistName: string;
  /** Walking (the cursor captured): the caption steps back. */
  engaged: boolean;
  /** The films list is open; open or close it. */
  programme: boolean;
  onProgramme: (open: boolean) => void;
}) {
  const { state, films } = s;
  const current = state.film;
  const playing = state.status === "playing";
  const count = `${films.length} film${films.length === 1 ? "" : "s"}`;
  return (
    <>
      {current && (
        <div className={`${styles.nowShowing}${engaged ? ` ${styles.dim}` : ""}`} role="status">
          <span className={styles.state}>
            {state.status === "loading" ? "Loading" : playing ? "Now showing" : state.status === "ended" ? "The end" : state.status === "error" ? "Not playing" : "Paused"}
          </span>
          <b>{current.title}</b>
          {current.original && <i>{current.original}</i>}
          <small>
            {filmMeta(current)}
            {state.duration > 0 && ` · ${fmt(state.time)} / ${fmt(state.duration)}`}
            {" · "}
            <a href={current.page} target="_blank" rel="noopener noreferrer">
              {current.source === "YouTube" || current.source === "Vimeo" || current.source === "Dailymotion" ? `On ${current.source}` : "Source & credits"}
            </a>
            {current.link && (
              <>
                {" · "}
                <a href={current.link} target="_blank" rel="noopener noreferrer">
                  Found here
                </a>
              </>
            )}
            {current.credit && ` · ${current.credit}`}
          </small>
          {state.error && <small className={styles.error}>{state.error}</small>}
          {!engaged && !programme && films.length > 1 && (
            <button type="button" className={styles.all} onClick={() => onProgramme(true)}>
              All {films.length} films (F)
            </button>
          )}
        </div>
      )}
      {programme && (
        <aside className={styles.programme} aria-label="Films">
          <header>
            <h2>Films about {artistName}</h2>
            <p>Linked from the artist&apos;s Wikipedia articles: {count}</p>
          </header>
          <ol>
            {films.map((f) => {
              const can = s.playable(f);
              const on = current?.id === f.id;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    className={`${styles.film}${on ? ` ${styles.on}` : ""}`}
                    disabled={!can}
                    onClick={() => (on ? s.toggle() : s.playFilm(f))}
                    title={can ? f.summary ?? f.title : "ERT plays this film in Greece only"}
                  >
                    <span className={styles.play} aria-hidden>
                      {on && playing ? "❚❚" : "▶"}
                    </span>
                    <span className={styles.filmText}>
                      <b>{f.title}</b>
                      {f.original && <i>{f.original}</i>}
                      <small>{can ? filmMeta(f) : "Plays in Greece only (ERT)"}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className={styles.buttons}>
            <button type="button" className={styles.close} onClick={() => onProgramme(false)}>
              Close (F)
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
