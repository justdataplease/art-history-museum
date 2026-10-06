# The Timeline Museum

A 3D museum of art history that runs in your browser. You zoom through eight
centuries on a timeline, pick an artist, and walk into a gallery hung with
their paintings. Every work, date and word comes from Wikipedia.

**Live:** https://art-history.artfrompixels.com

**One-minute tour:** [`demo/museum-demo.mp4`](demo/museum-demo.mp4)

- 27 periods, 342 artists and 8,376 works, from Cimabue to Banksy
- Each artist's paintings hang in the order they were painted, at their real
  size
- Big collections get a suite of rooms (Turner and Titian have 16 each)
- Each period has its own room style, lighting and music
- Open source under the MIT licence

## The museum

### The timeline

The timeline covers 27 periods, from Medieval & Gothic to Contemporary, with
each artist placed at the years they worked. There are two views:

- **Gallery Wall:** a band per period with each artist's lifeline. Click a
  period to dive in and read its Wikipedia description.
- **Star Map:** each period is a constellation, and a star's size follows the
  number of works.

Use **Explore** to filter by period or search for an artist. Click an artist to
open their placard, then **Enter the Gallery**.

### The galleries

- **Every work, in order.** A gallery holds every painting by the artist that
  has an illustrated English Wikipedia article, including frescoes, altarpieces
  and series. Collections of more than 12 works become a suite of rooms with
  the doorways lined up. Each room is signed with its years ("II · 1460 –
  1490"), and a room navigator jumps between them.
- **Real size.** 7,057 works hang at their physical size from their Wikidata
  dimensions. The work with the most Wikipedia pageviews over the last 12
  months gets the far wall.
- **Period rooms.** There are ten room styles: grey stone for gold-ground
  altarpieces, crimson damask for the Baroque, slate blue with ebony frames for
  the Dutch Golden Age, sage silk for the 18th century, deep green for
  Romanticism, peacock blue for the Pre-Raphaelites, grey for the
  Impressionists, charcoal and gold for Klimt's Vienna, off-white for early
  modernism and a concrete white cube for post-war art. Walls, trim, floor,
  ceiling, benches and frames all change with the style.
- **Lighting.** Every work has a track spotlight aimed at it (big works get
  two), under a skylight, with soft wall shadows and a reflective floor.
- **Up close.** Textures get sharper as you walk up to a work. Click it to see
  the story and facts from its article, with the image loaded at up to 3840 px
  and the image's author and licence.
- **Music.** Each period plays freely licensed recordings from Wikimedia
  Commons, credited on screen. **M** mutes it.

### Works still in copyright

849 works are still in copyright, including much of Picasso's later work,
Dalí, Magritte, Pollock and Warhol. They hang like every other work, with the
image Wikipedia shows for them and **"© In copyright"** on the wall label and
in the inspect view. Where Wikipedia has no image of the work (167 works), a
© placard with the title, year and a link to the article hangs in its place.

This is a non-commercial, educational project built from Wikipedia.
**Rights holders:** if you'd like an image removed, open a
[takedown request](https://github.com/justdataplease/art-history-museum/issues/new?template=takedown-request.yml)
and we'll withhold it promptly. The work keeps its place as a © placard (see
[`src/lib/takedowns.ts`](src/lib/takedowns.ts)).

## Data: all from Wikipedia

Every period description, artist bio, portrait, painting, date, story and fact
is pulled from **English Wikipedia, Wikidata and Wikimedia Commons** by the
ingest scripts. None of it is written by hand and none of it is AI-generated.
Stories are article leads and facts are sentences quoted from the articles.

- The artists and periods are listed by name in
  [`scripts/seed.ts`](scripts/seed.ts).
- Works come from Wikidata (creator plus a painting type) and from each
  artist's "Paintings by …" category on Wikipedia. Artists with few articles
  but many free images also get their best Commons images. Articles that
  aren't about an artwork (biographies, buildings, lists) are filtered out.
- Enrichment adds physical size, 12-month pageviews, Wikidata ids and checked
  dates (Wikidata's preferred dates, and the article's own year when Wikidata
  only knows the decade).
- Every image carries its author, licence and file page. Images on Commons are
  free. Files on English Wikipedia are checked for the `NonFree` flag, and
  every work by an artist still in copyright is labelled "© In copyright".

The snapshot is committed in [`data/cache/museum.json`](data/cache/museum.json),
so the app runs without network access to Wikipedia or a database.

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
# data/cache/artists, and --refresh re-fetches them all.
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

With `WIKI_HTTP_CACHE=<dir>` the scripts keep Wikipedia's API responses on
disk, so a second run doesn't ask Wikipedia again.

`load-db` fills staging tables and swaps them in with one short transaction,
so it can run against a live database. Every gallery is prerendered at build
time and refreshed hourly.

## Controls

| Where | Input | Action |
|---|---|---|
| Timeline | scroll / pinch, drag | zoom through time, pan |
| Timeline | arrows, + / −, 0 | pan, zoom, reset |
| Timeline | click a period | dive into it |
| Timeline | click an artist (or Tab + Enter) | placard, then Enter the Gallery |
| Gallery (desktop) | click "step inside" | capture the mouse |
| Gallery (desktop) | W A S D / mouse | walk / look |
| Gallery (desktop) | Space | jump |
| Gallery (desktop) | C / Ctrl | crouch |
| Gallery | [ ] or Page Up / Page Down | previous / next room |
| Gallery | click a painting | inspect (scroll to lean in, Esc to step back) |
| Gallery (touch) | drag | look |
| Gallery (touch) | tap floor / tap painting | walk there / inspect (pinch to lean in) |
| Gallery | M | music on / off |

## How it's built

- **Next.js 16** (App Router). The timeline and all 342 galleries are
  prerendered; data comes from the JSON snapshot or Postgres.
- **React Three Fiber / three.js** galleries that only render when something
  changes (`frameloop="demand"`), so standing still costs no frames.
- **Suites** draw only what you can see: the neighbouring rooms, the works near
  you, and a fixed pool of 16 spotlights handed to the works in view, so
  walking never recompiles a shader. Textures load in steps as you get closer
  (thumbnail, wall, close-up, inspect).
- **Images** load straight from Wikimedia's servers at fixed thumbnail widths
  ([`src/lib/img.ts`](src/lib/img.ts)), retrying if Wikimedia is busy.

## Performance

Measured with `node scripts/perf-probe.mjs <slug> <baseUrl>` on a production
build (October 2026; headless Chrome, ANGLE/D3D11 on an RTX 4070, 1600×900).
Draws and framebuffer binds are per rendered frame while walking; suites are
walked end to end, so they show a range. Every shader program is linked behind
the entry doors, and none is added on the walk.

| Gallery | Rooms | Draws / frame | FB binds | Idle frames | Programs | Images at doors → after full walk |
|---|---|---|---|---|---|---|
| Vittore Carpaccio | 1 | 69 | 7 | 0 | 28 | 3.8 MB |
| Caravaggio | 7 | 16–105 | 7 | 0 | 28 → 28 | 2.2 → 24.9 MB |
| Titian | 16 | 19–89 | 7 | 0 | 28 → 28 | 2.9 → 59.2 MB |
| J. M. W. Turner | 16 | 20–107 | 7 | 0 | 28 → 28 | 1.9 → 38.5 MB |

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
- `node scripts/record-demo.mjs [baseUrl] [out.mp4]`: records the one-minute
  tour.

## Contributing

Missing an artist or a painting? Found a bug? See
[CONTRIBUTING.md](CONTRIBUTING.md). In short: content comes only from
Wikipedia, so fixes go into the ingest or the seed list, never into the data by
hand. If a work is missing, its Wikidata entry usually lacks a creator or a
painting type, and fixing it there brings it in on the next ingest.
[TODO.md](TODO.md) lists the open work.

## Licence and credits

Code: [MIT](LICENSE). Content keeps its own licences ([NOTICE.md](NOTICE.md)):

- Text from English Wikipedia,
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Every
  artist and work links to its source article.
- Images from Wikimedia Commons and Wikipedia, each under the licence on its
  file page and credited in the gallery. Images of works still in copyright
  belong to their rights holders; they're shown as on Wikipedia, for
  education, and withheld on request.
- Music from Wikimedia Commons: public domain, CC0, CC BY and CC BY-SA
  recordings, credited in the gallery and in
  [`public/audio/CREDITS.md`](public/audio/CREDITS.md).

Thanks to the Wikipedia, Wikidata and Wikimedia Commons communities, and to
the musicians who released their recordings freely.

**All credit goes to Wikipedia.** This museum exists because volunteers wrote,
photographed and catalogued all of it and gave it away. Free knowledge keeps
democracies strong. If the museum is useful to you, please
[support Wikipedia](https://donate.wikimedia.org/).
