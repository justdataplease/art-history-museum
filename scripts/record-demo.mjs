// Record a video walkthrough of the app: timeline → artist card → gallery →
// inspect → a second era's gallery. Frames come from the DevTools screencast
// (with their real timestamps) and are encoded to constant-30fps H.264.
//
//   node scripts/record-demo.mjs [baseUrl] [out.mp4]
//
// Needs an ffmpeg with libx264: set FFMPEG=/path/to/ffmpeg (or have it on PATH).
// Run against a production build (`npm run build && npm start`) so the dev
// overlay isn't in the shot.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const out = path.resolve(process.argv[3] ?? "demo/museum-demo.mp4");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const W = 1600;
const H = 900;

const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), "museum-demo-"));
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });

// A visible cursor for the parts where we click around (headless draws none).
await page.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.id = "__demo-cursor";
    Object.assign(dot.style, {
      position: "fixed", left: "0", top: "0", width: "22px", height: "22px",
      margin: "-11px 0 0 -11px", borderRadius: "50%", zIndex: "2147483647",
      pointerEvents: "none", background: "rgba(255,255,255,0.55)",
      border: "2px solid rgba(40,30,20,0.75)", boxShadow: "0 1px 6px rgba(0,0,0,0.35)",
      transition: "transform 120ms ease, opacity 200ms ease", opacity: "0",
    });
    document.body.appendChild(dot);
    addEventListener("mousemove", (e) => {
      dot.style.left = e.clientX + "px";
      dot.style.top = e.clientY + "px";
      dot.style.opacity = document.pointerLockElement ? "0" : "1";
    }, true);
    addEventListener("mousedown", () => (dot.style.transform = "scale(0.7)"), true);
    addEventListener("mouseup", () => (dot.style.transform = "scale(1)"), true);
    document.addEventListener("pointerlockchange", () => {
      dot.style.opacity = document.pointerLockElement ? "0" : "1";
    });
  });
});

// ---- screencast capture ----
const cdp = await page.context().newCDPSession(page);
const frames = [];
let recording = false;
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  if (!recording) return;
  const file = path.join(frameDir, `f${String(frames.length).padStart(6, "0")}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  frames.push({ file, t: metadata.timestamp });
});

const wait = (ms) => page.waitForTimeout(ms);
async function glide(x0, y0, x1, y1, ms = 700) {
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const e = f * f * (3 - 2 * f);
    await page.mouse.move(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e);
    await wait(ms / steps);
  }
}
let mx = W / 2;
let my = H / 2;
async function moveTo(x, y, ms = 700) {
  await glide(mx, my, x, y, ms);
  mx = x;
  my = y;
}
async function zoom(deltaTotal, steps = 24, gap = 45) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, deltaTotal / steps);
    await wait(gap);
  }
}
async function clickLocator(loc, ms = 650) {
  const box = await loc.boundingBox();
  if (!box) return false;
  await moveTo(box.x + box.width / 2, box.y + box.height / 2, ms);
  await wait(180);
  await page.mouse.click(mx, my);
  return true;
}
async function waitDoors() {
  await page.waitForFunction(() => {
    const d = document.querySelector(".doors");
    return !d || getComputedStyle(d).display === "none";
  }, null, { timeout: 40000 }).catch(() => {});
}
async function walk(key, ms) {
  await page.keyboard.down(key);
  await wait(ms);
  await page.keyboard.up(key);
}
async function look(dx, dy, ms = 900) {
  // PointerLockControls reads movementX/Y; the CDP mouse supplies them.
  const steps = Math.round(ms / 16);
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(mx + (dx * (i + 1)) / steps, my + (dy * (i + 1)) / steps);
    await wait(16);
  }
  mx += dx;
  my += dy;
}

// ---- the walkthrough ----
await page.goto(base, { waitUntil: "networkidle" });
await wait(1200);
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
recording = true;
await page.mouse.move(mx, my);
await wait(2200);

// 1. dive from the full sweep of art history into the Baroque
await moveTo(W * 0.5, H * 0.42, 900);
await zoom(-2600, 34, 40);
await wait(1400);
await page.mouse.down();
await glide(mx, my, mx - 260, my, 900);
await page.mouse.up();
mx -= 260;
await wait(1200);

// 2. the Star Map
const stars = page.getByRole("button", { name: /star map/i });
if (await stars.count()) {
  await clickLocator(stars.first());
  await wait(2600);
  await page.mouse.down();
  await glide(mx, my, mx + 320, my + 20, 1100);
  await page.mouse.up();
  mx += 320;
  my += 20;
  await wait(1600);
}

// 3. filter: fly to Impressionism from the Explore dropdown
const explore = page.locator(".filter-btn").first();
if (await explore.count()) {
  await clickLocator(explore);
  await wait(1300);
  const impressionism = page.getByText(/^Impressionism$/).first();
  if (await impressionism.count()) {
    await clickLocator(impressionism);
    await wait(2600);
  } else {
    await page.keyboard.press("Escape");
  }
}

// 4. back to the Gallery Wall, open Vermeer's placard via the filter
const wallBtn = page.getByRole("button", { name: /gallery wall/i });
if (await wallBtn.count()) {
  await clickLocator(wallBtn.first());
  await wait(1500);
}
if (await explore.count()) {
  await clickLocator(explore);
  await wait(900);
  const artistTab = page.getByRole("button", { name: /artists?/i }).last();
  if (await artistTab.count()) await clickLocator(artistTab, 450).catch(() => {});
  await wait(700);
  const vermeer = page.getByText(/Johannes Vermeer/).first();
  if (await vermeer.count()) {
    await clickLocator(vermeer);
    await wait(2400);
  } else {
    await page.keyboard.press("Escape");
  }
}
const node = page.locator(".artist-node", { hasText: "Vermeer" }).first();
if (await node.count()) {
  await clickLocator(node);
  await wait(2600);
}

// 5. enter the gallery
const enter = page.getByText(/enter the gallery/i).first();
if (await enter.count()) {
  await clickLocator(enter, 800);
} else {
  await page.goto(`${base}/museum/johannes-vermeer`);
}
await page.waitForURL(/\/museum\//, { timeout: 20000 }).catch(() => {});
await waitDoors();
await wait(1800);

// 6. step inside and walk the hall
const start = page.locator(".mus-click-to-start");
if (await start.isVisible().catch(() => false)) {
  await moveTo(W / 2, H / 2, 500);
  await page.mouse.click(mx, my);
  await wait(800);
}
await walk("KeyW", 1500);
await look(-260, 10, 1100);
await wait(500);
await look(520, 0, 1800);
await wait(500);
await look(-260, -10, 1000);
await walk("KeyW", 1600);
await look(330, 0, 1200);
await wait(700);

// 7. inspect the painting under the crosshair
await page.mouse.click(mx, my);
await wait(3200);
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -120);
  await wait(140);
}
await wait(2000);
await page.keyboard.press("Escape");
await wait(2200);

// 8. a different era: the post-war white cube
await page.goto(`${base}/museum/mark-rothko`);
await waitDoors();
await wait(1500);
if (await start.isVisible().catch(() => false)) {
  await page.mouse.click(W / 2, H / 2);
  await wait(700);
}
mx = W / 2;
my = H / 2;
await walk("KeyW", 1800);
await look(-300, 0, 1400);
await wait(900);
await look(600, 0, 2200);
await wait(1200);

recording = false;
await cdp.send("Page.stopScreencast");
await browser.close();

// ---- encode: honour real frame timing, resample to constant 30 fps ----
if (frames.length < 2) {
  console.error("no frames captured");
  process.exit(1);
}
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const dur = i < frames.length - 1 ? Math.max(0.001, frames[i + 1].t - frames[i].t) : 1 / 30;
  lines.push(`file '${frames[i].file.replace(/\\/g, "/")}'`, `duration ${dur.toFixed(4)}`);
}
lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, "/")}'`);
const list = path.join(frameDir, "frames.txt");
fs.writeFileSync(list, lines.join("\n"));
const res = spawnSync(ffmpeg, [
  "-y", "-hide_banner", "-loglevel", "error",
  "-f", "concat", "-safe", "0", "-i", list,
  "-vf", `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-movflags", "+faststart",
  out,
], { stdio: "inherit" });
if (res.status !== 0) process.exit(res.status ?? 1);
const secs = frames[frames.length - 1].t - frames[0].t;
console.log(`${frames.length} frames over ${secs.toFixed(1)}s -> ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
fs.rmSync(frameDir, { recursive: true, force: true });
