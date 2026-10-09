"use client";

// The cinema (/cinema/<painter>): the films about one painter, shown on a real projector in a dark auditorium
// (CinemaScene). One walks in by the door at the back; the first click takes the cursor and starts the first
// film, the house lights dim. K or a click on the screen plays and pauses, N the next film, J / L ten seconds
// back and on, F the programme, M the sound. Leaving: the door behind, or the bar at the top.

import "@/components/museum/renderer-shader-patches";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import type { Film, FilmPainter } from "@/lib/films";
import { entryZ, EYE_HEIGHT } from "@/components/museum/layout";
import type { LockApi } from "@/components/museum/Controls";
import { DOOR, ENTRY_YAW, cinemaLayout } from "./cinema-layout";
import { createRuntime, type CinemaRuntime } from "./cinema-runtime";
import { FilmDeck } from "./film-deck";
import { CinemaScene, type CinemaSceneProps } from "./CinemaScene";
import styles from "./cinema.module.css";

const GL_PROPS = {
  antialias: true,
  alpha: true,
  powerPreference: "high-performance" as const,
  toneMapping: THREE.NeutralToneMapping,
  toneMappingExposure: 1.0,
};

function subscribeTouch(cb: () => void) {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const getTouch = () => window.matchMedia("(pointer: coarse)").matches || !("requestPointerLock" in Element.prototype);

const LANG: Record<string, string> = { el: "Greek", en: "English", fr: "French", de: "German", it: "Italian", es: "Spanish", nl: "Dutch", ru: "Russian" };

function length(s?: number): string | null {
  if (!s) return null;
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.max(1, m)} min`;
}

export function filmMeta(f: Film): string {
  return [f.year, length(f.seconds), f.source, f.lang && f.lang !== "en" && LANG[f.lang] ? `in ${LANG[f.lang]}` : null]
    .filter(Boolean)
    .join(" · ");
}

const Scene = memo(CinemaScene);

export function CinemaApp({ painter }: { painter: FilmPainter }) {
  const router = useRouter();
  const touch = useSyncExternalStore(subscribeTouch, getTouch, () => false);
  const layout = useMemo(() => cinemaLayout(), []);
  const [deck] = useState(() => new FilmDeck());
  const runtime = useRef<CinemaRuntime>(createRuntime(deck));
  const state = useSyncExternalStore(deck.subscribe, deck.getState, deck.getState);
  const camera = useMemo(
    () => ({
      fov: 55, near: 0.05, far: 80,
      position: [DOOR.x, EYE_HEIGHT, entryZ(layout)] as [number, number, number],
      rotation: [0, -ENTRY_YAW, 0] as [number, number, number],
    }),
    [layout]
  );
  const lockApi = useRef<LockApi | null>(null);
  const [entering, setEntering] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [locked, setLocked] = useState(false);
  const [stepped, setStepped] = useState(false);
  const [touchActive, setTouchActive] = useState(false);
  const [programme, setProgramme] = useState(false);
  const [muted, setMuted] = useState(false);
  const [greece, setGreece] = useState<boolean | null>(null);
  const [origin, setOrigin] = useState("");
  const back = painter.gallery ? `/museum/${painter.slug}` : "/cinema";

  useEffect(() => {
    setOrigin(window.location.origin);
    const t = setTimeout(() => setEntering(true), 350);
    fetch("/api/films/where")
      .then((r) => r.json())
      .then((d: { greece: boolean | null }) => setGreece(d.greece))
      .catch(() => {});
    return () => clearTimeout(t);
  }, []);
  useEffect(() => () => deck.dispose(), [deck]);

  // ERT's films that play in Greece only: elsewhere its player shows a notice instead
  const playable = useCallback((f: Film) => !f.geo || greece !== false, [greece]);
  const films = painter.films;
  const current = state.film;

  const playFilm = useCallback(
    (f: Film) => {
      if (!playable(f)) return;
      void deck.load(f, true);
    },
    [deck, playable]
  );
  const next = useCallback(() => {
    const list = films.filter(playable);
    if (!list.length) return;
    const i = current ? list.findIndex((f) => f.id === current.id) : -1;
    playFilm(list[(i + 1) % list.length]);
  }, [films, playable, current, playFilm]);
  const toggle = useCallback(() => {
    if (!deck.state.film) {
      const first = films.find(playable);
      if (first) playFilm(first);
    } else deck.toggle();
  }, [deck, films, playable, playFilm]);

  // a film that ends: the lights come up; the next one waits for the visitor
  const engaged = touch ? touchActive : locked;
  const walkEnabled = arrived && !programme;

  const onLockChange = useCallback((l: boolean) => {
    setLocked(l);
    if (l) {
      setStepped(true);
      setProgramme(false);
    }
  }, []);
  const firstStep = useRef(true);
  const stepInside = useCallback(() => {
    if (touch) setTouchActive(true);
    else lockApi.current?.lock();
    setStepped(true);
    if (firstStep.current) {
      firstStep.current = false;
      // the click that takes one in starts the first film (a user gesture: sound is allowed)
      if (!deck.state.film) {
        const first = films.find(playable);
        if (first) playFilm(first);
      }
    }
  }, [touch, deck, films, playable, playFilm]);

  const leave = useCallback(() => {
    deck.stop();
    if (document.pointerLockElement) document.exitPointerLock();
    router.push(back);
  }, [deck, router, back]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "KeyK") toggle();
      else if (e.code === "KeyN") next();
      else if (e.code === "KeyJ") deck.seek(-10);
      else if (e.code === "KeyL") deck.seek(10);
      else if (e.code === "KeyM") {
        setMuted((m) => {
          deck.setMuted(!m);
          return !m;
        });
      } else if (e.code === "KeyF") {
        setProgramme((p) => {
          if (!p && document.pointerLockElement) document.exitPointerLock();
          return !p;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, next, deck]);

  const onArrived = useCallback(() => setArrived(true), []);
  const deckKey = `${current?.id ?? "none"}:${state.mode ?? ""}:${current?.kind === "dailymotion" && state.status === "paused" ? "down" : ""}`;
  const sceneProps: CinemaSceneProps = {
    runtime, layout, walkEnabled, entering, arrived, onArrived, touch, touchActive, onLockChange, lockApi,
    onScreen: toggle, onLeave: leave, origin, deckKey,
  };

  const playing = state.status === "playing";
  const showStart = arrived && !engaged && !programme;
  const filmCount = `${films.length} film${films.length === 1 ? "" : "s"}`;

  return (
    <div className="mus-root">
      <Canvas shadows={false} frameloop="always" camera={camera} gl={GL_PROPS} dpr={[1, 1.5]}>
        <Scene {...sceneProps} />
      </Canvas>

      <div className={`${styles.fade}${entering ? ` ${styles.fadeOut}` : ""}`} />
      <div className="crosshair" style={{ opacity: !touch && locked && !programme ? 1 : 0 }} />

      <div className={`mus-top ${styles.top}`}>
        <div className={styles.topSide}>
          <Link href={back} className="mus-back" onClick={() => deck.stop()}>
            ← {painter.gallery ? "Gallery" : "All painters"}
          </Link>
        </div>
        <div className={`mus-placard ${styles.placard}`}>
          <h1>{painter.name}</h1>
          <p>
            Cinema · {painter.years ? `${painter.years} · ` : ""}
            {filmCount}
          </p>
        </div>
        <div className={`${styles.topSide} ${styles.topRight}`}>
          <Link href="/cinema" className="mus-back" onClick={() => deck.stop()}>
            Painters on film
          </Link>
        </div>
      </div>

      {current && (
        <div className={`${styles.nowShowing}${engaged ? ` ${styles.dim}` : ""}`} role="status">
          <span className={styles.state}>
            {state.status === "loading" ? "Loading" : state.status === "playing" ? "Now showing" : state.status === "ended" ? "The end" : state.status === "error" ? "Not playing" : "Paused"}
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
            {current.credit && ` · ${current.credit}`}
          </small>
          {state.error && <small className={styles.error}>{state.error}</small>}
        </div>
      )}

      {engaged && (
        <div className={`mus-hint ${styles.hint}`}>
          {touch ? (
            <>
              <span><b>Drag</b> look</span>
              <span><b>Tap floor</b> walk</span>
            </>
          ) : (
            <>
              <span><b>W A S D</b> walk</span>
              <span><b>Click screen</b> or <b>K</b> {playing ? "pause" : "play"}</span>
              <span><b>N</b> next film</span>
              <span><b>J L</b> −10 s +10 s</span>
              <span><b>C</b> sit</span>
              <span><b>F</b> films</span>
              <span><b>M</b> {muted ? "sound on" : "mute"}</span>
              <span><b>Esc</b> release</span>
            </>
          )}
        </div>
      )}

      {(programme || (showStart && stepped)) && (
        <aside className={styles.programme} aria-label="Films">
          <header>
            <h2>Films about {painter.name}</h2>
            <p>From the painter&apos;s Wikipedia articles: {filmCount}</p>
          </header>
          <ol>
            {films.map((f) => {
              const can = playable(f);
              const on = current?.id === f.id;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    className={`${styles.film}${on ? ` ${styles.on}` : ""}`}
                    disabled={!can}
                    onClick={() => {
                      if (on) deck.toggle();
                      else playFilm(f);
                    }}
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
          {programme && (
            <button type="button" className={styles.close} onClick={() => setProgramme(false)}>
              Close (F)
            </button>
          )}
        </aside>
      )}

      {showStart && stepped && (
        <div className={`mus-click-to-start ${styles.resume}`} onClick={stepInside}>
          <p className={styles.resumePill}>{touch ? "Tap to walk on" : "Click, or press W, to walk on"}</p>
        </div>
      )}

      {showStart && !stepped && (
        <div className={`mus-click-to-start ${styles.start}`} onClick={stepInside}>
          <h2>{painter.name}</h2>
          <p>Cinema · {filmCount}</p>
          <p>
            {touch ? "Tap" : "Click"} to step inside: the first film starts
            {current ? "" : `, “${films.find(playable)?.title ?? films[0]?.title}”`}
          </p>
          <p className="mus-start-credit">
            Films linked from Wikipedia, playing from their own sources (ERT, Wikimedia Commons, YouTube…) · for
            educational purposes only
          </p>
        </div>
      )}
    </div>
  );
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  return h ? `${h}:${String(m % 60).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
