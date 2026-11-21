import { Content, Link, type PageProps } from "typedpress/app";

// TypedPress supplies the note for this slug. Missing notes use not-found.tsx.
export const metadata = ({ item }: PageProps<"notes/[slug]">) => ({ title: item.title });

export default function Note({ item }: PageProps<"notes/[slug]">) {
  return (
    <article>
      <p><Link href="/notes">← All notes</Link></p>
      <h1>{item.title}</h1>
      <Content value={item.body} />
    </article>
  );
}
