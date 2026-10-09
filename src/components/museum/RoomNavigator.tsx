"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { roomNumeral, roomYears, type GalleryLayout } from "./layout";
import styles from "./museum.module.css";

/**
 * A suite's room navigator: "‹ Room 4 of 16 · 1530–1535 ›", and a list of
 * every room (its real year span) to jump to. Pulses when the visitor walks
 * into another room. MuseumApp fades the view around a jump and binds the
 * keyboard ([ ] / PageUp PageDown); with the pointer locked the keys are the
 * way, on touch the buttons.
 *
 * Keyboard and screen readers: the label is a button that opens a listbox
 * (aria-haspopup / aria-expanded / aria-controls). The open list takes focus
 * on the current room (roving tabindex: ↑ ↓ Home End move, Enter / Space
 * jump, Esc / Tab / a click outside close it) and focus returns to the
 * button. The current room is aria-selected and aria-current="location".
 * Room changes never remount the controls, so focus stays where it was.
 */
export function RoomNavigator({
  layout,
  room,
  pulse,
  visible,
  disabled,
  onGo,
}: {
  layout: GalleryLayout;
  /** The room the visitor is in. */
  room: number;
  /** Changes when the visitor enters a room (replays the highlight). */
  pulse: number;
  visible: boolean;
  /** No jumping while a work is inspected or the camera flies back. */
  disabled: boolean;
  onGo: (room: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(room);
  const navRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const n = layout.rooms.length;
  const here = layout.rooms[room];
  // a gallery that follows the artist's life names each room after its phase ("Blue Period · 1901–1904")
  const years = here ? [here.title, roomYears(here, "–")].filter(Boolean).join(" · ") : "";

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  // Replay the highlight on entering a room without remounting the button
  // (a remount would drop keyboard focus).
  useLayoutEffect(() => {
    const el = triggerRef.current;
    if (!el || pulse === 0) return;
    el.classList.remove(styles.roomNavPulse);
    void el.offsetWidth; // restart the animation
    el.classList.add(styles.roomNavPulse);
  }, [pulse]);

  // An arrow button that just became disabled (the first / last room) must
  // not swallow focus: hand it to the label.
  useEffect(() => {
    const f = document.activeElement;
    if ((f === prevRef.current || f === nextRef.current) && (f as HTMLButtonElement).disabled) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [room, disabled]);

  const openList = () => {
    setActive(room);
    setOpen(true);
  };

  // The open list: a click outside closes it; focus follows the active option.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open, close]);
  useLayoutEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-room="${active}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // Hidden (inspecting) or disabled: the list goes.
  useEffect(() => {
    if (open && (!visible || disabled)) setOpen(false);
  }, [open, visible, disabled]);

  if (n < 2) return null;
  const go = (r: number) => {
    if (!disabled && r >= 0 && r < n && r !== room) onGo(r);
  };
  const choose = (r: number) => {
    close(true);
    go(r);
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let to: number | null = null;
    if (e.key === "ArrowDown") to = Math.min(n - 1, active + 1);
    else if (e.key === "ArrowUp") to = Math.max(0, active - 1);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = n - 1;
    else if (e.key === "PageDown") to = Math.min(n - 1, active + 5);
    else if (e.key === "PageUp") to = Math.max(0, active - 5);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // not the gallery's own Esc
      close(true);
      return;
    } else if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation(); // PageUp / PageDown also jump rooms in MuseumApp
    setActive(to);
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openList();
    }
  };

  return (
    <nav
      ref={navRef}
      className={`${styles.roomNav}${visible ? "" : ` ${styles.roomNavHidden}`}`}
      aria-label="Rooms"
      aria-hidden={!visible}
      inert={!visible}
    >
      <button
        ref={prevRef}
        type="button"
        className={styles.roomNavBtn}
        onClick={() => go(room - 1)}
        disabled={disabled || room === 0}
        aria-label="Previous room"
        title="Previous room  ["
      >
        ‹
      </button>
      <button
        ref={triggerRef}
        type="button"
        className={styles.roomNavLabel}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onTriggerKey}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-label={`Room ${room + 1} of ${n}${years ? `, ${years}` : ""}: choose a room`}
        disabled={disabled}
      >
        <b>
          Room {room + 1} <span className={styles.roomNavOf}>of {n}</span>
        </b>
        {years && <span className={styles.roomNavYears}>{years}</span>}
      </button>
      <button
        ref={nextRef}
        type="button"
        className={styles.roomNavBtn}
        onClick={() => go(room + 1)}
        disabled={disabled || room === n - 1}
        aria-label="Next room"
        title="Next room  ]"
      >
        ›
      </button>
      {open && (
        <div
          ref={listRef}
          id={listId}
          className={styles.roomList}
          role="listbox"
          aria-label="Go to room"
          onKeyDown={onListKey}
        >
          {layout.rooms.map((r) => {
            const span = [r.title, roomYears(r, "–")].filter(Boolean).join(" · ");
            const current = r.index === room;
            return (
              <button
                key={r.index}
                type="button"
                role="option"
                data-room={r.index}
                tabIndex={r.index === active ? 0 : -1}
                aria-selected={current}
                aria-current={current ? "location" : undefined}
                aria-label={`Room ${roomNumeral(r.index)}${span ? `, ${span}` : ""}${current ? " (you are here)" : ""}`}
                onClick={() => choose(r.index)}
                onFocus={() => setActive(r.index)}
              >
                <b>{roomNumeral(r.index)}</b>
                <span>{span || "—"}</span>
              </button>
            );
          })}
        </div>
      )}
    </nav>
  );
}
