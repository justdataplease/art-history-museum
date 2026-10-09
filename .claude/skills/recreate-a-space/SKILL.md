---
name: recreate-a-space
description: Create a new space in the museum, or recreate a real museum, from research and photos. Search the web for the real building's floors and sections, look at photos of its rooms to choose each floor's room style, wall colour, floor (marble, stone, oak, parquet), light and furniture, choose the paintings we hold for each floor, then add it to src/lib/museum-rooms.ts and check it in a headless browser against the photos. Use when the owner says "create a new space", "recreate <museum>", "make it like the real <museum>", "a room like <place>", or that a recreated museum does not look like the real one.
---

# Recreate a space

A recreated museum is an ordinary custom room (`src/lib/room-query.ts` `Selection`): the works the museum holds,
hung on its own floors, each floor with its room style, wall colour, floor material, size and wall text, joined by
the elevator. `src/lib/museum-rooms.ts` holds them (`/museums/<slug>`); the National Gallery of Greece (floors
−2, 1, 2 on white marble), the Rijksmuseum and the Louvre are worked examples. Nothing here changes the
architecture: no images are stored on our server, no Postgres; it is code plus the existing
`data/site/rooms.json` index.

## 1. Research the real place (web)

Load `WebSearch` and `WebFetch` (ToolSearch `select:WebSearch,WebFetch`); a background `general-purpose` agent
does this well while you work (ask it for a floor table with sources, and for 6-10 interior photo URLs). Search
in English and in the museum's own language. Sources, best first: the museum's own site (floor plan, "permanent
collection", visitor guide PDFs), a photo of its lobby's floor directory, Wikipedia in both languages, press on
the latest rehang, guide blogs. Collect, with a URL for each claim, and mark what is uncertain:

- the floors and how the museum numbers them (0 or 1 for the ground floor, basements as −1, −2), what is on each:
  permanent collection, temporary shows, café, shop, closed floors (only collection floors become floors here);
- the sections in visiting order: title, years, schools or nationalities, key artists and signature works;
- the look, floor by floor (step 2).

## 2. Look at the rooms (photos)

Find 6-10 photos of the galleries as they are now: Wikimedia Commons first (`Category:<museum> - Interior` and
the like; use the `/thumb/.../1280px-` file), else press photos. Fetch them with `curl -A "<project UA>"` into a
folder of the session scratchpad only (never the repo, never the bucket), two or three at a time with a few
seconds between (Commons answers 429 when hurried), view each with Read, and delete the folder when done. Never
publish them. For each floor note:

- wall colour (estimate a hex; the renderer's spots darken a wall, so pick a little lighter than the photo);
- floor: white marble, stone slabs, light or dark oak boards, herringbone parquet (`GROUNDS` in
  `src/components/museum/theme.ts`; `ground` on the room or on a floor of the plan);
- ceiling and light (skylight, vault, lightbox, track spots, daylight), free-standing walls, how dense the hang is;
- seating: compare with the room style's furniture set (`src/components/museum/furniture.ts`, `/furniture` in
  development shows every piece) and add the piece you see to that set when it is missing (the curved leather
  bench came from Athens);
- then choose the nearest room style (`ROOM_STYLES`: museum, palace, salon, northern, nineteenth, early-modern,
  postwar ...). When nothing fits, add a style or a floor kind the way "palace", "salon" and "marble" were added
  (`theme.ts`, `room-floor.tsx`), not a one-off.

## 3. Check what we hold

The room can only hang works in our index that have an image. Count the museum's works by decade, artist and
nationality from `data/site/rooms.json` (`museums` gives the id and position; each work is
`[artist, painting, era, period, movement, genre, year, pageviews, museums]`; `artists[slug].nationalities`) with
a short Python script. Plan the floors around what is there: a floor of the real museum with almost nothing of
ours merges with its neighbour (say so in its wall text) rather than standing empty.

### When the museum's works are thin here, fill them in per artist

A recreation is only as rich as our holdings: the room hangs works of the site's artists (`scripts/seed.ts`), and
an artist who is not on WikiArt has only what Wikidata links to them (the National Gallery of Greece first came
out at 67 works of its roughly 300 on Commons: Rizos, Prosalentis and Roilos had one work each). Measure before
writing the room:

- the museum on Wikidata: a SPARQL query for works with `wdt:P195 wd:<museum QID>`, with their `P18` image and
  the creator's `P570` death date (public domain: died more than 70 years ago, before 1956 in 2026);
- the museum on Commons: walk `Category:Paintings in <museum>` (and its subcategories) and list the painters;
- per painter, our gallery (`data/site/museum.json`: works with an image) against their Commons category
  (`Category:Paintings by <name>`).

Then the existing process does the rest (metadata only; the images stay on Commons):

- add the museum's Commons category to `MUSEUMS` in `archive/commons.py`: `python -m archive.commons fetch` reads
  each photograph's painter from its categories or its name, keeps whole paintings by public-domain painters
  (no details, exhibition views or close-ups; several photographs of one painting hang once, told by image), and
  `archive.site` hangs those none of the painter's works already, marking the ones it already has as held by the
  museum (rooms.json `museums`). The same fetch tops up every thin gallery (under 25 works) from the painter's
  own Commons category;
- give titles in another language an English one in `archive/commons_titles.json` (Commons file -> title);
- painters it names as "not ours", and the museum's Wikidata creators we lack (the SPARQL above), are not on the
  site: add their English Wikipedia title (or "el:<title>" for a Greek article only; check the article is the
  painter, not a namesake) to the right period's `artists` in `scripts/seed.ts`, then `npm run ingest -- --new`,
  `archive.wikidata artists`, `archive.wikidata works` and `archive.warehouse build` (nationalities for the
  floors' `who`, collections for the museum). They get a gallery on the timeline too, and the Commons fetch
  fills it;
- died after 1955: they stay out, their works are still in copyright here.

Rebuild: `archive.site` (so the new painters are on it), `archive.commons fetch`, `archive.site` again,
`archive.guide build`, `archive.phases`, and count again.

A work hangs on the first floor of the plan whose years and nationalities (`who`) hold it, so a floor kept for
foreign schools (`who: ["Flemish", "French", ...]`) can come first; leave out a nationality that also matches a
home artist (El Greco is "Spanish" too). An undated work goes to a floor without years, else to the floor of its
artist's middle year. Key works go in `include` as `artist/painting` keys; `@N` pins one to the plan's N-th floor.

## 4. Write it

In `src/lib/museum-rooms.ts`, following the existing entries:

- a header comment: what the real building is like, floor by floor, and the sources;
- a `Partial<Selection>`: `title`, `museums`, `style`, `wall`, `ground`, `max`, `floors: "plan"`, `intro` (our
  own words, never copied text), `plan: [floor({ label, number, from, to, style, wall, ground, works, intro, who
  })]` in the elevator's order (bottom to top), `include`. `number` is the museum's own floor number (−2, 1, 2
  ...; or `firstFloor` when they run on from it); `works` per floor, or it gets an even share of `max`;
- an entry in `MUSEUM_ROOMS` (`slug`, `name`, `city`, a one-line `note`, `query: room(SEL, n)` with `n` the plan
  floor that is the museum's entrance floor).

Labels are the section's name ("From El Greco to 1900"; the elevator and title add "Floor 1 ·"); wall texts are
one or two short sentences.

## 5. Check it

Headless only, with `requestPointerLock` stubbed (never take the real cursor): open `/museums/<slug>`, wait for
`.mus-click-to-start`, step in; for each floor (`&f=N`) read `window.__museum.layout` (rooms, works, furniture)
and the title card, press H to hide the controls, and take screenshots looking down the first room, at the floor
up close and at a bench. Compare them with the photos from step 2 and adjust the colours, floor and split. Run
`npx tsc --noEmit -p .` and the room tests.

Commit and deploy only when the owner asks (main, no co-author lines; deploy with `npx vercel deploy --prod
--yes` from this machine).
