// Drive the running app in real Chrome and capture evidence screenshots.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "verify-artifacts";
fs.mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const failedRequests = [];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
});
page.on("requestfailed", (req) => {
  failedRequests.push(`${req.failure()?.errorText} ${req.url().slice(0, 140)}`);
});

function log(s) {
  console.log("STEP: " + s);
}

// ---- 1. timeline, Gallery Wall zoomed out ----
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const bands = await page.locator(".band").count();
log(`gallery wall bands rendered: ${bands}`);
const ticks = await page.locator(".tl-axis .tick").count();
log(`axis ticks: ${ticks}`);
await page.screenshot({ path: `${OUT}/1-wall-zoomed-out.png` });

// ---- 2. wheel-zoom into Baroque (~1650). Find its x by evaluating ----
const center = { x: 800, y: 480 };
// zoom toward year 1650: position mouse where Baroque band is
await page.mouse.move(center.x, center.y);
for (let i = 0; i < 18; i++) {
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(70);
}
await page.waitForTimeout(1800);
let nodes = await page.locator(".artist-node").count();
log(`artist nodes visible after zoom: ${nodes}`);
await page.screenshot({ path: `${OUT}/2-wall-zoomed-in.png` });

// ---- 3. click an artist node -> placard card ----
if (nodes === 0) {
  // pan a bit and retry
  await page.mouse.move(800, 480);
  await page.mouse.down();
  await page.mouse.move(400, 480, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  nodes = await page.locator(".artist-node").count();
  log(`artist nodes after pan: ${nodes}`);
}
if (nodes > 0) {
  // click the first node actually on screen
  let target = null;
  for (const el of await page.locator(".artist-node").all()) {
    const box = await el.boundingBox();
    if (box && box.x > 40 && box.x + box.width < 1560 && box.y > 100 && box.y < 820) {
      target = el;
      break;
    }
  }
  if (!target) {
    log("no on-screen artist node found");
    process.exit(1);
  }
  await target.click();
  await page.waitForTimeout(1400);
  const cardVisible = await page.locator(".card").isVisible();
  const cardName = cardVisible
    ? await page.locator(".card-name").innerText()
    : "(none)";
  log(`artist card visible: ${cardVisible} name: ${cardName}`);
  await page.screenshot({ path: `${OUT}/3-artist-card.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
}

// ---- 4. switch views (zoom back out first for full-sweep screenshots) ----
await page.mouse.move(800, 480);
for (let i = 0; i < 20; i++) {
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(50);
}
await page.waitForTimeout(900);
await page.getByRole("button", { name: "Star Map" }).click();
await page.waitForTimeout(1200);
log("switched to star map");
await page.screenshot({ path: `${OUT}/4-star-map.png` });

await page.getByRole("button", { name: "The River" }).click();
await page.waitForTimeout(1200);
const streams = await page.locator(".stream").count();
log(`river streams rendered: ${streams}`);
await page.screenshot({ path: `${OUT}/5-river.png` });

// ---- 5. filter dropdown ----
await page.getByRole("button", { name: "Explore" }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/6-filter-dropdown.png` });
const items = await page.locator(".filter-item").count();
log(`filter items (periods tab): ${items}`);
await page.keyboard.press("Escape");

// ---- 6. museum page ----
await page.goto("http://localhost:3000/museum/caravaggio", {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/7-museum-doors.png` });
log("doors screenshot taken");
// wait for doors to open + textures
await page.waitForTimeout(15000);
const hasCanvas = await page.locator("canvas").count();
const startVisible = await page.locator(".mus-click-to-start").isVisible().catch(() => false);
log(`webgl canvas count: ${hasCanvas}, click-to-start overlay: ${startVisible}`);
await page.screenshot({ path: `${OUT}/8-museum-gallery.png` });

// ---- 7. probe: enter pointer lock and walk forward, then click to inspect ----
if (startVisible) {
  await page.locator(".mus-click-to-start").click();
  await page.waitForTimeout(900);
}
const locked = await page.evaluate(() => document.pointerLockElement !== null);
log(`pointer locked: ${locked}`);
if (locked) {
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(2500);
  await page.keyboard.up("KeyW");
  // turn right toward a wall painting (horizontal delta only, keep pitch level)
  await page.mouse.move(800, 450);
  await page.mouse.move(1290, 450, { steps: 8 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/9-museum-walked.png` });
  // click to inspect whatever is aimed
  await page.mouse.click(800, 450);
  await page.waitForTimeout(2600);
  const panelX = await page
    .locator(".insp-panel")
    .evaluate((el) => getComputedStyle(el).transform);
  log(`inspect panel transform after click: ${panelX}`);
  await page.screenshot({ path: `${OUT}/10-museum-inspect.png` });
}

// ---- 8. wikimedia request audit ----
const wikiFails = failedRequests.filter((r) => r.includes("wikimedia"));
log(`console errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 12).forEach((e) => console.log("  CONSOLE-ERR: " + e));
log(`failed requests: ${failedRequests.length} (wikimedia: ${wikiFails.length})`);
failedRequests.slice(0, 12).forEach((e) => console.log("  REQ-FAIL: " + e));

await browser.close();
console.log("DONE");
