# The Timeline Museum

An interactive 3D museum of art history that runs in the browser.

**Live:** https://the-virtual-art-gallery.vercel.app

- **The Timeline** — a zoomable, infinite-canvas timeline of 18 art-history periods
  (Medieval & Gothic → Contemporary) with 72 artists placed at the dates they
  actually worked. Two switchable views: **Gallery Wall** (period bands with each
  artist's lifeline, collision-free labels and Wikipedia wall text when you zoom
  into a period) and **Star Map** (each period a constellation, stars sized by the
  number of works). Filter by period or artist from the Explore dropdown; click an
  artist for their museum-placard card.
- **The Museum** — from any artist card, walk through the doors into a first-person
  3D gallery hung with their real paintings:
  - **Era-themed rooms.** Seven gallery styles follow the artist's period: grey
    stone for gold-ground altarpieces, crimson silk damask for the Baroque, sage
    silk for the 18th century, deep green distemper for Romanticism, Orsay grey
    for the Impressionists, off-white for early modernism and a concrete-floored
    white cube for post-war art. Walls, trim, floor, ceiling (laylight or modern
    lightbox), benches and frames (tabernacle, carved baroque gilt, slim gilt,
    hardwood, floater tray) all change with the era.
  - **Real-scale hanging.** Paintings are hung at their physical size from
    Wikidata dimensions (width × height, with the photo's proportions as a
    sanity check). Room size follows the collection: Vermeer gets an intimate
    7 m room, Veronese's *Wedding at Cana* an 8.6 m wall. The most-viewed work
    (12 months of Wikipedia pageviews) hangs on the far wall.
  - **Lighting.** Every work has its own track spotlight, clamped onto the
    ceiling rail and aimed at the painting (monumental works get two heads);
    soft analytic wall shadows, a reflection probe of the finished room, a
    reflective floor, Khronos PBR Neutral tone mapping. No shadow maps.
  - **Music.** Era-matched recordings from Wikimedia Commons (real performances,
    freely licensed); each track is credited on screen with composer, performer,
    licence and a link to its Commons page. Press **M** to mute.
  - Click a painting to glide into an inspect view with the story and verbatim
    fun facts; the high-resolution scan loads only then.

## Demo

[**demo/museum-demo.mp4**](demo/museum-demo.mp4) (2 min, 1600×900, with sound):
the Gallery Wall and Star Map, the Explore filter, Caravaggio's placard, then
walking his Baroque hall and inspecting *The Crucifixion of Saint Peter*, Monet's
Impressionist room and Rothko's white cube. Recorded from a production build with
`npm run build` + `node scripts/record-demo.mjs <url> demo/museum-demo.mp4`
(needs an ffmpeg with libx264 via `FFMPEG=`; set `DEMO_AUDIO_DIR` to mix in each
room's music).

Soundtrack — the first track of each room's playlist, as the app plays it, from
Wikimedia Commons:

- Giovanni Pierluigi da Palestrina, *Kyrie* from *Missa Sicut lilium inter
  spinas* — The Tudor Consort,
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
  ([source](https://commons.wikimedia.org/wiki/File:The_Tudor_Consort_-_02_-_Palestrina_-_Kyrie_-_Missa_Sicut_lilium_inter_spinas.ogg))
- Claude Debussy, *Clair de lune* — Laurens Goedhart,
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
  ([source](https://commons.wikimedia.org/wiki/File:Clair_de_lune_(Claude_Debussy)_Suite_bergamasque.ogg))
- Chris Zabriskie, *Prelude No. 10* — Chris Zabriskie,
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
  ([source](https://commons.wikimedia.org/wiki/File:Chris_Zabriskie_-_10_-_Prelude_No_10.ogg))

Excerpts are trimmed and faded at the start and end of each room visit.

## Data — all from Wikipedia

Every period description, artist bio, portrait, painting image, date, story and fun
fact is pulled from **English Wikipedia, Wikidata and Wikimedia Commons** at ingest
time. Nothing is AI-generated: stories are article leads, fun facts are verbatim
sentences from article bodies. 795 paintings across 72 artists; 704 have physical
dimensions from Wikidata and 764 have pageview counts.

## Setup

```bash
npm install

# 1. Pull the collection from Wikipedia (resumable; caches per-artist).
#    A normal ingest also runs the enrichment below.
npm run ingest

# 1b. Refresh only the Wikidata enrichment (physical size, pageviews, Wikidata
#     ids, out-of-lifetime date fixes) on the existing cache:
npm run enrich            # --dry-run, --keep-years, --keep-foreign

# 2. Create .env.local with your Neon Postgres connection string:
#    DATABASE_URL=postgres://...
# then load the database (adds width_cm / height_cm / pageviews columns):
npm run load-db

# 3. Run
npm run dev
```

Without `.env.local`, the app transparently falls back to the local ingest cache
(`data/cache/museum.json`), so it runs end-to-end either way. With `DATABASE_URL`
set, all reads go through Neon Postgres (`periods`, `artists`, `paintings`).
Every gallery is prerendered at build time and revalidated hourly.

`load-db` fills staging tables first and then swaps them in with one short
transaction, so it can run against the live database: readers always see either
the old collection or the new one in full. Existing galleries pick up reloaded
data within the hour, but only prerendered slugs are served, so an artist that is
new to the database gets a gallery at the next build or deploy (`load-db` lists
new and removed slugs).

## Deploy (Vercel)

Production runs on Vercel: team **JustDataPlease**, project
**virtual-art-gallery**, domain `the-virtual-art-gallery.vercel.app`. Without
`DATABASE_URL` it serves the bundled Wikipedia cache; add `DATABASE_URL` in the
project's environment variables to read from Neon instead.

On the Hobby plan Vercel blocks a CLI deploy whose latest commit author isn't the
Vercel account owner, so deploy a clean export of `main` (no git metadata):

```bash
mkdir ../vag-deploy && git archive HEAD | tar -x -C ../vag-deploy
cd ../vag-deploy
npx vercel link --yes --scope just-data-please --project virtual-art-gallery
npx vercel deploy --prod --scope just-data-please
```

## Controls

| Where | Input | Action |
|---|---|---|
| Timeline | scroll / pinch, drag | zoom through time, pan |
| Timeline | arrows, + / −, 0 | pan, zoom, reset |
| Timeline | click period band | dive into that period |
| Timeline | click artist (or Tab + Enter) | open placard card → Enter the Gallery |
| Museum (desktop) | click "step inside" | lock cursor |
| Museum (desktop) | W A S D / mouse | walk / look |
| Museum (desktop) | click painting | inspect (scroll = lean in, Esc = step back) |
| Museum (touch) | drag | look |
| Museum (touch) | tap floor / tap painting | walk there / inspect (pinch = lean in) |
| Museum | M | music on / off |

## Performance

Measured with `node scripts/perf-probe.mjs <slug> <baseUrl>` on a production
build (RTX 4070, headless Chrome, 1600×900). The gallery renders on demand, so
an idle hall draws nothing; the per-frame numbers are taken while walking.

| | Before | Now (caravaggio / monet / rothko) |
|---|---|---|
| Draw calls per frame | 368 standing, 297 walking | 72 / 61 / 72 |
| Framebuffer binds per frame | 14 | 7 |
| Frames rendered while standing still | every display frame | none (on-demand rendering) |
| Painting images downloaded | 5.10 MB | 3.18 / 3.64 / 0.24 MB |
| Last painting image loaded | 7.9 s | 1.4 s |
| Doors start opening / fully open | 9.0 s / 11.3 s | 2.8–3.0 s / 5.1–5.2 s |

## Notes

- Wikimedia thumbnails are restricted to fixed width buckets; `src/lib/img.ts`
  snaps every request to an allowed size and sizes wall textures by the work's
  physical size.
- Three artists hold fewer than 8 works (de Kooning 6, Hockney 7, Haring 6) — the
  hard ceiling of illustrated painting articles on Wikipedia for late-modern,
  still-copyrighted art. Every other gallery hangs 8–12.
- `node scripts/verify-e2e.mjs [baseUrl]` drives the timeline in Chrome, asserts
  its behaviour (37 checks) and drops evidence screenshots into
  `verify-artifacts/`; `node scripts/shot-museum.mjs <slug> <prefix> [baseUrl]`
  captures a gallery; `node scripts/error-sweep.mjs [baseUrl]` hunts console errors.
