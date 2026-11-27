import { db } from "spacepress/server";
import { Content, Link, headings, notFound, type NavItem, type PageProps, type ReactNode } from "spacepress/app";

/** The tree, one level per call: `children` is empty below the last level nav() reads. */
function Tree({ items }: { items: NavItem[] }): ReactNode {
  return (
    <ul>
      {items.map((a) => (
        <li key={a.id} className={a.current ? "current" : a.open ? "open" : undefined}>
          <Link href={a.href}>{a.title}</Link>
          {a.children.length > 0 && <Tree items={a.children} />}
        </li>
      ))}
    </ul>
  );
}

export const metadata = async ({ params }: PageProps<"docs/[[...path]]">) => {
  const item = await db.docs.get({ path: params.path });
  if (!item) return { title: "Not found" };
  return { title: item.title, description: item.summary ?? undefined };
};

export default async function Doc({ params }: PageProps<"docs/[[...path]]">) {
  const item = await db.docs.get({ path: params.path });
  if (!item) notFound();
  const tree = await db.docs.nav(item);
  const { prev, next } = await db.docs.pager(item);
  const toc = headings(item);
  return (
    <div className="docs">
      <nav className="tree">
        <Tree items={tree} />
      </nav>
      <article>
        <h1>{item.title}</h1>
        <Content value={item.content} />
      </article>
      <aside className="toc">
        <ul>{toc.map((h) => <li key={h.id} className={`depth-${h.depth}`}><a href={`#${h.id}`}>{h.text}</a></li>)}</ul>
      </aside>
      <footer className="pager">
        {prev && <Link href={prev.href} rel="prev">{prev.title}</Link>}
        {next && <Link href={next.href} rel="next">{next.title}</Link>}
      </footer>
    </div>
  );
}
