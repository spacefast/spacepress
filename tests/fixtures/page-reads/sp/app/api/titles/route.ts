import { db } from "spacepress";

export const guard = "anyone";

export async function GET() {
  const notes = await db.query.notes.findMany({ orderBy: { id: "asc" } });
  return { body: notes.map((n) => n.title).join(",") };
}
