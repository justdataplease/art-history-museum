# Plan v2: after the Show HN launch

Written 2026-10-07, the day after "Show HN: A walkable 3D art history museum
built from Wikipedia" (126 points, 58 comments). Every suggestion from the
thread is listed below, ordered from easiest to hardest. The full thread is
kept verbatim at the end of this file.

Effort is a rough single-developer estimate. Impact is how many commenters
asked for it, or how much it matters if left alone.

## Status for the thread (2026-10-09)

`[x]` done · `[ ]` **In progress** · `[ ]` not started. "Live" is on artfrompixels.com now; "local" is built
and tested, and goes live with the next deploy. Owner decisions (2026-10-09): no images stored on our server for
now, no Postgres, keep the architecture as is (the JSON snapshot on Vercel).

- [x] **1. Re-lock the mouse after closing a painting** (alexpatin). Live.
  - [x] Closing a painting with ✕ takes the cursor straight back: walk on at once.
  - [x] Esc out of a painting leaves only a small "click, or press W, to walk on" prompt, not the full card.
  - [x] W (or any walk key) takes the cursor back.
  - [x] A click on the room beside the painting's panel closes it too and walks on.
- [x] **2. Walk speed setting** (tamacun3). Local.
  - [x] Settings (O, or the Settings button): Slow 1.3 m/s, Normal 2.0 m/s, Fast 3.1 m/s, kept in the browser.
  - [x] The default is slower (2.0 m/s, was 3.1); holding W still runs at twice the pace.
  - [x] Tap-to-walk on phones follows the same setting.
- [x] **3. Switch off the canvas effect** (frmfrm). Local.
  - [x] Settings → Canvas surface → "Plain image": no linen weave, no varnish sheen, matte.
  - [x] "View the original image" in the painting's panel: the file itself, flat on the screen, no room light.
- [x] **4. Hide the on-screen controls** (jamilton). Local.
  - [x] H (desktop), or "Hide controls" (phones), or Settings: hides the title, room navigator, hints, audio
    guide and music buttons; one faint "Show controls" button stays.
  - [ ] A more compact HUD by default below about 400 px wide.
  - [ ] Checked on a 360 × 640 phone, iOS Safari and Firefox.
- [x] **5. Explain the timeline in DEVELOPMENT.md** (cobertos). Local.
  - [x] "The timeline" section: no charting library (React, plain DOM and SVG), one zoom-and-pan state, culling
    off-screen rows and stars, label placement without overlaps.
  - [ ] Timeline frame-time numbers (none recorded yet; the section says how to measure them).
- [x] **6. "Next artist" door at the end of each gallery** (d--b, tamacun3). Local.
  - [x] Two lit doors in the end wall of every artist's gallery: the artist before on the left, the artist after
    on the right, in the timeline's order, each named on a card over it. Walking into one goes through it.
  - [x] In the last room: buttons for both, Q / E, and "Surprise me" (a gallery from another period).
  - [x] The galleries behind the doors load while the visitor walks the last room.
- [x] **7. Host the images ourselves** (Sophira). Not now, by decision: images keep loading from Wikimedia and
  WikiArt; every source link is kept in the warehouse for when we do.
  - [ ] Mirror the thumbnails to our own storage behind a CDN.
- [x] **8. Fuzzy search, country and continent filters** (mariotacke). Local.
  - [x] Typo-tolerant artist search in Explore: "Vermer" finds Vermeer, "rembrant" Rembrandt, "carravagio"
    Caravaggio, "picaso" Picasso; exact matches first, then "≈ Close matches".
  - [x] Continent chips and a country menu under the search box, with counts, combined with the search: every
    artist has a country (from Wikidata nationality and citizenship, today's country for historical states).
  - [ ] Search paintings by title.
- [ ] **In progress: 9. More detail about each work** (criddell). Local.
  - [x] "About this work" in the painting's panel: tags for its era, period, movement, school, genre and the
    artist's country, and the museum that holds it.
  - [x] The artist's works before and after it (a click flies to them).
  - [x] What other artists painted the same year ("Painted the same year, 1660: … by Rembrandt").
  - [ ] Wikipedia's History / Provenance / Interpretation sections as tabs.
  - [ ] Depicts, commissioned by, provenance events from Wikidata.
- [ ] **In progress: 10. Museum-style galleries** (luxcem, AIblemblio, crazygringo, owner). Live.
  - [x] a. Rooms of many artists side by side, by era, period, movement, school, genre, country, years or museum
    (`/rooms`), shareable by link, saved in "My rooms".
  - [ ] b. An introduction room for each era (wall text, events, map, who's who).
  - [x] c. Ready-made themed rooms (The Sea, Self-portraits, Baroque portraits ...) and real collections
    recreated: the Louvre, the Rijksmuseum, the National Gallery of Greece (rebuilt from its floor plan and photos:
    European painting on −2, El Greco to 1900 on floor 1, the 20th century on floor 2, pale halls on white marble,
    curved leather benches). A skill (`.claude/skills/recreate-a-space`) recreates any museum the same way: web
    research, photos of its rooms, the works we hold.
  - [ ] c. "See this subject across time" from a painting.
  - [x] d. Rooms designed per case: 16 room styles (palace gallery, grand salon, a museum of today ...), period
    seating different in every room, rope barriers at the most famous works.
  - [x] d. The floor is a choice of its own, for a room or for each of its floors: white marble, stone slabs,
    light or dark oak boards, herringbone parquet.
  - [ ] d. Room shapes (octagon, rotunda, chapel) and props (tatami, vitrines).
- [x] **11. Rooms by phase of an artist's life** (AIblemblio). Local.
  - [x] Galleries split their rooms at the phases of the artist's life, each room named after its phase on its
    sign and in the room navigator: Picasso's Early Years, Blue, Rose, African, Cubist, Neoclassicist &
    Surrealist and Later Years; Dalí, Magritte, Gauguin, Cézanne, Munch, El Greco, Klimt, Renoir, Bruegel and
    more: 16 artists, from WikiArt's periods (`archive/phases.py`).
  - [ ] Hand-written phases for the other Featured artists (Van Gogh's Nuenen, Paris, Arles, Saint-Rémy).
  - [ ] A room design of its own for each phase.
- [x] **12. Raw-source store** (own reply). Live (data side).
  - [x] A DuckDB warehouse with Parquet copies in the bucket: every source kept, our own format on top.
  - [ ] Postgres: not now, by decision.
- [ ] **13. High resolution and deep zoom (IIIF)** (seemaze, groby_b, _joel, dmje, Soliddune16). Not started.
- [ ] **In progress: 14. More artists and works** (ggerules). Live.
  - [x] WikiArt crawled: 18,328 public-domain works only WikiArt has now hang in their artists' galleries.
  - [x] 60 Greek painters added; the gaps of every national school ranked (`compare.candidates`).
  - [ ] Write to WikiArt for Academic API access.
  - [ ] Museums' open-access collections.
- [x] **15. Audio guide** (justkat91, criddell, own reply). Live.
  - [x] G cycles: famous works (starts by itself at them), every work, off; captions on screen.
  - [x] A script per artist and per work: what you see in the picture first, then its story.
  - [x] A natural voice: Kokoro (a neural text-to-speech model) runs in the visitor's browser on WebGPU, about
    330 MB downloaded once, only when the visitor chooses Natural (Auto reads with the browser's best voice, and
    with the natural one once it is on the device). Settings → Audio guide: the voice,
    five natural voices, the browser's voices, a reading speed (0.85× to 1.5×) and "Hear it". Live 2026-10-09.
  - [ ] Recorded narration in place of the browser's voice.
  - [ ] Greek names said the Greek way (the voices are English).
- [x] **Painters on film** (owner, 2026-10-09). Live.
  - [x] `/cinema` and `/cinema/<painter>`: a 1950s cinema with a projector whose beam, dust and light on the
    room follow the film; the house lights dim when it plays. "▶ Films" in a gallery's top bar, "Cinema" on
    the timeline.
  - [x] The films are the ones the painters' Wikipedia articles link, in 21 languages (`archive/films.py`):
    Commons files, ERT's archive (Greek public television), the Internet Archive, YouTube, Vimeo, Dailymotion.
    364 films about 190 painters (154 with a gallery, 36 Greek painters without one). Video sites play in
    their own player on the screen; Commons, ERT and the Internet Archive are projected and light the room.
  - [ ] The other 476 painters: Wikidata's film records add one, Commons categories a few; a YouTube search
    (an API key) would find the rest.
- [ ] **16. A connected museum you can get lost in** (tamacun3, d--b, AIblemblio).
  - [x] Step 1: doors between artists (item 6).
  - [ ] Rooms that turn corners, period wings, streaming, a minimap.
- [ ] **17. VR (WebXR)** (albertodenia, hudecekdev). Not started.
- [ ] **18. Social museum** (crazygringo). Not started.
  - [x] Step 1, shareable exhibitions: a custom room is its link.
- [ ] **19. A Greek history museum on the same engine** (own reply). Not started.
- [x] **Climbing on benches** (whycombinetor). Live: Space jumps onto benches and you can walk along them; C sits
  in a chair or on a bench. The Vandalism easter egg (P) is still there.
- [ ] Optional: a "Prior art and inspiration" line in the README (aogaili, bawolff).

## Direction (owner, 2026-10-08)

- **The end concept:** one museum built from Wikipedia and WikiArt together, held in our own format in DuckDB
  (Postgres later), with links to every source for each work and room for more sources (museums via IIIF).
  Wikipedia, Wikidata and Commons are the base (texts, licences, sizes, the sharpest images); WikiArt adds
  coverage and categories. Full resolution up close, small images from far away.
- **Our own structure:** our taxonomy (movements, schools, genres, periods, themes) is what rooms are built
  from, not any one source's categories.
- **Coverage gaps are not only Greek:** German, Portuguese and other national schools are thin too. Nationality
  and school are facets of the taxonomy (filters, rooms, exhibitions), not timeline sections; artists join the
  period of their movement. `compare.candidates` ranks the missing public-domain artists of every nationality.
- **Featured stays a separate tier** (the most influential painters), now also in the warehouse.
- **Custom rooms** the way museums hang them (item 10) come next, built on the taxonomy.

## Progress

2026-10-08: the data archive is in place (`archive/`, `dagster/`, see `archive/README.md`):
- `data/cache/` is now `data/wikipedia/`; WikiArt is crawled into `data/wikiart/`.
- A local Dagster (`run_dagster.cmd`, port 3080, the scrape-cars setup) runs the crawls into
  `gs://museum-archive`.
- Item 7 (host the images) is on hold by decision: the site keeps loading from Wikimedia and WikiArt; every
  link is kept in the warehouse (`wikipedia.media`, `catalogue.work_sources`). About 2,000 files were copied
  to the bucket before the pause.
- Item 12 is done as a DuckDB warehouse (`data/museum.duckdb`, plain types, `to-postgres` copies it) with
  Parquet copies in the bucket. `catalogue.*` is our own format: every artist and work across sources, with
  life facts from Wikidata for rooms themed on an artist's life.
- 60 Greek painters added to the seed list in the periods of their movements; the Cretan School section
  became "Cretan & Ionian Schools" (to 1830). Yannis Gaïtis hangs with his catalogue raisonné, released on
  Commons under CC BY-SA 4.0 by his family. The site's snapshot (`data/site/museum.json`, `python -m
  archive.site`) adds the works only WikiArt has for public-domain artists.
- Item 14 has started: the full WikiArt crawl (5,751 artists, about a day) and `compare.missing_artists` /
  `compare.category_coverage`. A first match found 464 of our 526 artists on WikiArt.
- Item 10 groundwork: our own taxonomy in `data/taxonomy/` (movements, schools, genres, our periods, and themes
  to add), mapped from WikiArt's categories. Rooms will select works by these terms. WikiArt's artist periods
  (Blue Period, ...) are in `wikiart.artist_periods` for item 11.
- Item 10 backbone, the same day: the taxonomy is now one tree, curated by hand and checked against Wikidata.
  - It has 8 eras (Antiquity to post-war) and 5 traditions (East Asian, South Asian, Islamic, Byzantine,
    colonial Latin American).
  - Under them sit the 35 timeline periods, then 124 movements plus umbrellas and dynasty styles, then 133
    schools, groups, academies and exhibitions with places and years. A separate genre tree follows the
    academic hierarchy.
  - About 250 terms carry a verified Wikidata ID.
  - WikiArt's per-painting styles, its artist movements and schools, and Wikidata's movements and genres all
    map onto it.
  - Every artist and painting has a main movement, period and era (`catalogue.artist_placement`,
    `work_placement`), weighed from both sources.
- One painting, both sources: `compare.work_match` pairs our works with WikiArt's one to one. It uses
  Wikidata's WikiArt ID first, then image fingerprints (titles often differ only by language), then title and
  year. Wikidata facts per work (type, material, collection, genre, depicts) are in `wikidata.work_facts`.
  Metadata only; images still load from the sources.
- The base is Wikipedia / Wikidata / Commons; WikiArt fills gaps and gives each painting its style.
  - `catalogue.works` resolves every field and names its source (`<field>_source`).
  - A WikiArt-only work moves onto Wikidata and Commons when the artist's Wikidata works include it
    (`compare.wikiart_to_wikidata`; 157k Wikidata items by our 573 artists). It then hangs with its Wikidata
    item and the Commons image, author and licence.
  - Wikidata's type ("print", "drawing") also drops prints WikiArt files as paintings.
  - Custom rooms and the audio guide (items 10 and 15, first versions):
  - `/rooms` picks a room: era, period, movement, school or group, genre, country, artists, years, words in the
    title, size, or a ready-made one (The Sea, Self-portraits, Baroque portraits ...). It shows a live count.
  - `/room?...` hangs it: works by many artists, each labelled with its artist, ranked by fame with a fair share
    per artist, then hung by year. The link is the room (Share copies it; Edit room returns to the picker).
  - Rooms are configurable, and the configuration is in the link too. A visitor can choose:
    - a room style (any of the 16: the era rooms, e.g. crimson damask or the white cube, a museum of today,
      a palace gallery, a grand salon) and a wall colour;
    - the hanging order (by year, by artist, or best known first);
    - a floor per era, or one floor;
    - an introduction shown at the doors.
  - The picker previews every work that will hang. Leaving one out brings in the next best, and the link
    remembers it.
  - "My rooms" keeps the rooms a visitor made or shared, in their browser, to open, edit or share again.
    A public list of shared rooms needs a database: item 18.
  - A room that spans eras gets a floor per era, joined by an elevator: a real one, in the entrance wall beside
    the doors (`Elevator.tsx`), with call buttons (up where there is a floor above, down where there is one
    below), a floor indicator and a floor directory. At it, E / Q or a click on its buttons calls the car: the
    button lights, a chime, the doors open, and the next floor opens on the elevator's sliding doors with the
    visitor stepping out of it. Elsewhere E walks to it.
  - The audio guide has three modes (G cycles them): famous works (the default: it starts by itself at the
    works most people come to see, about 2,000 with 5,000+ yearly Wikipedia views, plus each room's three
    best known), every work, off. Each script opens with what you see in the picture (the Wikipedia text's
    describing sentences, "Here you see ...", else Wikidata's depicts: "In the picture, look for the earring,
    the girl and the pearl."), then the title, the material and the story; the artist follows.
  - The guide's text is standard data (`archive/guide.py`: one script per artist and per work, about 290 hours
    in all), read by the browser's voice now. Recordings by a narrator replace it script by script, and a live
    AI voice can read the same scripts later.
  - Seating by period (`furniture.ts`, `/furniture` in development to study the models), different in every
    room (`layout.ts` furnish, seeded by the room's works, so the same room is always furnished the same way):
    a bench or a round borne down the middle, or nothing; here and there an upholstered armchair set alone at an
    angle in a corner (bergères, fauteuils, crapauds, wing, Voltaire, spoon-back, club, Barcelona, Danish teak,
    Ming horseshoe chairs ...), a settee, or two chairs and a small table against the wall by a doorway. Each
    piece in one of its style's fabrics and woods (vertex colours: one material per part), velvet with a sheen
    in its own colour, damask with a woven figure, wood with grain.
  - Rope barriers (brass posts, a velvet rope) in front of the dozen most famous works (500,000+ yearly
    Wikipedia views: the Mona Lisa, The Starry Night, Girl with a Pearl Earring ...).
  - Rooms can now recreate a real museum, with nothing beyond the picker's tools:
    - the museum that holds the works (`m=`, Wikidata's collection and WikiArt's gallery as one name: 3,851
      museums, e.g. the Louvre 1,497 works, the Rijksmuseum 626, the National Gallery of Greece 79);
    - works picked by hand (`w=`, by title; ★ in the preview keeps a work whatever else changes, and
      `...@2` puts it on a given floor);
    - a floor plan of one's own (`fl=`): floors by years and, if wanted, nationalities, each with its own room
      style, wall colour, size and wall text; the first floor's number (`fs=0` for a ground floor).
    - A new room style, "a museum of today": grey-blue paint, a pale stone floor in large slabs, gilt frames
      under a luminous ceiling.
    - Two palace styles, for the Louvre and any room like it: "palace gallery" (a skylit cloister vault with
      gilt coffer ribs, wide arches on marble columns with gilt capitals between the rooms, oak parquet in
      herringbone: the Grande Galerie, the Rijksmuseum's Gallery of Honour) and "grand salon" (the same vault
      over Pompeian-red walls, plain wide arches: the red rooms, the Salle des États).
  - Three museums are made this way (`src/lib/museum-rooms.ts`, `/museums/<slug>`, "Recreate a museum" on
    `/rooms`), from each museum's floor plan and descriptions of its galleries: the National Gallery of Greece
    (floor 1 from El Greco to 1900, floor 2 the 20th century, in grey-blue and marble), the Rijksmuseum (floors
    0 to 3 by century, the Gallery of Honour ending at The Night Watch, in Cuypers' greys), and the Louvre's
    paintings (the Grande Galerie, the Mona Lisa's Salle des États in midnight blue, the red rooms, Richelieu's
    French and Northern rooms, Rubens' Medici gallery, Sully). Any of them loads into the picker to change.
  - Saving: "Save room" (named) in the picker and inside a room keeps rooms in "My rooms" in this browser; the
    link is the room. Saving across devices, and a public list of rooms, need accounts and a database: item 18.
  - Not done yet: rooms that turn corners (item 16, step 2). The suite is still one straight line of rooms; the
    layout, collision, culling and floor/ceiling geometry all assume it. Next to build, as its own piece.
- Next, beyond WikiArt: 75k Wikidata items by our artists are not in the museum, 27k of them with a Commons
    image. These are works the base itself has and the ingest skipped (paintings among them to be checked).

## Summary

| #  | Item                                          | Asked by                                   | Effort      | Impact  | Status            |
|----|-----------------------------------------------|--------------------------------------------|-------------|---------|-------------------|
| 1  | Re-lock the mouse after closing a painting    | alexpatin                                  | hours       | high    | ✅ done            |
| 2  | Walk speed setting, slower default            | tamacun3                                   | hours       | medium  | ✅ done            |
| 3  | Switch off the canvas effect                  | frmfrm                                     | hours       | medium  | ✅ done            |
| 4  | Hide the on-screen controls on phones         | jamilton                                   | hours       | medium  | ✅ done            |
| 5  | Explain the timeline in DEVELOPMENT.md        | cobertos                                   | hours       | low     | ✅ done            |
| 6  | "Next artist" door at the end of each gallery | d--b, tamacun3                             | 1–2 days    | high    | ✅ done            |
| 7  | Host the images ourselves                     | Sophira                                    | 2–4 days    | high    | ⏸ not now         |
| 8  | Fuzzy search, country and continent filters   | mariotacke                                 | 2–3 days    | medium  | ✅ done            |
| 9  | More detail about each work                   | criddell                                   | 3–5 days    | high    | 🟡 in progress     |
| 10 | Museum-style galleries: mixed artists, eras, rooms designed per case | luxcem, AIblemblio, crazygringo, owner | 3–5 weeks | highest | 🟡 in progress     |
| 11 | Rooms by phase of an artist's life            | AIblemblio                                 | 1 week      | medium  | ✅ done            |
| 12 | Raw-source store next to Postgres             | (own reply)                                | 1 week      | enabler | ✅ done (no Postgres) |
| 13 | High resolution and deep zoom (IIIF)          | seemaze, groby_b, _joel, dmje, Soliddune16 | 2–3 weeks   | high    | ⬜                 |
| 14 | More artists from museum and WikiArt lists    | ggerules                                   | 2–3 weeks   | high    | 🟡 in progress     |
| 15 | Audio guide                                   | justkat91, criddell, (own reply)           | 2–3 weeks   | high    | ✅ done (v1)       |
| 16 | A connected museum you can get lost in        | tamacun3, d--b, AIblemblio                 | 3–6 weeks   | high    | 🟡 step 1 done     |
| 17 | VR (WebXR)                                    | albertodenia, hudecekdev                   | 2–4 weeks   | medium  | ⬜                 |
| 18 | Social museum: visitors, tours, user wings    | crazygringo                                | months      | unknown | ⬜                 |
| 19 | A Greek history museum on the same engine     | (own reply)                                | months      | new     | ⬜                 |

No change needed:

- **Climbing on benches** (whycombinetor): already exists as the Vandalism
  easter egg (P, password `Vandalism0`).
- **Similarity to another Claude-built gallery** (aogaili, bawolff): already
  answered. Optional: add a "Prior art and inspiration" line to the README.

Suggested order: ship 1–5 as one release this week, then 7 (we promised to
host the images). Next comes 10, the owner's favourite: museum-style galleries
with artists side by side, groupings across schools and eras, an introduction
room for each era, and rooms designed around each artist or show. Then 6, 8, 9 and 11. Item 12 has to come
before 13 and 14. Items 13, 15 and 16 complete v2; 16 grows out of 10.
Items 17–19 are later bets.

---

## Tier 0: quick fixes (hours each)

### 1. Re-lock the mouse after closing a painting

*alexpatin: "when I'm done, it puts me back in normal cursor mode and I have to
click to 'step inside' again."*

Now: the click handler in `src/components/museum/Controls.tsx` (around line
425) calls `document.exitPointerLock()` before `onSelect`. Closing the inspect
view then shows the "step inside" overlay again.

Plan:
- When the inspect view closes from a user action (close button, Esc, click
  outside), call `lockApi.current.lock()` in that same event handler. A browser
  only grants pointer lock during a user action.
- Chrome refuses a new lock within about 1 s of an Esc exit. If the lock is
  refused, show the overlay as it does now. Visitors who stayed in the inspect
  view longer than that will not see it.
- Keep the overlay for phones and for browsers without pointer lock.
- Test: a scripted headless check that stubs `requestPointerLock` and checks it
  is called on close. Do not take the real cursor (see the headless-test rule).

### 2. Walk speed setting

*tamacun3: "The current setting feels too fast for a museum environment."*

Now: `WALK_SPEED = 3.1` m/s, with running at double that after holding W for
3 s. A slow museum stroll is about 1.0–1.4 m/s.

Plan:
- Add a speed control (Slow / Normal / Fast, or a slider) to the gallery
  settings, saved in `localStorage`.
- Lower the default to about 2.0 m/s and keep hold-to-run for long rooms.
- Use the same setting for `TAP_WALK_SPEED` on phones.

### 3. Switch off the canvas effect

*frmfrm: "there seems to be a canvas pattern added to the images ... I'd prefer
to switch that off to see the image without modifications."*

Now: `canvasWeaveTexture()` in `src/components/museum/exhibit-materials.ts`
adds a linen-weave normal map to every canvas work, along with varnish and
lighting.

Plan:
- Add a "Show surface texture" setting next to the speed control, on by
  default. Turning it off removes the weave and varnish from the material
  (`normalMap = null`, matte surface) without reloading the textures.
- In the inspect view, offer "View original image": the plain file, shown in
  2D with no lighting. Item 13 later turns this into deep zoom.

### 4. Hide the on-screen controls on phones

*jamilton: "I have a smaller phone and it takes up a lot of the screen. Maybe
just a toggle for UI visibility?"*

Plan:
- Add a show/hide button in a corner of the HUD (`fx/Hud.tsx`). Hide the room
  navigator, labels bar and joystick hints, and keep look and walk working.
- Make the HUD more compact by default below about 400 px wide or 700 px tall.
- Check on a 360 × 640 viewport and on iOS Safari and Firefox.

### 5. Explain the timeline in DEVELOPMENT.md

*cobertos asked about performance with "all artists" and whether the timeline
uses a library.*

The timeline uses no charting library (`wall-layout.ts`, `star-layout.ts`,
`StarView.tsx`). Add a short section to `docs/DEVELOPMENT.md` covering the
layout, spatial lookup, culling and the perf-probe numbers, and link it in a
reply.

---

## Tier 1: small features (days)

### 6. "Next artist" door at the end of each gallery

*d--b: "I kind of dislike that this website only allows you to browse one
artist at a time, and then you have to go back to the timeline."*

This is the cheap first step toward item 16.

- Put a lit doorway on the far wall of the last room. Its sign names the next
  artist, for example a contemporary in the same period, ordered by date or
  similarity. Add a second door to the previous artist.
- Walking through a door runs a short fade and loads the next gallery's route,
  starting at the entrance. Load the next artist's data while the visitor is in
  the last room.
- Add an option: "Continue through the period" (chronological) or "Surprise
  me" (another period).

### 7. Host the images ourselves

*Sophira: "it's pulling the images from Wikipedia's servers directly. That
feels like it could be pretty bad for Wikipedia's bandwidth."* We promised to
do this in the thread.

Plan:
- Mirror the exact thumbnail widths the gallery and timeline request (see
  `WIKIMEDIA_THUMB_WIDTHS` and `paintingTextureUrl` in `src/lib/img.ts`) into
  object storage with free egress, such as Cloudflare R2, behind a CDN.
  Estimate: 82k works × 2–3 sizes × about 300 KB is roughly 50–70 GB, about
  $1/month to store.
- Mirror once, slowly, with a proper `User-Agent` and rate limit under the
  Wikimedia robot policy. Resume with the existing HTTP cache. Afterwards copy
  only new or changed files.
- Only mirror files under free licences. Works marked © stay withheld, as now.
  Keep `ImageCredit` (author, licence, file page link) unchanged; credits do
  not depend on where a file is served from.
- Change `img.ts` to rewrite to the mirror host and fall back to
  `upload.wikimedia.org` when a file is missing. Add the new host to the CSP
  and preload hints.
- Mirror the portraits and music too (the music is already local).
- Check: count requests to `upload.wikimedia.org` in a full gallery visit
  before and after. The goal is zero.

### 8. Fuzzy search, country and continent filters

*mariotacke: "Would love a (fuzzy) search to look for certain artists,
additional filters, such as by-continent, by-country, etc."*

Now: Explore search ignores punctuation but needs an exact substring. Artists
have no country field.

Plan:
- In `scripts/enrich.ts`, fetch country of citizenship (P27), place of birth
  (P19) and its country, and movements (P135). Map countries to continents
  with a small static table. Add `country`, `continent` and `movements` to
  `Artist` in `src/lib/types.ts` and the Postgres tables.
- Make search tolerate typos and accents ("Durer" finds Dürer, "Vermer" finds
  Vermeer). Use a small trigram or edit-distance scorer over names and their
  aliases (also from Wikidata), with no new dependency.
- Add Country and Continent facets to `FilterDropdown.tsx`. Search paintings by
  title too, which opens the artist's gallery at that painting.

### 9. More detail about each work

*criddell: "you also find out what's important about any particular piece. They
tell you what came before or after ... Does the piece have an interesting
backstory? Questionable provenance? ... It would be neat to have more details
per work."*

Now: `Painting.story` and `facts` exist but are thin for works without an
article.

Plan:
- For works with a Wikipedia article: store the lead and section headings
  (History, Provenance, Description, Interpretation). Show them as tabs in the
  inspect panel.
- From Wikidata: collection (P195), location (P276), inventory number (P217),
  depicts (P180), genre (P136), movement (P135), commissioned by (P88), and
  significant events or provenance where recorded.
- Context the data already supports: "Painted the same year as..." (other
  artists, same year) and "Before / after in this artist's work" (neighbouring
  works with articles).
- Keep the source link and CC BY-SA attribution for every text block.

### 10. Museum-style galleries: mixed artists and era introductions

*luxcem: "rooms mixing works by several artists, the way a museum curator would
assemble a show." AIblemblio: "a more 'hard room setup' because brains can
remember things better with more context." crazygringo asked for curation.*

**Owner's priority (2026-10-07): this is the most wanted v2 feature.** Hang
artists side by side as real museums do, combine groupings across schools and
eras, and give each era an introduction.

Now: a gallery shows one artist (`ArtistWithPaintings` in
`src/lib/types.ts` has a single `periodName` / `periodColor`), and a period
gets a short blurb at the entrance.

#### a. Era galleries, hung like a real museum (first)

A museum's main route is chronological, with several artists in each room:
"Florence 1400–1450", "Venice and the North 1500–1530", "Dutch Golden Age:
Genre Painting".
- For each period, make a "Period gallery": rooms by sub-school, place or
  decade, each holding the period's key works from many artists (by pageviews
  and Featured status, about 15–30 per room). The data already has periods,
  years and pageviews, so a first version can be generated automatically,
  then adjusted by hand.
- Each room's wall text names the artists in it and how they relate. Each work
  links to "Enter this artist's gallery" (the current single-artist suite),
  which becomes the side room.
- Room styles already follow the period (`theme.ts`). A room mixing periods
  uses a neutral "temporary exhibition" style.

#### b. Era introduction room

Each period gallery opens with an introduction room, like the first room of a
museum wing:
- **The era in one wall text:** what changed in painting and why. Source: the
  period's Wikipedia article (we already store `Period.description` and the
  link), in more depth.
- **Historical context:** a wall timeline of major events of the time
  (politics, religion, science, trade, other arts), from Wikipedia and Wikidata
  (events with point in time (P585) and country, filtered to notable ones by
  pageviews). Example: the Renaissance room shows the printing press, the fall
  of Constantinople, Columbus and the Reformation.
- **Map:** where the main artists of the period worked (place of birth (P19)
  and work locations (P937)), shown as a lit wall map.
- **Who's who:** portraits of the period's main artists with one line each and
  doors to their galleries; teachers and students joined by lines (student of
  (P1066), influenced by (P737)).
- **Around the world at the same time:** what Chinese, Japanese, Persian and
  Indian painters were doing in the same years, from our own timeline data.
- Optional: the audio guide (item 15) narrates the room.

#### c. Themed exhibitions across groups and eras

Shows that cut across schools and centuries, each made of rooms with wall texts:

| Type | Example | Data source |
|---|---|---|
| Same subject through time | "Judith and Holofernes": Caravaggio, Artemisia Gentileschi, Klimt; "The Annunciation"; "Venus" | depicts (P180), main subject (P921) |
| Theme | "The Sea", "Night", "Self-portraits", "Still life over 500 years" | genre (P136), depicts, title words |
| Teachers and students | Verrocchio → Leonardo; Perugino → Raphael; Rembrandt's pupils | student of (P1066) |
| Influence | "Cézanne to Picasso"; "Japonisme": ukiyo-e next to Van Gogh and Monet; "The Caravaggisti" | influenced by (P737), hand-curated |
| Same year worldwide | "1503": the Mona Lisa next to Chinese and Persian works of that year | our `year` field (automatic) |
| Same place | "Paris 1874", "Venice", "Arles" | location of creation (P1071) |
| Famous exhibitions recreated | First Impressionist exhibition (1874), Salon des Refusés (1863), Armory Show (1913) | exhibition history (P608), hand-curated |
| Friends and rivals | Van Gogh and Gauguin; Matisse and Picasso | hand-curated |
| Women artists across eras | Sofonisba Anguissola to Joan Mitchell | sex or gender (P21) |
| Real collections | "Highlights of the Prado / Uffizi / Louvre" | collection (P195) |

Also: a "See this subject across time" button in the inspect panel, which opens
a generated exhibition for what the painting depicts. Later, visual similarity
(CLIP image embeddings) for "works that look like this" rooms.

#### d. Rooms designed for each case

*Owner (2026-10-07): "more personalized rooms per case." AIblemblio: "Going up
to the xy area or through a japanese space helps."*

Now: room styles come from about a dozen era themes (`theme.ts`: `EraKey` →
`GalleryTheme` with wall, floor, ceiling, frames, light and `RoomStyle`). Two
artists of the same era get the same rooms. Real museums design a room around
what hangs in it, and a distinct room is easier to remember.

- **Per-room overrides:** let an exhibition room, an artist, or an artist's
  phase (item 11) override any part of the era theme: wall colour and finish,
  floor, ceiling and daylight, frame style, light temperature, bench, music.
  Put this in the exhibition JSON and an optional `data/rooms/<artist>.json`.
- **Room shapes:** besides the rectangle, add an octagon, a rotunda, an oval, a
  long gallery with side cabinets, a chapel with an apse, and a low dark room
  for small works. This shares geometry work with item 16, step 2.
- **Props and architecture:** a small set of reusable props: tatami and shoji
  screens, a low display table for scrolls and albums, vitrines for
  miniatures, an altar wall for altarpieces, a studio corner (easel, palette),
  and a window with a view.
- **Examples:**
  - Monet's Water Lilies: two oval white rooms with daylight from above, like
    the Orangerie.
  - Rothko: a dim octagon with benches in the middle, like the Rothko Chapel.
  - Van Gogh in Arles: warm yellow walls, then darker walls for Saint-Rémy.
  - Hokusai and Hiroshige: a Japanese room with tatami, shoji and low light.
  - Persian miniatures: a small cabinet with vitrines and tiled walls.
  - Vermeer: a small room with one window on the left, matching the light in
    his paintings.
  - Altarpieces: a chapel with an apse.
  - Picasso: Blue period in blue-grey light, Rose period in warm light.
  - Caravaggio and the Caravaggisti: dark walls and strong single spotlights.
- **Generated defaults:** for artists without a hand-made room, vary the era
  theme by the artist's palette (dominant image colours), country and main
  medium, so even uncurated galleries differ from each other.
- **Order:** start with the Featured artists and the first exhibitions. Each
  new room design (shape, props, light) is reusable, so later cases mostly
  combine existing parts.

#### Build

- **Exhibition format:** `data/exhibitions/*.json`: a title, an intro, then
  rooms, each with a title, a wall text, a style and painting references
  (artist slug and painting slug). Period galleries (a), introductions (b) and
  themed shows (c) all use this format. Generated shows are written to the
  same format and then edited by hand.
- **Engine:** change the suite layout (`layout.ts`, `suite-runtime.ts`) to take
  a mixed painting list with a per-work artist and period instead of one
  artist's catalogue. Add wall types for the introduction room: a timeline
  wall, a map wall, portrait panels, and large text panels.
- **Enrich:** add P180, P921, P136, P1066, P737, P1071, P608, P195, P19, P937
  and P21 to `scripts/enrich.ts`, plus era events for the introduction rooms.
- **Navigation:** an "Exhibitions" entry on the home page next to Featured and
  All artists, and an "Enter the period gallery" action on each timeline period.
  Shareable URLs: `/exhibitions/<slug>`.
- **Order:** engine and the Renaissance period gallery with its introduction
  room first, as the pilot. Then the other periods, then 5–10 themed shows.
- Item 16 builds on this: period galleries become the museum's wings, and item
  18 lets visitors make exhibitions in the same format.

### 11. Rooms by phase of an artist's life

*AIblemblio: "brains can remember things better with more context ... Going up
to the xy area or through a japanese space helps." We replied: rooms themed by
the painter's life moments. AIblemblio: "the history / growth of an artist,
love it."*

Plan:
- Add optional `phases` for an artist (name, year range, place, short text),
  for example Picasso's Blue, Rose and Cubist years, or Van Gogh's Nuenen,
  Paris, Arles and Saint-Rémy years. Write these by hand for the Featured
  artists. Wikidata has little of this.
- When an artist has phases, split rooms at phase boundaries instead of by
  equal counts. Room signs show the phase name and place, and each phase can
  have its own room design (item 10d).
- Without phases, keep the current year-based split.

---

## Tier 2: v2 features (weeks)

### 12. Raw-source store next to Postgres

*Own reply: "next version will include ... a postgres and a data lake."*

Postgres (Neon) already exists through `scripts/load-db.ts`. What is missing is
a place to keep raw source data once sources beyond Wikimedia are added.

- Keep raw API responses and dumps (Wikidata, museum APIs, IIIF manifests) as
  dated Parquet or JSONL in object storage (the same bucket as item 7). Join and
  match them with DuckDB in the ingest. Postgres stays the serving store.
- Add a `sources` table: each painting can have several image sources (Commons,
  a museum IIIF service), each with its own licence and resolution. The site
  picks the best licensed one.
- Items 13 and 14 depend on this, so build only as much as they need.

### 13. High resolution and deep zoom (IIIF)

*seemaze: "(ultra) high resolution presentations ... I was the kid that always
got scolded by putting my nose up to the canvas." groby_b: "heartbreaking to
see the low resolution ... Paris Musées, Metropolitan Museum of Art, National
Gallery of Art, Rijksmuseum." _joel: Rijksmuseum Operation Night Watch.
dmje / Soliddune16: "IIIF is your friend ... pull deep zoom tiles instead of
one huge texture."*

Plan:
- **Match works to museums** using Wikidata identifiers that already link many
  paintings to their museum records: collection (P195) with inventory number
  (P217), plus museum object IDs such as Met object ID (P3634) and other museum
  catalogue properties. Start with museums that offer open access and IIIF or a
  high-res API: the Met, National Gallery of Art (Washington), Rijksmuseum, Art
  Institute of Chicago, Paris Musées, Cleveland Museum of Art, SMK (Copenhagen),
  Nationalmuseum (Stockholm), Yale Center for British Art, Getty, and the
  Smithsonian.
- **Check licences per museum.** Use only CC0 / public-domain releases. Record
  the licence and credit line in `ImageCredit`. Google Arts & Culture is not
  open (groby_b noted this), so leave it out.
- **Inspect view:** "Look closer" opens a deep-zoom viewer (OpenSeadragon from
  cdnjs, or a small custom tile viewer) on the museum's IIIF Image API, down to
  brush strokes. Show the source museum and a link.
- **3D wall:** keep the current texture tiers. Prefer a cleaner museum master
  when one exists, at the same sizes, so the gallery stays fast.
- **Bandwidth:** deep-zoom tiles come from the museums' own IIIF servers, which
  exist for this purpose. Cache commonly viewed tiles on our CDN if a museum
  asks us to.
- Show a "High resolution" badge on labels and a filter in Explore.

### 14. More artists from museum and WikiArt lists

*ggerules: "it is missing so many artists and art movements. A better choice of
source material and way more artists can be found on wikiart.org."*

Rights (checked 2026-10-07): WikiArt's terms of use (Ukrainian law) say
nothing about scraping, and robots.txt allows everything. The site shows
public-domain works and copyrighted works, the latter under a fair-use claim
that does not extend to us. There is also a paid read-only API (free and
Academic tiers exist). Contacts: wikipaintings@gmail.com, and
info@socialtalents.com for the API.

Built (2026-10-08): the crawl and the comparison tables are in `archive/` (README there). WikiArt's keyless
API v2 stops at about 400 requests an hour ("Free API limit exceeded"), so the crawl uses its plain JSON pages
and API v2 only for category IDs and artist periods. An Academic API key would lift that limit.

Plan:
- Write to WikiArt first and ask for Academic API access and permission to show
  public-domain images with a credit and a link back.
- Public-domain works only (artist died more than 70 years ago): take the
  facts (title, date, size, medium, movement) and the image. Copy the image to
  our own storage (item 7) instead of loading it from WikiArt, then credit it
  and link to the WikiArt page.
- Do not copy WikiArt's own descriptions or biographies, which are copyrighted
  text. Do not show in-copyright works; they stay label-only (©).
- Prefer a Commons or museum copy when one exists, since WikiArt images are not
  always better. Use WikiArt mainly for coverage: Wikidata has a WikiArt
  artist ID (P6002), so we can compare their artist and movement lists with
  ours.
- Fill the remaining gaps from the museum open-access collections in item 13.
  Many of their works have no Commons copy.
- Crawl slowly with a clear User-Agent (about 1 request per second) and cache
  every response.
- Add movements that are missing as periods or sub-bands on the timeline.
- Living and recently deceased artists stay label-only (©), as now.

### 15. Audio guide

*justkat91: "if you add also an audioguide it will complete the experience!"
criddell: guided-expert context. Own reply: "audioguide about the life of each
painter as well as some details when you come close to famous paintings."*

Plan:
- **Scripts:** for each Featured artist, a 2–3 minute life story by room or by
  phase (item 11). For each of the roughly 1,000 best-known works (by
  pageviews), 30–60 s of narration. Write them from the Wikipedia text and
  Wikidata facts already stored. If an LLM drafts them, limit it to those
  sources, attach citations, review the scripts, and label them "Narration
  based on Wikipedia".
- **Voice:** generate offline with a TTS model and store MP3/Opus on the
  item 7 bucket. Generated audio derived from CC BY-SA text is also
  CC BY-SA, so credit it and link the sources.
- **In the gallery:** a numbered headphone icon on labels for works with
  narration. Narration plays when you come near or press a key, and lowers the
  music while it plays (the music already does this). Show captions on screen.
  Add a pause/skip control and an "Audio guide on/off" setting.
- Start in English. The pipeline allows Greek and other languages later.

### 16. A connected museum you can get lost in

*tamacun3: "Instead of a long endless hallway, please ... study the layout of
museums ... Getting 'lost' in a museum is one of the great joys." d--b: "It
would be a lot better if it was a fully walkable museum."*

Build it in steps:
1. Item 6 (doors between artists). Cheap, and most of the benefit.
2. **Room layouts:** replace the straight run of rooms with real museum plans:
   enfilades, rooms off a central hall, side cabinets for small works, and
   rotundas for flagships. `layout.ts` already supports multiple rooms; this
   adds branching and turns. Check doorway lines of sight and portal culling.
3. **Period wings:** a hall for each period with doors to each artist's suite,
   plus a period introduction room (wall text, map, the period's highlights).
   Corridors connect neighbouring periods. The timeline becomes the "museum
   map".
4. **Streaming:** load and unload neighbouring suites as the visitor walks,
   building on the existing room mounting and portal culling. Keep memory flat
   on phones, and use perf-probe as the gate.
5. A minimap with "you are here" and a "take me to..." option for when getting
   lost stops being fun.

---

## Tier 3: later bets (months)

### 17. VR (WebXR)

*albertodenia: "Any plans to support VR?" hudecekdev: "VR would be awesome."*

- `@react-three/xr` adds an "Enter VR" button on the existing scene. Movement
  uses teleport plus smooth walking, and snap turning.
- The work is in comfort and speed: steady 72–90 fps on Quest, fewer lights,
  and different texture tiers. Labels and the inspect panel move into the 3D
  scene.
- Wait for item 13. Low resolution is much more obvious in a headset.

### 18. Social museum

*crazygringo: avatars walking around, opt-in chat, hourly guided tours with art
historians, user-curated wings with their own architecture, leaderboards, doors
between wings.*

This needs accounts, real-time servers and moderation. Steps, each useful on
its own:
1. **Shareable exhibitions** using the item 10 format: pick works, order
   rooms, get a link. No accounts and no server state beyond a stored JSON.
2. **Presence:** anonymous visitors shown as faint figures in the same gallery,
   with no chat. Use Cloudflare Durable Objects, PartyKit or similar.
3. **Scheduled tours:** a guide's position and voice broadcast to followers
   (item 15 audio, plus live audio). Approach art historians and university
   courses first.
4. Accounts, chat, user wings and leaderboards, only once there are enough
   regular visitors. Moderation is the main cost.

### 19. A Greek history museum on the same engine

*Own reply: "Being Greek, I plan to try Greek history next ... paintings,
sculptures, documentary videos, transcripts."*

- First separate the engine (galleries, timeline, ingest) from the art data so
  it can run a second collection.
- New exhibit types: sculpture (3D scans from Sketchfab or museum glTF files
  with an open licence, or photo boards), video screens, documents and maps.
- A separate site and separate data, sharing the engine.

---

## Appendix: the Hacker News thread (verbatim, 2026-10-07)

```text
	Hacker Newsnew | threads | past | comments | ask | show | jobs | submit	jasontr (51) | logout
	
*
	Show HN: A walkable 3D art history museum built from Wikipedia (artfrompixels.com)
	126 points by jasontr 7 hours ago | hide | past | favorite | 58 comments
	
From Li Cheng to Banksy
	
 help


	
	
crazygringo 4 hours ago | unvote | next [–]

This is incredibly cool. It's been a while since I felt this inspired by something on HN. Congratulations on the idea and the implementation!

I genuinely think there's an opportunity for someone (yourself, or someone else) to turn this into a genuinely social experience, a modern museum platform.

I'd love to see people's avatars walking around in some suitably tasteful way, with general info on location/age/sex/occupation. Be able to indicate if you're open to chatting.

Work with actual art historians to give prerecorded virtual tours that start every hour or something, so you can be part of a group following around.

There's something special about the museum experience, and the idea of virtualizing it in a way that makes it accessible to everyone, just through your browser rather than VR goggles, feels somehow a little bit magic.

Let people curate their own wing layouts and architecture and own art selection and where each painting gets hung. Have leaderboards of the most popular ones, and each wing can build doors that transition to other selected wings.

I genuinely think something like this could become "the" virtual museum, the same way Wikipedia is "the" electronic encyclopedia. It's just such a fundamentally different experience from how you currently browse museum's collections electronically.

reply
	
*
	
1 point by jasontr 6 minutes ago | parent | next | edit | delete [–]

wow thank you for the business plan!!!!!!!!!

reply
	
	
tencentshill 3 hours ago | unvote | parent | prev | next [–]

It's so genuinely load-bearing it hurts. And thats where it shapes the paradigm in a very real way.

reply
	
	
Sophira 2 hours ago | unvote | prev | next [–]

This looks incredibly cool!

But I do note that it's pulling the images from Wikipedia's servers directly. That feels like it could be pretty bad for Wikipedia's bandwidth. I think I'd feel more comfortable if the art was cached by artfrompixels.com itself, where licensing allows. (And I imagine that for a lot of it there'll be no issue.)

reply
	
*
	
1 point by jasontr 7 minutes ago | parent | next | edit | delete [–]

Nice catch. It on schedule, to host them ! ty. next version will include all proposals as well as a postgres and a data lake.

reply
	
	
alexpatin 4 hours ago | unvote | prev | next [–]

This is super cool and I look forward to sharing with my art friends. One piece of unsolicited feedback: it is really nice to focus on a particular image in the gallery, but when I'm done, it puts me back in normal cursor mode and I have to click to 'step inside' again. Minor annoyance. Otherwise really neat.

reply
	
*
	
1 point by jasontr 7 minutes ago | parent | next | edit | delete [–]

noted!ty

reply
	
	
aogaili 5 hours ago | prev | next [–]

What is strange is that last year I spent a lot of time creating the exact same 3D gallery experience with Claude. I picked up the style of the lights, the benches, the walls, the cards position. I also added music, lights on top of the images and the exact tour experience.

A year later, I see a very similar implementation!...I find that very odd.

But I do like the experience and site, there are few things I can pick from it myself for the project I've.

But it seems to me anything you use Claude for will be used aggressively to train the next model and some else in same prompting space can recreate it.

Not take the anything from the author's work, mine was in a slightly different context.

reply
	
*
	
2 points by jasontr 4 hours ago | parent | next [–]

Indeed i have seen the concept on youtube back in the days. Also what you saying I agree too, about big LLMs that are trained on others people work (i.e. math). it started as single prompt so the model did its own work with a hight probability of using others people work, after that i worked a lot on this. In the future I am sure that i will use my work too.

Nevertheless, I have gathered many ideas from the comments. if you are interested we can cooperate on the project. its a project out of pure interest exporing on more ways to ingest/spread knowledge.

reply
	
	
bawolff 2 hours ago | parent | prev | next [–]

I mean, i think the more likely explanation is that claude created both, and you are overestimating how unique the prompts you gave claude were.

reply
	
*
	
1 point by jasontr 2 minutes ago | root | parent | next | edit | delete [–]

I dont disagree! The important thing is what happens next after the prompts.

reply
	
	
cobertos 2 hours ago | unvote | prev | next [–]

Did you find any issues with performance in such a large dataset (like "all artists") with such dynamic rendering (specifically for the timeline view)?

Does this use a library for plotting everything on the timeline or is it coded from scratch?

EDIT: I see now the code is at https://github.com/justdataplease/art-history-museum

reply
	
	
ggerules 4 hours ago | prev | next [–]

This is an awesome project. It could bring the art museum experience to those that can't travel to museums.

But it is missing so many artists and art movements. A better choice of source material and way more artists can be found on wikiart.org [0]. Maybe the creator could merge scraping efforts?

[0] wikiart.org.

reply
	
*
	
5 points by jasontr 4 hours ago | parent | next [–]

wow i want not aware wikiart.org. indeed a better source ! since i have the infra i will include that too!! thank you a lot!!!

reply
	
	
criddell 2 hours ago | prev | next [–]

At some museums you can hire an art history expert as a guide. In addition to learning the basics (era, artist, etc...) you also find out what's important about any particular piece. They tell you what came before or after the painting or sculpture. You find out who was working with whom. Does the piece have an interesting backstory? Questionable provenance? What was the cultural or political environment at the time?

This does have a little blurb as you enter different galleries, but it's pretty broad. It would be neat to have more details per work.

I really wish I had taken an art history course when I was in school...

reply
	
*
	
1 point by jasontr 5 minutes ago | parent | next | edit | delete [–]

very nice! i will organize all suggestions for the next version! ty

reply
	
	
albertodenia 5 hours ago | prev | next [–]

Great project! Any plans to support VR?

reply
	
*
	
2 points by jasontr 4 hours ago | parent | next [–]

Not ATM ! Thinking of curating more the content and also add an audioguide about the life of each painter as well as some details when you come close to famous paintings. But a nice idea, but it would need better resolution of the paintings (not possible atm since are from wikipedia).

reply
	
	
frmfrm 4 hours ago | unvote | prev | next [–]

Very cool! What stood out is there seems to be a canvas pattern added to the images, which the original don't have. I get it adds a nice touch of lighting but I'd prefer to switch that off to see the image without modifications. Great work!

reply
	
	
whycombinetor 4 hours ago | prev | next [–]

Very cool, but I can't seem to jump up onto the benches, even with crouch jumping.

reply
	
*
	
2 points by jasontr 4 hours ago | parent | next [–]

hehe i know right, i was waiting for this! this is supposed to be for educational purposes, but since you want a bit of fun to press P on your keyboard and for password do Vandalism0

reply
	
	
jamilton 2 hours ago | prev | next [–]

Nice, works surprisingly well on mobile (iOS Firefox). It’s be nice if the UI was a little less intrusive, I have a smaller phone and it takes up a lot of the screen. Maybe just a toggle for UI visibility?

reply
	
	
hudecekdev 3 hours ago | unvote | prev | next [–]

This is very well done! Thank you. Spent a surprising amount of time looking at paintings. VR would be awesome.

reply
	
	
seemaze 5 hours ago | prev | next [–]

Very cool, would love to experience (ultra) high resolution presentations of the art. I was the kid that always got scolded by putting my nose up to the cavas to see the brush strokes..

reply
	
	
_joel 5 hours ago | parent | next [–]

Easily done if you leverage https://www.rijksmuseum.nl/en/stories/operation-night-watch/... - sure there are loads more museums that offer such a service now too.

reply
	
*
	
1 point by jasontr 4 hours ago | parent | prev | next [–]

yes!!! interesting atm the media is sourced directly from wikipedia. will look into it!

reply
	
	
dmje 3 hours ago | unvote | root | parent | next [–]

IIIF is your friend here. Many museums / art galleries publish their manifests - example, Science Museum London → https://collection.sciencemuseumgroup.org.uk/objects/co6997/...

reply
	
	
Soliddune16 4 hours ago | prev | next [–]

Agree on the museum sources, and the bit worth adding is most of them serve IIIF so you can pull deep zoom tiles instead of one huge texture.

reply
	
*
	
1 point by jasontr 4 hours ago | parent | next [–]

IIIF i did not know very interesting. will look into it!!! ty

reply
	
	
serf 4 hours ago | unvote | prev | next [–]

feels like with all these edutainment demos that AI is enabling that i'm back playing with Encarta as a kid. Good work.

It's a shame that the real-world-metaphor computer stuff fell out of favor. microsoft bob, etc. It's not that efficient but it's so well self-explained ; to see more art you walk around a museum; who'da thought.

reply
	
	
luxcem 5 hours ago | prev | next [–]

It would be great to add curated exhibitions alongside the single-artist retrospectives: rooms mixing works by several artists, the way a museum curator would assemble a show.

reply
	
*
	
2 points by jasontr 4 hours ago | parent | next [–]

really nice idea working on this next. Thank you!!

reply
	
	
tamacun3 3 hours ago | prev | next [–]

So cool and inspiring.

1) Please add a walk speed setting. The current setting feels too fast for a museum environment. The joy of seeing a piece out of the corner of your eye and delayed satisfaction of making your way over to it in a real museum could be captured.

2) Instead of a long endless hallway, please ask it study the layout of museums and implement some of the features. Getting "lost" in a museum is one of the great joys. You end up in a wing that you may otherwise have never been interested in.

reply
	
	
jsmcgd 3 hours ago | unvote | prev | next [–]

Glorious. I've been waiting for this a long time.

reply
	
*
	
1 point by jasontr 0 minutes ago | parent | next | edit | delete [–]

ty!!!

reply
	
	
mariotacke 4 hours ago | unvote | prev | next [–]

Really well executed! Would love a (fuzzy) search to look for certain artists, additional filters, such as by-continent, by-country, etc.

reply
	
*
	
1 point by jasontr 4 hours ago | parent | next [–]

There is Explore button where you can search but noted about more filters i will enchance it!

reply
	
	
jschveibinz 4 hours ago | prev | next [–]

This is very, very well done. Thank you.

reply
	
*
	
1 point by jasontr 4 hours ago | parent | next [–]

ty!

reply
	
	
zero0529 5 hours ago | prev | next [–]

I was really surprised by this. Well done.

reply
	
	
d--b 1 hour ago | prev | next [–]

I remember that art galleries used to be the best thing in Second Life.

Seeing things in a walkable space was incredibly different than browsing a website. There is something quite palpable about it.

I think Google Arts Project would let you navigate real rooms in museums and zoom in on the painting.

I kind of dislike that this website only allows you to browse one artist at a time, and then you have to back to the timeline. It would be a lot better if it was a fully walkable museum.

Just my opinion.

reply
	
	
insane_dreamer 1 hour ago | prev | next [–]

VERY impressed by the implementation, idea, and interface. Major kudos.

reply
	
	
micahdittmar 5 hours ago | prev | next [–]

This is how I'd like to consume all my information

reply
	
*
	
1 point by jasontr 4 hours ago | parent | next [–]

I agree! thinking of going beyond art to include national history. Being Greek, I plan to try Greek history next. Again a museum with paintings sculptures docuemntaty videos transcripts etc.

reply
	
	
groby_b 2 hours ago | prev | next [–]

It's amazing.

And it's heartbreaking to see the low resolution. I hope the author will explore the large catalogs of high resolution public domain/CC0 images available.

Because the core implementation is really, really nice. I just want to look much more closely.

Paris Musées, Metropolitan Museum of Art, National Gallery of Art, Rijksmuseum are some sources I can think of - there are more, I'm sure.

And I _wish_ the super-high rez ones at https://artsandculture.google.com/ would fall on that list too, but I guess that's not the case.

reply
	
*
	
1 point by jasontr 0 minutes ago | parent | next | edit | delete [–]

very nice will look into it for the next version!

reply
	
	
mikeaskew4 3 hours ago | unvote | prev | next [–]

Terrific

reply
	
	
justkat91 6 hours ago | prev | next [–]

nice! if you add also an audioguide it will complete the experience!

reply
	
*
	
1 point by jasontr 6 hours ago | parent | next [–]

every artist every work under one roof! audioguide regarding their life and some specific details when come close to a famous painting, indeed sounds nice.

reply
	
*
	
1 point by jasontr 6 hours ago | parent | prev | next [–]

noted!

reply
	
	
kapsakalis 5 hours ago | prev | next [–]

great experience! really good work

reply
	
*
	
1 point by jasontr 4 hours ago | parent | next [–]

ty

reply
	
	
tg1482 5 hours ago | prev | next [–]

beauty

reply
	
	
AIblemblio 5 hours ago | unvote | prev | next [–]

I would like a more curated version of this or a more 'hard room setup' because brains can remember things better with more context.

Going up to the xy ara or through a japanese space helps.

Nonetheless, nice expeirment.

reply
	
*
	
1 point by jasontr 4 hours ago | parent | next [–]

nice maybe rooms designed not just from a generic historical period but themed from the painters specific life moments / or specific era? will work on that, thank you

reply
	
	
AIblemblio 4 hours ago | unvote | root | parent | next [–]

Uh the history / growth of an artist, love it :)

reply
	
	
pavi-t 4 hours ago | unvote | prev | next [–]

lovely! thank you

reply
	
*
	
1 point by jasontr 6 hours ago | prev [–]

The idea is every artist every work under one roof.

You start on a timeline with mutliple periods and traditions, ~500 artists and ~80k works. Choose an artist and enter a gallery with their work arranged by date. Featured gives you a smaller starting point; All artists opens the full collection.

The biographies, artwork information and images come from Wikipedia, Wikidata and Wikimedia Commons.

Labels show recorded dimensions where available and explain when a work has been reduced or enlarged for the room. Each period has its own room style and music from Commons.

Each artist’s gallery includes all the usable works we could gather from those sources, including images without a Wikipedia article. Coverage is uneven: missing images, incomplete records and collection choices all affect what appears.

Code: https://github.com/justdataplease/art-history-museum

The Wikimedia volunteers who write, photograph and catalogue this material make the project possible. If you find it useful, please consider supporting Wikipedia: https://donate.wikimedia.org/




Consider applying for YC's Winter 2027 batch! Applications are open till November 2.

Guidelines | FAQ | Lists | API | Security | Legal | Apply to YC | Contact

Search:
```
