import { Content, Link } from "spacepress/app";
import type { PageProps } from "./$types";

// SpacePress supplies the note for this slug. Missing notes use not-found.tsx.
export const metadata = ({ item }: PageProps) => ({ title: item.title });

export default function Note({ item }: PageProps) {
  return (
    <article>
      <p><Link href="/notes">← All notes</Link></p>
      <h1>{item.title}</h1>
      <Content value={item.body} />
    </article>
  );
}
