// POST /webhooks/stripe: a signed webhook. The sender signs the raw body with HMAC-SHA256; the
// handler runs as the system.
import { db, env, type RouteRequest } from "first";
import { cheers } from "first:db";

export const signature = { secret: env("FULLSITE_WEBHOOK_SECRET"), header: "x-fullsite-signature", scheme: "hmac-sha256" };

export async function POST(req: RouteRequest) {
  const event = JSON.parse(req.body) as { noteId: number };
  const noteId = Number(event.noteId);
  const row = await db.query.cheers.findFirst({ where: { noteId } });
  if (row) await db.update(cheers).set({ count: row.count + 1 }).where({ id: row.id });
  return { status: 202, body: "accepted " + req.headers["x-fullsite-signature"].slice(0, 8) };
}
