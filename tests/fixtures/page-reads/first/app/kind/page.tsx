import { notes } from "first:db";

export default async function Kind() {
  const rows = await notes.list({ orderBy: { id: "asc" } });
  return <ul className="kind-list">{rows.map((n) => <li>{n.title}</li>)}</ul>;
}
