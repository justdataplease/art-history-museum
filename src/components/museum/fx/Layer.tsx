"use client";

// R3F side of the studio, loaded once the access phrase is given and
// mounted inside the gallery's <Canvas> (through Slot). Creates the engine,
// keeps it in step with the gallery's canvas registry, arms it (a one-time
// shader compile, hidden in the lights' dip), drives it from useFrame and
// asks for frames only while something moves: idle, the canvas goes back to
// zero rendered frames (drying paint wakes it now and then until it has set).
//
// Input is taken in the capture phase, ahead of the gallery's own handlers,
// and only while a tool is in hand:
//   desktop (pointer locked): mouse down throws / starts a brush stroke /
//     fires (the marker keeps firing while held) / swings (held after the
//     swing, the edge follows where you look) at the crosshair; the click
//     that follows is swallowed (no inspect);
//   touch: with the brush, the marker or the sword a press is ours (drag
//     paints / aims / cuts, the view does not turn); with paint or eggs a
//     tap throws at the finger (drags still look round).

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { FxEngine, TEAM_COLORS, type CanvasRef, type Quality } from "./engine";
import type { FxSlotProps } from "./Slot";
import { armed, BRUSH_SIZES, fx, fxTally, isHeld, type Tool } from "./store";
import { sfx } from "./sfx";

const CENTER = new THREE.Vector2(0, 0);
const TAP_SLOP = 9;
const TAP_MAX_MS = 450;
const THROW_GAP_MS = 140;

let current: FxEngine | null = null;
/** The live engine (null outside a gallery), for tests and tooling. */
export function getFxEngine(): FxEngine | null {
  return current;
}

interface Placed {
  w: number;
  h: number;
}

/** A cheap fingerprint of the registry: exhibits mount and unmount as the visitor moves. */
function registryKey(registry: Map<string, THREE.Mesh>): string {
  let k = "";
  registry.forEach((mesh, key) => {
    k += `${key}:${mesh.id}:${(mesh.material as THREE.Material).uuid};`;
  });
  return k;
}

function canvasRefs(registry: Map<string, THREE.Mesh>): CanvasRef[] {
  const out: CanvasRef[] = [];
  registry.forEach((mesh, key) => {
    const pl = mesh.userData.placement as Placed | undefined;
    if (pl && pl.w > 0 && pl.h > 0) out.push({ key, mesh, w: pl.w, h: pl.h });
  });
  return out;
}

/** The marker's paint: the palette colour (a paler shell), or random team colours. */
function ballColors(): { fill: string; shell: string } {
  const s = fx.get();
  if (s.team) {
    const i = Math.floor(Math.random() * TEAM_COLORS.length);
    const j = (i + 1 + Math.floor(Math.random() * (TEAM_COLORS.length - 1))) % TEAM_COLORS.length;
    return { fill: TEAM_COLORS[i], shell: TEAM_COLORS[j] };
  }
  const c = new THREE.Color(s.color);
  return { fill: s.color, shell: "#" + c.clone().lerp(new THREE.Color("#ffffff"), 0.4).getHexString() };
}

export default function Layer({ registry, enabled, touch, compile, floorY = 0 }: FxSlotProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const compileRef = useRef(compile);
  compileRef.current = compile;

  const engine = useMemo(
    () =>
      new FxEngine({
        renderer: gl,
        scene,
        camera,
        invalidate,
        quality: (touch ? "low" : "high") as Quality,
        floorY,
        compile: async () => {
          if (compileRef.current) await compileRef.current();
          else await gl.compileAsync(scene, camera);
        },
        onDamage: () => fx.markDirty(),
        onCleaned: () => {
          fx.cleaned();
          // the music comes back
          fx.duck(1, 2.5);
        },
        onStat: (e) => fxTally.add(e.kind === "work" ? "works" : e.kind, e.amount),
        onHopper: (h) => fxTally.hopper(h.balls, h.cap, h.refilling),
        autoRefill: touch,
      }),
    // one engine per renderer / scene; quality is fixed for its life
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gl, scene, camera],
  );

  useEffect(() => {
    current = engine;
    // Test hook, like the gallery's: only when an init script sets the flag.
    const w = window as unknown as { __MUSEUM_DEBUG__?: boolean; __fx?: unknown };
    if (w.__MUSEUM_DEBUG__) w.__fx = { engine, state: fx, tally: fxTally };
    return () => {
      if (current === engine) current = null;
      if (w.__MUSEUM_DEBUG__) w.__fx = undefined;
      engine.dispose();
      sfx.close();
    };
  }, [engine]);

  // the unlock moment: the lights dip, a low thud, the music ducks; the
  // engine arms (and compiles) inside the dip
  useEffect(() => {
    engine.syncCanvases(canvasRefs(registry));
    engine.dip();
    fx.duck(0.2, 0.25);
    let alarmOn = false;
    const back = setTimeout(() => {
      if (!alarmOn) fx.duck(1, 2);
    }, 1800);
    void engine.activate().then(() => {
      const s = fx.get();
      engine.setHeld(s.open && isHeld(s.tool) ? s.tool : null);
    });
    // the alarm keeps the music down while it rings
    const poll = setInterval(() => {
      const on = engine.alarmLevel > 0.05;
      if (on !== alarmOn) {
        alarmOn = on;
        fx.duck(on ? 0.3 : 1, on ? 1.5 : 3);
      }
    }, 250);
    return () => {
      clearTimeout(back);
      clearInterval(poll);
      // never leave the music ducked behind
      fx.duck(1, 0.5);
    };
  }, [engine, registry]);

  // the conservator, R
  useEffect(() => fx.onClean(() => engine.clean()), [engine]);
  useEffect(() => fx.onRefill(() => engine.refill()), [engine]);

  // what is held follows the palette; the marker's colours follow the colour picks
  useEffect(() => {
    const sync = () => {
      const s = fx.get();
      if (engine.isActive) engine.setHeld(s.open && !s.cleaning && isHeld(s.tool) ? s.tool : null);
      engine.setBallColors(ballColors, s.team ? TEAM_COLORS[2] : s.color);
      if (!armed() || s.tool !== "brush") engine.brushUp();
    };
    sync();
    return fx.subscribe(sync);
  }, [engine]);
  useEffect(() => {
    engine.setEnabled(enabled);
  }, [engine, enabled]);
  useEffect(() => {
    const fit = () => engine.setCompact(touch || window.innerWidth < 760);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [engine, touch]);

  // ---- input
  useEffect(() => {
    const el = (gl.domElement.parentElement ?? gl.domElement) as HTMLElement;
    const ndc = new THREE.Vector2();
    const toNdc = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    };
    const live = () => engine.isActive && enabledRef.current && armed();
    let lastThrow = 0;
    const act = (at: THREE.Vector2, tap = false) => {
      const s = fx.get();
      engine.syncCanvases(canvasRefs(registry));
      if (isHeld(s.tool)) {
        engine.triggerDown(at, s.tool);
        if (tap) engine.triggerUp();
        return;
      }
      if (s.tool === "brush") {
        const b = BRUSH_SIZES[s.brush] ?? BRUSH_SIZES[1];
        engine.brushDown(at, s.color, b.width, b.reach);
        return;
      }
      const now = performance.now();
      if (now - lastThrow < THROW_GAP_MS) return;
      lastThrow = now;
      engine.throwAt(at, s.tool === "egg" ? "egg" : "paint", s.color);
    };
    const release = () => {
      engine.brushUp();
      engine.triggerUp();
    };

    // desktop, pointer locked: the crosshair
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || !document.pointerLockElement || !live()) return;
      e.stopImmediatePropagation();
      act(CENTER);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) release();
    };
    const onClick = (e: MouseEvent) => {
      // the gallery's click-to-inspect must not fire with a tool in hand
      if (document.pointerLockElement && live()) e.stopImmediatePropagation();
    };

    // touch
    let holdId: number | null = null;
    let tapCand: { id: number; x: number; y: number; t: number } | null = null;
    const ours = (e: PointerEvent) => e.pointerType !== "mouse" && e.target instanceof Node && el.contains(e.target);
    // tools that own the whole press (drag = paint / aim / cut)
    const holds = (t: Tool | null) => t === "brush" || t === "marker" || t === "sword";
    const onDown = (e: PointerEvent) => {
      if (!ours(e) || !live()) return;
      if (holds(fx.get().tool)) {
        if (holdId !== null) return;
        e.stopImmediatePropagation();
        holdId = e.pointerId;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // best effort
        }
        act(toNdc(e.clientX, e.clientY));
      } else {
        tapCand = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
      }
    };
    const onMove = (e: PointerEvent) => {
      if (holdId !== null && e.pointerId === holdId) {
        e.stopImmediatePropagation();
        const at = toNdc(e.clientX, e.clientY);
        engine.brushMove(at);
        engine.triggerMove(at);
        return;
      }
      if (tapCand && e.pointerId === tapCand.id && Math.hypot(e.clientX - tapCand.x, e.clientY - tapCand.y) > TAP_SLOP) {
        tapCand = null;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (holdId !== null && e.pointerId === holdId) {
        e.stopImmediatePropagation();
        holdId = null;
        release();
        return;
      }
      const c = tapCand;
      tapCand = null;
      if (!c || e.pointerId !== c.id || performance.now() - c.t > TAP_MAX_MS || !live()) return;
      // a tap with paint or eggs throws; the gallery's tap (walk / inspect)
      // is told the gesture was taken over
      e.stopImmediatePropagation();
      el.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId, pointerType: e.pointerType, bubbles: true }));
      act(toNdc(e.clientX, e.clientY), true);
    };
    const onCancel = (e: PointerEvent) => {
      if (holdId !== null && e.pointerId === holdId) {
        holdId = null;
        release();
      }
      if (tapCand && e.pointerId === tapCand.id) tapCand = null;
    };

    const cap = { capture: true };
    window.addEventListener("mousedown", onMouseDown, cap);
    window.addEventListener("mouseup", onMouseUp, cap);
    window.addEventListener("click", onClick, cap);
    if (touch) {
      window.addEventListener("pointerdown", onDown, cap);
      window.addEventListener("pointermove", onMove, cap);
      window.addEventListener("pointerup", onUp, cap);
      window.addEventListener("pointercancel", onCancel, cap);
    }
    return () => {
      window.removeEventListener("mousedown", onMouseDown, cap);
      window.removeEventListener("mouseup", onMouseUp, cap);
      window.removeEventListener("click", onClick, cap);
      window.removeEventListener("pointerdown", onDown, cap);
      window.removeEventListener("pointermove", onMove, cap);
      window.removeEventListener("pointerup", onUp, cap);
      window.removeEventListener("pointercancel", onCancel, cap);
      release();
    };
  }, [engine, gl, registry, touch]);

  // ---- frames: only while something moves; drying paint wakes us now and then
  const wake = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (wake.current) clearTimeout(wake.current);
    },
    [],
  );
  const seen = useRef("");
  useFrame(() => {
    if (!engine.isActive) return;
    // a work's paint follows it when its exhibit unmounts and mounts again
    const key = registryKey(registry);
    if (key !== seen.current) {
      seen.current = key;
      engine.syncCanvases(canvasRefs(registry));
    }
    const busy = engine.update(performance.now() / 1000);
    if (busy) {
      invalidate();
      return;
    }
    const w = engine.wakeIn();
    if (w !== null && !wake.current) {
      wake.current = setTimeout(() => {
        wake.current = null;
        invalidate();
      }, w * 1000);
    }
  });

  return null;
}
