// Screenshots of a recreated building (src/lib/spaces.ts), room by room, to set beside photographs of the real
// rooms: for every room of its plan a view down its long axis from one end, one of a side wall, one up at the
// ceiling; and any places asked for by hand.
//
//   node scripts/shot-space.mjs <slug> [outDir=verify-artifacts] [prefix=space] [tier=full|fast] [baseUrl]
//        [--at name:x,z,yaw[,pitch]] ...        (x east, z south, m; yaw 0 looks north, 1.57 west, 3.14 south)
//        [--only room-id,room-id]
//
// Headless and silent: the audio is muted and the pointer lock is faked (a real one clips the user's cursor).
import { chromium } from "playwright";
import fs from "node:fs";

const args = process.argv.slice(2);
const extra = [];
let only = null;
const plain = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--at") {
    const [name, rest] = args[++i].split(":");
    const [x, z, yaw, pitch = 0.05] = rest.split(",").map(Number);
    extra.push({ name, x, z, yaw, pitch });
  } else if (args[i] === "--only") only = new Set(args[++i].split(","));
  else plain.push(args[i]);
}
const [slug = "louvre", outDir = "verify-artifacts", prefix = "space", tier = "full", base = "http://localhost:3000"] = plain;
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"],
});
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
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 300)));

  await page.goto(`${base}/museums/${slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__museum, null, { timeout: 180000 });
  await page.locator(".mus-click-to-start").waitFor({ timeout: 180000 });
  const info = await page.evaluate(() => {
    const L = window.__museum.layout;
    if (!L.plan) return null;
    const per = {};
    for (const p of L.placements) per[p.room] = (per[p.room] || 0) + 1;
    return {
      works: L.placements.length,
      rooms: L.plan.shells.map((s) => ({
        id: s.id, x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, h: s.height, alongX: s.alongX,
        works: s.zones.reduce((n, z) => n + (per[z] || 0), 0),
      })),
    };
  });
  if (!info) throw new Error(`${slug} is not a recreated building (its room has no space)`);
  console.log(`${info.works} works;`, info.rooms.map((r) => `${r.id} ${(r.x1 - r.x0).toFixed(1)}x${(r.z1 - r.z0).toFixed(1)}x${r.h} m: ${r.works}`).join("; "));
  await page.locator(".mus-click-to-start").click();
  await page.waitForTimeout(1500);

  const poses = [];
  for (const r of info.rooms) {
    if (only && !only.has(r.id)) continue;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    // from one end, down the long axis; a side wall at an angle; the ceiling
    const along = r.alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    const back = Math.min(8, along * 0.3);
    if (r.alongX) {
      poses.push({ name: `${r.id}-vista`, x: r.x1 - back, z: cz + 0.8, yaw: Math.PI / 2, pitch: 0.07 });
      poses.push({ name: `${r.id}-wall`, x: cx, z: cz + 1, yaw: 0.6, pitch: 0.06 });
      poses.push({ name: `${r.id}-ceiling`, x: r.x1 - back, z: cz, yaw: Math.PI / 2, pitch: 0.7 });
    } else {
      poses.push({ name: `${r.id}-vista`, x: cx + 0.8, z: r.z1 - back, yaw: 0, pitch: 0.07 });
      poses.push({ name: `${r.id}-wall`, x: cx + 1, z: cz, yaw: 0.95, pitch: 0.06 });
      poses.push({ name: `${r.id}-ceiling`, x: cx, z: r.z1 - back, yaw: 0, pitch: 0.7 });
    }
  }
  poses.push(...extra);
  for (const p of poses) {
    await page.evaluate(({ x, z, yaw, pitch }) => {
      const m = window.__museum;
      m.camera.position.set(x, 1.65, z);
      m.camera.rotation.set(pitch, yaw, 0, "YXZ");
      m.invalidate();
    }, p);
    // the works mount, their textures load, the lights come up, the room's own reflections are taken
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__museum.invalidate());
    await page.waitForTimeout(4200);
    await page.evaluate(() => window.__museum.invalidate());
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/${prefix}-${p.name}.png` });
  }
  console.log(`${poses.length} screenshots in ${outDir}; console errors: ${errs.length}`);
  [...new Set(errs)].slice(0, 12).forEach((e) => console.log("  ", e));
} finally {
  await browser.close();
}
