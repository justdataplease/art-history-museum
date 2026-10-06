// Per-image credit lines (author, licence, file page) from the file's
// description page on Wikimedia Commons or English Wikipedia — the attribution
// CC BY / CC BY-SA require wherever the image is shown. Also returns the raw
// metadata the ingest uses to vet an image (object name, categories,
// description), so one extmetadata pass serves both.

import { decodeEntities } from "../../src/lib/text";
import { fetchJson, sleep } from "./wiki";

/** Same shape as ImageCredit in src/lib/types.ts. */
export interface ImageCredit {
  author: string | null;
  license: string;
  licenseUrl: string | null;
  page: string;
}

export interface FileMeta {
  credit: ImageCredit;
  /** Plain-text ObjectName / ImageDescription (title of the depicted work, caption). */
  objectName: string;
  description: string;
  /** Commons / enwiki categories of the file. */
  categories: string[];
  nonFree: boolean;
}

/** Wiki project ("commons", "en") and file name behind an upload.wikimedia.org URL (original or thumb). */
export function wikiFileOf(imageUrl: string | null | undefined): { project: string; file: string } | null {
  if (!imageUrl) return null;
  try {
    const u = new URL(imageUrl);
    if (u.hostname !== "upload.wikimedia.org") return null;
    // /wikipedia/<project>/[thumb/]a/ab/File.jpg[/<N>px-File.jpg]
    const m = /^\/wikipedia\/([^/]+)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/.exec(u.pathname);
    return m ? { project: m[1], file: decodeURIComponent(m[2]).replace(/_/g, " ") } : null;
  } catch {
    return null;
  }
}

const fileKey = (f: { project: string; file: string }) => `${f.project}|${f.file}`;

/** Description page of a file: https://commons.wikimedia.org/wiki/File:X or https://en.wikipedia.org/wiki/File:X. */
export function filePageUrl(f: { project: string; file: string }): string {
  const host = f.project === "commons" ? "commons.wikimedia.org" : `${f.project}.wikipedia.org`;
  const t = encodeURIComponent(`File:${f.file}`.replace(/ /g, "_")).replace(/%3A/gi, ":").replace(/%2C/gi, ",");
  return `https://${host}/wiki/${t}`;
}

/** extmetadata HTML -> plain text: hidden spans (QuickStatements, sort keys) dropped, tags stripped, entities decoded. */
export function plainText(html: string | undefined | null, cap = 0): string {
  if (!html) return "";
  let s = String(html).replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // hidden machine-readable copies ("title QS:P1476,...", duplicate author names)
  for (let i = 0; i < 3; i++)
    s = s.replace(/<(span|div)[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>(?:(?!<\1)[\s\S])*?<\/\1>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ");
  s = decodeEntities(s).replace(/\s+/g, " ").trim();
  if (cap && s.length > cap) s = s.slice(0, cap - 1).replace(/\s+\S*$/, "") + "…";
  return s;
}

const api = (project: string) =>
  project === "commons" ? "https://commons.wikimedia.org/w/api.php" : `https://${project}.wikipedia.org/w/api.php`;

/**
 * extmetadata for every image URL (50 files per request, one project at a
 * time, paced). Keyed by the image URL as given; files that no longer exist
 * are left out. A failed request throws (callers keep their previous data).
 */
export async function fetchFileMeta(
  urls: (string | null | undefined)[],
  opts: { log?: (m: string) => void; spacingMs?: number } = {}
): Promise<Map<string, FileMeta>> {
  const byKey = new Map<string, FileMeta>();
  const files = new Map<string, { project: string; file: string }>();
  for (const u of urls) {
    const f = wikiFileOf(u);
    if (f) files.set(fileKey(f), f);
  }
  const byProject = new Map<string, string[]>();
  for (const f of files.values()) {
    if (!byProject.has(f.project)) byProject.set(f.project, []);
    byProject.get(f.project)!.push(f.file);
  }
  let done = 0;
  for (const [project, names] of byProject) {
    for (let i = 0; i < names.length; i += 50) {
      const batch = names.slice(i, i + 50);
      const qs = new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "2",
        prop: "imageinfo",
        iiprop: "extmetadata",
        iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ObjectName|ImageDescription|Categories|NonFree",
        iiextmetadatalanguage: "en",
        titles: batch.map((f) => `File:${f}`).join("|"),
      });
      const data = await fetchJson<{
        query?: {
          normalized?: { from: string; to: string }[];
          pages?: { title: string; missing?: boolean; imageinfo?: { extmetadata?: Record<string, { value: unknown }> }[] }[];
        };
      }>(`${api(project)}?${qs}`);
      if (!data?.query) throw new Error(`extmetadata (${project}) returned nothing`);
      const norm = new Map((data.query.normalized ?? []).map((n) => [n.from, n.to]));
      const pages = new Map((data.query.pages ?? []).map((p) => [p.title, p]));
      for (const name of batch) {
        const page = pages.get(norm.get(`File:${name}`) ?? `File:${name}`);
        const em = page?.imageinfo?.[0]?.extmetadata;
        if (!page || page.missing || !em) continue;
        const v = (k: string) => (em[k]?.value == null ? "" : String(em[k].value));
        const f = { project, file: page.title.replace(/^File:/, "") };
        const author = plainText(v("Artist"), 120) || null;
        const nonFree = !!v("NonFree") && v("NonFree") !== "false";
        byKey.set(`${project}|${name}`, {
          credit: {
            author,
            license: plainText(v("LicenseShortName")) || (nonFree ? "Fair use" : "Unknown"),
            licenseUrl: v("LicenseUrl").trim() || null,
            page: filePageUrl(f),
          },
          objectName: plainText(v("ObjectName"), 300),
          description: plainText(v("ImageDescription"), 600),
          categories: v("Categories").split("|").map((c) => c.trim()).filter(Boolean),
          nonFree,
        });
      }
      done += batch.length;
      opts.log?.(`  extmetadata ${project}: ${Math.min(i + 50, names.length)}/${names.length}`);
      await sleep(opts.spacingMs ?? 300);
    }
  }
  const out = new Map<string, FileMeta>();
  for (const u of urls) {
    const f = wikiFileOf(u);
    const m = f && byKey.get(fileKey(f));
    if (u && m) out.set(u, m);
  }
  return out;
}
