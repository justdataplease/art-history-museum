import type { NextRequest } from "next/server";
import { searchWorks } from "@/lib/rooms";

// The room picker's search for works to add: works whose title and artist hold the words (?q=), optionally by one
// artist (?a=; with no words, that artist's best known), at most ?n= (up to 48).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").slice(0, 80);
  const a = params.get("a");
  const n = Math.min(48, Math.max(1, Number(params.get("n")) || 12));
  const works = await searchWorks(q, a && /^[a-z0-9-]+$/.test(a) ? a : null, n);
  return Response.json({ works }, { headers: { "Cache-Control": "public, max-age=300" } });
}
