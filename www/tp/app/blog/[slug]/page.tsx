// One post. It is WordPress content, written in the WordPress editor or TypedPress Admin (or as
// Markdown in content/posts/), and it renders in the same layout as every other page here.
import { Comments, Content, Link, type PageProps } from "typedpress/app";

export const metadata = ({ item }: PageProps<"blog/[slug]">) => ({ title: item.title, description: item.excerpt ?? undefined });

export default function Post({ item }: PageProps<"blog/[slug]">) {
  return (
    <main className="prose">
      <p className="crumb"><Link href="/blog">Blog</Link></p>
      <article>
        <h1>{item.title}</h1>
        {item.publishedAt && <p className="date"><time dateTime={item.publishedAt}>{item.publishedAt.slice(0, 10)}</time></p>}
        <Content value={item.content} />
      </article>
      {/* WordPress's comments for this post: the thread and a form that works without JavaScript.
          Who may comment and how it is moderated is set on the kind, in tp/schema.ts. */}
      <Comments for={item} className="comments" />
    </main>
  );
}
