import { docs } from "first:db";
import { Content, Link, type PageProps } from "first/app";
import { nav, pager, headings } from "first/content";

export const metadata = ({ item }: PageProps<"docs/[...path]">) => ({ title: item.title, description: item.summary ?? undefined });

export default async function Doc({ item }: PageProps<"docs/[...path]">) {
  const tree = await nav(docs, item);
  const { prev, next } = await pager(docs, item);
  const toc = headings(item);
  return (
    <div className="docs">
      <nav className="tree">
        <ul>
          {tree.map((a) => (
            <li key={a.id} className={a.current ? "current" : a.open ? "open" : undefined}>
              <Link href={a.href}>{a.title}</Link>
              {a.children.length > 0 && (
                <ul>
                  {a.children.map((b) => (
                    <li key={b.id} className={b.current ? "current" : b.open ? "open" : undefined}>
                      <Link href={b.href}>{b.title}</Link>
                      {b.children.length > 0 && (
                        <ul>{b.children.map((c) => <li key={c.id} className={c.current ? "current" : undefined}><Link href={c.href}>{c.title}</Link></li>)}</ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
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
