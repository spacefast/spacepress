import { Link } from "spacepress/app";

/** One note in a listing: the fields a listing query returns that the card shows. */
export function NoteCard({ note }: { note: { id: number; title: string; slug: string | null; dek: string | null } }) {
  return (
    <article className="note-card">
      <h3><Link href={`/notes/${note.slug}`}>{note.title}</Link></h3>
      {note.dek && <p>{note.dek}</p>}
    </article>
  );
}
