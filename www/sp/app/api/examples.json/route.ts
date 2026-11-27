import type { RouteCtx, RouteRequest } from "spacepress";

export const access = "anyone";

export async function GET(_req: RouteRequest, { db }: RouteCtx) {
  const rows = await db.examples.list({ orderBy: { position: "asc", id: "asc" }, limit: 100 });
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

  return Response.json({ examples: data });
}
