// Exercise bounded artist floors and real elevator transitions in Chrome.
// VERIFY_REAL_IMAGES=1 uses the artwork hosts; by default images are deterministic fixtures.
// node scripts/check-floors.mjs [baseUrl]
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const realImages = process.env.VERIFY_REAL_IMAGES === "1";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGPoqkqDIwbiOABO0hahD+yEBAAAAABJRU5ErkJggg==", "base64");
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
const results = [];
fs.mkdirSync("verify-artifacts", { recursive: true });

async function ready(page) {
  await page.waitForFunction(() => window.__museum && getComputedStyle(document.querySelector(".doors")).display === "none", null, { timeout: 60000 });
  await page.locator(".mus-click-to-start").waitFor({ timeout: 20000 });
  assert(await page.evaluate(() => window.__museum.layout.rooms.length <= 6));
}

try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on("pageerror", e => errors.push(String(e)));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    page.on("request", r => requests.push(r.url()));
    if (!realImages) await page.route(/^https:\/\/(?:(?:upload|thumb)\.wikimedia\.org|(?:[^/]+\.)?wikiart\.org)\//,
      route => route.fulfill({ status: 200, contentType: "image/png", body: png, headers: { "Access-Control-Allow-Origin": "*" } }));
    await page.addInitScript(() => {
      window.__MUSEUM_DEBUG__ = true;
      let locked = null;
      Object.defineProperty(Document.prototype, "pointerLockElement", { configurable: true, get() { return locked; } });
      const fire = () => queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange")));
      Element.prototype.requestPointerLock = function () { locked = this; fire(); return Promise.resolve(); };
      Document.prototype.exitPointerLock = function () { locked = null; fire(); };
    });
    const response = await page.goto(`${base}/museum/pierre-auguste-renoir`, { waitUntil: "domcontentloaded" });
    assert.equal(response.status(), 200);
    await ready(page);
    const picker = page.getByRole("combobox", { name: "Floor", exact: true });
    const floorCount = await picker.locator("option").count();
    assert(floorCount > 2);
    assert.equal(await picker.inputValue(), "1");
    if (mobile) {
      const nav = await page.getByRole("navigation", { name: "Rooms", exact: true }).boundingBox();
      const guide = await page.locator(".mus-guide").boundingBox();
      assert(guide.y >= nav.y + nav.height, "room navigation and audio controls do not overlap");
      const title = await page.locator(".mus-click-to-start h2").boundingBox();
      assert(title.x >= 0 && title.x + title.width <= 390, "arrival title fits the screen");
    }
    const firstWorks = await page.evaluate(() => window.__museum.layout.placements.map(p => p.painting.slug));
    await page.waitForTimeout(3500);
    assert(!requests.some(url => /\/museum\/pierre-auguste-renoir\/floor\//.test(url)), "no other floors requested before a choice");
    await page.screenshot({ path: `verify-artifacts/floors-${mobile ? "mobile" : "desktop"}-first.png` });

    // Direct access to the last floor avoids dozens of elevator rides in a large collection.
    await picker.selectOption(String(floorCount));
    await page.waitForURL(`**/museum/pierre-auguste-renoir/floor/${floorCount}`, { timeout: 30000 });
    await ready(page);
    assert.equal(await picker.inputValue(), String(floorCount));
    const lastWorks = await page.evaluate(() => window.__museum.layout.placements.map(p => p.painting.slug));
    assert(lastWorks.every(slug => !firstWorks.includes(slug)), "floors contain distinct artworks");
    assert(await page.evaluate(() => window.__museum.layout.elevator !== null));
    await page.screenshot({ path: `verify-artifacts/floors-${mobile ? "mobile" : "desktop"}-last.png` });

    // Back navigation and direct URL reload both reconstruct the right floor.
    await page.goBack();
    await ready(page);
    assert.equal(await picker.inputValue(), "1");
    await picker.selectOption("2");
    await page.waitForURL("**/museum/pierre-auguste-renoir/floor/2", { timeout: 30000 });
    await ready(page);
    await page.reload();
    await ready(page);
    assert.equal(await picker.inputValue(), "2");
    await page.locator(".mus-click-to-start").click();
    if (mobile) {
      await page.getByRole("button", { name: /Elevator by the entrance/i }).click();
    } else await page.keyboard.press("KeyE");
    await page.getByRole("button", { name: /Floor 1 ·/ }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /Floor 1 ·/ }).click();
    await page.waitForURL(`**/museum/pierre-auguste-renoir`, { timeout: 30000 });
    await ready(page);
    assert.equal(await picker.inputValue(), "1");
    assert.deepEqual(errors, []);
    const result = { mobile, floors: floorCount, firstWorks: firstWorks.length, lastWorks: lastWorks.length, errors };
    results.push(result);
    console.log("PASS", JSON.stringify(result));
    await context.close();
  }
  const request = await browser.newContext();
  for (const path of ["/museum/pierre-auguste-renoir/floor/999", "/museum/missing-artist/floor/2", "/museum/mark-rothko/floor/2"]) {
    assert.equal((await request.request.get(base + path)).status(), 404, path);
  }
  await request.close();
  console.log("PASS invalid floors return 404");
} finally {
  await browser.close();
  fs.writeFileSync("verify-artifacts/floors-browser.json", JSON.stringify(results, null, 2));
}
