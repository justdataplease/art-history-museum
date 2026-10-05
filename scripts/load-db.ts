// Load the Wikipedia ingest cache into the Neon Postgres database.
// Reads DATABASE_URL from .env.local (never printed).

import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const file = path.join(__dirname, "..", "data", "cache", "museum.json");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Create .env.local with DATABASE_URL=...");
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error("No ingest cache found. Run `npm run ingest` first.");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });

  await db.query(`
    DROP TABLE IF EXISTS paintings;
    DROP TABLE IF EXISTS artists;
    DROP TABLE IF EXISTS periods;

    CREATE TABLE periods (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      start_year INT NOT NULL,
      end_year INT NOT NULL,
      color TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      wikipedia_url TEXT,
      sort INT NOT NULL
    );

    CREATE TABLE artists (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      period_slug TEXT NOT NULL REFERENCES periods(slug),
      name TEXT NOT NULL,
      wiki_title TEXT NOT NULL,
      qid TEXT,
      birth_year INT,
      death_year INT,
      tagline TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      portrait_url TEXT,
      portrait_width INT,
      portrait_height INT,
      wikipedia_url TEXT
    );

    CREATE TABLE paintings (
      id SERIAL PRIMARY KEY,
      artist_id INT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      year INT,
      image_url TEXT NOT NULL,
      image_width INT,
      image_height INT,
      story TEXT NOT NULL DEFAULT '',
      facts JSONB NOT NULL DEFAULT '[]',
      wikipedia_url TEXT,
      sort INT NOT NULL DEFAULT 0,
      UNIQUE (artist_id, slug)
    );
    CREATE INDEX paintings_artist_idx ON paintings(artist_id);
  `);

  for (let i = 0; i < data.periods.length; i++) {
    const p = data.periods[i];
    await db.query(
      `INSERT INTO periods (slug, name, start_year, end_year, color, description, wikipedia_url, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.slug, p.name, p.startYear, p.endYear, p.color, p.description, p.wikipediaUrl, i]
    );
  }

  for (const a of data.artists) {
    const res = await db.query(
      `INSERT INTO artists (slug, period_slug, name, wiki_title, qid, birth_year, death_year,
                            tagline, bio, portrait_url, portrait_width, portrait_height, wikipedia_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        a.slug, a.periodSlug, a.name, a.wikiTitle, a.qid, a.birthYear, a.deathYear,
        a.tagline, a.bio, a.portraitUrl, a.portraitWidth, a.portraitHeight, a.wikipediaUrl,
      ]
    );
    const artistId = res.rows[0].id;
    let sort = 0;
    for (const p of a.paintings) {
      await db.query(
        `INSERT INTO paintings (artist_id, slug, title, year, image_url, image_width,
                                image_height, story, facts, wikipedia_url, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (artist_id, slug) DO NOTHING`,
        [
          artistId, p.slug, p.title, p.year, p.imageUrl, p.imageWidth,
          p.imageHeight, p.story, JSON.stringify(p.facts), p.wikipediaUrl, sort++,
        ]
      );
    }
  }

  const counts = await db.query(
    `SELECT (SELECT COUNT(*) FROM periods) AS periods,
            (SELECT COUNT(*) FROM artists) AS artists,
            (SELECT COUNT(*) FROM paintings) AS paintings`
  );
  console.log("Loaded into Neon:", counts.rows[0]);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
