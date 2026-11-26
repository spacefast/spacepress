import { Content, Link } from "spacepress/app";
import type { PageProps } from "./$types";

// plants' `url` is /plants/:slug, so this page receives the plant as `item`, read as the visitor.
export const metadata = ({ item }: PageProps) => ({ title: item.title, description: item.summary ?? undefined });

export default function Plant({ item }: PageProps) {
  return (
    <article className="plant">
      <p className="back"><Link href="/">← All plants</Link></p>
      <h1>{item.title}</h1>
      <p className="meta">{item.family}{item.height !== null && ` · up to ${item.height} cm`}</p>
      <Content value={item.body} />
    </article>
  );
}
