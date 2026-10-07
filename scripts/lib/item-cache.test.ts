import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchFileMeta } from "./credits";
import { enrichArtists, imageFileInfo, type EnrichableArtist } from "./enrich";
import { fetchClaims } from "./passes";

type File = { project: string; file: string };
type Request = { kind: "meta" | "info" | "claims"; project: string; items: string[] };
const fileKey = (file: File) => `${file.project}|${file.file}`;
const imageUrl = (file: File) => `https://upload.wikimedia.org/wikipedia/${file.project}/a/ab/${encodeURIComponent(file.file)}`;
const coldFiles = () => [
  ...Array.from({ length: 51 }, (_, i) => ({ project: "commons", file: `Item ${i}.jpg` })),
  { project: "en", file: "Item 0.jpg" },
  { project: "en", file: "Item 1.jpg" },
];
const statement = (property: string, value: unknown, qualifiers?: unknown) => ({
  rank: "normal", mainsnak: { snaktype: "value", property, datavalue: { value } },
  ...(qualifiers ? { qualifiers } : {}),
});
function sourceClaims(qid: string) {
  return {
    P31: [statement("P31", { id: "Q3305213" })],
    P170: [{ ...statement("P170", { id: "Q9001" }, {
      P518: [{ snaktype: "value", property: "P518", datavalue: { value: { id: "Q82604" } } }],
    }), references: [{ snaks: { P854: [{ snaktype: "value", datavalue: { value: `https://example.org/${qid}` } }] } }] }],
    P18: [statement("P18", `${qid}.jpg`)],
    P180: [statement("P180", { id: "Q5" })],
    P2049: [statement("P2049", { amount: "+100", unit: "http://www.wikidata.org/entity/Q174728" })],
    P2048: [statement("P2048", { amount: "+80", unit: "http://www.wikidata.org/entity/Q174728" })],
  };
}
function provider() {
  const requests: Request[] = [];
  const missingQids = new Set<string>();
  const fetch: typeof globalThis.fetch = async input => {
    const url = new URL(String(input));
    const params = url.searchParams;
    if (params.has("ids")) {
      const items = params.get("ids")!.split("|");
      assert.equal(params.get("props"), "claims");
      requests.push({ kind: "claims", project: "wikidata", items });
      return new Response(JSON.stringify({ entities: Object.fromEntries(items.map(id => [id, missingQids.has(id) ? { id, missing: "" } : { id, claims: sourceClaims(id) }])) }));
    }
    const items = params.get("titles")!.split("|").map(title => title.replace(/^File:/, ""));
    const project = url.hostname === "commons.wikimedia.org" ? "commons" : url.hostname.split(".")[0];
    const kind = params.get("iiprop") === "extmetadata" ? "meta" : "info";
    requests.push({ kind, project, items });
    return new Response(JSON.stringify({ query: { pages: [...items].reverse().map(file => {
      const number = Number(/\d+/.exec(file)![0]);
      const offset = project === "commons" ? 0 : 100000;
      return { title: `File:${file}`, imageinfo: [{
        size: offset + 2000 + number, width: offset + 1200 + number, height: offset + 800 + number,
        extmetadata: {
          Artist: { value: `<b>${project} artist for ${file}</b>` },
          LicenseShortName: { value: "Public domain" },
          ObjectName: { value: file.replace(/\.jpg$/, "") },
          ImageDescription: { value: `${project} description for ${file}` },
          Categories: { value: `${project} collection|Paintings` },
        },
      }] };
    }) } }));
  };
  return { fetch, requests, missingQids };
}
async function removeTempCache(directory: string) {
  const absolute = path.resolve(directory);
  assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
  assert.match(path.basename(absolute), /^museum-item-cache-test-[a-zA-Z0-9]{6}$/);
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    assert.ok(entry.isFile(), `unexpected cache entry: ${entry.name}`);
    fs.unlinkSync(path.join(absolute, entry.name));
  }
  // Windows may briefly report ENOTEMPTY after successful unlinks. Only
  // retry an empty directory, so late cache writers still fail visibly.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmdirSync(absolute);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY" || attempt >= 4) throw error;
      assert.deepEqual(fs.readdirSync(absolute), [], "cache files appeared after all requests completed");
      await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}
async function withCache(run: (directory: string, probe: ReturnType<typeof provider>) => Promise<void>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "museum-item-cache-test-"));
  const previousFetch = globalThis.fetch;
  const previousCache = process.env.WIKI_HTTP_CACHE;
  const probe = provider();
  globalThis.fetch = probe.fetch;
  process.env.WIKI_HTTP_CACHE = directory;
  try {
    await run(directory, probe);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCache === undefined) delete process.env.WIKI_HTTP_CACHE;
    else process.env.WIKI_HTTP_CACHE = previousCache;
    await removeTempCache(directory);
  }
}
const requestedFiles = (requests: Request[]) => requests.flatMap(request => request.items.map(file => `${request.project}|${file}`));

test("stable file metadata caches individual files across inserted, reordered and subset requests", async () => {
  await withCache(async (directory, probe) => {
    const files = coldFiles();
    const urls = files.map(imageUrl);
    const cold = await fetchFileMeta(urls, { spacingMs: 0 });
    assert.equal(cold.size, 53);
    assert.deepEqual([...cold.keys()], urls);
    assert.deepEqual(requestedFiles(probe.requests).sort(), files.map(fileKey).sort());
    assert.equal(cold.get(urls[0])!.credit.author, "commons artist for Item 0.jpg");
    assert.equal(cold.get(urls[51])!.credit.author, "en artist for Item 0.jpg");
    assert.ok(fs.existsSync(path.join(directory, "file-meta-v1.json")));
    const before = probe.requests.length;
    const fresh = [{ project: "commons", file: "Item 51.jpg" }, { project: "en", file: "Item 2.jpg" }];
    const alias = urls[0].replace("/a/ab/", "/thumb/a/ab/") + "/100px-Item_0.jpg";
    const reordered = [imageUrl(fresh[0]), urls[51], alias, ...urls.slice(0, 51).reverse(), imageUrl(fresh[1]), urls[52]];
    const warm = await fetchFileMeta(reordered, { spacingMs: 0 });
    assert.deepEqual([...warm.keys()], reordered);
    for (const url of urls) assert.deepEqual(warm.get(url), cold.get(url));
    assert.deepEqual(warm.get(alias), cold.get(urls[0]));
    assert.deepEqual(requestedFiles(probe.requests.slice(before)).sort(), fresh.map(fileKey).sort());
    const after = probe.requests.length;
    const subset = [urls[52], alias, imageUrl(fresh[0]), urls[1]];
    const selected = await fetchFileMeta(subset, { spacingMs: 0 });
    assert.deepEqual([...selected], subset.map(url => [url, warm.get(url)]));
    assert.equal(probe.requests.length, after);
  });
});

test("stable image info caches individual files and preserves project grouping and per-project order", async () => {
  await withCache(async (directory, probe) => {
    const files = coldFiles();
    const cold = await imageFileInfo(files);
    assert.equal(cold.size, 53);
    assert.deepEqual([...cold.keys()], files.map(fileKey));
    assert.deepEqual(requestedFiles(probe.requests).sort(), files.map(fileKey).sort());
    assert.deepEqual(cold.get("commons|Item 0.jpg"), { bytes: 2000, width: 1200, height: 800 });
    assert.deepEqual(cold.get("en|Item 0.jpg"), { bytes: 102000, width: 101200, height: 100800 });
    assert.ok(fs.existsSync(path.join(directory, "image-info-v1.json")));
    const before = probe.requests.length;
    const fresh = [{ project: "en", file: "Item 2.jpg" }, { project: "commons", file: "Item 51.jpg" }];
    const reordered = [fresh[0], files[51], files[50], fresh[1], files[52], ...files.slice(0, 50).reverse()];
    const warm = await imageFileInfo(reordered);
    assert.deepEqual([...warm.keys()], [fresh[0], files[51], files[52], files[50], fresh[1], ...files.slice(0, 50).reverse()].map(fileKey));
    for (const file of files) assert.deepEqual(warm.get(fileKey(file)), cold.get(fileKey(file)));
    assert.deepEqual(requestedFiles(probe.requests.slice(before)).sort(), fresh.map(fileKey).sort());
    const after = probe.requests.length;
    const subset = [files[52], fresh[1], files[0]];
    assert.deepEqual([...await imageFileInfo(subset)], subset.map(file => [fileKey(file), warm.get(fileKey(file))]));
    assert.equal(probe.requests.length, after);
  });
});

test("claims index survives changed batches and properties without losing qualifiers or leaking other properties", async () => {
  await withCache(async (directory, probe) => {
    const qids = Array.from({ length: 52 }, (_, i) => `Q${i + 1}`);
    const cold = await fetchClaims(qids, ["P31"]);
    assert.deepEqual([...cold.keys()], qids);
    assert.equal(probe.requests.length, 2);
    for (const id of qids) assert.deepEqual(cold.get(id), { P31: sourceClaims(id).P31 });
    assert.ok(fs.existsSync(path.join(directory, "claims-index-v1.json")));
    const before = probe.requests.length;
    const reordered = ["Q53", "Q52", "Q1", ...qids.slice(1, 51).reverse(), "Q1"];
    const warm = await fetchClaims(reordered, ["P170", "P18"]);
    assert.deepEqual([...warm.keys()], [...new Set(reordered)]);
    assert.deepEqual(probe.requests.slice(before).map(request => request.items), [["Q53"]]);
    for (const [id, claims] of warm) {
      assert.deepEqual(claims, { P170: sourceClaims(id).P170, P18: sourceClaims(id).P18 });
      assert.ok(!("P31" in claims) && !("P180" in claims));
    }
    const after = probe.requests.length;
    const subset = ["Q51", "Q53", "Q2"];
    assert.deepEqual([...await fetchClaims(subset, ["P31"])], subset.map(id => [id, cold.get(id) ?? { P31: sourceClaims(id).P31 }]));
    assert.equal(probe.requests.length, after);
  });
});

test("indexed HTTP claim bodies are read once per call and reused by enrichment", async () => {
  await withCache(async (directory, probe) => {
    const qids = Array.from({ length: 52 }, (_, i) => `Q${i + 1}`);
    await fetchClaims(qids, ["P31"]);
    const index = JSON.parse(fs.readFileSync(path.join(directory, "claims-index-v1.json"), "utf8")) as Record<string, string>;
    const indexedBodies = new Set(Object.values(index));
    assert.equal(indexedBodies.size, 2);
    const reads = new Map<string, number>();
    const previousRead = fs.readFileSync;
    fs.readFileSync = ((file: fs.PathOrFileDescriptor, options?: any) => {
      const name = typeof file === "number" ? "" : path.basename(String(file));
      if (indexedBodies.has(name)) reads.set(name, (reads.get(name) ?? 0) + 1);
      return previousRead(file, options);
    }) as typeof fs.readFileSync;
    try {
      const warm = await fetchClaims([...qids].reverse(), ["P170"]);
      assert.equal(warm.size, 52);
      assert.deepEqual([...reads].sort(), [...indexedBodies].map(file => [file, 1]).sort());
      reads.clear();
      await fetchClaims(["Q52", "Q2", "Q1", "Q51"], ["P18"]);
      assert.deepEqual([...reads].sort(), [...indexedBodies].map(file => [file, 1]).sort());
      reads.clear();
      const artist: EnrichableArtist = {
        slug: "painter", name: "Painter", qid: "Q9001", birthYear: 1800, deathYear: 1900,
        paintings: ["Q52", "Q1"].map(qid => ({ qid, slug: qid, title: qid, year: null,
          imageUrl: null, imageWidth: null, imageHeight: null, wikipediaUrl: null })),
      };
      const before = probe.requests.length;
      const report = await enrichArtists([artist], { log: () => {} });
      assert.deepEqual(report.failures, []);
      assert.deepEqual(report.creatorMismatch, []);
      assert.deepEqual(artist.paintings.map(painting => [painting.qid, painting.widthCm, painting.heightCm]), [["Q52", 100, 80], ["Q1", 100, 80]]);
      assert.equal(probe.requests.length, before, "enrichment must reuse the same QID index despite different claim properties and batch order");
      assert.deepEqual([...reads].sort(), [...indexedBodies].map(file => [file, 1]).sort());
    } finally {
      fs.readFileSync = previousRead;
    }
  });
});

test("a deleted indexed HTTP claim response falls back to a live request and repairs the pointer", async () => {
  await withCache(async (directory, probe) => {
    await fetchClaims(["Q1", "Q2", "Q3"], ["P31"]);
    const indexPath = path.join(directory, "claims-index-v1.json");
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as Record<string, string>;
    fs.unlinkSync(path.join(directory, index.Q1));
    const before = probe.requests.length;
    const recovered = await fetchClaims(["Q2", "Q1"], ["P170"]);
    assert.deepEqual([...recovered.keys()], ["Q2", "Q1"]);
    assert.deepEqual(recovered.get("Q1"), { P170: sourceClaims("Q1").P170 });
    assert.deepEqual(probe.requests.slice(before).map(request => request.items), [["Q2", "Q1"]]);
    const repaired = JSON.parse(fs.readFileSync(indexPath, "utf8")) as Record<string, string>;
    assert.ok(fs.existsSync(path.join(directory, repaired.Q1)));
    assert.equal(repaired.Q1, repaired.Q2);
    const after = probe.requests.length;
    await fetchClaims(["Q1"], ["P18"]);
    assert.equal(probe.requests.length, after);
  });
});

test("missing item-store files rebuild from unchanged cached HTTP requests", async () => {
  await withCache(async (directory, probe) => {
    const files = [{ project: "commons", file: "Item 0.jpg" }];
    const urls = files.map(imageUrl);
    const meta = await fetchFileMeta(urls, { spacingMs: 0 });
    const info = await imageFileInfo(files);
    const claims = await fetchClaims(["Q1"], ["P31"]);
    const before = probe.requests.length;
    for (const file of ["file-meta-v1.json", "image-info-v1.json", "claims-index-v1.json"]) fs.unlinkSync(path.join(directory, file));
    assert.deepEqual([...await fetchFileMeta(urls, { spacingMs: 0 })], [...meta]);
    assert.deepEqual([...await imageFileInfo(files)], [...info]);
    assert.deepEqual([...await fetchClaims(["Q1"], ["P31"])], [...claims]);
    assert.equal(probe.requests.length, before, "the exact HTTP batches can be replayed after parsed stores are removed");
    for (const file of ["file-meta-v1.json", "image-info-v1.json", "claims-index-v1.json"]) assert.ok(fs.existsSync(path.join(directory, file)));
  });
});


test("an absent indexed entity is fetched again while an explicit missing entity remains cached", async () => {
  await withCache(async (directory, probe) => {
    probe.missingQids.add("Q3");
    const cold = await fetchClaims(["Q1", "Q2", "Q3"], ["P31"]);
    assert.deepEqual(cold.get("Q3"), {});
    const index = JSON.parse(fs.readFileSync(path.join(directory, "claims-index-v1.json"), "utf8")) as Record<string, string>;
    const bodyPath = path.join(directory, index.Q2);
    const body = JSON.parse(fs.readFileSync(bodyPath, "utf8"));
    delete body.entities.Q2;
    assert.deepEqual(body.entities.Q3, { id: "Q3", missing: "" });
    fs.writeFileSync(bodyPath, JSON.stringify(body));
    const before = probe.requests.length;
    const recovered = await fetchClaims(["Q3", "Q1", "Q2"], ["P170"]);
    assert.deepEqual([...recovered.keys()], ["Q3", "Q1", "Q2"]);
    assert.deepEqual(recovered.get("Q3"), {});
    assert.deepEqual(recovered.get("Q1"), { P170: sourceClaims("Q1").P170 });
    assert.deepEqual(recovered.get("Q2"), { P170: sourceClaims("Q2").P170 });
    assert.deepEqual(probe.requests.slice(before).map(request => request.items), [["Q2"]]);
    const after = probe.requests.length;
    const warm = await fetchClaims(["Q3", "Q2"], ["P18"]);
    assert.deepEqual(warm.get("Q3"), {});
    assert.deepEqual(warm.get("Q2"), { P18: sourceClaims("Q2").P18 });
    assert.equal(probe.requests.length, after);
  });
});

