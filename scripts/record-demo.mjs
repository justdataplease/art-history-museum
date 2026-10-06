// Record a video walkthrough of the app: the timeline (Gallery Wall, Star Map,
// Explore filter, artist card) and three galleries from different eras.
// Frames come from the DevTools screencast with their real timestamps and are
// encoded to constant-30fps H.264.
//
//   node scripts/record-demo.mjs [baseUrl] [out.mp4]
//
// Needs an ffmpeg with libx264: set FFMPEG=/path/to/ffmpeg (or have it on PATH).
// Optional soundtrack: set DEMO_AUDIO_DIR to a folder with <era>.mp3 files
// (old-master.mp3, impressionist.mp3, postwar.mp3) — the first track of each
// era's playlist in src/components/museum/music.ts. Each is mixed in from the
// moment that gallery's doors open, as the app itself does (the screencast
// can't capture page audio).
// Run against a production build so the dev overlay isn't in the shot.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const out = path.resolve(process.argv[3] ?? "demo/museum-demo.mp4");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const audioDir = process.env.DEMO_AUDIO_DIR ?? "";
const W = 1600;
const H = 900;

const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), "museum-demo-"));
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
// Never take a real pointer lock: on Windows even a headless Chrome's lock can
// trap the user's mouse. The stub keeps the app's pointer-lock flow working.
await page.addInitScript(() => {
  let locked = null;
  Object.defineProperty(Document.prototype, "pointerLockElement", { configurable: true, get() { return locked; } });
  const fire = () => queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange")));
  Element.prototype.requestPointerLock = function () { locked = this; fire(); return Promise.resolve(); };
  Document.prototype.exitPointerLock = function () { locked = null; fire(); };
});
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
// Start un-muted (as a first-time visitor would) so the music button and
// "now playing" credit appear in the video; the audio itself is mixed in later.
await page.addInitScript(() => {
  try { localStorage.setItem("timeline-museum:music-muted", "0"); } catch {}
});

// A visible cursor for the parts where we click around (headless draws none).
await page.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    Object.assign(dot.style, {
      position: "fixed", left: "-40px", top: "-40px", width: "20px", height: "20px",
      margin: "-10px 0 0 -10px", borderRadius: "50%", zIndex: "2147483647",
      pointerEvents: "none", background: "rgba(255,255,255,0.6)",
      border: "2px solid rgba(40,30,20,0.8)", boxShadow: "0 1px 6px rgba(0,0,0,0.35)",
      transition: "transform 120ms ease, opacity 200ms ease",
    });
    document.body.appendChild(dot);
    const sync = () => (dot.style.opacity = document.pointerLockElement ? "0" : "1");
    addEventListener("mousemove", (e) => {
      dot.style.left = e.clientX + "px";
      dot.style.top = e.clientY + "px";
      sync();
    }, true);
    addEventListener("mousedown", () => (dot.style.transform = "scale(0.7)"), true);
    addEventListener("mouseup", () => (dot.style.transform = "scale(1)"), true);
    document.addEventListener("pointerlockchange", sync);
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
const now = () => Date.now() / 1000;
const marks = []; // soundtrack segments: { era, start, end }

const wait = (ms) => page.waitForTimeout(ms);
let mx = W / 2;
let my = H / 2;
async function moveTo(x, y, ms = 700) {
  const steps = Math.max(8, Math.round(ms / 16));
  const x0 = mx, y0 = my;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const e = f * f * (3 - 2 * f);
    await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
    await wait(ms / steps);
  }
  mx = x;
  my = y;
}
async function clickOn(loc, ms = 650) {
  const box = await loc.boundingBox().catch(() => null);
  if (!box) return false;
  await moveTo(box.x + box.width / 2, box.y + box.height / 2, ms);
  await wait(160);
  await page.mouse.click(mx, my);
  return true;
}
async function drag(dx, dy, ms = 900) {
  await page.mouse.down();
  await moveTo(mx + dx, my + dy, ms);
  await page.mouse.up();
}
async function explore(tab, name) {
  if (!(await clickOn(page.locator(".filter-btn").first()))) return false;
  await wait(900);
  await clickOn(page.locator(".filter-tab", { hasText: tab }).first(), 450);
  await wait(600);
  const item = page.locator(".filter-item", {
    has: page.locator(".fi-name", { hasText: new RegExp(`^${name}$`) }),
  }).first();
  if (!(await item.count())) {
    await page.keyboard.press("Escape");
    return false;
  }
  await item.scrollIntoViewIfNeeded().catch(() => {});
  await clickOn(item, 600);
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
// PointerLockControls turns 0.002 rad per pixel of movementX/Y and reads them
// from document mousemove events. Synthetic CDP mouse moves derive movementX
// from absolute positions (so any return trip cancels the turn, and the
// viewport bounds it); dispatch the deltas directly instead.
async function look(dx, dy, ms = 900) {
  const steps = Math.max(1, Math.round(ms / 16));
  let px = 0, py = 0;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const e = f * f * (3 - 2 * f);
    const nx = Math.round(dx * e), ny = Math.round(dy * e);
    await page.evaluate(([mxd, myd]) => {
      document.dispatchEvent(new MouseEvent("mousemove", { movementX: mxd, movementY: myd, bubbles: true }));
    }, [nx - px, ny - py]);
    px = nx;
    py = ny;
    await wait(16);
  }
}
async function stepInside() {
  const start = page.locator(".mus-click-to-start");
  if (await start.isVisible().catch(() => false)) {
    await moveTo(W / 2, H / 2, 500);
    await page.mouse.click(W / 2, H / 2);
    await wait(700);
  }
}
async function aimAtPainting(dir = -1, maxPx = 900) {
  // turn in small steps until the crosshair reports a painting
  for (let turned = 0; turned < maxPx; turned += 18) {
    if (await page.locator(".crosshair.aim").count()) return true;
    await look(18 * dir, 0, 40);
  }
  return page.locator(".crosshair.aim").count().then((n) => n > 0);
}
async function gallery(slug, era, script) {
  await page.waitForURL(new RegExp(`/museum/${slug}`), { timeout: 20000 }).catch(() => {});
  await waitDoors();
  const seg = { era, start: now(), end: 0 };
  marks.push(seg);
  await wait(1400);
  await stepInside();
  await script();
  seg.end = now();
}

// ---- the walkthrough ----
await page.goto(base, { waitUntil: "networkidle" });
await wait(1500);
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
recording = true;
const t0 = now();
await page.mouse.move(mx, my);
await wait(2600);

// 1. Gallery Wall: fly into the Baroque, read the wall text and lifelines
await explore("Periods", "Baroque");
await wait(3800);
await moveTo(W * 0.55, H * 0.55, 600);
await drag(-240, 0, 1100);
await wait(1800);

// 2. Star Map constellations
await clickOn(page.locator(".tl-switch", { hasText: "Star Map" }).first());
await wait(3200);
await drag(300, 0, 1200);
await wait(1600);

// 3. Explore: fly to Impressionism
await explore("Periods", "Impressionism");
await wait(3400);

// 4. Gallery Wall → Caravaggio's placard → enter
await clickOn(page.locator(".tl-switch", { hasText: "Gallery Wall" }).first());
await wait(1500);
await explore("Artists", "Caravaggio");
await wait(2600);
const node = page.locator(".artist-node", { hasText: "Caravaggio" }).first();
if (!(await clickOn(node, 700))) await page.goto(`${base}/museum/caravaggio`);
await wait(3400);
await clickOn(page.locator(".card-enter").first(), 800);

// 5. Caravaggio — the Baroque hall
await gallery("caravaggio", "old-master", async () => {
  await walk("KeyW", 1700);
  await look(0, -240, 1300); // up at the laylight and the track fixtures
  await wait(900);
  await look(-420, 120, 1500);
  await wait(600);
  await look(0, 120, 700);
  await look(820, 0, 2600);
  await wait(500);
  await walk("KeyW", 1200);
  if (await aimAtPainting(-1)) {
    await wait(500);
    await page.mouse.click(W / 2, H / 2);
    await wait(3600);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -120);
      await wait(150);
    }
    await wait(2400);
    await page.keyboard.press("Escape");
    await wait(2000);
  }
});

// 6. Monet — an Impressionist room at real scale
await page.goto(`${base}/museum/claude-monet`);
await gallery("claude-monet", "impressionist", async () => {
  await walk("KeyW", 2200);
  await look(-500, 0, 1800);
  await wait(800);
  await look(1000, 0, 3000);
  await wait(1000);
});

// 7. Rothko — the post-war white cube
await page.goto(`${base}/museum/mark-rothko`);
await gallery("mark-rothko", "postwar", async () => {
  await walk("KeyW", 2000);
  await look(-520, 0, 2000);
  await wait(900);
  await look(1040, 0, 3200);
  await wait(1600);
});

recording = false;
await cdp.send("Page.stopScreencast");
await browser.close();

// ---- encode: honour real frame timing, resample to constant 30 fps ----
if (frames.length < 2) {
  console.error("no frames captured");
  process.exit(1);
}
const first = frames[0].t;
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const dur = i < frames.length - 1 ? Math.max(0.001, frames[i + 1].t - frames[i].t) : 1 / 30;
  lines.push(`file '${frames[i].file.replace(/\\/g, "/")}'`, `duration ${dur.toFixed(4)}`);
}
lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, "/")}'`);
const list = path.join(frameDir, "frames.txt");
fs.writeFileSync(list, lines.join("\n"));
const total = frames[frames.length - 1].t - first;

const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list];
const segs = marks
  .map((m) => ({ ...m, file: audioDir && path.join(audioDir, `${m.era}.mp3`) }))
  .filter((m) => m.file && fs.existsSync(m.file) && m.end > m.start);
segs.forEach((s) => args.push("-i", s.file));
const filters = [`[0:v]fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p[v]`];
segs.forEach((s, i) => {
  const at = Math.max(0, s.start - first);
  const len = s.end - s.start;
  filters.push(
    `[${i + 1}:a]atrim=0:${len.toFixed(2)},asetpts=PTS-STARTPTS,` +
      `afade=t=in:d=3,afade=t=out:st=${Math.max(0, len - 1.2).toFixed(2)}:d=1.2,` +
      `volume=0.8,adelay=${Math.round(at * 1000)}|${Math.round(at * 1000)}[a${i}]`
  );
});
if (segs.length) {
  filters.push(`${segs.map((_, i) => `[a${i}]`).join("")}amix=inputs=${segs.length}:normalize=0,apad,atrim=0:${total.toFixed(2)}[a]`);
}
args.push("-filter_complex", filters.join(";"), "-map", "[v]");
if (segs.length) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "160k");
args.push("-c:v", "libx264", "-preset", "slow", "-crf", "21", "-movflags", "+faststart", "-t", total.toFixed(2), out);
const res = spawnSync(ffmpeg, args, { stdio: "inherit" });
if (res.status !== 0) process.exit(res.status ?? 1);
console.log(`${frames.length} frames over ${total.toFixed(1)}s (recorded from ${(t0 - first).toFixed(1)}s) -> ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
console.log(`soundtrack segments: ${segs.map((s) => `${s.era}@${(s.start - first).toFixed(1)}s+${(s.end - s.start).toFixed(1)}s`).join(", ") || "none"}`);
if (errors.length) console.log(`console errors (${errors.length}):\n  ${errors.slice(0, 8).join("\n  ")}`);
fs.rmSync(frameDir, { recursive: true, force: true });
