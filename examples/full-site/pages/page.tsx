import { link, type Metadata, type PageContext, type PageProps } from "@spacefast/zero-pages";
import { NoteCard } from "../components/NoteCard";

export const route = { id: "home" };
export const metadata = { title: "Home" } satisfies Metadata;

export function load({ content }: PageContext) {
  const latest = content.query.notes.findMany({ orderBy: { publishedAt: "desc", id: "desc" }, limit: 3 });
  return { latest };
}

export default function Home({ latest }: PageProps<typeof load>) {
  return (
    <>
      <section className="hero">
        <h1>Notes from the field</h1>
        <p>A small site whose pages are TSX and whose content is WordPress.</p>
      </section>
      <h2>Latest</h2>
      {latest.map((note) => <NoteCard note={note} />)}
      <p><a href={link("/notes")}>All notes</a></p>
    </>
  );
}
