// A gallery in Firefox or in Chrome, measured from outside: how long the page is frozen while it loads (and by
// what), how many shader programs it links, the graphics tier Auto picks, and what a frame costs once inside.
//
//   node scripts/browser-probe.mjs <firefox|chrome> [path=/museum/caravaggio] [tier=auto|full|fast] [baseUrl]
//   W=2048 H=1030 DSF=1.25 node scripts/browser-probe.mjs firefox      (a screen's size and scaling)
//
// Firefox needs `npx playwright install firefox` once. Why it has a probe of its own: it has no
// KHR_parallel_shader_compile, so every program is compiled on the page's own thread (Chrome does that on other
// threads), and it names the graphics card only loosely ("Radeon HD 3200 Graphics, or similar"), which is what
// quality.ts has to go by there.
//
// - `freezes`: stretches over 150 ms in which the page's thread did not run, before the visitor can step in.
// - `frameMs`: a frame drawn and waited for (a one-pixel read), forty times over: the true cost of a frame,
//   whatever the screen's refresh. Headless Firefox composites in software, so its frames per second (`fps`)
//   run under a real window's; `frameMs` and Chrome's numbers stand for the graphics card.
// Both browsers draw on this machine's integrated graphics when headless (docs/DEVELOPMENT.md).
//
// Headless and silent: the audio is muted and the pointer lock is faked (a real one clips the user's cursor).
import { chromium, firefox } from "playwright";

const [which = "firefox", path = "/museum/caravaggio", tier = "auto", base = "http://localhost:3000"] = process.argv.slice(2);
const W = +(process.env.W ?? 1600);
const H = +(process.env.H ?? 900);
const browser =
  which === "firefox"
    ? await firefox.launch({ headless: true, firefoxUserPrefs: { "media.volume_scale": "0.0" } })
    : await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: +(process.env.DSF ?? 1) });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.addInitScript((tier) => {
    window.__MUSEUM_DEBUG__ = true;
    let locked = null;
    Object.defineProperty(Document.prototype, "pointerLockElement", { configurable: true, get() { return locked; } });
    const fire = () => queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange")));
    Element.prototype.requestPointerLock = function () { locked = this; fire(); return Promise.resolve(); };
    Document.prototype.exitPointerLock = function () { locked = null; fire(); };
    try {
      const k = "timeline-museum:settings";
      const s = JSON.parse(localStorage.getItem(k) || "{}");
      s.graphics = tier;
      localStorage.setItem(k, JSON.stringify(s));
    } catch {}
    const T = (window.__probe = { freezes: [], slow: {}, programs: 0, draws: 0 });
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      if (now - last > 150) T.freezes.push([Math.round(last), Math.round(now - last)]);
      last = now;
    }, 20);
    // every WebGL call timed: the ones the page waits in name what froze it
    const P = window.WebGL2RenderingContext?.prototype;
    if (P) {
      for (const fn of Object.getOwnPropertyNames(P)) {
        const d = Object.getOwnPropertyDescriptor(P, fn);
        if (!d || typeof d.value !== "function") continue;
        const orig = d.value;
        P[fn] = function (...a) {
          if (fn === "linkProgram") T.programs++;
          if (fn.startsWith("draw")) T.draws++;
          const t = performance.now();
          const r = orig.apply(this, a);
          const dt = performance.now() - t;
          if (dt > 1) {
            const e = (T.slow[fn] ??= [0, 0]);
            e[0]++;
            e[1] += dt;
          }
          return r;
        };
      }
    }
  }, tier);

  const t0 = Date.now();
  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  const start = page.locator(".mus-click-to-start");
  await start.waitFor({ timeout: 180000 });
  const readyMs = Date.now() - t0;
  const load = await page.evaluate(() => {
    const T = window.__probe;
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      graphics: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown",
      parallelCompile: !!gl?.getExtension("KHR_parallel_shader_compile"),
      programs: T.programs,
      frozenMs: T.freezes.reduce((n, f) => n + f[1], 0),
      freezes: T.freezes,
      waitedIn: Object.entries(T.slow).map(([k, v]) => [k, v[0], Math.round(v[1])]).filter((e) => e[2] >= 30).sort((a, b) => b[2] - a[2]).slice(0, 5),
    };
  });
  await start.click();
  await page.waitForTimeout(2000);

  /** A frame drawn now and waited for, `frames` times: ms each. */
  const frameMs = (frames) =>
    page.evaluate((frames) => {
      const m = window.__museum;
      const st = m.scene.__r3f?.root?.getState?.();
      if (!st?.advance) return null;
      const gl = st.gl.getContext();
      const px = new Uint8Array(4);
      const run = (n) => {
        for (let i = 0; i < n; i++) {
          m.invalidate();
          st.advance(performance.now(), true);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
      };
      run(4);
      const t = performance.now();
      run(frames);
      return +((performance.now() - t) / frames).toFixed(1);
    }, frames);
  /** Frames a second over `ms`, every frame drawn. */
  const fps = (ms) =>
    page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const m = window.__museum;
          let n = 0;
          const t0 = performance.now();
          const tick = () => {
            n++;
            m.invalidate();
            if (performance.now() - t0 < ms) requestAnimationFrame(tick);
            else resolve(+((n * 1000) / (performance.now() - t0)).toFixed(1));
          };
          requestAnimationFrame(tick);
        }),
      ms
    );
  const canvas = () => page.evaluate(() => { const c = document.querySelector("canvas"); return `${c.width}x${c.height}`; });
  const standing = { canvas: await canvas(), frameMs: await frameMs(40), fps: await fps(3000) };
  // walking: the adaptive resolution may step down meanwhile
  const programsBefore = await page.evaluate(() => window.__probe.programs);
  await page.keyboard.down("KeyW");
  const walkFps = await fps(6000);
  await page.keyboard.up("KeyW");
  const walking = { fps: walkFps, canvas: await canvas(), frameMs: await frameMs(40), programsLinked: (await page.evaluate(() => window.__probe.programs)) - programsBefore };
  const scene = await page.evaluate(() => {
    const m = window.__museum;
    let lights = 0;
    m.scene.traverse((o) => { if (o.isLight) lights++; });
    return { lights, reflection: m.reflectionOn(), rooms: m.layout.rooms.length };
  });
  console.log(JSON.stringify({ browser: which, path, tier, viewport: `${W}x${H}`, readyMs, load, standing, walking, scene, errors }, null, 2));
} finally {
  await browser.close();
}
