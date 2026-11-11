import type { Metadata, PageContext, PageProps } from "@spacefast/first-pages";
import { NoteCard } from "../../../components/NoteCard";

// A static page beside /notes/[slug]: it always wins, and no note can take the slug "featured".
export const route = { id: "notes.featured" };
export const metadata = { title: "Featured" } satisfies Metadata;

export function load({ content }: PageContext) {
  return { first: content.query.notes.findMany({ orderBy: { id: "asc" }, limit: 1 }) };
}

export default function Featured({ first }: PageProps<typeof load>) {
  return (
    <>
      <h1>Featured</h1>
      <p>The note that started it all.</p>
      {first.map((note) => <NoteCard note={note} />)}
    </>
  );
}
