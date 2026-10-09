import type { NextRequest } from "next/server";
import { getTimeline } from "@/lib/data";

// "Surprise me" at the end of an artist's gallery: a gallery from another period, picked at random.
export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from");
  const { artists } = await getTimeline();
  const period = artists.find((a) => a.slug === from)?.periodSlug;
  const pool = artists.filter((a) => a.paintingCount > 0 && a.slug !== from && a.periodSlug !== period);
  if (!pool.length) return Response.redirect(new URL("/", request.url), 307);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return Response.redirect(new URL(`/museum/${pick.slug}`, request.url), 307);
}
