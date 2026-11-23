import { db } from "spacepress";
import { Link } from "spacepress/app";

export const metadata = { title: "Notes" };

export default async function Notes() {
  // Page queries use the current visitor's access rules.
  const notes = await db.query.notes.findMany({
    columns: { title: true, slug: true, summary: true },
    orderBy: { publishedAt: "desc" },
    limit: 20,
  });
  return (
    <>
      <h1>Notes</h1>
      <p>These entries started as Markdown files in <code>content/notes/</code>.</p>
      {notes.length === 0 && <p>No notes have been published yet.</p>}
      <ul className="notes">
        {notes.map((note) => (
          <li>
            <h2><Link href={`/notes/${note.slug}`}>{note.title}</Link></h2>
            {note.summary && <p>{note.summary}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
