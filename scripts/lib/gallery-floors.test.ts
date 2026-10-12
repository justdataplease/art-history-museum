import assert from "node:assert/strict";
import { test } from "node:test";
import type { Painting } from "../../src/lib/types";
import { buildLayout, type LayoutOptions } from "../../src/components/museum/layout";
import { MAX_ROOMS_PER_FLOOR, splitGalleryFloors } from "../../src/components/museum/gallery-floors";

const works = (count: number, phases = 0): Painting[] => Array.from({ length: count }, (_, i) => ({
  slug: `work-${i}`, title: `Work ${i}`, year: i % 9 === 0 ? null : 1800 + i,
  imageUrl: null, imageWidth: 800, imageHeight: 600, story: "", facts: [], wikipediaUrl: null,
  pageviews: i === Math.floor(count / 2) ? 1e6 : i,
  ...(phases ? { phase: i % phases } : {}),
}));

test("every floor has at most six rooms, with each work present exactly once", () => {
  for (const scale of ["painting", "print", "miniature", "scroll", "icon"] as const) {
    for (const count of [1, 12, 71, 72, 73, 84, 85, 145, 2100]) {
      for (const phaseCount of [0, 3, 17]) {
        for (const films of [false, true]) {
          const paintings = works(count, phaseCount);
          const before = [...paintings];
          const options: LayoutOptions = { works: scale, films, phases: Array.from({ length: phaseCount }, (_, i) => `Phase ${i}`) };
          const floors = splitGalleryFloors(paintings, options);
          assert.deepEqual(paintings, before, "input order unchanged");
          assert.deepEqual(floors.flat().map(p => p.slug).sort(), paintings.map(p => p.slug).sort());
          for (const [i, floor] of floors.entries()) {
            const layout = buildLayout(floor, { ...options, films: films && i === 0, elevator: floors.length > 1, exits: true });
            assert(layout.rooms.length <= MAX_ROOMS_PER_FLOOR, `${scale}/${count}/${phaseCount}/${films}/floor${i + 1}`);
            assert.equal(layout.placements.length, floor.length);
          }
          if (buildLayout(paintings, options).rooms.length <= MAX_ROOMS_PER_FLOOR) assert.equal(floors[0], paintings);
        }
      }
    }
  }
});

test("a curated order is preserved within each floor and an empty gallery stays empty", () => {
  const paintings = works(145).reverse();
  const order = new Map(paintings.map((p, i) => [p.slug, i]));
  for (const floor of splitGalleryFloors(paintings, { keepOrder: true })) {
    const positions = floor.map(p => order.get(p.slug)!);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  }
  assert.deepEqual(splitGalleryFloors([]), [[]]);
});
