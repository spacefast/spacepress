import { Link, type PageProps } from "spacepress/app";

export const metadata = {
  title: "Reference",
  description: "Technical reference for SpacePress — schema, queries, TSX pages, actions, jobs, Markdown sync, WooCommerce, React Email, and CLI.",
};

export default async function DocsIndexPage({ db }: PageProps) {
  const tree = await db.docs.nav();

  return (
    <>
      <section className="sp-page-banner">
        <div className="sp-container">
          <h1>SpacePress Reference</h1>
          <p>
            Focused, topic-by-topic technical references synced directly from Markdown files in <code>content/docs/</code>. Looking for an interactive end-to-end walkthrough? Jump into the <Link href="/handbook">Interactive Handbook</Link>.
          </p>
        </div>
      </section>

      <div className="sp-container" style={{ paddingTop: "36px", paddingBottom: "80px" }}>
        {tree.length === 0 ? (
          <div className="sp-callout is-info">
            <strong>Reference not synced yet.</strong> Run <code>spacepress sync</code> in <code>www/</code> to load <code>content/docs/**/*.md</code> into the <code>docs</code> collection.
          </div>
        ) : (
          <div className="sp-card-grid" style={{ marginTop: 0 }}>
            {tree.map((section) => (
              <div key={section.id} className="sp-card">
                <h3 style={{ marginBottom: "4px" }}>
                  <Link href={section.href} className="sp-link-ink">{section.title}</Link>
                </h3>
                {section.children.length > 0 ? (
                  <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0", display: "grid", gap: "6px" }}>
                    {section.children.map((child) => (
                      <li key={child.id}>
                        <Link href={child.href}>{child.title} →</Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    <Link href={section.href}>Read reference →</Link>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
