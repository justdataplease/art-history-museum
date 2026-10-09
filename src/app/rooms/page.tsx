import type { Metadata } from "next";
import { getTimeline } from "@/lib/data";
import { parseSelection, roomOptions } from "@/lib/rooms";
import { RoomPicker } from "./RoomPicker";

export const metadata: Metadata = {
  title: "Make a room · A Walkable History of Art",
  description:
    "Hang your own room: choose an era, a movement, a school, a genre, a country, a museum or artists, plan its floors, walk it in 3D, save it and share the link.",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function RoomsPage({ searchParams }: Props) {
  const [{ artists }, options, initial] = await Promise.all([
    getTimeline({ origins: true }),
    Promise.resolve(roomOptions()),
    searchParams.then(parseSelection),
  ]);
  return (
    <RoomPicker
      terms={options.terms.map(({ id, kind, name, parent, start, end, works, ancestors }) => ({
        id, kind, name, parent, start, end, works, ancestors,
      }))}
      nationalities={options.nationalities.slice(0, 120)}
      museums={options.museums}
      artists={artists
        .filter((a) => a.paintingCount > 0)
        .map((a) => ({ slug: a.slug, name: a.name, birthYear: a.birthYear, deathYear: a.deathYear }))
        .sort((a, b) => a.name.localeCompare(b.name))}
      initial={initial}
    />
  );
}
