import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Static Content-Security-Policy (no nonces: a nonce forces every page to
// render dynamically, which would undo the prerendered/ISR galleries).
// - images, portraits and painting textures (fetch -> connect-src): Wikimedia.
//   upload.wikimedia.org can answer a thumbnail request with a redirect to
//   thumb.wikimedia.org (same files, CORS-enabled), so both hosts are allowed.
// - media: the gallery music is served from /audio (public/), with Commons as
//   a fallback (MuseumAudio)
// - 'unsafe-eval' only in dev (React's dev tooling); 'unsafe-inline' scripts
//   are required for Next's inline RSC payload without nonces.
const WIKIMEDIA = "https://upload.wikimedia.org https://thumb.wikimedia.org";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${WIKIMEDIA}`,
  "media-src 'self' blob: https://upload.wikimedia.org",
  `connect-src 'self' ${WIKIMEDIA}`,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,

  // No images config: painting textures and portraits load straight from
  // upload.wikimedia.org (see src/lib/img.ts for why they are not proxied
  // through /_next/image).

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
