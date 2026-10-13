"use client";

// The audio guide narrates the painting the visitor stands in front of: what you see in it first, then what it is
// and its story, and the first time they meet an artist's work, the artist. Three modes (G, or the button, cycles
// them): famous works (the default: it starts by itself at the works most people come to see), every work, off.
//
// The text is standard, prepared data (archive/guide.py -> /api/guide/<artist>): one script per artist and per
// work, with a stable id and version. The voice is separate: a recording of the script when there is one
// (public/audio/guide/<id>.mp3, subtitles timed by sentence length), else a voice reading it one sentence at a
// time (voice.ts): the natural voice (Pocket, Alba first), run on this device, by default wherever it can run
// (downloaded once, when the guide first reads with it: the guide waits for it), else the browser's most natural
// voice. A switch beside the guide's buttons chooses between the two (remembered on this device; Settings too),
// and a reading switched goes on from the same sentence. After a serious problem that lasts, the natural voice
// gives way to the browser's for the visit, with a note why (unless locked in Settings). The natural voice starts
// on a painting's first sentence as soon as the visitor stops at it, before the guide begins. All at the visitor's
// speed (the 1× button, or Settings), but the natural voice, which keeps its own pace.
// The sentence being read shows as a subtitle; the gallery music steps back while the guide speaks.
//
// "In front of": within NEAR metres, the painting ahead of the visitor (FACING), for DWELL_MS. Checked on a
// timer, not per frame: the canvas renders on demand and stops drawing when the visitor stands still.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import * as THREE from "three";
import type { GuideArtist, Painting } from "@/lib/types";
import type { Placement } from "./layout";
import { duckMusic } from "./MuseumAudio";
import { GUIDE_SPEEDS, getSettings, setSettings, useSettings, type GuideVoice } from "./settings";
import {
  NATURAL_VOICES,
  naturalPossible,
  naturalVoice,
  pickBrowserVoice,
  speakBrowser,
  voiceInfo,
  voicesReady,
  type NaturalState,
  type SpeakOptions,
  type Speaking,
} from "./voice";
import styles from "./AudioGuide.module.css";

const STORAGE_KEY = "timeline-museum:audio-guide";
const NEAR = 2.8;
const FACING = 0.5; // cosine: within about 60° of the view direction
const DWELL_MS = 900;
const CHECK_MS = 300;
/** Yearly Wikipedia pageviews of a work's article from which it counts as famous (about 2,000 works). */
const FAMOUS_VIEWS = 5000;

type Mode = "famous" | "all" | "off";
const MODES: Mode[] = ["famous", "all", "off"];
const MODE_LABEL: Record<Mode, string> = { famous: "famous works", all: "every work", off: "off" };
function readMode(): Mode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "on") return "all"; // the earlier on / off switch
    if (v === "famous" || v === "all" || v === "off") return v;
  } catch {}
  return "famous";
}

/** The works the guide starts at by itself in "famous works": the well-known ones, the gallery's flagship, and
 *  the room's three most-read works (so every room has its highlights). */
function famousOf(placements: Placement[]): Set<string> {
  const views = (pl: Placement) => pl.painting.pageviews ?? 0;
  const out = new Set(placements.filter((pl) => views(pl) >= FAMOUS_VIEWS).map((pl) => pl.painting.slug));
  if (placements[0]) out.add(placements[0].painting.slug);
  const byRoom = new Map<number, Placement[]>();
  for (const pl of placements) if (views(pl) > 0) byRoom.set(pl.room, [...(byRoom.get(pl.room) ?? []), pl]);
  for (const list of byRoom.values()) list.sort((a, b) => views(b) - views(a)).slice(0, 3).forEach((pl) => out.add(pl.painting.slug));
  return out;
}

/** One prepared script (archive/guide.py). */
interface Script {
  id: string;
  version: string;
  lines: string[];
  seconds: number;
  sources: { name: string; url: string | null; license: string }[];
  audio: string | null;
}
interface ArtistScripts {
  artist: Script;
  works: Record<string, Script>;
}

/** When no prepared script loads: the same shape from the text already on the page. */
function fallbackArtist(a: GuideArtist): Script {
  const lines = [`${a.name}${a.birthYear != null ? `, ${a.birthYear}–${a.deathYear ?? ""}` : ""}.`, a.bio]
    .filter(Boolean);
  return { id: `artist:${a.slug}`, version: "page", lines, seconds: 0, sources: [], audio: null };
}
const DESCRIBES = /\b(depict(s|ed|ing)?|shows?|showing|portray(s|ed|ing)?)\b/i;
const NEGATED = /\b(not|never|misnomer)\b/i;
function fallbackWork(p: Painting, artistName: string): Script {
  const story = toSentences([p.story ?? ""]);
  const seen = story.filter((x) => DESCRIBES.test(x) && !NEGATED.test(x)).slice(0, 2);
  const lines = [
    ...seen,
    `${p.title}, by ${artistName}${p.year != null ? `, ${p.year}` : ""}.`,
    ...story.filter((x) => !seen.includes(x)).slice(0, 4),
    ...p.facts.slice(0, 2),
  ].filter(Boolean);
  return { id: `work:${p.slug}`, version: "page", lines, seconds: 0, sources: [], audio: null };
}

/** The script's lines as sentences (the page fallback carries whole paragraphs). */
function toSentences(lines: string[]): string[] {
  return lines.flatMap(
    (l) => l.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+["”’)\]]*(\s+|$)|[^.!?]+$/g)?.map((s) => s.trim()) ?? []
  ).filter((s) => s.length > 1);
}

type Kind = "natural" | "browser";
/** The voice that reads: the one chosen where this device has it, else the other; the natural voice, having given
 *  way after a serious problem, the browser's for the rest of the visit (voice.ts). */
function voiceKind(chosen: GuideVoice, state: NaturalState): Kind | null {
  const browser = "speechSynthesis" in window;
  if (chosen === "browser" && browser) return "browser";
  if (naturalPossible() && state !== "slow" && state !== "failed") return "natural";
  return browser ? "browser" : null;
}
/** A voice's reading under way (not a recording): its lines and the one it is on, so the other voice goes on from
 *  there. */
interface Reading {
  key: string;
  lines: string[];
  at: number;
  kind: Kind | null;
  done: () => void;
}
/** Beside the switch: the natural voice's trouble. */
const NOTE = {
  retrying: "Natural voice: trying again…",
  trouble: "The natural voice is having trouble here.",
  slow: "The natural voice is too slow here: the browser's voice reads.",
  failed: "The natural voice would not load: the browser's voice reads.",
};
/** How long the note on giving way shows, ms (the switch's title keeps it). */
const NOTE_MS = 12_000;
const speedLabel = (s: number) => `${s}×`;

interface Props {
  placements: Placement[];
  cameraRef: RefObject<THREE.Camera | null>;
  /** Artists hung here (one in an artist's gallery, several in a custom room): the fallback text. */
  artists: GuideArtist[];
  /** The gallery's own artist; null in a custom room, where every work carries its artist. */
  gallerySlug: string | null;
  /** Walking: doors open, not inspecting or flying back. */
  active: boolean;
  inspect: Placement | null;
  touch: boolean;
  onSettings: () => void;
}

export function AudioGuide({ placements, cameraRef, artists, gallerySlug, active, inspect, touch, onSettings }: Props) {
  const [supported, setSupported] = useState(false);
  const [mode, setMode] = useState<Mode>("off");
  const on = mode !== "off";
  const famous = useMemo(() => famousOf(placements), [placements]);
  const [line, setLine] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const current = useRef<string | null>(null);
  const introduced = useRef(new Set<string>());
  const speech = useRef<Speaking | null>(null);
  const settings = useSettings();
  const naturalState = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getState, () => "idle" as const);
  const naturalProgress = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getProgress, () => 0);
  const naturalTrouble = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getTrouble, () => null);
  // (the switch's download size: read again once the browser says what it keeps)
  useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getDevices, () => 0);
  const reading = useRef<Reading | null>(null);
  const pausedRef = useRef(false);
  const [gaveWay, setGaveWay] = useState<"slow" | "failed" | null>(null);
  const scripts = useRef(new Map<string, Promise<ArtistScripts | null>>());
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const modeRef = useRef<Mode>("off");
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const load = useCallback((slug: string) => {
    let p = scripts.current.get(slug);
    if (!p) {
      p = fetch(`/api/guide/${slug}`).then((r) => (r.ok ? (r.json() as Promise<ArtistScripts>) : null)).catch(() => null);
      scripts.current.set(slug, p);
    }
    return p;
  }, []);

  useEffect(() => {
    const synth = "speechSynthesis" in window;
    setSupported(true); // recordings play without speech synthesis
    setMode(readMode());
    if (!synth) return;
    // Chrome lists its voices a moment after load
    const list = () => window.speechSynthesis.getVoices();
    list();
    window.speechSynthesis.addEventListener?.("voiceschanged", list);
    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", list);
      window.speechSynthesis.cancel();
      duckMusic(1, 1);
    };
  }, []);

  // the lock (Settings), and where the browser has no voice, nothing to give way to
  useEffect(() => {
    naturalVoice.setLock(settings.naturalLock || !("speechSynthesis" in window));
  }, [settings.naturalLock]);

  // the natural voice gave way: a note says why, a while
  useEffect(() => {
    if (naturalState !== "slow" && naturalState !== "failed") return setGaveWay(null);
    setGaveWay(naturalState);
    const t = setTimeout(() => setGaveWay(null), NOTE_MS);
    return () => clearTimeout(t);
  }, [naturalState]);

  // the gallery's scripts, ahead of the first painting
  useEffect(() => {
    if (on && gallerySlug) load(gallerySlug);
  }, [on, gallerySlug, load]);

  const silence = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    speech.current?.stop();
    speech.current = null;
    reading.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    audioEl.current?.pause();
  }, []);

  const stop = useCallback(() => {
    silence();
    current.current = null;
    setSpeaking(false);
    setPaused(false);
    setLine(null);
    duckMusic(1, 1.2);
  }, [silence]);

  const finished = useCallback((key: string) => {
    if (current.current !== key) return;
    current.current = null;
    setSpeaking(false);
    duckMusic(1, 1.5);
    timers.current.push(setTimeout(() => setLine(null), 1500));
  }, []);

  /** A voice reads the lines: the natural voice (waited for while it downloads, or is tried again), else the
   *  browser's. `reading` keeps its place: the other voice, chosen meanwhile, goes on from the same sentence. */
  const speakLines = useCallback(
    function read(key: string, lines: string[], done: () => void) {
      if (current.current !== key) return;
      if (!lines.length) return done();
      const s = getSettings();
      const kind = voiceKind(s.guideVoice, naturalVoice.state);
      const r: Reading = { key, lines, at: 0, kind, done };
      reading.current = r;
      const mine = () => current.current === key && reading.current === r;
      const o: SpeakOptions = {
        speed: s.guideSpeed,
        onLine: (text) => {
          if (!mine()) return;
          r.at = Math.max(r.at, lines.indexOf(text, r.at));
          setLine(text);
        },
        onEnd: () => {
          if (!mine()) return;
          reading.current = null;
          done();
        },
        // the natural voice went mid-reading (it gave way, or another of its voices was chosen): on from there
        onLost: (rest) => {
          if (mine()) read(key, rest, done);
        },
      };
      const start = (sp: Speaking) => {
        speech.current = sp;
        if (pausedRef.current) sp.pause();
      };
      if (kind === "natural") {
        naturalVoice.load(s.aiVoice);
        void naturalVoice.whenReady().then((ok) => {
          if (!mine()) return;
          if (ok) start(naturalVoice.speak(lines, o));
          // it gave way: the browser's voice reads
          else if (voiceKind(getSettings().guideVoice, naturalVoice.state) === "browser") read(key, lines, done);
          // locked, and it would not load (the note says so): nothing reads this painting
          else finished(key);
        });
      } else if (kind === "browser") {
        // with the browser's best voice, not its default (its list can come a moment late)
        void voicesReady().then(() => {
          if (mine()) start(speakBrowser(lines, pickBrowserVoice(s.browserVoice), o));
        });
      } else done();
    },
    [finished]
  );

  /** Read the scripts in order: a recording when there is one, else a voice (speakLines). */
  const play = useCallback(
    (key: string, queue: Script[]) => {
      silence();
      current.current = key;
      setSpeaking(true);
      setPaused(false);
      duckMusic(0.25, 0.8);
      const next = (i: number) => {
        if (current.current !== key) return;
        if (i >= queue.length) return finished(key);
        const s = queue[i];
        const lines = toSentences(s.lines);
        const after = () => next(i + 1);
        if (s.audio) {
          // a recording: subtitles by each sentence's share of the text
          reading.current = null;
          const a = audioEl.current ?? (audioEl.current = new Audio());
          a.src = s.audio;
          a.playbackRate = getSettings().guideSpeed;
          a.onended = after;
          a.onerror = () => speakLines(key, lines, after);
          a.onloadedmetadata = () => {
            const total = lines.reduce((n, l) => n + l.length, 0) || 1;
            let t = 0;
            for (const l of lines) {
              const at = (t / total) * a.duration * 1000;
              timers.current.push(setTimeout(() => current.current === key && setLine(l), at));
              t += l.length;
            }
          };
          a.play().catch(() => speakLines(key, lines, after));
        } else speakLines(key, lines, after);
      };
      next(0);
    },
    [silence, finished, speakLines]
  );

  /** A work's script (prepared, else from the page), and its artist's scripts. */
  const scriptOf = useCallback(
    async (pl: Placement) => {
      const p = pl.painting;
      const slug = p.artistSlug ?? gallerySlug;
      if (!slug) return null;
      // in a custom room a work's slug is "<artist>--<work>"
      const workSlug = p.artistSlug && p.slug.startsWith(`${slug}--`) ? p.slug.slice(slug.length + 2) : p.slug;
      const doc = await load(slug);
      const who = artists.find((a) => a.slug === slug);
      return { slug, doc, who, work: doc?.works[workSlug] ?? fallbackWork(p, p.artistName ?? who?.name ?? "") };
    },
    [artists, gallerySlug, load]
  );

  const narrate = useCallback(
    async (pl: Placement) => {
      const key = pl.painting.slug;
      current.current = key; // claim it now: the scripts may still be loading
      const s = await scriptOf(pl);
      if (!s || current.current !== key) return;
      const queue: Script[] = [s.work];
      if (!introduced.current.has(s.slug)) {
        introduced.current.add(s.slug);
        const life = s.doc?.artist ?? (s.who ? fallbackArtist(s.who) : null);
        // after the painting: the artist (who they were, in "famous works"; their life, in "every work")
        if (life) queue.push(modeRef.current === "all" ? life : { ...life, lines: life.lines.slice(0, 2) });
      }
      play(key, queue);
    },
    [scriptOf, play]
  );

  /** The natural voice makes a work's first sentence while the visitor is stopping at it (it reads it a moment
   *  later), once it is here. */
  const prepare = useCallback(
    async (pl: Placement) => {
      if (naturalVoice.state !== "ready" || voiceKind(getSettings().guideVoice, naturalVoice.state) !== "natural") return;
      const s = await scriptOf(pl);
      if (s && !s.work.audio) naturalVoice.prefetch(toSentences(s.work.lines));
    },
    [scriptOf]
  );

  const toggle = useCallback(() => {
    setMode((m) => {
      const next = MODES[(MODES.indexOf(m) + 1) % MODES.length];
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      if (next === "off") {
        stop();
        // the natural voice's memory back to the page until the guide reads again
        naturalVoice.release();
      }
      return next;
    });
  }, [stop]);

  // G switches the guide on and off
  useEffect(() => {
    if (!supported) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.code !== "KeyG") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [supported, toggle]);

  // inspecting a painting narrates it at once
  useEffect(() => {
    if (on && inspect && current.current !== inspect.painting.slug) void narrate(inspect);
  }, [on, inspect, narrate]);

  // walking: the painting the visitor stands in front of, held for DWELL_MS
  useEffect(() => {
    if (!on || !active || inspect) return;
    const dir = new THREE.Vector3();
    let candidate: string | null = null;
    let since = 0;
    let prepared = false;
    const iv = setInterval(() => {
      const cam = cameraRef.current;
      if (!cam) return;
      cam.getWorldDirection(dir);
      const fl = Math.hypot(dir.x, dir.z) || 1;
      let best: Placement | null = null;
      let bestD = NEAR;
      for (const pl of placements) {
        const dx = pl.position[0] - cam.position.x, dz = pl.position[2] - cam.position.z;
        const d = Math.hypot(dx, dz);
        if (d >= bestD || d < 0.01) continue;
        if ((dx * dir.x + dz * dir.z) / (d * fl) < FACING) continue;
        best = pl;
        bestD = d;
      }
      // in "famous works", only the famous ones start it
      if (best && mode === "famous" && !famous.has(best.painting.slug)) best = null;
      const key = best?.painting.slug ?? null;
      const now = performance.now();
      if (key !== candidate) {
        candidate = key;
        since = now;
        prepared = false;
        return;
      }
      if (!best || key === current.current) return;
      if (now - since >= DWELL_MS) void narrate(best);
      // held for a check: the visitor is stopping here, not walking past
      else if (!prepared) {
        prepared = true;
        void prepare(best);
      }
    }, CHECK_MS);
    return () => clearInterval(iv);
  }, [on, mode, famous, active, inspect, placements, cameraRef, narrate, prepare]);

  // the voice switched (here, or in Settings; or the natural voice gave way, or came back): a reading under way goes
  // on from the same sentence with the other
  const kind = supported ? voiceKind(settings.guideVoice, naturalState) : null;
  useEffect(() => {
    const r = reading.current;
    if (!kind || !r || r.kind === kind || current.current !== r.key) return;
    speech.current?.stop();
    speech.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    pausedRef.current = false;
    setPaused(false);
    speakLines(r.key, r.lines.slice(r.at), r.done);
  }, [kind, speakLines]);
  // the browser's chosen: the natural voice's worker goes, and its memory (never two voices at once)
  useEffect(() => {
    if (settings.guideVoice === "browser") naturalVoice.release();
  }, [settings.guideVoice]);

  useEffect(() => () => silence(), [silence]);

  if (!supported) return null;
  const pauseResume = () => {
    const a = audioEl.current;
    if (paused) {
      if (a && a.src && a.currentTime > 0 && !a.ended) void a.play();
      else speech.current?.resume();
    } else {
      if (a && !a.paused) a.pause();
      else speech.current?.pause();
    }
    setPaused(!paused);
  };
  const cycleSpeed = () => {
    const i = GUIDE_SPEEDS.findIndex((s) => Math.abs(s - settings.guideSpeed) < 0.01);
    const guideSpeed = GUIDE_SPEEDS[(i + 1) % GUIDE_SPEEDS.length];
    setSettings({ guideSpeed });
    if (audioEl.current) audioEl.current.playbackRate = guideSpeed;
  };
  const loadingVoice = on && kind === "natural" && naturalState === "loading" && !naturalTrouble;
  // the switch: where both voices can read, the natural one named, with its download until it is here
  const both = naturalPossible() && "speechSynthesis" in window;
  const natural = voiceInfo(settings.aiVoice) ?? NATURAL_VOICES[0];
  const mb = on && both ? naturalVoice.downloadMB(natural.id) : null;
  const pickVoice = (guideVoice: GuideVoice) => {
    // (chosen again, after it gave way: it is tried again)
    if (guideVoice === "natural") naturalVoice.again();
    setSettings({ guideVoice });
  };
  const note =
    kind === "natural" && naturalTrouble === "retrying"
      ? NOTE.retrying
      : kind === "natural" && (naturalState === "stuck" || naturalTrouble === "straining")
        ? NOTE.trouble
        : gaveWay && kind === "browser"
          ? NOTE[gaveWay]
          : null;
  return (
    <>
      <div className={`mus-guide ${styles.guide}`}>
        <div className={styles.bar}>
          <button
            type="button"
            className={`${styles.toggle}${on ? ` ${styles.on}` : ""}`}
            onClick={toggle}
            aria-pressed={on}
            title="Audio guide (G): famous works (it starts by itself at them), every work, or off"
          >
            <span aria-hidden>🎧</span> <span className={styles.long}>Audio guide: </span>
            {MODE_LABEL[mode]}
            {!touch && <kbd>G</kbd>}
          </button>
          {on && (
            <button
              type="button"
              className={`${styles.small} ${styles.settings}`}
              onClick={onSettings}
              aria-label="Audio guide settings"
              title="Audio guide settings: voice and reading speed"
            >
              <span aria-hidden>⚙</span>
            </button>
          )}
          {on && (
            <button
              type="button"
              className={styles.small}
              onClick={cycleSpeed}
              title="Reading speed (from the next sentence; the natural voice keeps its own pace)"
              aria-label={`Reading speed ${settings.guideSpeed} times`}
            >
              {speedLabel(settings.guideSpeed)}
            </button>
          )}
          {on && speaking && (
            <>
              <button type="button" className={styles.small} onClick={pauseResume}>
                {paused ? "Resume" : "Pause"}
              </button>
              <button type="button" className={styles.small} onClick={stop}>
                Skip
              </button>
            </>
          )}
        </div>
        {/* the voice, a row of its own under the guide's buttons (the room navigator is beside them) */}
        {on && (both || loadingVoice || note) && (
          <div className={`mus-guide-voices ${styles.bar}`}>
            {both && (
              <div className={styles.voices} role="group" aria-label="The guide's voice">
                <button
                  type="button"
                  aria-pressed={kind === "natural"}
                  onClick={() => pickVoice("natural")}
                  title={
                    naturalState === "slow" || naturalState === "failed"
                      ? `${NOTE[naturalState]} Press to try the natural voice again.`
                      : `${natural.label}, a natural voice made on this device${mb ? `: about ${mb} MB to download, once` : ""}`
                  }
                >
                  {natural.name}
                  <span className={styles.long}> · natural</span>
                  {mb ? <small>↓ {mb} MB</small> : null}
                </button>
                <button type="button" aria-pressed={kind === "browser"} onClick={() => pickVoice("browser")} title="The browser's own voice">
                  Browser<span className={styles.long}> voice</span>
                </button>
              </div>
            )}
            {loadingVoice && (
              <span className={styles.status} title="A natural voice, run on this device: downloaded once, then kept by the browser">
                Natural voice {Math.round(naturalProgress * 100)}%
              </span>
            )}
            {note && (
              <span className={styles.note} role="status">
                {note}
              </span>
            )}
          </div>
        )}
      </div>
      {on && line && (
        <div className={styles.subtitle} data-inspecting={!!inspect} data-guide-words role="status" aria-live="polite">
          {line}
        </div>
      )}
    </>
  );
}
