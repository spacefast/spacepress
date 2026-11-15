import { notes } from "typedpress:db";
import { NoteCard } from "../../components/NoteCard";

export const metadata = { title: "Notes", description: "Every published note." };

export default async function Notes() {
  const all = await notes.list({
    columns: { id: true, title: true, slug: true, dek: true },
    orderBy: { publishedAt: "desc", id: "desc" },
    limit: 50,
  });
  return (
    <>
      <h1>Notes</h1>
      {all.length === 0 && <p className="empty">Nothing published yet.</p>}
      {all.map((note) => <NoteCard note={note} />)}
    </>
  );
}
