import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFilmPainter, getFilmPainters } from "@/lib/films";
import { CinemaApp } from "@/components/cinema/CinemaApp";

// A painter's cinema: the films their Wikipedia articles hold (archive/films.py), on a projector in a dark
// auditorium. Every painter with films is prerendered; the programme is in the page.
export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return getFilmPainters().map((p) => ({ slug: p.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = getFilmPainter((await params).slug);
  if (!p) return {};
  return {
    title: `${p.name} on film · A Walkable History of Art`,
    description: `A cinema for ${p.name}: ${p.films.length} films about their life and work, linked from Wikipedia, on a projector in a 3D auditorium.`,
  };
}

export default async function CinemaPage({ params }: Props) {
  const painter = getFilmPainter((await params).slug);
  if (!painter) notFound();
  return <CinemaApp painter={painter} key={painter.slug} />;
}
