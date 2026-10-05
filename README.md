# The Timeline Museum

An interactive 3D museum of art history that runs in the browser.

- **The Timeline** — a zoomable, infinite-canvas timeline of 18 art-history periods
  (Medieval & Gothic → Contemporary) with 72 artists placed at the dates they
  actually worked. Three switchable views: **Gallery Wall**, **Star Map**, **The River**.
  Filter by period or artist from the animated Explore dropdown. Click an artist for
  their museum-placard card.
- **The Museum** — from any artist card, walk through the doors into a first-person
  3D gallery (WASD + mouse) hung with their real paintings: PBR materials, a spotlight
  per painting, soft shadows, reflective floor, ACES tone mapping. Click a painting
  to glide into an inspect view with the story and verbatim fun facts.

## Data — all from Wikipedia

Every period description, artist bio, portrait, painting image, date, story and fun
fact is pulled from **English Wikipedia, Wikidata and Wikimedia Commons** at ingest
time. Nothing is AI-generated: stories are article leads, fun facts are verbatim
sentences from article bodies. 796 paintings across 72 artists.

## Setup

```bash
npm install

# 1. Pull the collection from Wikipedia (resumable; caches per-artist)
npm run ingest

# 2. Create .env.local with your Neon Postgres connection string:
#    DATABASE_URL=postgres://...
# then load the database:
npm run load-db

# 3. Run
npm run dev
```

Without `.env.local`, the app transparently falls back to the local ingest cache
(`data/cache/museum.json`), so it runs end-to-end either way. With `DATABASE_URL`
set, all reads go through Neon Postgres (`periods`, `artists`, `paintings`).

## Controls

| Where | Input | Action |
|---|---|---|
| Timeline | scroll / drag | zoom through time / pan |
| Timeline | click period band | dive into that period |
| Timeline | click artist | open placard card → Enter the Gallery |
| Museum | click | lock cursor |
| Museum | WASD / mouse | walk / look |
| Museum | click painting | inspect (scroll = lean in, Esc = step back) |

## Notes

- Wikimedia thumbnails are restricted to fixed width buckets; `src/lib/img.ts`
  snaps every request to an allowed size.
- Three artists hold fewer than 8 works (de Kooning 6, Hockney 7, Haring 6) — the
  hard ceiling of illustrated painting articles on Wikipedia for late-modern,
  still-copyrighted art. Every other gallery hangs 8–12.
- `node scripts/verify-e2e.mjs` drives the app in Chrome and drops evidence
  screenshots into `verify-artifacts/`.
