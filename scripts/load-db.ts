// Load the Wikipedia ingest cache into the Neon Postgres database.
// Reads DATABASE_URL from .env.local (never printed).
//
//   npm run load-db                          # refuses to remove a live gallery
//   npm run load-db -- --allow-removals      # also when the cache lacks artists the database has
//
// The site reads these tables while a reload runs (an hourly ISR regeneration
// can start at any moment and caches what it reads for the next hour), so a
// reload never exposes a half-loaded state: the new data is built in staging
// tables (*_new) with one set-based INSERT per table, then swapped in by one
// short transaction. Readers see either the old tables or the new ones in full.

import "./lib/env";
import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolConfig } from "pg";

// the site's snapshot (archive/site.py: the ingest plus the works only WikiArt has), else the ingest's own
const siteFile = path.join(__dirname, "..", "data", "site", "museum.json");
const file = fs.existsSync(siteFile) ? siteFile : path.join(__dirname, "..", "data", "wikipedia", "museum.json");

// Staging tables carry explicit constraint names; the swap renames them (and
// the index and serial sequences) to the live names, which leaves the *_new
// names free for the next run.
const CREATE_STAGING = `
  DROP TABLE IF EXISTS paintings_new;
  DROP TABLE IF EXISTS artists_new;
  DROP TABLE IF EXISTS periods_new;

  CREATE TABLE periods_new (
    id SERIAL CONSTRAINT periods_new_pkey PRIMARY KEY,
    slug TEXT NOT NULL CONSTRAINT periods_new_slug_key UNIQUE,
    name TEXT NOT NULL,
    start_year INT NOT NULL,
    end_year INT NOT NULL,
    color TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    wikipedia_url TEXT,
    sort INT NOT NULL
  );

  CREATE TABLE artists_new (
    id SERIAL CONSTRAINT artists_new_pkey PRIMARY KEY,
    slug TEXT NOT NULL CONSTRAINT artists_new_slug_key UNIQUE,
    period_slug TEXT NOT NULL CONSTRAINT artists_new_period_slug_fkey REFERENCES periods_new(slug),
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
    -- {author, license, licenseUrl, page} of the portrait (src/lib/types.ts ImageCredit)
    portrait_credit JSONB,
    wikipedia_url TEXT
  );

  CREATE TABLE paintings_new (
    id SERIAL CONSTRAINT paintings_new_pkey PRIMARY KEY,
    artist_id INT NOT NULL
      CONSTRAINT paintings_new_artist_id_fkey REFERENCES artists_new(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    year INT,
    image_url TEXT,
    image_width INT,
    image_height INT,
    story TEXT NOT NULL DEFAULT '',
    facts JSONB NOT NULL DEFAULT '[]',
    wikipedia_url TEXT,
    sort INT NOT NULL DEFAULT 0,
    -- enrichment (scripts/enrich.ts)
    width_cm REAL,
    height_cm REAL,
    pageviews INTEGER,
    image_bytes BIGINT,
    -- no free image: the work is still in copyright (image_url is null)
    copyrighted BOOLEAN NOT NULL DEFAULT false,
    -- {author, license, licenseUrl, page} of the image (src/lib/types.ts ImageCredit)
    image_credit JSONB,
    CONSTRAINT paintings_new_artist_id_slug_key UNIQUE (artist_id, slug)
  );
  CREATE INDEX paintings_new_artist_idx ON paintings_new(artist_id);
`;

const LIVE: Record<string, { constraints: string[]; indexes?: string[] }> = {
  periods: { constraints: ["pkey", "slug_key"] },
  artists: { constraints: ["pkey", "slug_key", "period_slug_fkey"] },
  paintings: { constraints: ["pkey", "artist_id_fkey", "artist_id_slug_key"], indexes: ["artist_idx"] },
};

// Runs in one transaction after all three live tables are locked: readers
// queue for its few milliseconds, then resolve the names again and read the
// new tables.
const SWAP = [
  "DROP TABLE IF EXISTS paintings",
  "DROP TABLE IF EXISTS artists",
  "DROP TABLE IF EXISTS periods",
  ...Object.entries(LIVE).flatMap(([t, { constraints, indexes = [] }]) => [
    `ALTER TABLE ${t}_new RENAME TO ${t}`,
    ...constraints.map((c) => `ALTER TABLE ${t} RENAME CONSTRAINT ${t}_new_${c} TO ${t}_${c}`),
    ...indexes.map((i) => `ALTER INDEX ${t}_new_${i} RENAME TO ${t}_${i}`),
    `ALTER SEQUENCE IF EXISTS ${t}_new_id_seq RENAME TO ${t}_id_seq`,
  ]),
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Swap the staging tables in. The live tables are locked up front, each wait
 * capped well below Postgres' deadlock_timeout (1 s), and the whole attempt
 * retried on a timeout: readers take the same locks in other orders (the
 * timeline query reads periods first, a gallery query artists first), so an
 * uncapped wait could deadlock and fail a reader instead.
 */
async function swapIn(db: Pool): Promise<void> {
  const { rows } = await db.query<{ relname: string }>(
    `SELECT relname FROM pg_class
     WHERE relname = ANY($1) AND relkind = 'r' AND pg_table_is_visible(oid)`,
    [Object.keys(LIVE)]
  );
  const live = Object.keys(LIVE).filter((t) => rows.some((r) => r.relname === t));
  const lock = live.length
    ? ["SET LOCAL lock_timeout = '200ms'", `LOCK TABLE ${live.join(", ")} IN ACCESS EXCLUSIVE MODE`]
    : [];
  const client = await db.connect();
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await client.query(["BEGIN", ...lock, ...SWAP, "COMMIT"].join(";\n"));
        return;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        // 55P03 lock timeout / 40P01 deadlock: nothing changed; try again shortly.
        const code = (err as { code?: string }).code;
        if ((code !== "55P03" && code !== "40P01") || attempt >= 50) throw err;
        await sleep(50 + Math.random() * 150);
      }
    }
  } finally {
    client.release();
  }
}

// Artists that have a gallery (same rule as getArtistSlugs in src/lib/data.ts).
const GALLERY_SLUGS_SQL = `
SELECT a.slug FROM artists a
WHERE EXISTS (SELECT 1 FROM paintings p WHERE p.artist_id = a.id)`;

async function gallerySlugs(db: Pool): Promise<Set<string>> {
  try {
    return new Set((await db.query<{ slug: string }>(GALLERY_SLUGS_SQL)).rows.map((r) => r.slug));
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return new Set(); // first load: no tables yet
    throw err;
  }
}

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
  if (!data.periods?.length || !data.artists?.some((a: any) => a.paintings?.length)) {
    console.error("The ingest cache has no periods or no paintings; the database was left as it is.");
    process.exit(1);
  }
  // Verified TLS (Node's CA store checks Neon's certificate chain and host
  // name). Parameters in DATABASE_URL override this object, so never put
  // sslmode=no-verify there. Channel binding (SCRAM-SHA-256-PLUS) when offered.
  const config: PoolConfig & { enableChannelBinding?: boolean } = {
    connectionString: process.env.DATABASE_URL,
    ssl: true,
    enableChannelBinding: true,
    max: 3,
    connectionTimeoutMillis: 10_000,
  };
  const db = new Pool(config);
  db.on("error", (err) => console.error("[pg] idle client error:", err.message));

  // ---- 1. build the staging tables (the live ones keep serving meanwhile) ----
  await db.query(CREATE_STAGING);

  // Rows go in as one JSON parameter per table; `ord` keeps the cache order
  // (serial ids, and which duplicate painting slug wins, as before).
  const periods = data.periods.map((p: any, i: number) => ({
    slug: p.slug, name: p.name, start_year: p.startYear, end_year: p.endYear, color: p.color,
    description: p.description, wikipedia_url: p.wikipediaUrl, sort: i,
  }));
  await db.query(
    `INSERT INTO periods_new (slug, name, start_year, end_year, color, description, wikipedia_url, sort)
     SELECT slug, name, start_year, end_year, color, description, wikipedia_url, sort
     FROM json_to_recordset($1::json) AS x(slug TEXT, name TEXT, start_year INT, end_year INT,
                                           color TEXT, description TEXT, wikipedia_url TEXT, sort INT)
     ORDER BY sort`,
    [JSON.stringify(periods)]
  );

  const artists = data.artists.map((a: any, i: number) => ({
    ord: i, slug: a.slug, period_slug: a.periodSlug, name: a.name, wiki_title: a.wikiTitle, qid: a.qid,
    birth_year: a.birthYear, death_year: a.deathYear, tagline: a.tagline, bio: a.bio,
    portrait_url: a.portraitUrl, portrait_width: a.portraitWidth, portrait_height: a.portraitHeight,
    portrait_credit: a.portraitUrl ? a.portraitCredit ?? null : null,
    wikipedia_url: a.wikipediaUrl,
  }));
  await db.query(
    `INSERT INTO artists_new (slug, period_slug, name, wiki_title, qid, birth_year, death_year,
                              tagline, bio, portrait_url, portrait_width, portrait_height, portrait_credit,
                              wikipedia_url)
     SELECT slug, period_slug, name, wiki_title, qid, birth_year, death_year,
            tagline, bio, portrait_url, portrait_width, portrait_height, portrait_credit, wikipedia_url
     FROM json_to_recordset($1::json) AS x(ord INT, slug TEXT, period_slug TEXT, name TEXT, wiki_title TEXT,
                                           qid TEXT, birth_year INT, death_year INT, tagline TEXT, bio TEXT,
                                           portrait_url TEXT, portrait_width INT, portrait_height INT,
                                           portrait_credit JSONB, wikipedia_url TEXT)
     ORDER BY ord`,
    [JSON.stringify(artists)]
  );

  let ord = 0;
  const paintings = data.artists.flatMap((a: any) =>
    a.paintings.map((p: any, sort: number) => ({
      ord: ord++, artist_slug: a.slug, slug: p.slug, title: p.title, year: p.year,
      image_url: p.imageUrl, image_width: p.imageWidth, image_height: p.imageHeight,
      story: p.story, facts: p.facts ?? [], wikipedia_url: p.wikipediaUrl, sort,
      width_cm: p.widthCm ?? null, height_cm: p.heightCm ?? null, pageviews: p.pageviews ?? null,
      image_bytes: p.imageBytes ?? null, copyrighted: p.copyrighted === true,
      image_credit: p.imageUrl ? p.imageCredit ?? null : null,
    }))
  );
  await db.query(
    `INSERT INTO paintings_new (artist_id, slug, title, year, image_url, image_width, image_height,
                                story, facts, wikipedia_url, sort, width_cm, height_cm, pageviews, image_bytes,
                                copyrighted, image_credit)
     SELECT a.id, x.slug, x.title, x.year, x.image_url, x.image_width, x.image_height,
            x.story, x.facts, x.wikipedia_url, x.sort, x.width_cm, x.height_cm, x.pageviews, x.image_bytes,
            x.copyrighted, x.image_credit
     FROM json_to_recordset($1::json) AS x(ord INT, artist_slug TEXT, slug TEXT, title TEXT, year INT,
                                           image_url TEXT, image_width INT, image_height INT, story TEXT,
                                           facts JSONB, wikipedia_url TEXT, sort INT, width_cm REAL,
                                           height_cm REAL, pageviews INT, image_bytes BIGINT,
                                           copyrighted BOOLEAN, image_credit JSONB)
     JOIN artists_new a ON a.slug = x.artist_slug
     ORDER BY x.ord
     ON CONFLICT (artist_id, slug) DO NOTHING`,
    [JSON.stringify(paintings)]
  );

  // ---- 2. swap them in ----
  const before = await gallerySlugs(db);
  // A gallery that would disappear is almost always an ingest that failed for
  // that artist, not a curatorial decision: refuse unless asked explicitly.
  const incoming = new Set<string>(
    data.artists.filter((a: any) => a.paintings?.length).map((a: any) => a.slug as string)
  );
  const lost = [...before].filter((s) => !incoming.has(s));
  if (lost.length && !process.argv.includes("--allow-removals")) {
    await db.query("DROP TABLE IF EXISTS paintings_new; DROP TABLE IF EXISTS artists_new; DROP TABLE IF EXISTS periods_new;");
    await db.end();
    console.error(
      `The cache has no gallery for ${lost.length} artist(s) the database shows: ${lost.join(", ")}.\n` +
        "Nothing was changed. Re-run the ingest for them, or pass --allow-removals to remove them."
    );
    process.exit(1);
  }
  await swapIn(db);
  const after = await gallerySlugs(db);

  const counts = await db.query(
    `SELECT (SELECT COUNT(*) FROM periods) AS periods,
            (SELECT COUNT(*) FROM artists) AS artists,
            (SELECT COUNT(*) FROM paintings) AS paintings,
            (SELECT COUNT(*) FROM paintings WHERE width_cm IS NOT NULL AND height_cm IS NOT NULL) AS with_dimensions,
            (SELECT COUNT(*) FROM paintings WHERE pageviews IS NOT NULL) AS with_pageviews,
            (SELECT COUNT(*) FROM paintings WHERE image_bytes IS NOT NULL) AS with_image_bytes,
            (SELECT COUNT(*) FROM paintings WHERE image_credit IS NOT NULL) AS with_image_credit`
  );
  console.log("Loaded into Neon:", counts.rows[0]);

  // Galleries are prerendered at build time and /museum/[slug] serves no other
  // slug (dynamicParams = false): a new artist's gallery appears after the
  // next build; existing ones pick up the new data within the hour.
  const added = [...after].filter((s) => !before.has(s));
  const removed = [...before].filter((s) => !after.has(s));
  if (added.length && before.size)
    console.log(`New galleries (${added.length}), live after the next build/deploy: ${added.join(", ")}`);
  if (removed.length)
    console.log(`Removed galleries (${removed.length}), 404 from their next revalidation: ${removed.join(", ")}`);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
