import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FurnitureStudy } from "./FurnitureStudy";

// The seating of every room style side by side (src/components/museum/furniture.ts), for modelling it.
// Local development only.

export const metadata: Metadata = { title: "Furniture study · A Walkable History of Art", robots: { index: false } };

export default async function FurniturePage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { s } = await searchParams;
  return <FurnitureStudy initial={s ?? "old-master"} />;
}
