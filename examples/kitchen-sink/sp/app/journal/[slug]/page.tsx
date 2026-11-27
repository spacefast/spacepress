import { Comments, Content, notFound } from "spacepress/app";
import type { PageProps } from "./$types";

export default async function Journal({ params, db }: PageProps) {
  const item = await db.posts.get({ slug: params.slug });
  if (!item) notFound();
  return <article><h1>{item.title}</h1><Content value={item.content} /><Comments for={item} /></article>;
}
