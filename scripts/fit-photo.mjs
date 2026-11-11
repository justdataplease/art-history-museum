// Where a photograph of a room was taken from: the camera's place, the way it looked and its lens, found from
// places marked on the photograph whose position in the room is known (a corner of the skylight, the foot of the
// cornice on the room's axis). A space lays the photograph on the room's surfaces from there (src/lib/spaces.ts
// `photos`: the stucco of a ceiling as it is), so what is marked lands where the room has it.
//
//   node scripts/fit-photo.mjs marks.json
//
// marks.json:
//   { "size": [w, h],                       the photograph, in the pixels the marks are read in
//     "guess": { "eye": [x, y, z], "yaw": 0, "pitch": 0.6, "fov": 50 },   roughly where and how it was taken
//     "fix": { "fov": 46.4, "roll": 0, "y": 1.6 },                        what is known (optional)
//     "marks": [ { "px": [u, v], "at": [x, y, z], "name": "glass corner" },
//                { "px": [u, v], "at": [null, y, z] } ] }                  null: anywhere along that axis (a point
//                                                                         on a moulding that runs along the wall)
// Plan metres: x east, y up, z south. yaw 0 looks north (−z), π/2 west; pitch up; roll about the view; fov the
// vertical field of view in degrees (the lens: 2 atan(sensor height / 2 / focal length)). The same turn order as
// the gallery's camera (three.js, "YXZ").
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** World point → pixel, for a camera { eye, yaw, pitch, roll, fov } and a picture [w, h]; null behind it. */
export function project(cam, size, p) {
  const [w, h] = size;
  const dx = p[0] - cam.eye[0];
  const dy = p[1] - cam.eye[1];
  const dz = p[2] - cam.eye[2];
  // undo yaw (about y), then pitch (about x), then roll (about z)
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const x1 = cy * dx - sy * dz;
  const z1 = sy * dx + cy * dz;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const y2 = cp * dy + sp * z1;
  const z2 = -sp * dy + cp * z1;
  const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
  const x3 = cr * x1 + sr * y2;
  const y3 = -sr * x1 + cr * y2;
  if (z2 > -1e-6) return null;
  const f = h / 2 / Math.tan((cam.fov * Math.PI) / 360);
  return [w / 2 + (f * x3) / -z2, h / 2 - (f * y3) / -z2];
}

/** The camera that best puts the marks where they were read: Levenberg–Marquardt on the misses in pixels. */
export function fit({ size, guess, fix = {}, marks }) {
  const names = ["x", "y", "z", "yaw", "pitch", "roll", "fov"].filter((k) => fix[k] === undefined);
  const start = { x: guess.eye[0], y: guess.eye[1], z: guess.eye[2], yaw: guess.yaw ?? 0, pitch: guess.pitch ?? 0, roll: guess.roll ?? 0, fov: guess.fov ?? 55, ...fix };
  // a mark's free coordinates are unknowns too
  const free = [];
  marks.forEach((m, i) => m.at.forEach((v, k) => v === null && free.push([i, k])));
  const camOf = (p) => {
    const c = { ...start };
    names.forEach((k, i) => (c[k] = p[i]));
    return { eye: [c.x, c.y, c.z], yaw: c.yaw, pitch: c.pitch, roll: c.roll, fov: c.fov };
  };
  const pointsOf = (p) => {
    const pts = marks.map((m) => [...m.at]);
    free.forEach(([i, k], j) => (pts[i][k] = p[names.length + j]));
    return pts;
  };
  const residuals = (p) => {
    const cam = camOf(p);
    const pts = pointsOf(p);
    const r = [];
    marks.forEach((m, i) => {
      const q = project(cam, size, pts[i]);
      r.push(q ? q[0] - m.px[0] : 1e4, q ? q[1] - m.px[1] : 1e4);
    });
    return r;
  };
  const cost = (r) => r.reduce((s, v) => s + v * v, 0);
  // a free coordinate starts where the mark says it is near, else by the camera
  let p = [...names.map((k) => start[k]), ...free.map(([i, k]) => marks[i].near?.[k] ?? start[["x", "y", "z"][k]])];
  let r = residuals(p);
  let c = cost(r);
  let lambda = 1e-2;
  for (let iter = 0; iter < 400; iter++) {
    const n = p.length;
    const J = [];
    for (let j = 0; j < n; j++) {
      const h = Math.max(1e-5, Math.abs(p[j]) * 1e-6);
      const a = [...p];
      const b = [...p];
      a[j] += h;
      b[j] -= h;
      const ra = residuals(a);
      const rb = residuals(b);
      J.push(ra.map((v, i) => (v - rb[i]) / (2 * h)));
    }
    const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => J[i].reduce((s, v, k) => s + v * J[j][k], 0)));
    const g = J.map((col) => col.reduce((s, v, k) => s + v * r[k], 0));
    let stepped = false;
    for (let tries = 0; tries < 12 && !stepped; tries++) {
      const M = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-9 : v)));
      const d = solve(M, g.map((v) => -v));
      if (d) {
        const q = p.map((v, i) => v + d[i]);
        const rq = residuals(q);
        const cq = cost(rq);
        if (cq < c) {
          stepped = Math.abs(c - cq) > 1e-10 * c;
          p = q;
          r = rq;
          c = cq;
          lambda = Math.max(1e-9, lambda / 3);
          if (!stepped) tries = 99;
          continue;
        }
      }
      lambda *= 4;
    }
    if (!stepped) break;
  }
  const cam = camOf(p);
  const pts = pointsOf(p);
  const miss = marks.map((_, i) => Math.hypot(r[2 * i], r[2 * i + 1]));
  return { cam, points: pts, miss, rms: Math.sqrt(c / marks.length) };
}

/** Gaussian elimination with pivoting; null when singular. */
function solve(M, b) {
  const n = b.length;
  const a = M.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let best = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(a[k][i]) > Math.abs(a[best][i])) best = k;
    if (Math.abs(a[best][i]) < 1e-14) return null;
    [a[i], a[best]] = [a[best], a[i]];
    for (let k = i + 1; k < n; k++) {
      const f = a[k][i] / a[i][i];
      for (let j = i; j <= n; j++) a[k][j] -= f * a[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = a[i][n];
    for (let j = i + 1; j < n; j++) s -= a[i][j] * x[j];
    x[i] = s / a[i][i];
  }
  return x;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/fit-photo.mjs marks.json");
    process.exit(1);
  }
  const input = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = fit(input);
  const f = (v) => +v.toFixed(3);
  console.log(`eye: [${out.cam.eye.map(f).join(", ")}], yaw: ${f(out.cam.yaw)}, pitch: ${f(out.cam.pitch)}, roll: ${f(out.cam.roll)}, fov: ${f(out.cam.fov)},`);
  console.log(`misses (pixels of ${input.size.join(" x ")}), rms ${out.rms.toFixed(1)}:`);
  input.marks.forEach((m, i) => console.log(`  ${out.miss[i].toFixed(1).padStart(6)}  ${m.name ?? ""}  at [${out.points[i].map(f).join(", ")}]`));
}
