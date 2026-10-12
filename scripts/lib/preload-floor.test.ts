import assert from "node:assert/strict";
import { test } from "node:test";
import type { Painting } from "../../src/lib/types";
import { preloadFloorImages } from "../../src/components/museum/preload-floor";

const works = Array.from({ length: 5 }, (_, i) => ({
  slug: `work-${i}`, imageUrl: `https://uploads0.wikiart.org/images/artist/work-${i}.jpg`,
  imageWidth: 800, imageHeight: 600,
} as Painting));

test("floor preloading is bounded, deferred and cancelled on departure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const requests: { url: string; options: RequestInit; finish: (r: Response) => void }[] = [];
  t.mock.method(globalThis, "fetch", (url: string, options: RequestInit) => new Promise<Response>(finish => requests.push({ url, options, finish })));
  const cancel = preloadFloorImages(works);
  assert.equal(requests.length, 0, "entrance gets priority");
  t.mock.timers.tick(1500);
  assert.equal(requests.length, 2, "at most two downloads at once");
  assert(requests.every(r => r.options.priority === "low"));
  requests[0].finish(new Response("image"));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(requests.length, 3, "one completion starts one more image");
  cancel();
  assert(requests.every(r => r.options.signal?.aborted));
  requests.slice(1).forEach(r => r.finish(new Response("image")));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(requests.length, 3, "remaining floor images were not fetched");
  assert(requests.every(r => works.some(p => r.url.includes(p.slug))), "only this floor's images");
});

test("leaving before the entrance settles starts no speculative downloads", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("image"));
  preloadFloorImages(works)();
  t.mock.timers.tick(2000);
  assert.equal(fetch.mock.callCount(), 0);
});

test("data saver skips preloading and a busy host stops the whole floor queue", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
  t.after(() => { Reflect.deleteProperty(navigator, "connection"); });
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 429 }));
  preloadFloorImages(works);
  t.mock.timers.tick(1500);
  assert.equal(fetch.mock.callCount(), 0);
  Reflect.deleteProperty(navigator, "connection");
  const cancel = preloadFloorImages(works);
  t.mock.timers.tick(1500);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(fetch.mock.callCount(), 2);
  cancel();
});
