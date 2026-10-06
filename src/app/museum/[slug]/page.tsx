import { cache } from "react";
import { preload } from "react-dom";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArtist, getArtistSlugs } from "@/lib/data";
import { FLAGSHIP_THUMB_PX, paintingTextureUrl, wallTexturePx } from "@/lib/img";
import { buildLayout, entryPreloads } from "@/components/museum/layout";
import { MuseumApp } from "@/components/museum/MuseumApp";

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

// Dedupes the read between generateMetadata and the page.
const loadArtist = cache(getArtist);

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const artist = await loadArtist((await params).slug);
  if (!artist) return {};
  const life =
    artist.birthYear != null ? ` (${artist.birthYear}–${artist.deathYear ?? ""})` : "";
  return {
    title: `${artist.name} · The Timeline Museum`,
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
  const layout = buildLayout(artist.paintings);
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

  return <MuseumApp artist={artist} />;
}
