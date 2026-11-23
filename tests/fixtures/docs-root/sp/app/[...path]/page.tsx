import { docs } from "spacepress:db";
import { Content, Link, type PageProps } from "spacepress/app";
import { nav, pager } from "spacepress/content";

export const metadata = ({ item }: PageProps<"[...path]">) => ({ title: item.title });

export default async function Doc({ item }: PageProps<"[...path]">) {
  const tree = await nav(docs, item);
  const { next } = await pager(docs, item);
  return (
    <article>
      <h1>{item.title}</h1>
      <ul className="tree">{tree.map((a) => <li key={a.id}><Link href={a.href}>{a.title}</Link></li>)}</ul>
      <Content value={item.content} />
      {next && <Link href={next.href} rel="next">{next.title}</Link>}
    </article>
  );
}
