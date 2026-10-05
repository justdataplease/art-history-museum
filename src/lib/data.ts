// Server-side data access. Uses Neon Postgres when DATABASE_URL is set,
// otherwise falls back to the local Wikipedia ingest cache so the app
// still runs before the database is provisioned.

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import type {
  Artist,
  ArtistWithPaintings,
  Painting,
  Period,
  TimelineData,
} from "./types";

let pool: Pool | null = null;
function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

// ---------- JSON-cache fallback ----------

interface CacheArtist extends Omit<Artist, "paintingCount"> {
  paintings: Painting[];
}
interface CacheShape {
  periods: Period[];
  artists: CacheArtist[];
}

let cache: CacheShape | null = null;
function readCache(): CacheShape | null {
  if (cache) return cache;
  const file = path.join(process.cwd(), "data", "cache", "museum.json");
  if (!fs.existsSync(file)) return null;
  cache = JSON.parse(fs.readFileSync(file, "utf8")) as CacheShape;
  return cache;
}

// ---------- public API ----------

export async function getTimeline(): Promise<TimelineData> {
  const db = getPool();
  if (db) {
    const periods = await db.query(
      `SELECT slug, name, start_year, end_year, color, description, wikipedia_url
       FROM periods ORDER BY sort`
    );
    const artists = await db.query(
      `SELECT a.slug, a.period_slug, a.name, a.birth_year, a.death_year, a.tagline,
              a.bio, a.portrait_url, a.portrait_width, a.portrait_height,
              a.wikipedia_url, COUNT(p.id)::int AS painting_count
       FROM artists a LEFT JOIN paintings p ON p.artist_id = a.id
       GROUP BY a.id ORDER BY a.birth_year NULLS LAST`
    );
    return {
      periods: periods.rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        startYear: r.start_year,
        endYear: r.end_year,
        color: r.color,
        description: r.description,
        wikipediaUrl: r.wikipedia_url,
      })),
      artists: artists.rows.map((r) => ({
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
        wikipediaUrl: r.wikipedia_url,
        paintingCount: r.painting_count,
      })),
    };
  }

  const c = readCache();
  if (!c) return { periods: [], artists: [] };
  return {
    periods: c.periods,
    artists: c.artists.map(({ paintings, ...a }) => ({
      ...a,
      paintingCount: paintings.length,
    })),
  };
}

export async function getArtist(
  slug: string
): Promise<ArtistWithPaintings | null> {
  const db = getPool();
  if (db) {
    const a = await db.query(
      `SELECT a.*, pe.name AS period_name, pe.color AS period_color
       FROM artists a JOIN periods pe ON pe.slug = a.period_slug
       WHERE a.slug = $1`,
      [slug]
    );
    if (!a.rows[0]) return null;
    const r = a.rows[0];
    const p = await db.query(
      `SELECT slug, title, year, image_url, image_width, image_height,
              story, facts, wikipedia_url
       FROM paintings WHERE artist_id = $1 ORDER BY year NULLS LAST, sort`,
      [r.id]
    );
    return {
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
      wikipediaUrl: r.wikipedia_url,
      paintingCount: p.rows.length,
      periodName: r.period_name,
      periodColor: r.period_color,
      paintings: p.rows.map((row) => ({
        slug: row.slug,
        title: row.title,
        year: row.year,
        imageUrl: row.image_url,
        imageWidth: row.image_width,
        imageHeight: row.image_height,
        story: row.story,
        facts: row.facts ?? [],
        wikipediaUrl: row.wikipedia_url,
      })),
    };
  }

  const c = readCache();
  if (!c) return null;
  const artist = c.artists.find((a) => a.slug === slug);
  if (!artist) return null;
  const period = c.periods.find((p) => p.slug === artist.periodSlug);
  const { paintings, ...rest } = artist;
  const sorted = [...paintings].sort(
    (a, b) => (a.year ?? 9999) - (b.year ?? 9999)
  );
  return {
    ...rest,
    paintingCount: paintings.length,
    periodName: period?.name ?? "",
    periodColor: period?.color ?? "#888",
    paintings: sorted,
  };
}
