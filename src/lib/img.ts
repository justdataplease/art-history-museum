// Client-safe helper: build a resized Wikimedia thumbnail from an upload.wikimedia.org URL.
// Wikimedia only renders a fixed set of thumb widths (others return HTTP 400),
// so requested widths snap to the nearest allowed bucket.

const THUMB_BUCKETS = [120, 250, 330, 500, 960, 1280, 1920];

export function wikiThumb(
  url: string,
  width: number,
  originalWidth?: number | null
): string {
  try {
    width = THUMB_BUCKETS.find((b) => b >= width) ?? 1920;
    if (originalWidth && originalWidth > 0) {
      // Asking for a thumb wider than the original is an error on Wikimedia's side.
      const fitting = THUMB_BUCKETS.filter((b) => b < originalWidth);
      if (fitting.length === 0) return url;
      width = Math.min(width, fitting[fitting.length - 1]);
      if (originalWidth <= width + 1) return url;
    }
    const u = new URL(url);
    if (u.hostname !== "upload.wikimedia.org") return url;
    if (u.pathname.includes("/thumb/")) {
      // Already a thumb URL: swap the trailing "<N>px-" prefix.
      const parts = u.pathname.split("/");
      const last = parts[parts.length - 1];
      if (/^\d+px-/.test(last)) {
        parts[parts.length - 1] = last.replace(/^\d+px-/, `${width}px-`);
        u.pathname = parts.join("/");
        return u.toString();
      }
      return url;
    }
    // /wikipedia/<project>/a/ab/File.jpg -> /wikipedia/<project>/thumb/a/ab/File.jpg/<w>px-File.jpg
    const m = /^\/wikipedia\/([^/]+)\/(.+)\/([^/]+)$/.exec(u.pathname);
    if (!m) return url;
    const [, project, hashPath, file] = m;
    const suffix = /\.svg$/i.test(file) ? ".png" : "";
    u.pathname = `/wikipedia/${project}/thumb/${hashPath}/${file}/${width}px-${file}${suffix}`;
    return u.toString();
  } catch {
    return url;
  }
}
