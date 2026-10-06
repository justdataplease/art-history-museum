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
  wikipediaUrl: string | null;
  paintingCount: number;
}

export interface Painting {
  slug: string;
  title: string;
  year: number | null;
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
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
}

export interface TimelineData {
  periods: Period[];
  artists: Artist[];
}

export interface ArtistWithPaintings extends Artist {
  periodName: string;
  periodColor: string;
  paintings: Painting[];
}
