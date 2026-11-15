// POST /webhooks/stripe: a signed webhook. The sender signs the raw body with HMAC-SHA256.
// There is no visitor, so the handler runs as the system.
import { env, type RouteRequest } from "typedpress";
import { cheers } from "typedpress:db";

export const signature = { secret: env("NOTES_WEBHOOK_SECRET"), header: "x-notes-signature", scheme: "hmac-sha256" };

export async function POST(req: RouteRequest) {
  const event = JSON.parse(req.body) as { noteId: number };
  const row = await cheers.get({ noteId: Number(event.noteId) });
  if (row) await cheers.update(row.id, { count: row.count + 1 });
  return { status: 202, body: "accepted" };
}
