// One deterministic frame of a gallery for before/after comparisons: the
// visitor at the spawn point looking down the hall, overlay dismissed, every
// texture and the reflection probe settled (no movement, so two builds
// render the same view).
//
//   node scripts/shot-spawn.mjs <slug> <baseUrl> <out.png>
import { chromium } from "playwright";

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

const [slug, base, out] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.addInitScript(POINTER_LOCK_STUB);
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
await page.goto(`${base}/museum/${slug}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".mus-click-to-start", { timeout: 30000 });
await page.locator(".mus-click-to-start").click();
await page.waitForTimeout(9000);
// hide the HUD chrome (music credit, hints) so only the render is compared
await page.addStyleTag({ content: ".mus-hint, .mus-top, [class*='MuseumAudio'], .crosshair { display: none !important; }" });
await page.waitForTimeout(300);
await page.screenshot({ path: out });
console.log(out, "errors:", errs.length);
await browser.close();
