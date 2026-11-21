// GET /api/feed.json: a public JSON Feed on the site's own path.
import { type RouteRequest } from "typedpress";
import { notes } from "typedpress:db";

export const guard = "anyone";

export async function GET(req: RouteRequest) {
  const limit = Number(req.query.get("limit") ?? "10");
  const rows = await notes.list({ orderBy: { id: "desc" }, limit: limit > 0 && limit <= 50 ? limit : 10 });
  const items = rows.map((note) => ({ id: String(note.id), title: note.title, summary: note.dek ?? "" }));
  return {
    headers: { "content-type": "application/feed+json" },
    body: JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "Field Notes", items }),
  };
}
