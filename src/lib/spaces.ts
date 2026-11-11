// Real buildings, room by room: a museum's own floor plan, walked as it stands instead of as a suite of rooms
// along one axis. A space is a small description: each room a rectangle in metres where it really is, its wall
// height and its look (a room style of theme.ts and what the real room changes of it), the doors between the
// rooms, the free-standing walls, and the works that hang at a known place. Nothing else is stored: the walls,
// ceilings, floors and the hang are built from it (src/components/museum/plan-layout.ts, plan-geometry.ts).
//
// A room's link names its space (`sp=louvre-denon`, src/lib/room-query.ts); the link's floor plan then gives each
// room of the space its works (the plan's first floor hangs in the space's first room, and so on), so the works
// are chosen, kept, left out and moved with the room picker like any other room's.
//
// The plans are measured from OpenStreetMap's indoor survey of the building (room outlines and door positions,
// © OpenStreetMap contributors, ODbL), turned to the building's own axis: x runs east, z south, in metres. A room
// is the rectangle of its wall faces; the gap between two rooms is the wall between them. The survey's outlines
// follow the building, walls and all (and a terrace beside a room with them): a room's length and its doors are
// taken from it, its width and height from photographs of the room, measured against something of known size
// in them (a painting whose canvas is on record, a visitor). Colours and materials are from photographs too
// (sources by each space).

import type { EraKey, RoomLook } from "@/components/museum/theme";
import type { PhotoPatch } from "@/components/museum/plan-nav";

export type SpaceSide = "n" | "s" | "w" | "e";

export interface SpaceRoom {
  id: string;
  name: string;
  /** The museum's own room number. */
  no?: string;
  /** The room's wall faces (m): x0 west, x1 east, z0 north, z1 south. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Wall height, to the cornice (m). */
  h: number;
  style: EraKey;
  look?: RoomLook;
  /** A long gallery hangs, lights and loads bay by bay: about this long each (m). */
  bay?: number;
  /** Where the works begin: at this end of the room's long axis (default: its north or west end). */
  from?: SpaceSide;
  /** Columns under an arch across the room: at each bay line ("bays"), or at these places along its long axis
   *  (x or z, m), each in the room's marble or one of its own. */
  arches?: "bays" | (number | { at: number; marble: string })[];
  /** The lowest a frame hangs (m; default 0.45, or above the plinth). */
  minBottom?: number;
  /** Hung in two rows, one work above another (a salon's great canvases). */
  rows?: 2;
  /** A seat down the middle every so many metres (default: one a bay). */
  seatEvery?: number;
}

export interface SpaceDoor {
  /** The room whose wall it is named in, and the room beyond: null for a door that stays shut (to a part of the
   *  building not recreated here). */
  room: string;
  to: string | null;
  side: SpaceSide;
  /** Its centre along the wall (x on a north or south wall, z on a west or east wall), clear width and height. */
  at: number;
  w: number;
  h: number;
  /** An arched head (the height is its crown). */
  arch?: boolean;
  /** The visitor comes in by this door. */
  entrance?: boolean;
  /** Not a door but a window to the outside (`to: null`): glazed to the floor, daylight behind it. */
  window?: boolean;
}

/** A free-standing wall in a room (its faces, and its height). */
export interface SpaceWall {
  id: string;
  room: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h: number;
  /** It stands in a surround of stone, two posts and a lintel (the Mona Lisa's wall); else a plain panel. */
  portal?: boolean;
  /** The room's works hang on it as on its walls (else only a work pinned to it). */
  hang?: boolean;
}

/** A work with a place of its own: on a wall of a room (`side`) or on a free-standing wall's face. */
export interface SpacePin {
  /** artist/painting, as in a room's link. */
  work: string;
  room: string;
  /** The free-standing wall it hangs on (else the room's own wall). */
  wall?: string;
  /** The wall of the room, or the face of the free-standing wall (the side it looks to: "n" faces north). */
  side: SpaceSide;
  /** Its centre along the wall (default: the middle of the wall). */
  at?: number;
  /** Behind glass set in the wall, a shelf below it and a curved rail keeping visitors back (the Mona Lisa). */
  shrine?: boolean;
}

/** A photograph of the real room laid on its ceiling from where it was taken: the stucco, gilding and painting
 *  of a ceiling as they are, where modelling them would only be a likeness. It is loaded from Wikimedia Commons
 *  as the paintings are (nothing is stored here) and credited in NOTICE.md. Where the camera stood, the way it
 *  looked and its lens are found from places marked on the photograph (scripts/fit-photo.mjs), so that what is
 *  marked lands where the room has it. */
export interface SpacePhoto {
  room: string;
  /** The file on upload.wikimedia.org, and its size in pixels. */
  src: string;
  size: [number, number];
  /** Who took it, and its licence. */
  by: string;
  /** Where the camera stood (plan metres: x east, y up, z south), the way it looked (yaw: 0 north, π/2 west;
   *  pitch up; roll) and its vertical field of view in degrees. */
  eye: [number, number, number];
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
  /** Its colours on the model, to sit with the room's light and with the photographs beside it: what each
   *  channel is multiplied by (default 1), after what is taken off it first (`black`: a hazy photograph's veil). */
  gain?: number | [number, number, number];
  black?: number | [number, number, number];
  /** What it is laid on. Later photographs lie over earlier ones. */
  on: PhotoPatch[];
}

export interface Space {
  id: string;
  name: string;
  rooms: SpaceRoom[];
  doors: SpaceDoor[];
  walls: SpaceWall[];
  pins: SpacePin[];
  photos?: SpacePhoto[];
}

// The Louvre, Denon wing, first floor: the rooms of Italian painting and of the large French canvases.
//
// Plan: OpenStreetMap's indoor survey in the building's own frame (u along the Grande Galerie, v across it:
// node scripts/osm-rooms.mjs 48.8585,2.3300,48.8640,2.3410 1 "Grande Galerie"), here x = u + 20.8,
// z = −v − 121.6. From it: where the rooms stand, their lengths, their doors. The Grande Galerie, 269 m, along
// the Seine; at its east end the Salon Carré; off its north wall, two doors into the Salle des États (the Wedding
// at Cana on a wall of its own at the north end, a passage round each end of it to the Salon Denon); Denon between
// the Salle Mollien to the west and the Salle Daru to the east (two doors each side, a painting between them); the
// Salle des Sept-Mètres north of the Grande Galerie's east end. Doors to the stairs (Daru, Mollien), to the Galerie
// d'Apollon and to the Spanish rooms stay shut.
//
// The Salon Carré's heights: five photographs of its ceiling whose lenses are on record, fitted together
// (scripts/fit-photo.mjs): the walls 10.5 m to the foot of the gilt attic, the cornice's top at 13.9 m (the
// Louvre: "ce plafond situé à quatorze mètres de hauteur"), the coves reaching 5.4 m in and rising to a skylight
// of ten panes by five at 18 m. Its ceiling (Duban, 1849–51; Simart's stucco figures of the arts) is those
// photographs, laid on the coves and the attic from where each was taken.
//
// The Salon Denon: square under its vault (a photograph straight up shows it so; the survey's outline is a
// tenth longer east to west), three windows on the Cour Napoléon, a band of round-headed windows above its
// bracketed cornice and the painted vault over them. Which of the vault's four scenes is over which wall is
// taken from where the sun fell in that photograph, not from a plan.
//
// Widths and heights: from photographs (Wikimedia Commons, 2018–2026), against a ruler in each. The survey's
// outline of the Grande Galerie is 12.5 m across and of the red rooms 17 to 18 m: the building's, with its walls
// and the terrace before the red rooms. A visitor standing in the Grande Galerie gives about 9.9 m between the
// walls, 7.75 m to the cornice the round vault springs from, columns of 5 m on pedestals of 1.25 m; the
// Coronation of Napoleon (canvas 6.21 m high) and the Intervention of the Sabine Women (3.85 m) on the Salle
// Daru's wall give 9.85 m to its cornice and about 12.6 m across. Each within a tenth or so: no measured section
// of these rooms is published.
//
// Look: the same photographs. Floors of pale oak in chequered panels of slanting boards (a lane of chevrons down
// the Grande Galerie). The Grande Galerie: grey fabric panels over a plinth of red-brown marble, a frieze of
// grey marble under a white and gilt cornice, a round cream vault glazed along its crown, cut by arches on paired
// marble columns (pale grey toward the Salon Carré, red-brown further west) on ochre pedestals, bays of white
// marble with a niche beside them; great round grey sofas. The Salle des États (2019): midnight blue, a ceiling of
// glass, the Mona Lisa behind glass on a wall of her own in a surround of pale stone. Mollien and Daru: dark red
// panels over a black plinth, a gilt cornice, red coves painted with gilt scrollwork round a long skylight of
// small panes in dark bars, doors cased in black, black leather daybeds, two rows of great canvases. The Salon
// Denon: red under a painted vault with round-headed windows. The Salon Carré: pale walls under a gilt attic and
// a cove of white stucco figures on blue and gold. The Sept-Mètres: cream, its works on walls that stand out
// from one side, each in a frame of grey stone.
//
// Not known: how many arches cross the Grande Galerie and exactly where (six here, from what the photographs
// show of the east end); the free-standing walls of the Salon Carré and the Sept-Mètres are placed by eye.
const DAY = { spot: "#fff3e2", ambient: "#f1eee8" };
const GLASS = "#f3f5f6";
// (daylit rooms: the spots only lift the pictures a little, without a pool on the wall)
const SOFT = { level: 0.3, penumbra: 1 };
const RED = "#763436";
const BLACK_PLINTH = { height: 0.5, color: "#211e1d" };
const CORD = { kind: "cord" as const, out: 1.0, height: 0.55 };
const RAIL = { kind: "rail" as const, out: 0.95, height: 0.9 };
const STONE = "#b3ab9c";
const RED_ROOM: SpaceRoom["look"] = {
  wall: RED, ground: "damier", trim: "#3a2a22", ceiling: "#643029", light: DAY,
  room: {
    wallFinish: "panel", panelSeams: { every: 2.4, across: 5.4 }, arches: undefined, coveRadius: 2.3, coveRise: 3.2,
    glassHalfWidth: 3.7, glazing: { bars: "#26272a", heavy: [4, 4], pane: 0.62 }, daylight: "#d5e0e8",
    daylightLevel: 1.55, dado: BLACK_PLINTH, giltCornice: true,
    coveArt: { kind: "arabesque", color: "#8f6f38", every: 5.2 }, guard: CORD, doorCase: "#1b1918",
    noTrack: true, spot: SOFT, wallWash: 0.34, furniture: "daybed",
  },
};
const GREY_MARBLE = "#b9aaa6";
const RED_MARBLE = "#6b4640";
const LOUVRE_DENON: Space = {
  id: "louvre-denon",
  name: "The Louvre · Denon wing, first floor",
  rooms: [
    {
      id: "salon-carre", name: "Salon Carré", no: "708",
      x0: 134.9, x1: 159.0, z0: 17.6, z1: 33.4, h: 10.5, style: "salon", seatEvery: 12,
      look: {
        wall: "#b7bcc2", ground: "damier", trim: "#cbbf9f", ceiling: "#8f8364", light: DAY,
        frame: { style: "tabernacle", width: 0.11 },
        room: {
          wallFinish: "panel", panelSeams: { every: 1.5, across: 6.9 }, arches: undefined, coveRadius: 5.05, coveRise: 4.1,
          glazing: { bars: "#3a3d42", pane: [0.96, 1.31], heavy: [5, 5] }, daylight: GLASS, daylightLevel: 1.7,
          attic: { height: 3.4, color: "#8d7c52", panel: 2.0 },
          coveArt: { kind: "stucco", color: "#b3a06a", ground: "#56606e" }, giltCornice: true, guard: CORD,
          gilt: "#bfa868", lightBeam: { height: 7.3, out: 1.0, color: "#d9dee2" },
          doorCase: "#c9bfae", doorLeaf: "#9a7648", noTrack: true, spot: SOFT, wallWash: 0.14, furniture: "wave-sofa",
        },
      },
    },
    {
      id: "grande-galerie", name: "Grande Galerie", no: "710 · 712 · 716",
      x0: -135.0, x1: 133.6, z0: 22.5, z1: 32.4, h: 7.75, style: "palace", bay: 30, from: "e", seatEvery: 15,
      arches: [
        { at: 104, marble: GREY_MARBLE }, { at: 64, marble: GREY_MARBLE }, { at: 17.1, marble: RED_MARBLE },
        { at: -20, marble: RED_MARBLE }, { at: -56.5, marble: RED_MARBLE }, { at: -96, marble: RED_MARBLE },
      ],
      look: {
        wall: "#918e8c", ground: "damier", trim: "#e7e4dc", ceiling: "#e2dfd8", light: DAY,
        room: {
          vault: "barrel", wallFinish: "panel", panelSeams: { every: 1.3 }, arches: undefined, glassHalfWidth: 3.8,
          panes: [8, 2], glazing: { bars: "#8f9aa0" }, daylight: "#e9f0f4", daylightLevel: 1.3, floorLane: 2.8,
          dado: { height: 0.75, color: "#6f5248" }, frieze: { height: 0.75, color: "#b5b2ad" },
          marble: GREY_MARBLE, pedestal: { height: 1.25, color: "#8a6449" }, archStone: "#85868a",
          nicheBays: "#dcd8cf", gilt: "#c9a24a", guard: CORD, noTrack: true, spot: SOFT, wallWash: 0.16,
          furniture: "lobed-borne",
        },
      },
    },
    {
      id: "sept-metres", name: "Salle des Sept-Mètres", no: "709",
      x0: 121.3, x1: 130.5, z0: -17.2, z1: 20.9, h: 8.6, style: "impressionist", bay: 19, from: "s",
      look: {
        wall: "#d9cfbb", ground: "damier", trim: "#aaa69c", ceiling: "#ece8df", light: DAY,
        frame: { style: "tabernacle", width: 0.1 },
        room: {
          ceiling: "vault", wallFinish: "plaster", coveRadius: 0.6, glassHalfWidth: 3.3,
          glazing: { bars: "#dcd9cf", heavy: [4, 4], pane: 0.55 }, daylight: GLASS, daylightLevel: 1.6, dado: { height: 0.32, color: "#a9a59b" }, guard: RAIL,
          noTrack: true, spot: SOFT, wallWash: 0.16, furniture: "museum",
        },
      },
    },
    {
      id: "salle-des-etats", name: "Salle des États", no: "711",
      x0: 41.5, x1: 62.0, z0: -18.4, z1: 20.0, h: 10.6, style: "museum",
      look: {
        wall: "#262e3d", ground: "damier", trim: STONE, ceiling: "#f1efe9", light: DAY,
        frame: { style: "baroque", color: "#d3a64e", width: 0.13, metalness: 1, roughness: 0.3 },
        room: {
          ceiling: "vault", wallFinish: "panel", panelSeams: { every: 2.2, across: 5.8 }, coveRadius: 1.2,
          glassHalfWidth: 6.6, glazing: { bars: "#e9e7e1", heavy: [4, 4], pane: 0.82 }, daylight: GLASS,
          daylightLevel: 1.5, dado: { height: 0.45, color: "#b0a897" }, guard: RAIL, noTrack: true, spot: SOFT,
          wallWash: 0.3,
          furniture: "museum",
        },
      },
    },
    {
      id: "salon-denon", name: "Salon Denon", no: "701",
      x0: 41.4, x1: 65.0, z0: -44.0, z1: -20.4, h: 11.4, style: "salon", rows: 2,
      look: {
        ...RED_ROOM, ceiling: "#3c3a3a",
        room: {
          ...RED_ROOM!.room, vault: "cloister", coveRadius: 8.6, coveRise: 6.5, brackets: true,
          attic: { height: 4.6, color: "#2b2523", setback: 2.6 },
          coveArt: { kind: "mural", color: "#b8924a", ground: "#4a4640" }, daylightLevel: 1.5, wallWash: 0.2,
        },
      },
    },
    {
      id: "salle-mollien", name: "Salle Mollien", no: "700",
      x0: -9.2, x1: 39.0, z0: -36.3, z1: -23.7, h: 10.0, style: "salon", bay: 24, from: "e", rows: 2, seatEvery: 9,
      look: RED_ROOM,
    },
    {
      id: "salle-daru", name: "Salle Daru", no: "702",
      x0: 67.4, x1: 119.0, z0: -36.3, z1: -23.7, h: 10.0, style: "salon", bay: 26, from: "w", rows: 2, seatEvery: 9,
      look: RED_ROOM,
    },
  ],
  doors: [
    // in from the Salle Duchâtel, as one comes from the Daru staircase
    { room: "salon-carre", to: null, side: "n", at: 153.9, w: 2.6, h: 5.6, entrance: true },
    { room: "salon-carre", to: null, side: "e", at: 25.5, w: 2.6, h: 5.6 },
    { room: "salon-carre", to: "grande-galerie", side: "w", at: 27.45, w: 3.2, h: 6.2 },
    { room: "grande-galerie", to: "sept-metres", side: "n", at: 125.8, w: 2.6, h: 4.8 },
    { room: "grande-galerie", to: "salle-des-etats", side: "n", at: 57.3, w: 2.8, h: 5.0 },
    { room: "grande-galerie", to: "salle-des-etats", side: "n", at: 46.2, w: 2.8, h: 5.0 },
    { room: "grande-galerie", to: null, side: "n", at: -18.3, w: 2.4, h: 4.6 },
    { room: "grande-galerie", to: null, side: "w", at: 27.45, w: 3.4, h: 6.2, arch: true },
    { room: "sept-metres", to: null, side: "n", at: 127.4, w: 2.2, h: 4.4 },
    { room: "salle-des-etats", to: "salon-denon", side: "n", at: 51.75, w: 5.2, h: 6.0 },
    { room: "salon-denon", to: "salle-mollien", side: "w", at: -26.5, w: 2.0, h: 5.6 },
    { room: "salon-denon", to: "salle-mollien", side: "w", at: -33.5, w: 2.0, h: 5.6 },
    { room: "salon-denon", to: "salle-daru", side: "e", at: -26.5, w: 2.0, h: 5.6 },
    { room: "salon-denon", to: "salle-daru", side: "e", at: -33.5, w: 2.0, h: 5.6 },
    // the Salon Denon's three windows on the Cour Napoléon
    { room: "salon-denon", to: null, side: "n", at: 46.2, w: 2.3, h: 5.4, window: true },
    { room: "salon-denon", to: null, side: "n", at: 53.2, w: 2.3, h: 5.4, window: true },
    { room: "salon-denon", to: null, side: "n", at: 60.2, w: 2.3, h: 5.4, window: true },
    // and one each side, where the pavilion stands out north of the red rooms
    { room: "salon-denon", to: null, side: "w", at: -40.3, w: 2.3, h: 5.4, window: true },
    { room: "salon-denon", to: null, side: "e", at: -40.3, w: 2.3, h: 5.4, window: true },
    { room: "salle-mollien", to: null, side: "w", at: -30.0, w: 3.0, h: 5.6 },
    { room: "salle-daru", to: null, side: "e", at: -30.0, w: 3.4, h: 6.2, arch: true },
  ],
  walls: [
    // the wall the Wedding at Cana hangs on, a passage round each end of it to the Salon Denon
    { id: "cana", room: "salle-des-etats", x0: 45.0, x1: 58.5, z0: -13.4, z1: -12.6, h: 10.0, portal: true, hang: true },
    // the Mona Lisa's, facing it across the room (Venetian pictures on its back)
    { id: "mona", room: "salle-des-etats", x0: 46.95, x1: 56.55, z0: 8.6, z1: 9.8, h: 8.4, portal: true, hang: true },
    // the Sept-Mètres: walls standing out from the east side, each in a frame of grey stone
    { id: "sept-1", room: "sept-metres", x0: 125.9, x1: 130.5, z0: 11.5, z1: 12.0, h: 7.6, portal: true, hang: true },
    { id: "sept-2", room: "sept-metres", x0: 125.9, x1: 130.5, z0: 4.0, z1: 4.5, h: 7.6, portal: true, hang: true },
    { id: "sept-3", room: "sept-metres", x0: 125.9, x1: 130.5, z0: -3.5, z1: -3.0, h: 7.6, portal: true, hang: true },
    { id: "sept-4", room: "sept-metres", x0: 125.9, x1: 130.5, z0: -11.0, z1: -10.5, h: 7.6, portal: true, hang: true },
    // the Salon Carré: tall panels standing out from the long walls
    { id: "carre-1", room: "salon-carre", x0: 142.6, x1: 143.1, z0: 17.6, z1: 22.4, h: 5.6, hang: true },
    { id: "carre-2", room: "salon-carre", x0: 147.6, x1: 148.1, z0: 17.6, z1: 22.4, h: 5.6, hang: true },
    { id: "carre-3", room: "salon-carre", x0: 142.6, x1: 143.1, z0: 28.6, z1: 33.4, h: 5.6, hang: true },
    { id: "carre-4", room: "salon-carre", x0: 150.4, x1: 150.9, z0: 28.6, z1: 33.4, h: 5.6, hang: true },
  ],
  pins: [
    { work: "paolo-veronese/the-wedding-at-cana-veronese", room: "salle-des-etats", wall: "cana", side: "s" },
    { work: "leonardo-da-vinci/mona-lisa", room: "salle-des-etats", wall: "mona", side: "n", shrine: true },
    { work: "jacques-louis-david/the-coronation-of-napoleon", room: "salle-daru", side: "n", at: 93 },
    { work: "jacques-louis-david/the-intervention-of-the-sabine-women", room: "salle-daru", side: "n", at: 108 },
    { work: "jacques-louis-david/oath-of-the-horatii", room: "salle-daru", side: "s", at: 108 },
    { work: "theodore-gericault/the-raft-of-the-medusa", room: "salle-mollien", side: "s", at: 20 },
    { work: "eugene-delacroix/liberty-leading-the-people", room: "salle-mollien", side: "s", at: 5 },
    { work: "eugene-delacroix/the-death-of-sardanapalus", room: "salle-mollien", side: "n", at: 9 },
  ],
  photos: [
    // the Salon Carré's ceiling, each side's own photograph over a neighbour's laid as its twin (the four sides
    // are alike but for their figures and names). South side (Painting), and under the north side's
    {
      room: "salon-carre", by: "Fernando Losada Rodríguez, CC BY-SA 4.0",
      src: "https://upload.wikimedia.org/wikipedia/commons/5/56/Techos_%28Murillo%29.003_-_Louvre_%28Paris%29.jpg", size: [5152, 3864],
      eye: [152.215, 1.6, 24.39], yaw: 2.675, pitch: 0.999, roll: -0.363, fov: 55.5, gain: [1.95, 1.6, 1.78], black: [0.005, 0.012, 0.007],
      on: [{ side: "s", part: "attic", relief: 0.14 }, { side: "s", part: "cove", relief: 0.55 }, { side: "n", part: "attic", turned: true }, { side: "n", part: "cove", turned: true }],
    },
    // west side (Architecture, over the door to the Grande Galerie), wide: under the closer one of it below
    {
      room: "salon-carre", by: "Sumit Surai, CC BY-SA 4.0",
      src: "https://upload.wikimedia.org/wikipedia/commons/1/12/Salon_Carr%C3%A9_Ceiling.jpg", size: [4314, 2600],
      eye: [142.753, 1.6, 25.647], yaw: 1.552, pitch: 1.191, roll: -0.014, fov: 42.539, gain: [1.57, 1.34, 1.19],
      on: [{ side: "w", part: "attic" }, { side: "w", part: "cove" }, { side: "e", part: "attic", turned: true }, { side: "e", part: "cove", turned: true }],
    },
    // north side (Music; Van Dyck, Leonardo and Michelangelo among its names)
    {
      room: "salon-carre", by: "Nathanael Burton, CC BY-SA 2.0",
      src: "https://upload.wikimedia.org/wikipedia/commons/d/df/Verri%C3%A8re_du_Salon_Carr%C3%A9_du_Louvre_%2815141165734%29.jpg", size: [4160, 2340],
      eye: [148.077, 1.6, 30.86], yaw: 0.056, pitch: 0.853, roll: 0.038, fov: 38.2, gain: [0.95, 0.86, 0.6], black: [0.085, 0.09, 0.1],
      on: [{ side: "n", part: "attic", relief: 0.14 }, { side: "n", part: "cove", relief: 0.55 }],
    },
    // west side again, closer; and the east side's attic as its twin
    {
      room: "salon-carre", by: "Gary Todd, CC0",
      src: "https://upload.wikimedia.org/wikipedia/commons/a/aa/Ceiling_of_the_Salon_Carr%C3%A9_%2828006313000%29.jpg", size: [5184, 3456],
      eye: [142.399, 1.6, 25.647], yaw: 1.566, pitch: 1.13, roll: -0.008, fov: 34.363, gain: 0.85,
      on: [{ side: "w", part: "attic", relief: 0.14 }, { side: "w", part: "cove", relief: 0.55 }, { side: "e", part: "attic", turned: true, relief: 0.14 }],
    },
    // east side (Sculpture): its cove
    {
      room: "salon-carre", by: "Gary Todd, CC0",
      src: "https://upload.wikimedia.org/wikipedia/commons/6/65/Ceiling_of_the_Salon_Carr%C3%A9_%2828183816982%29.jpg", size: [5184, 3456],
      eye: [149.367, 1.6, 25.937], yaw: -1.548, pitch: 1.015, roll: 0.02, fov: 28.304, gain: [0.73, 0.81, 0.77], black: [0.039, 0.046, 0.033],
      on: [{ side: "e", part: "cove", relief: 0.55 }],
    },
    // from the middle of the floor, straight up: the frame round the glass, and the four corners, where the
    // figures holding the shields stand out from the vault (two sides' photographs would each show half of one)
    {
      room: "salon-carre", by: "APK, CC BY-SA 4.0",
      src: "https://upload.wikimedia.org/wikipedia/commons/b/b0/Salon_Carr%C3%A9_ceiling.jpg", size: [1536, 2048],
      eye: [147.104, 1.7, 25.437], yaw: 1.573, pitch: 1.559, roll: 0, fov: 71.6, gain: [1.09, 1.47, 2.23],
      on: [
        { side: "n", part: "frame" }, { side: "s", part: "frame" }, { side: "w", part: "frame" }, { side: "e", part: "frame" },
        { side: "n", part: "cove", ends: 1.9, t: [0.3, 1], relief: 0.5 }, { side: "s", part: "cove", ends: 1.9, t: [0.3, 1], relief: 0.5 },
        { side: "w", part: "cove", ends: 1.9, t: [0.3, 1], relief: 0.5 }, { side: "e", part: "cove", ends: 1.9, t: [0.3, 1], relief: 0.5 },
      ],
    },
    // the Salon Denon's vault (Charles-Louis Müller's four scenes of the arts under the kings, 1863–66; the eagles
    // and palms of its corners; its windows and the figures between them), from the middle of the floor
    {
      room: "salon-denon", by: "Sini Merikallio, CC BY-SA 2.0",
      src: "https://upload.wikimedia.org/wikipedia/commons/c/c2/Ceiling_of_the_Salon_Denon%2C_Louvre_2011.jpg", size: [5457, 3642],
      eye: [52.899, 1.6, -32.397], yaw: 1.571, pitch: 1.574, roll: 0, fov: 101.9, gain: 0.9,
      on: [
        { side: "n", part: "attic", plain: true }, { side: "s", part: "attic", plain: true },
        { side: "w", part: "attic", plain: true }, { side: "e", part: "attic", plain: true },
        { side: "n", part: "cove" }, { side: "s", part: "cove" }, { side: "w", part: "cove" }, { side: "e", part: "cove" },
        { side: "n", part: "top" },
      ],
    },
  ],
};

export const SPACES: Space[] = [LOUVRE_DENON];

export const spaceById = (id: string | null | undefined): Space | null => SPACES.find((s) => s.id === id) ?? null;
