// Was src/pages/index.astro.
import { db } from "spacepress/server";
import { Link } from "spacepress/app";

export const metadata = { title: "Home" };

export default async function Home() {
  const posts = await db.query.blog.findMany({ columns: { title: true, slug: true }, orderBy: { pubDate: "desc" }, limit: 3 });
  return (
    <>
      <h1>Journal</h1>
      <ul>{posts.map((p) => <li key={p.slug}><Link href={`/blog/${p.slug}`}>{p.title}</Link></li>)}</ul>
    </>
  );
}
