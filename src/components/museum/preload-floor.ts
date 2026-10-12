import type { Painting } from "@/lib/types";
import { paintingTextureUrl, wallTexturePx } from "@/lib/img";

/** Warm a floor's wall images in the HTTP cache without retaining decoded images or GPU textures.
 * Two low-priority requests leave room for visible work. Navigation cancels the remaining downloads. */
export function preloadFloorImages(paintings: Painting[]): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "")) return () => {};
  const urls = [...new Set(paintings.map((p) => paintingTextureUrl(p, wallTexturePx(p))).filter((url): url is string => !!url))];
  const controller = new AbortController();
  let next = 0;
  const run = async () => {
    while (!controller.signal.aborted && next < urls.length) {
      const url = urls[next++];
      try {
        const response = await fetch(url, { mode: "cors", credentials: "same-origin", priority: "low", signal: controller.signal });
        if (!response.ok) {
          await response.body?.cancel();
          // Leave retries to visible exhibits; speculative work must not add pressure to a busy host.
          if (response.status === 429 || response.status >= 500) { controller.abort(); return; }
        } else await response.arrayBuffer();
      } catch {
        return;
      }
    }
  };
  const timer = setTimeout(() => { void run(); void run(); }, 1500);
  return () => { clearTimeout(timer); controller.abort(); };
}
