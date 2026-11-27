import { Link, type PageProps } from "spacepress/app";

export const metadata = {
  title: "Blog",
  description: "Engineering notes, announcements, and release updates from SpacePress.",
};

export default async function BlogIndexPage({ db }: PageProps) {
  const rows = await db.posts.list({ orderBy: { publishedAt: "desc", id: "desc" }, limit: 50 });

  return (
    <>
      <section className="sp-page-banner">
        <div className="sp-container-narrow">
          <h1>SpacePress Blog</h1>
          <p>
            Powered by WordPress&apos;s native posts via <code>extend(&quot;posts&quot;)</code> and synced from <code>content/posts/*.md</code>.
          </p>
        </div>
      </section>

      <div className="sp-container-narrow" style={{ paddingTop: "36px", paddingBottom: "84px" }}>
        {rows.length === 0 ? (
          <div className="sp-callout is-info">
            <strong>No posts synced yet.</strong> Run <code>spacepress sync</code> in <code>www/</code> to publish the Markdown posts in <code>content/posts/</code>.
          </div>
        ) : (
          <div style={{ display: "grid", gap: "20px" }}>
            {rows.map((post) => (
              <article key={post.id} className="sp-card">
                <div className="sp-meta-row">
                  {post.publishedAt && <time dateTime={post.publishedAt}>{post.publishedAt.slice(0, 10)}</time>}
                </div>
                <h2 style={{ margin: "2px 0 4px", fontSize: "1.45rem", letterSpacing: "-0.02em" }}>
                  <Link href={`/blog/${post.slug}`} className="sp-link-ink">{post.title}</Link>
                </h2>
                {post.excerpt && <p>{post.excerpt}</p>}
                <p style={{ marginTop: "6px" }}>
                  <Link href={`/blog/${post.slug}`}>Read article →</Link>
                </p>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
