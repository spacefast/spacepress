import { db } from "first";

export const access = "anyone";

export async function GET() {
  const notes = await db.query.notes.findMany({});
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(notes.map((n) => n.title)) };
}
