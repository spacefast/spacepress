import { db, env, type RouteRequest } from "spacepress";

// A raw signed webhook: the sender signs the body; the handler runs as the system, so it reads
// the draft an anonymous visitor can't.
export const signature = { secret: env("APPROUTER_HOOK_SECRET"), header: "x-hook-signature", scheme: "hmac-sha256" };

export async function POST(req: RouteRequest) {
  const all = await db.query.notes.findMany({ orderBy: { id: "asc" } });
  return { status: 202, body: `${req.body}:${all.length}` };
}
