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
// is the rectangle of its wall faces; the gap between two rooms is the wall between them. Heights, colours and
// materials are from the museum's own descriptions and photographs of the rooms (sources by each space).

import type { EraKey, RoomLook } from "@/components/museum/theme";

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
   *  (x or z, m). */
  arches?: "bays" | number[];
  /** The lowest a frame hangs (m; default 0.45, or above the plinth). */
  minBottom?: number;
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
}

export interface Space {
  id: string;
  name: string;
  rooms: SpaceRoom[];
  doors: SpaceDoor[];
  walls: SpaceWall[];
  pins: SpacePin[];
}

// The Louvre, Denon wing, first floor: the rooms of Italian painting and of the large French canvases.
//
// Plan: OpenStreetMap's indoor survey in the building's own frame (u along the Grande Galerie, v across it:
// node scripts/osm-rooms.mjs 48.8585,2.3300,48.8640,2.3410 1 "Grande Galerie"), here x = u + 20.8,
// z = −v − 121.6. The Grande Galerie, 269 m by 12.4, along the Seine; at its east end the Salon Carré
// (24 by 17.6); off its north wall, two doors into the Salle des États (23 by 39: the Wedding at Cana on a wall of
// its own at the north end, a passage round each end of it to the Salon Denon); Denon between the Salle Mollien to
// the west and the Salle Daru to the east (each about 50 by 18, two doors each side of Denon with a painting
// between them); the Salle des Sept-Mètres north of the Grande Galerie's east end. Doors to the stairs (Daru,
// Mollien), to the Galerie d'Apollon and to the Spanish rooms stay shut.
//
// Look: photographs of the rooms on Wikimedia Commons, 2018–2024. Every floor is pale oak in wide chevrons. The
// Grande Galerie: grey-beige fabric panels over a low stone plinth, a frieze of grey marble under the cornice, a
// plain cream barrel vault with a long skylight, cut every 30 m by an arch on paired columns of dark veined marble
// with gilt capitals, on high pedestals. The Salle des États (2019): midnight blue panels, white coves under a
// great grid of glass, the Mona Lisa's wall and the Cana wall in surrounds of pale stone. Mollien and Daru: dark
// red panels over a black plinth, a gilt cornice, red coves ribbed in gilt round a long skylight, doors cased in
// dark wood, plain black benches. The Salon Carré and the Sept-Mètres: cream.
//
// Not measured: the heights (estimated from the photographs: a door, a visitor, the Coronation of Napoleon), and
// how many arches cross the Grande Galerie (one every 30 m here).
const DAY = { spot: "#fff3e2", ambient: "#f1eee8" };
const GLASS = "#f3f5f6";
// (daylit rooms: the spots only lift the pictures a little, without a pool on the wall)
const SOFT = { level: 0.3, penumbra: 1 };
const RED = "#7d2a2c";
const BLACK_PLINTH = { height: 0.45, color: "#2a2625" };
const RED_ROOM: SpaceRoom["look"] = {
  wall: RED, ground: "chevron", trim: "#2b1f1a", ceiling: "#7a2c2a", light: DAY,
  room: {
    wallFinish: "panel", arches: undefined, coveRadius: 3.2, panes: [8, 5], daylight: GLASS, daylightLevel: 1.7,
    dado: BLACK_PLINTH, giltCornice: true, noTrack: true, spot: SOFT, wallWash: 0,
    furniture: "museum",
  },
};
const LOUVRE_DENON: Space = {
  id: "louvre-denon",
  name: "The Louvre · Denon wing, first floor",
  rooms: [
    {
      id: "salon-carre", name: "Salon Carré", no: "708",
      x0: 136.1, x1: 160.1, z0: 16.7, z1: 34.3, h: 9.4, style: "salon",
      look: {
        wall: "#d6cfc0", ground: "chevron", trim: "#cfc7b6", ceiling: "#b9a36a", light: DAY,
        frame: { style: "tabernacle", width: 0.11 },
        room: {
          wallFinish: "panel", arches: undefined, coveRadius: 3.4, daylight: GLASS, daylightLevel: 1.7,
          dado: { height: 0.3, color: "#bdb5a4" }, giltCornice: true, noTrack: true,
          spot: SOFT, wallWash: 0.16, furniture: "museum",
        },
      },
    },
    {
      id: "grande-galerie", name: "Grande Galerie", no: "710 · 712 · 716",
      x0: -135.4, x1: 134.0, z0: 21.3, z1: 33.7, h: 6.6, style: "palace", bay: 30, from: "e", arches: "bays",
      look: {
        wall: "#aaa294", ground: "chevron", trim: "#dfd9cc", ceiling: "#efe9dc", light: DAY,
        room: {
          wallFinish: "panel", arches: undefined, coveRadius: 3.7, coveRise: 4.6, panes: [6, 4], daylight: GLASS,
          daylightLevel: 1.7, dado: { height: 0.75, color: "#7b756c" }, frieze: { height: 1.0, color: "#909396" },
          marble: "#63494d", pedestal: { height: 1.15, color: "#33362f" }, archStone: "#8b8e91", noTrack: true,
          spot: SOFT, wallWash: 0.16, furniture: "museum",
        },
      },
    },
    {
      id: "sept-metres", name: "Salle des Sept-Mètres", no: "709",
      x0: 121.0, x1: 131.0, z0: -17.8, z1: 20.0, h: 7.6, style: "impressionist", bay: 19, from: "s",
      look: {
        wall: "#d3c9b4", ground: "chevron", trim: "#b9b3a6", ceiling: "#ece8df", light: DAY,
        frame: { style: "tabernacle", width: 0.1 },
        room: {
          wallFinish: "panel", glassHalfWidth: 3.2, panes: [6, 4], daylight: GLASS, daylightLevel: 1.7,
          dado: { height: 0.3, color: "#a9a396" }, noTrack: true, spot: SOFT, wallWash: 0.16,
          furniture: "museum",
        },
      },
    },
    {
      id: "salle-des-etats", name: "Salle des États", no: "711",
      x0: 40.4, x1: 63.0, z0: -19.2, z1: 20.0, h: 9.2, style: "museum",
      look: {
        wall: "#222e45", ground: "chevron", trim: "#b9ae9a", ceiling: "#f1efe9", light: DAY,
        frame: { style: "baroque", color: "#d3a64e", width: 0.13, metalness: 1, roughness: 0.3 },
        room: {
          ceiling: "vault", wallFinish: "panel", coveRadius: 2.6, panes: [10, 4], daylight: GLASS, daylightLevel: 1.7,
          dado: { height: 0.35, color: "#b3a996" }, noTrack: true, spot: SOFT, wallWash: 0.1,
          furniture: "museum",
        },
      },
    },
    {
      id: "salon-denon", name: "Salon Denon", no: "701",
      x0: 40.2, x1: 66.4, z0: -41.0, z1: -21.0, h: 10.0, style: "salon",
      look: { ...RED_ROOM, ceiling: "#6f5a3a", room: { ...RED_ROOM!.room, coveRadius: 3.6 } },
    },
    {
      id: "salle-mollien", name: "Salle Mollien", no: "700",
      x0: -10.0, x1: 39.0, z0: -39.6, z1: -21.2, h: 9.2, style: "salon", bay: 25, from: "e",
      look: RED_ROOM,
    },
    {
      id: "salle-daru", name: "Salle Daru", no: "702",
      x0: 67.6, x1: 119.6, z0: -37.7, z1: -20.0, h: 9.2, style: "salon", bay: 26, from: "w",
      look: RED_ROOM,
    },
  ],
  doors: [
    // in from the Salle Duchâtel, as one comes from the Daru staircase
    { room: "salon-carre", to: null, side: "n", at: 153.9, w: 2.4, h: 5.0, entrance: true },
    { room: "salon-carre", to: null, side: "e", at: 25.5, w: 2.4, h: 5.0 },
    { room: "salon-carre", to: "grande-galerie", side: "w", at: 28.4, w: 3.0, h: 5.6 },
    { room: "grande-galerie", to: "sept-metres", side: "n", at: 125.6, w: 2.2, h: 4.2 },
    { room: "grande-galerie", to: "salle-des-etats", side: "n", at: 57.4, w: 2.6, h: 4.6 },
    { room: "grande-galerie", to: "salle-des-etats", side: "n", at: 46.3, w: 2.6, h: 4.6 },
    { room: "grande-galerie", to: null, side: "n", at: -18.2, w: 2.4, h: 4.4 },
    { room: "grande-galerie", to: null, side: "w", at: 27.6, w: 3.2, h: 5.4, arch: true },
    { room: "sept-metres", to: null, side: "n", at: 126.0, w: 2.2, h: 4.2 },
    { room: "salle-des-etats", to: "salon-denon", side: "n", at: 52.75, w: 5.7, h: 5.6 },
    { room: "salon-denon", to: "salle-mollien", side: "w", at: -26.5, w: 1.7, h: 3.6 },
    { room: "salon-denon", to: "salle-mollien", side: "w", at: -34.1, w: 1.7, h: 3.6 },
    { room: "salon-denon", to: "salle-daru", side: "e", at: -25.8, w: 1.7, h: 3.6 },
    { room: "salon-denon", to: "salle-daru", side: "e", at: -31.9, w: 1.7, h: 3.6 },
    { room: "salle-mollien", to: null, side: "w", at: -31.4, w: 3.0, h: 5.2 },
    { room: "salle-daru", to: null, side: "e", at: -28.1, w: 3.2, h: 5.6, arch: true },
  ],
  walls: [
    // the wall the Wedding at Cana hangs on, a passage round each end of it to the Salon Denon
    { id: "cana", room: "salle-des-etats", x0: 45.6, x1: 59.8, z0: -13.9, z1: -13.1, h: 8.9 },
    // the Mona Lisa's, facing it across the room
    { id: "mona", room: "salle-des-etats", x0: 46.9, x1: 56.5, z0: 8.2, z1: 9.4, h: 8.0 },
  ],
  pins: [
    { work: "paolo-veronese/the-wedding-at-cana-veronese", room: "salle-des-etats", wall: "cana", side: "s" },
    { work: "leonardo-da-vinci/mona-lisa", room: "salle-des-etats", wall: "mona", side: "n" },
    { work: "jacques-louis-david/the-coronation-of-napoleon", room: "salle-daru", side: "n" },
    { work: "theodore-gericault/the-raft-of-the-medusa", room: "salle-mollien", side: "n" },
    { work: "eugene-delacroix/liberty-leading-the-people", room: "salle-mollien", side: "s" },
  ],
};

export const SPACES: Space[] = [LOUVRE_DENON];

export const spaceById = (id: string | null | undefined): Space | null => SPACES.find((s) => s.id === id) ?? null;
