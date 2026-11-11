// A building's rooms and doors as OpenStreetMap's indoor survey has them, in metres: what a space of
// src/lib/spaces.ts is measured from. Prints each room of a level twice over: where it lies in the building's
// frame (its outline's extent along and across the building's axis), and the room in its own frame: its true
// length and width along its own walls, how far it is turned from the building's axis, and each door by the wall
// it is in and its place along that wall from the room's centre. A wing a few degrees off the building's axis
// makes the first larger than the room is (a 50 m room turned 7 degrees gains 6 m across): take the sizes from
// the second. Nothing is written: read the table, set the rooms' rectangles and doors in spaces.ts by hand
// (leave the walls' thickness between neighbours), then check against photographs with scripts/shot-space.mjs.
//
//   node scripts/osm-rooms.mjs <south,west,north,east> <level> [axisRoom] [filter]
//   node scripts/osm-rooms.mjs 48.8585,2.3300,48.8640,2.3410 1 "Grande Galerie" "galerie|salon|salle"
//
// axisRoom: the name of a long room whose length gives the building's axis (default: the longest room found).
// Set WIKI_USER_AGENT (.env.example) to say who is asking. © OpenStreetMap contributors, ODbL: say so wherever a
// plan measured from it is published (NOTICE.md).
import fs from "node:fs";
import path from "node:path";

const [bbox, level = "0", axisRoom = "", filter = "."] = process.argv.slice(2);
if (!bbox) {
  console.error("usage: node scripts/osm-rooms.mjs <south,west,north,east> <level> [axisRoom] [filter]");
  process.exit(1);
}
const UA = process.env.WIKI_USER_AGENT ?? "timeline-museum/0.1 (floor plan survey)";
const HOSTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

// OSM_CACHE=<folder>: keep what the survey answered there and read it back the next time (the survey's servers
// are slow and turn away a caller who asks often).
const CACHE = process.env.OSM_CACHE;
async function overpass(query, name) {
  const file = CACHE ? path.join(CACHE, `${name}-${bbox}-.json`.replace(/[^\w.-]+/g, "_")) : null;
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  let last;
  for (let round = 0; round < 3; round++) {
    for (const host of HOSTS) {
      try {
        const res = await fetch(host, {
          method: "POST",
          headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query),
          signal: AbortSignal.timeout(75000),
        });
        if (res.ok) {
          const json = await res.json();
          if (file) {
            fs.mkdirSync(CACHE, { recursive: true });
            fs.writeFileSync(file, JSON.stringify(json));
          }
          return json;
        }
        last = new Error(`${host}: ${res.status}`);
      } catch (e) {
        last = e;
      }
      console.error(`  (${host.split("/")[2]}: ${String(last.message ?? last).slice(0, 60)}; trying the next)`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw last;
}

const rooms = (await overpass(`[out:json][timeout:60];(way["indoor"](${bbox});way["room"](${bbox}););out tags geom;`, "rooms")).elements;
await new Promise((r) => setTimeout(r, 3000));
const doors = (await overpass(`[out:json][timeout:60];(node["door"](${bbox});node["indoor"="door"](${bbox});node["entrance"](${bbox}););out body;`, "doors")).elements;

const [s, w, n, e] = bbox.split(",").map(Number);
const LAT0 = (s + n) / 2;
const LON0 = (w + e) / 2;
const KY = 111320;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const xy = (p) => [(p.lon - LON0) * KX, (p.lat - LAT0) * KY];
const onLevel = (el) => String(el.tags?.level ?? "").split(";").includes(level);
const named = (el) => `${el.tags?.ref ?? ""} ${el.tags?.name ?? ""}`.trim();

const ways = rooms.filter((el) => el.type === "way" && el.geometry && onLevel(el) && ["room", "area", "corridor"].includes(el.tags?.indoor));
if (!ways.length) {
  console.error(`no indoor rooms on level ${level} in that box (levels found: ${[...new Set(rooms.map((el) => el.tags?.level))].join(", ")})`);
  process.exit(1);
}
// the building's axis: along the longest edges of the axis room (or of the longest room)
const span = (el) => {
  const pts = el.geometry.map(xy);
  let best = 0;
  for (const a of pts) for (const b of pts) best = Math.max(best, Math.hypot(b[0] - a[0], b[1] - a[1]));
  return best;
};
const axis = ways.find((el) => axisRoom && named(el).toLowerCase().includes(axisRoom.toLowerCase())) ?? ways.reduce((a, b) => (span(b) > span(a) ? b : a));
let sx = 0;
let sy = 0;
{
  const pts = axis.geometry.map(xy);
  let far = { d: 0, a: 0 };
  for (const a of pts) for (const b of pts) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d > far.d) far = { d, a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    let rel = Math.atan2(dy, dx) - far.a;
    while (rel > Math.PI / 4) rel -= Math.PI / 2;
    while (rel < -Math.PI / 4) rel += Math.PI / 2;
    if (Math.abs(rel) < 0.2) {
      sx += len * len * Math.cos(far.a + rel);
      sy += len * len * Math.sin(far.a + rel);
    }
  }
}
const A = Math.atan2(sy, sx);
const c = Math.cos(-A);
const sn = Math.sin(-A);
const uv = (p) => {
  const [x, y] = xy(p);
  return [x * c - y * sn, x * sn + y * c];
};
console.log(`axis: ${named(axis)} (${((A * 180) / Math.PI).toFixed(1)} degrees from east); u runs along it, v across (metres)`);

const levelDoors = doors.filter((d) => d.type === "node" && onLevel(d)).map((d) => ({ uv: uv(d), door: d.tags.door ?? d.tags.entrance ?? d.tags.indoor ?? "" }));
const re = new RegExp(filter, "i");
/** A room in its own frame: the turn of its walls from the building's axis (by its long edges, within 45 degrees),
 *  its centre, and its extent along (a, the building's u more or less) and across (b). */
const own = (g) => {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < g.length - 1; i++) {
    const dx = g[i + 1][0] - g[i][0];
    const dy = g[i + 1][1] - g[i][1];
    const len = Math.hypot(dx, dy);
    let t = Math.atan2(dy, dx);
    while (t > Math.PI / 4) t -= Math.PI / 2;
    while (t < -Math.PI / 4) t += Math.PI / 2;
    cx += len * len * Math.cos(4 * t);
    cy += len * len * Math.sin(4 * t);
  }
  const turn = Math.atan2(cy, cx) / 4;
  const co = Math.cos(-turn);
  const si = Math.sin(-turn);
  const rot = (p) => [p[0] * co - p[1] * si, p[0] * si + p[1] * co];
  const q = g.map(rot);
  const as = q.map((p) => p[0]);
  const bs = q.map((p) => p[1]);
  const a0 = Math.min(...as);
  const a1 = Math.max(...as);
  const b0 = Math.min(...bs);
  const b1 = Math.max(...bs);
  return { turn, rot, a0, a1, b0, b1, ca: (a0 + a1) / 2, cb: (b0 + b1) / 2 };
};
const out = ways
  .map((el) => {
    const g = el.geometry.map(uv);
    const us = g.map((p) => p[0]);
    const vs = g.map((p) => p[1]);
    return { name: named(el) || `(${el.id})`, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs), own: own(g) };
  })
  .filter((r) => re.test(r.name))
  .sort((a, b) => a.u0 - b.u0);
const f = (x) => x.toFixed(1).padStart(7);
for (const r of out) {
  const near = levelDoors.filter((d) => d.uv[0] >= r.u0 - 0.8 && d.uv[0] <= r.u1 + 0.8 && d.uv[1] >= r.v0 - 0.8 && d.uv[1] <= r.v1 + 0.8);
  console.log(`u ${f(r.u0)}..${f(r.u1)}  v ${f(r.v0)}..${f(r.v1)}  ${(r.u1 - r.u0).toFixed(1).padStart(6)} x ${(r.v1 - r.v0).toFixed(1).padStart(5)}  ${r.name}`);
  // the room itself: along (east-west, more or less) by across, its turn, its centre in the building's frame, and
  // its doors: the wall (w, e: at a place across, north positive; s, n: at a place along, east positive), from
  // the room's centre
  const o = r.own;
  const [cu, cv] = [o.ca * Math.cos(o.turn) - o.cb * Math.sin(o.turn), o.ca * Math.sin(o.turn) + o.cb * Math.cos(o.turn)];
  const mine = [];
  for (const d of near) {
    const [a, b] = o.rot(d.uv);
    const off = [["w", Math.abs(a - o.a0), b - o.cb], ["e", Math.abs(a - o.a1), b - o.cb], ["s", Math.abs(b - o.b0), a - o.ca], ["n", Math.abs(b - o.b1), a - o.ca]];
    const [side, gap, at] = off.reduce((p, q) => (q[1] < p[1] ? q : p));
    if (gap < 1.2 && a > o.a0 - 1.2 && a < o.a1 + 1.2 && b > o.b0 - 1.2 && b < o.b1 + 1.2) mine.push(`${side} ${at >= 0 ? "+" : ""}${at.toFixed(1)}`);
  }
  console.log(`      itself ${(o.a1 - o.a0).toFixed(1)} x ${(o.b1 - o.b0).toFixed(1)}, turned ${((o.turn * 180) / Math.PI).toFixed(1)} degrees, centre (${cu.toFixed(1)}, ${cv.toFixed(1)})${mine.length ? "; doors: " + mine.join(", ") : ""}`);
  if (near.length) console.log(`      doors: ${near.map((d) => `(${d.uv[0].toFixed(1)}, ${d.uv[1].toFixed(1)}${d.door && d.door !== "no" ? " " + d.door : ""})`).join(" ")}`);
}
console.log(`${out.length} rooms, ${levelDoors.length} doors on level ${level}. © OpenStreetMap contributors, ODbL.`);
