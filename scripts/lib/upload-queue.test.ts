import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleUpload } from "../../src/components/museum/exhibit-texture";

test("painting uploads are paced, prioritized and cancellable", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const savedRaf = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  const savedCancel = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (cb: FrameRequestCallback) => { frames.set(++id, cb); return id; },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (key: number) => frames.delete(key),
  });
  t.after(() => {
    if (savedRaf) Object.defineProperty(globalThis, "requestAnimationFrame", savedRaf);
    else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    if (savedCancel) Object.defineProperty(globalThis, "cancelAnimationFrame", savedCancel);
    else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
  });
  const frame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((cb) => cb(0));
  };

  await t.test("entrance and inspect overtake thumbnails, with FIFO within each priority", () => {
    const done: string[] = [];
    for (const [name, priority] of [
      ["thumbnail", "low"], ["wall", "auto"], ["entrance", "high"], ["inspect", "high"],
    ] as const) scheduleUpload(() => done.push(name), priority);
    assert.deepEqual(done, []);
    frame();
    assert.deepEqual(done, ["entrance"]);
    frame();
    assert.deepEqual(done, ["entrance", "inspect"]);
    frame();
    frame();
    assert.deepEqual(done, ["entrance", "inspect", "wall", "thumbnail"]);
    assert.equal(frames.size, 0);
  });

  await t.test("cancelled jobs do not delay a visible painting by any frames", () => {
    const done: string[] = [];
    for (let i = 0; i < 50; i++) {
      const cancel = scheduleUpload(() => done.push("stale"), "high");
      cancel();
      cancel();
    }
    scheduleUpload(() => done.push("visible"));
    frame();
    assert.deepEqual(done, ["visible"]);
    assert.equal(frames.size, 0);
  });

  await t.test("the hidden-tab fallback runs once and cancels its animation frame", () => {
    let runs = 0;
    scheduleUpload(() => runs++);
    t.mock.timers.tick(120);
    assert.equal(runs, 1);
    assert.equal(frames.size, 0);
    frame();
    t.mock.timers.tick(120);
    assert.equal(runs, 1);
  });

  await t.test("an animation frame cancels the timeout, preserving upload spacing", () => {
    const done: string[] = [];
    scheduleUpload(() => done.push("first"));
    t.mock.timers.tick(100);
    frame();
    scheduleUpload(() => done.push("second"));
    t.mock.timers.tick(20);
    assert.deepEqual(done, ["first"]);
    frame();
    assert.deepEqual(done, ["first", "second"]);
  });

  await t.test("the same callback can be scheduled twice and new jobs wait for another frame", () => {
    let runs = 0;
    const job = () => runs++;
    scheduleUpload(job);
    scheduleUpload(job);
    scheduleUpload(() => scheduleUpload(job, "high"));
    frame();
    assert.equal(runs, 1);
    frame();
    assert.equal(runs, 2);
    frame();
    assert.equal(runs, 2);
    frame();
    assert.equal(runs, 3);
    assert.equal(frames.size, 0);
  });
});
