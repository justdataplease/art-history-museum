"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas } from "@react-three/fiber";
import { useProgress } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";
import type { ArtistWithPaintings } from "@/lib/types";
import { buildLayout, Placement } from "./layout";
import { Gallery } from "./Gallery";
import { InspectPanel } from "./InspectPanel";

export function MuseumApp({ artist }: { artist: ArtistWithPaintings }) {
  const layout = useMemo(() => buildLayout(artist.paintings), [artist]);
  const [doorsOpen, setDoorsOpen] = useState(false);
  const [entering, setEntering] = useState(false);
  const [locked, setLocked] = useState(false);
  const [aimed, setAimed] = useState(false);
  const [inspect, setInspect] = useState<Placement | null>(null);
  const [returning, setReturning] = useState(false);
  const doorsRef = useRef<HTMLDivElement>(null);
  const { progress } = useProgress();
  const openedRef = useRef(false);

  // Open the doors once enough of the collection has streamed in.
  useEffect(() => {
    const t0 = performance.now();
    let timeout: ReturnType<typeof setTimeout>;
    const tryOpen = () => {
      if (openedRef.current) return;
      openedRef.current = true;
      setEntering(true); // camera starts its walk through the doorway
      const el = doorsRef.current;
      if (!el) {
        setDoorsOpen(true);
        return;
      }
      const tl = gsap.timeline({ onComplete: () => setDoorsOpen(true) });
      tl.to(el.querySelector(".doors-status"), { opacity: 0, duration: 0.4 })
        .to(
          el.querySelector(".doors-name"),
          { opacity: 0, y: -30, duration: 0.7, ease: "power2.in" },
          "<"
        )
        // light splits through the crack first…
        .to(
          el.querySelector(".light-shaft"),
          { opacity: 1, duration: 0.5, ease: "power2.out" },
          "-=0.2"
        )
        // …then the doors swing with a heavy start and soft settle
        .to(
          el.querySelector(".door-l"),
          { rotateY: -107, duration: 2.3, ease: "power3.inOut" },
          "-=0.3"
        )
        .to(
          el.querySelector(".door-r"),
          { rotateY: 107, duration: 2.3, ease: "power3.inOut" },
          "<"
        )
        .to(
          el.querySelector(".light-shaft"),
          { scaleX: 120, opacity: 0.55, duration: 2.1, ease: "power2.inOut" },
          "<"
        )
        .to(
          el.querySelector(".hall-glow"),
          { opacity: 2.4, duration: 1.8, ease: "power2.out" },
          "<"
        )
        .to(el, { opacity: 0, duration: 0.7, ease: "power2.inOut" }, "-=0.8")
        .set(el, { display: "none" });
    };
    const check = setInterval(() => {
      const elapsed = performance.now() - t0;
      const p = useProgress.getState();
      const settled = p.total > 0 ? p.progress >= 100 : elapsed > 3500;
      if ((settled && elapsed > 1600) || elapsed > 9000) {
        clearInterval(check);
        tryOpen();
      }
    }, 200);
    timeout = setTimeout(tryOpen, 10000);
    return () => {
      clearInterval(check);
      clearTimeout(timeout);
    };
  }, []);

  // Esc inside inspect returns to walking position.
  useEffect(() => {
    if (!inspect) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInspect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspect]);

  function closeInspect() {
    setReturning(true);
    setInspect(null);
    setTimeout(() => setReturning(false), 1300);
  }

  const showStart = doorsOpen && !locked && !inspect && !returning;

  return (
    <div className="mus-root">
      <Canvas
        shadows
        camera={{
          fov: 62,
          near: 0.05,
          far: 120,
          position: [0, 1.65, layout.hallLength / 2 - 0.85],
        }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.12,
        }}
        dpr={[1, 1.75]}
      >
        <Gallery
          artist={artist}
          layout={layout}
          inspect={inspect}
          onSelect={(pl) => setInspect(pl)}
          onAim={setAimed}
          onLockChange={setLocked}
          walkEnabled={doorsOpen && !inspect && !returning}
          entering={entering}
        />
      </Canvas>

      {/* HUD */}
      <div className={`crosshair${aimed ? " aim" : ""}`} style={{ opacity: locked ? 1 : 0 }} />

      <div className="mus-top">
        <Link href="/" className="mus-back">
          ← Timeline
        </Link>
        <div className="mus-placard">
          <h1>{artist.name}</h1>
          <p>
            {artist.periodName} · {artist.birthYear} — {artist.deathYear ?? ""}
          </p>
        </div>
        <span style={{ width: 110 }} />
      </div>

      {locked && !inspect && (
        <div className="mus-hint">
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
            <b>Esc</b> release cursor
          </span>
        </div>
      )}

      {showStart && (
        <div
          className="mus-click-to-start"
          onClick={() => {
            document
              .querySelector("canvas")
              ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }}
        >
          <h2>{artist.name}</h2>
          <p>Click to step inside · {artist.paintings.length} works</p>
        </div>
      )}

      <InspectPanel placement={inspect} onClose={closeInspect} />

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
        <div className="doors-status">
          Hanging the collection · {Math.round(progress)}%
        </div>
      </div>
    </div>
  );
}
