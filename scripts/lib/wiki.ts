// Helpers for pulling data from Wikipedia, Wikidata and Wikimedia Commons.
// All text stored in the museum is verbatim Wikipedia content.

const UA =
  "ArtHistoryMuseum/1.0 (https://justdataplease.com; hey@justdataplease.com) node-fetch";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  retries = 4
): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "user-agent": UA, accept: "application/json", ...init.headers },
      });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * (attempt + 1) ** 2);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(800 * (attempt + 1));
    }
  }
  return null;
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

export async function getWikidataDates(qid: string): Promise<WikidataDates> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&formatversion=2`;
  const data = await fetchJson<any>(url);
  const claims = data?.entities?.[qid]?.claims;
  const year = (prop: string): number | undefined => {
    const time = claims?.[prop]?.[0]?.mainsnak?.datavalue?.value?.time;
    if (!time) return undefined;
    const m = /^([+-]\d+)-/.exec(time);
    return m ? parseInt(m[1], 10) : undefined;
  };
  return { birthYear: year("P569"), deathYear: year("P570") };
}

export interface SparqlPainting {
  qid: string;
  label: string;
  sitelinks: number;
  year?: number;
  image?: string; // Commons image URL (PD works)
  article?: string; // English Wikipedia article title
}

// Paintings by an artist, most-famous first (sitelink count is the fame proxy).
export async function getPaintingsByArtist(
  artistQid: string
): Promise<SparqlPainting[]> {
  const query = `
SELECT ?item ?itemLabel ?sitelinks ?inception ?image ?article WHERE {
  ?item wdt:P170 wd:${artistQid} .
  ?item wdt:P31 wd:Q3305213 .
  ?item wikibase:sitelinks ?sitelinks .
  OPTIONAL { ?item wdt:P571 ?inception . }
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?sitelinks)
LIMIT 40`;
  const url =
    "https://query.wikidata.org/sparql?format=json&query=" +
    encodeURIComponent(query);
  const data = await fetchJson<any>(url);
  const rows: any[] = data?.results?.bindings ?? [];
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
      image: row.image?.value,
      article,
    });
  }
  return out;
}

// Article titles in an English Wikipedia category (e.g. "Category:Paintings by X").
export async function getCategoryMembers(category: string): Promise<string[]> {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmnamespace=0&cmlimit=100&format=json&formatversion=2&cmtitle=" +
    encodeURIComponent(category);
  const data = await fetchJson<{
    query?: { categorymembers?: { title: string }[] };
  }>(url);
  return (data?.query?.categorymembers ?? []).map((m) => m.title);
}

// ---- fun-fact extraction (verbatim sentences from the article body) ----

const FACT_KEYWORDS =
  /\b(stolen|theft|thief|recovered|auction|sold for|record|million|x-ray|x ray|infrared|restoration|restored|conservation|vandal|attacked|slashed|damaged|forgery|forger|fake|attributed|reattributed|discovered|rediscovered|hidden|underneath|beneath|overpainted|pentiment|commissioned|rejected|scandal|controvers|censor|banned|smuggl|looted|nazi|ransom|parod|referenced|inspired|most expensive|largest|acquired)\b/i;

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
