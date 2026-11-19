// Was src/pages/blog/index.astro.
import { db } from "typedpress";
import { Link } from "typedpress/app";

export const metadata = { title: "Blog" };

export default async function Blog() {
  const posts = await db.query.blog.findMany({ columns: { title: true, slug: true, pubDate: true }, orderBy: { pubDate: "desc" } });
  return (
    <>
      <h1>Blog</h1>
      <ul>{posts.map((p) => <li key={p.slug}><Link href={`/blog/${p.slug}`}>{p.title}</Link> <time>{p.pubDate}</time></li>)}</ul>
    </>
  );
}
