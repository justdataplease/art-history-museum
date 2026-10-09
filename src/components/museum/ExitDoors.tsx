"use client";

// An artist's gallery ends at two doors in the far end wall, either side of the flagship (layout.exits, built in
// room-geometry.ts): to the artist before on the left and the artist after on the right, in the timeline's order,
// each named on a card over it. Walking up to a door goes through it (MuseumApp fades and loads that gallery);
// near the end wall the HUD's buttons and Q / E do the same.

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { GalleryLink } from "@/lib/types";
import { WALL_MARGIN, type ExitDoors as ExitSpot } from "./layout";
import type { SuiteRuntime } from "./suite-runtime";
import { fontFamilies, placardFontsReady } from "./exhibit-placard";

export type ExitSide = "prev" | "next";

/** A door is gone through when the visitor stands this close to it (confine keeps them WALL_MARGIN off it). */
const THROUGH = WALL_MARGIN + 0.1;
/** Within this of the end wall the visitor is at the doors: the HUD offers them, Q and E go through. */
const NEAR_END = 6;
const SIDES = [["prev", -1], ["next", 1]] as const;

const CARD_W = 1.5;
/** The light washed over each door: its strength and the pool's size (m). */
const WASH = 0.34;
const WASH_W = 2.9;
const WASH_H = 4.4;
const CARD_H = 0.42;
const TEX_W = 768;
const TEX_H = Math.round((TEX_W * CARD_H) / CARD_W);

const years = (l: GalleryLink) => (l.birthYear != null ? `${l.birthYear}–${l.deathYear ?? ""}` : "");

function drawCard(c: HTMLCanvasElement, side: ExitSide, link: GalleryLink | null) {
  const g = c.getContext("2d");
  if (!g) return;
  const { serif, sans } = fontFamilies();
  const ls = (px: string) => {
    (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = px;
  };
  const bg = g.createLinearGradient(0, 0, 0, TEX_H);
  bg.addColorStop(0, "#f8f3e7");
  bg.addColorStop(1, "#efe8d6");
  g.fillStyle = bg;
  g.fillRect(0, 0, TEX_W, TEX_H);
  g.strokeStyle = "rgba(110,92,58,0.32)";
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, TEX_W - 3, TEX_H - 3);
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  const mid = TEX_W / 2;
  const arrow = side === "prev" ? "←" : "→";
  g.fillStyle = "#7a6136";
  g.font = `500 ${Math.round(TEX_H * 0.12)}px ${sans}`;
  ls("6px");
  const eyebrow = link ? (side === "prev" ? "The artist before" : "The artist after") : "Back to";
  g.fillText(eyebrow.toUpperCase(), mid, TEX_H * 0.27);
  ls("1px");
  g.fillStyle = "#211d18";
  const name = link ? link.name : "The timeline";
  let size = Math.round(TEX_H * 0.3);
  g.font = `600 ${size}px ${serif}`;
  const line = side === "prev" ? `${arrow}  ${name}` : `${name}  ${arrow}`;
  while (size > 18 && g.measureText(line).width > TEX_W - 60) {
    size -= 2;
    g.font = `600 ${size}px ${serif}`;
  }
  g.fillText(line, mid, TEX_H * 0.62);
  if (link) {
    g.fillStyle = "#3a3226";
    g.font = `500 ${Math.round(TEX_H * 0.11)}px ${sans}`;
    ls("4px");
    g.fillText([years(link), link.periodName].filter(Boolean).join("  ·  ").toUpperCase(), mid, TEX_H * 0.84);
  }
  ls("0px");
}

export function ExitDoors({
  spot,
  hallLength,
  runtime,
  prev,
  next,
  enabled,
  onThrough,
  onNear,
}: {
  spot: ExitSpot;
  hallLength: number;
  runtime: SuiteRuntime;
  prev: GalleryLink | null;
  next: GalleryLink | null;
  /** Walking (not inspecting, not on the way out): walking up to a door counts. */
  enabled: boolean;
  onThrough: (side: ExitSide) => void;
  onNear: (near: boolean) => void;
}) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const last = runtime.layout.rooms.length - 1;
  const zw = -hallLength / 2;

  // drawn only while the last room's architecture is
  const [visible, setVisible] = useState(() => runtime.archWindow()[1] === last);
  useEffect(() => runtime.onWindowChange(() => setVisible(runtime.archWindow()[1] === last)), [runtime, last]);

  const cards = useMemo(
    () =>
      (["prev", "next"] as const).map((side) => {
        const c = document.createElement("canvas");
        c.width = TEX_W;
        c.height = TEX_H;
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const material = new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.82,
          metalness: 0,
          emissive: new THREE.Color("#fff6e8"),
          emissiveIntensity: 0.22,
          emissiveMap: tex,
        });
        return { side, c, tex, material };
      }),
    []
  );
  useEffect(
    () => () =>
      cards.forEach((k) => {
        k.tex.dispose();
        k.material.dispose();
      }),
    [cards]
  );
  useEffect(() => {
    let alive = true;
    const draw = () => {
      if (!alive) return;
      for (const k of cards) {
        drawCard(k.c, k.side, k.side === "prev" ? prev : next);
        k.tex.needsUpdate = true;
      }
      invalidate();
    };
    draw();
    placardFontsReady().then(draw);
    return () => {
      alive = false;
    };
  }, [cards, prev, next, invalidate]);
  const plane = useMemo(() => new THREE.PlaneGeometry(CARD_W, CARD_H), []);
  useEffect(() => () => plane.dispose(), [plane]);
  // a lamp over each door: no painting hangs on this wall, so no spot reaches it; a warm wash, brightest at the
  // card, fading down the door and out to the sides (added light, no new lights in the scene's programs)
  const wash = useMemo(() => {
    // an oval pool, like a spot's on a painting: brightest at the door's head, nothing at the plane's edges
    const S = 128;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S * 2;
    const g = c.getContext("2d")!;
    const img = g.createImageData(S, S * 2);
    for (let j = 0; j < S * 2; j++) {
      for (let i = 0; i < S; i++) {
        const u = (i + 0.5) / S - 0.5;
        const v = (j + 0.5) / (S * 2) - 0.36; // the pool's centre: a third of the way down
        const r2 = (u / 0.5) ** 2 + (v / (v < 0 ? 0.36 : 0.64)) ** 2;
        const a = Math.max(0, 1 - r2) ** 1.6;
        const k = (j * S + i) * 4;
        img.data[k] = 255;
        img.data[k + 1] = 222;
        img.data[k + 2] = 178;
        img.data[k + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: WASH,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const geometry = new THREE.PlaneGeometry(WASH_W, WASH_H);
    return { tex, material, geometry };
  }, []);
  useEffect(
    () => () => {
      wash.tex.dispose();
      wash.material.dispose();
      wash.geometry.dispose();
    },
    [wash]
  );

  // near the end wall; walking up to a door goes through it, once
  const gone = useRef(false);
  const near = useRef(false);
  useFrame(() => {
    const p = camera.position;
    const isNear = enabled && p.z < zw + NEAR_END;
    if (isNear !== near.current) {
      near.current = isNear;
      onNear(isNear);
    }
    if (!enabled || gone.current || p.z > zw + THROUGH) return;
    for (const [side, s] of SIDES) {
      if (Math.abs(p.x - s * spot.x) < spot.halfWidth + 0.1) {
        gone.current = true;
        onThrough(side);
        return;
      }
    }
  });

  if (!visible) return null;
  // over each door's cornice, a little proud of the wall
  const y = spot.height + 0.27 + CARD_H / 2;
  return (
    <group>
      {cards.map((k) => {
        const x = k.side === "prev" ? -spot.x : spot.x;
        return (
          <group key={k.side}>
            <mesh geometry={plane} material={k.material} position={[x, y, zw + 0.16]} />
            <mesh geometry={wash.geometry} material={wash.material} position={[x, spot.height + 0.2 - WASH_H * 0.14, zw + 0.13]} renderOrder={2} />
          </group>
        );
      })}
    </group>
  );
}
