import { db } from "spacepress/server";

export const access = "anyone";

export async function GET() {
  const notes = await db.notes.list({ orderBy: { id: "asc" } });
  return new Response(notes.map((n) => n.title).join(","));
}
