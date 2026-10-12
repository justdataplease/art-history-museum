import "server-only";
import { cache } from "react";
import { getArtist } from "./data";
import { withPhases } from "./phases";
import type { ArtistWithPaintings, Painting } from "./types";
import { splitGalleryFloors } from "@/components/museum/gallery-floors";
import { galleryTheme } from "@/components/museum/theme";

export const loadArtistGallery = cache(async (slug: string) => {
  const found = await getArtist(slug);
  if (!found) return null;
  const artist = withPhases(found);
  const floors = splitGalleryFloors(artist.paintings, {
    works: galleryTheme(artist.periodSlug).works,
    phases: artist.phases?.map((p) => p.name),
    films: !!artist.films?.length,
  });
  return { artist, floors };
});

export function artistGalleryFloor(
  { artist, floors }: { artist: ArtistWithPaintings; floors: Painting[][] }, floor: number,
): ArtistWithPaintings | null {
  if (!Number.isInteger(floor) || floor < 1 || floor > floors.length) return null;
  if (floors.length === 1) return artist;
  return {
    ...artist,
    paintings: floors[floor - 1],
    films: floor === 1 ? artist.films : undefined,
    gallery: {
      floor,
      floors: floors.map((works, i) => {
        const years = works.flatMap((p) => p.year == null ? [] : [p.year]);
        const from = Math.min(...years), to = Math.max(...years);
        const yearsLabel = years.length ? ` · ${from === to ? from : `${from}–${to}`}` : "";
        return {
          label: `Floor ${i + 1}${yearsLabel}`,
          href: `/museum/${artist.slug}${i ? `/floor/${i + 1}` : ""}`,
          works: works.length,
          number: i + 1,
        };
      }),
    },
  };
}
