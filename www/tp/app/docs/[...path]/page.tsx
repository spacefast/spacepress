import { docs } from "typedpress:db";
import { Content, Link, type PageProps } from "typedpress/app";
import { nav, pager, headings } from "typedpress/content";
import { PageActions } from "../../../components/PageActions";

export const metadata = ({ item }: PageProps<"docs/[...path]">) => ({
  title: item.title,
  description: item.description ?? undefined,
});

export default async function DocPage({ item, params }: PageProps<"docs/[...path]">) {
  const tree = await nav(docs, item);
  const { prev, next } = await pager(docs, item);
  const toc = headings(item);
  const mdPath = `/md/docs/${params.path.join("/")}.md`;

  return (
    <div className="sp-container">
      <div className="sp-docs-layout">
        <div className="sp-docs-nav-wrap">
          <button
            type="button"
            className="sp-docs-nav-summary"
            data-docs-nav-toggle=""
            aria-expanded="false"
          >
            <span>Reference menu</span>
          </button>
          <nav className="sp-docs-nav" aria-label="Reference">
            <p className="sp-toc-title">Reference</p>
            <ul>
              {tree.map((a) => (
                <li key={a.id} className={a.current ? "is-current" : a.open ? "is-open" : undefined}>
                  <Link href={a.href}>{a.title}</Link>
                  {a.children.length > 0 && (
                    <ul>
                      {a.children.map((b) => (
                        <li key={b.id} className={b.current ? "is-current" : b.open ? "is-open" : undefined}>
                          <Link href={b.href}>{b.title}</Link>
                          {b.children.length > 0 && (
                            <ul>
                              {b.children.map((c) => (
                                <li key={c.id} className={c.current ? "is-current" : undefined}>
                                  <Link href={c.href}>{c.title}</Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <article className="sp-docs-article sp-prose">
          <div className="sp-article-head">
            <h1>{item.title}</h1>
            <PageActions mdPath={mdPath} title={item.title} />
          </div>
          {item.description && <p className="sp-docs-lead">{item.description}</p>}
          <Content value={item.content} />

          <footer className="sp-pager">
            {prev ? (
              <Link href={prev.href} rel="prev">
                <small>← Previous</small>
                <strong>{prev.title}</strong>
              </Link>
            ) : <span />}
            {next ? (
              <Link href={next.href} rel="next" className="is-next">
                <small>Next →</small>
                <strong>{next.title}</strong>
              </Link>
            ) : <span />}
          </footer>
        </article>

        {toc.length > 0 && (
          <aside className="sp-toc sp-docs-toc" data-toc="" aria-label="On this page">
            <p className="sp-toc-title">On this page</p>
            <ul>
              {toc.map((h) => (
                <li key={h.id} style={h.depth === 3 ? { paddingLeft: "12px" } : undefined}>
                  <a href={`#${h.id}`}>{h.text}</a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
