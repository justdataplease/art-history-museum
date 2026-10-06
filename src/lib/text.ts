// Small text clean-ups for strings that come verbatim from Wikipedia.
// Pure functions (no server/client-only imports): used by the data layer,
// the ingest scripts' output and the timeline.

const NAMED: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: String.fromCharCode(160),
};

/** Undo HTML entities that survived the Wikipedia ingest ("O&#039;Keeffe"). */
export function decodeEntities(s: string): string {
  if (!s || s.indexOf("&") === -1) return s;
  return s.replace(/&(#\d+|#x[0-9a-f]+|amp|quot|apos|lt|gt|nbsp);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === "#") {
      const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      // Beyond U+10FFFF String.fromCodePoint throws: not a character, keep the text.
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return m;
      // NUL and lone surrogates are not characters either (HTML maps them to U+FFFD).
      return n === 0 || (n >= 0xd800 && n <= 0xdfff) ? "\uFFFD" : String.fromCodePoint(n);
    }
    return NAMED[k] ?? m;
  });
}

/** An artist's display name: entities decoded and a trailing Wikipedia
 *  disambiguator dropped ("Francis Bacon (artist)" -> "Francis Bacon"). */
export function cleanArtistName(name: string): string {
  return decodeEntities(name).replace(/\s*\((artist|painter)\)$/i, "");
}
