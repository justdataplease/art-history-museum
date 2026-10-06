// Vetting rules shared by the ingest (scripts/ingest.ts) and the repair pass
// (scripts/repair-data.ts): is an article about an artwork at all, which year
// to show, is a Commons description usable as a story, does an image show the
// work it hangs for, and is the artist still in copyright. Pure functions over
// data fetched elsewhere — nothing here touches the network.

import type { FileMeta } from "./credits";

// ---------- copyright ----------

/** Within copyright: the artist died less than 70 years ago (life + 70, the
 *  term in the EU and most of the world), or is alive / born after 1880 with
 *  no recorded death. Every work by such an artist is labelled © — whatever
 *  the US status of the file Wikipedia shows (a "PD-US" file is still in
 *  copyright in the artist's own country). */
export function artistInCopyright(birthYear?: number | null, deathYear?: number | null, now = new Date()): boolean {
  const year = now.getFullYear();
  if (deathYear != null) return deathYear > year - 71;
  return birthYear != null && birthYear > 1880;
}

// ---------- is this article about an artwork? ----------

/** Wikidata classes (P31) of artworks: an article whose item has one of these is a work. */
export const ARTWORK_CLASSES = new Set([
  "Q3305213", // painting
  "Q15727816", // painting series
  "Q4502142", // visual artwork
  "Q838948", // work of art
  "Q22669139", // fresco
  "Q134194", // fresco painting
  "Q2263612", // fresco-secco
  "Q99516640", // wall painting
  "Q219423", // mural
  "Q16905550", // cycle of frescoes
  "Q16905563", // cycle of paintings
  "Q19573550", // painted ceiling
  "Q79218", // triptych
  "Q475476", // diptych
  "Q1278452", // polyptych
  "Q144860", // altarpiece
  "Q15711026", // altarpiece
  "Q11801536", // winged altarpiece
  "Q46686", // reredos
  "Q1411766", // predella
  "Q3513449", // devotional panel
  "Q106857709", // panel
  "Q55439", // panel painting
  "Q16593391", // tableau
  "Q848330", // tondo
  "Q192110", // self-portrait
  "Q18761202", // watercolor painting
  "Q21281546", // gouache painting
  "Q56676227", // oil painting
  "Q1964917", // oil sketch
  "Q12043905", // pastel artwork
  "Q5299612", // double-sided painting
  "Q18573970", // group of paintings
  "Q1404472", // group of paintings
  "Q114054440", // pair of paintings
  "Q591644", // pendant
  "Q110315192", // series of similar 2-D artworks
  "Q15709879", // artwork series
  "Q1443637", // tetralogy
  "Q2617970", // pentalogy
  "Q93184", // drawing
  "Q19828370", // drawing series
  "Q5078274", // sketch
  "Q2647254", // study
  "Q1416517", // cartoon
  "Q178659", // illustration
  "Q48498", // illuminated manuscript
  "Q11060274", // print
  "Q18218093", // etching print
  "Q18887969", // copper engraving print
  "Q15123870", // lithograph print
  "Q22669857", // collage
  "Q5137101", // cut-paper work
  "Q133067", // mosaic
  "Q942787", // lunette
  "Q22970505", // painted crucifix
  "Q132137", // icon
  "Q132413", // Hodegetria
  "Q370665", // sacra conversazione
  "Q2378522", // processional standard
  "Q131885457", // organ shutters
  "Q3024324", // desco da parto
  "Q683010", // ex-voto
  "Q13578361", // epitaph
  "Q722604", // reliquary
  "Q3323788", // reception piece
  "Q17450342", // envoi de Rome
  "Q5753938", // tapestry cartoons (Goya)
  "Q860861", // sculpture
  "Q19479037", // sculpture series
  "Q20437094", // installation artwork
  "Q3937287", // art intervention
  "Q504073", // stencil
  "Q42503423", // untitled work of art
  "Q21745157", // destroyed artwork
  "Q4140840", // lost artwork
  "Q104438958", // lost painting
  "Q21752591", // lost work
  "Q11086567", // fragment
  "Q1784021", // artwork copy
  "Q17152495", // prime version
  "Q2910675", // unfinished creative work
  "Q1406161", // artistic theme (a composition known in several versions)
]);

/** Classes that are never an artwork: people's biographies are judged by their lead instead. */
export const NON_ARTWORK_CLASSES = new Set([
  "Q13406463", // Wikimedia list article
  "Q4167410", // disambiguation page
  "Q41176", // building
  "Q35112127", // historic building
  "Q108325", // chapel
  "Q16970", // church building
  "Q160742", // abbey
  "Q2651004", // palazzo
  "Q3950", // villa
  "Q33506", // museum
  "Q207694", // art museum
  "Q178561", // battle
  "Q1261499", // naval battle
  "Q571", // book
  "Q7725634", // literary work
  "Q47114558", // art catalog
  "Q1050259", // catalogue raisonné
  "Q7328910", // art collection
  "Q667276", // art exhibition
  "Q3433300", // solo exhibition
  "Q217102", // conservation-restoration
  "Q5991868", // maintenance
  "Q7366", // song
  "Q482994", // album
  "Q2188189", // musical work
  "Q105543609", // musical work/composition
  "Q182832", // concert
  "Q11424", // film
]);

const HUMAN = "Q5";

/** First sentence of a lead (abbreviations such as "c." and initials don't end it). */
export function firstSentence(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  const re = /[.!?](?=\s+["“'(]?[A-Z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 4), m.index + 1);
    // "c.", "ca.", "St.", "Mr.", "No.", single initials ("J. M. W.")
    if (/(?:\b(?:c|ca|St|Mr|Mrs|Dr|No|Jr|Sr|fl|b|d)|\b[A-Z])\.$/.test(before)) continue;
    return s.slice(0, m.index + 1);
  }
  return s;
}

const WORK_NOUN = [
  "paintings?|portraits?|self-portraits?|fresco(?:e?s)?|murals?|triptychs?|diptychs?|polyptychs?|altarpieces?",
  "panels?|canvas(?:es)?|oil-on-(?:canvas|panel|wood|linen|copper)|drawings?|watercolou?rs?|gouaches?|pastels?",
  String.raw`series|cycles?|sets?|pairs?|groups?|artworks?|works?(?:\s+of\s+art)?|pictures?|tondo|tondi|miniatures?`,
  "sketch(?:es)?|stud(?:y|ies)|prints?|etchings?|engravings?|lithographs?|woodcuts?|screenprints?|silkscreens?",
  "serigraphs?|monotypes?|paper-cuts?|collages?|mosaics?|icons?|illustrations?|cartoons?|sculptures?|installations?",
  "reliefs?|predellas?|lunettes?|landscapes?|motifs?|versions?|copies|copy|compositions?|subjects?",
].join("|");
// "X is/was [an/the …] <modifiers> painting": the subject of the first
// sentence is itself the work. Modifiers never include "of / by / for / who /
// known …" — "was a merchant known for his portrait by Hals" is a person.
const subjectIs = (nouns: string) =>
  new RegExp(
    String.raw`\b(?:is|was|are|were|comprises|comprised|refers? to|may refer to)\s+` +
      String.raw`(?:(?:the\s+)?(?:name|title)\s+(?:commonly\s+)?(?:given\s+)?(?:to|of)\s+)?` +
      String.raw`(?:(?:an?|the|one|two|three|four|five|six|seven|eight|nine|ten|twelve|several|many|at least|a number of)\s+)*` +
      String.raw`(?:(?!(?:of|by|for|who|which|that|known|famous|best|whose|from|with|as)\b)[\w'’.,–-]+\s+){0,7}?` +
      String.raw`(?:${nouns})\b`,
    "i"
  );
const SUBJECT_IS_WORK = subjectIs(WORK_NOUN);
// the same with only nouns that can't be anything but visual art ("a
// collaborative work by composer …" is not)
const SUBJECT_IS_PICTURE = subjectIs(
  WORK_NOUN.split("|")
    .filter((n) => !/^(series|cycles|sets|pairs|groups|works|versions|copies|copy|compositions|subjects|motifs|landscapes|installations)/.test(n))
    .join("|")
);
// "Vincent van Gogh drew and painted a series of works …"
const PAINTED_A_WORK = new RegExp(
  String.raw`\b(?:painted|drew|made|created|produced|executed)\s+(?:an?|the|two|three|several)\s+(?:[\w'’-]+\s+){0,3}(?:${WORK_NOUN})\b`,
  "i"
);
// "… was painted by …"
const WAS_PAINTED = /\b(?:was|were) (?:painted|drawn|frescoed|made|created|completed)\b/i;
const ANY_WORK_NOUN = new RegExp(String.raw`\b(?:${WORK_NOUN}|painted|drawn)\b`, "i");
// subjects that are never an artwork, whatever else the lead mentions
const NOT_ART_LEAD =
  /\b(?:composer|album|song|opera house|film|documentary|poem|novel|book|catalogue|catalog|exhibition|museum|church|chapel|basilica|palace|building|battle|performed|performance|concert|collection of)\b/i;

/** The lead's first sentence presents its subject as an artwork (strict: biographies fail). */
export function leadDescribesArtwork(lead: string): boolean {
  const s = firstSentence(lead);
  return SUBJECT_IS_WORK.test(s) || PAINTED_A_WORK.test(s);
}

/** Lenient: the first sentence is about some work of art and not about a place, book or performance. */
export function leadMentionsArtwork(lead: string): boolean {
  const s = firstSentence(lead);
  if (NOT_ART_LEAD.test(s) && !SUBJECT_IS_PICTURE.test(s.replace(NOT_ART_LEAD, ""))) return false;
  return leadDescribesArtwork(s) || WAS_PAINTED.test(s) || ANY_WORK_NOUN.test(s);
}

export interface ArticleCheck {
  title: string;
  lead: string;
  /** Wikidata item of the article and its P31 classes (null when unknown). */
  qid: string | null;
  classes: string[] | null;
  artistTitle: string;
  artistQid: string | null;
}

/** Why an article is not an artwork, or null when it is one. */
export function notAnArtwork(c: ArticleCheck): string | null {
  if (c.title === c.artistTitle || (c.qid && c.qid === c.artistQid)) return "the artist's own biography";
  if (/^(List|Lists|Catalogue|Catalog) of\b/i.test(c.title)) return "list article";
  const classes = c.classes ?? [];
  if (classes.some((k) => ARTWORK_CLASSES.has(k))) return null;
  const deny = classes.find((k) => NON_ARTWORK_CLASSES.has(k));
  if (deny) return `Wikidata class ${deny}`;
  // A person: only an article whose lead presents a painting ("Portrait of
  // Johanna Staude is an unfinished painting …") passes.
  if (classes.includes(HUMAN)) return leadDescribesArtwork(c.lead) ? null : "biography of a person";
  if (leadMentionsArtwork(c.lead)) return null;
  return classes.length ? `Wikidata class ${classes.join(",")}, lead not about an artwork` : "lead not about an artwork";
}

// ---------- year ----------

const YEAR_RE = /\b(1[2-9]\d{2}|20[0-2]\d)\b(?!s)/g;
// years that date something other than the making of the work
const NOT_MAKING =
  /(acquired|purchased|bought|donated|bequeathed|sold|auction|stolen|theft|restored|restoration|rediscovered|discovered|cleaned|loaned|lent|transferred|since|until|reopened|opened|founded|born|died|death|exhibited at the|catalogued)\W+(?:\w+\W+){0,4}$/i;

/**
 * The first year in a lead that can date the work: inside the artist's life
 * (from age 8 to death; unknown birth = up to 70 years before death), not a
 * "(1571–1610)" life span, not an acquisition / sale / theft date.
 */
export function leadYear(lead: string, birth: number | null, death: number | null): number | null {
  if (!lead) return null;
  const lo = birth != null ? birth + 8 : death != null ? death - 70 : -Infinity;
  const hi = death ?? new Date().getFullYear();
  for (const m of lead.matchAll(YEAR_RE)) {
    const y = parseInt(m[1], 10);
    if (y < lo || y > hi) continue;
    const i = m.index ?? 0;
    // a life span "(1571–1610)" / "(born 1840)"
    const around = lead.slice(Math.max(0, i - 12), i + 12);
    if (/\(\s*(?:c\.\s*|born\s+|b\.\s*)?\d{4}\s*[–-]\s*\d{4}\s*\)/.test(around) && (y === birth || y === death)) continue;
    if (NOT_MAKING.test(lead.slice(Math.max(0, i - 60), i))) continue;
    return y;
  }
  return null;
}

export interface Inception {
  year: number;
  /** Wikidata time precision: 9 year, 8 decade, 7 century, 6 millennium. */
  precision: number;
  /** "earliest date" (P1319) / "latest date" (P1326) qualifiers, year precision only. */
  earliest?: number | null;
  latest?: number | null;
}

/** Span of years a low-precision Wikidata date covers. */
export function inceptionSpan(inc: Inception): [number, number] {
  if (inc.earliest != null || inc.latest != null) {
    const lo = inc.earliest ?? inc.latest!;
    const hi = inc.latest ?? inc.earliest!;
    return [Math.min(lo, hi), Math.max(lo, hi)];
  }
  if (inc.precision >= 9) return [inc.year, inc.year];
  if (inc.precision === 8) {
    const d = Math.floor(inc.year / 10) * 10;
    return [d, d + 9];
  }
  // century (7) / millennium (6): Wikidata stores centuries inconsistently
  // ("+1500" may mean the 15th or the 16th), so take both readings.
  const w = inc.precision === 7 ? 100 : 1000;
  return [inc.year - w, inc.year + w - 1];
}

/**
 * The year to show for a work. A year-precision Wikidata inception wins; a
 * decade / century one ("1800s") only bounds the date: the lead's year is used
 * when it falls inside that span, else an exact "earliest date" qualifier,
 * else the lead's year if the item has no date at all. Never a round number
 * standing for a whole decade or century.
 */
export function pickYear(
  inc: Inception | null,
  lead: string,
  birth: number | null,
  death: number | null
): number | null {
  const fromLead = leadYear(lead, birth, death);
  if (!inc) return fromLead;
  if (inc.precision >= 9) return inc.year;
  const [lo, hi] = inceptionSpan(inc);
  if (fromLead != null && fromLead >= lo && fromLead <= hi) return fromLead;
  if (inc.earliest != null) return inc.earliest;
  return null;
}

/** Best P571 statement of an item (preferred rank, else normal; most precise first). */
export function inceptionOf(claims: Record<string, any[]> | undefined): Inception | null {
  const all = (claims?.P571 ?? []).filter(
    (c) => c?.rank !== "deprecated" && c?.mainsnak?.snaktype === "value" && c.mainsnak.datavalue?.value?.time
  );
  const preferred = all.filter((c) => c.rank === "preferred");
  const pool = (preferred.length ? preferred : all).sort(
    (a, b) => (b.mainsnak.datavalue.value.precision ?? 11) - (a.mainsnak.datavalue.value.precision ?? 11)
  );
  const c = pool[0];
  if (!c) return null;
  const v = c.mainsnak.datavalue.value as { time: string; precision?: number };
  const y = (t?: { time?: string; precision?: number }) => {
    const m = t?.time && /^([+-]\d+)-/.exec(t.time);
    return m && (t!.precision ?? 11) >= 9 ? parseInt(m[1], 10) : null;
  };
  const m = /^([+-]\d+)-/.exec(v.time);
  if (!m) return null;
  return {
    year: parseInt(m[1], 10),
    precision: v.precision ?? 11,
    earliest: y(c.qualifiers?.P1319?.[0]?.datavalue?.value),
    latest: y(c.qualifiers?.P1326?.[0]?.datavalue?.value),
  };
}

// ---------- Commons-only works ----------

const EN_WORDS = new Set(
  "the a an of and in on by is was with to at his her its their from for as this that which painting depicts shows".split(" ")
);

/**
 * A Commons file description usable as the story of a work without a
 * Wikipedia article: English prose, no wiki-template residue, more than a
 * caption. Returns the cleaned text, or "" when it is not usable.
 */
export function usableCommonsDescription(text: string, title: string): string {
  const s = (text || "")
    .replace(/\b[a-z]{1,3}:(?=[A-Z])/g, "") // "w:Fernand Léger" interwiki prefixes
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length < 60) return "";
  if (/QS:|label QS|\{\{|\}\}|\.(jpe?g|png|tiff?)\b/i.test(s)) return "";
  if (/[Ѐ-ӿ؀-ۿͰ-Ͽ一-鿿]/.test(s)) return ""; // Cyrillic, Arabic, Greek, CJK
  const words = s.toLowerCase().match(/[a-zà-ÿ']+/g) ?? [];
  if (words.length < 8) return "";
  const en = words.filter((w) => EN_WORDS.has(w)).length / words.length;
  if (en < 0.15) return "";
  if (s.toLowerCase() === title.toLowerCase()) return "";
  return s;
}

// ---------- does the image show the work? ----------

const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const NAME_STOP = new Set(["the", "van", "von", "der", "del", "della", "elder", "younger", "de", "da", "di", "le", "la", "artist", "painter"]);

/** Distinctive words of an artist's name ("vincent", "gogh"). */
export function nameWords(name: string): string[] {
  return norm(name)
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !NAME_STOP.has(w));
}

const mentions = (text: string, words: string[]) => {
  const t = norm(text);
  return words.some((w) => new RegExp(`\\b${w}\\b`).test(t));
};

// A file name / object name that says the photo is of a place or of people,
// not of the work itself.
const SCENE_WORDS =
  /\b(regarding|with observer|visitors?|installation view|exhibition|exposition|expo|museum interior|gallery interior|fa[cç]ade|postcard|street view)\b/i;
const SCENE_CATEGORY = /^(Interior of |Interiors of |Photographs by |Images from Geograph|.* photographs taken on \d)/i;

export interface ImageCheck {
  artistName: string;
  artistWikiTitle: string;
  /** Names of every other artist in the museum. */
  otherArtists: string[];
  workTitle: string;
  story: string;
  copyrighted: boolean;
  meta: FileMeta;
  fileName: string;
}

/**
 * Why an image probably does not show the work (a painting by someone else, a
 * photo of a building / room / visitors), or null. Heuristic — the ingest
 * report lists every hit, and IMAGE_REVIEW below overrides it.
 */
export function imageMismatch(c: ImageCheck): string | null {
  const me = [...new Set([...nameWords(c.artistName), ...nameWords(c.artistWikiTitle)])];
  const m = c.meta;
  const fileText = [m.credit.author, m.categories.join(" ; "), m.objectName, c.fileName, m.description].join(" | ");
  const namesMe = mentions(fileText, me);
  const context = `${c.workTitle} ${c.story}`;
  if (!namesMe) {
    // the file is credited to / filed under another artist of the museum the article never mentions
    const byOther = c.otherArtists.find((o) => {
      const full = norm(o).replace(/\([^)]*\)/g, "").trim();
      if (full.split(/\s+/).length < 2) return false;
      const inFile = norm(m.credit.author).includes(full) || m.categories.some((cat) => /\bby\b/i.test(cat) && norm(cat).includes(full));
      return inFile && !mentions(context, nameWords(o));
    });
    if (byOther) return `image is a work by ${byOther}`;
  }
  const scene = `${c.fileName} ${m.objectName}`;
  if (!namesMe && SCENE_WORDS.test(scene) && !SCENE_WORDS.test(context)) return `photo of a scene, not the work ("${c.fileName}")`;
  if (c.copyrighted && !m.nonFree && !namesMe && m.categories.some((cat) => SCENE_CATEGORY.test(cat)))
    return `free photo that never names the artist ("${c.fileName}")`;
  if (c.copyrighted && !m.nonFree && !namesMe && !mentions(fileText, nameWords(c.workTitle).slice(0, 3)))
    return `free photo that names neither the artist nor the work ("${c.fileName}")`;
  return null;
}

/**
 * Images checked by eye (Oct 2026). "ok": the heuristic above is wrong, keep
 * it; "wrong": the image does not show the work; a file name: the work's own
 * Wikidata image (P18), used instead of the wrong one. Keys "artist/painting".
 */
export const IMAGE_REVIEW: Record<string, "ok" | "wrong" | { replace: string }> = {
  // another artist's painting
  "francis-bacon-artist/three-figures-in-a-room": "wrong", // Matisse, Bathers with a Turtle
  "piero-della-francesca/madonna-del-parto": { replace: "Madonna del parto piero della Francesca.jpg" }, // was Taddeo Gaddi's fresco
  "raja-ravi-varma/portrait-of-a-lady": "wrong", // an 18th-century Indian portrait (Walters W.913)
  // photos of buildings, rooms, maps, visitors
  "marc-chagall/the-sources-of-music-and-the-triumph-of-music": "wrong", // the opera house from outside
  "andy-warhol/shadows-paintings": "wrong", // gallery floor and wall
  "banksy/kissing-coppers": "wrong", // the pub, after the mural was removed
  "grandma-moses/checkered-house-grandma-moses": "wrong", // postcard of the real house
  "grandma-moses/great-fire-the-burning-of-troy-in-1862": "wrong", // 1881 map of Troy
  "jackson-pollock/number-1-1950-lavender-mist": "wrong", // visitor in front of it
  "jackson-pollock/one-number-31-1950": "wrong", // visitor in front of it
  "jasper-johns/white-flag-painting": "wrong", // visitor in front of it
  "francisco-goya/black-paintings": "wrong", // the Quinta del Sordo house (P18 is a floor plan)
  "peter-paul-rubens/marie-de-medici-cycle": "wrong", // the Louvre room (P18 too)
  "jusepe-de-ribera/prophets-and-patriarchs-ribera": { replace: "Moses041.jpg" }, // was the church interior
  "robert-delaunay/eiffel-tower-delaunay-series": {
    replace: "Robert Delaunay - Eiffel Tower - 1911 - Solomon R. Guggenheim Museum.jpg",
  }, // was a photo of the tower
  "henri-matisse/the-dance-ii": { replace: "Matisse - Carra, 467.jpg" }, // was a room with part of the mural
  // checked: the image is the work
  "marcel-duchamp/the-bride": "ok",
  "david-hockney/portrait-of-sir-david-webster": "ok",
  "banksy/from-this-moment-despair-ends-and-tactics-begin": "ok",
  "banksy/one-nation-under-cctv": "ok",
  "marc-chagall/white-crucifixion": "ok",
  "andy-warhol/campbell-s-soup-cans": "ok",
  "roy-lichtenstein/times-square-mural": "ok",
  "pablo-picasso/picasso-s-regjeringskvartalet-murals": "ok",
  "keith-haring/tuttomondo": "ok",
  "keith-haring/todos-juntos-podemos-parar-el-sida": "ok",
  "grandma-moses/july-fourth-grandma-moses": "ok", // the 1969 stamp reproducing the painting
  "lucas-cranach-the-elder/wittenberg-altarpiece": "ok",
  "william-hogarth/sealing-the-tomb": "ok",
  "antonio-del-pollaiuolo/hercules-and-the-hydra-pollaiuolo": "ok",
  "claude-joseph-vernet/a-seaport-at-sunset": "ok",
  "titian/the-martyrdom-of-saint-lawrence-titian": "ok",
  "claude-monet/the-rocks-at-pourville-low-tide": "ok",
  "cimabue/gualino-madonna": "ok", // once attributed to Duccio
  "titian/giustiniani-portrait": "ok", // Giorgione or Titian
  "edward-burne-jones/oxford-union-murals": "ok", // the joint mural scheme
  "canaletto/the-grand-canal-in-venice-bellotto": "ok",
};
