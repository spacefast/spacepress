// The blog's front page: every published post, newest first.
import { posts } from "typedpress:db";
import { Link } from "typedpress/app";

export const metadata = { title: "Blog", description: "News and notes about TypedPress." };

export default async function Blog() {
  const list = await posts.list({ orderBy: { publishedAt: "desc" }, limit: 50 });
  return (
    <main className="prose">
      <h1>Blog</h1>
      {list.length === 0 && <p className="lede">Nothing is published yet.</p>}
      <ul className="postlist">
        {list.map((post) => (
          <li key={post.id}>
            <Link href={`/blog/${post.slug}`}>{post.title}</Link>
            {post.publishedAt && <time dateTime={post.publishedAt}>{post.publishedAt.slice(0, 10)}</time>}
            {post.excerpt && <p>{post.excerpt}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
