// GET /api/feed.json: a public JSON Feed on the site's own path, outside /wp-json.
import { type RouteRequest } from "spacepress";
import { db } from "spacepress/server";

export const guard = "anyone";

export async function GET(req: RouteRequest) {
  const limit = Number(req.query.get("limit") ?? "10");
  const notes = await db.query.notes.findMany({ where: { status: "published" }, orderBy: { id: "desc" }, limit: limit > 0 && limit <= 50 ? limit : 10 });
  const items = notes.map((note) => ({ id: String(note.id), title: note.title, summary: note.dek ?? "" }));
  return {
    headers: { "content-type": "application/feed+json" },
    body: JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "Field Notes", items }),
  };
}
