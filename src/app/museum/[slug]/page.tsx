import { notFound } from "next/navigation";
import { getArtist } from "@/lib/data";
import { MuseumApp } from "@/components/museum/MuseumApp";

export default async function MuseumPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const artist = await getArtist(slug);
  if (!artist || artist.paintings.length === 0) notFound();
  return <MuseumApp artist={artist} />;
}
