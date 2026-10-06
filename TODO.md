# Open work

What's left before and after the public launch. Contributions welcome.
Ticked items are done and verified.

## Next session: start here

1. Finish the worldwide ingest. `scripts/seed.ts` already has the new
   periods and painters and `scripts/lib/wiki.ts` the new painting formats,
   but `data/cache/` hasn't been regenerated with them yet (it is still the
   verified 342-artist snapshot). Run the ingest, then `npm run repair-data`,
   and vet Mughal/Persian/East Asian images (no book covers, bindings,
   calligraphy-only pages, seals or box lids).
2. Complete catalogues for the top masters (below).
3. Re-fit the timeline for the bigger collection, then the cleanup passes.
4. Final build and checks, record the video, commit and deploy.

## Collection: missing artists

Added 109 artists (now 27 periods, 342 artists, 8,376 works).
Checked against Wikidata (painting articles with an English Wikipedia
article, Commons images, sitelinks, links from the period articles), not from
memory. An artist needs at least 5 works on Wikipedia to get a room.

- [x] Add the 76 "tier A" painters any survey covers, e.g. Ghirlandaio,
      Crivelli, Campin, Hugo van der Goes, Cima da Conegliano, Orazio
      Gentileschi, Salvator Rosa, Fabritius, Stubbs, Greuze, Benjamin West,
      Gilbert Stuart, Landseer, Rosa Bonheur, Henry Ossawa Tanner, Liebermann,
      Zorn, Hammershøi, Ensor, Nolde, Metzinger, Gleizes, Balla, Leonora
      Carrington, Bellows, Joan Mitchell, Dubuffet.
- [x] Add painters with few articles but large free image sets, e.g. Ruysch,
      Avercamp, Hobbema, Mucha, Redon, Hodler, Vuillard, Dufy, Jawlensky.
- [x] New period: Mexican muralism (Rivera, Siqueiros, Tamayo). Art Deco
      would have had one artist, so Tamara de Lempicka hangs with Cubism.
- [x] Fix the wrong QID in `PAINTING_CLASSES` (Q1404472 is "Italian
      Renaissance", not "group of paintings").
- [ ] Painters from around the world (seed and formats ready, ingest not run yet) (data-backed, 18 regions): all 133
      tier A plus key names from thin regions (about 190). New periods:
      Chinese painting, Japanese painting, Ukiyo-e, Indian painting, Persian
      miniature, Cretan School, Group of Seven, Cusco School.
- [x] New painting formats in the ingest: scrolls, screens, miniatures,
      icons, thangkas, pastels, gouache; woodblock prints for the ukiyo-e
      masters only.
- [x] Gallery styles and music for the new periods (East Asian gallery,
      print room, miniature cabinet), with locally mirrored recordings.
- [ ] Japanese shamisen / koto recording for the print room (none freely
      licensed on Commons yet; it borrows the East Asian list).
- [ ] Famous but not hangable yet (no free images and fewer than 5 articles):
      most living post-war painters, plus Hilma af Klint, Kupka, Qi Baishi,
      Kokoschka, Portinari. Improving their Wikidata entries would bring them in.

- [ ] Complete catalogues for the top masters (about 40: Van Gogh,
      Rembrandt, Monet, Vermeer, Rubens, Titian…): hang every painting
      Wikidata lists with a free Commons image, museum-held works first,
      after the usual quality checks. Today works without their own article
      are capped at 100 per artist, so Van Gogh hangs only 9 of the
      Kröller-Müller's 95 paintings (The Sower, Still Life with a Plate of
      Onions, Haystacks in Provence, The Good Samaritan… are missing).
      Everyone else keeps the current limit.
- [ ] Series articles (Sunflowers, Olive Trees, Les Alyscamps) hang one
      version; the complete catalogues should hang each museum's version.

## Data and ingest

- [x] Re-run the full ingest and enrich so the snapshot picks up every
      pipeline fix (`scripts/repair-data.ts`).
- [x] Remove artist-biography and other non-artwork articles that slipped in
      as "paintings".
- [x] Fix works showing the wrong image (e.g. a Francis Bacon flagship showing
      a Matisse; gallery-room photos standing in for Rothko / Pollock works).
- [x] Label every work by an in-copyright artist "©": the per-file NonFree
      check misses images that are only PD in the US.
- [x] Image and portrait credits (author, licence, file page) for every
      image (`ImageCredit` in `src/lib/types.ts`). The artist card and the
      inspect view already render them; the data doesn't carry them yet.
- [x] Prefer Wikidata preferred-rank dates and keep date precision
      ("c. 1500", decades).
- [x] Wrong Wikipedia article resolved for the Symbolism period description.
- [x] Physical size unit errors (mm vs cm) for some works.
- [x] Keep the previous cache entry when an artist's fetch fails.
- [x] Normalise URLs in `src/lib/takedowns.ts` before matching.
- [x] `fetch-music`: write via temp files; licence URLs in `public/audio/CREDITS.md`.

## Galleries

- [x] Inspect-panel image credit and the CC BY-SA text-licence line.
- [x] Retry Wikimedia 429s with backoff instead of leaving a blank canvas.
- [x] Same reflection probe for every room of 4+ room suites.
- [x] Room year spans exclude the flagship overture.
- [x] Room navigator: phone layout, ARIA / keyboard pass, contrast.
- [x] Room sign placement and Roman numerals past X; sign atlas memory.
- [x] Reset the music duck and close the AudioContext on leave.
- [x] Sizes for works with no Wikidata dimensions; withheld © canvas aspect.
- [x] `scripts/suite-check.mjs` crashes on the Titian suite.
- [x] Jump (Space) and crouch (C / Ctrl) in first person.
- [x] Room signs, wall labels and light fixtures take surface effects like
      the walls do.
- [x] Measured perf-probe numbers in the README.
- [x] Gallery era, theme and music for the new periods.

## Timeline

- [x] Re-fit the layout for the bigger collection (Cubism band vs the footer;
      one Star Map title on 1280–1366 px screens).

- [x] Explore panel stays on-screen on phones.
- [x] Search ignores punctuation ("O'Keeffe", "J. M. W. Turner").
- [x] Bottom lane vs footer overlap at laptop sizes; footer note on mobile.
- [x] Star Map constellation titles on desktop; short-period dive zoom.
- [ ] Star Map: 6–8 constellation titles still dropped on phones (≤ 390 px).
- [x] Artist card fits small screens and credits the portrait.
- [x] Favicon set (SVG icon and 16/32/48 px `.ico`).
- [x] "Made with ♥ by justdataplease.com" in the footer.
- [x] "All credit goes to Wikipedia" on the home page and every gallery's
      start screen.
- [x] "Free knowledge keeps democracies strong. Donate to Wikipedia" (links to
      donate.wikimedia.org) in the footer and README.

## Release

- [x] Custom domain: https://art-history.artfrompixels.com
- [x] Rename the repository to justdataplease/art-history-museum.
- [x] Point the README, package.json homepage and repo homepage at
      https://art-history.artfrompixels.com.
- [x] Plain-language pass on README / CONTRIBUTING (no em dashes, no
      marketing tone) with the final counts.
- [ ] Full production build + e2e / error-sweep / perf-probe / suite-check
      pass on the final snapshot.
- [ ] Record the one-minute tour (`npm run build`, then
      `node scripts/record-demo.mjs`): Star Map, Van Gogh, Fra Angelico.
- [ ] Commit to `main` (no co-author lines) and redeploy to Vercel.
- [ ] Push the cleaned git history (Co-Authored-By lines removed; ready in
      the scratch rewrite, needs a force-push the owner runs or allows)
      before the repository goes public.
- [ ] Make the GitHub repository public; set description, homepage and
      topics; turn on private vulnerability reporting.
- [ ] Hosting for launch day: Vercel Pro for the month, or serve the music
      from Commons, so a traffic spike can't pause the site.

## Cleanup (before release)

- [ ] Efficiency pass: bundle size per route, unused exports and
      dependencies, duplicate helpers across scripts, dead code paths.
- [ ] Junk pass: unused files and assets in the repo, stale scripts, local
      test output (verify-artifacts/, scratch builds), oversized files.

## Launch

- [ ] Final numbers into the Hacker News and LinkedIn posts.
- [ ] Hacker News: Wednesday or Thursday, 15:30 Greek time (08:30 New York);
      answer comments for the first 2–3 hours.
- [ ] LinkedIn: the same day, 09:00–10:00 Greek time.
