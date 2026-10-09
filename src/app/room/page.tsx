import { cache } from "react";
import { preload } from "react-dom";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildRoom, parseSelection } from "@/lib/rooms";
import { FLAGSHIP_THUMB_PX, paintingTextureUrl, wallTexturePx } from "@/lib/img";
import { buildLayout, entryPreloads } from "@/components/museum/layout";
import { MuseumApp } from "@/components/museum/MuseumApp";
import { roomTheme } from "@/components/museum/theme";

// A custom room: the selection is the URL (src/lib/rooms.ts), so every room is rendered on request and any
// link can be shared. Rooms that span eras have one floor per era (?f=2 ...), joined by an elevator.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const loadRoom = cache(async (query: string) => buildRoom(parseSelection(Object.fromEntries(new URLSearchParams(query)))));
const queryOf = async (searchParams: Props["searchParams"]) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") q.set(k, v);
  return q.toString();
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const room = await loadRoom(await queryOf(searchParams));
  if (!room) return { title: "A room · A Walkable History of Art" };
  return {
    title: `${room.name} · A Walkable History of Art`,
    description: `Walk a 3D room of ${room.paintings.length} works: ${room.room?.subtitle}.`,
  };
}

export default async function RoomPage({ searchParams }: Props) {
  const room = await loadRoom(await queryOf(searchParams));
  if (!room || room.paintings.length === 0) notFound();

  // the textures the entry doors wait for, as on an artist's gallery (src/app/museum/[slug]/page.tsx)
  const theme = roomTheme(room.periodSlug, room.room?.style, room.room?.wall, room.room?.ground);
  const layout = buildLayout(room.paintings, { works: theme.works, keepOrder: room.room?.keepOrder });
  const bySlug = new Map(room.paintings.map((p) => [p.slug, p]));
  entryPreloads(layout, 2).forEach(({ slug: s, thumb }, i) => {
    const p = bySlug.get(s);
    const url = p && paintingTextureUrl(p, thumb ? FLAGSHIP_THUMB_PX : wallTexturePx(p));
    if (!url) return;
    preload(url, { as: "fetch", crossOrigin: "anonymous", fetchPriority: i === 0 ? "high" : "auto" });
  });

  return <MuseumApp artist={room} key={room.room?.href} />;
}
