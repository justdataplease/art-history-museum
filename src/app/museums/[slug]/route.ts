import type { NextRequest } from "next/server";
import { museumRoom } from "@/lib/museum-rooms";

// A recreated museum's short link: /museums/national-gallery-of-greece opens its room (src/lib/museum-rooms.ts).
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const m = museumRoom((await params).slug);
  if (!m) return new Response("Not found", { status: 404 });
  return Response.redirect(new URL(`/room?${m.query}`, request.url), 307);
}
