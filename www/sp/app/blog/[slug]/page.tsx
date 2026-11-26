import { Comments, Content, Link, type PageProps } from "spacepress/server/app";
import { PageActions } from "../../../components/PageActions";

export const metadata = ({ item }: PageProps<"blog/[slug]">) => ({
  title: item.title,
  description: item.excerpt ?? undefined,
  canonical: `/blog/${item.slug}`,
});

export default function BlogPostPage({ item }: PageProps<"blog/[slug]">) {
  return (
    <div className="sp-container-narrow" style={{ paddingTop: "44px", paddingBottom: "88px" }}>
      <p style={{ marginBottom: "18px" }}>
        <Link href="/blog">← All posts</Link>
      </p>
      <article className="sp-prose">
        <header style={{ marginBottom: "32px", paddingBottom: "22px", borderBottom: "1px solid var(--border)" }}>
          {item.publishedAt && (
            <time className="sp-post-date" dateTime={item.publishedAt}>
              {item.publishedAt.slice(0, 10)}
            </time>
          )}
          <div className="sp-article-head">
            <h1 style={{ fontSize: "clamp(1.9rem, 3.8vw, 2.8rem)", margin: "0 0 12px", letterSpacing: "-0.03em", lineHeight: 1.12 }}>
              {item.title}
            </h1>
            <PageActions mdPath={`/md/blog/${item.slug}.md`} title={item.title} />
          </div>
          {item.excerpt && <p className="sp-docs-lead" style={{ marginBottom: 0 }}>{item.excerpt}</p>}
        </header>

        <Content value={item.content} />
      </article>

      <section style={{ marginTop: "56px", paddingTop: "32px", borderTop: "1px solid var(--border)" }}>
        <h2 style={{ fontSize: "1.35rem", marginBottom: "14px" }}>Comments</h2>
        <Comments for={item} />
      </section>
    </div>
  );
}
