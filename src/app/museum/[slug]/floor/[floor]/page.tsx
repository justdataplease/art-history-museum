import { getArtistSlugs } from "@/lib/data";
import { loadArtistGallery } from "@/lib/artist-gallery";
import { ArtistGalleryPage, galleryMetadata } from "@/components/museum/ArtistGalleryPage";

export const revalidate = 3600;
export const dynamicParams = false;

export async function generateStaticParams() {
  const params: { slug: string; floor: string }[] = [];
  for (const slug of await getArtistSlugs()) {
    const gallery = await loadArtistGallery(slug);
    for (let floor = 2; floor <= (gallery?.floors.length ?? 0); floor++) params.push({ slug, floor: String(floor) });
  }
  return params;
}

type Props = { params: Promise<{ slug: string; floor: string }> };
export async function generateMetadata({ params }: Props) {
  const { slug, floor } = await params;
  return galleryMetadata(slug, Number(floor));
}
export default async function FloorPage({ params }: Props) {
  const { slug, floor } = await params;
  return <ArtistGalleryPage slug={slug} floor={Number(floor)} />;
}
