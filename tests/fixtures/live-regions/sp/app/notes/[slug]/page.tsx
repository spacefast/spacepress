import { db } from "spacepress/server";
import { Comments, Live, notFound, type PageProps } from "spacepress/app";

// A live thread: comments are core's, which no SpacePress counter follows, so the region renders and
// compares on every poll.
export default async function Note({ params }: PageProps<"notes/[slug]">) {
  const item = await db.notes.get({ slug: params.slug });
  if (!item) notFound();
  return (
    <article>
      <h1>{item.title}</h1>
      <Live id="thread"><Comments for={item} /></Live>
    </article>
  );
}
