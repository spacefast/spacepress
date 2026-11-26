import { Comments, Content, notFound, type PageProps } from "spacepress/server/app";

export default function Journal({ item }: PageProps<"journal/[slug]">) {
  if (!item) notFound();
  return <article><h1>{item.title}</h1><Content value={item.content} /><Comments for={item} /></article>;
}
