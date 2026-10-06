"use client";

// DOM side of the studio, loaded once the access phrase is given: the
// palette (tools, colours, brush sizes, the marker's hopper, the
// conservator, putting everything down), a small tally of what has been
// done this visit, and a ring round the crosshair showing what is in hand.
// Keyboard while the palette is out: 1–5 pick a tool, 0 puts it down, C
// turns through the colours, [ / ] change the brush size, R refills the
// marker; with a tool in hand and the cursor captured the wheel steps
// through the tools.

import { useEffect, useState, type CSSProperties } from "react";
import type { FxAudioBridge } from "./Gate";
import { latch } from "./latch";
import { setSfxMutedSource } from "./sfx";
import { armed, BRUSH_SIZES, fx, isHeld, PAINT_COLORS, useFx, useTally, type Tool } from "./store";
import styles from "./hud.module.css";

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "paint", label: "Paint", key: "1" },
  { id: "brush", label: "Brush", key: "2" },
  { id: "egg", label: "Eggs", key: "3" },
  { id: "marker", label: "Marker", key: "4" },
  { id: "sword", label: "Sword", key: "5" },
];

const TEAM_SWATCH = "conic-gradient(from 20deg, #ff5a14, #ff2d87, #a23cff, #1e7bff, #39d353, #f5e600, #ff5a14)";

function ToolIcon({ id }: { id: Tool }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (id === "paint") {
    // a tipped cup and its splash
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path {...common} d="M4 7.5 9.5 5l3 6.5-5.5 2.5z" />
        <path {...common} d="M12.5 11.5c1.6.4 2.6 1.6 3.2 3" />
        <path fill="currentColor" stroke="none" d="M15.6 15.2c2.1-.9 4.6.1 4.3 2.1-.2 1.7-2.4 2.6-4.1 1.8-1.4-.7-1.7-3.1-.2-3.9z" />
        <circle fill="currentColor" cx="19.6" cy="13.4" r="0.9" />
        <circle fill="currentColor" cx="13.6" cy="19.6" r="0.7" />
      </svg>
    );
  }
  if (id === "brush") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path {...common} d="M19.5 3.5 11 12" />
        <path {...common} d="M11 12c-1.2-1.1-3.4-.8-4.3.9-.8 1.6-.6 3.3-2.7 5.1 3 .9 6.2.3 7.4-1.6.9-1.4.8-3.2-.4-4.4z" />
        <path {...common} d="m12.6 10.4 1.8 1.8" />
      </svg>
    );
  }
  if (id === "marker") {
    // body, hopper on top, tank behind
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path {...common} d="M3 11.5h12.5v2.6H9.6l-.9 4.4H6l.9-4.4H3z" />
        <path {...common} d="M15.5 12.2h5.5" />
        <path {...common} d="M7.5 11.5c-.6-3.2.6-5.6 3.2-5.6s3.8 2.4 3.2 5.6" />
        <path {...common} d="M3 13.2H1.6v-1.4" />
        <circle fill="currentColor" cx="10.7" cy="9" r="0.9" />
      </svg>
    );
  }
  if (id === "sword") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path {...common} d="M19.5 3.5 20 6l-9.5 9.5-2-2L18 4z" />
        <path {...common} d="m6.5 13.5 4 4M7.6 16.4l-3.1 3.1" />
        <circle fill="currentColor" cx="4" cy="20" r="1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...common} d="M12 3.5c3.4 0 6 5 6 9.2 0 3.7-2.7 6.3-6 6.3s-6-2.6-6-6.3c0-4.2 2.6-9.2 6-9.2z" />
      <path {...common} d="m7.4 11.6 2 1.4 1.8-1.6 1.7 1.7 1.9-1.5 1.8 1.2" />
    </svg>
  );
}

function ConservatorIcon() {
  // a soft cloth / swab
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 14.5c2.5-4 7.5-7.5 11.5-8.5l2.5 2.5c-1 4-4.5 9-8.5 11.5z M9 16l-3.5 3.5 M13 9.5l2 2"
      />
    </svg>
  );
}

function usePointerLocked(): boolean {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const sync = () => setLocked(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", sync);
    sync();
    return () => document.removeEventListener("pointerlockchange", sync);
  }, []);
  return locked;
}

function Palette({ enabled }: { enabled: boolean }) {
  const s = useFx();
  const t = useTally();
  const open = s.open && enabled;

  // keyboard + wheel while the palette is out
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const tool = TOOLS.find((x) => x.key === e.key);
      if (tool) fx.setTool(tool.id);
      else if (e.key === "0") fx.putDown();
      else if (e.key === "[") fx.setBrush(fx.get().brush - 1);
      else if (e.key === "]") fx.setBrush(fx.get().brush + 1);
      else if (e.key === "r" || e.key === "R") fx.requestRefill();
      else if (e.key === "c" || e.key === "C") fx.cycleColor(e.shiftKey ? -1 : 1);
      else return;
      e.preventDefault();
    };
    let lastWheel = 0;
    const onWheel = (e: WheelEvent) => {
      // only while aiming (the wheel has no other job then)
      if (!armed() || !document.pointerLockElement) return;
      if (Math.abs(e.deltaY) < 1) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      if (e.shiftKey) {
        fx.cycleColor(dir);
        return;
      }
      // a notched wheel sends a burst of events: one step per flick
      const now = performance.now();
      if (now - lastWheel < 160) return;
      lastWheel = now;
      fx.cycleTool(dir);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, [open]);

  const custom = !s.team && !PAINT_COLORS.some((c) => c.hex === s.color);
  const colored = s.tool === "paint" || s.tool === "brush" || s.tool === "marker";
  const tab = open ? 0 : -1;

  return (
    <div className={styles.palette} data-open={open} aria-hidden={!open}>
      <TallyCard show={open} inline />
      <div className={styles.section}>
        <div className={styles.eyebrow}>Tools</div>
        <div className={styles.tools}>
          {TOOLS.map((x) => (
            <button
              key={x.id}
              type="button"
              className={styles.tool}
              data-active={s.tool === x.id}
              onClick={() => fx.setTool(s.tool === x.id ? null : x.id)}
              tabIndex={tab}
            >
              <span className={styles.key}>{x.key}</span>
              <ToolIcon id={x.id} />
              {x.label}
            </button>
          ))}
        </div>
      </div>

      {colored && (
        <div className={styles.section}>
          <div className={styles.eyebrow}>
            Colour <small>C</small>
          </div>
          <div className={styles.swatches}>
            {PAINT_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.name}
                aria-label={c.name}
                className={styles.swatch}
                style={{ "--c": c.hex } as CSSProperties}
                data-active={!s.team && s.color === c.hex}
                onClick={() => fx.setColor(c.hex)}
                tabIndex={tab}
              />
            ))}
            <label
              className={`${styles.swatch} ${styles.custom}`}
              data-active={custom}
              title="Any colour"
              style={custom ? ({ background: s.color } as CSSProperties) : undefined}
            >
              <input type="color" value={s.color} onChange={(e) => fx.setColor(e.target.value)} tabIndex={tab} aria-label="Any colour" />
            </label>
          </div>
          {s.tool === "marker" && (
            <button
              type="button"
              className={styles.team}
              data-active={s.team}
              onClick={() => fx.setTeam(!s.team)}
              tabIndex={tab}
              style={{ "--g": TEAM_SWATCH } as CSSProperties}
            >
              <span />
              Random team colours
            </button>
          )}
        </div>
      )}

      {s.tool === "brush" && (
        <div className={styles.section}>
          <div className={styles.eyebrow}>
            Brush <small>[ ]</small>
          </div>
          <div className={styles.sizes}>
            {BRUSH_SIZES.map((b, i) => (
              <button
                key={b.label}
                type="button"
                className={styles.size}
                aria-label={`${b.label} brush`}
                data-active={s.brush === i}
                style={{ "--c": s.color } as CSSProperties}
                onClick={() => fx.setBrush(i)}
                tabIndex={tab}
              >
                <span style={{ width: 5 + i * 5, height: 5 + i * 5 }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {s.tool === "marker" && (
        <div className={styles.section}>
          <div className={styles.eyebrow}>
            Hopper <small>R</small>
          </div>
          <div className={styles.hopper}>
            <span className={styles.count}>
              {t.refilling ? "··" : t.balls}
              <small> / {t.cap}</small>
            </span>
            <button
              type="button"
              className={styles.refill}
              disabled={t.refilling || t.balls === t.cap}
              onClick={() => fx.requestRefill()}
              tabIndex={tab}
            >
              {t.refilling ? "Refilling…" : "Refill"}
            </button>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <button
          type="button"
          className={styles.conservator}
          disabled={!s.dirty && !s.cleaning}
          data-busy={s.cleaning}
          onClick={() => fx.requestClean()}
          tabIndex={tab}
        >
          <ConservatorIcon />
          {s.cleaning ? "Restoring…" : "Call the conservator"}
        </button>
        <button type="button" className={styles.down} onClick={() => fx.putDown()} tabIndex={tab}>
          {s.tool ? "Put the tools down · 0" : "Hands free"}
        </button>
        <div className={styles.hint}>Wheel switches · P hides this · Esc frees the cursor</div>
      </div>
    </div>
  );
}

const CAPTION =
  "Real art is irreplaceable — damaging artworks is a crime, and every attack on a painting takes something from all of us. That’s why it only happens here: nothing real is harmed, and the conservator can make every work whole again.";
const TAGLINE = "Art is history — Art is us. ♥";
const TOAST_MS = 2800;

/** While the panel is out: why this only happens here. */
function Caption({ show }: { show: boolean }) {
  // the museum's own bottom row can yield to it (a module class on <html>,
  // so the stylesheet's selectors stay pure CSS-module selectors)
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle(styles.panelOpen, show);
    return () => {
      el.classList.remove(styles.panelOpen);
    };
  }, [show]);
  return (
    <div className={styles.caption} data-show={show} aria-hidden={!show}>
      <p>{CAPTION}</p>
      <b>{TAGLINE}</b>
    </div>
  );
}

/** After the conservator: a short, fading note. */
function RestoredToast() {
  const { restoredAt } = useFx();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!restoredAt) return;
    setOn(true);
    const id = setTimeout(() => setOn(false), TOAST_MS);
    return () => clearTimeout(id);
  }, [restoredAt]);
  return (
    <div className={styles.toast} data-on={on} role="status" aria-live="polite">
      {restoredAt ? (
        <>
          Restored. <b>{TAGLINE}</b>
        </>
      ) : null}
    </div>
  );
}

function tallyRows(t: ReturnType<typeof useTally>): [string, string][] {
  const rows: [string, string][] = [
    ["Paint", String(t.paint)],
    ["Eggs", String(t.egg)],
    ["Brush", `${t.brush.toFixed(1)} m`],
    ["Works", String(t.works)],
  ];
  if (t.ball > 0) rows.splice(3, 0, ["Balls", String(t.ball)]);
  if (t.cut > 0) rows.splice(rows.length - 1, 0, ["Cuts", String(t.cut)]);
  return rows;
}

/** What has been done this visit: real counts, nothing else. */
function TallyCard({ show, inline = false }: { show: boolean; inline?: boolean }) {
  const t = useTally();
  return (
    <div className={inline ? styles.tallyInline : styles.tally} data-show={show} aria-hidden={!show}>
      {tallyRows(t).map(([k, v]) => (
        <div key={k} className={styles.cell}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

export default function Hud({
  ready,
  inspecting,
  touch,
  audio,
}: {
  ready: boolean;
  inspecting: boolean;
  touch: boolean;
  audio?: FxAudioBridge;
}) {
  const s = useFx();
  const t = useTally();
  const locked = usePointerLocked();
  const enabled = ready && !inspecting;

  // the first unlock opens the palette; P now shows / hides it
  useEffect(() => {
    fx.start();
    latch.onToggle(fx.togglePalette);
    return () => {
      latch.onToggle(null);
      fx.reset();
    };
  }, []);
  useEffect(() => {
    fx.setAudio(audio ?? null);
    setSfxMutedSource(audio ? () => audio.muted() : null);
    return () => {
      fx.setAudio(null);
      setSfxMutedSource(null);
    };
  }, [audio]);

  const ring = s.open && s.tool !== null && enabled && !touch && locked;
  const held = isHeld(s.tool);
  const ringColor = s.tool === "egg" ? "#f1e9da" : held ? "#f4ede0" : s.color;
  return (
    <>
      <Palette enabled={enabled} />
      <TallyCard show={s.open && enabled} />
      <Caption show={s.open && enabled} />
      <RestoredToast />
      <div
        className={styles.reticle}
        data-on={ring}
        data-tool={s.tool ?? "none"}
        data-held={held}
        style={{ "--c": ringColor } as CSSProperties}
        aria-hidden="true"
      >
        {held && (
          <>
            <i />
            <i />
            <i />
            <i />
          </>
        )}
      </div>
      {s.open && enabled && s.tool === "marker" && (
        <div className={styles.balls} data-low={t.balls <= Math.ceil(t.cap * 0.1)} aria-hidden="true">
          {t.refilling ? <span className={styles.refilling}>refilling</span> : t.balls}
          <small>/{t.cap}</small>
        </div>
      )}
    </>
  );
}
