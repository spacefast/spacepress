import { Content, Link, type PageProps } from "typedpress/app";

// plants' `url` is /plants/:slug, so this page receives the plant as `item`, read as the visitor.
export const metadata = ({ item }: PageProps<"plants/[slug]">) => ({ title: item.title, description: item.summary ?? undefined });

export default function Plant({ item }: PageProps<"plants/[slug]">) {
  return (
    <article className="plant">
      <p className="back"><Link href="/">← All plants</Link></p>
      <h1>{item.title}</h1>
      <p className="meta">{item.family}{item.height !== null && ` · up to ${item.height} cm`}</p>
      <Content value={item.body} />
    </article>
  );
}
