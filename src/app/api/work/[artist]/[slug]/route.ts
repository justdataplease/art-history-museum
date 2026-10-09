import { workAbout } from "@/lib/rooms";

// More about one work for the inspect panel (src/lib/rooms.ts workAbout): its movement, genre and museums, and
// what other artists painted the same year. Fetched when a painting is inspected, so galleries do not carry it.
export async function GET(_request: Request, { params }: { params: Promise<{ artist: string; slug: string }> }) {
  const { artist, slug } = await params;
  if (!/^[a-z0-9-]+$/.test(artist) || !slug || slug.length > 200) return new Response("Not found", { status: 404 });
  const about = await workAbout(artist, slug);
  if (!about) return new Response("Not found", { status: 404 });
  return Response.json(about, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
