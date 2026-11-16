// `/api/search?q=`: the JSON the templates' live search reads, `{ items: [{ title, path }] }`.
// Posts link to /posts/<slug>; pages to /pages/<slug> (the blog's routes) or /<slug> with `pagesAt: "/"`.
import { search } from "./client.js";

export async function GET({ url }) {
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) return Response.json({ items: [] });
  // eslint-disable-next-line no-undef -- set by tpEmdash() through Vite's `define`
  const pagesAt = typeof __TP_EMDASH_PAGES_AT__ === "string" ? __TP_EMDASH_PAGES_AT__ : "/pages/";
  const [posts, pages] = await Promise.all([search(q, { collections: ["posts"], limit: 6 }), search(q, { collections: ["pages"], limit: 4 })]);
  return Response.json({
    items: [
      ...posts.items.map((i) => ({ title: i.title, path: `/posts/${i.slug}` })),
      ...pages.items.map((i) => ({ title: i.title, path: `${pagesAt}${i.slug}` })),
    ],
  });
}
export const prerender = false;
