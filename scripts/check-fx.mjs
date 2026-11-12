// Exercise hidden-tools startup and cleanup against a running build.
// FX_CODE=<access phrase> node scripts/check-fx.mjs [baseUrl]
// Headless only: never take control of the user's real mouse pointer.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const code = process.env.FX_CODE;
if (!code) throw new Error("Set FX_CODE to the hidden studio's access phrase.");
const base = process.argv[2] ?? "http://localhost:3000";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGPoqkqDIwbiOABO0hahD+yEBAAAAABJRU5ErkJggg==", "base64");
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });

try {
  for (const mode of process.argv[3] ? [process.argv[3]] : ["fast", "full", "touch"]) {
    const touch = mode === "touch";
    const page = await browser.newPage({ viewport: touch ? { width: 400, height: 860 } : { width: 1440, height: 900 }, hasTouch: touch, isMobile: touch });
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.route(/^https:\/\/(?:(?:upload|thumb)\.wikimedia\.org|(?:[^/]+\.)?wikiart\.org)\//,
      route => route.fulfill({ status: 200, contentType: "image/png", body: png, headers: { "Access-Control-Allow-Origin": "*" } }));
    await page.addInitScript(mode => {
      window.__MUSEUM_DEBUG__ = true;
      // Auto uses the fast tier after walking has proved too slow; Full overrides it.
      localStorage.setItem("timeline-museum:graphics-stepped-down", "1");
      const key = "timeline-museum:settings";
      const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({ ...settings, graphics: mode === "full" ? "full" : "auto" }));
      let locked = null;
      Object.defineProperty(Document.prototype, "pointerLockElement", { configurable: true, get: () => locked });
      const fire = () => queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange")));
      Element.prototype.requestPointerLock = function () { locked = this; fire(); return Promise.resolve(); };
      Document.prototype.exitPointerLock = () => { locked = null; fire(); };
      const stats = window.__fxProbe = { programs: 0, rendered: 0, draws: 0 };
      for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
        if (!C) continue;
        const link = C.prototype.linkProgram;
        C.prototype.linkProgram = function (...args) { stats.programs++; return link.apply(this, args); };
        for (const fn of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
          const draw = C.prototype[fn];
          C.prototype[fn] = function (...args) { stats.draws++; return draw.apply(this, args); };
        }
      }
      let previous = 0;
      const tick = () => { if (stats.draws !== previous) stats.rendered++; previous = stats.draws; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, mode);
    const response = await page.goto(`${base}/museum/caravaggio`);
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => window.__museum && getComputedStyle(document.querySelector(".doors")).display === "none", null, { timeout: 90000 });
    await page.locator(".mus-click-to-start").click();
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => !!window.__fx), false, "the engine stays lazy before unlocking");
    const before = await page.evaluate(() => {
      const lights = [];
      window.__museum.scene.traverse(o => { if (o.isLight) lights.push(o.uuid); });
      return { lights, programs: window.__fxProbe.programs, beacon: window.__museum.scene.getObjectByName("fx-beacon")?.uuid };
    });
    assert(before.beacon, "the dark beacon exists before the gallery warms its shaders");
    if (mode === "fast") {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await page.keyboard.press("p");
    await page.locator("input[data-open=true]").fill(code);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__fx?.engine.isActive && window.__fx.engine.heldOn && window.__fx.engine.rig.group.children.filter(o => o.visible).length <= 1, null, { timeout: 30000 });
    const after = await page.evaluate(() => {
      const lights = [];
      window.__museum.scene.traverse(o => { if (o.isLight) lights.push(o.uuid); });
      return { lights, programs: window.__fxProbe.programs, maxPx: window.__fx.engine.q.maxPx };
    });
    assert.deepEqual(after.lights, before.lights, "unlocking preserves every existing light and its count");
    assert.equal(after.maxPx, mode === "full" ? 2200000 : 650000, "effects follow desktop graphics quality and touch limits");
    // Use the real palette shortcut, then exercise a marker hit and restoration.
    await page.keyboard.press("6");
    await page.evaluate(() => {
      const e = window.__fx.engine;
      const canvas = [...e.canvases.values()].find(c => c.mesh.visible);
      const camera = window.__museum.camera;
      const at = canvas.mesh.getWorldPosition(camera.position.clone());
      const normal = camera.position.clone().set(0, 0, 1).transformDirection(canvas.mesh.matrixWorld);
      camera.position.copy(at).addScaledVector(normal, 1.5);
      camera.lookAt(at);
      camera.updateMatrixWorld();
      // The test teleports between frames; move the held model with the
      // camera before launching so the shot starts on this side of the work.
      e.rig.update(1 / 60, camera);
      e.triggerDown(window.__fx.ndc(0, 0), "marker");
      e.triggerUp();
      window.__museum.invalidate();
    });
    await page.waitForFunction(() => window.__fx.engine.debug().surfaces > 0).catch(async error => {
      console.log("Hit diagnostics", await page.evaluate(() => {
        const e = window.__fx.engine;
        const hit = e.pick(window.__fx.ndc(0, 0));
        return { state: window.__fx.state.get(), debug: e.debug(), enabled: e.heldOn, hit: hit && { canvas: hit.canvas?.key, name: hit.object.name, point: hit.point, front: hit.front } };
      }));
      throw error;
    });
    await page.evaluate(() => window.__fx.state.requestClean());
    await page.waitForFunction(() => !window.__fx.state.get().cleaning && window.__fx.engine.debug().surfaces === 0);
    await page.waitForTimeout(2500);
    const frames = await page.evaluate(() => window.__fxProbe.rendered);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.__fxProbe.rendered), frames, "a restored gallery renders no idle frames with a weapon held");
    await page.keyboard.press("p");
    await page.keyboard.press("p");
    assert.equal(await page.evaluate(() => window.__museum.scene.getObjectByName("fx-beacon").uuid), before.beacon, "reopening reuses the reserved beacon");
    assert.deepEqual(errors, []);
    console.log("PASS", JSON.stringify({ mode, shadersAtUnlock: after.programs - before.programs, maxEffectPixels: after.maxPx, idleFrames: 0 }));
    await page.close();
  }
} finally {
  await browser.close();
}
