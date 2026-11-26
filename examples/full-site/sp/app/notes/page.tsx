import { db } from "spacepress/server";
import { NoteCard } from "../../components/NoteCard";

export const metadata = { title: "Notes", description: "Every published note." };

export default async function Notes() {
  const notes = await db.query.notes.findMany({ columns: { id: true, title: true, slug: true, dek: true }, orderBy: { publishedAt: "desc", id: "desc" }, limit: 50 });
  return (
    <>
      <h1>Notes</h1>
      {notes.length === 0 && <p className="empty">Nothing published yet.</p>}
      {notes.map((note) => <NoteCard note={note} />)}
    </>
  );
}
