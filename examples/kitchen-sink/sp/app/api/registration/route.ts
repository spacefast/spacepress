import { env, type RouteCtx } from "spacepress";
import { sanitize_title } from "spacepress/server/wp";
import type { RouteRequest, RouteResponse } from "spacepress/app";

export const signature = { secret: env("KITCHEN_REGISTRATION_SECRET"), header: "x-kitchen-signature", scheme: "hmac-sha256" };

// A signed call from the kitchen's booking desk closes a workshop: ?workshop=Bread Basics or bread-basics.
export async function POST(request: RouteRequest, { db }: RouteCtx): Promise<RouteResponse> {
  const workshop = await db.system.events.get({ slug: sanitize_title(request.query.get("workshop") ?? "") });
  if (!workshop) return { status: 404, body: "Workshop not found." };
  await db.system.events.update(workshop.id, { registrationOpen: false });
  return { status: 204 };
}
