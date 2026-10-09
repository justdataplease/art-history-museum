import "server-only";
import fs from "node:fs";
import path from "node:path";

// The cinema's programme (archive/films.py -> data/site/films.json): for every painter whose Wikipedia articles
// hold films, those films, played from where they live. "file" and "hls" are open to other sites, so the cinema
// projects them (a video texture); "youtube", "vimeo" and "dailymotion" play in their own player on the screen.

export type FilmKind = "file" | "hls" | "youtube" | "vimeo" | "dailymotion";

export interface Film {
  id: string;
  kind: FilmKind;
  /** English when archive/films_titles.json has one (`original` then keeps the film's own). */
  title: string;
  original?: string;
  /** hls: the playlist; youtube, vimeo, dailymotion: the video id. */
  src?: string;
  /** file: its renditions, best first. */
  sources?: { src: string; type: string }[];
  channel?: string;
  summary?: string;
  year?: number;
  seconds?: number;
  /** Picture width / height (4:3 television, 16:9). */
  aspect?: number;
  lang?: string;
  poster?: string;
  /** The film's own page (its licence, its credits). */
  page: string;
  source: string;
  credit?: string;
  /** May play in Greece only (ERT's archive): /api/films/where. */
  geo?: boolean;
  /** The Wikipedia languages whose article links it. */
  from: string[];
}

export interface FilmPainter {
  slug: string;
  qid: string;
  name: string;
  years: string | null;
  /** The painter has a gallery here (/museum/<slug>). */
  gallery: boolean;
  films: Film[];
}

const FILE = path.join(process.cwd(), "data", "site", "films.json");
let cached: FilmPainter[] | null = null;

function load(): FilmPainter[] {
  // read once in production; in development every time (a rerun of archive/films.py shows at once)
  if (cached && process.env.NODE_ENV === "production") return cached;
  try {
    cached = (JSON.parse(fs.readFileSync(FILE, "utf8")) as { painters: FilmPainter[] }).painters;
  } catch {
    cached = [];
  }
  return cached;
}

export function getFilmPainters(): FilmPainter[] {
  return load();
}

export function getFilmPainter(slug: string): FilmPainter | null {
  return load().find((p) => p.slug === slug) ?? null;
}

/** How many films the cinema has about this painter (0: none). */
export function filmCount(slug: string): number {
  return getFilmPainter(slug)?.films.length ?? 0;
}
