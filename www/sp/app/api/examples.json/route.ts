import { examples } from "spacepress:db";

export const guard = "anyone";

export async function GET() {
  const rows = await examples.list({ orderBy: { position: "asc", id: "asc" }, limit: 100 });
  const data = rows.map((row) => ({
    name: row.name,
    title: row.title,
    summary: row.summary,
    repo: row.repo,
    path: row.path,
    stars: row.stars,
    starsAt: row.starsAt,
    playgroundUrl: `/play?example=${row.name}`,
    githubUrl: `https://github.com/${row.repo}/tree/main/${row.path}`,
  }));

  return {
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ examples: data }, null, 2),
  };
}
