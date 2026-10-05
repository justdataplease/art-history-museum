// Measure the museum's rendering cost from the outside — no app instrumentation.
// Wraps WebGL draw calls / framebuffer binds via an init script, then samples
// GPU work per *rendered* frame (a requestAnimationFrame tick in which any draw
// call happened), first standing still, then walking forward (W held).
//
// The gallery renders on demand (frameloop="demand"), so an idle hall draws
// nothing: `idle.renderedFps` shows that, and `walk.*` is the cost of a frame
// while something actually changes. Older builds that render every frame
// report the same number in both samples.
//
//   node scripts/perf-probe.mjs [slug] [baseUrl] [label]
//
// Prints a JSON summary and drops a screenshot in verify-artifacts/.
import { chromium } from "playwright";
import fs from "node:fs";

const slug = process.argv[2] ?? "caravaggio";
const base = process.argv[3] ?? "http://localhost:3000";
const label = process.argv[4] ?? "probe";
const OUT = "verify-artifacts";
fs.mkdirSync(OUT, { recursive: true });
const origin = new URL(base).origin;

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => errs.push(`pageerror: ${String(e).slice(0, 200)}`));

// Painting images: straight from Wikimedia, or proxied through Next's image
// optimizer (same-origin /_next/image). Audio (the gallery music) is excluded.
let imageBytes = 0;
let imageCount = 0;
let proxiedCount = 0;
let lastImageMs = 0;
let tStart = Date.now();
page.on("response", async (res) => {
  const url = new URL(res.url());
  const wiki = url.hostname === "upload.wikimedia.org";
  const proxied = url.origin === origin && url.pathname.startsWith("/_next/image");
  if (!wiki && !proxied) return;
  const type = (await res.headerValue("content-type").catch(() => null)) ?? "";
  if (!type.startsWith("image/")) return;
  try {
    const body = await res.body();
    imageBytes += body.length;
    imageCount++;
    if (proxied) proxiedCount++;
    lastImageMs = Math.max(lastImageMs, Date.now() - tStart);
  } catch {}
});

await page.addInitScript(() => {
  const stats = { draws: 0, fbBinds: 0, programs: 0, texUploads: 0, ticks: 0, rendered: 0 };
  window.__probe = stats;
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    const P = C.prototype;
    for (const fn of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"]) {
      const orig = P[fn];
      if (!orig) continue;
      P[fn] = function (...a) { stats.draws++; return orig.apply(this, a); };
    }
    const bf = P.bindFramebuffer;
    P.bindFramebuffer = function (...a) { stats.fbBinds++; return bf.apply(this, a); };
    const lp = P.linkProgram;
    P.linkProgram = function (...a) { stats.programs++; return lp.apply(this, a); };
    for (const fn of ["texImage2D", "texSubImage2D", "texImage3D", "compressedTexImage2D"]) {
      const orig = P[fn];
      if (!orig) continue;
      P[fn] = function (...a) { stats.texUploads++; return orig.apply(this, a); };
    }
  }
  // a rendered frame = a rAF tick in which any draw call happened
  let last = 0;
  const tick = () => {
    stats.ticks++;
    if (stats.draws !== last) { stats.rendered++; last = stats.draws; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const tNav = Date.now();
tStart = tNav;
const resp = await page.goto(`${base}/museum/${slug}`, { waitUntil: "domcontentloaded" });
const ttfbMs = Date.now() - tNav;
const status = resp?.status();

// doors: first visible swing, then fully gone
let doorsSwingMs = null;
let doorsOpenMs = null;
for (let i = 0; i < 600; i++) {
  const st = await page.evaluate(() => {
    const l = document.querySelector(".door-l");
    const d = document.querySelector(".doors");
    return { tr: l && getComputedStyle(l).transform, disp: d && getComputedStyle(d).display };
  });
  if (doorsSwingMs === null && st.tr && st.tr !== "none" && st.tr !== "matrix(1, 0, 0, 1, 0, 0)") doorsSwingMs = Date.now() - tNav;
  if (st.disp === "none") { doorsOpenMs = Date.now() - tNav; break; }
  await page.waitForTimeout(50);
}
await page.waitForSelector(".mus-click-to-start", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1500);

const gpu = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});

const sample = (ms) =>
  page.evaluate(async (ms) => {
    const s = window.__probe;
    const d0 = s.draws, f0 = s.fbBinds, r0 = s.rendered;
    const times = [];
    let last = performance.now();
    const t0 = last;
    await new Promise((resolve) => {
      const tick = (now) => {
        times.push(now - last);
        last = now;
        if (now - t0 < ms) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    const rendered = s.rendered - r0;
    const sorted = [...times].sort((a, b) => a - b);
    return {
      rafFrames: times.length,
      renderedFrames: rendered,
      renderedFps: +(rendered / (ms / 1000)).toFixed(1),
      frameMsMedian: +sorted[Math.floor(times.length / 2)].toFixed(2),
      frameMsP95: +sorted[Math.floor(times.length * 0.95)].toFixed(2),
      drawsPerFrame: rendered ? Math.round((s.draws - d0) / rendered) : 0,
      fbBindsPerFrame: rendered ? +((s.fbBinds - f0) / rendered).toFixed(1) : 0,
    };
  }, ms);

const idle = await sample(3000);
await page.screenshot({ path: `${OUT}/${label}-hall.png` });

// walk forward for 3 s (pointer lock from the "step inside" overlay)
let walk = null;
const overlay = page.locator(".mus-click-to-start");
if (await overlay.count()) {
  await overlay.click().catch(() => {});
  await page.waitForTimeout(400);
  await page.keyboard.down("KeyW");
  walk = await sample(3000);
  await page.keyboard.up("KeyW");
}

const counters = await page.evaluate(() => ({ programsLinked: window.__probe.programs, texUploads: window.__probe.texUploads }));
const jsBytes = await page.evaluate(() =>
  performance.getEntriesByType("resource")
    .filter((e) => e.initiatorType === "script")
    .reduce((n, e) => n + (e.transferSize || e.encodedBodySize || 0), 0)
);

const steady = walk && walk.renderedFrames ? walk : idle;
const summary = {
  label, slug, status, gpu, ttfbMs, lastImageMs, doorsSwingMs, doorsOpenMs,
  // per rendered frame while the view changes (walking), else the idle sample
  drawsPerFrame: steady.drawsPerFrame,
  fbBindsPerFrame: steady.fbBindsPerFrame,
  idle,
  walk,
  ...counters,
  images: imageCount,
  proxiedImages: proxiedCount,
  imageMB: +(imageBytes / 1e6).toFixed(2),
  jsKB: Math.round(jsBytes / 1024),
  consoleErrors: errs,
};
console.log(JSON.stringify(summary, null, 2));
fs.writeFileSync(`${OUT}/${label}-perf.json`, JSON.stringify(summary, null, 2));
await browser.close();
