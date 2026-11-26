import { db } from "spacepress/server";
import { NoteList } from "../components/NoteList";

export const metadata = { title: "Home" };

export default async function Home() {
  const notes = await db.query.notes.findMany({ orderBy: { id: "asc" } });
  return (
    <>
      <h1>Home</h1>
      {notes.length === 0 ? <p className="empty">Nothing yet.</p> : <NoteList notes={notes.map((n) => n.title)} />}
    </>
  );
}
