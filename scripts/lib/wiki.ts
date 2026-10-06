// Helpers for pulling data from Wikipedia, Wikidata and Wikimedia Commons.
// All text stored in the museum is verbatim Wikipedia content.

import "./env"; // .env.local (WIKI_USER_AGENT) before UA is read below
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Wikimedia's User-Agent policy: identify the client and give a contact.
// If you run the ingest yourself, set WIKI_USER_AGENT to your own project
// URL / contact, e.g. "MyMuseum/1.0 (https://example.org; me@example.org)".
export const UA =
  process.env.WIKI_USER_AGENT ??
  "TimelineMuseum/1.0 (https://github.com/justdataplease/art-history-museum) node-fetch";

export async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Milliseconds to wait according to a Retry-After header (seconds or HTTP date). */
function retryAfterMs(res: Response): number | null {
  const v = res.headers.get("retry-after");
  if (!v) return null;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null;
}

/**
 * GET a JSON document politely: descriptive User-Agent, retries on 429/5xx
 * honouring Retry-After (falls back to exponential backoff), and on the
 * MediaWiki `maxlag` error. Returns null on 404.
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  retries = 6
): Promise<T | null> {
  // WIKI_HTTP_CACHE=<dir>: keep GET responses on disk, so re-running a script
  // (a --dry-run, then the real run) doesn't ask the APIs twice.
  const cacheDir = process.env.WIKI_HTTP_CACHE;
  const cacheFile =
    cacheDir && (!init.method || init.method === "GET")
      ? path.join(cacheDir, createHash("sha1").update(url).digest("hex") + ".json")
      : null;
  if (cacheFile && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8")) as T | null;
  const body = await fetchJsonLive<T>(url, init, retries);
  if (cacheFile) {
    fs.mkdirSync(cacheDir!, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(body));
  }
  return body;
}

async function fetchJsonLive<T>(url: string, init: RequestInit, retries: number): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const backoff = Math.min(30_000, 1000 * 2 ** attempt);
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { "user-agent": UA, "api-user-agent": UA, accept: "application/json", ...init.headers },
      });
    } catch (err) {
      // network error / reset: retry with backoff
      if (attempt >= retries) throw err;
      await sleep(backoff);
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) throw new Error(`${res.status} after ${retries} retries for ${url}`);
      await sleep((retryAfterMs(res) ?? backoff) + 250);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    const body = (await res.json()) as T & { error?: { code?: string } };
    if (body && typeof body === "object" && body.error?.code === "maxlag") {
      if (attempt >= retries) throw new Error(`maxlag after ${retries} retries for ${url}`);
      await sleep((retryAfterMs(res) ?? 5000) + 250);
      continue;
    }
    return body;
  }
}

// Tiny concurrency limiter so we stay polite to the APIs.
export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

export interface WikiSummary {
  title: string;
  displaytitle?: string;
  description?: string;
  extract: string;
  thumbnail?: { source: string; width: number; height: number };
  originalimage?: { source: string; width: number; height: number };
  wikibase_item?: string;
  content_urls?: { desktop?: { page?: string } };
  type?: string;
}

export async function getSummary(title: string): Promise<WikiSummary | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title.replace(/ /g, "_")
  )}?redirect=true`;
  const data = await fetchJson<WikiSummary & { wikibase_item?: string }>(url);
  if (!data || data.type === "disambiguation" || !data.extract) return null;
  return data;
}

// Full plain-text article body (used to extract verbatim fun-fact sentences).
export async function getPlainExtract(title: string): Promise<string | null> {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&formatversion=2&titles=" +
    encodeURIComponent(title);
  const data = await fetchJson<{
    query?: { pages?: { extract?: string }[] };
  }>(url);
  return data?.query?.pages?.[0]?.extract ?? null;
}

export interface WikidataDates {
  birthYear?: number;
  deathYear?: number;
}

/**
 * Year of the best statement of a time property: preferred rank if any, else
 * normal rank; deprecated statements (disproved dates) never count. Among the
 * chosen statements the most precise one wins (a day beats a decade).
 */
export function bestTimeYear(claims: any, prop: string, minPrecision = 9): number | undefined {
  const all = ((claims?.[prop] ?? []) as any[]).filter(
    (c) => c?.rank !== "deprecated" && c?.mainsnak?.snaktype === "value" && c.mainsnak.datavalue?.value?.time
  );
  const preferred = all.filter((c) => c.rank === "preferred");
  const pool = (preferred.length ? preferred : all)
    .map((c) => c.mainsnak.datavalue.value as { time: string; precision?: number })
    .filter((v) => (v.precision ?? 11) >= minPrecision)
    .sort((a, b) => (b.precision ?? 11) - (a.precision ?? 11));
  const m = pool[0] && /^([+-]\d+)-/.exec(pool[0].time);
  return m ? parseInt(m[1], 10) : undefined;
}

export async function getWikidataDates(qid: string): Promise<WikidataDates> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&formatversion=2`;
  const data = await fetchJson<any>(url);
  const claims = data?.entities?.[qid]?.claims;
  // a life date of decade or century precision ("c. 1260s") still beats none
  return { birthYear: bestTimeYear(claims, "P569", 0), deathYear: bestTimeYear(claims, "P570", 0) };
}

export interface SparqlPainting {
  qid: string;
  label: string;
  sitelinks: number;
  year?: number;
  /** Wikidata time precision of that year: 9 = year, 8 = decade, 7 = century. */
  yearPrecision?: number;
  image?: string; // Commons image URL (PD works)
  article?: string; // English Wikipedia article title
}

// Wikidata classes hung as a "painting": easel paintings plus the forms many
// canonical works are filed under — frescoes and wall paintings (The Last
// Supper, The School of Athens), triptychs / polyptychs / altarpieces (The
// Garden of Earthly Delights) and painting series whose article leads with
// one version (Sunflowers, Water Lilies, The Scream).
export const PAINTING_CLASSES = [
  "Q3305213", // painting
  "Q192110", // self-portrait
  "Q18761202", // watercolor painting
  "Q79218", // triptych
  "Q475476", // diptych
  "Q1278452", // polyptych
  "Q144860", // altarpiece
  "Q15711026", // altarpiece (the item most altarpieces use)
  "Q22669139", // fresco (the item most frescoes use: The Creation of Adam)
  "Q134194", // fresco painting
  "Q99516640", // wall painting
  "Q219423", // mural
  "Q15727816", // painting series
  "Q18573970", // group of paintings
  // painting formats (labels checked on Wikidata, Oct 2026)
  "Q55439", // panel painting
  "Q56676227", // oil painting
  "Q21281546", // gouache painting
  "Q12043905", // pastel artwork (Degas)
  "Q22970505", // painted crucifix
  "Q132137", // icon
  "Q282129", // miniature
  "Q678664", // Persian miniature
  "Q268639", // Ottoman miniature
  "Q8362", // manuscript illumination
  "Q7282803", // Ragamala painting
  "Q4307822", // muraqqa (album of miniatures)
  "Q28104579", // album leaf
  "Q916651", // thangka
  "Q10827799", // silk painting
  "Q19969434", // scroll painting
  "Q5647631", // handscroll
  "Q1190781", // emakimono
  "Q3125472", // makimono
  "Q2188827", // hanging scroll
  "Q277583", // kakemono
  "Q50488927", // fan painting
  "Q741226", // byōbu
  "Q1144689", // folding screen
  "Q126456658", // fusuma-e
  "Q103929010", // shōhekiga
];

/** Prints: hung only for the ukiyo-e masters, whose works are woodblock prints. */
export const PRINT_CLASSES = [
  "Q28913685", // woodblock print
  "Q18219090", // woodcut print
  "Q1683337", // nishiki-e
  "Q19960510", // series of prints
  "Q1396354", // color woodcut
];

/** Lead image of an article under any licence (`pilicense=any`): the
 *  fallback that finds a work whose only image is non-free. */
export async function getPageImageAny(
  title: string
): Promise<{ source: string; width: number; height: number } | null> {
  const data = await fetchJson<{
    query?: { pages?: { original?: { source: string; width: number; height: number } }[] };
  }>(
    "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageimages&piprop=original&pilicense=any&titles=" +
      encodeURIComponent(title)
  );
  return data?.query?.pages?.[0]?.original ?? null;
}

/**
 * Which English-Wikipedia-local files are non-free (fair use), by their
 * `NonFree` extmetadata flag. Commons hosts only free files, so only
 * /wikipedia/en/ files need asking. `files` are file names without "File:".
 */
export async function nonFreeFiles(files: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = [...new Set(files)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const qs = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "imageinfo",
      iiprop: "extmetadata",
      iiextmetadatafilter: "NonFree",
      titles: batch.map((f) => `File:${f}`).join("|"),
    });
    const data = await fetchJson<{
      query?: {
        normalized?: { from: string; to: string }[];
        pages?: { title: string; imageinfo?: { extmetadata?: { NonFree?: { value: string } } }[] }[];
      };
    }>(`https://en.wikipedia.org/w/api.php?${qs}`);
    if (!data?.query) throw new Error("imageinfo (NonFree) returned nothing");
    const norm = new Map((data.query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of data.query.pages ?? []) {
      const flag = p.imageinfo?.[0]?.extmetadata?.NonFree?.value;
      if (flag && flag !== "false") out.add((norm.get(p.title) ?? p.title).replace(/^File:/, ""));
    }
  }
  return out;
}

// Paintings by an artist, most-famous first (sitelink count is the fame proxy):
// every work with an English Wikipedia article — no cap, the museum hangs all
// of them — followed by the best-known image-only works (Wikidata item with a
// Commons image but no article), the fallback pool for thin galleries.
export async function getPaintingsByArtist(
  artistQid: string,
  opts: { prints?: boolean } = {}
): Promise<SparqlPainting[]> {
  const classes = opts.prints ? [...PAINTING_CLASSES, ...PRINT_CLASSES] : PAINTING_CLASSES;
  const head = `
  VALUES ?class { ${classes.map((q) => `wd:${q}`).join(" ")} }
  ?item wdt:P170 wd:${artistQid} .
  ?item wdt:P31 ?class .
  ?item wikibase:sitelinks ?sitelinks .
  OPTIONAL {
    ?item p:P571 ?incStatement .
    ?incStatement a wikibase:BestRank ; psv:P571 ?incValue .
    ?incValue wikibase:timeValue ?inception ; wikibase:timePrecision ?incPrecision .
  }`;
  const withArticle = `
SELECT ?item ?itemLabel ?sitelinks ?inception ?incPrecision ?image ?article WHERE {${head}
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL { ?item wdt:P18 ?image . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?sitelinks) DESC(?incPrecision)`;
  const imageOnly = `
SELECT ?item ?itemLabel ?sitelinks ?inception ?incPrecision ?image WHERE {${head}
  ?item wdt:P18 ?image .
  FILTER NOT EXISTS { ?a schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?sitelinks) DESC(?incPrecision)
LIMIT 100`;
  const sparql = (q: string) =>
    fetchJson<any>("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q));
  const rows: any[] = [
    ...((await sparql(withArticle))?.results?.bindings ?? []),
    ...((await sparql(imageOnly))?.results?.bindings ?? []),
  ];
  const seen = new Set<string>();
  const out: SparqlPainting[] = [];
  for (const row of rows) {
    const qid = row.item?.value?.split("/").pop();
    if (!qid || seen.has(qid)) continue;
    seen.add(qid);
    let year: number | undefined;
    const t = row.inception?.value;
    if (t) {
      const m = /^([+-]?\d{1,4})-/.exec(t);
      if (m) year = parseInt(m[1], 10);
    }
    let article: string | undefined;
    if (row.article?.value) {
      article = decodeURIComponent(
        row.article.value.split("/wiki/").pop()!.replace(/_/g, " ")
      );
    }
    const label = row.itemLabel?.value ?? "";
    if (!label || /^Q\d+$/.test(label)) continue;
    out.push({
      qid,
      label,
      sitelinks: parseInt(row.sitelinks?.value ?? "0", 10),
      year,
      yearPrecision: row.incPrecision?.value ? parseInt(row.incPrecision.value, 10) : undefined,
      image: row.image?.value,
      article,
    });
  }
  return out;
}

// Article titles in an English Wikipedia category (e.g. "Category:Paintings
// by X"), following continuation, plus one level of subcategories named for
// the same artist ("Category:Self-portraits by Rembrandt").
export async function getCategoryMembers(category: string, artist?: string): Promise<string[]> {
  const titles: string[] = [];
  const subcats: string[] = [];
  let cont: string | undefined;
  do {
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmnamespace=0%7C14&cmlimit=500&format=json&formatversion=2&cmtitle=" +
      encodeURIComponent(category) +
      (cont ? "&cmcontinue=" + encodeURIComponent(cont) : "");
    const data = await fetchJson<{
      continue?: { cmcontinue?: string };
      query?: { categorymembers?: { title: string; ns: number }[] };
    }>(url);
    for (const m of data?.query?.categorymembers ?? []) {
      if (m.ns === 0) titles.push(m.title);
      else if (artist && m.title.includes(`by ${artist}`)) subcats.push(m.title);
    }
    cont = data?.continue?.cmcontinue;
  } while (cont);
  for (const sub of subcats) {
    for (const t of await getCategoryMembers(sub)) if (!titles.includes(t)) titles.push(t);
  }
  return titles;
}

/**
 * The REST summary's "original" image is often a 3840 px thumbnail on
 * thumb.wikimedia.org with tracking parameters. Map it back to the file's
 * canonical upload.wikimedia.org original (the app sizes thumbs itself, the
 * CSP allows only upload.wikimedia.org, and enrichment reads the true pixel
 * size of that file).
 */
export function canonicalImageUrl(url: string): string;
export function canonicalImageUrl(url: string | null): string | null;
export function canonicalImageUrl(url: string | null): string | null {
  if (!url) return url;
  let u: URL;
  try {
    u = new URL(url.replace(/&amp;/g, "&"));
  } catch {
    return url;
  }
  if (u.hostname !== "upload.wikimedia.org" && u.hostname !== "thumb.wikimedia.org") return url;
  // /wikipedia/<project>/thumb/a/ab/File.jpg/<N>px-File.jpg -> /wikipedia/<project>/a/ab/File.jpg
  const m = /^(\/wikipedia\/[^/]+\/)thumb\/([0-9a-f]\/[0-9a-f]{2}\/([^/]+))\/([^/]+)$/.exec(u.pathname);
  // A page rendering of a paged document ("page1-1280px-File.pdf.jpg") is the
  // only form a browser can show: the original is a PDF / DjVu / multi-page
  // TIFF. Keep such a thumbnail as it is.
  if (m && /\.(pdf|djvu|tiff?)$/i.test(m[3]) && /^(?:lossy-|lossless-)?page\d+-\d+px-/.test(m[4]))
    return `https://upload.wikimedia.org${u.pathname}`;
  const pathname = m ? m[1] + m[2] : u.pathname;
  return `https://upload.wikimedia.org${pathname}`;
}

// ---- fun-fact extraction (verbatim sentences from the article body) ----

const FACT_KEYWORDS =
  /\b(stolen|theft|thief|recovered|auction|sold for|record|million|x-ray|x ray|infrared|restoration|restored|conservation|attacked|slashed|damaged|forgery|forger|fake|attributed|reattributed|discovered|rediscovered|hidden|underneath|beneath|overpainted|pentiment|commissioned|rejected|scandal|controvers|censor|banned|smuggl|looted|nazi|ransom|parod|referenced|inspired|most expensive|largest|acquired)\b/i;

function splitSentences(text: string): string[] {
  return (
    text
      .replace(/\s+/g, " ")
      .match(/[^.!?]+[.!?]+(?=\s|$)/g)
      ?.map((s) => s.trim()) ?? []
  );
}

const SECTION_BLACKLIST =
  /^(see also|references|external links|notes|sources|further reading|gallery|citations|footnotes|bibliography|other versions|versions|copies|copies and versions|in popular culture|works cited|literature|filmography)/i;

export function extractFacts(fullText: string, leadText: string): string[] {
  // Keep only prose sections; the lead (already used as the story) is dropped.
  const parts = fullText.split(/\n==+\s*([^=\n]+?)\s*==+\n?/);
  let body = "";
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i].trim();
    const text = parts[i + 1] ?? "";
    if (!SECTION_BLACKLIST.test(heading)) body += "\n" + text;
  }
  if (!body.trim()) return [];
  // Drop list items / captions: lines that don't read as terminated prose.
  const prose = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 60 && /[.!?]["”']?$/.test(l))
    .join(" ");
  const leadStart = leadText.slice(0, 80);
  const facts: string[] = [];
  const used = new Set<string>();
  const candidates = splitSentences(prose).filter(
    (s) =>
      s.length > 60 &&
      s.length < 320 &&
      !s.includes(leadStart) &&
      /^["“'A-Z0-9]/.test(s) &&
      !/ISBN|doi:|pp\.|Retrieved/i.test(s)
  );
  for (const s of candidates) {
    if (FACT_KEYWORDS.test(s) && !used.has(s)) {
      facts.push(s);
      used.add(s);
      if (facts.length >= 4) break;
    }
  }
  // Fallback: lead-off sentences of the body so every painting has something real.
  if (facts.length < 2) {
    for (const s of candidates) {
      if (!used.has(s)) {
        facts.push(s);
        used.add(s);
        if (facts.length >= 2) break;
      }
    }
  }
  return facts;
}

// Build a resized Wikimedia thumb URL from an original upload.wikimedia.org URL.
export function thumbUrl(original: string, width: number): string {
  try {
    const u = new URL(original);
    if (!u.hostname.endsWith("wikimedia.org")) return original;
    const parts = u.pathname.split("/"); // /wikipedia/commons/a/ab/File.jpg
    const file = parts[parts.length - 1];
    if (u.pathname.includes("/thumb/")) return original;
    const prefix = parts.slice(0, -1).join("/");
    const project = parts[2]; // commons | en
    return `https://upload.wikimedia.org${prefix.replace(
      `/wikipedia/${project}/`,
      `/wikipedia/${project}/thumb/`
    )}/${file}/${width}px-${file}${file.toLowerCase().endsWith(".svg") ? ".png" : ""}`;
  } catch {
    return original;
  }
}
