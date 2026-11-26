import { db } from "spacepress";
import { Link } from "spacepress/app";

export const metadata = { title: "Home" };

export default async function Home() {
  const notes = await db.query.notes.findMany({ orderBy: { id: "asc" } });
  return <ul className="notes">{notes.map((n) => <li><Link href={`/notes/${n.slug}`}>{n.title}</Link></li>)}</ul>;
}
