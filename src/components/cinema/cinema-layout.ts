// The cinema's room: one hall (the museum's coordinates: the entrance wall at +z, the screen on the far wall at
// -z), rows of seats facing the screen either side of an aisle, and a projector on its stand behind the last
// row, so the beam runs over the seats to the screen. The museum's walking (Controls.tsx) reads it as a gallery
// layout with no paintings: the hall's walls, the seat rows, the stage and the stand to walk round, and the seats
// to sit in (C).

import { buildLayout, type Furnishing, type GalleryLayout, type SeatSpot } from "@/components/museum/layout";

export const HALL = { W: 11, L: 19, H: 7.2 } as const;

/** The screen's frame (the largest picture: 16:9), on the far wall. */
export const SCREEN = { w: 8.4, h: 4.725, bottom: 1.25, z: -HALL.L / 2 + 0.16 } as const;
export const SCREEN_CY = SCREEN.bottom + SCREEN.h / 2;

/** The stage in front of the screen (one can jump onto it). */
export const STAGE = { w: 9.4, depth: 1.4, h: 0.42 } as const;

/** Rows of seats: the front row's centre line, the pitch, two blocks either side of the aisle. */
export const ROWS = { count: 6, front: -HALL.L / 2 + 5.0, pitch: 1.1, perBlock: 5, seatW: 0.62, aisle: 1.4, depth: 0.78 };
export const SEAT_H = 0.46;

/** The projector on its stand behind the last row, its lens above the visitors' heads. */
export const PROJECTOR = { x: 0, z: HALL.L / 2 - 6.2, lens: 2.32 } as const;
/** The door at the back, to one side as a cinema's are: one walks in seeing the projector three-quarter on, its
 *  beam running ahead to the screen. */
export const DOOR = { x: -3.2, halfWidth: 0.95 } as const;
/** The way one faces on coming in: a little toward the middle (radians, right of straight ahead). */
export const ENTRY_YAW = 0.36;
/** The lens, a little in front of the stand's centre. */
export const LENS: [number, number, number] = [PROJECTOR.x, PROJECTOR.lens, PROJECTOR.z - 0.56];

export function blockX(side: -1 | 1): number {
  return side * (ROWS.aisle / 2 + (ROWS.perBlock * ROWS.seatW) / 2);
}
export function rowZ(i: number): number {
  return ROWS.front + i * ROWS.pitch;
}

/** Every seat's centre on the floor. */
export function seatCentres(): { x: number; z: number; row: number }[] {
  const out: { x: number; z: number; row: number }[] = [];
  for (let r = 0; r < ROWS.count; r++) {
    for (const side of [-1, 1] as const) {
      const x0 = blockX(side) - (ROWS.perBlock * ROWS.seatW) / 2 + ROWS.seatW / 2;
      for (let i = 0; i < ROWS.perBlock; i++) out.push({ x: x0 + i * ROWS.seatW, z: rowZ(r), row: r });
    }
  }
  return out;
}

/** The picture on the screen for a film of this shape: as large as the frame allows, centred. */
export function pictureRect(aspect: number): { w: number; h: number; cx: number; cy: number } {
  const a = aspect > 0 ? aspect : 16 / 9;
  const w = Math.min(SCREEN.w, SCREEN.h * a);
  return { w, h: w / a, cx: 0, cy: SCREEN_CY };
}

export function cinemaLayout(): GalleryLayout {
  const base = buildLayout([]);
  const piece = (position: [number, number], size: [number, number], top?: number): Furnishing => ({
    kind: "chair", index: 0, position, rotation: 0, size, room: 0, tint: 0, ...(top ? { top } : {}),
  });
  const furniture: Furnishing[] = [
    // the stage, against the screen wall
    piece([0, -HALL.L / 2 + STAGE.depth / 2], [STAGE.w, STAGE.depth], STAGE.h),
    // the projector's stand
    piece([PROJECTOR.x, PROJECTOR.z], [0.9, 1.1]),
  ];
  for (let r = 0; r < ROWS.count; r++) {
    for (const side of [-1, 1] as const) furniture.push(piece([blockX(side), rowZ(r)], [ROWS.perBlock * ROWS.seatW, ROWS.depth]));
  }
  // facing the screen (ry π: toward -z)
  const seats: SeatSpot[] = seatCentres().map((s) => ({ x: s.x, z: s.z - 0.04, h: SEAT_H, ry: Math.PI, room: 0 }));
  return {
    ...base,
    hallWidth: HALL.W,
    hallLength: HALL.L,
    wallHeight: HALL.H,
    furniture,
    seats,
    rooms: [{ ...base.rooms[0], z0: -HALL.L / 2, z1: HALL.L / 2 }],
  };
}
