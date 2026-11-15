// The newest blog posts, for showing inside another page: the guide's home page uses it. The
// posts are WordPress content, read here as the visitor, so a draft is never listed.
import { posts } from "first:db";
import { Link } from "first/app";

export async function LatestPosts({ limit = 3 }: { limit?: number }) {
  const list = await posts.list({ orderBy: { publishedAt: "desc" }, limit });
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
