# The Timeline Museum

**An interactive 3D museum of art history that runs in your browser.**
Zoom through eight centuries on a timeline, open an artist's placard, and walk
into a first-person gallery hung with their real paintings — every work,
every date and every word taken from Wikipedia.

**Live:** https://the-virtual-art-gallery.vercel.app

- **26 periods, 233 artists, 7,010 works**, from Cimabue to Banksy
- **Every illustrated painting article** on English Wikipedia for each artist,
  hung chronologically at real physical size
- **Multi-room galleries** for prolific artists — Turner, Titian and Rubens
  each fill a suite of 16 rooms
- **Era-styled rooms**, period lighting and era music
- **Open source** (MIT) — contributions welcome

## The museum

### The timeline

A zoomable, infinite-canvas timeline of 26 art-history periods, Medieval &
Gothic to Contemporary, with 233 artists placed at the dates they actually
worked. Two views:

- **Gallery Wall** — period bands with each artist's lifeline, collision-free
  labels, and the period's Wikipedia wall text when you dive in.
- **Star Map** — each period a constellation; a star's size follows the
  number of works.

Filter by period or search artists from **Explore**; click an artist for their
museum placard, then **Enter the Gallery**.

### The galleries

- **Every work, in order.** An artist's gallery holds every painting that has
  an illustrated English Wikipedia article (frescoes, altarpieces and series
  included). Works hang chronologically; collections over twelve works become a
  suite of rooms joined by aligned doorways, each signed with its years
  ("II · 1460 – 1490"), with a room navigator to jump between them.
- **Real scale.** Paintings hang at their physical size from Wikidata
  dimensions (5,918 works), with the photo's proportions as a sanity check.
  The most-viewed work (12 months of Wikipedia pageviews) is the flagship.
- **Era rooms.** Ten gallery styles follow the artist's period — grey stone for
  gold-ground altarpieces, crimson damask for the Baroque, the Rijksmuseum's
  slate blue and black ebony frames for the Dutch Golden Age, sage silk for the
  18th century, deep green for Romanticism, peacock-blue silk for the
  Pre-Raphaelites, Orsay grey for the Impressionists, charcoal and gold for
  Klimt's Vienna, off-white for early modernism and a concrete white cube for
  post-war art. Walls, trim, floor, ceiling, benches and frames all change.
- **Lighting.** Each work is lit by a track spotlight aimed at it (big works get
  two), under a laylight; soft analytic wall shadows, a reflection probe of the
  finished room, a reflective floor and Khronos PBR Neutral tone mapping.
- **Up close.** Textures sharpen as you approach a work; click it to glide into
  an inspect view with the story and verbatim facts from its article, loading
  the scan at up to 3840 px.
- **Music.** Era-matched recordings from Wikimedia Commons — real performances,
  freely licensed, credited on screen (**M** mutes).

### Works still in copyright

557 works are still in copyright — much of Picasso's later work, Dalí,
Magritte, Pollock, Warhol and others. They hang like every other work, with the
image Wikipedia shows for them and **"© In copyright"** on the wall label and
in the inspect view. Where Wikipedia's article has no image at all (128 works),
a © placard canvas with the title, year and a link to the article hangs in its
place.

This museum is a non-commercial, educational project built entirely from
Wikipedia. **Rights holders:** if you'd like an image removed, open a
[takedown request](https://github.com/justdataplease/museum/issues/new?template=takedown-request.yml)
and we'll withhold it promptly (the work keeps its place as a © placard; see
[`src/lib/takedowns.ts`](src/lib/takedowns.ts)).

## Data — all from Wikipedia

Every period description, artist bio, portrait, painting, date, story and fact
is pulled from **English Wikipedia, Wikidata and Wikimedia Commons** by the
ingest scripts. Nothing is written by hand and nothing is AI-generated:
stories are article leads, facts are verbatim sentences from article bodies.

- Artists and periods are listed in [`scripts/seed.ts`](scripts/seed.ts) (names
  only).
- Works come from Wikidata (creator + painting classes, most-linked first) and
  each artist's "Paintings by …" category on Wikipedia.
- Enrichment adds physical size (Wikidata P2049/P2048), 12-month pageviews,
  Wikidata ids and date sanity checks.
- Licences: images on Commons are free; files on English Wikipedia are checked
  for the `NonFree` flag, and those works are labelled "© In copyright".

The snapshot is committed in [`data/cache/museum.json`](data/cache/museum.json),
so the app runs without network access to Wikipedia or a database.

## Getting started

```bash
npm install
npm run dev            # http://localhost:3000
```

That's it — the app reads the bundled snapshot. Optional extras:

```bash
# Re-pull the collection from Wikipedia (resumable; per-artist cache in
# data/cache/artists). Set WIKI_USER_AGENT first (see .env.example).
npm run ingest

# Refresh only the enrichment (sizes, pageviews, ids, dates) on the cache.
npm run enrich             # --dry-run, --keep-years, --keep-foreign

# Mirror the gallery music into public/audio (needs ffmpeg with AAC).
npm run fetch-music

# Load the snapshot into Postgres (e.g. Neon) and read from it instead:
# put DATABASE_URL in .env.local, then
npm run load-db
```

`load-db` fills staging tables and swaps them in with one short transaction,
so it can run against a live database. Every gallery is prerendered at build
time and revalidated hourly.

## Controls

| Where | Input | Action |
|---|---|---|
| Timeline | scroll / pinch, drag | zoom through time, pan |
| Timeline | arrows, + / −, 0 | pan, zoom, reset |
| Timeline | click a period | dive into it |
| Timeline | click an artist (or Tab + Enter) | placard → Enter the Gallery |
| Gallery (desktop) | click "step inside" | capture the mouse |
| Gallery (desktop) | W A S D / mouse | walk / look |
| Gallery | [ ] or Page Up / Page Down | previous / next room |
| Gallery | click a painting | inspect (scroll = lean in, Esc = step back) |
| Gallery (touch) | drag | look |
| Gallery (touch) | tap floor / tap painting | walk there / inspect (pinch = lean in) |
| Gallery | M | music on / off |

## How it's built

- **Next.js 16** (App Router): the timeline and all 233 galleries are
  prerendered; data comes from the JSON snapshot or Postgres.
- **React Three Fiber / three.js** galleries rendered on demand
  (`frameloop="demand"`): a still visitor costs no frames.
- **Suites** draw only what can be seen: neighbouring rooms by draw range,
  exhibits mounted by distance, a fixed pool of spotlights handed to the
  works in view (no shader recompiles while walking), and textures streamed by
  distance in tiers (thumbnail → wall → close-up → inspect).
- **Images** load straight from Wikimedia's CDN at fixed thumbnail widths
  ([`src/lib/img.ts`](src/lib/img.ts)); nothing is proxied.

## Performance

Measure with `node scripts/perf-probe.mjs <slug> <baseUrl>` on a production
build: draw calls per frame, framebuffer binds and idle frames (a still visitor
should cost 0 frames).

## Deploy

Any Node host works (`npm run build && npm start`, or the Dockerfile). On
Vercel, the project builds as-is; set `DATABASE_URL` only if you use Postgres.

## Tests and tools

- `node scripts/verify-e2e.mjs [baseUrl]` — timeline behaviour checks.
- `node scripts/suite-check.mjs` — walks a gallery suite: collision, doorways,
  navigator, inspect.
- `node scripts/perf-probe.mjs <slug> [baseUrl] [label]` — rendering cost.
- `node scripts/shot-museum.mjs <slug> <prefix> [baseUrl]` — gallery screenshots.
- `node scripts/error-sweep.mjs [baseUrl]` — console-error sweep.

## Contributing

Missing an artist or a painting? Found a bug? See
[CONTRIBUTING.md](CONTRIBUTING.md) — the short version: content comes only
from Wikipedia, so fixes go into the ingest or the seed list, never into the
data by hand.

## Licence and credits

Code: [MIT](LICENSE). Content keeps its own licences ([NOTICE.md](NOTICE.md)):

- Text from English Wikipedia — [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/);
  every artist and work links to its source article.
- Images from Wikimedia Commons / Wikipedia, each under the licence on its file
  page. Images of works still in copyright remain the property of their rights
  holders; they're shown as on Wikipedia, for education, and withheld on request.
- Music from Wikimedia Commons — public domain, CC0, CC BY and CC BY-SA
  recordings, credited in the gallery and in
  [`public/audio/CREDITS.md`](public/audio/CREDITS.md).

With thanks to the Wikipedia, Wikidata and Wikimedia Commons communities, and
to the musicians who released their recordings freely.
