import { db } from "spacepress/server";

export const access = "anyone";

export async function GET() {
  const notes = await db.notes.list();
  return Response.json(notes.map((n) => n.title));
}
