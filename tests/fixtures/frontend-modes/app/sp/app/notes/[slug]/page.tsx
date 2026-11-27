import { Content, notFound, type PageProps } from "spacepress/app";
import { db } from "spacepress/server";

export const metadata = async ({ params }: PageProps<"notes/[slug]">) => {
  const item = await db.notes.get({ slug: params.slug });
  return { title: item?.title ?? "Not found" };
};

export default async function Note({ params }: PageProps<"notes/[slug]">) {
  const item = await db.notes.get({ slug: params.slug });
  if (!item) notFound();
  return (
    <article className="app-note">
      <h1>{item.title}</h1>
      <Content value={item.body} />
    </article>
  );
}
