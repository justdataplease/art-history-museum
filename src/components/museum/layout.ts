import type { Painting } from "@/lib/types";

export interface Placement {
  painting: Painting;
  position: [number, number, number];
  rotationY: number;
  w: number; // canvas width in meters
  h: number; // canvas height in meters
}

export interface GalleryLayout {
  hallWidth: number;
  hallLength: number;
  wallHeight: number;
  placements: Placement[];
}

const EYE = 1.55; // painting centerline height

// Distance from the wall face to a placement's origin. The frame backing
// extends 0.024 behind the origin, so this leaves a ~4 mm air gap that
// avoids z-fighting while keeping the frame visually flush with the wall.
export const WALL_GAP = 0.028;

// Lighting track: rails run the length of the hall TRACK_INSET metres in from
// each side wall, plus a cross rail TRACK_INSET in front of the far end wall,
// all hanging TRACK_DROP below the ceiling. Spot fixtures clamp onto these.
export const TRACK_INSET = 2.0;
export const TRACK_DROP = 0.32;

function canvasSize(p: Painting): { w: number; h: number } {
  const aspect =
    p.imageWidth && p.imageHeight ? p.imageWidth / p.imageHeight : 0.8;
  if (aspect >= 1.4) {
    // wide landscape — let it breathe
    const w = Math.min(2.9, 1.1 * aspect + 0.6);
    return { w, h: w / aspect };
  }
  const h = aspect < 0.8 ? 1.75 : 1.55;
  return { w: h * aspect, h };
}

export function buildLayout(paintings: Painting[]): GalleryLayout {
  const hallWidth = 9.2;
  const wallHeight = 4.7;
  const [anchor, ...rest] = paintings;
  const perSide = Math.ceil(rest.length / 2);
  const spacing = 3.6;
  const hallLength = Math.max(15, perSide * spacing + 6.5);
  const placements: Placement[] = [];

  // Anchor piece on the far end wall.
  {
    const { w, h } = canvasSize(anchor);
    placements.push({
      painting: anchor,
      position: [0, EYE + 0.1, -hallLength / 2 + WALL_GAP],
      rotationY: 0,
      w,
      h,
    });
  }

  // Remaining works alternate left / right walls, chronological toward the anchor.
  const zStart = hallLength / 2 - 4.2;
  rest.forEach((p, i) => {
    const side = i % 2 === 0 ? -1 : 1; // -1 = left wall
    const slot = Math.floor(i / 2);
    const { w, h } = canvasSize(p);
    placements.push({
      painting: p,
      position: [side * (hallWidth / 2 - WALL_GAP), EYE, zStart - slot * spacing],
      rotationY: side === -1 ? Math.PI / 2 : -Math.PI / 2,
      w,
      h,
    });
  });

  return { hallWidth, hallLength, wallHeight, placements };
}

/** Where the camera should stand to inspect a placement head-on. */
export function inspectPose(
  pl: Placement,
  fovDeg: number,
  aspect: number
): { position: [number, number, number]; lookAt: [number, number, number] } {
  const fov = (fovDeg * Math.PI) / 180;
  const fitH = pl.h / (2 * Math.tan(fov / 2));
  const fitW = pl.w / (2 * Math.tan(fov / 2) * aspect);
  const dist = Math.max(fitH, fitW) * 1.25 + 0.35;
  const nx = Math.sin(pl.rotationY);
  const nz = Math.cos(pl.rotationY);
  return {
    position: [
      pl.position[0] + nx * dist,
      pl.position[1],
      pl.position[2] + nz * dist,
    ],
    lookAt: pl.position,
  };
}
