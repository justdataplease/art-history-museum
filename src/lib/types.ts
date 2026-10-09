import type { Continent } from "./countries";

/** Credit line of an image, from its file description page on Wikimedia
 *  Commons or English Wikipedia. CC BY / CC BY-SA require it wherever the
 *  image is shown. */
export interface ImageCredit {
  /** Plain-text author / artist field of the file (null when the page has none). */
  author: string | null;
  /** Licence short name, e.g. "CC BY-SA 4.0", "Public domain", "Fair use". */
  license: string;
  licenseUrl: string | null;
  /** The file's description page (commons.wikimedia.org or en.wikipedia.org). */
  page: string;
}

export interface Period {
  slug: string;
  name: string;
  startYear: number;
  endYear: number;
  color: string;
  description: string;
  wikipediaUrl: string | null;
}

export interface Artist {
  slug: string;
  periodSlug: string;
  name: string;
  birthYear: number | null;
  deathYear: number | null;
  tagline: string;
  bio: string;
  portraitUrl: string | null;
  portraitWidth: number | null;
  portraitHeight: number | null;
  /** Credit line of the portrait; null/absent when unknown or no portrait. */
  portraitCredit?: ImageCredit | null;
  wikipediaUrl: string | null;
  paintingCount: number;
  /** Where the artist is from, as today's country ("Netherlands") and its continent, for the Explore
   *  panel's filters (src/lib/countries.ts). Absent when unknown. */
  country?: string | null;
  continent?: Continent | null;
}

export interface Painting {
  slug: string;
  title: string;
  year: number | null;
  /** The image Wikipedia shows for the work (Wikimedia Commons, or a file on
   *  English Wikipedia). Null when the article has no image, or when the
   *  rights holder asked us to withhold it (src/lib/takedowns.ts) — the
   *  gallery then hangs a © placard canvas. */
  imageUrl: string | null;
  /** Still in copyright: Wikipedia shows its image under fair use. The
   *  gallery labels it "© In copyright" on the wall label and in inspect. */
  copyrighted?: boolean;
  /** Pixel size of the image Wikipedia shows. */
  imageWidth: number | null;
  imageHeight: number | null;
  /** Credit line of the image; null/absent when unknown or imageUrl is null. */
  imageCredit?: ImageCredit | null;
  /** Byte size of the original file behind imageUrl (Wikimedia imageinfo); null when unknown. */
  imageBytes?: number | null;
  /** Physical size from Wikidata (P2049 width / P2048 height), in cm; null when unknown. */
  widthCm?: number | null;
  heightCm?: number | null;
  /** English Wikipedia pageviews of the painting article over the last 12 months (flagship ranking). */
  pageviews?: number | null;
  story: string;
  facts: string[];
  wikipediaUrl: string | null;
  /** Set in a custom room, where works by several artists hang together (src/lib/rooms.ts). */
  artistSlug?: string;
  artistName?: string;
  /** The phase of the artist's life it belongs to (an index into ArtistWithPaintings.phases). */
  phase?: number;
}

/** A phase of an artist's life ("Blue Period", 1901–1904): an artist's gallery splits its rooms at them. */
export interface ArtistPhase {
  name: string;
  from: number;
  to: number;
}

/** What the audio guide says about an artist the first time the visitor meets their work. */
export interface GuideArtist {
  slug: string;
  name: string;
  birthYear: number | null;
  deathYear: number | null;
  tagline: string;
  bio: string;
}

/** More about a work for the inspect panel (src/lib/rooms.ts workAbout, /api/work/<artist>/<work>). */
export interface WorkAbout {
  /** Where it sits in our taxonomy, broadest first: era (or tradition), period, movement, the artist's schools and
   *  groups, genre, the artist's country. */
  tags: { kind: string; name: string }[];
  /** The museums that hold it. */
  museums: string[];
  /** The best known works other artists painted the same year. */
  sameYear: { artistSlug: string; artistName: string; slug: string; title: string }[];
}

/** The artist before or after in the timeline's order: an artist's gallery ends at doors to both. */
export interface GalleryLink {
  slug: string;
  name: string;
  birthYear: number | null;
  deathYear: number | null;
  periodName: string;
}

/** One floor of a custom room (rooms spanning eras get one floor per era, joined by an elevator). */
export interface RoomFloor {
  label: string;
  href: string;
  works: number;
  /** The number the elevator shows (a museum may count from 0, the ground floor). */
  number: number;
}

/** A custom room: works chosen by a selection (era, movement, genre, artists ...), shareable by its URL. */
export interface RoomInfo {
  /** The selection in words, e.g. "Baroque · Portrait". */
  subtitle: string;
  /** The URL of this floor (the share link). */
  href: string;
  floors: RoomFloor[];
  floor: number;
  /** Every artist hung on this floor, for the audio guide. */
  artists: GuideArtist[];
  /** The visitor's design: a room style (theme.ts ROOM_STYLES key; null: each floor its era's), a wall colour
   *  (#rrggbb), the hanging order, and an introduction shown at the doors. */
  style: string | null;
  wall: string | null;
  /** A floor (marble, oak ...) instead of the style's own (theme.ts GROUNDS). */
  ground: string | null;
  order: "year" | "artist" | "fame";
  intro: string | null;
}

export interface TimelineData {
  periods: Period[];
  artists: Artist[];
}

export interface ArtistWithPaintings extends Artist {
  periodName: string;
  periodColor: string;
  paintings: Painting[];
  /** Present when this "artist" is a custom room (works by several artists). */
  room?: RoomInfo;
  /** The phases of the artist's life, when known (src/lib/phases.ts): the gallery's rooms follow them. */
  phases?: ArtistPhase[];
}
