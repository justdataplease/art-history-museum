# Contributing

Thanks for helping build a museum of art history. Bug reports, missing
artists or paintings, accessibility fixes, performance work and realism
improvements are all welcome.

## The one rule: everything comes from Wikipedia

Every artist bio, painting, image, date, story and fact is pulled from
**English Wikipedia, Wikidata and Wikimedia Commons** by the ingest scripts.
Nothing is written by hand and nothing is AI-generated. If it isn't on
Wikipedia, it doesn't go in. The way to add content is to improve the
ingest or the seed list, never to edit `data/cache/` by hand.

- **Missing artist?** Add their English Wikipedia article title to the right
  period in [`scripts/seed.ts`](scripts/seed.ts) and run the ingest.
- **Missing painting?** Usually the work's Wikidata item lacks a creator
  (P170) or a painting class (P31), or the article isn't in the artist's
  "Paintings by …" category. Fixing that on Wikidata / Wikipedia fixes it here
  for everyone; [`EXTRA_PAINTINGS`](scripts/seed.ts) is the last resort.
- **Copyright:** works still in copyright are labelled "© In copyright" and
  use the image Wikipedia shows. Rights holders can have an image withheld via
  a takedown request (`src/lib/takedowns.ts`).

## Getting started

You need Node.js 20.12 or newer. The browser checks use Playwright with an
installed Google Chrome (they drive real-GPU Chrome); `npx playwright install chrome`
sets one up if you don't have it.

```bash
npm install
npm run dev          # http://localhost:3000, reads data/cache/museum.json
```

The repo ships with a complete ingest snapshot, so you don't need a database
or network access to Wikipedia to work on the app. See the README for the
ingest, the optional Postgres backend and deployment.

If you run the ingest, set `WIKI_USER_AGENT` to your own contact (see
[`.env.example`](.env.example)). Wikimedia's API policy asks every client to
identify itself.

## Before you open a pull request

```bash
npx tsc --noEmit                 # types
npm run build                    # production build (prerenders every gallery)
npm start &                      # then, against the running build:
node scripts/verify-e2e.mjs      # timeline behaviour checks
node scripts/perf-probe.mjs caravaggio http://localhost:3000 mine
```

- Keep the galleries fast: the perf probe's draw calls per frame, framebuffer
  binds and idle frames (should be 0) shouldn't regress. Include the numbers
  for rendering changes.
- For visual changes, attach before/after screenshots
  (`node scripts/shot-museum.mjs <slug> <prefix>`).
- This project uses Next.js 16, whose APIs differ from older versions; check
  `node_modules/next/dist/docs/` before using a Next API.
- Match the style of the surrounding code; keep comments about *why*.

## Reporting bugs

Open an issue with the page URL, browser / GPU, what you expected and what
happened, and a screenshot or console log if you have one.

By contributing you agree that your contributions are licensed under the
project's [MIT licence](LICENSE).
