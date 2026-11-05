import { Show, count, type Metadata, type PageContext, type PageProps } from "@spacefast/zero-pages";
import { NoteCard } from "../../components/NoteCard";

export const route = { id: "notes.index" };
export const metadata = { title: "Notes", description: "Every published note." } satisfies Metadata;

export function load({ content }: PageContext) {
  const notes = content.query.notes.findMany({ orderBy: { publishedAt: "desc", id: "desc" }, limit: 50 });
  return { notes };
}

export default function Notes({ notes }: PageProps<typeof load>) {
  return (
    <>
      <h1>Notes</h1>
      <Show when={count(notes)} not>
        <p className="empty">Nothing published yet.</p>
      </Show>
      {notes.map((note) => <NoteCard note={note} />)}
    </>
  );
}
