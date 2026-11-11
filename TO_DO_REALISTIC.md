# Realistic recreations: notes

Working notes for making the recreated museums look like the real buildings. The owner judges each room by
eye: a photograph of the real room beside the model from the same place, worked on until the two are the same.
Ticked items are done and checked that way. The engine is described in docs/DEVELOPMENT.md ("A real building, to
plan", "A real ceiling, photographed"); the steps are in the recreate-a-space skill, section 6.

## How to work

1. Collect photographs of every room from Wikimedia Commons (one per room at least, its end walls, its ceiling
   straight up and from each side). Keep author and licence; keep the files in a scratch folder, never in the
   repo.
2. Measure: place, length and doors from OpenStreetMap (`node scripts/osm-rooms.mjs`); width and height from
   the photographs, against a painting of known size or a visitor. The survey's outlines include the walls.
3. Give each photograph its camera in the model, in a views file (`scripts/fit-photo.mjs` from marks, or by
   eye).
4. Shoot and pair: `node scripts/shot-space.mjs louvre <dir> vN full http://localhost:3000 --views views.json`,
   then `node scripts/pair-shots.mjs views.json <photoDir> <dir> vN <pairsDir>`.
5. List what differs, in this order: size, form, colour and light, the hang. Change `src/lib/spaces.ts` or the
   engine, shoot again.
6. Check: `node scripts/check-space.mjs louvre`, `node scripts/fps-space.mjs louvre`, `npx tsc --noEmit`,
   `npm run check-layout`, `npm run test:performance`, a phone upright and sideways.

## The Louvre, Denon wing (`louvre-denon`)

### Salon Carré (708)

- [x] Heights from five ceiling photographs fitted together: 10.5 m to the attic, 13.9 m to the cornice, 18 m
      to the glass (the Louvre's own page says the ceiling is at 14 m).
- [x] The real ceiling: six photographs laid on the vault from where each was taken, raised in relief.
- [x] Grey-white walls, the white lighting beam round the room, the free-standing panels, the blue wave sofas.
- [ ] The four sides' photographs are by four photographers: tones still differ a little at the corners.
- [ ] Relief comes from how light the photograph is. The figures stand out but are not sculpted in the round;
      a depth map per photograph (or modelled figures for the four corners) would do better.
- [ ] The real hang is denser and larger (the Maestà is 4.3 m high); some panels have no size on record.

### Grande Galerie (710, 712, 716)

- [x] 9.9 m wide, 7.75 m to the cornice (measured against a visitor), round vault glazed along its crown.
- [x] Arches on paired marble columns (grey toward the Salon Carré, red-brown further west), ochre pedestals,
      niche bays of pale marble, red-brown plinth, grey frieze, chequered oak floor with a lane of chevrons,
      round aubergine sofas, cords before the walls.
- [ ] How many arches there are, and where, is taken from what the photographs show of the east end (six here).
      Find a plan or a long view of the west end.
- [ ] The vault between the arches is plain; the real one has coffered bands and grey marble panels at the
      arches.
- [ ] 120 works hang where the real gallery has several hundred. The cap is 120 works a floor
      (`src/lib/room-query.ts`); raise it for a space, and check frame rate.
- [ ] Capitals and the marbles' veining are simplified. The niches are empty (no sculpture on the floor, as
      the owner asked).

### Salle des États (711)

- [x] Midnight blue walls, a ceiling of glass, the Mona Lisa behind glass on her own wall with the oak shelf
      and the curved rail, the Wedding at Cana on the wall facing her.
- [ ] The real ceiling has a deep white soffit round the glass; the side walls hang more works.
- [ ] Lowest frame rate of the wing (28 full, 42 fast on the integrated GPU): the whole ceiling is glass.

### Salon Denon (701)

- [x] Square under its vault; the vault is a photograph straight up from the middle of the floor (Müller's
      four scenes, the eagles and palms).
- [x] The upper storey set back behind a gallery with its rail, over a bracketed cornice; three windows on the
      Cour Napoléon and one each side; black door cases.
- [ ] Which vault scene is over which wall is an assumption (from where the sun fell in the photograph).
- [ ] How far back the upper windows stand is estimated.
- [ ] The real canvases are far larger and hang up to the cornice.
- [ ] The real floor is in Versailles panels, not the chequer.

### Salle Mollien (700) and Salle Daru (702)

- [x] 12.6 m wide and 10 m to the cornice (measured against the Coronation of Napoleon and the Sabine Women).
- [x] Dark red panels, black plinth, gilt cornice, long skylight of small panes in dark bars, two rows of great
      canvases, black leather daybeds, cords, the key works where they hang.
- [ ] The scrollwork on the coves is drawn in the manner of the real one, not the real pattern (which carries
      painters' names in cartouches). Photographs of the coves exist on Commons: lay them on as in the Salon
      Carré.
- [ ] The red reads warmer or cooler than a given photograph depending on its white balance; settle it against
      several photographs, not one.

### Salle des Sept-Mètres (709)

- [ ] The least matched room. The free-standing walls are placed by eye; the ceiling grid and lighting are
      simpler than the real ones. Needs its own photographs and a measured pass.

### The rest of the Louvre

- [ ] Richelieu and Sully are still the old style (`/museums/louvre-richelieu-sully`): make them spaces.
- [ ] Several levels in one space (stairs or a lift between them).
- [ ] The Galerie d'Apollon and the Spanish rooms behind the shut doors.

## The engine

- [x] Rooms measured from the survey and from photographs; doors, windows, free-standing walls, pinned works.
- [x] Vault forms (cove, barrel, cloister), attics set back behind a gallery, glazing, niche bays, arches with
      their own marble, cords and rails, seats of a room's own, two rows of great canvases.
- [x] Photographed ceilings laid from each photograph's own camera, toned to sit together, raised in relief on
      the full tier, flat and smaller on the fast tier.
- [x] Tools: osm-rooms, fit-photo, shot-space with a views file, pair-shots, check-space, fps-space.
- [ ] Photographed walls and coves for any surface, not only ceilings (the red rooms' coves, the Grande
      Galerie's arches).
- [ ] Rooms that are not rectangles (a rotunda is drawn as its bounding room; cut corners are flat).
- [ ] Next museum: start from the skill, section 6, and this file's "How to work".

## Licences

- The plans derive from OpenStreetMap (ODbL); the ceiling photographs are from Wikimedia Commons (CC BY-SA and
  CC0), loaded from there and credited in NOTICE.md. Add every new photograph to NOTICE.md when it goes in.
