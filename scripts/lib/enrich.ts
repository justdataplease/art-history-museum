// Enrich ingested paintings with real reference data:
//   - Wikidata item (resolved from the painting's English Wikipedia article via
//     pageprops.wikibase_item; Commons-only works fall back to a P18 image match)
//   - physical size from Wikidata: P2049 width / P2048 height (P2386 diameter for
//     tondi), normalised to centimetres, implausible values rejected
//   - 12 months of English Wikipedia pageviews (Wikimedia REST, user agents only)
//   - the image file's byte size, and its current pixel size (imageinfo; a file
//     can be re-uploaded at another resolution under the same URL)
//   - optionally, out-of-lifetime years replaced by the Wikidata inception (P571)
//     or cleared when Wikidata has nothing better.
//   - small sizes cross-checked against the article infobox (Wikidata values
//     entered in the wrong unit: a 107 cm canvas recorded as 107 mm)
//   - credit lines (author, licence, file page) for every image and portrait
// Nothing is invented: every value written is copied from Wikidata / Wikimedia
// (a multi-panel work recorded per panel is multiplied out), or left null when
// the sources have nothing usable.

import { createLimiter, createPacer, fetchJson, readItemCache, saveItemCache, splitLongRequest } from "./wiki";
import { fetchFileMeta, wikiFileOf, type FileMeta, type ImageCredit } from "./credits";
import { dropSeriesRepresentatives, fetchClaims } from "./passes";
export { createPacer } from "./wiki";

export interface EnrichablePainting {
  slug: string;
  title: string;
  year: number | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  wikipediaUrl: string | null;
  widthCm?: number | null;
  heightCm?: number | null;
  pageviews?: number | null;
  qid?: string | null;
  imageBytes?: number | null;
  imageCredit?: ImageCredit | null;
  /** The lead (only read to recognise a portrait miniature). */
  story?: string;
}

export interface EnrichableArtist {
  slug: string;
  name: string;
  qid: string | null;
  birthYear: number | null;
  deathYear: number | null;
  paintings: EnrichablePainting[];
  portraitUrl?: string | null;
  portraitCredit?: ImageCredit | null;
}

export interface EnrichOptions {
  /** Replace/clear years outside the artist's working life (default true). */
  fixYears?: boolean;
  /** Remove works attributed to another artist by both P170 and the title (default true). */
  dropForeign?: boolean;
  log?: (msg: string) => void;
  now?: Date;
  /** File metadata already fetched (scripts/lib/credits.ts), keyed by image URL. */
  fileMeta?: Map<string, FileMeta>;
}

export interface EnrichReport {
  generatedAt: string;
  pageviewWindow: { start: string; end: string };
  paintings: number;
  withArticle: number;
  withQid: number;
  qidFromImage: number;
  withBothDims: number;
  withAnyDim: number;
  withPageviews: number;
  withImageBytes: number;
  rejectedDims: string[];
  /** Image files whose pixel size changed since the ingest (re-uploaded). */
  imageChanges: string[];
  yearChanges: string[];
  /** Items whose creator (P170) is not the gallery artist (flagged; Wikidata P170 is sometimes wrong). */
  creatorMismatch: string[];
  /**
   * Works removed because two independent sources agree they are by someone
   * else: Wikidata's creator (P170) is another artist AND the title names that
   * artist (e.g. "The Magpie (Monet)" in Picasso's gallery). "artistSlug/paintingSlug".
   */
  removed: string[];
  /** Series representatives removed because individual linked works are admitted. */
  removedSeries: string[];
  /** Sizes multiplied out of a Wikidata unit slip, confirmed by the article infobox. */
  unitFixes: string[];
  /** Images / portraits with a credit line. */
  withCredit: number;
  failures: string[];
}

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WD_API = "https://www.wikidata.org/w/api.php";
const WDQS = "https://query.wikidata.org/sparql";
const PAGEVIEWS = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user";

const MM = "Q174789";
// Wikidata unit item -> centimetres per unit.
const UNIT_TO_CM: Record<string, number> = {
  Q174728: 1, // centimetre
  Q174789: 0.1, // millimetre
  Q11573: 100, // metre
  Q218593: 2.54, // inch
};

// Physical-size sanity bounds (cm). Smallest plausible gallery work ~2 cm;
// the largest canvases in the collection (Veronese, Monet's Water Lilies) are ~10-13 m.
const MIN_CM = 2;
const MAX_CM = 3000;
// Max disagreement between the Wikidata aspect ratio and the photo's aspect ratio.
// Photos include a little frame or crop; anything beyond this means the
// statement describes something else (frame, whole altarpiece, detail) or is wrong.
const ASPECT_TOLERANCE = 1.3;
// Transposed width/height is accepted only when it matches the photo this well.
const SWAP_TOLERANCE = 1.05;

// ---------- politeness ----------

const actionApi = createPacer(2, 250); // MediaWiki action API: two requests with spaced starts
const restApi = createPacer(8, 25); // pageviews REST: modest concurrency, well under the API limit
const sparql = createPacer(1, 1000);

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function titleFromWikipediaUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/(^|\.)wikipedia\.org$/.test(u.hostname) || !u.pathname.startsWith("/wiki/")) return null;
    return decodeURIComponent(u.pathname.slice(6)).replace(/_/g, " ");
  } catch {
    return null;
  }
}

/** Commons file name ("Foo bar.jpg") behind an upload.wikimedia.org URL, or null for non-Commons files. */
export function commonsFileName(imageUrl: string | null): string | null {
  const file = wikiFileOf(imageUrl);
  return file?.project === "commons" ? file.file : null;
}

// ---------- 1. article title -> Wikidata item ----------

interface ResolvedTitle {
  canonical: string;
  qid: string | null;
}

async function resolveTitles(titles: string[]): Promise<Map<string, ResolvedTitle | null>> {
  const out = new Map<string, ResolvedTitle | null>();
  for (const batch of chunks(titles, 50)) {
    const url =
      `${WIKI_API}?action=query&format=json&formatversion=2&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=` +
      encodeURIComponent(batch.join("|"));
    const data = await actionApi(() =>
      fetchJson<{
        query?: {
          normalized?: { from: string; to: string }[];
          redirects?: { from: string; to: string }[];
          pages?: { title: string; missing?: boolean; invalid?: boolean; pageprops?: { wikibase_item?: string } }[];
        };
      }>(url)
    );
    const q = data?.query;
    if (!q) throw new Error("pageprops query returned nothing");
    const norm = new Map((q.normalized ?? []).map((n) => [n.from, n.to]));
    const redir = new Map((q.redirects ?? []).map((r) => [r.from, r.to]));
    const pages = new Map((q.pages ?? []).map((p) => [p.title, p]));
    for (const t of batch) {
      let title = norm.get(t) ?? t;
      for (let hop = 0; hop < 3 && redir.has(title); hop++) title = redir.get(title)!;
      const page = pages.get(title);
      if (!page || page.missing || page.invalid) {
        out.set(t, null);
        continue;
      }
      out.set(t, { canonical: page.title, qid: page.pageprops?.wikibase_item ?? null });
    }
  }
  return out;
}

// ---------- 2. Commons image -> Wikidata item (works without an article) ----------

// PHP rawurlencode (what Wikibase uses to build Special:FilePath URIs).
const rawUrlEncode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

async function itemsByImage(
  files: { file: string; artistQid: string | null }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const FP = "http://commons.wikimedia.org/wiki/Special:FilePath/";
  for (const batch of chunks(files, 40)) {
    const values = batch.map((f) => `<${FP}${rawUrlEncode(f.file)}>`).join(" ");
    const query = `SELECT ?item ?file ?creator WHERE { VALUES ?file { ${values} } ?item wdt:P18 ?file . OPTIONAL { ?item wdt:P170 ?creator . } }`;
    const data = await sparql(() =>
      fetchJson<{ results?: { bindings?: Record<string, { value: string }>[] } }>(WDQS, {
        method: "POST",
        headers: {
          accept: "application/sparql-results+json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ query, format: "json" }).toString(),
      })
    );
    if (!data) throw new Error("SPARQL returned nothing");
    const rows = data.results?.bindings ?? [];
    for (const f of batch) {
      const mine = rows.filter((r) => decodeURIComponent(r.file.value.slice(FP.length)) === f.file);
      const items = [...new Set(mine.map((r) => r.item.value.split("/").pop()!))];
      // Several items can share an image (a detail, a series); keep only an
      // item whose creator (P170) is this artist, or a lone match with no
      // conflicting creator.
      const byCreator = f.artistQid
        ? items.filter((q) => mine.some((r) => r.item.value.endsWith("/" + q) && r.creator?.value.endsWith("/" + f.artistQid)))
        : [];
      if (byCreator.length === 1) out.set(f.file, byCreator[0]);
      else if (items.length === 1 && mine.every((r) => !r.creator)) out.set(f.file, items[0]);
    }
  }
  return out;
}

// ---------- 3. Wikidata claims ----------

interface Snak {
  snaktype: string;
  datavalue?: { value: any };
}
interface Claim {
  rank: "preferred" | "normal" | "deprecated";
  mainsnak: Snak;
  qualifiers?: Record<string, Snak[]>;
}
export type Claims = Record<string, Claim[]>;
// Keep complete statements (including qualifiers/references) only for the
// properties consumed by dimensions, attribution, dates and series cleanup.
const ENRICH_CLAIM_PROPS = ["P31", "P170", "P571", "P2049", "P2048", "P2386", "P179", "P361", "P527"];

async function getClaims(qids: string[]): Promise<Map<string, Claims>> {
  return fetchClaims(qids, ENRICH_CLAIM_PROPS, undefined, actionApi);
}

/** The statements to trust for a property: preferred rank wins, deprecated never counts. */
function bestStatements(claims: Claims, prop: string): Claim[] {
  const all = (claims[prop] ?? []).filter((c) => c.rank !== "deprecated" && c.mainsnak.snaktype === "value");
  const preferred = all.filter((c) => c.rank === "preferred");
  return preferred.length ? preferred : all;
}

// "applies to part" values that mean the number is NOT the painted surface.
const NOT_THE_PAINTING = new Set([
  "Q1060829", // picture frame
  "Q1424051", // frame (generic)
]);

function quantityCm(
  claims: Claims,
  prop: string
): { cm: number | null; note?: string; unit?: string; amount?: number } {
  const statements = bestStatements(claims, prop)
    // Statements qualified "applies to part: frame" describe the frame.
    .filter((c) => !(c.qualifiers?.P518 ?? []).some((q) => NOT_THE_PAINTING.has(q.datavalue?.value?.id)));
  // Unqualified statements describe the object as a whole; prefer them.
  const ordered = [
    ...statements.filter((c) => !c.qualifiers?.P518),
    ...statements.filter((c) => c.qualifiers?.P518),
  ];
  for (const c of ordered) {
    const v = c.mainsnak.datavalue?.value as { amount?: string; unit?: string } | undefined;
    if (!v?.amount) continue;
    const unit = (v.unit ?? "").split("/").pop() ?? "";
    const factor = UNIT_TO_CM[unit];
    if (!factor) return { cm: null, note: `${prop} unit ${unit || "none"} unsupported` };
    const cm = Math.round(parseFloat(v.amount) * factor * 10) / 10;
    // a millimetre value below MIN_CM may still be a unit slip (34.3 "mm" for a 34.3 cm panel)
    const amount = parseFloat(v.amount);
    if (unit === MM && Number.isFinite(cm) && cm * 10 >= MIN_CM && cm < MIN_CM) return { cm, unit, amount };
    if (!Number.isFinite(cm) || cm < MIN_CM || cm > MAX_CM) return { cm: null, note: `${prop}=${cm}cm out of range` };
    return { cm, unit, amount };
  }
  return { cm: null };
}

function inceptionYear(claims: Claims): number | null {
  for (const c of bestStatements(claims, "P571")) {
    const v = c.mainsnak.datavalue?.value as { time?: string; precision?: number } | undefined;
    const fromTime = (t?: { time?: string; precision?: number }) => {
      if (!t?.time || (t.precision ?? 0) < 9) return null; // year precision or better
      const m = /^([+-]\d+)-/.exec(t.time);
      return m ? parseInt(m[1], 10) : null;
    };
    const y = fromTime(v);
    if (y != null) return y;
    // decade/century inception qualified with an exact "earliest date" (P1319)
    const earliest = c.qualifiers?.P1319?.[0]?.datavalue?.value;
    const e = fromTime(earliest);
    if (e != null) return e;
  }
  return null;
}

interface Dimensions {
  widthCm: number | null;
  heightCm: number | null;
  note?: string;
}

// Multi-panel works: how many panels the item's class (P31) or title says it has.
const PANELS_BY_CLASS: Record<string, number> = {
  Q475476: 2, // diptych
  Q79218: 3, // triptych
};

function panelCount(claims: Claims, title: string): number | null {
  for (const c of bestStatements(claims, "P31")) {
    const n = PANELS_BY_CLASS[c.mainsnak.datavalue?.value?.id];
    if (n) return n;
  }
  if (/\bdiptych\b/i.test(title)) return 2;
  if (/\btriptych\b/i.test(title)) return 3;
  return null;
}

const round1 = (cm: number) => Math.round(cm * 10) / 10;

export function dimensions(claims: Claims, p: EnrichablePainting): Dimensions {
  // Q132599105 is a later composite of four separately painted sections.
  // Global item measurements do not establish the selected section's size.
  if (p.qid === "Q132599105") return { widthCm: null, heightCm: null };
  const w = quantityCm(claims, "P2049");
  const h = quantityCm(claims, "P2048");
  let widthCm = w.cm;
  let heightCm = h.cm;
  const notes = [w.note, h.note].filter(Boolean) as string[];
  // Recorded in millimetres yet under 5 cm: for anything but a portrait
  // miniature that is a centimetre value entered with the wrong unit.
  if (
    widthCm != null &&
    heightCm != null &&
    w.unit === MM &&
    h.unit === MM &&
    Math.max(widthCm, heightCm) < 5 &&
    !/miniature/i.test(`${p.title} ${p.story ?? ""}`)
  ) {
    notes.push(`unit slip: Wikidata ${w.amount} x ${h.amount} mm read as cm`);
    widthCm = round1(w.amount!);
    heightCm = round1(h.amount!);
  }
  if (widthCm != null && widthCm < MIN_CM) widthCm = null;
  if (heightCm != null && heightCm < MIN_CM) heightCm = null;
  if (widthCm == null && heightCm == null) {
    // Tondi are recorded by diameter only.
    const d = quantityCm(claims, "P2386");
    if (d.cm != null) widthCm = heightCm = d.cm;
    else if (d.note) notes.push(d.note);
  }
  if (widthCm != null && heightCm != null && p.imageWidth && p.imageHeight) {
    const photo = p.imageWidth / p.imageHeight;
    const off = (a: number) => Math.max(a / photo, photo / a);
    if (off(widthCm / heightCm) > ASPECT_TOLERANCE) {
      const photoPx = `photo ${p.imageWidth}x${p.imageHeight}px`;
      // Multi-panel works are sometimes recorded per panel: Wikidata gives
      // Warhol's Marilyn Diptych as 205.4 x 144.8 cm, one of its two panels.
      // When the class or title names the panel count and that many panels
      // side by side (or stacked) match the photo, the work is the whole row.
      const panels = panelCount(claims, p.title);
      if (panels && off((panels * widthCm) / heightCm) <= SWAP_TOLERANCE) {
        return {
          widthCm: round1(panels * widthCm),
          heightCm,
          note: `${panels} panels side by side: Wikidata width ${widthCm} / height ${heightCm}cm is one panel, ${photoPx}`,
        };
      }
      if (panels && off(widthCm / (panels * heightCm)) <= SWAP_TOLERANCE) {
        return {
          widthCm,
          heightCm: round1(panels * heightCm),
          note: `${panels} panels stacked: Wikidata width ${widthCm} / height ${heightCm}cm is one panel, ${photoPx}`,
        };
      }
      // A common Wikidata slip is entering "H x W" into width/height the wrong
      // way round. When the transposed pair matches the photograph closely,
      // the photo settles the orientation; anything else is rejected. Near a
      // sqrt(2) or sqrt(3) photo aspect a 2- or 3-panel reading fits as well;
      // for a work not known to have panels the transpose is the likelier
      // reading, but the report says so.
      if (off(heightCm / widthCm) <= SWAP_TOLERANCE) {
        const alsoPanels = [2, 3].find(
          (k) => off((k * widthCm) / heightCm) <= SWAP_TOLERANCE || off(widthCm / (k * heightCm)) <= SWAP_TOLERANCE
        );
        return {
          widthCm: heightCm,
          heightCm: widthCm,
          note:
            `transposed: Wikidata width ${widthCm} / height ${heightCm}cm, ${photoPx}` +
            (alsoPanels ? ` (also fits ${alsoPanels} panels of that size: check)` : ""),
        };
      }
      return {
        widthCm: null,
        heightCm: null,
        note: `rejected: ${widthCm}x${heightCm}cm vs photo ${p.imageWidth}x${p.imageHeight}px (aspect off x${off(widthCm / heightCm).toFixed(2)})`,
      };
    }
  }
  return { widthCm, heightCm, note: notes.join("; ") || undefined };
}

// ---------- 4. pageviews ----------

export function pageviewWindow(now = new Date()): { start: string; end: string } {
  // The last 12 complete calendar months (UTC).
  const endMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // last day of previous month
  const startMonth = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - 11, 1));
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}00`;
  return { start: fmt(startMonth), end: fmt(endMonth) };
}

async function titleViews(title: string, win: { start: string; end: string }): Promise<number> {
  const article = encodeURIComponent(title.replace(/ /g, "_"));
  const data = await restApi(() =>
    fetchJson<{ items?: { views: number }[] }>(`${PAGEVIEWS}/${article}/monthly/${win.start}/${win.end}`)
  );
  // 404 = no recorded views for an existing title in the window.
  return (data?.items ?? []).reduce((n, it) => n + (it.views ?? 0), 0);
}

/** Main-namespace redirects to each title (continuation-aware, 50 titles/request). */
async function redirectsTo(titles: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(titles.map((t) => [t, []]));
  for (const batch of chunks(titles, 50)) {
    let cont: Record<string, string> | null = {};
    while (cont) {
      const qs: URLSearchParams = new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "2",
        prop: "redirects",
        rdprop: "title",
        rdnamespace: "0",
        rdlimit: "max",
        titles: batch.join("|"),
        ...cont,
      });
      const data: {
        continue?: Record<string, string>;
        query?: { pages?: { title: string; redirects?: { title: string }[] }[] };
      } | null = await actionApi(() => fetchJson(`${WIKI_API}?${qs}`));
      if (!data?.query) throw new Error("redirects query returned nothing");
      for (const p of data.query.pages ?? []) out.get(p.title)?.push(...(p.redirects ?? []).map((r) => r.title));
      cont = data.continue ?? null;
    }
  }
  return out;
}

/**
 * 12-month views of an article = views of its current title plus every
 * redirect to it. Pageviews are recorded under the title in the URL, so a
 * renamed article (e.g. "Wanderer above the Sea of Fog" ->
 * "Wanderer Above the Sea of Fog") keeps most of its traffic on the old name.
 */
async function pageviews(title: string, redirects: string[], win: { start: string; end: string }): Promise<number> {
  const counts = await Promise.all([title, ...redirects].map((t) => titleViews(t, win)));
  return counts.reduce((a, b) => a + b, 0);
}


// ---------- 0. image file: byte size + current pixel size ----------

export interface ImageFileInfo {
  bytes: number;
  width: number;
  height: number;
}

/**
 * imageinfo (latest version) for each file, keyed "project|file". Files that
 * do not exist are left out; a failed request throws.
 */
export async function imageFileInfo(
  files: { project: string; file: string }[]
): Promise<Map<string, ImageFileInfo>> {
  const saved = readItemCache<ImageFileInfo>("image-info-v1.json");
  const out = new Map<string, ImageFileInfo>();
  const byProject = new Map<string, Set<string>>();
  for (const f of files) {
    if (!byProject.has(f.project)) byProject.set(f.project, new Set());
    byProject.get(f.project)!.add(f.file);
  }
  const batches = [...byProject].flatMap(([project, names]) => {
    const api = project === "commons" ? "https://commons.wikimedia.org/w/api.php" : `https://${project}.wikipedia.org/w/api.php`;
    const urlFor = (batch: string[]) => `${api}?${new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "imageinfo",
      iiprop: "size",
      titles: batch.map((f) => `File:${f}`).join("|"),
    })}`;
    const need = [...names].filter(file => {
      const cached = saved[`${project}|${file}`];
      if (cached) out.set(`${project}|${file}`, cached);
      return !cached;
    });
    return chunks(need, 50).flatMap(batch => splitLongRequest(batch, urlFor).map(request => ({ project, ...request })));
  });
  const batchLimit = createLimiter(2);
  const results = await Promise.all(batches.map(({ project, batch, url }) => batchLimit(async () => {
    const data = await fetchJson<{
        query?: {
          normalized?: { from: string; to: string }[];
          pages?: { title: string; imageinfo?: { size: number; width: number; height: number }[] }[];
        };
    }>(url, {}, undefined, actionApi);
    if (!data?.query) throw new Error(`imageinfo (${project}) returned nothing`);
    const norm = new Map((data.query.normalized ?? []).map((n) => [n.from, n.to]));
    const pages = new Map((data.query.pages ?? []).map((p) => [p.title, p]));
    const out = new Map<string, ImageFileInfo>();
    for (const f of batch) {
      const ii = pages.get(norm.get(`File:${f}`) ?? `File:${f}`)?.imageinfo?.[0];
      if (ii?.size) out.set(`${project}|${f}`, { bytes: ii.size, width: ii.width, height: ii.height });
    }
    return [...out];
  })));
  for (const [key, value] of results.flat()) {
    out.set(key, value);
    saved[key] = value;
  }
  if (batches.length) saveItemCache("image-info-v1.json", saved);
  return new Map([...byProject].flatMap(([project, names]) => [...names].flatMap(file => {
    const key = `${project}|${file}`;
    const value = out.get(key);
    return value ? [[key, value] as const] : [];
  })));
}

async function getLabels(qids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const batch of chunks(qids, 50)) {
    const data = await actionApi(() =>
      fetchJson<{ entities?: Record<string, { labels?: { en?: { value: string } } }> }>(
        `${WD_API}?action=wbgetentities&format=json&formatversion=2&props=labels&languages=en&ids=${batch.join("|")}`
      )
    );
    for (const q of batch) {
      const l = data?.entities?.[q]?.labels?.en?.value;
      if (l) out.set(q, l);
    }
  }
  return out;
}

// ---------- orchestration ----------

function creators(claims: Claims): string[] {
  return bestStatements(claims, "P170")
    .map((c) => c.mainsnak.datavalue?.value?.id as string | undefined)
    .filter((q): q is string => !!q);
}

/**
 * Image file of every painting, in place: imageBytes from imageinfo, and
 * imageWidth / imageHeight refreshed when the file was re-uploaded at another
 * size (each change listed in report.imageChanges). On a failed request the
 * previous values stay (reported in report.failures).
 */
export async function enrichImageFiles(
  rows: { artistSlug: string; p: EnrichablePainting }[],
  report: Pick<EnrichReport, "imageChanges" | "failures">
): Promise<void> {
  const files = rows.map((r) => ({ r, f: wikiFileOf(r.p.imageUrl) }));
  let info: Map<string, ImageFileInfo>;
  try {
    info = await imageFileInfo(files.flatMap((x) => (x.f ? [x.f] : [])));
  } catch (err) {
    report.failures.push(`imageinfo: ${err}`);
    return;
  }
  for (const { r, f } of files) {
    const ii = f ? info.get(`${f.project}|${f.file}`) : undefined;
    r.p.imageBytes = ii?.bytes ?? null;
    if (ii && ii.width > 0 && ii.height > 0 && (ii.width !== r.p.imageWidth || ii.height !== r.p.imageHeight)) {
      report.imageChanges.push(
        `${r.artistSlug}/${r.p.slug}: ${r.p.imageWidth}x${r.p.imageHeight} -> ${ii.width}x${ii.height}px (${f!.file})`
      );
      r.p.imageWidth = ii.width;
      r.p.imageHeight = ii.height;
    }
  }
}

/**
 * Fill widthCm / heightCm / pageviews / qid / imageBytes on every painting, in
 * place. A stage that fails (network) leaves the previous values untouched, so
 * a partial run never wipes good data; "looked it up, nothing there" writes null.
 */
export async function enrichArtists(
  artists: EnrichableArtist[],
  opts: EnrichOptions = {}
): Promise<EnrichReport> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const fixYears = opts.fixYears ?? true;
  const dropForeign = opts.dropForeign ?? true;
  const now = opts.now ?? new Date();
  const win = pageviewWindow(now);
  const report: EnrichReport = {
    generatedAt: now.toISOString(),
    pageviewWindow: win,
    paintings: 0,
    withArticle: 0,
    withQid: 0,
    qidFromImage: 0,
    withBothDims: 0,
    withAnyDim: 0,
    withPageviews: 0,
    withImageBytes: 0,
    rejectedDims: [],
    imageChanges: [],
    yearChanges: [],
    creatorMismatch: [],
    removed: [],
    removedSeries: [],
    unitFixes: [],
    withCredit: 0,
    failures: [],
  };

  type Row = { artist: EnrichableArtist; p: EnrichablePainting; title: string | null };
  const all: Row[] = [];
  for (const a of artists)
    for (const p of a.paintings) all.push({ artist: a, p, title: titleFromWikipediaUrl(p.wikipediaUrl) });
  report.paintings = all.length;

  // 0. image files first: the photo's aspect checks the Wikidata size below
  log(`fetching image file info for ${all.length} paintings (imageinfo, 50/request)`);
  await enrichImageFiles(
    all.map((x) => ({ artistSlug: x.artist.slug, p: x.p })),
    report
  );

  // 1. article -> canonical title + item
  const titles = [...new Set(all.map((x) => x.title).filter((t): t is string => !!t))];
  log(`resolving ${titles.length} article titles -> Wikidata items (pageprops, 50/request)`);
  let resolved: Map<string, ResolvedTitle | null> | null = null;
  try {
    resolved = await resolveTitles(titles);
  } catch (err) {
    report.failures.push(`pageprops: ${err}`);
  }

  const qidOf = new Map<EnrichablePainting, string>();
  const canonicalOf = new Map<EnrichablePainting, string>();
  for (const x of all) {
    if (x.p.qid && /^Q\d+$/.test(x.p.qid)) qidOf.set(x.p, x.p.qid);
    const r = x.title && resolved ? resolved.get(x.title) : undefined;
    if (r) {
      canonicalOf.set(x.p, r.canonical);
      if (r.qid) qidOf.set(x.p, r.qid);
    }
  }

  // 2. no article item: match the Commons image against Wikidata P18
  let imageOk = true;
  const byImage = all
    .filter((x) => !qidOf.has(x.p) && (!x.title || resolved))
    .map((x) => ({ x, file: commonsFileName(x.p.imageUrl) }))
    .filter((y): y is { x: Row; file: string } => !!y.file);
  if (byImage.length) {
    log(`matching ${byImage.length} Commons images -> Wikidata items (P18 via WDQS)`);
    try {
      const found = await itemsByImage(byImage.map((y) => ({ file: y.file, artistQid: y.x.artist.qid })));
      for (const y of byImage) {
        const q = found.get(y.file);
        if (q) {
          qidOf.set(y.x.p, q);
          report.qidFromImage++;
        }
      }
    } catch (err) {
      imageOk = false;
      report.failures.push(`P18 SPARQL: ${err}`);
    }
  }
  const lookupComplete = (x: Row) => (x.title ? resolved !== null : true) && imageOk;

  // 3. claims -> dimensions (+ inception for year repair)
  const qids = [...new Set(qidOf.values())];
  log(`fetching claims for ${qids.length} Wikidata items (wbgetentities, 50/request)`);
  let claims: Map<string, Claims> | null = null;
  try {
    claims = await getClaims(qids);
  } catch (err) {
    report.failures.push(`wbgetentities: ${err}`);
  }

  const mismatched: { x: Row; by: string[] }[] = [];
  for (const x of all) {
    const q = qidOf.get(x.p);
    if (q) x.p.qid = q;
    else if (lookupComplete(x)) x.p.qid = null;

    const c = q && claims ? claims.get(q) : undefined;
    if (c) {
      const d = dimensions(c, x.p);
      x.p.widthCm = d.widthCm;
      x.p.heightCm = d.heightCm;
      if (d.note) report.rejectedDims.push(`${x.artist.slug}/${x.p.slug} (${q}): ${d.note}`);
      const by = creators(c);
      if (x.artist.qid && by.length && !by.includes(x.artist.qid)) {
        report.creatorMismatch.push(`${x.artist.slug}/${x.p.slug} (${q}): P170 = ${by.join(",")}`);
        mismatched.push({ x, by });
      }
    } else if (!q && lookupComplete(x)) {
      x.p.widthCm = null;
      x.p.heightCm = null;
    }

    // Years outside the artist's working life are ingest misreads (a date
    // from the article lead, a century-precision inception). Replace with an
    // exact Wikidata inception inside the window, else clear.
    const canDecide = c ? true : !q && lookupComplete(x);
    if (fixYears && canDecide && x.p.year != null) {
      const lo = x.artist.birthYear != null ? x.artist.birthYear + 5 : -Infinity;
      const hi = x.artist.deathYear != null ? x.artist.deathYear + 1 : now.getUTCFullYear();
      const y = x.p.year;
      if (y < lo || y > hi) {
        const inc = c && q !== "Q132599105" ? inceptionYear(c) : null;
        const next = inc != null && inc >= lo && inc <= hi ? inc : null;
        report.yearChanges.push(
          `${x.artist.slug}/${x.p.slug}: ${y} -> ${next ?? "null"} (${
            next != null ? `Wikidata ${q} P571` : `outside ${x.artist.birthYear}-${x.artist.deathYear ?? "today"}, no usable Wikidata inception`
          })`
        );
        x.p.year = next;
      }
    }
  }

  // 3b. works by someone else: P170 names another artist and so does the title
  if (dropForeign && mismatched.length) {
    try {
      const labels = await getLabels([...new Set(mismatched.flatMap((m) => m.by))]);
      const words = (s: string) =>
        s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      for (const { x, by } of mismatched) {
        const titleWords = new Set(words(`${x.p.title} ${x.title ?? ""}`));
        const other = by
          .map((q) => labels.get(q))
          .find((l) => {
            const surname = l ? words(l).pop() ?? "" : "";
            return surname.length >= 3 && titleWords.has(surname);
          });
        if (!other) continue;
        const i = x.artist.paintings.indexOf(x.p);
        if (i >= 0) x.artist.paintings.splice(i, 1);
        report.removed.push(`${x.artist.slug}/${x.p.slug}`);
        log(`  removed ${x.artist.slug}/${x.p.slug}: Wikidata creator is ${other} and the title names them`);
      }
    } catch (err) {
      report.failures.push(`creator labels: ${err}`);
    }
  }
  if (claims) report.removedSeries = dropSeriesRepresentatives(artists, claims);
  const kept = new Set(artists.flatMap((a) => a.paintings));
  for (let i = all.length - 1; i >= 0; i--) if (!kept.has(all[i].p)) all.splice(i, 1);
  report.paintings = all.length;

  // 3c. sizes far too small for the work: a unit slip in Wikidata?
  await crossCheckSmallDims(
    all.map((x) => ({ artistSlug: x.artist.slug, p: x.p })),
    report
  );

  // 3d. credit lines for every image and portrait
  await attachImageCredits(artists, report, opts.fileMeta, log);

  // 4. pageviews (articles only)
  const canonTitles = [...new Set(canonicalOf.values())];
  let redirects = new Map<string, string[]>();
  try {
    redirects = await redirectsTo(canonTitles);
  } catch (err) {
    report.failures.push(`redirects: ${err}`);
  }
  const nRedirects = [...redirects.values()].reduce((n, r) => n + r.length, 0);
  log(
    `fetching 12-month pageviews for ${canonTitles.length} articles + ${nRedirects} redirects (${win.start}..${win.end})`
  );
  const views = new Map<string, number>();
  let done = 0;
  await Promise.all(
    canonTitles.map(async (t) => {
      try {
        // Without the redirect list (lookup failed) a sum would be an undercount: skip.
        if (!redirects.has(t)) throw new Error("redirect list unavailable");
        views.set(t, await pageviews(t, redirects.get(t)!, win));
      } catch (err) {
        report.failures.push(`pageviews ${t}: ${err}`);
      }
      if (++done % 100 === 0) log(`  pageviews ${done}/${canonTitles.length}`);
    })
  );
  for (const x of all) {
    const t = canonicalOf.get(x.p);
    if (t && views.has(t)) x.p.pageviews = views.get(t)!;
    else if (!x.title) x.p.pageviews = null;
    else if (x.p.pageviews === undefined) x.p.pageviews = null;
  }

  // Stable key order for the new fields (appended after the ingest fields).
  for (const x of all) {
    const p = x.p as unknown as Record<string, unknown>;
    for (const k of ["widthCm", "heightCm", "pageviews", "qid", "imageBytes", "imageCredit"]) {
      const v = p[k] === undefined ? null : p[k];
      delete p[k];
      p[k] = v;
    }
  }

  for (const x of all) {
    if (x.title) report.withArticle++;
    if (x.p.qid) report.withQid++;
    if (x.p.widthCm != null && x.p.heightCm != null) report.withBothDims++;
    if (x.p.widthCm != null || x.p.heightCm != null) report.withAnyDim++;
    if (x.p.pageviews != null) report.withPageviews++;
    if (x.p.imageBytes != null) report.withImageBytes++;
  }
  return report;
}

// ---------- unit slips ----------

const WIKI_API_EN = "https://en.wikipedia.org/w/api.php";

/** Height x width (cm) from an article's Infobox artwork, or null. */
export function infoboxSizeCm(wikitext: string): { h: number; w: number } | null {
  const num = (k: string) => {
    const m = new RegExp(String.raw`\|\s*${k}\s*=\s*([\d.,]+)`, "i").exec(wikitext);
    return m ? parseFloat(m[1].replace(/,/g, ".")) : null;
  };
  const unit = /\|\s*metric_unit\s*=\s*(mm|cm|m)\b/i.exec(wikitext)?.[1]?.toLowerCase() ?? "cm";
  const f = unit === "mm" ? 0.1 : unit === "m" ? 100 : 1;
  const h = num("height_metric");
  const w = num("width_metric");
  if (h && w) return { h: h * f, w: w * f };
  const d = /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*cm\b/i.exec(wikitext);
  return d ? { h: parseFloat(d[1].replace(",", ".")), w: parseFloat(d[2].replace(",", ".")) } : null;
}

/**
 * Works whose Wikidata size makes them smaller than 20 cm: when the article
 * infobox gives the same proportions ten (or a hundred) times larger, the
 * Wikidata value was entered in the wrong unit — multiply it out.
 */
export async function crossCheckSmallDims(
  rows: { artistSlug: string; p: EnrichablePainting }[],
  report: Pick<EnrichReport, "unitFixes" | "failures">
): Promise<void> {
  const small = rows.filter(
    (r) => r.p.widthCm != null && r.p.heightCm != null && Math.max(r.p.widthCm, r.p.heightCm) < 20 && r.p.wikipediaUrl
  );
  for (const r of small) {
    const title = titleFromWikipediaUrl(r.p.wikipediaUrl);
    if (!title) continue;
    let wikitext: string | null = null;
    try {
      const data = await actionApi(() =>
        fetchJson<{ parse?: { wikitext?: string } }>(
          `${WIKI_API_EN}?action=parse&format=json&formatversion=2&redirects=1&prop=wikitext&section=0&page=${encodeURIComponent(title)}`
        )
      );
      wikitext = data?.parse?.wikitext ?? null;
    } catch (err) {
      report.failures.push(`infobox ${title}: ${err}`);
      continue;
    }
    const box = wikitext ? infoboxSizeCm(wikitext) : null;
    if (!box) continue;
    const ours = Math.max(r.p.widthCm!, r.p.heightCm!);
    const theirs = Math.max(box.h, box.w);
    const ratio = theirs / ours;
    const factor = ratio > 8 && ratio < 12.5 ? 10 : ratio > 80 && ratio < 125 ? 100 : null;
    if (!factor) continue;
    const before = `${r.p.widthCm}x${r.p.heightCm}`;
    r.p.widthCm = round1(r.p.widthCm! * factor);
    r.p.heightCm = round1(r.p.heightCm! * factor);
    report.unitFixes.push(
      `${r.artistSlug}/${r.p.slug}: ${before} -> ${r.p.widthCm}x${r.p.heightCm}cm (Wikidata unit slip; infobox ${box.h}x${box.w}cm)`
    );
  }
}

// ---------- credits ----------

/** imageCredit / portraitCredit from each file's description page; a failed lookup keeps the previous credit. */
export async function attachImageCredits(
  artists: EnrichableArtist[],
  report: Pick<EnrichReport, "withCredit" | "failures">,
  known: Map<string, FileMeta> = new Map(),
  log: (m: string) => void = () => {}
): Promise<Map<string, FileMeta>> {
  const urls = artists.flatMap((a) => [a.portraitUrl, ...a.paintings.map((p) => p.imageUrl)]).filter((u): u is string => !!u);
  const need = [...new Set(urls.filter((u) => !known.has(u)))];
  let meta = known;
  if (need.length) {
    log(`fetching credit lines for ${need.length} images (extmetadata, 50/request)`);
    try {
      meta = new Map([...known, ...(await fetchFileMeta(need))]);
    } catch (err) {
      report.failures.push(`extmetadata: ${err}`);
      return known;
    }
  }
  const credit = (u: string | null | undefined) => (u ? meta.get(u)?.credit ?? null : null);
  for (const a of artists) {
    if ("portraitUrl" in a) a.portraitCredit = credit(a.portraitUrl);
    for (const p of a.paintings) {
      p.imageCredit = credit(p.imageUrl);
      if (p.imageCredit) report.withCredit++;
    }
  }
  return meta;
}
