// A recreated building (src/lib/spaces.ts) checked as a visitor meets it: its plan (every room reached from every
// other, the way in on standing ground, seats clear of walls, every work on a wall of its own room under the
// cornice), then every open door walked through from one room into the next, and a walk at each room's walls
// (one must end inside the room).
//
//   node scripts/check-space.mjs <slug> [baseUrl=http://localhost:3000]
//
// Headless and silent: the audio is muted and the pointer lock is faked (a real one clips the user's cursor).
import { chromium } from "playwright";

const [slug = "louvre", base = "http://localhost:3000"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
let failed = 0;
const check = (ok, what) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    window.__MUSEUM_DEBUG__ = true;
    let locked = null;
    Object.defineProperty(Document.prototype, "pointerLockElement", { configurable: true, get() { return locked; } });
    const fire = () => queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange")));
    Element.prototype.requestPointerLock = function () { locked = this; fire(); return Promise.resolve(); };
    Document.prototype.exitPointerLock = function () { locked = null; fire(); };
  });
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 300)));
  page.on("response", (r) => r.status() >= 400 && errs.push(`HTTP ${r.status()} ${decodeURIComponent(r.url()).slice(0, 160)}`));
  await page.goto(`${base}/museums/${slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__museum, null, { timeout: 180000 });
  await page.locator(".mus-click-to-start").waitFor({ timeout: 180000 });

  // ---- the plan itself
  const plan = await page.evaluate(() => {
    const L = window.__museum.layout;
    const P = L.plan;
    if (!P) return null;
    const inside = (b, x, z, pad = 0) => x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad;
    const out = { shells: P.shells.map((s) => ({ id: s.id, x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1 })), hops: true, entry: false, seats: 0, seatsBad: 0, works: {}, hung: 0, off: [], doors: [] };
    for (const row of P.hops) for (const h of row) if (!Number.isFinite(h)) out.hops = false;
    out.entry = P.allowed.some((b) => inside(b, P.entry.spawnX, P.entry.spawnZ));
    for (const f of L.furniture) {
      const sh = P.zones[f.room].shell;
      const hit = P.partitions.some((p) => p.shell === sh && inside(p, f.position[0], f.position[1], 0.6));
      out.seats++;
      if (hit || !P.allowed.some((b) => inside(b, f.position[0], f.position[1]))) out.seatsBad++;
    }
    for (const pl of L.placements) {
      const sh = P.shells[P.zones[pl.room].shell];
      out.works[sh.id] = (out.works[sh.id] || 0) + 1;
      out.hung++;
      const [x, y, z] = pl.position;
      const onRoom = Math.min(Math.abs(x - sh.x0), Math.abs(x - sh.x1), Math.abs(z - sh.z0), Math.abs(z - sh.z1)) < 0.06;
      const onFree = P.partitions.some((p) => !p.plinth && inside(p, x, z, 0.06));
      if (!(onRoom || onFree) || y + pl.h / 2 > sh.height - 0.05 || y - pl.h / 2 < 0.3) out.off.push(pl.painting.title);
    }
    for (const d of P.doors) {
      if (d.bay || d.b < 0) continue;
      const a = P.shells[P.zones[d.a].shell];
      const b = P.shells[P.zones[d.b].shell];
      // from 2.4 m inside the room the door is named in, on the door's axis, toward the room beyond
      const start = d.side === "n" ? [d.at, d.box.z1 + 2.4] : d.side === "s" ? [d.at, d.box.z0 - 2.4] : d.side === "w" ? [d.box.x1 + 2.4, d.at] : [d.box.x0 - 2.4, d.at];
      const yaw = d.side === "n" ? 0 : d.side === "s" ? Math.PI : d.side === "w" ? Math.PI / 2 : -Math.PI / 2;
      out.doors.push({ from: a.id, to: b.id, toShell: b.index, start, yaw, depth: Math.max(d.box.x1 - d.box.x0, d.box.z1 - d.box.z0) });
    }
    return out;
  });
  if (!plan) throw new Error(`${slug} is not a recreated building (its room has no space)`);
  check(plan.hops, `every room can be reached from every other (${plan.shells.length} rooms)`);
  check(plan.entry, "the way in ends on standing ground");
  check(plan.seatsBad === 0, `seats stand clear of walls (${plan.seats})`);
  check(plan.off.length === 0, `every work on a wall of its room, under the cornice (${plan.hung} hung: ${JSON.stringify(plan.works)})${plan.off.length ? ": " + plan.off.slice(0, 4).join("; ") : ""}`);

  // ---- walking
  await page.locator(".mus-click-to-start").click();
  await page.waitForTimeout(2500);
  const walk = async (x, z, yaw, ms) => {
    await page.evaluate(({ x, z, yaw }) => {
      const m = window.__museum;
      m.camera.position.set(x, 1.65, z);
      m.camera.rotation.set(0, yaw, 0, "YXZ");
      m.invalidate();
    }, { x, z, yaw });
    await page.waitForTimeout(600);
    await page.keyboard.down("w");
    await page.waitForTimeout(ms);
    await page.keyboard.up("w");
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const m = window.__museum;
      const P = m.layout.plan;
      const { x, z } = m.camera.position;
      const shell = P.shells.findIndex((s) => x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1);
      return { x: +x.toFixed(2), z: +z.toFixed(2), shell };
    });
  };
  for (const d of plan.doors) {
    const p = await walk(d.start[0], d.start[1], d.yaw, 4200 + d.depth * 700);
    check(p.shell === d.toShell, `door ${d.from} -> ${d.to}: through (ends at ${p.x}, ${p.z})`);
  }
  // at each room's four walls from its middle: one ends inside the room (or through a door, in another room)
  for (const s of plan.shells) {
    const cx = (s.x0 + s.x1) / 2;
    const cz = (s.z0 + s.z1) / 2;
    let stopped = 0;
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const p = await walk(cx, cz, yaw, 2500);
      if (p.shell >= 0 || plan.doors.length) stopped += p.shell >= 0 ? 1 : 0;
    }
    check(stopped >= 3, `${s.id}: its walls stop a walk (${stopped} of 4 walks ended in a room)`);
  }
  check(errs.length === 0, `no console or network errors${errs.length ? ": " + [...new Set(errs)].slice(0, 4).join(" | ") : ""}`);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
