import { getArtistSlugs } from "@/lib/data";
import { ArtistGalleryPage, galleryMetadata } from "@/components/museum/ArtistGalleryPage";

export const revalidate = 3600;
// Only build-time slugs are served, keeping random URLs out of the ISR cache.
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getArtistSlugs()).map((slug) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) {
  return galleryMetadata((await params).slug);
}
export default async function MuseumPage({ params }: Props) {
  return <ArtistGalleryPage slug={(await params).slug} />;
}
