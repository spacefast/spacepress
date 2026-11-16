import { docs } from "typedpress:db";
import { Content, Link, type PageProps } from "typedpress/app";
import { nav, pager, headings } from "typedpress/content";

export const metadata = ({ item }: PageProps<"docs/[...path]">) => ({ title: item.title, description: item.description ?? undefined });

// One page renders every doc: the tree on the left, the doc, its table of contents, and the
// previous and next docs. All of it is read as the visitor, from the published docs.
export default async function Doc({ item }: PageProps<"docs/[...path]">) {
  const tree = await nav(docs, item);
  const { prev, next } = await pager(docs, item);
  const toc = headings(item);
  return (
    <div className="docs">
      <nav className="sidebar" aria-label="Docs">
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
      <article className="doc">
        <h1>{item.title}</h1>
        {item.description && <p className="lead">{item.description}</p>}
        <Content value={item.content} />
        <footer className="pager">
          {prev && <Link href={prev.href} rel="prev">← {prev.title}</Link>}
          {next && <Link href={next.href} rel="next">{next.title} →</Link>}
        </footer>
      </article>
      {toc.length > 0 && (
        <aside className="toc" aria-label="On this page">
          <ul>{toc.map((h) => <li key={h.id} className={`depth-${h.depth}`}><a href={`#${h.id}`}>{h.text}</a></li>)}</ul>
        </aside>
      )}
    </div>
  );
}
