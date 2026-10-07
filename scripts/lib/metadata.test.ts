import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPacer, fetchJson, sleep } from "./wiki";
import { fetchFileMeta } from "./credits";
import { fetchClaims } from "./passes";
import { enrichArtists, imageFileInfo, type EnrichableArtist } from "./enrich";

async function withFetch(fn: typeof fetch, run: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousCache = process.env.WIKI_HTTP_CACHE;
  globalThis.fetch = fn;
  delete process.env.WIKI_HTTP_CACHE;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCache === undefined) delete process.env.WIKI_HTTP_CACHE;
    else process.env.WIKI_HTTP_CACHE = previousCache;
  }
}

function requests(delay: number, body: (params: URLSearchParams) => unknown) {
  let active = 0;
  let peak = 0;
  const starts: number[] = [];
  const finishes: number[] = [];
  const fetch: typeof globalThis.fetch = async (url) => {
    const index = starts.length;
    starts.push(Date.now());
    peak = Math.max(peak, ++active);
    await sleep(index === 0 ? delay : 10);
    active--;
    finishes.push(index);
    return new Response(JSON.stringify(body(new URL(String(url)).searchParams)));
  };
  return { fetch, starts, finishes, peak: () => peak };
}

function verifyPacing(probe: ReturnType<typeof requests>, interval: number) {
  assert.equal(probe.peak(), 2);
  assert.notEqual(probe.finishes[0], 0, "later batches should finish before the slow first batch");
  for (let i = 1; i < probe.starts.length; i++) {
    const tolerance = Math.min(20, interval / 4); // timer scheduling differs across platforms
    assert.ok(probe.starts[i] - probe.starts[i - 1] >= interval - tolerance, `request starts remain spaced: ${probe.starts.map(s => s - probe.starts[0]).join(", ")}`);
  }
}

test("pacer frees a slot after an error and spaces bounded concurrent requests", async () => {
  const run = createPacer(2, 20);
  let active = 0;
  let peak = 0;
  const starts: number[] = [];
  const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => run(async () => {
    starts.push(Date.now());
    peak = Math.max(peak, ++active);
    await sleep(60);
    active--;
    if (index === 0) throw new Error("source error");
    return index;
  })));
  assert.equal(peak, 2);
  assert.equal(results[0].status, "rejected");
  assert.deepEqual(results.slice(1).map(r => r.status === "fulfilled" ? r.value : null), [1, 2, 3]);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 15);
});

test("warm metadata responses consume no paced network slots or artificial batch delay", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "museum-metadata-test-"));
  const files = Array.from({ length: 101 }, (_, i) => ({ project: "commons", file: `File${i}.jpg` }));
  const urls = files.map(f => `https://upload.wikimedia.org/wikipedia/commons/a/ab/${f.file}`);
  const qids = files.map((_, i) => `Q${i + 1}`);
  let networkRequests = 0;
  let pacedSlots = 0;
  const pace = async <T>(request: () => Promise<T>) => { pacedSlots++; return request(); };
  try {
    await withFetch(async url => {
      networkRequests++;
      const params = new URL(String(url)).searchParams;
      const body = params.has("ids")
        ? { entities: Object.fromEntries(params.get("ids")!.split("|").map(qid => [qid, { claims: {} }])) }
        : { query: { pages: (params.get("titles")?.split("|") ?? []).map(title => ({ title, imageinfo: [{ size: 1000, width: 1200, height: 1000, extmetadata: { LicenseShortName: { value: "Public domain" } } }] })) } };
      return new Response(JSON.stringify(body));
    }, async () => {
      process.env.WIKI_HTTP_CACHE = directory;
      const probeUrl = "https://commons.wikimedia.org/w/api.php?action=query&test=cache-hit";
      await fetchJson(probeUrl, {}, undefined, pace);
      await fetchFileMeta(urls, { spacingMs: 0 });
      await imageFileInfo(files);
      await fetchClaims(qids, ["P31"]);
      const coldNetworkRequests = networkRequests;
      const start = Date.now();
      await fetchJson(probeUrl, {}, undefined, pace);
      const meta = await fetchFileMeta(urls, { spacingMs: 1000 });
      const info = await imageFileInfo(files);
      const claims = await fetchClaims(qids, ["P31"]);
      const artist: EnrichableArtist = { slug: "painter", name: "Painter", qid: "Q9999", birthYear: null, deathYear: null, paintings: qids.map(qid => ({ qid, slug: qid, title: qid, year: null, imageUrl: null, imageWidth: null, imageHeight: null, wikipediaUrl: null })) };
      const report = await enrichArtists([artist], { log: () => {} });
      assert.equal(pacedSlots, 1, "only the first uncached probe may acquire a paced network slot");
      assert.equal(networkRequests, coldNetworkRequests);
      assert.equal(meta.size, 101);
      assert.equal(info.size, 101);
      assert.equal(claims.size, 101);
      assert.deepEqual(report.failures, []);
      assert.ok(Date.now() - start < 800, "all four warm metadata callers should bypass their request-start delays");
    });
  } finally {
    for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file));
    fs.rmdirSync(directory);
  }
});

test("credit batches retain URL order, normalized names and missing-file semantics", async () => {
  const urls = Array.from({ length: 101 }, (_, i) => `https://upload.wikimedia.org/wikipedia/commons/a/ab/File${i}.jpg`);
  const probe = requests(100, params => {
    const titles = params.get("titles")!.split("|");
    return { query: {
      normalized: [{ from: "File:File0.jpg", to: "File:Normalized.jpg" }],
      pages: titles.map(title => title === "File:File100.jpg" ? { title, missing: true } : {
        title: title === "File:File0.jpg" ? "File:Normalized.jpg" : title,
        imageinfo: [{ extmetadata: {
          Artist: { value: "<b>Painter</b>" },
          LicenseShortName: { value: "Public domain" },
          ImageDescription: { value: title },
        } }],
      }),
    } };
  });
  await withFetch(probe.fetch, async () => {
    const result = await fetchFileMeta(urls, { spacingMs: 20 });
    assert.deepEqual([...result.keys()], urls.slice(0, 100));
    assert.equal(result.get(urls[0])!.credit.author, "Painter");
    assert.match(result.get(urls[0])!.credit.page, /File:Normalized\.jpg$/);
    assert.equal(result.get(urls[60])!.description, "File:File60.jpg");
    verifyPacing(probe, 20);
  });
});

test("long Unicode filename batches split while unaffected cache URLs stay identical", async () => {
  const files = Array.from({ length: 101 }, (_, i) => i >= 50 && i < 100 ? `Поленов Русская деревня ${"Деревня".repeat(7)} ${i}.jpg` : `Short${i}.jpg`);
  const urls = files.map(file => `https://upload.wikimedia.org/wikipedia/commons/a/ab/${encodeURIComponent(file)}`);
  const requests: URL[] = [];
  await withFetch(async url => {
    const request = new URL(String(url));
    requests.push(request);
    assert.ok(String(url).length <= 6000, "encoded requests must fit below the server request-line limit");
    return new Response(JSON.stringify({ query: { pages: request.searchParams.get("titles")!.split("|").map(title => ({
      title, imageinfo: [{ size: 1234, width: 2000, height: 1500, extmetadata: { ObjectName: { value: title } } }],
    })) } }));
  }, async () => {
    const meta = await fetchFileMeta(urls, { spacingMs: 0 });
    const creditRequests = [...requests];
    assert.ok(creditRequests.length > 3);
    const unchangedUrl = (batch: string[]) => `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
      action: "query", format: "json", formatversion: "2", prop: "imageinfo", iiprop: "extmetadata",
      iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ObjectName|ImageDescription|Categories|NonFree",
      iiextmetadatalanguage: "en", titles: batch.map(file => `File:${file}`).join("|"),
    })}`;
    assert.equal(creditRequests[0].href, unchangedUrl(files.slice(0, 50)));
    assert.equal(creditRequests.at(-1)!.href, unchangedUrl(files.slice(100)));
    assert.deepEqual([...meta.keys()], urls);
    requests.length = 0;
    const info = await imageFileInfo(files.map(file => ({ project: "commons", file })));
    assert.ok(requests.length > 3);
    assert.deepEqual([...info.keys()], files.map(file => `commons|${file}`));
  });
});

test("image-size batches retain file order and exact metadata despite completion order", async () => {
  const files = Array.from({ length: 101 }, (_, i) => ({ project: "commons", file: `File${i}.jpg` }));
  const probe = requests(650, params => ({ query: { pages: params.get("titles")!.split("|").map(title => ({
    title, imageinfo: [{ size: 1234, width: 2000, height: 1500 }],
  })) } }));
  await withFetch(probe.fetch, async () => {
    const result = await imageFileInfo(files);
    assert.deepEqual([...result.keys()], files.map(f => `${f.project}|${f.file}`));
    assert.deepEqual(result.get("commons|File75.jpg"), { bytes: 1234, width: 2000, height: 1500 });
    verifyPacing(probe, 250);
  });
});

test("repair claims preserve QID order, selected properties and missing items", async () => {
  const ids = Array.from({ length: 101 }, (_, i) => `Q${i + 1}`);
  const probe = requests(650, params => ({ entities: Object.fromEntries(params.get("ids")!.split("|").map(id => [id,
    id === "Q101" ? { missing: "" } : { claims: { P31: [{ value: id }], P18: [{ value: "unused" }] } },
  ])) }));
  await withFetch(probe.fetch, async () => {
    const result = await fetchClaims([...ids, "Q1"], ["P31"]);
    assert.deepEqual([...result.keys()], ids);
    assert.deepEqual(result.get("Q75"), { P31: [{ value: "Q75" }] });
    assert.deepEqual(result.get("Q101"), {});
    verifyPacing(probe, 250);
  });
});

test("enrichment claims batches preserve every painting and its source dimensions", async () => {
  const paintings = Array.from({ length: 101 }, (_, i) => ({
    qid: `Q${i + 1}`, slug: `work-${i}`, title: `Work ${i}`, year: null,
    imageUrl: null, imageWidth: null, imageHeight: null, wikipediaUrl: null,
  }));
  const artist: EnrichableArtist = { slug: "painter", name: "Painter", qid: "Q9999", birthYear: null, deathYear: null, paintings };
  const quantity = (amount: string) => [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { amount, unit: "http://www.wikidata.org/entity/Q174728" } } } }];
  const probe = requests(650, params => ({ entities: Object.fromEntries(params.get("ids")!.split("|").map(id => [id,
    { claims: { P2049: quantity("+100"), P2048: quantity("+80") } },
  ])) }));
  await withFetch(probe.fetch, async () => {
    const report = await enrichArtists([artist], { fixYears: false, dropForeign: false, log: () => {} });
    assert.deepEqual(report.failures, []);
    assert.equal(report.withBothDims, 101);
    assert.equal(artist.paintings.length, 101);
    assert.deepEqual(artist.paintings.map(p => p.qid), paintings.map(p => p.qid));
    assert.ok(artist.paintings.every(p => p.widthCm === 100 && p.heightCm === 80));
    verifyPacing(probe, 250);
  });
});

test("projected enrichment retains qualifier checks, dates, attribution and series membership", async () => {
  const statement = (value: unknown, qualifiers?: unknown) => ({ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value } }, qualifiers });
  const quantity = (amount: string, qualifiers?: unknown) => statement({ amount, unit: "http://www.wikidata.org/entity/Q174728" }, qualifiers);
  const paintings = ["Q1", "Q2", "Q3"].map(qid => ({ qid, slug: qid, title: qid, year: 1700, imageUrl: null, imageWidth: null, imageHeight: null, wikipediaUrl: null }));
  const artist: EnrichableArtist = { slug: "painter", name: "Painter", qid: "Q9999", birthYear: 1800, deathYear: 1900, paintings };
  const common = { P170: [statement({ id: "Q9999" })], P571: [statement({ time: "+1850-01-01T00:00:00Z", precision: 11 })], P180: [statement({ id: "irrelevant subject" })] };
  const entities = {
    Q1: { claims: { ...common, P2049: [quantity("+999", { P518: [{ datavalue: { value: { id: "Q1060829" } } }] }), quantity("+80")], P2048: [quantity("+60")], P179: [statement({ id: "Q3" })] } },
    Q2: { claims: { ...common, P31: [statement({ id: "Q79218" })], P2386: [quantity("+100")] } },
    Q3: { claims: { ...common, P31: [statement({ id: "Q15727816" })], P527: [statement({ id: "Q1" })] } },
  };
  await withFetch(async () => new Response(JSON.stringify({ entities })), async () => {
    const report = await enrichArtists([artist], { log: () => {} });
    assert.deepEqual(report.failures, []);
    assert.deepEqual(report.creatorMismatch, []);
    assert.deepEqual(report.removedSeries, ["painter/Q3"]);
    assert.deepEqual(artist.paintings.map(p => [p.qid, p.year, p.widthCm, p.heightCm]), [["Q1", 1850, 80, 60], ["Q2", 1850, 100, 100]]);
  });
});

test("invalid metadata still rejects rather than returning partial success", async () => {
  await withFetch(async () => new Response(JSON.stringify({ error: { code: "bad-query" } })), async () => {
    await assert.rejects(fetchFileMeta(["https://upload.wikimedia.org/wikipedia/commons/a/ab/File.jpg"]), /extmetadata.*returned nothing/);
    await assert.rejects(imageFileInfo([{ project: "commons", file: "File.jpg" }]), /imageinfo.*returned nothing/);
    await assert.rejects(fetchClaims(["Q1"], ["P31"]), /wbgetentities returned nothing/);
  });
});
