// GET /api/examples.json: the examples and their star counts, for anything that wants them as data.
import { examples } from "first:db";

export const access = "anyone";

export async function GET() {
  const rows = await examples.list({ orderBy: { position: "asc" }, limit: 50 });
  return {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
    body: JSON.stringify(rows.map((row) => ({ name: row.name, title: row.title, summary: row.summary, code: `https://github.com/${row.repo}/tree/main/${row.path}`, stars: row.stars ?? null, countedAt: row.starsAt ?? null }))),
  };
}
