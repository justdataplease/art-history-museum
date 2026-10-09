"use client";

// The audio guide narrates the painting the visitor stands in front of: what you see in it first, then what it is
// and its story, and the first time they meet an artist's work, the artist. Three modes (G, or the button, cycles
// them): famous works (the default: it starts by itself at the works most people come to see), every work, off.
//
// The text is standard, prepared data (archive/guide.py -> /api/guide/<artist>): one script per artist and per
// work, with a stable id and version. The voice is separate: a recording of the script when there is one
// (public/audio/guide/<id>.mp3, subtitles timed by sentence length), else a voice reading it one sentence at a
// time (voice.ts): the natural AI voice, run on this device, where it can run and is chosen (Settings), else the
// browser's most natural voice. All at the visitor's speed (the 1× button, or Settings). The sentence being
// read shows as a subtitle; the gallery music steps back while the guide speaks.
//
// "In front of": within NEAR metres, the painting ahead of the visitor (FACING), for DWELL_MS. Checked on a
// timer, not per frame: the canvas renders on demand and stops drawing when the visitor stands still.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import * as THREE from "three";
import type { GuideArtist, Painting } from "@/lib/types";
import type { Placement } from "./layout";
import { duckMusic } from "./MuseumAudio";
import { GUIDE_SPEEDS, getSettings, setSettings, useSettings } from "./settings";
import { naturalVoice, pickBrowserVoice, speakBrowser, type Speaking } from "./voice";
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

/** The AI voice for this visitor: chosen in Settings (which downloads it, once), or (auto) when it is on this
 *  device already. It never downloads by itself. */
function wantsNatural(): boolean {
  const s = getSettings();
  if (s.guideVoice === "browser") return false;
  return s.guideVoice === "natural" || naturalVoice.onDevice === true;
}
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
}

export function AudioGuide({ placements, cameraRef, artists, gallerySlug, active, inspect, touch }: Props) {
  const [supported, setSupported] = useState(false);
  const [mode, setMode] = useState<Mode>("off");
  const on = mode !== "off";
  const famous = useMemo(() => famousOf(placements), [placements]);
  const [line, setLine] = useState<string | null>(null);
  const [credit, setCredit] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const current = useRef<string | null>(null);
  const introduced = useRef(new Set<string>());
  const speech = useRef<Speaking | null>(null);
  const settings = useSettings();
  const naturalState = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getState, () => "idle" as const);
  const naturalProgress = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getProgress, () => 0);
  const scripts = useRef(new Map<string, Promise<ArtistScripts | null>>());
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const modeRef = useRef<Mode>("off");
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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

  // the AI voice warms up in the background while the browser's reads: when chosen in Settings (downloaded once,
  // kept by the browser), or on Auto when it is on this device already
  useEffect(() => {
    if (!on) return;
    void naturalVoice.checkDevice().then(() => {
      if (wantsNatural()) void naturalVoice.load();
    });
  }, [on, settings.guideVoice]);

  // the gallery's scripts, ahead of the first painting
  useEffect(() => {
    if (on && gallerySlug) load(gallerySlug);
  }, [on, gallerySlug, load]);

  const silence = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    speech.current?.stop();
    speech.current = null;
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

  /** Read the scripts in order: a recording when there is one, else the browser's voice. */
  const play = useCallback(
    (key: string, queue: Script[]) => {
      silence();
      current.current = key;
      setSpeaking(true);
      setPaused(false);
      duckMusic(0.25, 0.8);
      const credits = [...new Set(queue.flatMap((s) => s.sources.filter((x) => x.name === "Wikipedia").map(() => "Wikipedia, CC BY-SA 4.0")))];
      setCredit(credits.length ? `Text: ${credits.join(" · ")}` : null);
      const next = (i: number) => {
        if (current.current !== key) return;
        if (i >= queue.length) return finished(key);
        const s = queue[i];
        const lines = toSentences(s.lines);
        if (s.audio) {
          // a recording: subtitles by each sentence's share of the text
          const a = audioEl.current ?? (audioEl.current = new Audio());
          a.src = s.audio;
          a.playbackRate = getSettings().guideSpeed;
          a.onended = () => next(i + 1);
          a.onerror = () => speakLines(lines, () => next(i + 1));
          a.onloadedmetadata = () => {
            const total = lines.reduce((n, l) => n + l.length, 0) || 1;
            let t = 0;
            for (const l of lines) {
              const at = (t / total) * a.duration * 1000;
              timers.current.push(setTimeout(() => current.current === key && setLine(l), at));
              t += l.length;
            }
          };
          a.play().catch(() => speakLines(lines, () => next(i + 1)));
        } else speakLines(lines, () => next(i + 1));
      };
      const speakLines = (lines: string[], done: () => void) => {
        if (!lines.length) return done();
        const s = getSettings();
        const o = {
          speed: s.guideSpeed,
          onLine: (text: string) => current.current === key && setLine(text),
          onEnd: () => current.current === key && done(),
        };
        if (wantsNatural() && naturalVoice.state === "ready") speech.current = naturalVoice.speak(lines, s.naturalVoice, o);
        else if ("speechSynthesis" in window) speech.current = speakBrowser(lines, pickBrowserVoice(s.browserVoice), o);
        else done();
      };
      next(0);
    },
    [silence, finished]
  );

  const narrate = useCallback(
    async (pl: Placement) => {
      const p = pl.painting;
      const slug = p.artistSlug ?? gallerySlug;
      if (!slug) return;
      const key = p.slug;
      current.current = key; // claim it now: the scripts may still be loading
      // in a custom room a work's slug is "<artist>--<work>"
      const workSlug = p.artistSlug && p.slug.startsWith(`${slug}--`) ? p.slug.slice(slug.length + 2) : p.slug;
      const doc = await load(slug);
      if (current.current !== key) return;
      const who = artists.find((a) => a.slug === slug);
      const queue: Script[] = [doc?.works[workSlug] ?? fallbackWork(p, p.artistName ?? who?.name ?? "")];
      if (!introduced.current.has(slug)) {
        introduced.current.add(slug);
        const life = doc?.artist ?? (who ? fallbackArtist(who) : null);
        // after the painting: the artist (who they were, in "famous works"; their life, in "every work")
        if (life) queue.push(modeRef.current === "all" ? life : { ...life, lines: life.lines.slice(0, 2) });
      }
      play(key, queue);
    },
    [artists, gallerySlug, load, play]
  );

  const toggle = useCallback(() => {
    setMode((m) => {
      const next = MODES[(MODES.indexOf(m) + 1) % MODES.length];
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      if (next === "off") stop();
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
        return;
      }
      if (best && key !== current.current && now - since >= DWELL_MS) void narrate(best);
    }, CHECK_MS);
    return () => clearInterval(iv);
  }, [on, mode, famous, active, inspect, placements, cameraRef, narrate]);

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
  const loadingVoice = on && naturalState === "loading" && wantsNatural();
  return (
    <>
      <div className={`mus-guide ${styles.guide}`}>
        <button
          type="button"
          className={`${styles.toggle}${on ? ` ${styles.on}` : ""}`}
          onClick={toggle}
          aria-pressed={on}
          title="Audio guide (G): famous works (it starts by itself at them), every work, or off"
        >
          <span aria-hidden>🎧</span> Audio guide: {MODE_LABEL[mode]}
          {!touch && <kbd>G</kbd>}
        </button>
        {on && (
          <button
            type="button"
            className={styles.small}
            onClick={cycleSpeed}
            title="Reading speed (from the next sentence); the voice is in Settings"
            aria-label={`Reading speed ${settings.guideSpeed} times`}
          >
            {speedLabel(settings.guideSpeed)}
          </button>
        )}
        {loadingVoice && (
          <span className={styles.status} title="A natural voice, run on this device: downloaded once, then kept by the browser">
            Natural voice {Math.round(naturalProgress * 100)}%
          </span>
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
      {on && line && (
        <div className={styles.subtitle} role="status" aria-live="polite">
          {line}
          {credit && <small className={styles.credit}>{credit}</small>}
        </div>
      )}
    </>
  );
}
