import type { RouteCtx } from "spacepress";
import { get_permalink, wp_strip_all_tags } from "spacepress/server/wp";
import type { RouteRequest, RouteResponse } from "spacepress/app";

export const access = "anyone";

export async function GET(request: RouteRequest, { db }: RouteCtx): Promise<RouteResponse> {
  const rows = await db.events.list({
    where: { registrationOpen: true, status: "published" },
    columns: { id: true, title: true, startsOn: true, description: true },
    orderBy: { startsOn: "asc" },
    limit: 10,
  });
  const workshops = rows.map((workshop) => ({
    title: workshop.title,
    startsOn: workshop.startsOn,
    summary: wp_strip_all_tags(workshop.description ?? ""),
    url: get_permalink(workshop.id) || null,
  }));
  return Response.json({ kitchen: request.query.get("kitchen") ?? "main", workshops });
}
