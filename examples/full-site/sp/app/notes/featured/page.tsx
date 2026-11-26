import { db } from "spacepress/server";
import { NoteCard } from "../../../components/NoteCard";

// A literal folder beside notes/[slug]: it always wins, so no note is served at /notes/featured.
export const metadata = { title: "Featured" };

export default async function Featured() {
  const first = await db.query.notes.findMany({ columns: { id: true, title: true, slug: true, dek: true }, orderBy: { id: "asc" }, limit: 1 });
  return (
    <>
      <h1>Featured</h1>
      <p>The note that started it all.</p>
      {first.map((note) => <NoteCard note={note} />)}
    </>
  );
}
