// Drive the running app in real Chrome, assert the timeline behaves, and
// capture evidence screenshots.  Usage: node scripts/verify-e2e.mjs [baseUrl]
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
// VERIFY_PLACEHOLDER_IMAGES=1 serves a local placeholder for every Wikimedia
// image (portraits, paintings): repeated runs then stay clear of its rate limits.
const PLACEHOLDER_IMAGES = !!process.env.VERIFY_PLACEHOLDER_IMAGES;
// a 4x4 warm-grey PNG
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGPoqkqDIwbiOABO0hahD+yEBAAAAABJRU5ErkJggg==",
  "base64"
);
const placeholder = (route) => route.fulfill({ status: 200, contentType: "image/png", body: PLACEHOLDER_PNG });
const OUT = "verify-artifacts";
const W = 1600;
const H = 900;
fs.mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const failedRequests = [];
const failures = [];

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
// Never let a test take the real cursor: Chrome on Windows implements
// requestPointerLock with an OS-level cursor clip, even headless.
await page.addInitScript(() => {
  let locked = null;
  Object.defineProperty(Document.prototype, "pointerLockElement", { configurable: true, get() { return locked; } });
  const fire = () => queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange")));
  // the stub has to remember which element asked for the lock
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  Element.prototype.requestPointerLock = function () { locked = this; fire(); return Promise.resolve(); };
  Document.prototype.exitPointerLock = function () { locked = null; fire(); };
});

if (PLACEHOLDER_IMAGES) await page.route(/(upload|thumb)\.wikimedia\.org/, placeholder);

page.on("console", (msg) => {
  if (msg.type() === "error")
    consoleErrors.push(`@${new URL(page.url()).pathname}: ${msg.text().slice(0, 300)}`);
});
page.on("pageerror", (e) =>
  consoleErrors.push(`pageerror @${new URL(page.url()).pathname}: ${e.message.slice(0, 300)}`)
);
page.on("requestfailed", (req) => {
  failedRequests.push(`${req.failure()?.errorText} ${req.url().slice(0, 140)}`);
});

const log = (s) => console.log("STEP: " + s);
function check(ok, what) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

/** Visible text labels that overlap each other (should always be none). */
const labelOverlaps = (p = page) =>
  p.evaluate(() => {
    const sel = [
      ".rail-label:not(.offscreen)",
      ".wall-row:not(.offscreen) .name",
      ".wall-row.m-full:not(.offscreen) .years",
      ".neb-label:not(.offscreen)",
      ".star-label",
    ].join(",");
    const boxes = [...document.querySelectorAll(sel)]
      .map((el) => ({ el, r: el.getBoundingClientRect(), t: el.textContent.trim().slice(0, 28) }))
      .filter((b) => b.r.width > 0 && b.r.right > 0 && b.r.left < innerWidth && b.r.bottom > 0 && b.r.top < innerHeight);
    const bad = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ix > 1 && iy > 1) bad.push(`${a.t} <> ${b.t}`);
      }
    return { n: boxes.length, bad };
  });

/** Pixels per year + the year at the screen centre, read off the axis labels. */
const axisState = (p = page) =>
  p.evaluate(() => {
    const labels = [...document.querySelectorAll(".tl-axis .ax-label")]
      .map((t) => ({ y: +t.textContent, x: t.getBoundingClientRect().left + t.getBoundingClientRect().width / 2 }))
      .filter((l) => Number.isFinite(l.y));
    if (labels.length < 2) return null;
    const a = labels[0];
    const b = labels[labels.length - 1];
    const ppy = (b.x - a.x) / (b.y - a.y);
    return { ppy, center: a.y + (innerWidth / 2 - a.x) / ppy, n: labels.length, step: labels[1].y - labels[0].y };
  });

const xOfYear = async (year) => {
  const axis = await axisState();
  return W / 2 + (year - axis.center) * axis.ppy;
};

// Expanded periods can make the overview taller than the viewport. Use the
// same focus-to-scroll path as keyboard browsing, then perform a real click.
async function clickWallPeriod(slug) {
  const title = page.locator(`.rail-label[data-period="${slug}"]`);
  await title.focus();
  await page.waitForTimeout(700);
  await title.click();
}

// ---------------------------------------------------------------- 1. overview
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
log("gallery wall overview");
check((await page.getByRole("button", { name: /the river/i }).count()) === 0, "River view removed (no switcher entry)");
check((await page.locator(".stream, .river-svg").count()) === 0, "River view removed (no river DOM)");
const bands = await page.locator(".band").count();
const periodGroups = await page.locator(".period-group").count();
const artistNodes = await page.locator(".artist-node").count();
check(periodGroups === 35, `all period wrappers rendered: ${periodGroups}`);
check(artistNodes === 526, `all artist nodes rendered: ${artistNodes}`);
check(bands > 0 && bands <= periodGroups, `visible period bands rendered: ${bands}/${periodGroups}`);
const railLabels = await page.locator(".rail-label:not(.offscreen)").count();
check(railLabels >= 16, `period titles identifiable at overview: ${railLabels}/${periodGroups}`);
let ov = await labelOverlaps();
check(ov.bad.length === 0, `no overlapping labels at overview (${ov.n} labels) ${ov.bad.slice(0, 3).join(" | ")}`);
const ax0 = await axisState();
check(ax0 && ax0.n >= 8, `year axis labels at overview: ${ax0?.n} (step ${ax0?.step})`);
await page.screenshot({ path: `${OUT}/1-wall-zoomed-out.png` });

// ---------------------------------------------------------------- 2. wheel zoom
log("wheel zoom toward the Baroque");
await page.mouse.move(await xOfYear(1650), 480);
for (let i = 0; i < 14; i++) {
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(60);
}
await page.waitForTimeout(900);
const ax1 = await axisState();
check(ax1 && ax1.ppy > ax0.ppy * 4, `wheel zoomed in (px/year ${ax0?.ppy.toFixed(2)} -> ${ax1?.ppy.toFixed(2)})`);
check(ax1 && ax1.step < 100, `axis ticks densify when zoomed (step ${ax1?.step}y)`);
const portraits = await page.locator(".wall-row:not(.offscreen) .ring img").count();
check(portraits >= 3, `artist portraits visible after zoom: ${portraits}`);
ov = await labelOverlaps();
check(ov.bad.length === 0, `no overlapping labels zoomed in (${ov.n} labels) ${ov.bad.slice(0, 3).join(" | ")}`);
await page.screenshot({ path: `${OUT}/2-wall-zoomed-in.png` });

// ctrl+wheel (= trackpad pinch) must be swallowed by the timeline, not zoom the page
await page.evaluate(() => {
  window.__wheelPrevented = null;
  window.addEventListener("wheel", (e) => (window.__wheelPrevented = e.defaultPrevented), { once: true });
});
await page.keyboard.down("Control");
await page.mouse.wheel(0, 120);
await page.keyboard.up("Control");
await page.waitForTimeout(300);
check((await page.evaluate(() => window.__wheelPrevented)) === true, "ctrl+wheel is handled by the timeline (default prevented)");

// ---------------------------------------------------------------- 3. drag never dives
log("drag that starts on a period band");
const before = await axisState();
const bandBox = await page.evaluate(() => {
  for (const b of document.querySelectorAll(".band")) {
    const r = b.getBoundingClientRect();
    const x = Math.max(r.left, 40) + 30;
    const y = r.top + Math.min(r.height - 6, 40);
    if (x < innerWidth - 400 && y > 130 && y < innerHeight - 80 && document.elementFromPoint(x, y)?.closest(".band, .wall-row"))
      return { x, y };
  }
  return null;
});
if (bandBox) {
  await page.mouse.move(bandBox.x, bandBox.y);
  await page.mouse.down();
  await page.mouse.move(bandBox.x + 300, bandBox.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const after = await axisState();
  check(Math.abs(after.ppy - before.ppy) / before.ppy < 0.02, `drag kept the zoom (no dive): px/year ${before.ppy.toFixed(2)} -> ${after.ppy.toFixed(2)}`);
  check(after.center < before.center - 1, `drag panned back in time: centre ${before.center.toFixed(1)} -> ${after.center.toFixed(1)}`);
} else check(false, "found a band to drag");

// ---------------------------------------------------------------- 4. click dives
log("click a period title to dive in");
await page.locator(".tl-canvas").focus();
await page.keyboard.press("Home");
await page.waitForTimeout(1400);
await clickWallPeriod("impressionism");
await page.waitForTimeout(1600);
const ax2 = await axisState();
check(ax2 && Math.abs(ax2.center - 1877.5) < 8, `period click dives into Impressionism (centre ${ax2?.center.toFixed(1)})`);
check((await page.locator(".wall-text p").count()) >= 1, "period wall text shown when zoomed into a period");

// ---------------------------------------------------------------- 5. artist card
log("open an artist placard");
const node = page.locator(".wall-row:not(.offscreen) .artist-node").first();
const slug = await node.getAttribute("data-slug");
await node.click();
await page.waitForTimeout(1300);
const cardVisible = await page.locator(".card").isVisible();
check(cardVisible, `artist card visible (${slug})`);
if (cardVisible) {
  const name = await page.locator(".card-name").innerText();
  const sub = await page.locator(".card-sub").innerText();
  const years = sub.match(/\b1\d{3}\b|\b20\d{2}\b/g) ?? [];
  check(new Set(years).size === years.length, `card prints the dates once: "${sub.replace(/\n/g, " / ")}"`);
  check((await page.locator(".card[role=dialog][aria-modal=true]").count()) === 1, "card is a modal dialog");
  const focused = await page.evaluate(() => document.activeElement?.className ?? "");
  check(focused.includes("card-enter"), "focus moves to Enter the Gallery");
  const srcset = await page.locator(".card-portrait img").getAttribute("srcset").catch(() => null);
  check(srcset === null || /1x, .* 2x/.test(srcset), `card portrait has a HiDPI srcset (${srcset ? "yes" : "single size"})`);
  log(`card: ${name}`);
  await page.screenshot({ path: `${OUT}/3-artist-card.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  check(!(await page.locator(".card").isVisible().catch(() => false)), "Escape closes the card");
  const back = await page.evaluate(() => document.activeElement?.getAttribute("data-slug"));
  check(back === slug, `focus returns to the artist (${back})`);
}

// ---------------------------------------------------------------- 6. keyboard path
log("keyboard: Tab to an artist, Enter opens it");
await page.locator(".tl-canvas").focus();
let reached = null;
for (let i = 0; i < 12 && !reached; i++) {
  await page.keyboard.press("Tab");
  reached = await page.evaluate(() => {
    const a = document.activeElement;
    return a?.classList.contains("artist-node") ? a.getAttribute("data-slug") : null;
  });
}
check(!!reached, `Tab reaches an artist node (${reached})`);
if (reached) {
  await page.waitForTimeout(700);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  check(await page.locator(".card").isVisible(), "Enter on a focused artist opens the card");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
}

/** The focused element: its slug/period, and whether it is drawn inside the viewport. */
const focusState = () =>
  page.evaluate(() => {
    const a = document.activeElement;
    const r = a.getBoundingClientRect();
    return {
      id: a.dataset?.slug ?? a.dataset?.period ?? a.tagName,
      off: !!a.closest(".offscreen"),
      inView: !a.closest(".offscreen") && r.left >= 0 && r.right <= innerWidth && r.top > 100 && r.bottom <= innerHeight - 40,
    };
  });

// ---------------------------------------------------------------- 6b. focus survives a pan
log("keyboard: arrow keys keep panning while the focused artist leaves the screen");
await page.locator(".tl-canvas").focus();
await page.keyboard.press("Home");
await page.waitForTimeout(1400);
await clickWallPeriod("baroque");
await page.waitForTimeout(1700);
await page.waitForTimeout(700); // focus right after a pointer press is not panned to
await page.evaluate(() => document.querySelector('.artist-node[data-slug="rembrandt"]')?.focus());
await page.waitForTimeout(800);
const panTrail = [];
for (let i = 0; i < 6; i++) {
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(450);
  panTrail.push({ ...(await focusState()), center: (await axisState())?.center ?? NaN });
}
check(
  panTrail.every((p) => p.id === "rembrandt"),
  `focus stays on the artist through the pan (${panTrail.map((p) => p.id + (p.off ? "(off)" : "")).join(", ")})`
);
check(panTrail.some((p) => p.off), "the focused artist's row did leave the screen during the pan");
check(
  panTrail.every((p, i) => i === 0 || p.center > panTrail[i - 1].center + 1),
  `every arrow press kept panning (centre ${panTrail.map((p) => p.center.toFixed(0)).join(" → ")})`
);

// ---------------------------------------------------------------- 6c. Tab at depth
log("keyboard: Tab at deep zoom brings each off-screen artist into view");
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("+");
  await page.waitForTimeout(450);
}
await page.evaluate(() => document.querySelector('.rail-label[data-period="baroque"]')?.focus());
await page.waitForTimeout(1300);
const tabbed = [];
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("Tab");
  await page.waitForTimeout(1300);
  tabbed.push(await focusState());
}
check(
  tabbed.every((f) => f.inView),
  `each Tab lands on a visible artist (${tabbed.map((f) => f.id + (f.inView ? "" : " NOT IN VIEW")).join(", ")})`
);

// ---------------------------------------------------------------- 7. star map
log("star map");
await page.locator(".tl-canvas").focus();
await page.keyboard.press("Home");
await page.waitForTimeout(1300);
await page.getByRole("button", { name: "Star Map" }).click();
await page.waitForTimeout(1200);
const stars = await page.locator(".star:not(.offscreen)").count();
check(stars >= 60, `stars rendered at overview: ${stars}`);
const figures = await page.locator(".constellations path").count();
check(figures >= 12, `constellation figures drawn: ${figures}`);
const starTitles = await page.locator(".neb-label:not(.offscreen)").count();
check(starTitles >= 16, `constellation titles at overview: ${starTitles}`);
ov = await labelOverlaps();
check(ov.bad.length === 0, `no overlapping star-map labels (${ov.n}) ${ov.bad.slice(0, 3).join(" | ")}`);
const blurred = await page.evaluate(() =>
  [...document.querySelectorAll(".star-layer *")].filter((e) => getComputedStyle(e).filter !== "none").length
);
check(blurred === 0, `no CSS filters in the star map (${blurred})`);
await page.screenshot({ path: `${OUT}/4-star-map.png` });
await page.mouse.move(await xOfYear(1900), 480);
for (let i = 0; i < 10; i++) {
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(60);
}
await page.waitForTimeout(900);
ov = await labelOverlaps();
check(ov.bad.length === 0, `no overlapping star-map labels zoomed (${ov.n}) ${ov.bad.slice(0, 3).join(" | ")}`);
await page.screenshot({ path: `${OUT}/5-star-map-zoomed.png` });

// a star is drawn at the middle of the artist's working years: focus must fly there
const starFocus = [];
for (const s of ["caravaggio", "claude-monet"]) {
  await page.evaluate((s) => document.querySelector(`.star[data-slug="${s}"]`)?.focus(), s);
  await page.waitForTimeout(1300);
  starFocus.push(await focusState());
}
check(
  starFocus.every((f) => f.inView),
  `focusing an off-screen star brings it into view (${starFocus.map((f) => f.id + (f.inView ? "" : " NOT IN VIEW")).join(", ")})`
);

// ---------------------------------------------------------------- 8. explore dropdown
log("explore dropdown");
await page.getByRole("button", { name: "Explore" }).click();
await page.waitForTimeout(900);
const items = await page.locator(".filter-item").count();
const nPeriods = Number(await page.locator(".filter-tab", { hasText: "Periods" }).locator(".count").innerText());
check(items === nPeriods && items >= 18, `filter items (periods tab): ${items} of ${nPeriods} periods`);
check((await page.locator(".filter-btn[aria-expanded=true]").count()) === 1, "Explore button reports aria-expanded");
await page.screenshot({ path: `${OUT}/6-filter-dropdown.png` });
await page.mouse.click(400, 700);
await page.waitForTimeout(600);
check((await page.locator(".filter-panel").count()) === 0, "dropdown closes on an outside click");
await page.getByRole("button", { name: "Explore" }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: "Artists" }).click();
await page.waitForTimeout(500);
await page.locator(".filter-item", { hasText: "Johannes Vermeer" }).click();
await page.waitForTimeout(1800);
check((await page.locator(".filter-btn").innerText()).toLowerCase().includes("johannes vermeer"), "artist filter applied");
const vermeer = await page.evaluate(() => {
  const el = document.querySelector('.artist-node[data-slug="johannes-vermeer"]');
  if (!el || el.classList.contains("offscreen")) return null;
  const r = el.getBoundingClientRect();
  return { inView: r.left >= 0 && r.right <= innerWidth && r.top > 100 && r.bottom < innerHeight, focused: document.activeElement === el };
});
check(vermeer?.inView, `flew to the selected artist (in view: ${vermeer?.inView}, focused: ${vermeer?.focused})`);
check(vermeer?.focused, "the selected artist has keyboard focus after the flight");
await page.screenshot({ path: `${OUT}/7-filter-artist.png` });

// ---------------------------------------------------------------- 9. into the museum
log("enter the gallery from a placard");
await page.getByRole("button", { name: "Gallery Wall" }).click();
await page.waitForTimeout(900);
const vNode = page.locator('.artist-node[data-slug="johannes-vermeer"]:not(.dimmed)').first();
if (await vNode.isVisible().catch(() => false)) {
  await vNode.click();
  await page.waitForTimeout(1400);
  await page.getByRole("button", { name: /Enter the Gallery/i }).click();
  await page.waitForURL(/\/museum\//, { timeout: 20000 }).catch(() => {});
}
if (!/\/museum\//.test(page.url())) {
  await page.goto(`${BASE}/museum/johannes-vermeer`, { waitUntil: "domcontentloaded" });
}
check(/\/museum\//.test(page.url()), `museum route reached: ${page.url()}`);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/8-museum-doors.png` });
await page
  .waitForFunction(() => {
    const d = document.querySelector(".doors");
    return !d || getComputedStyle(d).display === "none" || getComputedStyle(d).opacity === "0";
  }, null, { timeout: 30000 })
  .catch(() => {});
await page.waitForTimeout(1500);
const hasCanvas = await page.locator("canvas").count();
check(hasCanvas > 0, `webgl canvas count: ${hasCanvas}`);
await page.screenshot({ path: `${OUT}/9-museum-gallery.png` });

// ---------------------------------------------------------------- 10. explore → artist, short screen
// the wall is taller than a short screen: the fly-to must also bring the row up
log("explore → artist on a short screen (rows below the fold of the wall)");
await page.setViewportSize({ width: 1280, height: 760 });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
for (const [slug, name, mid] of [
  ["jean-michel-basquiat", "Jean-Michel Basquiat", 1974],
  ["keith-haring", "Keith Haring", 1973.5],
]) {
  await page.locator(".filter-btn").click();
  await page.waitForTimeout(600);
  await page.locator(".filter-tab", { hasText: "Artists" }).click();
  await page.waitForTimeout(500);
  const item = page.locator(".filter-item", { hasText: name }).first();
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await page.waitForTimeout(2200);
  const ax = await axisState();
  const f = await focusState();
  check(
    f.id === slug && f.inView,
    `Explore → ${name}: lands on the artist (focused: ${f.id}, in view: ${f.inView})`
  );
  check(ax && Math.abs(ax.center - mid) < 6, `Explore → ${name}: framed on the life (centre ${ax?.center.toFixed(1)} vs ${mid})`);
}
await page.screenshot({ path: `${OUT}/10-filter-artist-short-screen.png` });

// ---------------------------------------------------------------- 11. layout at common sizes
/** A fresh page at a size (phones get touch), with the pointer-lock stub. */
async function pageAt(w, h) {
  const phone = w < 600;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    let locked = null;
    Object.defineProperty(Document.prototype, "pointerLockElement", { configurable: true, get() { return locked; } });
    const fire = () => queueMicrotask(() => document.dispatchEvent(new Event("pointerlockchange")));
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    Element.prototype.requestPointerLock = function () { locked = this; fire(); return Promise.resolve(); };
    Document.prototype.exitPointerLock = function () { locked = null; fire(); };
  });
  if (PLACEHOLDER_IMAGES) await p.route(/(upload|thumb)\.wikimedia\.org/, placeholder);
  p.on("pageerror", (e) => consoleErrors.push(`pageerror @${w}x${h}: ${e.message.slice(0, 300)}`));
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  return { p, ctx };
}

/** Open Explore and pick a period or an artist (by visible name). */
async function pick(p, tab, name) {
  await p.locator(".filter-btn").click();
  await p.waitForTimeout(500);
  if (tab === "artists") {
    await p.locator(".filter-tab", { hasText: "Artists" }).click();
    await p.waitForTimeout(300);
    await p.locator(".filter-search input").fill(name);
    await p.waitForTimeout(200);
    await p.locator(".fi-artist").first().click();
  } else {
    await p.locator(".fi-period", { has: p.locator(".fi-name", { hasText: new RegExp(`^${name}$`) }) }).click();
  }
  await p.waitForTimeout(1800);
}

/**
 * Footer row: its parts and the "more below" pill never overlap, and the wall
 * ends above it (`lowest`: the bottom of the lowest band or name on screen).
 */
const footerState = (p) =>
  p.evaluate(() => {
    const foot = document.querySelector(".tl-foot").getBoundingClientRect();
    const box = (s) => document.querySelector(s)?.getBoundingClientRect();
    const hit = (a, b) => a && b && a.width && b.width && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const parts = [".tl-hint", ".tl-note-src", ".tl-note-give", ".tl-note-by > span", ".tl-source", ".tl-scrollhint"].map((s) => [s, box(s)]);
    const clashes = [];
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) if (hit(parts[i][1], parts[j][1])) clashes.push(`${parts[i][0]}/${parts[j][0]}`);
    const lowest = Math.max(
      0,
      ...[...document.querySelectorAll(".band, .wall-row:not(.offscreen) .name")]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width && r.right > 0 && r.left < innerWidth)
        .map((r) => r.bottom)
    );
    const pill = box(".tl-scrollhint");
    return { clashes, lowest: Math.round(lowest), pillAbove: !pill || pill.bottom <= foot.top + 1, footTop: Math.round(foot.top) };
  });

log("footer row, Star Map titles and dives at common sizes");
for (const [w, h] of [[1600, 900], [1440, 900], [1366, 768], [1280, 720], [820, 1180], [430, 932], [390, 844], [360, 740]]) {
  const { p, ctx } = await pageAt(w, h);
  const fs0 = await footerState(p);
  check(fs0.clashes.length === 0 && fs0.pillAbove, `${w}x${h}: footer parts and the pill never overlap (${fs0.clashes.join(", ") || "clear"})`);
  // scrolled to the end of the wall, its last lane clears the footer row
  await p.locator(".tl-canvas").focus();
  // (the pill fades out once the end is reached)
  for (let i = 0; i < 40; i++) {
    const op = await p.evaluate(() => {
      const e = document.querySelector(".tl-scrollhint");
      return e ? +getComputedStyle(e).opacity : 0;
    });
    if (op < 0.05) break;
    await p.keyboard.press("ArrowDown");
    await p.waitForTimeout(320);
  }
  await p.waitForTimeout(400);
  const fs1 = await footerState(p);
  check(fs1.lowest <= fs1.footTop, `${w}x${h}: scrolled to its end, the wall stops above the footer row (${fs1.lowest} <= ${fs1.footTop})`);
  await p.keyboard.press("Home");
  await p.waitForTimeout(1300);
  await p.getByRole("button", { name: "Star Map" }).click();
  await p.waitForTimeout(1100);
  const missing = await p.locator(".neb-label.offscreen").count();
  check(missing === 0, `${w}x${h}: every constellation on the Star Map overview has its title (${missing} missing)`);
  ov = await labelOverlaps(p);
  check(ov.bad.length === 0, `${w}x${h}: no overlapping star-map labels (${ov.bad.slice(0, 2).join(" | ")})`);
  const cutTitles = await p.evaluate(() => {
    const axis = document.querySelector(".tl-axis").getBoundingClientRect();
    const foot = document.querySelector(".tl-foot").getBoundingClientRect();
    return [...document.querySelectorAll(".neb-label:not(.offscreen)")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < 0 || r.right > innerWidth || r.top < axis.bottom || r.bottom > foot.top;
      })
      .map((el) => el.dataset.period);
  });
  check(cutTitles.length === 0, `${w}x${h}: Star Map titles fit between the year axis and footer (${cutTitles.join(", ") || "clear"})`);
  await p.getByRole("button", { name: "Gallery Wall" }).click();
  await p.waitForTimeout(800);
  for (const name of ["Cubism", "Fauvism", "Pop Art"]) {
    await pick(p, "periods", name);
    const d = await p.evaluate(() => {
      const t = document.querySelector(".wall-text");
      const foot = document.querySelector(".tl-foot").getBoundingClientRect();
      if (!t) return { text: false };
      const r = t.getBoundingClientRect();
      const band = [...document.querySelectorAll(".band")].find((b) => b.getBoundingClientRect().top <= r.top && b.getBoundingClientRect().bottom >= r.bottom);
      const br = band?.getBoundingClientRect();
      return {
        text: true,
        opacity: +getComputedStyle(t).opacity,
        inView: r.left >= 0 && r.right <= innerWidth && r.top >= 100 && r.bottom <= foot.top,
        bandAboveFoot: !br || br.bottom <= foot.top + 1,
      };
    });
    check(d.text && d.opacity > 0.9 && d.inView, `${w}x${h}: diving into ${name} shows its wall text in full (opacity ${d.opacity?.toFixed(2)}, in view ${d.inView})`);
    check(d.bandAboveFoot !== false, `${w}x${h}: ${name}'s band ends above the footer row`);
  }
  await ctx.close();
}

log("Explore on a phone after a pick, and the placard at phone and desktop sizes");
for (const [w, h] of [[360, 740], [390, 844], [430, 932]]) {
  const { p, ctx } = await pageAt(w, h);
  for (const [tab, name] of [["periods", "Northern Renaissance"], ["artists", "Jean-Léon Gérôme"]]) {
    await pick(p, tab, name);
    await p.locator(".filter-btn").click();
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const b = document.querySelector(".filter-panel").getBoundingClientRect();
      return { l: Math.round(b.left), r: Math.round(b.right) };
    });
    check(r.l >= 0 && r.r <= w, `${w}x${h}: Explore stays on screen after picking ${name} (${r.l}..${r.r})`);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(500);
  }
  await ctx.close();
}
for (const [w, h] of [[360, 740], [390, 844], [1600, 900], [1366, 768]]) {
  const { p, ctx } = await pageAt(w, h);
  await p.evaluate(() => document.querySelector('.artist-node[data-slug="caravaggio"]')?.click());
  await p.waitForTimeout(1400);
  const c = await p.evaluate(() => {
    const inV = (s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    };
    return { card: inV(".card"), enter: inV(".card-enter"), wiki: inV(".card-wiki") };
  });
  check(c.card && c.enter && c.wiki !== false, `${w}x${h}: the placard fits, Enter the Gallery and the source in view (${JSON.stringify(c)})`);
  await ctx.close();
}

log("artist search ignores punctuation and accents");
{
  const { p, ctx } = await pageAt(1366, 768);
  await p.locator(".filter-btn").click();
  await p.waitForTimeout(500);
  await p.locator(".filter-tab", { hasText: "Artists" }).click();
  await p.waitForTimeout(300);
  for (const [q, want] of [
    ["Jean-Léon Gérôme", "Jean-Léon Gérôme"],
    ["jean leon gerome", "Jean-Léon Gérôme"],
    ["O'Keeffe", "Georgia O'Keeffe"],
    ["okeeffe", "Georgia O'Keeffe"],
    ["J. M. W. Turner", "J. M. W. Turner"],
    ["jmw turner", "J. M. W. Turner"],
    ["J.M.W. Turner", "J. M. W. Turner"],
  ]) {
    await p.locator(".filter-search input").fill(q);
    await p.waitForTimeout(150);
    const names = await p.locator(".fi-artist .fi-name").allInnerTexts();
    const norm = (s) => s.replace(/[’]/g, "'");
    check(names.some((n) => norm(n) === norm(want)), `search "${q}" finds ${want} (${names.length} found)`);
  }
  await ctx.close();
}

log("navigation to Chinese painters before 1200");
{
  const { p, ctx } = await pageAt(1366, 768);
  if (await p.locator('.rail-label[data-period="chinese-painting"]').count()) {
    for (const view of ["Gallery Wall", "Star Map"]) {
      await p.getByRole("button", { name: view, exact: true }).click();
      await p.locator(".filter-btn").click();
      await p.locator(".filter-tab", { hasText: "Artists" }).click();
      await p.locator(".filter-search input").fill("Li Cheng");
      const liCheng = p.locator(".fi-artist", { has: p.locator(".fi-name", { hasText: /^Li Cheng\b/ }) });
      const found = await liCheng.count();
      check(found === 1, `${view}: Chinese Painting includes Li Cheng`);
      if (!found) { await p.keyboard.press("Escape"); continue; }
      await liCheng.first().click();
      await p.waitForTimeout(1800);
      const earlyAxis = await axisState(p);
      const earlyArtist = await p.evaluate(() => {
        const el = document.activeElement;
        if (!el?.matches(".artist-node") || !el.getAttribute("aria-label")?.startsWith("Li Cheng")) return false;
        const r = el.getBoundingClientRect();
        const axis = document.querySelector(".tl-axis").getBoundingClientRect();
        const foot = document.querySelector(".tl-foot").getBoundingClientRect();
        return !el.classList.contains("offscreen") && r.left >= 0 && r.right <= innerWidth && r.top >= axis.bottom && r.bottom <= foot.top;
      });
      check(earlyArtist && earlyAxis && earlyAxis.center >= 900 && earlyAxis.center < 1200,
        `${view}: Explore brings Li Cheng into view before 1200 (centre ${earlyAxis?.center.toFixed(1)})`);
    }
  }
  await ctx.close();
}

log("app icon");
{
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel~="icon"]')].map((l) => l.getAttribute("href") ?? "")
  );
  const svgHref = links.find((h) => /icon.*\.svg/.test(h));
  const svg = svgHref ? await page.request.get(new URL(svgHref, BASE).href) : null;
  const ico = await page.request.get(new URL("/favicon.ico", BASE).href);
  const icon = {
    links,
    svgOk: !!svg?.ok(),
    svgType: svg?.headers()["content-type"],
    icoOk: ico.ok(),
    icoBytes: (await ico.body()).length,
  };
  check(icon.svgOk && /svg/.test(icon.svgType ?? ""), `museum icon linked and served (${icon.links.join(", ")})`);
  // 25931 bytes is Next.js's default favicon
  check(icon.icoOk && icon.icoBytes !== 25931, `favicon.ico is the museum mark (${icon.icoBytes} bytes)`);
}

// ---------------------------------------------------------------- report
const wikiFails = failedRequests.filter((r) => r.includes("wikimedia"));
log(`console errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 12).forEach((e) => console.log("  CONSOLE-ERR: " + e));
check(consoleErrors.length === 0, `no console or page errors (${consoleErrors.length} collected)`);
log(`failed requests: ${failedRequests.length} (wikimedia: ${wikiFails.length})`);
failedRequests.slice(0, 12).forEach((e) => console.log("  REQ-FAIL: " + e));

await browser.close();
if (failures.length) {
  console.log(`\nFAILED ${failures.length} check(s):`);
  failures.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("\nDONE - all checks passed");
