// Screenshots of a gallery from fixed viewpoints (entrance, inside each room,
// doorways looking into the next room), placed through the page's test hook.
//
//   node scripts/suite-views.mjs <slug> [baseUrl] [prefix]
//
// Each shot waits for the textures in view to settle. Drops PNGs and a JSON
// summary (room spans, spot pool, texture tiers per view) in verify-artifacts/.
import { chromium } from "playwright";
import fs from "node:fs";

// Never take a real pointer lock: on Windows, Chrome (headless too) clips the
// user's actual cursor to its hidden window. The page sees a locked element
// and pointerlockchange events as usual; mouse-look is driven with synthetic
// mousemove events (movementX/Y) instead of the real mouse.
const POINTER_LOCK_STUB = () => {
  let locked = null;
  Object.defineProperty(Document.prototype, "pointerLockElement", { configurable: true, get() { return locked; } });
  const fire = () => queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange")));
  Element.prototype.requestPointerLock = function () { locked = this; fire(); return Promise.resolve(); };
  Document.prototype.exitPointerLock = function () { locked = null; fire(); };
};

const slug = process.argv[2] ?? "andrea-mantegna";
const base = process.argv[3] ?? "http://localhost:3000";
const prefix = process.argv[4] ?? `views-${slug}`;
const OUT = "verify-artifacts";
fs.mkdirSync(`${OUT}/${prefix.split("/").slice(0, -1).join("/") || "."}`, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.addInitScript(POINTER_LOCK_STUB);
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 240)));
page.on("pageerror", (e) => errs.push(`pageerror: ${String(e).slice(0, 240)}`));
page.on("crash", () => console.error("PAGE CRASHED"));
await page.addInitScript(() => {
  window.__MUSEUM_DEBUG__ = true;
});

await page.goto(`${base}/museum/${slug}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => getComputedStyle(document.querySelector(".doors")).display === "none", null, {
  timeout: 30000,
});
await page.waitForFunction(() => !!window.__museum, null, { timeout: 10000 });
// step inside (pointer lock), so the overlay is gone
await page.waitForSelector(".mus-click-to-start", { timeout: 10000 }).catch(() => {});
await page.locator(".mus-click-to-start").click().catch(() => {});
await page.waitForTimeout(2500);

/** Put the camera at (x, z) looking at yaw (rad, 0 = down the hall) and pitch. */
async function view(name, x, z, yaw = 0, pitch = 0, settle = 2600) {
  await page.evaluate(
    ({ x, z, yaw, pitch }) => {
      const m = window.__museum;
      m.camera.position.set(x, 1.65, z);
      m.camera.rotation.set(pitch, yaw, 0, "YXZ");
      m.camera.updateMatrixWorld();
      m.invalidate();
    },
    { x, z, yaw, pitch }
  );
  // let the runtime re-plan (lights fade, tiers load)
  for (let i = 0; i < settle / 100; i++) {
    await page.evaluate(() => window.__museum.invalidate());
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: `${OUT}/${prefix}-${name}.png` });
  return page.evaluate(() => {
    const m = window.__museum;
    const rt = m.runtime;
    // texture tiers of the works hung (mounted) right now
    const tiers = {};
    for (const e of rt.exhibits) {
      if (!e.group) continue;
      tiers[e.tier] = (tiers[e.tier] ?? 0) + 1;
    }
    let lit = 0;
    for (const s of rt.slots) if (s.head && s.goal === 1) lit++;
    let visible = 0;
    let mounted = 0;
    for (const e of rt.exhibits) {
      if (e.group) mounted++;
      if (e.group?.visible) visible++;
    }
    return {
      room: rt.currentRoom(),
      tiers,
      lit,
      pool: rt.poolSize,
      mountedExhibits: mounted,
      visibleExhibits: visible,
      textures: m.textureStats(),
      archWindow: rt.archWindow(),
    };
  });
}

const layout = await page.evaluate(() => {
  const l = window.__museum.layout;
  return { W: l.hallWidth, L: l.hallLength, H: l.wallHeight, rooms: l.rooms, doorways: l.doorways };
});
const shots = {};
const L = layout.L;
shots.entrance = await view("a-entrance", 0, L / 2 - 3.1);
for (let i = 0; i < layout.rooms.length; i++) {
  const r = layout.rooms[i];
  const zc = (r.z0 + r.z1) / 2;
  shots[`room${i + 1}`] = await view(`b-room${i + 1}`, 0, zc + (r.z1 - r.z0) * 0.3, 0.35);
}
for (let i = 0; i < layout.doorways.length; i++) {
  const d = layout.doorways[i];
  shots[`door${i + 1}`] = await view(`c-doorway${i + 1}`, 0.4, d.z + d.thickness / 2 + 2.2, 0.08);
  shots[`back${i + 1}`] = await view(`d-lookback${i + 1}`, -0.3, d.z - d.thickness / 2 - 2.6, Math.PI - 0.1);
}

const summary = { slug, layout, shots, consoleErrors: errs };
fs.writeFileSync(`${OUT}/${prefix}-views.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ slug, rooms: layout.rooms.length, shots, consoleErrors: errs }, null, 1));
await browser.close();
