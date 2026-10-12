import type { Painting } from "@/lib/types";
import { buildLayout, type LayoutOptions } from "./layout";

export const MAX_ROOMS_PER_FLOOR = 6;

/** Partition at room boundaries, preserving every work and its phase. A floor's own flagship can change
 * its room count, so check the resulting smaller layout too. Only the first floor has the films' corner. */
export function splitGalleryFloors(paintings: Painting[], options: LayoutOptions = {}): Painting[][] {
  const floors: Painting[][] = [];
  const split = (works: Painting[]) => {
    const layout = buildLayout(works, { ...options, films: !!options.films && floors.length === 0 });
    if (layout.rooms.length <= MAX_ROOMS_PER_FLOOR) {
      floors.push(works);
      return;
    }
    const floorOf = new Map(layout.placements.map((p) => [p.painting.slug, Math.floor(p.room / MAX_ROOMS_PER_FLOOR)]));
    const groups: Painting[][] = Array.from({ length: Math.ceil(layout.rooms.length / MAX_ROOMS_PER_FLOOR) }, () => []);
    for (const work of works) groups[floorOf.get(work.slug)!].push(work);
    for (const group of groups) if (group.length) split(group);
  };
  split(paintings);
  return floors;
}
