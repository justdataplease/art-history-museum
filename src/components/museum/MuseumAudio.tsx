"use client";

// Quiet, era-appropriate background music for a gallery visit.
//
// A single detached HTMLAudioElement (no Web Audio graph, so no CORS
// dependency on upload.wikimedia.org) plays the era's playlist from
// ./music.ts in order, looping. Volume is driven by requestAnimationFrame
// ramps: a slow fade-in when the visitor arrives, a duck while a painting is
// being inspected, a fade-out on mute / unmount. Every recording is credited
// (composer, work, performer, licence, Commons link) because CC BY(-SA)
// requires it.

import { useCallback, useEffect, useRef, useState } from "react";
import type { EraKey } from "./theme";
import { ERA_MUSIC, licenseUrl, trackCredit, type Track } from "./music";
import styles from "./MuseumAudio.module.css";

const GALLERY_VOLUME = 0.32;
const INSPECT_VOLUME = 0.16;
const ARRIVAL_FADE_MS = 3000; // first fade-in as the doors open
const RESUME_FADE_MS = 1500; // unmute, next track
const DUCK_MS = 700; // inspect duck / restore
const FADE_OUT_MS = 1000; // mute, unmount
const TRACK_GAP_MS = 2000; // silence between tracks
const ERROR_SKIP_MS = 600; // pause before skipping a broken track
const CREDIT_MS = 7000; // how long the now-playing caption stays up
const STORAGE_KEY = "timeline-museum:music-muted";

/** Events that can grant the user activation needed to start playback. */
const GESTURES = ["pointerdown", "pointerup", "keydown", "touchend"] as const;

interface Controller {
  /** Reconcile the element with started / muted / inspecting. */
  sync(): void;
  /** True while playback is wanted but blocked by the autoplay policy. */
  blocked(): boolean;
}

/** Stored preference, or null if the visitor never chose. */
function readMuted(): boolean | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null; // storage disabled / sandboxed
  }
}

/** iOS ignores HTMLMediaElement.volume (always 1), so the quiet gallery
 *  level and fades are impossible there: start muted unless asked. */
function volumeIsFixed(): boolean {
  try {
    const probe = new Audio();
    probe.volume = 0.5;
    return probe.volume !== 0.5;
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // preference simply isn't persisted
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function isMuteKey(e: KeyboardEvent): boolean {
  return (
    (e.key === "m" || e.key === "M") &&
    !e.repeat &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !isTypingTarget(e.target)
  );
}

export function MuseumAudio({
  era,
  started,
  inspecting,
}: {
  era: EraKey;
  /** The visitor has arrived (the doors have opened). */
  started: boolean;
  /** A painting is open in the inspect view: duck the music. */
  inspecting: boolean;
}) {
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [current, setCurrent] = useState<Track | null>(null);
  const [creditVisible, setCreditVisible] = useState(false);

  const startedRef = useRef(started);
  const inspectingRef = useRef(inspecting);
  const mutedRef = useRef(false);
  const ctrlRef = useRef<Controller | null>(null);
  const creditTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showCredit = useCallback((track: Track) => {
    setCurrent(track);
    setCreditVisible(true);
    if (creditTimer.current) clearTimeout(creditTimer.current);
    creditTimer.current = setTimeout(() => setCreditVisible(false), CREDIT_MS);
  }, []);

  // Restore the visitor's mute preference (client only — keeps SSR markup
  // stable). Declared before the playback effect so it applies first.
  useEffect(() => {
    const initial = readMuted() ?? volumeIsFixed();
    mutedRef.current = initial;
    setMuted(initial);
    ctrlRef.current?.sync();
  }, []);

  // Playback engine: one audio element per era (in practice per visit).
  useEffect(() => {
    const tracks = ERA_MUSIC[era] ?? [];
    if (tracks.length === 0) return;

    const audio = new Audio();
    audio.preload = "none"; // nothing is fetched until the visitor arrives
    audio.volume = 0;

    let disposed = false;
    let index = 0;
    let sources: string[] = [];
    let sourceIdx = 0;
    let loaded = false;
    let gaveUp = false;
    let failures = 0;
    let arrived = false;
    let wantCredit = false;
    let gestureArmed = false;
    let playSeq = 0;
    let rampRaf = 0;
    let gapTimer: ReturnType<typeof setTimeout> | null = null;

    const shouldPlay = () => startedRef.current && !mutedRef.current && !gaveUp;
    const target = () => (inspectingRef.current ? INSPECT_VOLUME : GALLERY_VOLUME);

    const cancelRamp = () => {
      if (rampRaf) cancelAnimationFrame(rampRaf);
      rampRaf = 0;
    };

    const ramp = (to: number, ms: number, done?: () => void) => {
      cancelRamp();
      const from = audio.volume;
      // rAF doesn't run in background tabs, so jump straight there.
      if (ms <= 0 || Math.abs(to - from) < 0.002 || document.hidden) {
        audio.volume = to;
        done?.();
        return;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, Math.max(0, (now - t0) / ms));
        const eased = k * k * (3 - 2 * k);
        audio.volume = Math.min(1, Math.max(0, from + (to - from) * eased));
        if (k < 1) {
          rampRaf = requestAnimationFrame(step);
        } else {
          rampRaf = 0;
          done?.();
        }
      };
      rampRaf = requestAnimationFrame(step);
    };

    const clearGap = () => {
      if (gapTimer) clearTimeout(gapTimer);
      gapTimer = null;
    };

    const startAfter = (ms: number) => {
      clearGap();
      gapTimer = setTimeout(() => {
        gapTimer = null;
        if (shouldPlay()) play();
      }, ms);
    };

    const fadeOutAndPause = () => {
      ramp(0, FADE_OUT_MS, () => {
        if (!shouldPlay()) audio.pause();
      });
    };

    /** Point the element at track i. Prefers the MP3 transcode (Safari),
     *  keeping the original as a fallback. False if nothing is playable. */
    const setSource = (i: number): boolean => {
      index = i;
      const track = tracks[i];
      sources = [];
      if (track.mp3 && audio.canPlayType("audio/mpeg")) sources.push(track.mp3);
      if (audio.canPlayType(track.originalType)) sources.push(track.original);
      sourceIdx = 0;
      setCurrent(track);
      if (sources.length === 0) return false;
      audio.preload = "auto";
      audio.src = sources[0];
      loaded = true;
      return true;
    };

    const giveUp = () => {
      gaveUp = true; // e.g. offline: stay silent rather than spin
      clearGap();
      cancelRamp();
      disarmGesture();
      audio.pause();
    };

    /** Move to the next playable track and start it after `delay` ms. */
    const advance = (delay: number) => {
      clearGap();
      cancelRamp();
      audio.volume = 0;
      for (let k = 1; k <= tracks.length; k++) {
        if (setSource((index + k) % tracks.length)) {
          startAfter(delay);
          return;
        }
      }
      giveUp();
    };

    const failTrack = () => {
      failures += 1;
      if (failures >= tracks.length) giveUp();
      else advance(ERROR_SKIP_MS);
    };

    const onGesture = (e: Event) => {
      // "M" is the mute toggle; let that handler decide what it means.
      if (e instanceof KeyboardEvent && isMuteKey(e)) return;
      play();
    };

    const armGesture = () => {
      if (gestureArmed) return;
      gestureArmed = true;
      setBlocked(true);
      for (const type of GESTURES) window.addEventListener(type, onGesture, true);
    };

    function disarmGesture() {
      if (!gestureArmed) return;
      gestureArmed = false;
      setBlocked(false);
      for (const type of GESTURES) window.removeEventListener(type, onGesture, true);
    }

    function play() {
      if (disposed || !shouldPlay()) return;
      if (!loaded && !setSource(index)) {
        failTrack();
        return;
      }
      wantCredit = true;
      const seq = ++playSeq;
      let attempt: Promise<void>;
      try {
        attempt = audio.play();
      } catch {
        return; // never throw from the music
      }
      attempt.then(
        () => {
          if (disposed || seq !== playSeq) return;
          disarmGesture();
          if (!shouldPlay()) {
            fadeOutAndPause();
            return;
          }
          ramp(target(), arrived ? RESUME_FADE_MS : ARRIVAL_FADE_MS);
          arrived = true;
        },
        (err: unknown) => {
          if (disposed || seq !== playSeq) return;
          const name = err instanceof DOMException ? err.name : "";
          // Cold page load without user activation: retry on the first
          // gesture. AbortError (source changed / paused first) and
          // NotSupportedError (handled by the 'error' event) need nothing.
          if (name === "NotAllowedError") armGesture();
        }
      );
    }

    const onPlaying = () => {
      if (disposed) return;
      failures = 0;
      if (wantCredit) {
        wantCredit = false;
        showCredit(tracks[index]);
      }
    };

    const onEnded = () => {
      if (!disposed) advance(TRACK_GAP_MS);
    };

    const onError = () => {
      if (disposed || !loaded) return;
      // Same recording, other encoding (MP3 transcode -> original upload).
      if (sourceIdx + 1 < sources.length) {
        sourceIdx += 1;
        audio.src = sources[sourceIdx];
        startAfter(0); // let the failed load finish rejecting first
        return;
      }
      failTrack();
    };

    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    const sync = () => {
      if (disposed) return;
      if (shouldPlay()) {
        if (gapTimer) return; // the next track starts by itself
        if (audio.paused) play();
        else ramp(target(), DUCK_MS);
      } else {
        clearGap();
        if (!audio.paused) fadeOutAndPause();
      }
    };

    const ctrl: Controller = { sync, blocked: () => gestureArmed };
    ctrlRef.current = ctrl;
    sync();

    return () => {
      disposed = true;
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
      clearGap();
      disarmGesture();
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        cancelRamp();
        audio.pause();
        audio.removeAttribute("src");
        audio.load(); // drop the network connection and decoded buffers
      };
      if (!audio.paused && audio.volume > 0.005) {
        ramp(0, FADE_OUT_MS, release);
        setTimeout(release, FADE_OUT_MS + 400); // in case rAF is throttled
      } else {
        release();
      }
    };
  }, [era, showCredit]);

  // Mirror props for the engine and reconcile.
  useEffect(() => {
    startedRef.current = started;
    inspectingRef.current = inspecting;
    ctrlRef.current?.sync();
  }, [started, inspecting]);

  useEffect(
    () => () => {
      if (creditTimer.current) clearTimeout(creditTimer.current);
    },
    []
  );

  /** The control does what its label says: if autoplay was blocked, this
   *  gesture starts the music; otherwise it toggles mute. */
  const activate = useCallback(() => {
    const ctrl = ctrlRef.current;
    if (ctrl && ctrl.blocked() && !mutedRef.current) {
      ctrl.sync();
      return;
    }
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    writeMuted(next);
    if (next) setCreditVisible(false);
    ctrl?.sync(); // synchronous, so an unmute keeps the gesture's activation
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isMuteKey(e)) activate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activate]);

  const tracks = ERA_MUSIC[era] ?? [];
  if (tracks.length === 0) return null;

  const track = current && tracks.includes(current) ? current : tracks[0];
  const off = muted || blocked;
  const performer = track.performer && track.performer !== track.composer ? track.performer : null;
  const deed = licenseUrl(track.license);

  return (
    <div
      className={styles.root}
      data-ready={started ? "true" : "false"}
      data-inspecting={inspecting ? "true" : "false"}
    >
      <button
        type="button"
        className={styles.button}
        data-off={off ? "true" : "false"}
        aria-label={off ? "Play music" : "Mute music"}
        title={trackCredit(track)}
        onClick={activate}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18V5l11-2v13" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="17.5" cy="16" r="2.5" />
          {off && <path d="M3.5 3.5l17 17" />}
        </svg>
      </button>

      {/* hidden while a painting is inspected: it would cover the work's lower-left corner */}
      <div className={styles.credit} data-visible={creditVisible && !off && !inspecting ? "true" : "false"}>
        <div className={styles.eyebrow}>
          {muted ? "Music muted · M" : blocked ? "Click anywhere for music" : "Now playing"}
        </div>
        <div className={styles.work}>{track.title}</div>
        <div className={styles.meta}>
          {track.composer}
          {performer && <> · performed by {performer}</>}
        </div>
        <div className={styles.meta}>
          <a href={track.page} target="_blank" rel="noreferrer">
            Wikimedia Commons
          </a>
          {", "}
          {deed ? (
            <a href={deed} target="_blank" rel="noreferrer">
              {track.license}
            </a>
          ) : (
            track.license
          )}
        </div>
      </div>
    </div>
  );
}
