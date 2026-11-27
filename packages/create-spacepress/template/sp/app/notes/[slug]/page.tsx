import { Content, Link, notFound } from "spacepress/app";
import type { PageProps } from "./$types";

export const metadata = async ({ params, db }: PageProps) => {
  const note = await db.notes.get({ slug: params.slug });
  return { title: note ? note.title : "Note not found" };
};

export default async function Note({ params, db }: PageProps) {
  const note = await db.notes.get({ slug: params.slug });
  if (!note) notFound();
  return (
    <article>
      <p><Link href="/notes">← All notes</Link></p>
      <h1>{note.title}</h1>
      <Content value={note.body} />
    </article>
  );
}
