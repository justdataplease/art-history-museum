"use client";

// Dragging in the room picker: works within and between floors, and the floors of a plan. Pointer events, so a
// mouse, a pen and a finger all work; a finger holds still a moment to pick an item up, so a swipe still scrolls.
// An item is [data-drag-item="<scope>"] with data-index, inside a list [data-drag-list="<scope>"] with data-list;
// the floating copy is styled by the nearest [data-drag-root] around them. A drop reports the list and index the
// item was taken from and where it lands (counted once it has left its place).

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

export interface DragPlace {
  list: number;
  index: number;
}

interface Options {
  scope: string;
  /** "x": items in rows, before or after an item by the pointer's x (a grid); "y": a column, by its y. */
  axis: "x" | "y";
  /** Picked up only by an element marked [data-drag-handle] (rows full of fields); else anywhere but a control. */
  handle?: boolean;
  /** May an item leave its list for this one? (Default: yes.) */
  accepts?: (from: number, to: number) => boolean;
  onDrop: (from: DragPlace, to: DragPlace) => void;
  /** The item being dragged (left in its place), its floating copy, the item a drop lands before or after, and an
   *  empty list it lands in. */
  classes: { source: string; ghost: string; before: string; after: string; into: string };
}

/** A finger holds still this long to pick up. */
const HOLD_MS = 260;
/** Pixels a finger may wander while holding, and a mouse moves before it drags. */
const SLOP = 8;
/** Pixels from the top, or above the picker's bar at the bottom, where the page scrolls while dragging. */
const EDGE = 72;
const BOTTOM_BAR = 84;

/** The floating copy: the item inside shallow copies of its ancestors up to the root, so the page's styles hold. */
function ghostOf(item: HTMLElement, r: DOMRect): HTMLElement {
  const root = item.closest<HTMLElement>("[data-drag-root]") ?? item.parentElement!;
  let top = item.cloneNode(true) as HTMLElement;
  for (let el = item.parentElement; el && el !== root.parentElement; el = el.parentElement) {
    const shell = el.cloneNode(false) as HTMLElement;
    Object.assign(shell.style, { display: "block", margin: "0", padding: "0", border: "0", background: "none",
      boxShadow: "none", minHeight: "0", maxWidth: "none" });
    shell.appendChild(top);
    top = shell;
  }
  for (const el of [top, ...top.querySelectorAll<HTMLElement>("*")]) {
    el.removeAttribute("id");
    for (const a of ["data-drag-item", "data-drag-list", "data-drag-root"]) el.removeAttribute(a);
  }
  Object.assign(top.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`,
    zIndex: "1000", pointerEvents: "none" });
  return top;
}

/** Props for a container of draggable items: its ref and its pointer-down handler. */
export function useDragSort(options: Options) {
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });
  const stop = useRef<(() => void) | null>(null);
  const holding = useRef(false);
  useEffect(() => () => stop.current?.(), []);

  // A finger holding an item moves it, not the page. Chrome settles whether a touch may stop the page scrolling
  // when it lands, so the containers listen from the start (not passively), and only while an item is held do
  // they stop it.
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const block = (ev: TouchEvent) => {
      if (holding.current) ev.preventDefault();
    };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    const o = opts.current;
    if (e.button !== 0 || stop.current) return;
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>(`[data-drag-item="${o.scope}"]`);
    const list = item?.closest<HTMLElement>(`[data-drag-list="${o.scope}"]`);
    if (!item || !list) return;
    if (o.handle ? !target.closest("[data-drag-handle]") : target.closest("button, input, select, textarea, a")) return;
    const from: DragPlace = { list: Number(list.dataset.list), index: Number(item.dataset.index) };
    const id = e.pointerId;
    const touch = e.pointerType === "touch";
    const x0 = e.clientX;
    const y0 = e.clientY;
    let px = x0;
    let py = y0;
    let active = false;
    let ghost: HTMLElement | null = null;
    let marked: HTMLElement | null = null;
    let markClass = "";
    let to: DragPlace | null = null;
    let frame = 0;

    const aim = () => {
      const under = document.elementFromPoint(px, py) as HTMLElement | null;
      const over = under?.closest<HTMLElement>(`[data-drag-list="${o.scope}"]`);
      const n = over ? Number(over.dataset.list) : -1;
      let place: DragPlace | null = null;
      let mark: HTMLElement | null = null;
      let cls = "";
      if (over && (n === from.list || (o.accepts?.(from.list, n) ?? true))) {
        const items = [...over.querySelectorAll<HTMLElement>(`[data-drag-item="${o.scope}"]`)];
        if (!items.length) {
          place = { list: n, index: 0 };
          mark = over;
          cls = o.classes.into;
        } else {
          // the nearest item (the pointer may be in a gap between them), and which side of it
          let near = items[0];
          let least = Infinity;
          for (const it of items) {
            const r = it.getBoundingClientRect();
            const d = Math.hypot(Math.max(r.left - px, 0, px - r.right), Math.max(r.top - py, 0, py - r.bottom));
            if (d < least) [least, near] = [d, it];
          }
          const r = near.getBoundingClientRect();
          const after = o.axis === "x" ? px > r.left + r.width / 2 : py > r.top + r.height / 2;
          place = { list: n, index: Number(near.dataset.index) + (after ? 1 : 0) };
          mark = near;
          cls = after ? o.classes.after : o.classes.before;
        }
      }
      if (mark !== marked || cls !== markClass) {
        marked?.classList.remove(markClass);
        mark?.classList.add(cls);
        marked = mark;
        markClass = cls;
      }
      to = place;
    };
    const follow = () => {
      if (ghost) ghost.style.transform = `translate(${px - x0}px, ${py - y0}px) scale(1.04)`;
      aim();
    };
    // near the top or the bottom the page scrolls, so a work can go to a floor out of sight
    const scroll = () => {
      const low = window.innerHeight - BOTTOM_BAR - EDGE;
      const v = py < EDGE ? -(EDGE - py) / 3 : py > low ? (py - low) / 3 : 0;
      if (v) {
        window.scrollBy(0, v);
        aim();
      }
      frame = requestAnimationFrame(scroll);
    };
    const start = () => {
      active = true;
      holding.current = true;
      const r = item.getBoundingClientRect();
      ghost = ghostOf(item, r);
      ghost.classList.add(o.classes.ghost);
      document.body.appendChild(ghost);
      item.classList.add(o.classes.source);
      follow();
      frame = requestAnimationFrame(scroll);
    };
    const hold = touch ? window.setTimeout(start, HOLD_MS) : 0;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      px = ev.clientX;
      py = ev.clientY;
      if (!active) {
        if (Math.hypot(px - x0, py - y0) <= SLOP) return;
        if (touch) end(false); // a swipe: the page scrolls
        else start();
        return;
      }
      follow();
    };
    const onUp = (ev: PointerEvent) => ev.pointerId === id && end(true);
    const onCancel = (ev: PointerEvent) => ev.pointerId === id && end(false);
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && end(false);
    // holding an item does not open the page's menu
    const noMenu = (ev: Event) => active && ev.preventDefault();
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };

    function end(drop: boolean) {
      clearTimeout(hold);
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", noMenu);
      holding.current = false;
      ghost?.remove();
      item!.classList.remove(o.classes.source);
      marked?.classList.remove(markClass);
      stop.current = null;
      if (!active) return;
      // the click that ends a drag does not press what it ends over
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      if (!drop || !to) return;
      const index = to.list === from.list && to.index > from.index ? to.index - 1 : to.index;
      if (to.list !== from.list || index !== from.index) opts.current.onDrop(from, { list: to.list, index });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", noMenu);
    stop.current = () => end(false);
  }, []);

  return { ref, onPointerDown };
}
