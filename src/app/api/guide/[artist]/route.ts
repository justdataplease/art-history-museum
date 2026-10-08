import fs from "node:fs/promises";
import path from "node:path";

// The audio guide's scripts for one artist (archive/guide.py: data/site/guide/<artist>.json): the artist's life
// and every work, as fixed text with ids, versions and recordings when there are any. Fetched by the guide only
// when the visitor switches it on, so galleries do not carry the text otherwise.
export async function GET(_request: Request, { params }: { params: Promise<{ artist: string }> }) {
  const { artist } = await params;
  if (!/^[a-z0-9-]+$/.test(artist)) return new Response("Not found", { status: 404 });
  try {
    const body = await fs.readFile(path.join(process.cwd(), "data", "site", "guide", `${artist}.json`), "utf8");
    return new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
