# Development guide

Setup, data updates, deployment and verification for contributors. For the museum itself, see the [README](../README.md).

## Getting started

```bash
npm install
npm run dev            # http://localhost:3000
```

The app reads the bundled snapshot, so that's all you need. Optional extras:

```bash
# Set WIKI_USER_AGENT first (see .env.example): Wikimedia asks every client
# to identify itself.

# Pull the collection from Wikipedia. Resumable: each artist is cached in
# data/wikipedia/artists, and --refresh re-fetches them all.
npm run ingest
npm run ingest -- --refresh

# Re-check the snapshot in place (non-artworks, images, dates, sizes,
# copyright, credits) and write a report. --dry-run writes nothing.
npm run repair-data

# Refresh only the enrichment (sizes, pageviews, ids, dates).
npm run enrich             # --dry-run, --keep-years, --keep-foreign

# Copy the gallery music into public/audio (needs ffmpeg with AAC).
npm run fetch-music

# Load the snapshot into Postgres (e.g. Neon) and read from it instead:
# put DATABASE_URL in .env.local, then
npm run load-db            # --allow-removals to drop artists the cache lacks
```

With `WIKI_HTTP_CACHE=<dir>` the scripts save API responses on disk. File
metadata and Wikidata claims also reuse records by file or item, so changed
batch boundaries don't trigger lookups of unchanged works.

`load-db` fills staging tables and swaps them in with one short transaction,
so it can run against a live database. Every gallery is prerendered at build
time and refreshed hourly.

### Data archive and the site snapshot

Other sources (WikiArt so far), Wikidata life facts, our own taxonomy
(`data/taxonomy/`) and a DuckDB warehouse in our own format
(`data/museum.duckdb`) are run by a local Dagster (`run_dagster.cmd`,
<http://127.0.0.1:3080>). See [`archive/README.md`](../archive/README.md).

The site reads `data/site/museum.json` when it exists: the ingest's snapshot
plus the works only WikiArt has, for public-domain artists. Otherwise it reads
`data/wikipedia/museum.json`. The full refresh, in order:

```bash
npm run ingest && npm run repair-data          # data/wikipedia
archive/.venv/Scripts/python -m archive.wikimedia manifest
archive/.venv/Scripts/python -m archive.wikidata artists
archive/.venv/Scripts/python -m archive.warehouse build
archive/.venv/Scripts/python -m archive.fingerprints
archive/.venv/Scripts/python -m archive.warehouse build
archive/.venv/Scripts/python -m archive.site   # data/site/museum.json, rooms.json (`archive.site rooms`: rooms.json only)
archive/.venv/Scripts/python -m archive.guide build   # data/site/guide: audio guide scripts
npm run load-db                                # reads data/site when present
```

(or Dagster's `wikidata_facts` then `warehouse_build` jobs after the ingest).
WikiArt images load from `uploads*.wikiart.org`, allowed in the CSP
(`next.config.ts`).

## How it's built

- **Routes:** `/` the timeline; `/museum/<artist>` an artist's gallery (prerendered); `/rooms` make a room and
  `/room?...` walk it (rendered on request: the selection, the room's design and its floor plan are the URL,
  `src/lib/room-query.ts`, chosen and hung by `src/lib/rooms.ts`; a room with floors has `&f=2` ..., joined by an
  elevator by the entrance); `/museums/<slug>` a recreated museum (`src/lib/museum-rooms.ts`), an ordinary room
  link; `/api/room` the picker's live count and preview (`?preview=1`); `/api/room/works?q=` the works to pick by
  hand; `/api/guide/<artist>` the audio guide's scripts (`data/site/guide`); `/furniture` (development only) every
  room style's seating, for modelling it.

- **Next.js 16** (App Router). The timeline and all 526 galleries are
  prerendered; data comes from the JSON snapshot or Postgres.
- **React Three Fiber / three.js** galleries that only render when something
  changes (`frameloop="demand"`), so standing still costs no frames.
- **Suites** draw only what you can see: the neighbouring rooms, the works near
  you, and a fixed pool of 16 spotlights handed to the works in view, so
  walking never recompiles a shader. Textures load in steps as you get closer
  (thumbnail, wall, close-up, inspect).
- **Images** load straight from Wikimedia's servers at fixed thumbnail widths
  ([`src/lib/img.ts`](../src/lib/img.ts)), retrying if Wikimedia is busy.

## Performance

Measured with `node scripts/perf-probe.mjs <slug> <baseUrl>` on a production
build (October 2026; headless Chrome, ANGLE/D3D11 on an RTX 4070, 1600×900).
The nine-room Caravaggio suite was walked end to end. Draws and framebuffer
binds are per rendered frame while walking. All 28 shader programs were
linked behind the entry doors; the count stayed at 28 throughout the walk.

| Gallery | Rooms | Draws / frame | FB binds | Idle frames | Programs | Images at doors → after full walk |
|---|---|---|---|---|---|---|
| Caravaggio | 9 | 15–103 | 7 | 0 | 28 → 28 | 2.68 → 30.89 MB |

## Deploy

Any Node host works (`npm run build && npm start`, or the Dockerfile). On
Vercel the project builds as it is; set `DATABASE_URL` only if you use
Postgres.

## Tests and tools

- `node scripts/verify-e2e.mjs [baseUrl]`: timeline behaviour checks.
- `node scripts/suite-check.mjs`: walks a gallery suite (collision, doorways,
  navigator, inspect).
- `node scripts/perf-probe.mjs <slug> [baseUrl] [label]`: rendering cost.
- `node scripts/shot-museum.mjs <slug> <prefix> [baseUrl]`: gallery screenshots.
- `node scripts/error-sweep.mjs [baseUrl]`: console-error sweep.
- `npm run check-layout`: collection and room-navigation checks up to 10,000 works.
- `npx tsx --test scripts/ingest.test.ts scripts/lib/wiki.test.ts scripts/lib/passes.test.ts scripts/lib/metadata.test.ts scripts/lib/item-cache.test.ts`:
  source validation, catalogue pagination, category traversal, series
  handling and stable metadata reuse.
- `node scripts/record-demo.mjs [baseUrl] [out.mp4]`: records the one-minute
  tour.

