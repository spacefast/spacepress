import { db } from "spacepress/server";
import { notFound, type PageProps } from "spacepress/app";

export const prerender = true;

export default async function Note({ params }: PageProps<"notes/[slug]">) {
  const item = await db.notes.get({ slug: params.slug });
  if (!item) notFound();
  return <h1 className="note">{item.title}</h1>;
}
