// The newest blog posts, for showing inside another page: the guide's home page reads them (as
// the visitor, so a draft is never listed) and passes them here.
import type { InferSelectModel } from "typedpress";
import { posts } from "typedpress:db";
import { Link } from "typedpress/app";

type Post = InferSelectModel<typeof posts>;

export function LatestPosts({ list }: { list: Post[] }) {
  if (list.length === 0) return null;
  return (
    <section className="latest" aria-label="From the blog">
      <h2 className="plain">From the blog</h2>
      <ul className="postlist">
        {list.map((post) => (
          <li key={post.id}>
            <Link href={`/blog/${post.slug}`}>{post.title}</Link>
            {post.publishedAt && <time dateTime={post.publishedAt}>{post.publishedAt.slice(0, 10)}</time>}
            {post.excerpt && <p>{post.excerpt}</p>}
          </li>
        ))}
      </ul>
      <p className="cap"><Link href="/blog">All posts</Link>. Each post has WordPress's own comments under it.</p>
    </section>
  );
}
