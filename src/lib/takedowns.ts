// Works whose image is withheld at the rights holder's request.
//
// Works still in copyright are shown with the image Wikipedia uses for them
// and labelled "© In copyright". If you hold the rights to one and want its
// image removed, open an issue (template: "Copyright / takedown request") or
// a pull request adding the work's English Wikipedia URL — or just its article
// title — below. A listed work keeps its place, title, story and Wikipedia
// link; only the image goes.
//
// Entries are matched loosely: http or https, en.wikipedia.org or the mobile
// en.m.wikipedia.org, percent-encoded or not, spaces or underscores, any
// "#section" / "?query" suffix, and a lower-case first letter all match.
//
// Applied when the data is read (src/lib/data.ts), so a takedown needs only a
// redeploy — no re-ingest.

const ENTRIES: readonly string[] = [
  // "https://en.wikipedia.org/wiki/Example_painting",
  // "Example painting",
];

/**
 * Canonical article title of an English Wikipedia URL or a bare title:
 * decoded, underscores as spaces, whitespace collapsed, first letter upper
 * case (MediaWiki titles are case-insensitive only in their first letter).
 */
export function canonicalTitle(urlOrTitle: string): string | null {
  let t = urlOrTitle.trim();
  if (!t) return null;
  const m = /^(?:https?:)?\/\/(?:en\.(?:m\.)?wikipedia\.org)\/(?:wiki\/|w\/index\.php\?(?:.*&)?title=)([^?#&]+)/i.exec(t);
  if (m) t = m[1];
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return null; // some other site
  else t = t.replace(/[?#].*$/, "");
  try {
    t = decodeURIComponent(t);
  } catch {
    // a stray "%": keep the text as written
  }
  t = t.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const TAKEDOWNS: ReadonlySet<string> = new Set(
  ENTRIES.map(canonicalTitle).filter((t): t is string => !!t)
);

/** True when this work's image must not be shown. */
export function isTakenDown(wikipediaUrl: string | null | undefined): boolean {
  if (!wikipediaUrl || TAKEDOWNS.size === 0) return false;
  const t = canonicalTitle(wikipediaUrl);
  return !!t && TAKEDOWNS.has(t);
}
