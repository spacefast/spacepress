// /applause: every published note with a cheer button, a "use client" component.
import { db } from "first";
import { CheerButton } from "../../components/CheerButton";

export const metadata = { title: "Applause · Field Notes", description: "Cheer for the notes you liked." };

export default async function Applause() {
  const notes = await db.query.notes.findMany({ orderBy: { id: "desc" }, limit: 50 });
  const counts = await db.query.cheers.findMany({ limit: 500 });
  return (
    <main>
      <h1>Applause</h1>
      {notes.length === 0 && <p>Nothing published yet.</p>}
      <ul>
        {notes.map((note) => (
          <li>
            <span>{note.title}</span> <CheerButton noteId={note.id} count={counts.find((c) => c.noteId === note.id)?.count ?? 0} />
          </li>
        ))}
      </ul>
    </main>
  );
}
