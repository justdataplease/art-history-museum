// Capture the museum realism pass: doors, hall, placard close-up, inspect.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "verify-artifacts";
fs.mkdirSync(OUT, { recursive: true });
const slug = process.argv[2] ?? "caravaggio";
const prefix = process.argv[3] ?? "r";
const base = process.argv[4] ?? "http://localhost:3000";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));

await page.goto(`${base}/museum/${slug}`, { waitUntil: "domcontentloaded" });
// catch the doors mid-swing (opening starts ~earliest 1.6s after settle)
await page.waitForTimeout(4200);
await page.screenshot({ path: `${OUT}/${prefix}1-doors-mid.png` });
await page.waitForTimeout(11000);
await page.screenshot({ path: `${OUT}/${prefix}2-hall.png` });

const start = page.locator(".mus-click-to-start");
if (await start.isVisible().catch(() => false)) {
  await start.click();
  await page.waitForTimeout(700);
}
// walk toward a side painting and angle at the placard
await page.keyboard.down("KeyW");
await page.waitForTimeout(2100);
await page.keyboard.up("KeyW");
await page.mouse.move(800, 450);
await page.mouse.move(1230, 470, { steps: 8 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/${prefix}3-painting-label.png` });
// inspect
await page.mouse.click(800, 450);
await page.waitForTimeout(2600);
await page.screenshot({ path: `${OUT}/${prefix}4-inspect.png` });

console.log("console errors:", errs.length);
errs.forEach((e) => console.log("  ", e));
await browser.close();
