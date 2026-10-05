// Measure the museum's rendering cost from the outside — no app instrumentation.
// Wraps WebGL draw calls / framebuffer binds via an init script, then samples
// frame times and per-frame GPU work while standing in the hall.
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

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));

let imageBytes = 0;
let imageCount = 0;
page.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("upload.wikimedia.org")) return;
  try {
    const body = await res.body();
    imageBytes += body.length;
    imageCount++;
  } catch {}
});

await page.addInitScript(() => {
  const stats = { draws: 0, fbBinds: 0, programs: 0, texUploads: 0 };
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
    for (const fn of ["texImage2D", "texSubImage2D"]) {
      const orig = P[fn];
      P[fn] = function (...a) { stats.texUploads++; return orig.apply(this, a); };
    }
  }
});

const tNav = Date.now();
const resp = await page.goto(`${base}/museum/${slug}`, { waitUntil: "domcontentloaded" });
const ttfbMs = Date.now() - tNav;
const status = resp?.status();

// wait for the doors to open and the hall to settle
await page.waitForFunction(() => {
  const d = document.querySelector(".doors");
  return d && getComputedStyle(d).display === "none";
}, null, { timeout: 30000 }).catch(() => {});
const doorsOpenMs = Date.now() - tNav;
await page.waitForTimeout(2500);

const gpu = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  const ext = gl?.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});

// sample 4 s of steady-state frames
const sample = await page.evaluate(async () => {
  const s = window.__probe;
  const d0 = s.draws, f0 = s.fbBinds;
  const times = [];
  let last = performance.now();
  const t0 = last;
  await new Promise((resolve) => {
    const tick = (now) => {
      times.push(now - last);
      last = now;
      if (now - t0 < 4000) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  const frames = times.length;
  const sorted = [...times].sort((a, b) => a - b);
  return {
    frames,
    fps: +(frames / 4).toFixed(1),
    frameMsMedian: +sorted[Math.floor(frames / 2)].toFixed(2),
    frameMsP95: +sorted[Math.floor(frames * 0.95)].toFixed(2),
    drawsPerFrame: Math.round((s.draws - d0) / frames),
    fbBindsPerFrame: Math.round((s.fbBinds - f0) / frames),
    programsLinked: s.programs,
    texUploads: s.texUploads,
  };
});

await page.screenshot({ path: `${OUT}/${label}-hall.png` });
const jsBytes = await page.evaluate(() =>
  performance.getEntriesByType("resource")
    .filter((e) => e.initiatorType === "script")
    .reduce((n, e) => n + (e.transferSize || e.encodedBodySize || 0), 0)
);

const summary = {
  label, slug, status, gpu, ttfbMs, doorsOpenMs,
  ...sample,
  wikimediaImages: imageCount,
  wikimediaMB: +(imageBytes / 1e6).toFixed(2),
  jsKB: Math.round(jsBytes / 1024),
  consoleErrors: errs,
};
console.log(JSON.stringify(summary, null, 2));
fs.writeFileSync(`${OUT}/${label}-perf.json`, JSON.stringify(summary, null, 2));
await browser.close();
