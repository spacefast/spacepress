import { db } from "spacepress/server";
import { notFound, type PageProps } from "spacepress/app";

export const prerender = true;
export const metadata = async ({ params }: PageProps<"notes/[slug]">) => {
  const item = await db.notes.get({ slug: params.slug });
  return { title: item?.title ?? "Not found" };
};

export default async function Note({ params }: PageProps<"notes/[slug]">) {
  const item = await db.notes.get({ slug: params.slug });
  if (!item) notFound();
  return <article className="note"><h1>{item.title}</h1><p className="summary">{item.summary ?? ""}</p></article>;
}
