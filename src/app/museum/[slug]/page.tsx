import { cache } from "react";
import { preload } from "react-dom";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArtist, getArtistSlugs, getTimeline } from "@/lib/data";
import { withPhases } from "@/lib/phases";
import type { GalleryLink } from "@/lib/types";
import { FLAGSHIP_THUMB_PX, paintingTextureUrl, wallTexturePx } from "@/lib/img";
import { buildLayout, entryPreloads } from "@/components/museum/layout";
import { MuseumApp } from "@/components/museum/MuseumApp";
import { galleryTheme } from "@/components/museum/theme";

// Every gallery is prerendered at build time (from the JSON cache when the
// database is unavailable) and regenerated in the background at most hourly.
export const revalidate = 3600;

// Only the prerendered slugs are served; any other /museum/<slug> is a 404
// without rendering. With the default (true) every unknown slug was rendered
// (one database query each) and its 404 cached to disk as an ISR entry, so
// requests for random slugs grew the cache without bound.
// Trade-off: generateStaticParams runs only at build time (not on
// revalidation, and on-demand revalidation cannot add a path either), so an
// artist added by `npm run load-db` gets a gallery at the next build/deploy -
// load-db lists such slugs. Existing galleries still pick up reloaded data
// within the hour. Keeping runtime discovery instead would need a proxy.ts
// allow-list backed by the database, which the Proxy docs advise against
// (no shared modules or globals there).
export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return (await getArtistSlugs()).map((slug) => ({ slug }));
}

// Dedupes the read between generateMetadata and the page. The artist's phases, when known, shape the rooms.
const loadArtist = cache(async (slug: string) => {
  const a = await getArtist(slug);
  return a && withPhases(a);
});

/** The artists before and after this one in the timeline's order (by period, then birth): the doors at the end
 *  of the gallery. The first and the last lead back to the timeline. */
async function neighbours(slug: string): Promise<{ prev: GalleryLink | null; next: GalleryLink | null }> {
  const { periods, artists } = await getTimeline();
  const order = new Map(periods.map((p, i) => [p.slug, i]));
  const names = new Map(periods.map((p) => [p.slug, p.name]));
  const list = artists
    .filter((a) => a.paintingCount > 0)
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

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const artist = await loadArtist((await params).slug);
  if (!artist) return {};
  const life =
    artist.birthYear != null ? ` (${artist.birthYear}–${artist.deathYear ?? ""})` : "";
  return {
    title: `${artist.name} · A Walkable History of Art`,
    description: `Walk a 3D gallery of ${artist.paintingCount} works by ${artist.name}${life}, ${artist.periodName}, with their stories from Wikipedia.`,
  };
}

export default async function MuseumPage({ params }: Props) {
  const { slug } = await params;
  const artist = await loadArtist(slug);
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
    phases: artist.phases?.map((p) => p.name),
    screening: !!artist.films?.length,
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

  return <MuseumApp artist={artist} neighbours={await neighbours(slug)} key={slug} />;
}
