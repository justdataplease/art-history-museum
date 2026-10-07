import assert from "node:assert/strict";
import test from "node:test";
import { dropSeriesRepresentatives, repairYears, type Claims } from "./passes";
import { dimensions } from "./enrich";
import type { ArtistOut } from "../ingest";
import { notAnArtwork } from "./vet";

const statement = (qid: string, rank = "normal") => ({ rank, mainsnak: { snaktype: "value", datavalue: { value: { id: qid } } } });
const painting = (qid: string, slug = qid, imageUrl = `${qid}.jpg`) => ({ qid, slug, imageUrl });

test("explicit series membership removes a different scan while preserving all independent versions", () => {
  const artists = [{ slug: "van-gogh", paintings: [painting("Q157541", "sunflowers", "representative-scan.jpg"), painting("Q21948567", "sunflowers-london", "london-scan.jpg"), painting("Q21948547", "sunflowers-munich"), painting("Q999999", "sunflowers-unrelated")] }];
  const claims = new Map<string, Claims>([
    ["Q157541", { P31: [statement("Q15727816")], P527: [statement("Q21948567")] }],
    ["Q21948547", { P179: [statement("Q157541")] }],
  ]);
  assert.deepEqual(dropSeriesRepresentatives(artists, claims), ["van-gogh/sunflowers"]);
  assert.deepEqual(artists[0].paintings.map(p => p.qid), ["Q21948567", "Q21948547", "Q999999"]);
});

test("series with no admitted member, ambiguous groups, and physical assemblies remain", () => {
  const artists = [{ slug: "artist", paintings: [painting("Q1"), painting("Q2"), painting("Q3"), painting("Q4"), painting("Q5"), painting("Q6")] }];
  const claims = new Map<string, Claims>([
    ["Q1", { P31: [statement("Q15727816")], P527: [statement("Q100")] }],
    ["Q2", { P31: [statement("Q79218")] }], // a physical triptych
    ["Q3", { P361: [statement("Q2")] }],
    ["Q4", { P31: [statement("Q18573970")] }],
    ["Q5", { P361: [statement("Q4")] }],
    ["Q6", { P179: [statement("Q1", "deprecated")] }],
  ]);
  assert.deepEqual(dropSeriesRepresentatives(artists, claims), []);
  assert.equal(artists[0].paintings.length, 6);
});

test("physical assemblies with combined series classes retain their independent panels", () => {
  // These combinations occur on Jean de Gros (diptych), Vienne (triptych),
  // Montefiore (polyptych), and Santa Maria Maggiore (altarpiece) in Wikidata.
  for (const assemblyClass of ["Q475476", "Q79218", "Q1278452", "Q15711026"]) {
    const artists = [{ slug: "artist", paintings: [painting("Q1", "assembly"), painting("Q2", "panel"), painting("Q3", "series"), painting("Q4", "version")] }];
    const claims = new Map<string, Claims>([
      ["Q1", { P31: [statement(assemblyClass), statement("Q15727816"), statement("Q18573970")], P527: [statement("Q2")] }],
      ["Q2", { P361: [statement("Q1")] }],
      ["Q3", { P31: [statement("Q15727816")], P527: [statement("Q4")] }],
    ]);
    assert.deepEqual(dropSeriesRepresentatives(artists, claims), ["artist/series"]);
    assert.deepEqual(artists[0].paintings.map(p => p.qid), ["Q1", "Q2", "Q4"]);
  }
});

test("deprecated classes and relationships cannot remove an artwork", () => {
  const artists = [{ slug: "artist", paintings: [painting("Q1"), painting("Q2"), painting("Q3"), painting("Q4")] }];
  const claims = new Map<string, Claims>([
    ["Q1", { P31: [statement("Q15727816", "deprecated")], P527: [statement("Q2")] }],
    ["Q3", { P31: [statement("Q15727816")], P527: [statement("Q4", "deprecated")] }],
  ]);
  assert.deepEqual(dropSeriesRepresentatives(artists, claims), []);
  assert.equal(artists[0].paintings.length, 4);
});

test("composite-scroll sections do not inherit global dates or dimensions during repair", () => {
  const composite = { qid: "Q132599105", slug: "section", title: "Section", year: null, story: "", imageUrl: null, imageWidth: null, imageHeight: null, wikipediaUrl: null };
  const artist = { slug: "artist", birthYear: 1400, deathYear: 1600, paintings: [composite, { ...composite, qid: "Q1", slug: "whole" }] } as unknown as ArtistOut;
  const globalClaims: Claims = {
    P571: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { time: "+1525-00-00T00:00:00Z", precision: 9 } } } }],
    P2049: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { amount: "+100", unit: "http://www.wikidata.org/entity/Q174728" } } } }],
    P2048: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { amount: "+50", unit: "http://www.wikidata.org/entity/Q174728" } } } }],
  };
  assert.deepEqual(repairYears([artist], new Map([["Q132599105", globalClaims], ["Q1", globalClaims]])), ["artist/whole: null -> 1525 (exact Wikidata inception)"]);
  assert.equal(composite.year, null);
  assert.deepEqual(dimensions(globalClaims, composite), { widthCm: null, heightCm: null });
  assert.deepEqual(dimensions(globalClaims, { ...composite, qid: "Q1" }), { widthCm: 100, heightCm: 50, note: undefined });
});

test("the sourced furosaki screen painting remains while biographies, museums and lists are rejected", () => {
  const artist = { artistTitle: "Maruyama Ōkyo", artistQid: "Q405444" };
  assert.equal(notAnArtwork({ ...artist, title: "Cracked Ice screen", qid: "Q103793460", classes: ["Q11665531"], lead: "The Cracked Ice screen is a late 18th-century low two-fold Japanese screen (byōbu) intended for use at the Japanese tea ceremony." }), null);
  assert.equal(notAnArtwork({ ...artist, title: "Maruyama Ōkyo", qid: "Q405444", classes: ["Q5"], lead: "Maruyama Ōkyo was a Japanese artist." }), "the artist's own biography");
  assert.equal(notAnArtwork({ ...artist, title: "British Museum", qid: "Q6373", classes: ["Q33506"], lead: "The British Museum displays paintings and screens." }), "Wikidata class Q33506");
  assert.equal(notAnArtwork({ ...artist, title: "List of paintings by Maruyama Ōkyo", qid: null, classes: [], lead: "This is a list of artworks." }), "list article");
});
