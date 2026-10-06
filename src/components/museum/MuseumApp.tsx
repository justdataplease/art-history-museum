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
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";
import type { ArtistWithPaintings } from "@/lib/types";
import { buildLayout, entryGate, entryZ, EYE_HEIGHT, type Placement } from "./layout";
import { Gallery, type LockApi, type TeleportApi, type WarmupApi } from "./Gallery";
import { RoomNavigator } from "./RoomNavigator";
import { InspectPanel } from "./InspectPanel";
import { duckMusic, MuseumAudio, musicMuted } from "./MuseumAudio";
import { FxGate } from "./fx/Gate";
import { galleryTheme } from "./theme";
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
const placardEl = () => document.querySelector(".mus-placard");

export function MuseumApp({ artist }: { artist: ArtistWithPaintings }) {
  const layout = useMemo(() => buildLayout(artist.paintings), [artist]);
  const theme = useMemo(() => galleryTheme(artist.periodSlug), [artist.periodSlug]);
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
  const [touchActive, setTouchActive] = useState(false);
  const [inspect, setInspect] = useState<Placement | null>(null);
  const [returning, setReturning] = useState(false);
  const [allSettled, setAllSettled] = useState(false);
  const [dprCap, setDprCap] = useState(1.5);
  // a suite's room navigator: the room the visitor is in, a pulse on entering
  const [room, setRoom] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [fading, setFading] = useState(false);
  const announced = useRef(false);
  const teleportApi = useRef<TeleportApi | null>(null);

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
      if (l) announceStart();
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
  const closeInspect = useCallback(() => {
    if (!inspectRef.current) return;
    inspectRef.current = null;
    setReturning(true);
    setInspect(null);
  }, []);

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

  // Esc inside inspect returns to the walking position.
  useEffect(() => {
    if (!inspect) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInspect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspect, closeInspect]);

  const walkEnabled = doorsOpen && arrived && !inspect && !returning;
  const navEnabled = rooms > 1 && doorsOpen && arrived && !inspect && !returning;

  // ---- jump to a room: a quick fade through black around the move, held
  // until the new room's works are hung and its lights are up
  const jumping = useRef(false);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(jumpTimer.current), []);
  const goRoom = useCallback(
    (to: number) => {
      if (jumping.current || !navEnabled || to < 0 || to >= rooms) return;
      jumping.current = true;
      setFading(true);
      jumpTimer.current = setTimeout(() => {
        teleportApi.current?.go(to);
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
    },
    [navEnabled, rooms]
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
  const engaged = touch ? touchActive : locked; // walking with input captured
  const showStart = doorsOpen && arrived && !inspect && !returning && !engaged;
  const dpr = useMemo(() => [1, dprCap] as [number, number], [dprCap]);

  return (
    <div className="mus-root">
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
        />
      </Canvas>

      {/* HUD */}
      <div
        ref={crosshairRef}
        className="crosshair"
        style={{ opacity: !touch && locked && !inspect ? 1 : 0 }}
      />

      <div className={`mus-top ${styles.top}`}>
        <Link href="/" className="mus-back">
          ← Timeline
        </Link>
        <div className={`mus-placard ${styles.placard}${inspect ? ` ${styles.placardHidden}` : ""}`}>
          <h1>{artist.name}</h1>
          <p>
            {artist.periodName} · {artist.birthYear} — {artist.deathYear ?? ""}
          </p>
        </div>
        <span className={styles.topSpacer} />
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
                <b>Tap a painting</b> inspect
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
                <b>Click</b> a painting to inspect
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
                <b>Esc</b> release cursor
              </span>
            </>
          )}
        </div>
      )}

      {showStart && (
        <div
          className="mus-click-to-start"
          onClick={() => {
            if (touch) {
              setTouchActive(true);
              announceStart();
            } else lockApi.current?.lock();
          }}
        >
          <h2>{artist.name}</h2>
          <p>
            {touch ? "Tap" : "Click"} to step inside · {artist.paintings.length} works
          </p>
        </div>
      )}

      <InspectPanel placement={inspect} onClose={closeInspect} touch={touch} artistName={artist.name} />

      <MuseumAudio era={theme.era} started={doorsOpen} inspecting={!!inspect} />

      <FxGate
        ready={doorsOpen && arrived}
        inspecting={!!inspect || returning}
        touch={touch}
        secretTarget={placardEl}
        audio={FX_AUDIO}
      />

      {/* entry doors */}
      <div className="doors" ref={doorsRef}>
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
          <p>{artist.periodName}</p>
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
