// Finding an artist by name in the Explore panel: a word of the name that starts with the query, however the
// visitor types accents and punctuation, and failing that a name within a few typos ("Vermer", "rembrant",
// "carravagio"). Plain code, no index: ~600 names are scored on every keystroke in well under a millisecond each.

/** The combining accents NFKD splits off, U+0300 to U+036F. */
const ACCENTS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

/** Case- and accent-insensitive ("Dürer" matches "durer", "Gérôme" "gerome"). */
const fold = (s: string) => s.normalize("NFKD").replace(ACCENTS, "").toLowerCase();

/** Hyphens and dashes, apostrophes and quotes, periods and commas. */
const PUNCT = /[-‐-―−'‘’ʼ`´".,]/g;

/** Punctuation as word breaks: "Jean-Léon" → "jean leon", "J. M. W." → "j m w". */
export const spaced = (s: string) => fold(s).replace(PUNCT, " ").replace(/\s+/g, " ").trim();
/** Punctuation dropped: "O'Keeffe" → "okeeffe", "Jean-Léon" → "jeanleon". */
const joined = (s: string) => fold(s).replace(PUNCT, "").replace(/\s+/g, " ").trim();
/** No spaces at all: "J. M. W. Turner" → "jmwturner". */
const squashed = (s: string) => joined(s).replace(/ /g, "");

/** What a name is searched by. */
export interface NameEntry {
  /**
   * It matches where one of its words starts with the query ("gogh", "van g"), however the visitor types the
   * punctuation: "jean-léon", "jean leon", "o'keeffe", "okeeffe", "o keeffe", "j.m.w. turner", "jmw turner". The
   * name and the query are normalised the same three ways ("|" keeps one variant from running on into the next).
   */
  key: string;
  /** The words a typo may aim at: punctuation as breaks or dropped, and each pair run together ("vangogh"). */
  words: string[];
}

export function nameEntry(name: string): NameEntry {
  const words = spaced(name).split(" ");
  const all = new Set([...words, ...joined(name).split(" ")]);
  for (let i = 1; i < words.length; i++) all.add(words[i - 1] + words[i]);
  all.delete("");
  return { key: ` ${spaced(name)} | ${joined(name)} | ${squashed(name)} |`, words: [...all] };
}

interface NameQuery {
  /** Empty: the query has no letters, everything matches. */
  keys: string[];
  /** The query's words read two ways (punctuation as breaks, dropped); empty when no word is long enough to
   *  allow a typo. */
  forms: string[][];
}

/** Typos a query word may hold: none under 4 letters, one up to 7, two from 8 ("carravagio" → Caravaggio). */
const allowance = (letters: number) => (letters < 4 ? 0 : letters < 8 ? 1 : 2);

function nameQuery(q: string): NameQuery {
  const keys = new Set<string>();
  for (const k of [spaced(q), joined(q), squashed(q)]) if (k) keys.add(" " + k);
  const forms = new Map<string, string[]>();
  for (const f of [spaced(q).split(" "), joined(q).split(" ")]) {
    const words = f.filter(Boolean);
    if (words.some((w) => allowance(w.length) > 0)) forms.set(words.join(" "), words);
  }
  return { keys: [...keys], forms: [...forms.values()] };
}

/** Does a word of the name start with the query? */
const holds = (q: NameQuery, e: NameEntry) => !q.keys.length || q.keys.some((k) => e.key.includes(k));

// three rows of the edit-distance table, reused across calls
let rowA = new Int32Array(32);
let rowB = new Int32Array(32);
let rowC = new Int32Array(32);

/**
 * Typos from query word `q` to word `w`, when at most `k`: insertions, deletions, changes and two neighbours
 * swapped ("gohg") count one each (optimal string alignment). A word that only begins like `q` ("carrav" while
 * typing Caravaggio) counts half a typo more, and only from 5 letters with the first letter right. Infinity
 * when further.
 */
function typos(q: string, w: string, k: number): number {
  const m = q.length;
  const n = w.length;
  // columns past m + k cannot come back within k: a longer word can only match as a prefix
  const cols = Math.min(n, m + k);
  if (cols < m - k) return Infinity;
  if (rowA.length <= cols) {
    rowA = new Int32Array(cols + 16);
    rowB = new Int32Array(cols + 16);
    rowC = new Int32Array(cols + 16);
  }
  let before = rowA; // row i - 2
  let prev = rowB; // row i - 1
  let cur = rowC;
  for (let j = 0; j <= cols; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const qc = q.charCodeAt(i - 1);
    const qb = i > 1 ? q.charCodeAt(i - 2) : -1;
    cur[0] = i;
    let low = i;
    for (let j = 1; j <= cols; j++) {
      const wc = w.charCodeAt(j - 1);
      let d = prev[j - 1] + (qc === wc ? 0 : 1);
      if (prev[j] + 1 < d) d = prev[j] + 1;
      if (cur[j - 1] + 1 < d) d = cur[j - 1] + 1;
      if (j > 1 && qc === w.charCodeAt(j - 2) && qb === wc && before[j - 2] + 1 < d) d = before[j - 2] + 1;
      cur[j] = d;
      if (d < low) low = d;
    }
    if (low > k) return Infinity; // a row's minimum never falls further down
    const t = before;
    before = prev;
    prev = cur;
    cur = t;
  }
  // `prev` holds the last row: the cost of q against each prefix of w
  let best = cols === n && prev[n] <= k ? prev[n] : Infinity;
  if (m >= 5 && q.charCodeAt(0) === w.charCodeAt(0)) {
    for (let j = Math.max(1, m - k); j <= cols; j++) if (prev[j] + 0.5 < best && prev[j] <= k) best = prev[j] + 0.5;
  }
  return best;
}

/**
 * How many typos the name is from the query: each query word takes the closest word of the name (a short query
 * word must begin one exactly), summed; the best reading of the query wins. Infinity when any word is too far.
 */
function typoScore(q: NameQuery, e: NameEntry): number {
  let best = Infinity;
  for (const words of q.forms) {
    let sum = 0;
    for (const t of words) {
      const k = allowance(t.length);
      let near = Infinity;
      for (const w of e.words) {
        const d = k ? typos(t, w, k) : w.startsWith(t) ? 0 : Infinity;
        if (d < near) near = d;
        if (near === 0) break;
      }
      sum += near;
      if (sum >= best) break;
    }
    if (sum < best) best = sum;
  }
  return best;
}

/** Close matches listed at most. */
const MAX_CLOSE = 8;

/**
 * The items whose name holds the query, in their order (a name the query only runs together, "vangogh", counts),
 * then up to MAX_CLOSE close ones: those within half a typo of the closest, fewest typos first, then by `rank`.
 */
export function findNames<T>(
  items: readonly T[],
  entries: readonly NameEntry[],
  query: string,
  rank: (a: T, b: T) => number,
): { exact: T[]; close: T[] } {
  const q = nameQuery(query);
  const exact: T[] = [];
  const near: { item: T; d: number }[] = [];
  items.forEach((item, i) => {
    if (holds(q, entries[i])) return void exact.push(item);
    if (!q.forms.length) return;
    const d = typoScore(q, entries[i]);
    if (d === 0) exact.push(item);
    else if (d < Infinity) near.push({ item, d });
  });
  const least = Math.min(...near.map((n) => n.d));
  const close = near
    .filter((n) => n.d <= least + 0.5)
    .sort((a, b) => a.d - b.d || rank(a.item, b.item))
    .slice(0, MAX_CLOSE)
    .map((n) => n.item);
  return { exact, close };
}
