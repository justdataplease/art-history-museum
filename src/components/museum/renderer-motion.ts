// A tiny external store saying whether the visitor is moving continuously
// (walking keys held, tap-to-walk in progress). With frameloop="demand" the
// canvas only renders while something changes, so frame-rate sampling (the
// gallery's adaptive resolution) is only meaningful while this is true.

let moving = false;

export function setMoving(next: boolean): void {
  moving = next;
}

/** Current value, for per-frame readers (no React subscription). */
export const isMoving = (): boolean => moving;

// --------------------------------------------------------- settle tracker

/** Counts painting textures that have settled (loaded or failed), so the
 *  entry doors can open on what the visitor will see first instead of on
 *  drei's global loading manager. One tracker per gallery visit. */
export interface SettleTracker {
  add(slug: string): void;
  has(slug: string): boolean;
  count(): number;
  subscribe(cb: () => void): () => void;
}

export function createSettleTracker(): SettleTracker {
  const settled = new Set<string>();
  const subs = new Set<() => void>();
  let n = 0;
  return {
    add(slug) {
      if (settled.has(slug)) return;
      settled.add(slug);
      n = settled.size;
      subs.forEach((l) => l());
    },
    has: (slug) => settled.has(slug),
    count: () => n,
    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}

// ------------------------------------------------------- inspect flight

/** The inspect camera is flying (to a work or back). A hi-res scan holds its
 *  GPU upload until the flight has landed: a 4K texture's upload and mipmap
 *  generation would otherwise drop frames mid-flight (a cross-room fly-in
 *  takes up to ~2.5 s). Per-frame readers poll it; no React subscription. */
let flying = false;
export function setInspectFlying(next: boolean): void {
  flying = next;
}
export const isInspectFlying = (): boolean => flying;
