// A photograph of a real room beside the model from the same place: one picture for each view of a views file,
// the photograph on the left, the model's screenshot (scripts/shot-space.mjs --views) on the right, at one
// height. What one looks at while matching a recreated building to the real one (the recreate-a-space skill).
// The photographs stay in the scratch folder they were downloaded to; so do these.
//
//   node scripts/pair-shots.mjs <views.json> <photoDir> <shotDir> <prefix> <outDir> [name ...]
//
// views.json: [{ name, ref: "path/of/photo.jpg" (under photoDir), x, z, yaw, pitch, roll?, fov, y?, size }]:
// each photograph's own camera (scripts/fit-photo.mjs finds it), as shot-space.mjs takes them.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [viewsFile, photoDir, shotDir, prefix, outDir, ...only] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: node scripts/pair-shots.mjs <views.json> <photoDir> <shotDir> <prefix> <outDir> [name ...]");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const H = 620;
for (const v of JSON.parse(fs.readFileSync(viewsFile, "utf8"))) {
  if (only.length && !only.includes(v.name)) continue;
  const shot = path.join(shotDir, `${prefix}-${v.name}.png`);
  const photo = path.join(photoDir, v.ref ?? "");
  if (!v.ref || !fs.existsSync(shot) || !fs.existsSync(photo)) {
    console.log("skipped", v.name);
    continue;
  }
  const a = await sharp(photo).resize({ height: H }).toBuffer({ resolveWithObject: true });
  const b = await sharp(shot).resize({ height: H }).toBuffer({ resolveWithObject: true });
  const file = path.join(outDir, `${v.name}.jpg`);
  await sharp({ create: { width: a.info.width + b.info.width + 8, height: H, channels: 3, background: "#141414" } })
    .composite([
      { input: a.data, left: 0, top: 0 },
      { input: b.data, left: a.info.width + 8, top: 0 },
    ])
    .jpeg({ quality: 86 })
    .toFile(file);
  console.log("pair", v.name, "(photograph | model)", file);
}
