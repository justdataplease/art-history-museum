import { cache } from "react";
import { preload } from "react-dom";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArtist, getArtistSlugs } from "@/lib/data";
import { paintingTextureUrl, wallTexturePx } from "@/lib/img";
import { buildLayout, entryGateSlugs } from "@/components/museum/layout";
import { MuseumApp } from "@/components/museum/MuseumApp";

// Every gallery is prerendered at build time (from the JSON cache when the
// database is unavailable) and regenerated in the background at most hourly.
// Slugs added later render on first request and are then cached
// (dynamicParams defaults to true); unknown slugs 404.
export const revalidate = 3600;

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

  // Start the first wall textures downloading while the JS bundle loads:
  // the far-wall flagship plus the two works nearest the doors, with the
  // exact URLs the gallery will request. PaintingExhibit loads them with
  // fetch(url, { mode: "cors", credentials: "same-origin" }), which a
  // crossorigin="anonymous" as="fetch" preload matches.
  const layout = buildLayout(artist.paintings);
  const bySlug = new Map(artist.paintings.map((p) => [p.slug, p]));
  entryGateSlugs(layout, 2).forEach((s, i) => {
    const p = bySlug.get(s);
    if (!p) return;
    preload(paintingTextureUrl(p, wallTexturePx(p)), {
      as: "fetch",
      crossOrigin: "anonymous",
      fetchPriority: i === 0 ? "high" : "auto",
    });
  });

  return <MuseumApp artist={artist} />;
}
