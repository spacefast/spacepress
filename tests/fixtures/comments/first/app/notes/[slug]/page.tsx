import { Comments, type PageProps } from "first/app";

export default function Note({ item }: PageProps<"notes/[slug]">) {
  return (
    <article>
      <h1>{item.title}</h1>
      <Comments for={item} className="note-comments" />
    </article>
  );
}
