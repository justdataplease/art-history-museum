// Custom rooms: works chosen by a selection (era, period, movement, school, genre, nationality, artists, the
// museum that holds them, years, title words, works picked by hand), hung like a museum room, shareable by URL.
// The selection, the room's design and its floor plan live entirely in the URL (src/lib/room-query.ts).
//
// The index is data/site/rooms.json (archive/site.py): every hung work with its era, period, movement, genre and
// the museums holding it, every artist's nationalities and terms. Works are ranked by Wikipedia pageviews with the
// Featured artists first, no artist taking more than a fair share, then hung by year. A selection spanning eras
// gets one floor per era (joined by an elevator), each with its era's room style; or the visitor's own floor
// plan: floors by years, each with its own style, wall colour, size and wall text (a museum's floors).

import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { ArtistWithPaintings, GuideArtist, Painting, RoomFloor, WorkAbout } from "./types";
import { getArtist } from "./data";
import { artistOrigin } from "./countries";
import { FEATURED_ARTIST_SLUGS } from "@/components/timeline/featured-artists";
import { paintingTextureUrl } from "./img";
import { hasFilters, parsePin, selectionQuery, workFloor, workKey, type FloorSpec, type Selection } from "./room-query";

export { parseSelection, selectionQuery, MAX_DEFAULT, type Selection, type FloorSpec } from "./room-query";

export interface RoomTerm {
  id: string;
  kind: string;
  name: string;
  parent: string | null;
  start: number | null;
  end: number | null;
  place: string | null;
  ancestors: string[];
  works: number;
}
interface IndexArtist {
  nationalities: string[];
  citizenship: string[];
  terms: string[];
}
interface IndexMuseum {
  id: string;
  name: string;
  works: number;
}
/** [artist, painting, era, period, movement, genre, year, pageviews, museums (positions in `museums`)] */
type IndexWork = [
  string, string, string | null, string | null, string | null, string | null, number | null, number, (number[] | null)?,
];
interface RoomIndex {
  terms: RoomTerm[];
  artists: Record<string, IndexArtist>;
  museums?: IndexMuseum[];
  works: IndexWork[];
}

let index: RoomIndex | null = null;
let termById: Map<string, RoomTerm> | null = null;
/** A museum's link id to its positions in `museums` (two places can share a name). */
let museumsById: Map<string, number[]> | null = null;
let workByKey: Map<string, IndexWork> | null = null;
function readIndex(): RoomIndex | null {
  if (index) return index;
  const file = path.join(process.cwd(), "data", "site", "rooms.json");
  if (!fs.existsSync(file)) return null;
  index = JSON.parse(fs.readFileSync(file, "utf8")) as RoomIndex;
  termById = new Map(index.terms.map((t) => [t.id, t]));
  museumsById = new Map();
  (index.museums ?? []).forEach((m, i) => museumsById!.set(m.id, [...(museumsById!.get(m.id) ?? []), i]));
  workByKey = new Map(index.works.map((w) => [`${w[0]}/${w[1]}`, w]));
  return index;
}

const TIME_KINDS = new Set(["era", "tradition", "period", "movement", "umbrella", "historical-period"]);
const SCHOOL_KINDS = new Set(["school", "group", "academy", "exhibition"]);
function groupOf(kind: string): "time" | "school" | "genre" {
  return TIME_KINDS.has(kind) ? "time" : SCHOOL_KINDS.has(kind) ? "school" : "genre";
}

interface Picked {
  work: IndexWork;
  score: number;
  /** Picked by hand: hangs whatever the caps say. */
  pinned: boolean;
}

interface Floor {
  eras: (string | null)[];
  works: IndexWork[];
  /** The visitor's own floor (a floor plan), and its place in the plan. */
  spec?: FloorSpec;
  index?: number;
}

const byYear = (x: IndexWork, y: IndexWork) => (x[6] ?? 9999) - (y[6] ?? 9999);

/** Is an artist of one of the nationalities (WikiArt's or Wikidata's; "Ital" matches "Italians")? */
function ofNation(a: IndexArtist | undefined, nations: string[]): boolean {
  // nationality first; citizenship only when none is known (Wikidata gives Holbein a French citizenship)
  const have = (a?.nationalities?.length ? a.nationalities : a?.citizenship ?? []).map((x) => x.toLowerCase());
  return nations.some((n) => {
    const l = n.toLowerCase();
    return have.some((h) => h === l || h.startsWith(l));
  });
}

/** Each artist's middle year: the median of their dated works (built on first use). */
let artistYears: Map<string, number> | null = null;
function artistYear(artist: string): number | null {
  if (!artistYears) {
    const by = new Map<string, number[]>();
    for (const x of readIndex()?.works ?? []) if (x[6] != null) (by.get(x[0]) ?? by.set(x[0], []).get(x[0])!).push(x[6]);
    artistYears = new Map([...by].map(([k, ys]) => [k, ys.sort((p, q) => p - q)[ys.length >> 1]]));
  }
  return artistYears.get(artist) ?? null;
}

/** The floor of a plan a work belongs on: the first whose years (and nationalities, when it names any) hold it.
 *  An undated work goes to the first such floor without years, else where its artist's middle year falls. */
function planFloor(plan: FloorSpec[], w: IndexWork, a: IndexArtist | undefined): number {
  const open = (f: FloorSpec) => f.from == null && f.to == null && (!f.who.length || ofNation(a, f.who));
  const y = w[6] ?? (plan.some(open) ? null : artistYear(w[0]));
  for (let i = 0; i < plan.length; i++) {
    const f = plan[i];
    if (f.who.length && !ofNation(a, f.who)) continue;
    if (y == null) {
      if (f.from == null && f.to == null) return i;
      continue;
    }
    if ((f.from == null || y >= f.from) && (f.to == null || y <= f.to)) return i;
  }
  return -1;
}

/** Take works best first: hand-picked ones always, others up to `max`, an artist at most `share` of them. */
function take(picked: Picked[], max: number, share: number): IndexWork[] {
  const perArtist = new Map<string, number>();
  const chosen: IndexWork[] = picked.filter((p) => p.pinned).map((p) => p.work);
  for (const p of picked) {
    if (chosen.length >= max) break;
    if (p.pinned) continue;
    const n = perArtist.get(p.work[0]) ?? 0;
    if (n >= share) continue;
    perArtist.set(p.work[0], n + 1);
    chosen.push(p.work);
  }
  return chosen;
}

/** The works a selection hangs (ranked, capped), and its floors. */
export function selectWorks(s: Selection): { works: IndexWork[]; floors: Floor[] } {
  const idx = readIndex();
  if (!idx || !termById || !workByKey) return { works: [], floors: [] };
  const terms = termById;
  const wanted = { time: [] as string[], school: [] as string[], genre: [] as string[] };
  for (const id of s.terms) {
    const t = terms.get(id);
    if (t) wanted[groupOf(t.kind)].push(id);
  }
  const under = (termId: string | null, want: string[]) =>
    !!termId && (terms.get(termId)?.ancestors ?? [termId]).some((a) => want.includes(a));
  const artists = new Set(s.artists);
  const nats = s.nationalities.map((n) => n.toLowerCase());
  const museums = new Set(s.museums.flatMap((m) => museumsById?.get(m) ?? []));
  const excluded = new Set(s.exclude);
  const pinned = new Set(s.include.map(workKey).filter((k) => !excluded.has(k)));
  // a kept work may name its floor of the plan ("...@2")
  const pinnedFloor = new Map(s.include.flatMap((k) => (workFloor(k) ? [[workKey(k), workFloor(k)! - 1] as const] : [])));
  const plan = s.floors === "plan" ? s.plan : [];
  const fits = (w: IndexWork) => !plan.length || planFloor(plan, w, idx.artists[w[0]]) >= 0;
  const score = (w: IndexWork) => Math.log10(w[7] + 10) + (FEATURED_ARTIST_SLUGS.has(w[0]) ? 1.5 : 0);

  const picked: Picked[] = [];
  for (const key of pinned) {
    const w = workByKey.get(key);
    if (w && (fits(w) || (plan.length && (pinnedFloor.get(key) ?? -1) in plan)))
      picked.push({ work: w, score: Infinity, pinned: true });
  }
  // with only works picked by hand, the room hangs exactly those (unless the highlights hang around them)
  if (hasFilters(s) || !pinned.size || s.highlights) {
    for (const w of idx.works) {
      const [artist, , era, period, movement, genre, y] = w;
      if (pinned.has(`${artist}/${w[1]}`)) continue;
      if (artists.size && !artists.has(artist)) continue;
      if (excluded.size && excluded.has(`${artist}/${w[1]}`)) continue;
      if (museums.size && !(w[8] ?? []).some((m) => museums.has(m))) continue;
      const a = idx.artists[artist];
      if (nats.length && !ofNation(a, nats)) continue;
      if (wanted.time.length && !(under(era, wanted.time) || under(period, wanted.time) || under(movement, wanted.time)))
        continue;
      if (wanted.genre.length && !under(genre, wanted.genre)) continue;
      if (wanted.school.length && !(a?.terms ?? []).some((t) => under(t, wanted.school))) continue;
      if (s.from != null && (y == null || y < s.from)) continue;
      if (s.to != null && (y == null || y > s.to)) continue;
      if (s.words.length) {
        // the painting's slug is its title, lower-case: a word matches at the start of a word ("night" finds
        // "Nighthawks", not "knight")
        const title = ` ${w[1].replace(/-/g, " ")}`;
        if (!s.words.every((word) => title.includes(` ${word}`))) continue;
      }
      if (!fits(w)) continue;
      picked.push({ work: w, score: score(w), pinned: false });
    }
  }
  picked.sort((x, y) => y.score - x.score);
  // a fair share per artist, unless the visitor chose only one or two artists
  const nArtists = new Set(picked.map((p) => p.work[0])).size;
  const shareOf = (max: number) =>
    artists.size && artists.size <= 2 ? Infinity : Math.max(3, Math.ceil((max * 2) / Math.max(1, nArtists)));

  // the visitor's own floors: each takes its own works (its size, or an even share of max)
  if (plan.length) {
    const floors: Floor[] = plan.map((spec, index) => ({ eras: [], works: [], spec, index }));
    const pools = plan.map(() => [] as Picked[]);
    for (const p of picked) {
      const asked = p.pinned ? pinnedFloor.get(`${p.work[0]}/${p.work[1]}`) : undefined;
      pools[asked != null && asked < plan.length ? asked : planFloor(plan, p.work, idx.artists[p.work[0]])]?.push(p);
    }
    const even = Math.max(4, Math.round(s.max / plan.length));
    pools.forEach((pool, i) => {
      const max = plan[i].works ?? even;
      floors[i].works = take(pool, max, shareOf(max)).sort(byYear);
      floors[i].eras = [...new Set(floors[i].works.map((w) => w[2]))];
    });
    const kept = floors.filter((f) => f.works.length);
    return { works: kept.flatMap((f) => f.works), floors: kept };
  }

  const chosen = take(picked, Math.max(s.max, pinned.size), shareOf(s.max)).sort(byYear);

  // floors: one per era when the room spans eras. An era with too few works for a room of its own shares the
  // floor of the era before it (or after it, for the first): "Medieval & Renaissance".
  const byEra = new Map<string | null, IndexWork[]>();
  for (const w of chosen) byEra.set(w[2], [...(byEra.get(w[2]) ?? []), w]);
  // in the order of their works' median year (a tradition such as East Asian painting spans many centuries)
  const median = (ws: IndexWork[]) => {
    const ys = ws.map((w) => w[6]).filter((y): y is number => y != null).sort((x, y) => x - y);
    return ys.length ? ys[ys.length >> 1] : 9999;
  };
  const floors: Floor[] = [];
  for (const [era, works] of [...byEra.entries()].sort((x, y) => median(x[1]) - median(y[1]))) {
    const last = floors[floors.length - 1];
    if (last && (works.length < MIN_FLOOR || last.works.length < MIN_FLOOR)) {
      last.eras.push(era);
      last.works.push(...works);
    } else floors.push({ eras: [era], works: [...works] });
  }
  if (floors.length > 1 && floors[0].works.length < MIN_FLOOR) {
    const [first, second] = floors.splice(0, 2);
    floors.unshift({ eras: [...first.eras, ...second.eras], works: [...first.works, ...second.works] });
  }
  if (s.floors === "one" || floors.length < 2 || chosen.length < 20)
    return { works: chosen, floors: [{ eras: [...byEra.keys()], works: chosen }] };
  for (const f of floors) f.works.sort(byYear);
  return { works: chosen, floors };
}

const MIN_FLOOR = 8;

/** A floor's name: the visitor's own, or one or two eras by name ("Baroque", "Nineteenth century & Modern"),
 *  more by their years. */
function floorName(f: Floor): string {
  if (f.spec?.label) return f.spec.label;
  const names = f.eras.map((e) => (e ? termById?.get(e)?.name : null)).filter(Boolean) as string[];
  if (names.length && names.length <= 2) return names.join(" & ");
  const ys = f.works.map((w) => w[6]).filter((y): y is number => y != null);
  return ys.length ? `${Math.min(...ys)}–${Math.max(...ys)}` : names.join(", ");
}

/** The floors as the elevator and the picker name them ("Floor 0 · Middle Ages"). */
function floorLabels(s: Selection, floors: Floor[], single: string): string[] {
  return floors.map((f, i) => {
    if (floors.length < 2) return f.spec?.label || single;
    const name = floorName(f);
    // a floor the visitor named "Floor 2" or "Level 0" keeps its own name
    const no = f.spec?.number ?? s.firstFloor + (f.index ?? i);
    return /^(floor|level|storey)\s*-?\d/i.test(name) ? name : `Floor ${no < 0 ? `−${-no}` : no} · ${name}`;
  });
}

/** The selection in words: its terms, museums, artists, nationalities and years. */
export function describeSelection(s: Selection, artistName: (slug: string) => string | undefined): string {
  const idx = readIndex();
  const museumName = (id: string) => idx?.museums?.[museumsById?.get(id)?.[0] ?? -1]?.name;
  const parts = [
    ...s.museums.map(museumName).filter(Boolean),
    ...s.terms.map((id) => termById?.get(id)?.name).filter(Boolean),
    ...s.nationalities,
    ...s.artists.map(artistName).filter(Boolean),
  ] as string[];
  if (s.from != null || s.to != null) parts.push(`${s.from ?? "…"}–${s.to ?? "…"}`);
  if (s.words.length) parts.push(`“${s.words.join(" ")}”`);
  if (!parts.length && s.include.length && !s.highlights) parts.push("Chosen works");
  return parts.join(" · ") || "Highlights of the collection";
}

const dominant = <T,>(xs: T[]): T | undefined => {
  const n = new Map<T, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** A floor's works in the visitor's order: by year (the default), by artist (artists by their first work, each
 *  artist's works by year), or best known first. */
function orderWorks(works: IndexWork[], order: Selection["order"]): IndexWork[] {
  if (order === "fame") return [...works].sort((x, y) => y[7] - x[7]);
  if (order === "artist") {
    const first = new Map<string, number>();
    for (const w of [...works].sort(byYear)) if (!first.has(w[0])) first.set(w[0], first.size);
    return [...works].sort((x, y) => first.get(x[0])! - first.get(y[0])! || byYear(x, y));
  }
  return [...works].sort(byYear);
}

/** A floor's works as they hang: in the room's order, with the works the visitor placed by hand at their places. */
function hangOrder(works: IndexWork[], s: Selection): IndexWork[] {
  const place = new Map(s.include.map(parsePin).flatMap((p) => (p.place ? [[p.key, p.place] as const] : [])));
  if (!place.size) return orderWorks(works, s.order);
  const at = (w: IndexWork) => place.get(`${w[0]}/${w[1]}`);
  const hung = orderWorks(works.filter((w) => !at(w)), s.order);
  for (const w of works.filter(at).sort((x, y) => at(x)! - at(y)!)) hung.splice(Math.min(at(w)! - 1, hung.length), 0, w);
  return hung;
}

/** Does a floor hang in an order of the visitor's own (not by year, so the 3D room keeps it)? */
const ownOrder = (works: IndexWork[], s: Selection) =>
  s.order !== "year" || s.include.some((k) => {
    const p = parsePin(k);
    return p.place != null && works.some((w) => `${w[0]}/${w[1]}` === p.key);
  });

/** The custom room (one floor of it) as a gallery: works by several artists, each carrying its artist. */
export async function buildRoom(s: Selection): Promise<ArtistWithPaintings | null> {
  const { floors } = selectWorks(s);
  if (!floors.length || !floors[0].works.length) return null;
  const floorNo = Math.min(s.floor, floors.length);
  const floor = floors[floorNo - 1];
  const slugs = [...new Set(floor.works.map((w) => w[0]))];
  const loaded = new Map((await Promise.all(slugs.map((a) => getArtist(a)))).filter(Boolean).map((a) => [a!.slug, a!]));
  const paintings: Painting[] = [];
  for (const [artistSlug, paintingSlug] of hangOrder(floor.works, s)) {
    const a = loaded.get(artistSlug);
    const p = a?.paintings.find((x) => x.slug === paintingSlug);
    // slugs are unique per artist only: two artists' "self-portrait" must not collide in one room
    if (a && p && p.imageUrl) paintings.push({ ...p, slug: `${artistSlug}--${p.slug}`, artistSlug, artistName: a.name });
  }
  if (!paintings.length) return null;
  const guide: GuideArtist[] = [...loaded.values()].map((a) => ({
    slug: a.slug, name: a.name, birthYear: a.birthYear, deathYear: a.deathYear, tagline: a.tagline, bio: a.bio,
  }));
  const periodSlug = (dominant(floor.works.map((w) => w[3]).filter(Boolean) as string[]) ?? "period:contemporary")
    .replace(/^period:/, "");
  const period = loaded.get(dominant(floor.works.map((w) => w[0]))!);
  const subtitle = describeSelection(s, (slug) => loaded.get(slug)?.name);
  const title = s.title ?? subtitle;
  const labels = floorLabels(s, floors, title);
  const roomFloors: RoomFloor[] = floors.map((f, i) => ({
    label: labels[i],
    href: `/room?${selectionQuery(s, i + 1)}`,
    works: f.works.length,
    number: f.spec?.number ?? s.firstFloor + (f.index ?? i),
  }));
  const years = paintings.map((p) => p.year).filter((y): y is number => y != null);
  const spec = floor.spec;
  return {
    slug: `room-${floorNo}`,
    periodSlug,
    name: title,
    birthYear: years.length ? Math.min(...years) : null,
    deathYear: years.length ? Math.max(...years) : null,
    tagline: subtitle,
    bio: "",
    portraitUrl: null,
    portraitWidth: null,
    portraitHeight: null,
    wikipediaUrl: null,
    paintingCount: paintings.length,
    periodName: floors.length > 1 ? roomFloors[floorNo - 1].label : `${slugs.length} artists`,
    periodColor: period?.periodColor ?? "#888",
    paintings,
    room: {
      subtitle, href: roomFloors[floorNo - 1].href, floors: roomFloors, floor: floorNo, artists: guide,
      // a floor of the visitor's plan may have its own style, wall, floor and wall text
      style: spec?.style ?? s.style,
      wall: spec?.wall ?? s.wall,
      ground: spec?.ground ?? s.ground,
      keepOrder: ownOrder(floor.works, s),
      intro: spec?.intro ?? s.intro,
    },
  };
}

/** What the room picker offers: the terms in use (with work counts), the nationalities and the museums. */
export function roomOptions(): {
  terms: RoomTerm[];
  nationalities: { name: string; works: number }[];
  museums: IndexMuseum[];
} {
  const idx = readIndex();
  if (!idx) return { terms: [], nationalities: [], museums: [] };
  const n = new Map<string, number>();
  const worksBy = new Map<string, number>();
  for (const w of idx.works) worksBy.set(w[0], (worksBy.get(w[0]) ?? 0) + 1);
  for (const [slug, a] of Object.entries(idx.artists))
    for (const nat of a.nationalities) n.set(nat, (n.get(nat) ?? 0) + (worksBy.get(slug) ?? 0));
  const museums = new Map<string, IndexMuseum>();
  for (const m of idx.museums ?? []) {
    const had = museums.get(m.id);
    museums.set(m.id, had ? { ...had, works: had.works + m.works } : m);
  }
  return {
    terms: idx.terms.filter((t) => t.works > 0 || SCHOOL_KINDS.has(t.kind)),
    nationalities: [...n.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])
      .map(([name, works]) => ({ name, works })),
    museums: [...museums.values()].filter((m) => m.works >= 5).sort((a, b) => b.works - a.works),
  };
}

/** How many works and artists a selection hangs, and on how many floors (the picker's live count). */
export function roomCount(s: Selection): { works: number; artists: number; floors: number } {
  const { works, floors } = selectWorks(s);
  return { works: works.length, artists: new Set(works.map((w) => w[0])).size, floors: floors.length };
}

export interface PreviewWork {
  /** artist/painting: what `x` leaves out and `w` picks */
  key: string;
  title: string;
  year: number | null;
  artist: string;
  thumb: string | null;
}

async function previewWorks(works: IndexWork[]): Promise<PreviewWork[]> {
  const slugs = [...new Set(works.map((w) => w[0]))];
  const loaded = new Map((await Promise.all(slugs.map((a) => getArtist(a)))).filter(Boolean).map((a) => [a!.slug, a!]));
  return works.flatMap(([a, slug, , , , , year]) => {
    const artist = loaded.get(a);
    const p = artist?.paintings.find((x) => x.slug === slug);
    return p ? [{ key: `${a}/${slug}`, title: p.title, year: year ?? p.year, artist: artist!.name,
                  thumb: paintingTextureUrl(p, 120) }] : [];
  });
}

export interface PreviewFloor {
  label: string;
  works: PreviewWork[];
  /** The floor's place in the visitor's plan (0-based), so works can be moved to it; null for an era's floor. */
  plan: number | null;
}

/** What each floor of a selection hangs, as it hangs, with small images: the picker's preview, where works are
 *  left out, kept and moved. Every floor of a plan is there, an empty one too (works can be moved to it). */
export async function roomPreview(s: Selection): Promise<PreviewFloor[]> {
  const { floors: kept } = selectWorks(s);
  const floors = s.floors === "plan" && s.plan.length
    ? s.plan.map((spec, index) => kept.find((f) => f.index === index) ?? { eras: [], works: [], spec, index })
    : kept;
  const labels = floorLabels(s, floors, "The room");
  return Promise.all(floors.map(async (f, i) => ({
    label: labels[i], works: await previewWorks(hangOrder(f.works, s)), plan: f.index ?? null,
  })));
}

/** Works whose title and artist hold every word (at word starts: "vermeer pearl", "starry night"), optionally
 *  by one artist, best known first: the picker's search for works to add. */
export async function searchWorks(q: string, artist?: string | null, limit = 12): Promise<PreviewWork[]> {
  const idx = readIndex();
  const words = q.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  if (!idx || (!words.length && !artist)) return [];
  const hits: IndexWork[] = [];
  for (const w of idx.works) {
    if (artist && w[0] !== artist) continue;
    const title = ` ${w[1].replace(/-/g, " ")} ${w[0].replace(/-/g, " ")}`;
    if (words.every((word) => title.includes(` ${word}`))) hits.push(w);
  }
  hits.sort((x, y) => y[7] - x[7]);
  return previewWorks(hits.slice(0, limit));
}

/** Every dated work by year, best known first (built on first use). */
let worksOfYear: Map<number, IndexWork[]> | null = null;

/** What the inspect panel adds about a work: its tags, the museums that hold it, and the best known works other
 *  artists painted the same year. */
export async function workAbout(artist: string, slug: string): Promise<WorkAbout | null> {
  const ix = readIndex();
  const w = ix && workByKey!.get(`${artist}/${slug}`);
  if (!ix || !w) return null;
  const term = (id: string | null) => (id ? (termById!.get(id)?.name ?? null) : null);
  const museums = [...new Set((w[8] ?? []).map((i) => ix.museums?.[i]?.name).filter((n): n is string => !!n))];
  const year = w[6];
  let sameYear: WorkAbout["sameYear"] = [];
  if (year != null) {
    if (!worksOfYear) {
      worksOfYear = new Map();
      for (const x of ix.works) if (x[6] != null) (worksOfYear.get(x[6]) ?? worksOfYear.set(x[6], []).get(x[6])!).push(x);
      for (const list of worksOfYear.values()) list.sort((a, b) => b[7] - a[7]);
    }
    // one work each from up to three other artists
    const seen = new Set([artist]);
    const picks: IndexWork[] = [];
    for (const x of worksOfYear.get(year) ?? []) {
      if (seen.has(x[0])) continue;
      seen.add(x[0]);
      picks.push(x);
      if (picks.length === 3) break;
    }
    const found = await Promise.all(
      picks.map(async (x) => {
        const a = await getArtist(x[0]);
        const p = a?.paintings.find((q) => q.slug === x[1]);
        return a && p ? { artistSlug: a.slug, artistName: a.name, slug: p.slug, title: p.title } : null;
      })
    );
    sameYear = found.filter((x): x is NonNullable<typeof x> => !!x);
  }
  // the tags: the work's own era, period, movement and genre; the artist's schools and groups (and movements, when
  // the work has none of its own); the artist's country
  const ia = ix.artists[artist];
  const tags: WorkAbout["tags"] = [];
  const add = (kind: string, name: string | null | undefined) => {
    if (name && !tags.some((t) => t.name === name)) tags.push({ kind, name });
  };
  for (const id of [w[2], w[3], w[4]]) {
    const t = id ? termById!.get(id) : null;
    if (t) add(t.kind === "historical-period" ? "period" : t.kind, t.name);
  }
  const own = (ia?.terms ?? []).map((id) => termById!.get(id)).filter((t): t is RoomTerm => !!t);
  if (!w[4]) for (const t of own.filter((t) => t.kind === "movement").slice(0, 2)) add("movement", t.name);
  for (const t of own.filter((t) => SCHOOL_KINDS.has(t.kind)).slice(0, 3)) add(t.kind, t.name);
  add("genre", term(w[5]));
  const a = await getArtist(artist);
  add("country", artistOrigin(artist, ia, a?.tagline).country);
  return { tags, museums, sameYear };
}
