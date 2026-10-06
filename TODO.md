# Open work

Known gaps and unfinished fixes from the last release review. The release
was cut before these were finished or verified; contributions welcome.

## Data and ingest

- [ ] Re-run the full ingest and enrich so the snapshot picks up every
      pipeline fix (`scripts/repair-data.ts` was in progress).
- [ ] Remove artist-biography and other non-artwork articles that slipped in
      as "paintings".
- [ ] Fix works showing the wrong image (e.g. a Francis Bacon flagship showing
      a Matisse; gallery-room photos standing in for Rothko / Pollock works).
- [ ] Label every work by an in-copyright artist "©": the per-file NonFree
      check misses images that are only PD in the US.
- [ ] Image and portrait credits (author, licence, file page) for every
      image (`ImageCredit` in `src/lib/types.ts`), and show them everywhere.
- [ ] Prefer Wikidata preferred-rank dates and keep date precision
      ("c. 1500", decades).
- [ ] Wrong Wikipedia article resolved for the Symbolism period description.
- [ ] Physical size unit errors (mm vs cm) for some works.
- [ ] Keep the previous cache entry when an artist's fetch fails.
- [ ] Normalise URLs in `src/lib/takedowns.ts` before matching.
- [ ] `fetch-music`: write via temp files; licence URLs in `public/audio/CREDITS.md`.

## Galleries

- [ ] Verify the inspect-panel image credit and the CC BY-SA text-licence line.
- [ ] Retry Wikimedia 429s with backoff instead of leaving a blank canvas.
- [ ] Same reflection probe for every room of 4+ room suites.
- [ ] Room year spans should exclude the flagship overture.
- [ ] Room navigator: phone layout, ARIA / keyboard pass, contrast.
- [ ] Room sign placement and Roman numerals past X; sign atlas memory.
- [ ] Reset the music duck and close the AudioContext on leave.
- [ ] Sizes for works with no Wikidata dimensions; withheld © canvas aspect.
- [ ] `scripts/suite-check.mjs` crashes on the Titian suite.
- [ ] Fill in measured perf-probe numbers in the README.

## Timeline

- [ ] Explore panel stays on-screen on phones.
- [ ] Search ignores punctuation ("O'Keeffe", "J. M. W. Turner").
- [ ] Bottom lane vs footer overlap at laptop sizes; footer note on mobile.
- [ ] Missing Star Map constellation titles; short-period dive zoom.
- [ ] Artist card fits small screens and credits the portrait.
- [ ] Finish the favicon set (SVG icon added; `.ico` sizes pending).

## Release

- [ ] Re-record or remove `demo/museum-demo.mp4` (out of date).
- [ ] Full production build + e2e / error-sweep / perf-probe pass on this
      snapshot (only the type-check was run before release).
