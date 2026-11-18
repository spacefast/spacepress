import { db } from "typedpress";

export const guard = "anyone";

export async function GET() {
  const notes = await db.query.notes.findMany({});
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(notes.map((n) => n.title)) };
}
