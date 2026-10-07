// Hunt for console errors/warnings across the whole app flow.
//   node scripts/error-sweep.mjs [baseUrl]
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";

const messages = [];
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
// Never take a real pointer lock: on Windows even a headless Chrome's lock can
// trap the user's mouse. The stub keeps the app's pointer-lock flow working.
await page.addInitScript(() => {
  let locked = null;
  Object.defineProperty(Document.prototype, "pointerLockElement", { configurable: true, get() { return locked; } });
  const fire = () => queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange")));
  Element.prototype.requestPointerLock = function () { locked = this; fire(); return Promise.resolve(); };
  Document.prototype.exitPointerLock = function () { locked = null; fire(); };
});
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning")
    messages.push(`[${msg.type()}] ${msg.text().slice(0, 260)}`);
});
page.on("pageerror", (err) => messages.push(`[pageerror] ${String(err).slice(0, 260)}`));
page.on("requestfailed", (req) => {
  if (!req.url().includes("kaspersky") && req.failure()?.errorText !== "net::ERR_ABORTED")
    messages.push(`[reqfail] ${req.failure()?.errorText} ${req.url().slice(0, 120)}`);
});

const mark = (s) => console.log("== " + s + ` (msgs so far: ${messages.length})`);

// full timeline flow
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
mark("timeline loaded");

// zoom in/out hard
await page.mouse.move(800, 480);
for (let i = 0; i < 25; i++) await page.mouse.wheel(0, -260);
await page.waitForTimeout(900);
for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 300);
await page.waitForTimeout(900);
mark("zoom stress");

// all views
for (const v of ["Star Map", "Gallery Wall"]) {
  await page.getByRole("button", { name: v }).click();
  await page.waitForTimeout(800);
}
mark("view switches");

// A known artist keeps the gallery-entry path stable as the catalogue grows.
await page.getByRole("button", { name: "Explore" }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: "Artists" }).click();
await page.waitForTimeout(500);
await page.locator(".filter-search input").fill("Caravaggio");
await page.locator(".filter-item").filter({ hasText: "Caravaggio" }).click();
await page.waitForTimeout(1600);
mark("filter artist");

// open a card via filtered node, then ENTER THE GALLERY (real flow)
await page.locator('.artist-node[data-slug="caravaggio"]').click();
mark("card opened");
{
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Enter the Gallery/i }).click();
  await page.waitForURL(/\/museum\//, { timeout: 15000 });
  mark("entered museum via card: " + page.url());
  await page.waitForTimeout(14000);
  mark("museum settled");
  // lock, walk, inspect, esc, relock quickly (pointer-lock cooldown probe)
  const start = page.locator(".mus-click-to-start");
  if (await start.isVisible().catch(() => false)) {
    await start.click();
    await page.waitForTimeout(800);
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(1500);
    await page.keyboard.up("KeyW");
    await page.mouse.move(800, 450);
    await page.mouse.move(1290, 450, { steps: 8 });
    await page.waitForTimeout(400);
    await page.mouse.click(800, 450);
    await page.waitForTimeout(2200);
    mark("inspect attempt");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    // quick relock attempt (this is where pointer-lock cooldown errors appear)
    await page.mouse.click(800, 450);
    await page.waitForTimeout(1500);
    mark("esc + quick relock");
  }
}

// Thin and dense collections, worldwide room styles and painted screens.
for (const slug of ["willem-de-kooning", "david-hockney", "vincent-van-gogh", "rembrandt", "shen-zhou", "hokusai", "reza-abbasi", "maruyama-okyo"]) {
  await page.goto(`${BASE}/museum/${slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(13000);
  mark("museum " + slug);
}

console.log("\n---- captured messages ----");
const uniq = [...new Set(messages)];
uniq.forEach((m) => console.log(m));
console.log(`total: ${messages.length}, unique: ${uniq.length}`);
await browser.close();
if (messages.some((m) => /^\[(error|pageerror)\]/.test(m))) process.exitCode = 1;
