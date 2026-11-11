// Touch or mouse: which the visitor walks with. A phone or tablet walks by touch (the two sticks, drag to look), a
// computer with the mouse (pointer lock). A computer with a touchscreen has both, and Chrome on Windows reports
// its primary pointer as coarse whenever a touchscreen is attached, touchpad and mouse notwithstanding: going by
// (pointer: coarse) alone sent such laptops into the phone's controls. So a device with both starts with the mouse
// (a phone or tablet with a pen or a mouse, with touch; either way the one used last in this tab, if any) and
// changes the moment the visitor uses the other: a finger on the screen gives the sticks, the mouse or touchpad
// gives pointer lock back.

export type InputMode = "touch" | "mouse";

const KEY = "timeline-museum:input";
const FINE = "(any-pointer: fine)";
const COARSE = "(any-pointer: coarse)";

let mode: InputMode | null = null;
let mouseOk = false;
let touchOk = false;
const listeners = new Set<() => void>();

function sense() {
  mouseOk = "requestPointerLock" in Element.prototype && window.matchMedia(FINE).matches;
  touchOk = window.matchMedia(COARSE).matches || navigator.maxTouchPoints > 0;
}

function mobileDevice(): boolean {
  const ua = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return ua.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

function guess(): InputMode {
  if (!mouseOk) return "touch";
  if (!touchOk) return "mouse";
  try {
    const kept = sessionStorage.getItem(KEY);
    if (kept === "touch" || kept === "mouse") return kept;
  } catch {}
  return mobileDevice() ? "touch" : "mouse";
}

function set(next: InputMode) {
  if (next === mode) return;
  mode = next;
  try {
    sessionStorage.setItem(KEY, next);
  } catch {}
  if (next === "touch" && document.pointerLockElement) document.exitPointerLock();
  listeners.forEach((f) => f());
}

function onPointer(e: PointerEvent) {
  if (e.pointerType === "touch") {
    if (mode !== "touch") set("touch");
  } else if (e.pointerType === "mouse" && mode !== "mouse" && mouseOk) {
    // a press, or a real move (not the still cursor's hover update after a layout change)
    if (e.type === "pointerdown" || e.movementX !== 0 || e.movementY !== 0) set("mouse");
  }
}

function start() {
  if (mode !== null) return;
  sense();
  mode = guess();
  const opts = { capture: true, passive: true };
  window.addEventListener("pointerdown", onPointer, opts);
  window.addEventListener("pointermove", onPointer, opts);
  const recheck = () => {
    sense();
    if (!mouseOk) set("touch");
    else if (!touchOk) set("mouse");
  };
  window.matchMedia(FINE).addEventListener("change", recheck);
  window.matchMedia(COARSE).addEventListener("change", recheck);
}

export function subscribeInputMode(cb: () => void): () => void {
  start();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Walking by touch (the sticks, drag to look) rather than with the mouse (pointer lock). */
export function walksByTouch(): boolean {
  start();
  return mode === "touch";
}
