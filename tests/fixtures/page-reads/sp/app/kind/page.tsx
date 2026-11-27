import { db } from "spacepress/server";

export default async function Kind() {
  const rows = await db.notes.list({ orderBy: { id: "asc" } });
  return <ul className="kind-list">{rows.map((n) => <li>{n.title}</li>)}</ul>;
}
