import assert from "node:assert/strict";
import test from "node:test";
import { selectCatalogueSource } from "./ingest";
import type { SparqlPainting } from "./lib/wiki";

test("the composite scroll selects each painter's own source image and filename title", () => {
  const original: SparqlPainting = { qid: "Q132599105", label: "仇英访梅图", sitelinks: 1, image: "qiu-image.jpg", images: ["qiu-image.jpg"], article: "Composite scroll", year: 1525, yearPrecision: 9 };
  const sections = [
    ["Q558863", "沈周仿宋李唐渔隐图.jpg"],
    ["Q2248916", "唐寅文会图.jpg"],
    ["Q306673", "文徵明有竹图.jpg"],
    ["Q769372", "仇英访梅图.jpg"],
  ];
  const selected = sections.map(([artist, file]) => {
    const result = selectCatalogueSource(original, artist);
    assert.equal(decodeURIComponent(result.image!.split("/Special:FilePath/")[1]), file);
    assert.deepEqual(result.images, [result.image]);
    assert.equal(result.label, file.slice(0, -4));
    assert.equal(result.qid, original.qid);
    assert.equal(result.article, undefined, "the composite article cannot override a section image");
    assert.equal(result.year, undefined, "unqualified composite dates are not section dates");
    return result;
  });
  assert.equal(new Set(selected.map(item => item.image)).size, 4);
  assert.equal(new Set(selected.map(item => item.label)).size, 4);
  assert.equal(original.image, "qiu-image.jpg", "the source candidate is not mutated");
  assert.equal(selectCatalogueSource(original, "Q999"), original);
  const other = { ...original, qid: "Q3305213" };
  assert.equal(selectCatalogueSource(other, "Q558863"), other, "unreviewed works keep their sources");
});
