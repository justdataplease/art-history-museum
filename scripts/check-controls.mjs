// Run against a production preview: node scripts/check-controls.mjs [baseUrl]
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"],
});
const errors = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGPoqkqDIwbiOABO0hahD+yEBAAAAABJRU5ErkJggg==", "base64");
fs.mkdirSync("verify-artifacts", { recursive: true });
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.addInitScript(() => localStorage.setItem("timeline-museum:welcome-seen:v1", "1"));
  await desktop.goto(base, { waitUntil: "domcontentloaded" });
  await desktop.waitForFunction(() => document.querySelectorAll(".ax-label").length > 2);
  const range = () => desktop.locator('.tl-year-track input').evaluateAll(inputs => inputs.map(input => input.value));
  const initialYears = await range();
  assert.deepEqual(initialYears, ["1500", String(new Date().getFullYear())]);
  const firstBand = desktop.locator(".band").first();
  const initialY = (await firstBand.boundingBox()).y;
  await desktop.mouse.move(720, 450);
  await desktop.mouse.wheel(0, 220);
  await desktop.waitForTimeout(200);
  assert.deepEqual(await range(), initialYears);
  assert((await firstBand.boundingBox()).y < initialY - 30, "wheel down moves the wall up");
  await desktop.mouse.wheel(0, -220);
  await desktop.waitForTimeout(200);
  assert.deepEqual(await range(), initialYears);
  assert(Math.abs((await firstBand.boundingBox()).y - initialY) < 2, "wheel up returns to the earlier vertical position");
  await desktop.keyboard.down("Control");
  await desktop.mouse.wheel(0, -80);
  await desktop.keyboard.up("Control");
  await desktop.waitForTimeout(200);
  const zoomed = (await range()).map(Number);
  assert(zoomed[1] - zoomed[0] < Number(initialYears[1]) - Number(initialYears[0]), "Ctrl+wheel remains an explicit zoom gesture");
  console.log("PASS wheel scrolls vertically both ways, preserves years, and keeps deliberate Ctrl+wheel zoom");
  await desktop.close();

  for (const [width, height] of [[390, 844], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
    await context.route(/(upload|thumb)\.wikimedia\.org/, route => route.fulfill({ contentType: "image/png", body: png }));
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { window.__MUSEUM_DEBUG__ = true; });
    await page.goto(`${base}/museum/johannes-vermeer`, { waitUntil: "domcontentloaded" });
    await page.locator(".mus-click-to-start").waitFor({ state: "visible", timeout: 45000 });
    await page.locator(".mus-click-to-start").click();
    const move = page.locator('[data-touch-stick="move"]');
    const look = page.locator('[data-touch-stick="look"]');
    await move.waitFor({ state: "visible" });
    await look.waitFor({ state: "visible" });
    await page.waitForTimeout(200);
    const snapshot = () => page.evaluate(() => {
      const { camera } = window.__museum;
      return { pos: camera.position.toArray(), dir: camera.getWorldDirection(camera.position.clone()).toArray(), q: camera.quaternion.toArray() };
    });
    const origin = await snapshot();
    const reset = async () => {
      await page.evaluate(pos => {
        const { camera, invalidate } = window.__museum;
        camera.position.fromArray(pos);
        camera.rotation.set(0, 0, 0, "YXZ");
        camera.updateMatrixWorld();
        invalidate();
      }, origin.pos);
      await page.waitForTimeout(120);
    };
    const cdp = await context.newCDPSession(page);
    const startSticks = async (pushes) => {
      const points = [];
      for (const [mode, dx, dy] of pushes) {
        const b = await page.locator(`[data-touch-stick="${mode}"]`).boundingBox();
        assert(b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= height, "stick stays in viewport");
        points.push({ id: points.length + 1, x: b.x + b.width / 2, y: b.y + b.height / 2, dx, dy });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.map(({ id, x, y }) => ({ id, x, y })) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points.map(({ id, x, y, dx, dy }) => ({ id, x: x + dx, y: y + dy })) });
      assert.equal(await page.locator('[data-touch-stick][data-active="true"]').count(), pushes.length);
    };
    const release = async (type = "touchEnd") => {
      await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [] });
      await page.waitForTimeout(150);
      assert.equal(await page.locator('[data-touch-stick][data-active="true"]').count(), 0);
      const a = await snapshot();
      await page.waitForTimeout(250);
      const b = await snapshot();
      assert(distance(a.pos, b.pos) < 0.001 && distance(a.q, b.q) < 0.001, "release stops movement and camera drift");
    };

    await reset();
    await startSticks([["move", 0, -36]]);
    await page.waitForTimeout(450);
    let state = await snapshot();
    assert(state.pos[2] < origin.pos[2] - 0.1, "left stick walks forward");
    assert(Math.abs(state.dir[0]) < 0.01 && Math.abs(state.dir[1]) < 0.01, "movement stick does not tilt camera");
    await release();

    await reset();
    await startSticks([["look", 36, 0]]);
    await page.waitForTimeout(450);
    state = await snapshot();
    assert(state.dir[0] > 0.05, "right-stick right looks right");
    assert(distance(state.pos, origin.pos) < 0.001, "looking does not walk");
    await release();

    await reset();
    await startSticks([["look", 0, -42]]);
    await page.waitForTimeout(2500);
    state = await snapshot();
    assert(state.dir[1] > 0.5 && state.dir[1] <= Math.sin(1.25) + 0.001, "up looks up and pitch stays bounded");
    await release("touchCancel");

    await reset();
    await startSticks([["move", 0, -36], ["look", 28, 0]]);
    await page.waitForTimeout(550);
    state = await snapshot();
    assert(distance(state.pos, origin.pos) > 0.1 && state.dir[0] > 0.05, "two thumbs move and turn simultaneously");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await release();

    await reset();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: width / 2, y: height / 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: width / 2 + 50, y: height / 2 - 30 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    state = await snapshot();
    assert(state.dir[0] > 0.05 && state.dir[1] > 0.05, "dragging right and up looks right and up");

    const music = page.locator('[data-music-toggle]');
    if (await music.count()) {
      const a = await music.boundingBox(), b = await look.boundingBox();
      assert(!a || a.y + a.height <= b.y - 18 || a.x + a.width <= b.x || a.x >= b.x + b.width, "music clears look stick and its label");
    }
    await page.screenshot({ path: `verify-artifacts/dual-sticks-${width}x${height}.png` });
    console.log(`PASS ${width}x${height}: movement, camera direction, pitch limit, two-thumb input, release/cancel/blur, drag direction and layout`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("PASS no browser errors");
} finally {
  await browser.close();
}
