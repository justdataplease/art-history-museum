// Whether the visitor is in Greece, for the films ERT's archive plays there only (archive/films.py `geo`). Vercel
// names the visitor's country in a request header; without one (a local server) the answer is "unknown" and the
// films' corner plays them: ERT's own player decides the same way, in the visitor's browser.
export function GET(request: Request) {
  const country = request.headers.get("x-vercel-ip-country");
  return Response.json(
    { country: country ?? null, greece: country ? country === "GR" : null },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
