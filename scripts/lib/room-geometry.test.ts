import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GeoBatch, setRoomWindow } from "../../src/components/museum/room-geometry";

test("deferring temporary room bounds preserves hall geometry, bounds and room draw ranges", () => {
  for (const colored of [false, true]) {
    const rooms = () => [
      new GeoBatch(null, colored).box(2, 3, 0.2, -4, 1.5, 10),
      new GeoBatch(null, colored),
      new GeoBatch(null, colored).roundedBox(1, 0.5, 2, 3, 0.25, -10, 0.05, 2, Math.PI / 4),
    ];
    // Reference: compute bounds for every room before the final merge.
    const separate = rooms().map((room) => room.build());
    const expected = mergeGeometries(separate.filter((g) => g.index), false)!;
    expected.computeBoundingBox();
    expected.computeBoundingSphere();
    const unbounded = rooms().map((room) => room.build(false));
    assert(unbounded.every((g) => g.boundingBox === null && g.boundingSphere === null));
    const actual = mergeGeometries(unbounded.filter((g) => g.index), false)!;
    actual.computeBoundingBox();
    actual.computeBoundingSphere();
    let start = 0;
    const ranges = unbounded.map((room) => {
      const count = room.index?.count ?? 0;
      const range = { start, count };
      start += count;
      return range;
    });
    assert.deepEqual(Object.keys(actual.attributes), Object.keys(expected.attributes));
    for (const name of Object.keys(expected.attributes)) {
      assert.deepEqual(actual.getAttribute(name).array, expected.getAttribute(name).array, name);
    }
    assert.deepEqual(actual.index!.array, expected.index!.array);
    assert.deepEqual(actual.boundingBox, expected.boundingBox);
    assert.deepEqual(actual.boundingSphere, expected.boundingSphere);
    assert(separate.filter(g => g.index).every(g => g.boundingSphere !== null), "standalone room bounds remain available");
    assert.equal(ranges[1].count, 0);
    assert.equal(ranges[1].start, ranges[2].start);
    assert.equal(start, actual.index!.count);
    setRoomWindow(actual, ranges, [1, 2]);
    assert.deepEqual(actual.drawRange, { start: ranges[2].start, count: ranges[2].count });
    setRoomWindow(actual, ranges, [1, 1]);
    assert.equal(actual.drawRange.count, 0, "an empty room draws no neighbouring room");
    setRoomWindow(actual, ranges, null);
    assert.deepEqual(actual.drawRange, { start: 0, count: Infinity });
    for (const geometry of [...separate, ...unbounded, expected, actual]) geometry.dispose();
  }
});
