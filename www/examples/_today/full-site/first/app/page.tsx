import { db } from "first";
import { Link } from "first/app";
import { NoteCard } from "../components/NoteCard";

export const metadata = { title: "Home" };

export default async function Home() {
  const latest = await db.query.notes.findMany({ columns: { id: true, title: true, slug: true, dek: true }, orderBy: { publishedAt: "desc", id: "desc" }, limit: 3 });
  return (
    <>
      <section className="hero">
        <h1>Notes from the field</h1>
        <p>A small site whose pages are TSX and whose content is WordPress.</p>
      </section>
      <h2>Latest</h2>
      {latest.map((note) => <NoteCard note={note} />)}
      <p><Link href="/notes">All notes</Link></p>
    </>
  );
}
