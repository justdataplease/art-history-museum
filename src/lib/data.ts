// Server-side data access. Uses Neon Postgres when DATABASE_URL is set,
// otherwise falls back to the local Wikipedia ingest cache so the app
// still runs before the database is provisioned.

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolConfig } from "pg";
import type {
  Artist,
  ArtistWithPaintings,
  ImageCredit,
  Painting,
  Period,
  TimelineData,
} from "./types";
import { isTakenDown } from "./takedowns";
import { cleanArtistName, decodeEntities } from "./text";

// `next build` sets NEXT_PHASE for its prerender workers (read at runtime, not inlined).
const BUILDING = process.env.NEXT_PHASE === "phase-production-build";

let pool: Pool | null = null;
function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    // Verified TLS: Node's CA store checks Neon's certificate chain and host
    // name. Parameters in DATABASE_URL override this object (pg merges the
    // parsed URL over it), so never put sslmode=no-verify there.
    const config: PoolConfig & { enableChannelBinding?: boolean } = {
      connectionString: process.env.DATABASE_URL,
      ssl: true,
      enableChannelBinding: true, // SCRAM-SHA-256-PLUS when the server offers it
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    };
    pool = new Pool(config);
    // Neon drops idle connections on suspend/maintenance; the pool discards
    // the client itself, this just keeps it from surfacing as uncaught.
    pool.on("error", (err) => console.error("[data] idle Postgres client error:", err.message));
  }
  return pool;
}

/**
 * Run a database read; with no DATABASE_URL use the JSON cache. During
 * `next build` an unreachable database also falls back to the JSON cache so
 * the prerender still succeeds; at runtime the error propagates, so ISR keeps
 * serving the last good page instead of silently switching data sources.
 */
async function read<T>(fromDb: (db: Pool) => Promise<T>, fromCache: () => T): Promise<T> {
  const db = getPool();
  if (!db) return fromCache();
  try {
    return await fromDb(db);
  } catch (err) {
    if (!BUILDING) throw err;
    console.warn(`[data] database unreachable during build, using the JSON cache: ${(err as Error).message}`);
    return fromCache();
  }
}

// ---------- JSON-cache fallback ----------

interface CacheArtist extends Omit<Artist, "paintingCount"> {
  paintings: Painting[];
}
interface CacheShape {
  periods: Period[];
  artists: CacheArtist[];
}

// Read once per server process: an edit to museum.json needs a restart.
let cache: CacheShape | null = null;
function readCache(): CacheShape | null {
  if (cache) return cache;
  const file = path.join(process.cwd(), "data", "cache", "museum.json");
  if (!fs.existsSync(file)) return null;
  cache = JSON.parse(fs.readFileSync(file, "utf8")) as CacheShape;
  return cache;
}

// ---------- DTOs ----------
// Explicit field lists: the ingest cache carries extra provenance fields
// (wikiTitle, qid, sitelinks) that no client component reads, and everything
// returned here is serialized into the page's RSC payload.

function toPeriod(p: Period): Period {
  return {
    slug: p.slug,
    name: p.name,
    startYear: p.startYear,
    endYear: p.endYear,
    color: p.color,
    description: p.description,
    wikipediaUrl: p.wikipediaUrl,
  };
}

function toArtist(a: Omit<Artist, "paintingCount">, paintingCount: number): Artist {
  return {
    slug: a.slug,
    periodSlug: a.periodSlug,
    // display form: entities decoded, "(artist)" disambiguator dropped
    name: cleanArtistName(a.name),
    birthYear: a.birthYear,
    deathYear: a.deathYear,
    tagline: decodeEntities(a.tagline),
    bio: decodeEntities(a.bio),
    portraitUrl: a.portraitUrl,
    portraitWidth: a.portraitWidth,
    portraitHeight: a.portraitHeight,
    portraitCredit: a.portraitUrl ? toCredit(a.portraitCredit) : null,
    wikipediaUrl: a.wikipediaUrl,
    paintingCount,
  };
}

/** Only the four contract fields (a JSONB column may carry more). */
function toCredit(c: ImageCredit | null | undefined): ImageCredit | null {
  if (!c || typeof c !== "object" || !c.page) return null;
  return { author: c.author ?? null, license: c.license ?? "", licenseUrl: c.licenseUrl ?? null, page: c.page };
}

function toPainting(p: Painting): Painting {
  // a rights holder's takedown withholds the image; the work stays
  const takenDown = isTakenDown(p.wikipediaUrl);
  const imageUrl = takenDown ? null : (p.imageUrl ?? null);
  return {
    slug: p.slug,
    title: p.title,
    year: p.year,
    imageUrl,
    copyrighted: p.copyrighted === true || takenDown,
    imageWidth: p.imageWidth,
    imageHeight: p.imageHeight,
    imageBytes: p.imageBytes ?? null,
    imageCredit: imageUrl ? toCredit(p.imageCredit) : null,
    widthCm: p.widthCm ?? null,
    heightCm: p.heightCm ?? null,
    pageviews: p.pageviews ?? null,
    story: p.story,
    facts: p.facts ?? [],
    wikipediaUrl: p.wikipediaUrl,
  };
}

const byYear = (a: Painting, b: Painting) => (a.year ?? 9999) - (b.year ?? 9999);

// ---------- SQL ----------
// One round trip each; Postgres builds the JSON. The enrichment columns are
// read through to_jsonb(p) so a database loaded before they existed still
// works (missing key -> null) instead of failing the whole page.

const TIMELINE_SQL = `
SELECT json_build_object(
  'periods', COALESCE((
    SELECT json_agg(json_build_object(
      'slug', pe.slug, 'name', pe.name, 'startYear', pe.start_year, 'endYear', pe.end_year,
      'color', pe.color, 'description', pe.description, 'wikipediaUrl', pe.wikipedia_url
    ) ORDER BY pe.sort)
    FROM periods pe), '[]'::json),
  'artists', COALESCE((
    SELECT json_agg(json_build_object(
      'slug', a.slug, 'periodSlug', a.period_slug, 'name', a.name,
      'birthYear', a.birth_year, 'deathYear', a.death_year,
      'tagline', a.tagline, 'bio', a.bio,
      'portraitUrl', a.portrait_url, 'portraitWidth', a.portrait_width, 'portraitHeight', a.portrait_height,
      'portraitCredit', to_jsonb(a) -> 'portrait_credit',
      'wikipediaUrl', a.wikipedia_url,
      'paintingCount', (SELECT COUNT(*)::int FROM paintings p WHERE p.artist_id = a.id)
    ) ORDER BY a.birth_year NULLS LAST, a.id)
    FROM artists a), '[]'::json)
) AS data`;

const ARTIST_SQL = `
SELECT a.slug, a.period_slug, a.name, a.birth_year, a.death_year, a.tagline, a.bio,
       a.portrait_url, a.portrait_width, a.portrait_height, a.wikipedia_url,
       (SELECT to_jsonb(x) -> 'portrait_credit' FROM artists x WHERE x.id = a.id) AS portrait_credit,
       pe.name AS period_name, pe.color AS period_color,
       COALESCE(json_agg(json_build_object(
         'slug', p.slug, 'title', p.title, 'year', p.year,
         'imageUrl', p.image_url, 'imageWidth', p.image_width, 'imageHeight', p.image_height,
         'imageBytes', to_jsonb(p) -> 'image_bytes',
         'imageCredit', to_jsonb(p) -> 'image_credit',
         'widthCm', to_jsonb(p) -> 'width_cm',
         'heightCm', to_jsonb(p) -> 'height_cm',
         'pageviews', to_jsonb(p) -> 'pageviews',
         'copyrighted', COALESCE((to_jsonb(p) ->> 'copyrighted')::boolean, false),
         'story', p.story, 'facts', p.facts, 'wikipediaUrl', p.wikipedia_url
       ) ORDER BY p.year NULLS LAST, p.sort) FILTER (WHERE p.id IS NOT NULL), '[]'::json) AS paintings
FROM artists a
JOIN periods pe ON pe.slug = a.period_slug
LEFT JOIN paintings p ON p.artist_id = a.id
WHERE a.slug = $1
GROUP BY a.id, pe.name, pe.color`;

const SLUGS_SQL = `
SELECT a.slug FROM artists a
WHERE EXISTS (SELECT 1 FROM paintings p WHERE p.artist_id = a.id)
ORDER BY a.slug`;

// ---------- public API ----------

export async function getTimeline(): Promise<TimelineData> {
  return read(
    async (db) => {
      const r = await db.query<{ data: TimelineData }>(TIMELINE_SQL);
      const d = r.rows[0].data;
      return { periods: d.periods.map(toPeriod), artists: d.artists.map((a) => toArtist(a, a.paintingCount)) };
    },
    () => {
      const c = readCache();
      if (!c) return { periods: [], artists: [] };
      return {
        periods: c.periods.map(toPeriod),
        artists: c.artists.map((a) => toArtist(a, a.paintings.length)),
      };
    }
  );
}

/** Slugs of every artist with at least one painting (the prerendered galleries). */
export async function getArtistSlugs(): Promise<string[]> {
  return read(
    async (db) => (await db.query<{ slug: string }>(SLUGS_SQL)).rows.map((r) => r.slug),
    () => (readCache()?.artists ?? []).filter((a) => a.paintings.length > 0).map((a) => a.slug)
  );
}

export async function getArtist(slug: string): Promise<ArtistWithPaintings | null> {
  return read(
    async (db) => {
      const res = await db.query(ARTIST_SQL, [slug]);
      const r = res.rows[0];
      if (!r) return null;
      const paintings = (r.paintings as Painting[]).map(toPainting);
      return {
        ...toArtist(
          {
            slug: r.slug,
            periodSlug: r.period_slug,
            name: r.name,
            birthYear: r.birth_year,
            deathYear: r.death_year,
            tagline: r.tagline,
            bio: r.bio,
            portraitUrl: r.portrait_url,
            portraitWidth: r.portrait_width,
            portraitHeight: r.portrait_height,
            portraitCredit: r.portrait_credit ?? null,
            wikipediaUrl: r.wikipedia_url,
          },
          paintings.length
        ),
        periodName: r.period_name,
        periodColor: r.period_color,
        paintings,
      };
    },
    () => {
      const c = readCache();
      const artist = c?.artists.find((a) => a.slug === slug);
      if (!c || !artist) return null;
      const period = c.periods.find((p) => p.slug === artist.periodSlug);
      return {
        ...toArtist(artist, artist.paintings.length),
        periodName: period?.name ?? "",
        periodColor: period?.color ?? "#888",
        paintings: [...artist.paintings].sort(byYear).map(toPainting),
      };
    }
  );
}
