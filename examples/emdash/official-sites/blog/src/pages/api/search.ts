import type { APIRoute } from 'astro';
import { search } from '../../../../shared/client';
export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (!q) return Response.json({ items: [] });
  const [posts, pages] = await Promise.all([search(q, { collections: ['posts'], limit: 6 }), search(q, { collections: ['pages'], limit: 4 })]);
  return Response.json({ items: [...posts.items.map(item => ({ title: item.title, path: `/posts/${item.slug}` })), ...pages.items.map(item => ({ title: item.title, path: `/pages/${item.slug}` }))] });
};
