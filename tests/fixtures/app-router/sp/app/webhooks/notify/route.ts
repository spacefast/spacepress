import { env, type RouteRequest } from "spacepress";
import { db } from "spacepress/server";

// A raw signed webhook: the sender signs the body; the handler runs as the system, so it reads
// the draft an anonymous visitor can't.
export const signature = { secret: env("APPROUTER_HOOK_SECRET"), header: "x-hook-signature", scheme: "hmac-sha256" };

export async function POST(req: RouteRequest) {
  const all = await db.notes.list({ orderBy: { id: "asc" } });
  return new Response(`${req.body}:${all.length}`, { status: 202 });
}
