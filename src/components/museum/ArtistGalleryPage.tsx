import { preload } from "react-dom";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTimeline } from "@/lib/data";
import { loadArtistGallery, artistGalleryFloor } from "@/lib/artist-gallery";
import { relatedArtists } from "@/lib/rooms";
import type { GalleryLink } from "@/lib/types";
import { FLAGSHIP_THUMB_PX, paintingTextureUrl, wallTexturePx } from "@/lib/img";
import { buildLayout, entryPreloads } from "@/components/museum/layout";
import { MuseumApp } from "@/components/museum/MuseumApp";
import { galleryTheme } from "@/components/museum/theme";

/** The two artists most related to this one (src/lib/rooms.ts relatedArtists): the doors at the end of the
 *  gallery. Without the room index, the artists before and after in the timeline's order (by period, then birth),
 *  the first and the last leading back to the timeline. */
async function neighbours(slug: string): Promise<{ prev: GalleryLink | null; next: GalleryLink | null }> {
  const { periods, artists } = await getTimeline();
  const order = new Map(periods.map((p, i) => [p.slug, i]));
  const names = new Map(periods.map((p) => [p.slug, p.name]));
  const hung = artists.filter((a) => a.paintingCount > 0);
  const bySlug = new Map(hung.map((a) => [a.slug, a]));
  const kin = relatedArtists(slug, hung).flatMap((r) => {
    const a = bySlug.get(r.slug);
    return a ? [{ a, why: r.why }] : [];
  });
  if (kin.length === 2) {
    const [prev, next] = kin.map(
      ({ a, why }): GalleryLink => ({
        slug: a.slug,
        name: a.name,
        birthYear: a.birthYear,
        deathYear: a.deathYear,
        periodName: names.get(a.periodSlug) ?? "",
        why,
      })
    );
    return { prev, next };
  }
  const list = hung
    .sort(
      (a, b) =>
        (order.get(a.periodSlug) ?? 1e3) - (order.get(b.periodSlug) ?? 1e3) ||
        (a.birthYear ?? 3000) - (b.birthYear ?? 3000) ||
        a.name.localeCompare(b.name)
    );
  const i = list.findIndex((a) => a.slug === slug);
  const link = (a: (typeof list)[number] | undefined): GalleryLink | null =>
    a && i >= 0
      ? { slug: a.slug, name: a.name, birthYear: a.birthYear, deathYear: a.deathYear, periodName: names.get(a.periodSlug) ?? "" }
      : null;
  return { prev: link(list[i - 1]), next: link(list[i + 1]) };
}

export async function galleryMetadata(slug: string, floor = 1): Promise<Metadata> {
  const gallery = await loadArtistGallery(slug);
  const artist = gallery?.artist;
  if (!artist) return {};
  const life =
    artist.birthYear != null ? ` (${artist.birthYear}–${artist.deathYear ?? ""})` : "";
  return {
    title: `${artist.name}${floor > 1 ? ` · Floor ${floor}` : ""} · A Walkable History of Art`,
    description: `Walk a 3D gallery of ${artist.paintingCount} works by ${artist.name}${life}, ${artist.periodName}, with their stories from Wikipedia.`,
  };
}

export async function ArtistGalleryPage({ slug, floor = 1 }: { slug: string; floor?: number }) {
  const gallery = await loadArtistGallery(slug);
  const artist = gallery && artistGalleryFloor(gallery, floor);
  if (!artist || artist.paintings.length === 0) notFound();

  // Start the textures the entry doors wait for downloading while the JS
  // bundle loads: the flagship (at wall resolution where it hangs in the
  // entrance room, as a thumbnail rooms away) plus the two works nearest the
  // doors, with the exact URLs the gallery will request. PaintingExhibit
  // loads them with fetch(url, { mode: "cors", credentials: "same-origin" }),
  // which a crossorigin="anonymous" as="fetch" preload matches.
  // (the same layout the gallery builds: the period's room decides how
  // works of unknown size are hung)
  const layout = buildLayout(artist.paintings, {
    works: galleryTheme(artist.periodSlug).works,
    exits: true,
    elevator: (artist.gallery?.floors.length ?? 0) > 1,
    phases: artist.phases?.map((p) => p.name),
    films: !!artist.films?.length,
  });
  const bySlug = new Map(artist.paintings.map((p) => [p.slug, p]));
  entryPreloads(layout, 2).forEach(({ slug: s, thumb }, i) => {
    const p = bySlug.get(s);
    const url = p && paintingTextureUrl(p, thumb ? FLAGSHIP_THUMB_PX : wallTexturePx(p));
    if (!url) return; // no image (© canvas): nothing to fetch
    preload(url, {
      as: "fetch",
      crossOrigin: "anonymous",
      fetchPriority: i === 0 ? "high" : "auto",
    });
  });

  return <MuseumApp artist={artist} neighbours={await neighbours(slug)} key={`${slug}/${floor}`} />;
}
