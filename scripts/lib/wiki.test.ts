import assert from "node:assert/strict";
import test from "node:test";
import { getCategoryMembers, getPaintingsByArtist } from "./wiki";

test("catalogue pagination keeps every version, image and precise date", async () => {
  const previousFetch = globalThis.fetch;
  const previousCache = process.env.WIKI_HTTP_CACHE;
  delete process.env.WIKI_HTTP_CACHE;
  const queries: string[] = [];
  const row = (id: number, extra = {}) => ({
    item: { value: `http://www.wikidata.org/entity/Q${id}` },
    itemLabel: { value: "Sunflowers" },
    sitelinks: { value: "1" },
    image: { value: `http://commons.wikimedia.org/wiki/Special:FilePath/Version${id}.jpg` },
    ...extra,
  });
  globalThis.fetch = async (url) => {
    const query = new URL(String(url)).searchParams.get("query")!;
    queries.push(query);
    const rows = queries.length === 1
      ? [...Array.from({ length: 500 }, (_, i) => row(1000 + i)), row(1499, { image: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Alternative.jpg" } })]
      : [row(1500, { inception: { value: "1889-01-01T00:00:00Z" }, incPrecision: { value: "11" }, museumHeld: { value: "true" } }), row(1500, { inception: { value: "1880-01-01T00:00:00Z" }, incPrecision: { value: "8" } }), row(1501)];
    return new Response(JSON.stringify({ results: { bindings: rows } }), { headers: { "content-type": "application/json" } });
  };
  try {
    const paintings = await getPaintingsByArtist("Q5582");
    assert.equal(paintings.length, 502);
    assert.equal(queries.length, 2);
    assert.match(queries[1], /FILTER\(STR\(\?item\) > "http:\/\/www\.wikidata\.org\/entity\/Q1499"\)/);
    assert.equal(paintings[0].qid, "Q1500");
    assert.equal(paintings[0].year, 1889);
    assert.equal(paintings.find(p => p.qid === "Q1499")!.images!.length, 2);
    assert.equal(new Set(paintings.map(p => p.qid)).size, 502);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCache === undefined) delete process.env.WIKI_HTTP_CACHE;
    else process.env.WIKI_HTTP_CACHE = previousCache;
  }
});

test("invalid catalogue responses fail rather than caching an empty gallery", async () => {
  const previousFetch = globalThis.fetch;
  const previousCache = process.env.WIKI_HTTP_CACHE;
  delete process.env.WIKI_HTTP_CACHE;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "bad-query" } }));
  try {
    await assert.rejects(getPaintingsByArtist("Q5582"), /Incomplete catalogue response/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCache === undefined) delete process.env.WIKI_HTTP_CACHE;
    else process.env.WIKI_HTTP_CACHE = previousCache;
  }
});

test("artist categories follow continuation and nested categories without cycling", async () => {
  const previousFetch = globalThis.fetch;
  const previousCache = process.env.WIKI_HTTP_CACHE;
  delete process.env.WIKI_HTTP_CACHE;
  const visited: string[] = [];
  globalThis.fetch = async (url) => {
    const params = new URL(String(url)).searchParams;
    const category = params.get("cmtitle")!;
    visited.push(category);
    const body = category === "Category:Paintings by Painter"
      ? params.has("cmcontinue")
        ? { query: { categorymembers: [{ ns: 0, title: "Second painting" }] } }
        : { continue: { cmcontinue: "next" }, query: { categorymembers: [{ ns: 0, title: "First painting" }, { ns: 14, title: "Category:Portraits by Painter" }] } }
      : { query: { categorymembers: [{ ns: 0, title: "Third painting" }, { ns: 14, title: "Category:Paintings by Painter" }] } };
    return new Response(JSON.stringify(body));
  };
  try {
    assert.deepEqual(await getCategoryMembers("Category:Paintings by Painter", "Painter"), ["First painting", "Second painting", "Third painting"]);
    assert.equal(visited.length, 3);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCache === undefined) delete process.env.WIKI_HTTP_CACHE;
    else process.env.WIKI_HTTP_CACHE = previousCache;
  }
});

test("missing category data fails instead of declaring a complete artist", async () => {
  const previousFetch = globalThis.fetch;
  const previousCache = process.env.WIKI_HTTP_CACHE;
  delete process.env.WIKI_HTTP_CACHE;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "bad-query" } }));
  try {
    await assert.rejects(getCategoryMembers("Category:Paintings by Painter", "Painter"), /Incomplete category response/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCache === undefined) delete process.env.WIKI_HTTP_CACHE;
    else process.env.WIKI_HTTP_CACHE = previousCache;
  }
});
