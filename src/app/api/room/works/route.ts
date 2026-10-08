import type { NextRequest } from "next/server";
import { searchWorks } from "@/lib/rooms";

// The room picker's "add a work by hand": works whose titles hold the words (?q=), optionally by one artist (?a=).
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  const a = request.nextUrl.searchParams.get("a");
  const works = await searchWorks(q, a && /^[a-z0-9-]+$/.test(a) ? a : null);
  return Response.json({ works }, { headers: { "Cache-Control": "public, max-age=300" } });
}
