import { db, env } from "typedpress";
import type { RouteRequest, RouteResponse } from "typedpress/app";
import { events } from "../../../schema";

export const signature = { secret: env("KITCHEN_REGISTRATION_SECRET"), header: "x-kitchen-signature", scheme: "hmac-sha256" };

export async function POST(request: RouteRequest): Promise<RouteResponse> {
  const workshop = await db.query.events.findFirst({ where: { slug: request.query.get("workshop") ?? "" } });
  if (!workshop) return { status: 404, body: "Workshop not found." };
  await db.update(events).set({ registrationOpen: false }).where({ id: workshop.id });
  return { status: 204 };
}
