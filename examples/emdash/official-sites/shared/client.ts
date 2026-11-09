import { z } from 'zod';
import { requestContext } from './context';

const cacheDisabled = (): false => false;
const termSchema = z.object({ id: z.string(), slug: z.string(), label: z.string(), description: z.string().optional() });
const blockSchema = z.looseObject({
  _type: z.string(), _key: z.string(), style: z.string().optional(),
  children: z.array(z.object({ _type: z.string(), text: z.string().optional() })).optional(),
  _html: z.string().optional(),
});
export type PortableTextBlock = z.infer<typeof blockSchema>;
const imageSchema = z.object({ src: z.string(), alt: z.string() });
const creditSchema = z.object({ byline: z.object({ displayName: z.string(), avatarStorageKey: z.string().optional() }), roleLabel: z.string().nullable() });
export type ContentBylineCredit = z.infer<typeof creditSchema>;
const dataSchema = z.object({
  id: z.string(), title: z.string(), content: z.array(blockSchema), excerpt: z.string(),
  featured_image: imageSchema.nullable(), publishedAt: z.string().nullable().transform(v => v ? new Date(v) : null),
  updatedAt: z.string().transform(v => new Date(v)), seoTitle: z.string(), seoDescription: z.string(),
  terms: z.object({ tag: z.array(termSchema), category: z.array(termSchema) }), bylines: z.array(creditSchema),
});
const entrySchema = z.object({ id: z.string(), data: dataSchema,
  edit: z.object({ title: z.record(z.string(), z.string()), excerpt: z.record(z.string(), z.string()), content: z.record(z.string(), z.string()), featured_image: z.record(z.string(), z.string()).default({}) }) });
export type InferCollectionData<T extends string> = z.infer<typeof dataSchema> & { readonly collection?: T };
export type ContentEntry<T = z.infer<typeof dataSchema>> = Omit<z.infer<typeof entrySchema>, 'data'> & { data: T };
const siteSchema = z.object({
  settings: z.object({ title: z.string(), tagline: z.string(), logo: z.object({ mediaId: z.string(), alt: z.string(), url: z.string() }).optional(), favicon: z.object({ mediaId: z.string(), alt: z.string(), url: z.string() }).optional() }),
  menus: z.array(z.object({ name: z.string(), label: z.string(), items: z.array(z.object({ type: z.string(), label: z.string(), url: z.string(), target: z.string().optional() })) })),
  widgets: z.array(z.object({ name: z.string(), widgets: z.array(z.looseObject({ type: z.string(), title: z.string().optional(), componentId: z.string().optional(), content: z.array(blockSchema).optional(), props: z.record(z.string(), z.unknown()).optional() })) })),
});
export function backendUrl() {
  const value = process.env.FIRST_BACKEND_URL;
  if (!value) throw new Error('FIRST_BACKEND_URL must name the owned native Studio backend.');
  return value.replace(/\/$/, '');
}
async function native<T>(path: string, schema: z.ZodType<T>, cookie?: string): Promise<T> {
  const response = await fetch(`${backendUrl()}/wp-json/first-official/v1/${path}`, { signal: AbortSignal.timeout(30000), cache: 'no-store', headers: cookie ? { cookie } : undefined });
  if (!response.ok) throw new Error(`Native First read failed (${response.status}): ${path}`);
  const value: unknown = await response.json();
  return schema.parse(value);
}
const collectionSchema = z.object({ entries: z.array(entrySchema), total: z.number() });
type Query = { orderBy?: { published_at: string }; limit?: number; cursor?: string; where?: { category?: string; tag?: string } };
export async function getEmDashCollection(collection: 'posts' | 'pages', options: Query = {}) {
  const limit = options.limit ?? 20;
  const offset = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
  const query = new URLSearchParams({ limit: String(limit), offset: String(Number.isSafeInteger(offset) && offset >= 0 ? offset : 0) });
  const month = requestContext.getStore()?.month;
  if (month) query.set('month', month);
  for (const [key, value] of Object.entries(options.where ?? {})) if (value) query.set(key, value);
  const result = await native(`content/${collection}?${query}`, collectionSchema);
  return { ...result, cacheHint: cacheDisabled(), nextCursor: offset + limit < result.total ? String(offset + limit) : undefined };
}
export async function getEmDashEntry(collection: 'posts' | 'pages', slug: string) {
  const query = new URLSearchParams({ slug, limit: '1' });
  const preview = requestContext.getStore()?.preview;
  if (preview) query.set('preview', preview);
  const result = await native(`content/${collection}?${query}`, collectionSchema);
  return { entry: result.entries[0] ?? null, cacheHint: cacheDisabled() };
}
export const getSession = (cookie: string) => native('session', z.object({ user: z.object({ id: z.number(), name: z.string() }).nullable() }), cookie);
export const getSite = () => native('site', siteSchema);
export const getSiteSettings = async () => (await getSite()).settings;
export const getSiteSettingsWithCacheHint = async () => ({ data: await getSiteSettings(), cacheHint: cacheDisabled() });
export const getMenuWithCacheHint = async (name: string) => ({ data: (await getSite()).menus.find(menu => menu.name === name) ?? null, cacheHint: cacheDisabled() });
export const getTaxonomyTermsWithCacheHint = async (taxonomy: 'tag' | 'category', _options?: { includeCounts: boolean }) => ({ data: await native(`terms/${taxonomy}`, z.array(termSchema)), cacheHint: cacheDisabled() });
export async function getTermsForEntries(collection: 'posts' | 'pages', ids: string[], taxonomy: 'tag' | 'category') {
  // A single native request, rather than N per-entry taxonomy requests.
  if (!ids.length) return new Map<string, z.infer<typeof termSchema>[]>();
  const { entries } = await native(`content/${collection}?${new URLSearchParams({ ids: ids.join(','), limit: String(ids.length) })}`, collectionSchema);
  return new Map(entries.map(entry => [entry.data.id, entry.data.terms[taxonomy]]));
}
export function decodeSlug(slug: string | undefined) {
  try { return slug ? decodeURIComponent(slug) : undefined; } catch { return undefined; }
}
export const getI18nConfig = () => ({ defaultLocale: process.env.FIRST_LOCALE ?? 'en' });
export function getSeoMeta(entry: z.infer<typeof entrySchema>, options: { siteTitle: string; siteUrl: string; path: string; defaultOgImage?: string }) {
  const title = entry.data.seoTitle || entry.data.title;
  const description = entry.data.seoDescription || entry.data.excerpt;
  return { title, ogTitle: title, pageTitle: entry.data.title, description, canonical: `${options.siteUrl}${options.path}`, ogImage: options.defaultOgImage,
    robots: undefined, ogType: 'article', publishedTime: entry.data.publishedAt?.toISOString(), modifiedTime: entry.data.updatedAt.toISOString(), author: entry.data.bylines.map(c => c.byline.displayName).join(', ') };
}
export class SearchUnavailableError extends Error {}
export type SearchResponse = { items: { id: string; slug: string; title: string; snippet: string }[]; nextCursor?: string };
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function highlightTitle(title: string, query: string) {
  const terms = query.split(/\s+/).filter(Boolean).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return escapeHtml(title);
  return title.split(new RegExp(`(${terms.join('|')})`, 'gi')).map((part, index) => index % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join('');
}
export async function search(query: string, options: { collections: string[]; limit: number }): Promise<SearchResponse> {
  const results = await Promise.all(options.collections.filter(c => c === 'posts' || c === 'pages').map(collection => native(`content/${collection}?${new URLSearchParams({ search: query, limit: String(options.limit) })}`, collectionSchema)));
  return { items: results.flatMap(r => r.entries).slice(0, options.limit).map(entry => ({ id: entry.data.id, slug: entry.id, title: entry.data.title,
    snippet: highlightTitle(entry.data.title, query) })) };
}
export const getComments = (id: string) => native(`comments/${encodeURIComponent(id)}?${new URLSearchParams({ preview: requestContext.getStore()?.preview ?? '' })}`, z.object({ open: z.boolean(), items: z.array(z.object({ id: z.string(), parent: z.string(), author: z.string(), html: z.string() })) }));
