import { db } from "spacepress/server";
import { Link } from "spacepress/server/app";

export const metadata = { title: "Home", canonical: "/" };

export default async function Home() {
  const notes = await db.query.notes.findMany({ orderBy: { id: "asc" } });
  return (
    <main className="home">
      <h1>Home</h1>
      <ul>{notes.map((n) => <li>{n.title}</li>)}</ul>
      <Link href="/notes">Notes</Link> <Link href="/bare">Bare</Link>
    </main>
  );
}
