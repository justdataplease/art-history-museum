// A custom room as a link: the selection, its design and its floor plan, read from and written to the URL. Shared
// by the server (src/lib/rooms.ts) and the room picker (src/app/rooms/RoomPicker.tsx), so both write the same
// links.
//
//   /room?t=era:baroque,genre:portrait&n=Dutch&from=1600&to=1700&max=48&title=Dutch+faces&f=2
//
//   t      taxonomy terms (data/taxonomy): OR within a group, AND across groups (time: era / tradition / period /
//          movement ...; school: school / group / academy / exhibition; genre). A term also matches everything
//          under it (era:baroque matches period:dutch-golden-age and movement:tenebrism).
//   a      artist slugs (OR)          n     nationalities (OR; WikiArt's or Wikidata's)
//   m      museums holding the work (OR; rooms.json `museums`, e.g. national-gallery-of-greece)
//   from   to    the work's year      q     words that must all be in the title
//   w      works hung whatever else is chosen (artist/painting, comma-separated; "artist/painting@2" hangs it on the
//          floor plan's second floor): with nothing else chosen, the room hangs exactly these
//   max    works (12 to 240; 60)      title the room's name      f    floor (1-based)
// and the room's design:
//   style  a room style (theme.ts ROOM_STYLES: old-master, postwar ...; default: each floor its era's)
//   wall   a wall colour (rrggbb)      order  year (default) | artist | fame
//   floors era (default: a floor per era) | one        intro  a wall text shown at the doors (up to 400)
//   x      works left out (artist/painting, comma-separated)
//   fl     a floor plan of one's own, floors separated by "|", each "label~from~to~style~wall~works~intro~who"
//          (empty fields allowed, trailing ones dropped; who: nationalities, comma-separated): a work hangs on the
//          first floor whose years (and, when given, whose artists' nationalities) hold it
//   fs     the number of the first floor (0 for a museum that counts from the ground floor; default 1)

import { isRoomStyle } from "@/components/museum/theme";

export interface FloorSpec {
  label: string;
  from: number | null;
  to: number | null;
  style: string | null;
  wall: string | null;
  /** Works on this floor (default: an even share of max). */
  works: number | null;
  /** A wall text at this floor's doors (the section's introduction). */
  intro: string | null;
  /** Only artists of these nationalities (a museum's schools: Italian painting on one floor, French on another). */
  who: string[];
}

export interface Selection {
  terms: string[];
  artists: string[];
  nationalities: string[];
  museums: string[];
  from: number | null;
  to: number | null;
  words: string[];
  include: string[];
  max: number;
  title: string | null;
  floor: number;
  style: string | null;
  wall: string | null;
  order: "year" | "artist" | "fame";
  floors: "era" | "one" | "plan";
  plan: FloorSpec[];
  firstFloor: number;
  intro: string | null;
  exclude: string[];
}

export const MAX_DEFAULT = 60;
export const MAX_WORKS = 240;

export const EMPTY_SELECTION: Selection = {
  terms: [], artists: [], nationalities: [], museums: [], from: null, to: null, words: [], include: [],
  max: MAX_DEFAULT, title: null, floor: 1, style: null, wall: null, order: "year", floors: "era", plan: [],
  firstFloor: 1, intro: null, exclude: [],
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const list = (v: string | string[] | undefined, n = 40) =>
  one(v).split(",").map((s) => s.trim()).filter(Boolean).slice(0, n);
const yearOf = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && Math.abs(n) < 5000 ? n : null;
};
const hex = (v: string) => (/^#?[0-9a-f]{6}$/i.test(v) ? `#${v.replace("#", "").toLowerCase()}` : null);
const WORK_KEY = /^[a-z0-9-]+\/[^,@]+(@\d)?$/;

/** A kept work's key without its floor ("rembrandt/the-night-watch@3" -> "rembrandt/the-night-watch"). */
export const workKey = (k: string) => k.replace(/@\d$/, "");
/** The plan floor (1-based) a kept work asks for, if any. */
export const workFloor = (k: string) => (/@(\d)$/.exec(k) ? Number(/@(\d)$/.exec(k)![1]) : null);
/** Characters a floor's label or text cannot hold (they separate the fields and the floors). */
const clean = (v: string, n: number) => v.replace(/[~|]/g, " ").trim().slice(0, n);

function parsePlan(v: string): FloorSpec[] {
  if (!v.trim()) return [];
  return v.split("|").slice(0, 8).map((f) => {
    const [label = "", from = "", to = "", style = "", wall = "", works = "", intro = "", who = ""] = f.split("~");
    const n = parseInt(works, 10);
    return {
      label: clean(label, 60),
      from: yearOf(from),
      to: yearOf(to),
      style: isRoomStyle(style) ? style : null,
      wall: hex(wall),
      works: Number.isFinite(n) ? Math.min(120, Math.max(4, n)) : null,
      intro: clean(intro, 300) || null,
      who: who.split(",").map((x) => clean(x, 40)).filter(Boolean).slice(0, 8),
    };
  });
}

function planQuery(plan: FloorSpec[]): string {
  return plan
    .map((f) =>
      [clean(f.label, 60), f.from ?? "", f.to ?? "", f.style ?? "", f.wall?.replace("#", "") ?? "", f.works ?? "",
        clean(f.intro ?? "", 300), f.who.map((x) => clean(x, 40)).join(",")]
        .join("~")
        .replace(/~+$/, "")
    )
    .join("|");
}

export function parseSelection(p: Params): Selection {
  const max = parseInt(one(p.max), 10);
  const floor = parseInt(one(p.f), 10);
  const fs = parseInt(one(p.fs), 10);
  const plan = parsePlan(one(p.fl));
  return {
    terms: list(p.t),
    artists: list(p.a),
    nationalities: list(p.n),
    museums: list(p.m, 12).filter((m) => /^[a-z0-9-]+$/.test(m)),
    from: yearOf(one(p.from)),
    to: yearOf(one(p.to)),
    words: one(p.q).toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 8),
    include: list(p.w, MAX_WORKS).filter((x) => WORK_KEY.test(x)),
    max: Number.isFinite(max) ? Math.min(MAX_WORKS, Math.max(12, max)) : MAX_DEFAULT,
    title: one(p.title).trim().slice(0, 80) || null,
    floor: Number.isFinite(floor) && floor > 0 ? floor : 1,
    style: isRoomStyle(one(p.style)) ? one(p.style) : null,
    wall: hex(one(p.wall)),
    order: one(p.order) === "artist" || one(p.order) === "fame" ? (one(p.order) as "artist" | "fame") : "year",
    floors: plan.length ? "plan" : one(p.floors) === "one" ? "one" : "era",
    plan,
    firstFloor: Number.isFinite(fs) ? Math.min(9, Math.max(-2, fs)) : 1,
    intro: one(p.intro).trim().slice(0, 400) || null,
    exclude: list(p.x, 150).filter((x) => WORK_KEY.test(x)),
  };
}

/** The selection as a query string (the share link), without the floor unless asked. */
export function selectionQuery(s: Selection, floor?: number): string {
  const q = new URLSearchParams();
  if (s.title) q.set("title", s.title);
  if (s.terms.length) q.set("t", s.terms.join(","));
  if (s.artists.length) q.set("a", s.artists.join(","));
  if (s.nationalities.length) q.set("n", s.nationalities.join(","));
  if (s.museums.length) q.set("m", s.museums.join(","));
  if (s.from != null) q.set("from", String(s.from));
  if (s.to != null) q.set("to", String(s.to));
  if (s.words.length) q.set("q", s.words.join(" "));
  if (s.include.length) q.set("w", s.include.join(","));
  if (s.max !== MAX_DEFAULT) q.set("max", String(s.max));
  if (s.style) q.set("style", s.style);
  if (s.wall) q.set("wall", s.wall.replace("#", ""));
  if (s.order !== "year") q.set("order", s.order);
  if (s.floors === "plan" && s.plan.length) q.set("fl", planQuery(s.plan));
  else if (s.floors === "one") q.set("floors", "one");
  if (s.firstFloor !== 1) q.set("fs", String(s.firstFloor));
  if (s.intro) q.set("intro", s.intro);
  if (s.exclude.length) q.set("x", s.exclude.join(","));
  if (floor && floor > 1) q.set("f", String(floor));
  return q.toString().replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%2F/g, "/").replace(/%7C/g, "|").replace(/%7E/g, "~").replace(/%40/g, "@");
}

/** Does the selection choose anything besides hand-picked works? (With nothing else, only those hang.) */
export function hasFilters(s: Selection): boolean {
  return !!(s.terms.length || s.artists.length || s.nationalities.length || s.museums.length || s.from != null ||
    s.to != null || s.words.length);
}
