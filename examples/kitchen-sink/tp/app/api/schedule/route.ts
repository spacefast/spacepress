import { db } from "typedpress";
import type { RouteRequest, RouteResponse } from "typedpress/app";

export const guard = "anyone";

export async function GET(request: RouteRequest): Promise<RouteResponse> {
  const workshops = await db.query.events.findMany({
    where: { registrationOpen: true },
    columns: { title: true, startsOn: true },
    orderBy: { startsOn: "asc" },
    limit: 10,
  });
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kitchen: request.query.get("kitchen") ?? "main", workshops }),
  };
}
