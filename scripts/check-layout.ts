// Guard catalogue growth: every work hangs once, with a bounded number of
// works per room and navigation that reaches the full suite.
import assert from "node:assert/strict";
import { buildLayout, pathDistance, roomAt } from "../src/components/museum/layout";
import type { Painting } from "../src/lib/types";
import type { WorkScale } from "../src/components/museum/theme";

function paintings(n: number): Painting[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `work-${i}`,
    title: `Work ${i}`,
    year: i === 0 ? 1400 : 1600 + i % 80,
    imageUrl: `https://example.org/work-${i}.jpg`,
    imageWidth: 800,
    imageHeight: 600,
    widthCm: 80,
    heightCm: 60,
    pageviews: i === 0 ? 10_000 : 0,
    story: "",
    facts: [],
    wikipediaUrl: null,
  }));
}

const scales: WorkScale[] = ["painting", "scroll", "print", "miniature", "icon"];
let checked = 0;
for (const works of scales) {
  for (const n of [0, 1, 13, 409, 2000, 10_000]) {
    const layout = buildLayout(paintings(n), { works });
    assert.equal(layout.placements.length, n, `${works}/${n}: every work hangs`);
    assert.equal(new Set(layout.placements.map((p) => p.painting.slug)).size, n, "no duplicates");
    const counts = new Array<number>(layout.rooms.length).fill(0);
    for (const p of layout.placements) {
      counts[p.room]++;
      const room = layout.rooms[p.room];
      assert(p.position.every(Number.isFinite), "finite placement coordinates");
      assert(p.position[2] >= room.z0 && p.position[2] <= room.z1, "work inside its room");
    }
    assert(counts.every((count) => count <= (works === "print" ? 14 : 12)), "bounded works per room");
    assert.equal(layout.doorways.length, layout.rooms.length - 1, "all rooms connected");
    for (const room of layout.rooms) {
      assert.equal(roomAt(layout, (room.z0 + room.z1) / 2), room.index, "every room reachable");
    }
    for (const [i, door] of layout.doorways.entries()) {
      assert.equal(roomAt(layout, door.z), i, "door centre belongs to the preceding room");
      assert.equal(roomAt(layout, door.z - 1e-6), i + 1, "door crossing reaches the next room");
    }
    const first = layout.rooms[0];
    const last = layout.rooms.at(-1)!;
    const a = { x: 0, z: (first.z0 + first.z1) / 2 };
    const b = { x: 0, z: (last.z0 + last.z1) / 2 };
    assert(Math.abs(pathDistance(a, b, layout) - Math.abs(b.z - a.z)) < 1e-8, "aligned doors make a straight walk");
    const forward = pathDistance({ ...a, x: 1 }, { ...b, x: -1 }, layout);
    const reverse = pathDistance({ ...b, x: -1 }, { ...a, x: 1 }, layout);
    assert(Math.abs(forward - reverse) < 1e-8, "walking distance is symmetric");
    if (n > 1) assert(layout.rooms[0].years![0] >= 1600, "flagship excluded from chapter dates");
    checked++;
  }
}

const undated = paintings(3).map((p, i) => ({ ...p, year: i === 0 ? 1400 : null }));
assert.deepEqual(buildLayout(undated).rooms[0].years, [1400, 1400], "flagship supplies an undated room's span");
assert.equal(buildLayout(undated.map((p) => ({ ...p, year: null }))).rooms[0].years, null);
console.log(`PASS: ${checked} catalogue layouts through 10,000 works; complete, bounded rooms and valid dates/navigation.`);
