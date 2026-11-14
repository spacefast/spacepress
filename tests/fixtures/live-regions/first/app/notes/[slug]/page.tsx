import { Comments, Live, type PageProps } from "first/app";

// A live thread: comments are core's, which no First counter follows, so the region renders and
// compares on every poll.
export default function Note({ item }: PageProps<"notes/[slug]">) {
  return (
    <article>
      <h1>{item.title}</h1>
      <Live id="thread"><Comments for={item} /></Live>
    </article>
  );
}
