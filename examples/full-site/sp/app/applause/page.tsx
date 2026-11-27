// /applause: every published note with a cheer button, a "use client" component.
import type { PageProps } from "spacepress/app";
import { CheerButton } from "../../components/CheerButton";

export const metadata = { title: "Applause", description: "Cheer for the notes you liked." };

export default async function Applause({ db }: PageProps) {
  const notes = await db.notes.list({ orderBy: { id: "desc" }, limit: 50 });
  const counts = await db.cheers.list({ limit: 500 });
  return (
    <>
      <h1>Applause</h1>
      {notes.length === 0 && <p>Nothing published yet.</p>}
      <ul>
        {notes.map((note) => (
          <li>
            <span>{note.title}</span> <CheerButton noteId={note.id} count={counts.find((c) => c.noteId === note.id)?.count ?? 0} />
          </li>
        ))}
      </ul>
    </>
  );
}
