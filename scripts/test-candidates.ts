// Count how many image-bearing painting pages each candidate artist would yield.
import {
  getCategoryMembers,
  getPaintingsByArtist,
  getSummary,
} from "./lib/wiki";

const CANDIDATES = process.argv.slice(2);

function norm(s: string): string {
  return s.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").replace(/[^a-z0-9]+/g, "");
}

async function countFor(name: string) {
  const s = await getSummary(name);
  if (!s?.wikibase_item) {
    console.log(`${name}: no summary/qid`);
    return;
  }
  const seen = new Set<string>();
  let n = 0;
  const sparql = await getPaintingsByArtist(s.wikibase_item);
  for (const c of sparql.filter((c) => c.article)) {
    const ps = await getSummary(c.article!);
    if (ps?.originalimage && !seen.has(norm(ps.title))) {
      seen.add(norm(ps.title));
      n++;
    }
  }
  for (const catName of [
    `Category:Paintings by ${s.title}`,
    `Category:Works by ${s.title}`,
  ]) {
    const cat = await getCategoryMembers(catName);
    for (const t of cat) {
      if (/^List of/i.test(t) || seen.has(norm(t))) continue;
      const ps = await getSummary(t);
      if (ps?.originalimage && !seen.has(norm(ps.title))) {
        seen.add(norm(ps.title));
        n++;
      }
    }
  }
  console.log(`${name}: ${n} image-bearing painting articles`);
}

async function main() {
  for (const c of CANDIDATES) await countFor(c);
}
main();
