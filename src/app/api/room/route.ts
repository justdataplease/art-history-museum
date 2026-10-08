import type { NextRequest } from "next/server";
import { parseSelection, roomCount, roomPreview } from "@/lib/rooms";

// The room picker's live count (how many works and artists a selection hangs, on how many floors), and with
// ?preview=1 what each floor hangs, with small images, so works can be left out.
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const s = parseSelection(params);
  const body = params.preview ? { ...roomCount(s), floors: await roomPreview(s) } : roomCount(s);
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
}
