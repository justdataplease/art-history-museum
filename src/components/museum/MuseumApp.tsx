"use client";

// Must run before the first WebGL program compiles.
import "./renderer-shader-patches";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";
import type { ArtistWithPaintings, GalleryLink, GuideArtist } from "@/lib/types";
import { buildLayout, entryGate, entryZ, EYE_HEIGHT, type Placement } from "./layout";
import { furnishSizes, furnitureOf } from "./furniture";
import type { ElevatorApi, LiftDirection } from "./Elevator";
import type { ExitSide } from "./ExitDoors";
import { Gallery, type LockApi, type TeleportApi, type WarmupApi } from "./Gallery";
import { RoomNavigator } from "./RoomNavigator";
import { InspectPanel } from "./InspectPanel";
import { duckMusic, MuseumAudio, musicMuted } from "./MuseumAudio";
import { AudioGuide } from "./AudioGuide";
import { FxGate } from "./fx/Gate";
import { SettingsPanel } from "./SettingsPanel";
import { setSettings, useSetting } from "./settings";
import { galleryTheme, roomTheme } from "./theme";
import { createSettleTracker, type SettleTracker } from "./renderer-motion";
import styles from "./museum.module.css";
import { SourceLink } from "@/components/timeline/SourceLink";

const FOV = 55;
/** Let the title on the doors register before they part. */
const MIN_DOORS_MS = 1200;
/** Open even if the first works are still downloading (fallbacks show). */
const GATE_MAX_MS = 4000;
/** ...and even if the shader warm-up has not finished. */
const HARD_MAX_MS = 8000;
/** Longest we hold the doors for the final async compile pass. */
const WARM_CAP_MS = 2500;

// Neutral (Khronos PBR Neutral) keeps the paintings' base colours faithful;
// lighting is tuned for exposure 1. No shadow maps anywhere.
/** A navigator jump: the fade to black, then how long the view stays dark at
 *  least / at most while the new room's works mount and its lights come up. */
const JUMP_FADE_MS = 280;
const JUMP_HOLD_MIN_MS = 520;
const JUMP_HOLD_MAX_MS = 2400;

const GL_PROPS = {
  antialias: true,
  powerPreference: "high-performance" as const,
  toneMapping: THREE.NeutralToneMapping,
  toneMappingExposure: 1.0,
  // Applied when the root is configured, before the first program compiles
  // (onCreated would be too late: it runs after the children's layout
  // effects, which already build the environment). Checking shader errors
  // forces a synchronous link-status query per program: development only.
  debug: { checkShaderErrors: process.env.NODE_ENV !== "production", onShaderError: null },
};

// Touch-only devices get drag-to-look / tap-to-walk instead of pointer lock.
function subscribeTouch(cb: () => void) {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function getTouch() {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    !("requestPointerLock" in Element.prototype)
  );
}
const getTouchServer = () => false;

const FX_AUDIO = { duck: duckMusic, muted: musicMuted };
/** Set before an elevator ride, read by the next floor: step out of the elevator instead of through the doors. */
const LIFT_KEY = "timeline-museum:arrived-by-elevator";
const placardEl = () => document.querySelector(".mus-placard");

export function MuseumApp({
  artist,
  neighbours,
  films = 0,
}: {
  artist: ArtistWithPaintings;
  /** An artist's gallery: the artists before and after in the timeline's order, behind the doors at its end. */
  neighbours?: { prev: GalleryLink | null; next: GalleryLink | null };
  /** Films about the artist in the cinema (/cinema/<slug>): a way there from the top bar. */
  films?: number;
}) {
  // a custom room may choose its room style, wall colour and hanging order (src/lib/rooms.ts)
  const design = artist.room;
  const theme = useMemo(
    () => (design ? roomTheme(artist.periodSlug, design.style, design.wall, design.ground) : galleryTheme(artist.periodSlug)),
    [artist.periodSlug, design]
  );
  const layout = useMemo(() => {
    // the room style's furniture, arranged room by room; a palace gallery's arches; a room with floors has an
    // elevator by the doors
    return buildLayout(artist.paintings, {
      works: theme.works,
      keepOrder: !!design?.keepOrder,
      furnish: furnishSizes(furnitureOf(theme)),
      arches: theme.room.arches,
      elevator: (design?.floors.length ?? 0) > 1,
      exits: !design && !!neighbours,
      phases: design ? undefined : artist.phases?.map((p) => p.name),
    });
  }, [artist, theme, design, neighbours]);
  // the flagship (a thumbnail, in a suite) and the entrance room's nearest works
  const gate = useMemo(() => entryGate(layout), [layout]);
  const rooms = layout.rooms.length;
  const tracker = useMemo(() => createSettleTracker(), [layout]);
  const total = layout.placements.length;
  const touch = useSyncExternalStore(subscribeTouch, getTouch, getTouchServer);

  const [live, setLive] = useState(false); // frameloop: never -> demand
  const [doorsOpen, setDoorsOpen] = useState(false);
  const [entering, setEntering] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [locked, setLocked] = useState(false);
  // once inside, a lost cursor (Esc, leaving a painting with Esc) asks only for a click or a walk key, over the
  // room itself: the full "step inside" card is the arrival's
  const [stepped, setStepped] = useState(false);
  const [touchActive, setTouchActive] = useState(false);
  // the settings card (O), and whether the on-screen controls show (H)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hud = useSetting("hud");
  const [inspect, setInspect] = useState<Placement | null>(null);
  const [returning, setReturning] = useState(false);
  const [allSettled, setAllSettled] = useState(false);
  const [dprCap, setDprCap] = useState(1.5);
  // a suite's room navigator: the room the visitor is in, a pulse on entering
  const [room, setRoom] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [fading, setFading] = useState(false);
  // a custom room's elevator: standing at it, riding it, and whether this floor was reached by it
  const [nearLift, setNearLift] = useState(false);
  const [riding, setRiding] = useState(false);
  const [arrivedByLift, setArrivedByLift] = useState(false);
  const arrivedByLiftRef = useRef(false);
  const announced = useRef(false);
  const teleportApi = useRef<TeleportApi | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const router = useRouter();
  const roomInfo = artist.room;
  // the audio guide's artists: a custom room's, or the gallery's own
  const guideArtists = useMemo<GuideArtist[]>(
    () =>
      roomInfo?.artists ?? [
        {
          slug: artist.slug,
          name: artist.name,
          birthYear: artist.birthYear,
          deathYear: artist.deathYear,
          tagline: artist.tagline,
          bio: artist.bio,
        },
      ],
    [roomInfo, artist]
  );
  const [shared, setShared] = useState(false);
  const [savedRoom, setSavedRoom] = useState(false);
  // a room saved (or shared) from inside is kept in "My rooms" on /rooms (same entry shape as RoomPicker's)
  const saveRoom = useCallback(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      q.delete("f");
      const query = q.toString().replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%2F/g, "/");
      const key = "timeline-museum:my-rooms";
      const rooms = (JSON.parse(localStorage.getItem(key) ?? "[]") as { query: string }[]).filter((r) => r.query !== query);
      localStorage.setItem(key, JSON.stringify([{ title: artist.name, query, savedAt: new Date().toISOString() }, ...rooms].slice(0, 60)));
      setSavedRoom(true);
      setTimeout(() => setSavedRoom(false), 2200);
    } catch {}
  }, [artist.name]);
  const share = useCallback(async () => {
    const url = window.location.href;
    saveRoom();
    try {
      if (navigator.share && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints > 0) {
        await navigator.share({ title: artist.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2200);
    } catch {}
  }, [artist.name, saveRoom]);

  const doorsRef = useRef<HTMLDivElement>(null);
  const crosshairRef = useRef<HTMLDivElement>(null);
  const lockApi = useRef<LockApi | null>(null);
  const warmApi = useRef<WarmupApi | null>(null);
  const inspectRef = useRef<Placement | null>(null);

  const camera = useMemo(
    () => ({
      fov: FOV,
      near: 0.05,
      far: 200,
      position: [0, EYE_HEIGHT, entryZ(layout)] as [number, number, number],
      // A rotation stops R3F from aiming the camera at the origin (which
      // pitched the entry view down); the default −z looks down the hall.
      rotation: [0, 0, 0] as [number, number, number],
    }),
    [layout]
  );

  // ---- painting textures settling (gate + Gallery `ready`)
  const onSettled = useCallback((slug: string) => tracker.add(slug), [tracker]);
  useEffect(
    () =>
      tracker.subscribe(() => {
        if (tracker.count() >= total) setAllSettled(true);
      }),
    [tracker, total]
  );
  // The reflection probe waits for the works it sees: all of them in a single
  // room; in a suite (whose far rooms never load until visited) the room the
  // visitor stands in.
  const roomSlugs = useMemo(
    () => layout.placements.filter((p) => p.room === room).map((p) => p.painting.slug),
    [layout, room]
  );
  const roomSettled = useSyncExternalStore(
    tracker.subscribe,
    () => roomSlugs.every((s) => tracker.has(s)),
    () => false
  );
  const probeReady = rooms > 1 ? roomSettled : allSettled;

  const markArrived = useCallback(() => setArrived(true), []);
  const showRoom = useCallback((r: number) => {
    setRoom(r);
    setPulse((n) => n + 1);
  }, []);
  // The first step inside a suite highlights the navigator; doorways the rest.
  const announceStart = useCallback(() => {
    if (announced.current || rooms < 2) return;
    announced.current = true;
    setPulse((n) => n + 1);
  }, [rooms]);
  const onLockChange = useCallback(
    (l: boolean) => {
      setLocked(l);
      if (l) {
        setStepped(true);
        announceStart();
      }
    },
    [announceStart]
  );
  const onReturned = useCallback(() => setReturning(false), []);
  // Crosshair aim toggles a class directly: no React render per aim change.
  const onAim = useCallback((a: boolean) => {
    crosshairRef.current?.classList.toggle("aim", a);
  }, []);
  const selectPainting = useCallback((pl: Placement) => {
    inspectRef.current = pl;
    setInspect(pl);
  }, []);
  // the inspected work's neighbours in its artist's work, by year (the inspect panel's "before" and "after")
  const around = useMemo(() => {
    if (!inspect) return undefined;
    const who = inspect.painting.artistSlug;
    const mine = layout.placements
      .filter((pl) => pl.painting.artistSlug === who && pl.painting.year != null)
      .sort((a, b) => a.painting.year! - b.painting.year!);
    const i = mine.indexOf(inspect);
    return i < 0 ? undefined : { before: mine[i - 1] ?? null, after: mine[i + 1] ?? null };
  }, [inspect, layout]);
  /** Leave the painting. From a click (the close button) the cursor is captured again in the same gesture, so
   *  the visitor walks on as soon as the camera is back; Esc is not a gesture that may capture it. */
  const closeInspect = useCallback((relock = false) => {
    if (!inspectRef.current) return;
    inspectRef.current = null;
    if (relock && !touch) lockApi.current?.lock(true);
    setReturning(true);
    setInspect(null);
  }, [touch]);

  // Safety net: never stay "returning" if the fly-back is interrupted (a
  // flight back through a suite's doorways takes up to ~2.1 s).
  useEffect(() => {
    if (!returning) return;
    const t = setTimeout(() => setReturning(false), 4000);
    return () => clearTimeout(t);
  }, [returning]);

  // ---- entry doors: open once the flagship and the works nearest the
  // entrance are in and the shaders are compiled (never wait for all of them).
  const doorsStarted = useRef(false);
  useEffect(() => {
    // Already opened in an earlier run of this effect (Fast Refresh): done.
    if (doorsStarted.current) return;
    const t0 = performance.now();
    let phase: "waiting" | "warming" | "opening" = "waiting";
    let disposed = false;
    let raf = 0;
    let tl: gsap.core.Timeline | null = null;

    const swing = () => {
      setEntering(true); // the camera walks through the doorway meanwhile
      const el = doorsRef.current;
      if (!el) {
        setDoorsOpen(true);
        return;
      }
      tl = gsap.timeline({
        onComplete: () => {
          setDoorsOpen(true);
          // in case the entry walk never reports back (no WebGL)
          setTimeout(() => setArrived(true), 1500);
        },
      });
      if (arrivedByLiftRef.current) {
        // the elevator's doors part sideways
        tl.to(el.querySelector(".doors-status"), { opacity: 0, duration: 0.3 })
          .to(el.querySelector(".doors-name"), { opacity: 0, y: -20, duration: 0.5, ease: "power2.in" }, "<")
          .to(el.querySelector(".light-shaft"), { opacity: 1, duration: 0.35, ease: "power2.out" }, "-=0.1")
          .to(el.querySelector(".door-l"), { xPercent: -100, duration: 1.5, ease: "power2.inOut" }, "-=0.1")
          .to(el.querySelector(".door-r"), { xPercent: 100, duration: 1.5, ease: "power2.inOut" }, "<")
          .to(el.querySelector(".light-shaft"), { scaleX: 120, opacity: 0.5, duration: 1.4, ease: "power2.inOut" }, "<")
          .to(el, { opacity: 0, duration: 0.6, ease: "power2.inOut" }, "-=0.6")
          .set(el, { display: "none" });
        return;
      }
      tl.to(el.querySelector(".doors-status"), { opacity: 0, duration: 0.4 })
        .to(el.querySelector(".doors-name"), { opacity: 0, y: -30, duration: 0.7, ease: "power2.in" }, "<")
        // light splits through the crack first…
        .to(el.querySelector(".light-shaft"), { opacity: 1, duration: 0.5, ease: "power2.out" }, "-=0.2")
        // …then the doors swing with a heavy start and soft settle
        .to(el.querySelector(".door-l"), { rotateY: -107, duration: 2.3, ease: "power3.inOut" }, "-=0.3")
        .to(el.querySelector(".door-r"), { rotateY: 107, duration: 2.3, ease: "power3.inOut" }, "<")
        .to(el.querySelector(".light-shaft"), { scaleX: 120, opacity: 0.55, duration: 2.1, ease: "power2.inOut" }, "<")
        .to(el.querySelector(".hall-glow"), { opacity: 2.4, duration: 1.8, ease: "power2.out" }, "<")
        .to(el, { opacity: 0, duration: 0.7, ease: "power2.inOut" }, "-=0.8")
        .set(el, { display: "none" });
    };

    const open = () => {
      if (disposed || phase === "opening") return;
      phase = "opening";
      doorsStarted.current = true;
      setLive(true);
      // Two frames: the first render (texture uploads, reflection) happens
      // behind the doors, then they start to move.
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(swing);
      });
    };

    const check = () => {
      if (disposed || phase !== "waiting") return;
      const t = performance.now() - t0;
      if (t >= HARD_MAX_MS) return open();
      if (t < MIN_DOORS_MS) return;
      const gateMet = gate.every((s) => tracker.has(s));
      const warm = warmApi.current;
      if (!warm || !(gateMet || t >= GATE_MAX_MS)) return;
      phase = "warming";
      Promise.race([warm.run().catch(() => {}), new Promise((r) => setTimeout(r, WARM_CAP_MS))]).then(open);
    };

    const unsub = tracker.subscribe(check);
    const iv = setInterval(check, 150);
    return () => {
      disposed = true;
      unsub();
      clearInterval(iv);
      cancelAnimationFrame(raf);
      const running = tl as gsap.core.Timeline | null;
      if (phase === "opening") {
        // Interrupted mid-swing (Fast Refresh): finish the doors rather than
        // leave them half open; the arrival fallback timer still fires.
        if (running) running.progress(1);
        else {
          if (doorsRef.current) doorsRef.current.style.display = "none";
          setEntering(true);
          setDoorsOpen(true);
          setTimeout(() => setArrived(true), 1500);
        }
      }
      running?.kill();
    };
  }, [gate, tracker]);

  // Esc inside inspect returns to the walking position; so does a click on the room beside the panel (a
  // gesture, so the cursor is taken back at once and the visitor walks on)
  useEffect(() => {
    if (!inspect) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInspect();
    };
    const onClick = (e: MouseEvent) => {
      if (e.button === 0 && (e.target as Element | null)?.tagName === "CANVAS") closeInspect(true);
    };
    window.addEventListener("keydown", onKey);
    if (!touch) window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, [inspect, closeInspect, touch]);

  const walkEnabled = doorsOpen && arrived && !inspect && !returning && !riding && !settingsOpen;
  const navEnabled = rooms > 1 && doorsOpen && arrived && !inspect && !returning && !riding && !settingsOpen;

  // ---- settings: O opens the card (freeing the cursor to click it), H shows or hides the on-screen controls
  const canSettle = doorsOpen && arrived && !inspect && !returning && !riding;
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);
  const closeSettings = useCallback(
    (relock: boolean) => {
      setSettingsOpen(false);
      if (relock && !touch) lockApi.current?.lock(true);
    },
    [touch]
  );
  useEffect(() => {
    if (!canSettle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable]")) return;
      if (settingsOpen) {
        if (e.key === "Escape" || e.code === "KeyO") closeSettings(false);
        return;
      }
      if (e.code === "KeyO") openSettings();
      else if (e.code === "KeyH") setSettings({ hud: !hud });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSettle, settingsOpen, hud, openSettings, closeSettings]);

  // ---- jump to a room: a quick fade through black around the move, held
  // until the new room's works are hung and its lights are up
  const jumping = useRef(false);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(jumpTimer.current), []);
  const jump = useCallback((move: (api: TeleportApi | null) => void) => {
    if (jumping.current) return;
    jumping.current = true;
    setFading(true);
    jumpTimer.current = setTimeout(() => {
      move(teleportApi.current);
        const t0 = performance.now();
        const poll = () => {
          const api = teleportApi.current;
          const t = performance.now() - t0;
          if (t >= JUMP_HOLD_MAX_MS || (t >= JUMP_HOLD_MIN_MS && (!api || api.settled()))) {
            setFading(false);
            jumping.current = false;
            return;
          }
          jumpTimer.current = setTimeout(poll, 40);
        };
        jumpTimer.current = setTimeout(poll, JUMP_HOLD_MIN_MS);
      }, JUMP_FADE_MS);
  }, []);
  const goRoom = useCallback(
    (to: number) => {
      if (!navEnabled || to < 0 || to >= rooms) return;
      jump((api) => api?.go(to));
    },
    [navEnabled, rooms, jump]
  );
  useEffect(() => {
    if (!navEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "BracketLeft" || e.code === "PageUp") goRoom(room - 1);
      else if (e.code === "BracketRight" || e.code === "PageDown") goRoom(room + 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navEnabled, goRoom, room]);
  // ---- a custom room's elevator, beside the entrance doors (Elevator.tsx): up to the next floor, down to
  // the one before. At it: E (up, or the only way) and Q (down), or its buttons; elsewhere E walks there.
  const floors = roomInfo?.floors ?? [];
  const floorNo = roomInfo?.floor ?? 1;
  const up = floorNo < floors.length ? floors[floorNo] : null;
  const down = floorNo > 1 ? floors[floorNo - 2] : null;
  const liftApi = useRef<ElevatorApi | null>(null);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(LIFT_KEY) !== "1") return;
      sessionStorage.removeItem(LIFT_KEY);
      arrivedByLiftRef.current = true;
      setArrivedByLift(true);
    } catch {
      // no session storage: in through the doors
    }
  }, []);
  const ride = useCallback(
    async (dir: LiftDirection) => {
      const to = dir === "up" ? up : down;
      if (!to || riding) return;
      setRiding(true);
      duckMusic(0.25, 0.8);
      const call = liftApi.current?.call(dir) ?? Promise.resolve();
      await Promise.race([call, new Promise((r) => setTimeout(r, 2600))]);
      try {
        sessionStorage.setItem(LIFT_KEY, "1");
      } catch {}
      setFading(true);
      if (document.pointerLockElement) document.exitPointerLock();
      setTimeout(() => router.push(to.href), JUMP_FADE_MS + 200);
    },
    [up, down, riding, router]
  );
  const rideRef = useRef(ride);
  useEffect(() => {
    rideRef.current = ride;
  }, [ride]);
  const pressLift = useCallback((dir: LiftDirection) => void rideRef.current(dir), []);
  const goToLift = useCallback(() => jump((api) => api?.toElevator()), [jump]);
  // ---- an artist's gallery: the doors at its end to the artists before and after (or the timeline), and a
  // surprise: another period's gallery. Walking up to a door, the HUD's buttons, or E / Q in the last room.
  const exitHref = useCallback(
    (side: ExitSide | "surprise") => {
      if (side === "surprise") return `/surprise?from=${encodeURIComponent(artist.slug)}`;
      const to = side === "prev" ? neighbours?.prev : neighbours?.next;
      return to ? `/museum/${to.slug}` : "/";
    },
    [artist.slug, neighbours]
  );
  const [leaving, setLeaving] = useState(false);
  const leave = useCallback(
    (side: ExitSide | "surprise") => {
      if (leaving) return;
      setLeaving(true);
      // a room jump under way must not lift the fade
      clearTimeout(jumpTimer.current);
      jumping.current = true;
      duckMusic(0.25, 0.8);
      setFading(true);
      if (document.pointerLockElement) document.exitPointerLock();
      const href = exitHref(side);
      setTimeout(() => router.push(href), JUMP_FADE_MS + 200);
    },
    [leaving, exitHref, router]
  );
  // in the last room (the galleries behind the doors load meanwhile); at the end wall (the doors report it), or
  // anywhere in the last room of a hall too narrow for doors, the HUD offers them and Q / E go through
  const inLast = !design && !!neighbours && room === rooms - 1;
  const [nearEnd, setNearEnd] = useState(false);
  const atEnd = inLast && (layout.exits ? nearEnd : true);
  useEffect(() => {
    if (!inLast) return;
    router.prefetch(exitHref("prev"));
    router.prefetch(exitHref("next"));
  }, [inLast, exitHref, router]);
  const exits = useMemo(
    () =>
      layout.exits && neighbours
        ? { prev: neighbours.prev, next: neighbours.next, onThrough: leave, onNear: setNearEnd }
        : undefined,
    [layout.exits, neighbours, leave]
  );
  useEffect(() => {
    if (!atEnd || !walkEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.code === "KeyE") leave("next");
      else if (e.code === "KeyQ") leave("prev");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [atEnd, walkEnabled, leave]);

  const lift = useMemo(
    () =>
      layout.elevator && roomInfo
        ? {
            floors: roomInfo.floors,
            floor: floorNo,
            arrivedByLift,
            apiRef: liftApi,
            onNear: setNearLift,
            onPress: pressLift,
          }
        : undefined,
    [layout.elevator, roomInfo, floorNo, arrivedByLift, pressLift]
  );
  useEffect(() => {
    if (!walkEnabled || !layout.elevator || (!up && !down)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.code === "KeyE") {
        if (nearLift) void ride(up ? "up" : "down");
        else goToLift();
      } else if (e.code === "KeyQ" && nearLift && down) {
        void ride("down");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [walkEnabled, layout.elevator, up, down, nearLift, ride, goToLift]);

  const engaged = touch ? touchActive : locked; // walking with input captured
  const showStart = doorsOpen && arrived && !inspect && !returning && !engaged && !settingsOpen;
  const dpr = useMemo(() => [1, dprCap] as [number, number], [dprCap]);

  return (
    <div className={`mus-root${hud ? "" : ` ${styles.hudOff}`}`}>
      <Canvas
        shadows={false}
        frameloop={live ? "demand" : "never"}
        camera={camera}
        gl={GL_PROPS}
        dpr={dpr}
      >
        <Gallery
          artist={artist}
          layout={layout}
          theme={theme}
          inspect={inspect}
          onSelect={selectPainting}
          onAim={onAim}
          onLockChange={onLockChange}
          walkEnabled={walkEnabled}
          entering={entering}
          ready={probeReady}
          onSettled={onSettled}
          onArrived={markArrived}
          onReturned={onReturned}
          lockApi={lockApi}
          warmApi={warmApi}
          onDprCap={setDprCap}
          touch={touch}
          touchActive={touchActive}
          onRoom={rooms > 1 ? showRoom : undefined}
          teleportApi={teleportApi}
          cameraRef={cameraRef}
          lift={lift}
          exits={exits}
        />
      </Canvas>

      {/* HUD */}
      <div
        ref={crosshairRef}
        className="crosshair"
        style={{ opacity: !touch && locked && !inspect ? 1 : 0 }}
      />

      <div className={`mus-top ${styles.top}`}>
        <div className={styles.topSide}>
          <Link href="/" className="mus-back">
            ← Timeline
          </Link>
          {films > 0 && !inspect && (
            <Link href={`/cinema/${artist.slug}`} className={`mus-back ${styles.filmsLink}`} title={`The cinema: ${films} film${films === 1 ? "" : "s"} about ${artist.name}`}>
              ▶ Films · {films}
            </Link>
          )}
        </div>
        <div className={`mus-placard ${styles.placard}${inspect ? ` ${styles.placardHidden}` : ""}`}>
          <h1>{artist.name}</h1>
          {roomInfo ? (
            <p>
              {roomInfo.floors.length > 1 ? `${roomInfo.floors[floorNo - 1].label} · ` : ""}
              {roomInfo.subtitle !== artist.name ? `${roomInfo.subtitle} · ` : ""}
              {artist.paintings.length} works
            </p>
          ) : (
            <p>
              {artist.periodName} · {artist.birthYear} — {artist.deathYear ?? ""}
            </p>
          )}
        </div>
        <div className={`${styles.topSide} ${styles.topRight}`}>
          {roomInfo && !inspect && (
            <div className={styles.roomActions}>
              <Link href={`/rooms?${roomInfo.href.split("?")[1] ?? ""}`} className="mus-back">
                Edit room
              </Link>
              <button type="button" className="mus-back" onClick={saveRoom} title="Keep this room in My rooms">
                {savedRoom ? "Saved" : "Save"}
              </button>
              <button type="button" className="mus-back" onClick={share} title="Copy this room's link">
                {shared ? "Link copied" : "Share"}
              </button>
            </div>
          )}
        </div>
        {!inspect && <SourceLink className="mus-source" compact />}
        {/* hung just below the bar, so it clears the title card at any width */}
        <RoomNavigator
          layout={layout}
          room={room}
          pulse={pulse}
          visible={rooms > 1 && doorsOpen && !inspect}
          disabled={!navEnabled}
          onGo={goRoom}
        />
      </div>

      <div className={`${styles.teleportFade}${fading ? ` ${styles.teleportFadeOn}` : ""}`} />

      {engaged && walkEnabled && (
        <div className={`mus-hint ${styles.hint}`}>
          {touch ? (
            <>
              <span>
                <b>Drag</b> look
              </span>
              <span>
                <b>Tap floor</b> walk
              </span>
              <span>
                <b>Tap painting</b> inspect
              </span>
            </>
          ) : (
            <>
              <span>
                <b>W A S D</b> walk
              </span>
              <span>
                <b>Mouse</b> look
              </span>
              <span>
                <b>Click</b> inspect
              </span>
              <span>
                <b>Space</b> jump
              </span>
              <span>
                <b>C</b> sit
              </span>
              <span>
                <b>M</b> music
              </span>
              {rooms > 1 && (
                <span>
                  <b>[ ]</b> rooms
                </span>
              )}
              <span>
                <b>G</b> guide
              </span>
              {layout.elevator && (up || down) && (
                <span>
                  <b>E</b> elevator
                </span>
              )}
              <span>
                <b>O</b> settings
              </span>
              <span>
                <b>P</b> secret
              </span>
              <span>
                <b>Esc</b> release
              </span>
            </>
          )}
        </div>
      )}

      {showStart && stepped && (
        <div
          className={`mus-click-to-start ${styles.resume}`}
          onClick={() => {
            if (touch) setTouchActive(true);
            else lockApi.current?.lock();
          }}
        >
          <p className={styles.resumePill}>{touch ? "Tap to walk on" : "Click, or press W, to walk on"}</p>
        </div>
      )}

      {showStart && !stepped && (
        <div
          className="mus-click-to-start"
          onClick={() => {
            if (touch) {
              setTouchActive(true);
              setStepped(true);
              announceStart();
            } else lockApi.current?.lock();
          }}
        >
          <h2>{artist.name}</h2>
          {roomInfo && <p>{roomInfo.floors.length > 1 ? roomInfo.floors[floorNo - 1].label : roomInfo.subtitle}</p>}
          {roomInfo?.intro && <p className={styles.intro}>{roomInfo.intro}</p>}
          <p>
            {touch ? "Tap" : "Click"} to step inside · {artist.paintings.length} works
            {roomInfo ? ` by ${roomInfo.artists.length} artists` : ""}
          </p>
          <p className="mus-start-credit">
            {artist.paintings.some((p) => p.imageUrl?.includes(".wikiart.org/"))
              ? "All credit goes to Wikipedia, Wikidata, Wikimedia Commons and WikiArt"
              : "All credit goes to Wikipedia, Wikidata and Wikimedia Commons"}{" "}
            · for educational purposes only
          </p>
        </div>
      )}

      {canSettle && (
        <div className={styles.hudTools}>
          <button type="button" className={styles.hudTool} onClick={openSettings} title="Speed, canvas surface, on-screen controls (O)">
            <span aria-hidden>⚙</span> Settings{!touch && <kbd>O</kbd>}
          </button>
          {touch && (
            <button type="button" className={styles.hudTool} onClick={() => setSettings({ hud: false })}>
              Hide controls
            </button>
          )}
        </div>
      )}
      {canSettle && !hud && !settingsOpen && (
        <button type="button" className={`${styles.hudTool} ${styles.hudBack}`} onClick={() => setSettings({ hud: true })}>
          {touch ? "Show controls" : <>Show controls<kbd>H</kbd></>}
        </button>
      )}
      {settingsOpen && <SettingsPanel onClose={closeSettings} touch={touch} />}

      <InspectPanel
        placement={inspect}
        onClose={() => closeInspect(true)}
        touch={touch}
        artistName={artist.name}
        artistSlug={artist.slug}
        around={around}
        onPick={selectPainting}
      />

      {layout.elevator && (up || down) && walkEnabled && (nearLift || touch) && (
        <div className={styles.lift} role="group" aria-label="Elevator">
          {nearLift ? (
            <>
              <span className={styles.liftTitle}>Elevator · you are on floor {floors[floorNo - 1]?.number ?? floorNo}</span>
              {up && (
                <button type="button" className={styles.elevator} onClick={() => void ride("up")}>
                  <span className={styles.elevatorArrow}>▲</span>
                  <span>
                    {up.label}
                    <small>{up.works} works{touch ? "" : " · press E"}</small>
                  </span>
                </button>
              )}
              {down && (
                <button type="button" className={styles.elevator} onClick={() => void ride("down")}>
                  <span className={styles.elevatorArrow}>▼</span>
                  <span>
                    {down.label}
                    <small>{down.works} works{touch ? "" : up ? " · press Q" : " · press E"}</small>
                  </span>
                </button>
              )}
            </>
          ) : (
            <button type="button" className={styles.elevator} onClick={goToLift}>
              <span className={styles.elevatorArrow}>⇅</span>
              <span>
                Elevator by the entrance
                <small>{touch ? "Tap to walk there" : "Press E to walk there"}</small>
              </span>
            </button>
          )}
        </div>
      )}

      {atEnd && walkEnabled && !leaving && (
        <div className={styles.lift} role="group" aria-label="The galleries beyond">
          <span className={styles.liftTitle}>End of the gallery · walk through a door</span>
          {(["next", "prev"] as const).map((side) => {
            const l = side === "prev" ? neighbours!.prev : neighbours!.next;
            return (
              <button key={side} type="button" className={styles.elevator} onClick={() => leave(side)}>
                <span className={styles.elevatorArrow}>{side === "prev" ? "←" : "→"}</span>
                <span>
                  {l ? l.name : "The timeline"}
                  <small>
                    {l ? (side === "prev" ? "The artist before" : "The artist after") : "Back to"}
                    {touch ? "" : side === "prev" ? " · press Q" : " · press E"}
                  </small>
                </span>
              </button>
            );
          })}
          <button type="button" className={styles.elevator} onClick={() => leave("surprise")}>
            <span className={styles.elevatorArrow}>✦</span>
            <span>
              Surprise me
              <small>A gallery from another period</small>
            </span>
          </button>
        </div>
      )}

      <AudioGuide
        placements={layout.placements}
        cameraRef={cameraRef}
        artists={guideArtists}
        gallerySlug={roomInfo ? null : artist.slug}
        active={walkEnabled}
        inspect={inspect}
        touch={touch}
      />

      <MuseumAudio era={theme.era} period={artist.periodSlug} started={doorsOpen} inspecting={!!inspect} />

      <FxGate
        ready={doorsOpen && arrived}
        inspecting={!!inspect || returning}
        touch={touch}
        secretTarget={placardEl}
        audio={FX_AUDIO}
      />

      {/* entry doors */}
      <div className={`doors${arrivedByLift ? " lift" : ""}`} ref={doorsRef}>
        <div className="hall-glow" style={{ opacity: 0.55 }} />
        <div className="light-shaft" />
        <div className="door door-l">
          <span className="door-panel p-top" />
          <span className="door-panel p-bottom" />
          <span className="door-handle" />
          <span className="door-edge" />
        </div>
        <div className="door door-r">
          <span className="door-panel p-top" />
          <span className="door-panel p-bottom" />
          <span className="door-handle" />
          <span className="door-edge" />
        </div>
        <div className="doors-name">
          <h1>{artist.name}</h1>
          <p>{arrivedByLift && roomInfo ? roomInfo.floors[floorNo - 1].label : artist.periodName}</p>
          {design?.intro && <p className={styles.intro}>{design.intro}</p>}
        </div>
        <DoorsStatus tracker={tracker} gate={gate} />
      </div>
    </div>
  );
}

/** Loading progress toward opening the doors (the flagship plus the works
 *  nearest the entrance), isolated so each texture doesn't re-render the app. */
function DoorsStatus({ tracker, gate }: { tracker: SettleTracker; gate: string[] }) {
  const done = useSyncExternalStore(
    tracker.subscribe,
    () => gate.reduce((n, s) => n + (tracker.has(s) ? 1 : 0), 0),
    () => 0
  );
  const pct = gate.length ? Math.round((100 * done) / gate.length) : 100;
  return <div className="doors-status">Hanging the collection · {pct}%</div>;
}
