# Open work

What's left before and after the public launch. Contributions welcome.
Ticked items are done and verified.

## Remaining release steps

The full catalogue, local production checks and one-minute tour are
complete. The updated museum is deployed at
https://art-history.artfrompixels.com. GitHub publicity, launch hosting
changes and social posts are deferred at the owner's request. Painters
without any usable sourced works still need more source material.

## Collection: missing artists

Names are checked against Wikidata, Wikipedia articles, Commons images and
links from period articles. A painter with any usable sourced works can get
a room; small catalogues are included too. See the README for the verified
snapshot counts.

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
- [x] Regenerate and verify painters from around the world (18 regions),
      including key names from thin regions. New periods:
      Chinese painting, Japanese painting, Ukiyo-e, Indian painting, Persian
      miniature, Cretan School, Group of Seven, colonial Latin American painting.
- [x] New painting formats in the ingest: scrolls, screens, miniatures,
      icons, thangkas, pastels, gouache; woodblock prints for the ukiyo-e
      masters only.
- [x] Gallery styles and music for the new periods (East Asian gallery,
      print room, miniature cabinet), with locally mirrored recordings.
- [x] Japanese koto recording for the print room: Torsodog's
      CC BY 3.0 recording on Commons, mirrored locally with attribution.
- [x] Add Hilma af Klint, František Kupka and Candido Portinari: the full
      source queries now provide enough works for their galleries.
- [x] Include small catalogues too: Qi Baishi (3 works) and Oskar
      Kokoschka (2). A painter no longer needs five sourced works to be
      included in the seed list.
- [ ] Further artists without usable Wikimedia work records, including
      living post-war painters, still need more source material.

- [x] Complete catalogues for every painter in the seed list: hang every
      sourced painting with a usable image, after the usual quality checks.
      The ingest has no catalogue-size cap or small-gallery gate, and all
      526 artist caches have been regenerated and verified.
- [x] Verify each sourced version in series such as Sunflowers, Olive Trees
      and Les Alyscamps. Remove series headings when individual paintings
      are present, while preserving physical diptychs, triptychs,
      altarpieces and painted screens.

## Data and ingest

- [x] Refresh the full collection through ingest, enrichment and repair;
      verify sourced images, dates, sizes and credits.
- [x] Remove artist-biography and other non-artwork articles that slipped in
      as "paintings".
- [x] Fix works showing the wrong image (e.g. a Francis Bacon flagship showing
      a Matisse; gallery-room photos standing in for Rothko / Pollock works).
- [x] Label every work by an in-copyright artist "©": the per-file NonFree
      check misses images that are only PD in the US.
- [x] Image and portrait credits (author, licence, file page) for every
      image (`ImageCredit` in `src/lib/types.ts`). The artist card and the
      inspect view render the credits from the snapshot.
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
- [x] Star Map: all 35 constellation titles fit 360–430 px phones, with
      viewport-bounded placement and spatial lookup for collision checks.
- [x] Extend the timeline to 900 so early Chinese painters are reachable.
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
- [x] Full production build + e2e / error-sweep / perf-probe / suite-check
      pass on the final snapshot.
- [x] Record the one-minute tour (`npm run build`, then
      `node scripts/record-demo.mjs`): Star Map, Van Gogh, Fra Angelico.
- [x] Commit to `main` (no co-author lines).
- [x] Redeploy the updated museum to Vercel production.
- [x] Push the cleaned git history (Co-Authored-By lines removed from
      `main`; verified against the remote).
- [ ] Make the GitHub repository public; set description, homepage and
      topics; turn on private vulnerability reporting.
- [ ] Hosting for launch day: Vercel Pro for the month, or serve the music
      from Commons, so a traffic spike can't pause the site.

## Cleanup (before release)

- [x] Audit route bundles, remove unused exports and the unused dotenv
      dependency, and share the Wikimedia file helper. Remove the room cap
      and repeated catalogue scans; bound portal culling to mounted rooms
      and simplify aligned-door path distances. Compare visibility,
      texture tiers and lighting against the previous runtime.
- [x] Audit unused files, scripts and oversized assets. Verification output
      and the resumable HTTP cache stay ignored; reports are excluded from
      deployment. The tracked music and tour are intentional assets.

## Launch

- [x] Final numbers into the local Hacker News and LinkedIn drafts.
- [ ] Hacker News: Wednesday or Thursday, 15:30 Greek time (08:30 New York);
      answer comments for the first 2–3 hours.
- [ ] LinkedIn: the same day, 09:00–10:00 Greek time.
