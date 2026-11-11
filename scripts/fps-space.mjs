// Frames a second in each room of a recreated building (src/lib/spaces.ts), on both graphics tiers: a view down
// each room from one end, counted over three seconds with every frame drawn. Headless Chrome draws on the
// integrated graphics of this machine, so the count stands for a weak laptop: compare with an artist's long
// gallery measured the same way (docs/DEVELOPMENT.md).
//
//   node scripts/fps-space.mjs <slug> [baseUrl=http://localhost:3000]
//
// Headless and silent: the audio is muted and the pointer lock is faked (a real one clips the user's cursor).
import { chromium } from "playwright";

const [slug = "louvre", base = "http://localhost:3000"] = process.argv.slice(2);
for (const tier of ["full", "fast"]) {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
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
        s.hud = false;
        localStorage.setItem(k, JSON.stringify(s));
      } catch {}
    }, tier);
    await page.goto(`${base}/museums/${slug}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__museum, null, { timeout: 180000 });
    await page.locator(".mus-click-to-start").waitFor({ timeout: 180000 });
    await page.locator(".mus-click-to-start").click();
    await page.waitForTimeout(2500);
    const out = [];
    // down each room's long axis from one end
    const POSES = await page.evaluate(() => {
      const P = window.__museum.layout.plan;
      if (!P) return null;
      return P.shells.map((s) => {
        const along = s.alongX ? s.x1 - s.x0 : s.z1 - s.z0;
        const back = Math.min(8, along * 0.3);
        return s.alongX ? [s.id, s.x1 - back, (s.z0 + s.z1) / 2, Math.PI / 2, 0.07] : [s.id, (s.x0 + s.x1) / 2, s.z1 - back, 0, 0.07];
      });
    });
    if (!POSES) throw new Error(`${slug} is not a recreated building (its room has no space)`);
    for (const [name, x, z, yaw, pitch] of POSES) {
      await page.evaluate(({ x, z, yaw, pitch }) => {
        const m = window.__museum;
        m.camera.position.set(x, 1.65, z);
        m.camera.rotation.set(pitch, yaw, 0, "YXZ");
        m.invalidate();
      }, { x, z, yaw, pitch });
      await page.waitForTimeout(6000);
      const fps = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const m = window.__museum;
            let n = 0;
            const t0 = performance.now();
            const tick = () => {
              n++;
              m.invalidate();
              if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
              else resolve((n * 1000) / (performance.now() - t0));
            };
            requestAnimationFrame(tick);
          })
      );
      out.push(`${name} ${fps.toFixed(1)}`);
    }
    const info = await page.evaluate(() => {
      const r = window.__museum.scene;
      let tris = 0;
      let meshes = 0;
      r.traverseVisible((o) => {
        if (o.isMesh && o.geometry) {
          meshes++;
          const g = o.geometry;
          tris += (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
        }
      });
      return { meshes, tris: Math.round(tris) };
    });
    console.log(`${tier}: ${out.join("; ")}  (visible meshes ${info.meshes}, triangles ${info.tris})`);
  } finally {
    await browser.close();
  }
}
