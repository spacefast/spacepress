import { db } from "spacepress/server";
import { Comments, notFound, type PageProps } from "spacepress/app";

export default async function Note({ params }: PageProps<"notes/[slug]">) {
  const item = await db.notes.get({ slug: params.slug });
  if (!item) notFound();
  return (
    <article>
      <h1>{item.title}</h1>
      <Comments for={item} className="note-comments" />
    </article>
  );
}
