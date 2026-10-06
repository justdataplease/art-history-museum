// Behavioural checks for a multi-room suite, in headless Chrome (real GPU):
//
//  1. collision: walking (W held) into each cross wall's solid face stops at
//     the wall; walking at a doorway passes into the next room, also when
//     aimed at a jamb (the visitor slides round it);
//  2. a whole-suite walk reaches the far end, rooms tracked on the way;
//  3. inspect in the last room (crosshair click): the camera's inspect pose
//     stays inside that room; and a click from the doorway on a work in the
//     next room flies through the opening (no sample inside a wall);
//  4. touch: tapping the floor of the next room walks there through the
//     doorway (the path never enters a wall), tapping a cross wall walks to
//     its foot.
//
//   node scripts/suite-check.mjs <slug> [baseUrl] [prefix]
//
// Uses the page's test hook (window.__MUSEUM_DEBUG__). Prints a JSON report
// (and writes it, with screenshots, to verify-artifacts/); exits 1 on a failure.
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
const prefix = process.argv[4] ?? `check-${slug}`;
const OUT = "verify-artifacts";
fs.mkdirSync(`${OUT}/${prefix.split("/").slice(0, -1).join("/") || "."}`, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"],
});
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok: !!ok, ...detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${Object.keys(detail).length ? "  " + JSON.stringify(detail) : ""}`);
};
const errors = [];
/** Run one group of checks; a crash fails it (with the error) and the rest still run. */
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    const msg = String(e?.message ?? e).split(String.fromCharCode(10))[0].trim();
    check(`${name}: ran to the end`, false, { error: msg.slice(0, 300) });
  }
}

async function open(context) {
  const page = await context.newPage();
  await page.addInitScript(POINTER_LOCK_STUB);
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 240)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 240)}`));
  await page.addInitScript(() => {
    window.__MUSEUM_DEBUG__ = true;
  });
  await page.goto(`${base}/museum/${slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".mus-click-to-start", { timeout: 30000 });
  await page.waitForFunction(() => !!window.__museum);
  await page.locator(".mus-click-to-start").click();
  await page.waitForTimeout(800);
  return page;
}

const cam = (page) =>
  page.evaluate(() => {
    const m = window.__museum;
    return { x: m.camera.position.x, y: m.camera.position.y, z: m.camera.position.z, room: m.runtime.currentRoom() };
  });
/** The inspect panel is open (it stays in the DOM, aria-hidden when closed). */
const panelOpen = (page) =>
  page.evaluate(() => document.querySelector(".insp-panel")?.getAttribute("aria-hidden") === "false");
const place = (page, x, z, yaw = 0, pitch = 0) =>
  page.evaluate(
    ({ x, z, yaw, pitch }) => {
      const m = window.__museum;
      m.camera.position.set(x, 1.65, z);
      m.camera.rotation.set(pitch, yaw, 0, "YXZ");
      m.camera.updateMatrixWorld();
      m.invalidate();
    },
    { x, z, yaw, pitch }
  );
async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(250);
}
/** Inside a cross wall's solid part (grown by `r`)? */
const inWall = (layout, p, r = 0) =>
  layout.doorways.some(
    (d) => Math.abs(p.z - d.z) < d.thickness / 2 + r && Math.abs(p.x) > d.halfWidth - r
  );

// ------------------------------------------------------------- desktop
const desk = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await open(desk);
const layout = await page.evaluate(() => {
  const l = window.__museum.layout;
  return { W: l.hallWidth, L: l.hallLength, rooms: l.rooms, doorways: l.doorways, screen: l.screen };
});
check("suite has several rooms", layout.rooms.length > 1, { rooms: layout.rooms.length });

await section("cross walls", async () => {
for (const [i, d] of layout.doorways.entries()) {
  const face = d.z + d.thickness / 2;
  // 1a. straight into the solid wall beside the doorway
  await place(page, 2.6, face + 2.0);
  await hold(page, "KeyW", 1800);
  let p = await cam(page);
  check(`doorway ${i + 1}: cross wall blocks`, p.z >= face + 0.5 && p.z < face + 2.0, { z: +p.z.toFixed(2), face: +face.toFixed(2) });
  // 1b. through the opening
  await place(page, 0.6, face + 2.0);
  await hold(page, "KeyW", 2200);
  p = await cam(page);
  check(`doorway ${i + 1}: walk through the opening`, p.z < d.z - d.thickness / 2 && p.room === i + 1, { z: +p.z.toFixed(2), room: p.room });
  // 1c. aimed at the jamb: slides round it into the opening
  await place(page, d.halfWidth - 0.15, face + 1.5);
  await hold(page, "KeyW", 2200);
  p = await cam(page);
  check(`doorway ${i + 1}: slide past the jamb`, p.z < d.z - d.thickness / 2 && Math.abs(p.x) < d.halfWidth - 0.29, { x: +p.x.toFixed(2), z: +p.z.toFixed(2) });
  // 1d. back the other way, into the wall's far face
  await place(page, -2.6, d.z - d.thickness / 2 - 2.0, Math.PI);
  await hold(page, "KeyW", 1800);
  p = await cam(page);
  check(`doorway ${i + 1}: far face blocks`, p.z <= d.z - d.thickness / 2 - 0.5, { z: +p.z.toFixed(2) });
}
});

// 2. whole suite, end to end, sampling the camera: never inside a wall
// (a long suite's first room has the flagship's screen on the axis: start
// behind it)
await section("whole-suite walk", async () => {
await place(page, 0.8, layout.screen ? layout.screen.z - layout.screen.thickness / 2 - 1.2 : layout.L / 2 - 3);
const rooms = new Set();
let clipped = 0;
await page.keyboard.down("KeyW");
let p = await cam(page);
// (up to ~3 min: a 17-room suite is ~400 m at walking pace)
for (let t = 0; t < 360 && p.z > -layout.L / 2 + 2; t++) {
  await page.waitForTimeout(500);
  p = await cam(page);
  rooms.add(p.room);
  if (inWall(layout, p, 0.25)) clipped++;
}
await page.keyboard.up("KeyW");
check("walk the whole suite", p.z <= -layout.L / 2 + 2 && rooms.size === layout.rooms.length && !clipped, {
  endZ: +p.z.toFixed(2),
  roomsSeen: [...rooms],
  clipped,
});
});

// 3a. inspect in the last room: a side-wall work, from 3 m in front of it
await section("inspect in the last room", async () => {
const last = layout.rooms.length - 1;
const work = await page.evaluate((last) => {
  const ps = window.__museum.layout.placements.filter((q) => q.room === last && Math.abs(q.rotationY) > 0.1);
  const q = ps[Math.floor(ps.length / 2)];
  return { slug: q.painting.slug, x: q.position[0], y: q.position[1], z: q.position[2], rot: q.rotationY };
}, last);
{
  const nx = Math.sin(work.rot);
  // stand 3 m out from the wall, looking at the work's centre
  const sx = work.x + nx * 3;
  const yaw = Math.atan2(-(work.x - sx), 0);
  const pitch = Math.atan2(work.y - 1.65, 3);
  await place(page, sx, work.z, yaw, pitch);
  await page.waitForTimeout(500);
  // collision may have nudged the visitor (a bench, a doorway jamb): aim again
  // from where they actually stand, so a small work isn't missed by a frame edge
  {
    const at = await cam(page);
    const dx = work.x - at.x;
    const dz = work.z - at.z;
    await place(page, at.x, at.z, Math.atan2(-dx, -dz), Math.atan2(work.y - 1.65, Math.hypot(dx, dz)));
    await page.waitForTimeout(300);
  }
  await page.mouse.click(800, 450);
  await page.waitForTimeout(2600);
  const s = await cam(page);
  const panel = await panelOpen(page);
  const room = layout.rooms[last];
  await page.screenshot({ path: `${OUT}/${prefix}-inspect-last-room.png` });
  check("inspect a work in the last room", panel && s.z >= room.z0 && s.z <= room.z1 && Math.abs(s.x) < layout.W / 2, {
    work: work.slug,
    camera: { x: +s.x.toFixed(2), z: +s.z.toFixed(2) },
    room: [+room.z0.toFixed(2), +room.z1.toFixed(2)],
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1800);
}

});

// 3b. the flagship, 7 m in front of it: the pose stays in its room
await section("inspect the flagship", async () => {
  const a = await page.evaluate(() => {
    const q = window.__museum.layout.placements[0];
    return { y: q.position[1], z: q.position[2], room: q.room };
  });
  const room = layout.rooms[a.room];
  // within click range (9 m), between the benches and the side wall
  const sz = a.z + 7;
  await place(page, 0.9, sz, Math.atan2(0.9, sz - a.z), Math.atan2(a.y - 1.65, sz - a.z));
  await page.locator(".mus-click-to-start").click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(2600);
  const s = await cam(page);
  const panel = await panelOpen(page);
  await page.screenshot({ path: `${OUT}/${prefix}-inspect-flagship.png` });
  check("inspect the flagship: pose inside its room", panel && s.z >= room.z0 && s.z <= room.z1, { z: +s.z.toFixed(2) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1800);
});

// 3c. from a doorway, click a work hanging in the next room: the flight
// goes through the opening (sampled every frame)
await section("inspect through a doorway", async () => {
  // a side-wall work past the opening, in sight through it and in click
  // range (9 m) from just in front of the doorway: the last doorway that has
  // one (a suite whose last room hangs only big canvases far down the walls
  // may have none in range there; Titian's)
  const sx = 0;
  const pick = (d, sz) => page.evaluate(
    ({ d, sz }) => {
      const zb = d.z - d.thickness / 2;
      const ps = window.__museum.layout.placements
        .filter((q) => Math.abs(q.rotationY) > 0.1 && q.position[2] < zb - 1)
        .map((q) => {
          const depth = sz - q.position[2];
          // where the line of sight crosses the far face of the doorway
          const xAt = (q.position[0] * (sz - zb)) / depth;
          return { q, dist: Math.hypot(q.position[0], depth), xAt };
        })
        .filter((c) => c.dist < 8.6 && Math.abs(c.xAt) < d.halfWidth - 0.15)
        .sort((a, b) => b.dist - a.dist);
      const q = ps[0]?.q;
      return q ? { slug: q.painting.slug, x: q.position[0], y: q.position[1], z: q.position[2] } : null;
    },
    { d, sz }
  );
  let d = null;
  let sz = 0;
  let target = null;
  for (let i = layout.doorways.length - 1; i >= 0 && !target; i--) {
    for (const off of [0.6, 0.3, 1.0]) {
      d = layout.doorways[i];
      sz = d.z + d.thickness / 2 + off;
      target = await pick(d, sz);
      if (target) break;
    }
  }
  if (!target) throw new Error("no work in click range through any doorway");
  const yaw = Math.atan2(-(target.x - sx), -(target.z - sz));
  const dist = Math.hypot(target.x - sx, target.z - sz);
  await place(page, sx, sz, yaw, Math.atan2(target.y - 1.65, dist));
  await page.locator(".mus-click-to-start").click().catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const m = window.__museum;
    window.__flight = [];
    const tick = () => {
      const c = m.camera.position;
      window.__flight.push({ x: c.x, z: c.z });
      if (window.__flight.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.click(800, 450);
  await page.waitForTimeout(3200);
  const flight = await page.evaluate(() => window.__flight);
  const s = await cam(page);
  const panel = await panelOpen(page);
  const bad = flight.filter((q) => inWall(layout, q, 0.05)).length;
  await page.screenshot({ path: `${OUT}/${prefix}-inspect-through-doorway.png` });
  check("inspect through a doorway: flight clears the walls", panel && bad === 0 && s.z < d.z, {
    work: target.slug,
    samples: flight.length,
    insideWall: bad,
    end: { x: +s.x.toFixed(2), z: +s.z.toFixed(2) },
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(2600);
  const back = await cam(page);
  check("fly back from it to the doorway", Math.abs(back.z - sz) < 0.05 && Math.abs(back.x - sx) < 0.05, {
    z: +back.z.toFixed(2),
  });
});
// 5. the room navigator: ] / PageUp, and the HUD's room list; each jump
// lands just inside the room's doorway, facing into it, clear of every wall
await section("room navigator", async () => {
  const landed = async (room) => {
    const s = await page.evaluate(() => {
      const m = window.__museum;
      const e = m.camera.rotation;
      return { x: m.camera.position.x, z: m.camera.position.z, yaw: e.y, room: m.runtime.currentRoom() };
    });
    const r = layout.rooms[room];
    const ok = s.room === room && s.z < r.z1 && s.z > r.z0 && Math.abs(s.yaw) < 0.01 && !inWall(layout, s, 0.25);
    return { ok, ...s };
  };
  await page.locator(".mus-click-to-start").click().catch(() => {});
  await page.waitForTimeout(400);
  const start = await page.evaluate(() => window.__museum.runtime.currentRoom());
  const to = start + 1 < layout.rooms.length ? start + 1 : start - 1;
  await page.keyboard.press(to > start ? "BracketRight" : "BracketLeft");
  await page.waitForTimeout(1400);
  let l = await landed(to);
  check(`navigator: ${to > start ? "]" : "["} jumps to room ${to + 1}`, l.ok, l);
  await page.keyboard.press("PageUp");
  await page.waitForTimeout(1400);
  l = await landed(to - 1);
  check(`navigator: PageUp back to room ${to}`, l.ok, l);
  // unlocked: the overlay is up, the navigator above it stays clickable
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForTimeout(600);
  const navBtn = page.locator('nav[aria-label="Rooms"] button[aria-haspopup="listbox"]');
  await navBtn.click();
  await page.waitForTimeout(300);
  const items = page.locator('nav[aria-label="Rooms"] [role="listbox"] > [role="option"]');
  const count = await items.count();
  // the open list: focus on the current room's option, which is aria-current
  const focusOk = await page.evaluate(() => {
    const a = document.activeElement;
    return !!a && a.getAttribute("role") === "option" && a.getAttribute("aria-current") === "location";
  });
  check("navigator list: options are direct children, focus on the current room", count === layout.rooms.length && focusOk, { items: count });
  // Esc closes it and gives focus back to the button
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const escOk = await page.evaluate(() => {
    const a = document.activeElement;
    return !document.querySelector('nav[aria-label="Rooms"] [role="listbox"]') && a?.getAttribute("aria-haspopup") === "listbox";
  });
  check("navigator list: Esc closes it, focus back on the button", escOk);
  // a click outside closes it too
  await navBtn.click();
  await page.waitForTimeout(200);
  await page.mouse.click(40, 860);
  await page.waitForTimeout(200);
  check("navigator list: a click outside closes it", (await page.locator('nav[aria-label="Rooms"] [role="listbox"]').count()) === 0);
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForTimeout(400);
  // keyboard: open with the button, End, Enter: the last room
  await navBtn.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);
  l = await landed(layout.rooms.length - 1);
  const kept = await page.evaluate(() => document.activeElement?.getAttribute("aria-haspopup") === "listbox");
  check("navigator list: jump to the last room (keyboard), focus kept", l.ok && kept, { kept, ...l });
  await page.screenshot({ path: `${OUT}/${prefix}-navigator-last-room.png` });
});
await desk.close();

// ---------------------------------------------------------------- touch
const touch = await browser.newContext({ viewport: { width: 900, height: 1100 }, hasTouch: true, isMobile: true });
const tp = await open(touch);
const isTouch = await tp.evaluate(() => matchMedia("(pointer: coarse)").matches);
check("touch mode active", isTouch);

/** Screen position of a floor point (x, z). */
const screenOf = (page, x, z) =>
  page.evaluate(
    ({ x, z }) => {
      const m = window.__museum;
      const v = m.camera.position.clone().set(x, 0, z).project(m.camera);
      const r = document.querySelector("canvas").getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, ok: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 };
    },
    { x, z }
  );
async function tapAndTrack(page, x, z, ms = 9000) {
  const s = await screenOf(page, x, z);
  await page.evaluate(() => {
    const m = window.__museum;
    window.__path = [];
    const t0 = performance.now();
    const tick = () => {
      const c = m.camera.position;
      window.__path.push({ x: c.x, z: c.z });
      if (performance.now() - t0 < 12000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.touchscreen.tap(s.x, s.y);
  await page.waitForTimeout(ms);
  return { screen: s, path: await page.evaluate(() => window.__path), end: await cam(page) };
}

await section("touch: tap-to-walk", async () => {
for (const [i, d] of layout.doorways.entries()) {
  // stand off to the side of the doorway, tap the next room's floor beyond it
  const sz = d.z + d.thickness / 2 + 3.2;
  await place(tp, -2.2, sz, -0.15, -0.32);
  await tp.waitForTimeout(500);
  const tx = 0.6;
  const tz = d.z - d.thickness / 2 - 3.5;
  const r = await tapAndTrack(tp, tx, tz);
  const bad = r.path.filter((q) => inWall(layout, q, 0.05)).length;
  const crossing = r.path.filter((q) => Math.abs(q.z - d.z) < d.thickness / 2);
  check(`tap-to-walk through doorway ${i + 1}`, r.screen.ok && bad === 0 && Math.hypot(r.end.x - tx, r.end.z - tz) < 0.3 && r.end.room === i + 1, {
    end: { x: +r.end.x.toFixed(2), z: +r.end.z.toFixed(2) },
    target: { x: tx, z: +tz.toFixed(2) },
    crossingX: crossing.length ? [+Math.min(...crossing.map((q) => q.x)).toFixed(2), +Math.max(...crossing.map((q) => q.x)).toFixed(2)] : null,
    insideWall: bad,
  });
}
});
await section("touch: tap a cross wall", async () => {
  // tap on the cross wall itself: walk up to its foot (the last doorway:
  // no flagship screen in front of it)
  const d = layout.doorways[layout.doorways.length - 1];
  const before = layout.doorways.length - 1;
  const sz = d.z + d.thickness / 2 + 6;
  await place(tp, 0, sz, 0, -0.05);
  await tp.waitForTimeout(400);
  const wall = await tp.evaluate(
    ({ z }) => {
      const m = window.__museum;
      const v = m.camera.position.clone().set(-1.9, 1.0, z).project(m.camera);
      const r = document.querySelector("canvas").getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
    { z: d.z + d.thickness / 2 }
  );
  await tp.touchscreen.tap(wall.x, wall.y);
  await tp.waitForTimeout(6000);
  const e = await cam(tp);
  check("tap on a cross wall walks to its foot", e.room === before && e.z > d.z + d.thickness / 2 && e.z < d.z + d.thickness / 2 + 1.2, {
    end: { x: +e.x.toFixed(2), z: +e.z.toFixed(2) },
  });
});
await tp.screenshot({ path: `${OUT}/${prefix}-touch.png` });
await touch.close();

check("no console errors", errors.length === 0, { errors });
const report = { slug, layout: { rooms: layout.rooms.length, doorways: layout.doorways }, results };
fs.writeFileSync(`${OUT}/${prefix}-check.json`, JSON.stringify(report, null, 2));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
