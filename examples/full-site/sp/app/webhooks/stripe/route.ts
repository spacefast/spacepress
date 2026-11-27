// POST /webhooks/stripe: a signed webhook. The sender signs the raw body with HMAC-SHA256; the
// handler runs as the system.
import { env, type RouteCtx, type RouteRequest } from "spacepress";

export const signature = { secret: env("FULLSITE_WEBHOOK_SECRET"), header: "x-fullsite-signature", scheme: "hmac-sha256" };

export async function POST(req: RouteRequest, { db }: RouteCtx) {
  const event = JSON.parse(req.body) as { noteId: number };
  const noteId = Number(event.noteId);
  const row = await db.system.cheers.get({ noteId });
  if (row) await db.system.cheers.update(row.id, { count: row.count + 1 });
  return { status: 202, body: "accepted " + req.headers["x-fullsite-signature"].slice(0, 8) };
}
