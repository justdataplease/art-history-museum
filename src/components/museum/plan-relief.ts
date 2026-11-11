// Relief for a photographed ceiling (plan-geometry.ts lays a photograph of the real ceiling on its surfaces): the
// picture alone is flat, so what stands out in the room (white stucco figures, gilt frames round darker grounds)
// is raised from the surface it lies on, by how light it is in the photograph, and each raised point is given the
// place it then has in the picture. From where the photograph was taken nothing changes; from anywhere else the
// figures stand before their ground, hide it and shift against it as one walks.

import * as THREE from "three";
import { photoUV, type PlanPhoto } from "./plan-nav";

/** How light the photograph is, smoothed: 0 (a dark ground) .. 1 (white stucco), on a grid `w` wide. */
export interface ReliefMap {
  w: number;
  h: number;
  light: Float32Array;
}

/** The photograph's lightness, as the model shows it (its black and gain taken), blurred over a few centimetres. */
export function reliefMap(image: CanvasImageSource & { width: number; height: number }, photo: Pick<PlanPhoto, "black" | "gain">, width = 448): ReliefMap | null {
  const w = width;
  const h = Math.max(2, Math.round((width * image.height) / image.width));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  let data: Uint8ClampedArray;
  try {
    ctx.drawImage(image, 0, 0, w, h);
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // (a picture the canvas may not read: the ceiling stays flat)
    return null;
  }
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  let light = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = Math.max(0, lin(data[i * 4]) - photo.black[0]) * photo.gain[0];
    const g = Math.max(0, lin(data[i * 4 + 1]) - photo.black[1]) * photo.gain[1];
    const b = Math.max(0, lin(data[i * 4 + 2]) - photo.black[2]) * photo.gain[2];
    // perceptual lightness, more or less
    light[i] = Math.min(1, Math.sqrt(0.2126 * r + 0.7152 * g + 0.0722 * b));
  }
  // two passes of a small box blur
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            s += light[yy * w + xx];
            n++;
          }
        out[y * w + x] = s / n;
      }
    light = out;
  }
  return { w, h, light };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How far a point of the picture stands out, 0..1: a little for gilt and pale mouldings, fully for white stucco. */
function standing(map: ReliefMap, u: number, v: number): number {
  const x = Math.min(map.w - 1.001, Math.max(0, u * (map.w - 1)));
  const y = Math.min(map.h - 1.001, Math.max(0, (1 - v) * (map.h - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx: number, yy: number) => map.light[yy * map.w + xx];
  const l = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
  return 0.22 * smooth(0.3, 0.55, l) + 0.78 * Math.pow(smooth(0.6, 0.88, l), 1.4);
}

/**
 * Raise a photographed surface where the photograph says something stands out. The geometry (plan-geometry.ts)
 * holds, for each point: where it lies flat (`aFlat`), the way its surface faces (`aOut`), how far it may be raised
 * in metres (`aRelief`), and whether it shows the room's other end (`aTurn`: the photograph is looked up turned
 * about `centre`).
 */
export function applyRelief(geometry: THREE.BufferGeometry, photo: PlanPhoto, map: ReliefMap, centre: [number, number]): void {
  const flat = geometry.getAttribute("aFlat") as THREE.BufferAttribute | undefined;
  const out = geometry.getAttribute("aOut") as THREE.BufferAttribute | undefined;
  const relief = geometry.getAttribute("aRelief") as THREE.BufferAttribute | undefined;
  const turn = geometry.getAttribute("aTurn") as THREE.BufferAttribute | undefined;
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  if (!flat || !out || !relief || !turn) return;
  for (let i = 0; i < pos.count; i++) {
    const depth = relief.getX(i);
    if (depth <= 0) continue;
    const k = depth * standing(map, uv.getX(i), uv.getY(i));
    const x = flat.getX(i) + out.getX(i) * k;
    const y = flat.getY(i) + out.getY(i) * k;
    const z = flat.getZ(i) + out.getZ(i) * k;
    pos.setXYZ(i, x, y, z);
    const turned = turn.getX(i) > 0.5;
    const t = photoUV(photo, turned ? 2 * centre[0] - x : x, y, turned ? 2 * centre[1] - z : z);
    if (t) uv.setXY(i, t[0], t[1]);
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
