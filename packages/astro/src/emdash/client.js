// The `emdash` module for EmDash's official Astro templates, over a First site's API
// (`/__first/api/v1`). firstEmdash() points `emdash` here, so a template's
// `import { getEmDashCollection } from "emdash"` reads First kinds with no code in the template.
//
// The First app is expected to declare what the templates read: `posts` and `pages` collections
// (title, body, excerpt, cover, seoTitle, seoDescription), `category`, `tag` and `credits`
// taxonomies on posts, and a `widgets` global. Missing pieces read as empty.
import { connect } from "../index.js";
import { requestContext } from "./context.js";

const API = "/__first/api/v1";
const env = (name) => {
  const value = globalThis.process?.env?.[name];
  return typeof value === "string" && value !== "" ? value : undefined;
};
const noCache = false;

/** The First site's URL: FIRST_URL (FIRST_BACKEND_URL is read too, as the earlier bridge named it). */
export function backendUrl() {
  const url = env("FIRST_URL") ?? env("FIRST_BACKEND_URL");
  if (!url) throw new Error("@first/astro/emdash: set FIRST_URL to the First site's URL");
  return url.replace(/\/+$/, "");
}

let connection;
const site = () => (connection ??= connect({ site: backendUrl() }));
const get = (path) => site().request("GET", `${API}${path}`).then((r) => r.data);
const kinds = async () => (await site().describe()).kinds ?? {};
const has = async (name) => Boolean((await kinds())[name]);
/** The kind's slug field, or null: then an entry's id is its row id. */
const slugField = async (kind) => (await kinds())[kind]?.slug ?? null;

const query = (q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null) p.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

// ------------------------------------------------------------------------------------------------
// Blocks and entries

const decode = (html) =>
  html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, " ").trim();

/**
 * WordPress's rendered HTML as the Portable Text view the templates read: one block per top-level
 * element, its text for reading time and headings, and `_html` for <PortableText> to render as is.
 */
export function blocksFromHtml(html) {
  const blocks = [];
  const re = /<(h[1-6]|p|ul|ol|blockquote|figure|pre|table|div|hr|img)\b[^>]*>[\s\S]*?(?:<\/\1>|$)|<(?:hr|img)\b[^>]*\/?>/gi;
  let i = 0;
  for (const match of (html ?? "").matchAll(re)) {
    const part = match[0].trim();
    if (part === "") continue;
    const tag = (match[1] ?? part.slice(1, 4)).toLowerCase();
    blocks.push({ _type: "block", _key: String(i++), style: /^h[1-6]$/.test(tag) ? tag : tag === "blockquote" ? "blockquote" : "normal",
      children: [{ _type: "span", text: decode(part) }], _html: part });
  }
  return blocks;
}

const term = (t) => ({ id: String(t.id), slug: t.slug, label: t.name, ...(t.description ? { description: t.description } : {}) });

/** Core's rendered HTML of each post or page, by id: blocks, shortcodes and embeds as WordPress renders them. */
async function rendered(kind, ids) {
  const out = new Map();
  if (ids.length === 0) return out;
  const route = (await kinds())[kind]?.route;
  if (!route) return out;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const items = await site().request("GET", `/?${new URLSearchParams({ rest_route: route, where: JSON.stringify({ id: { in: chunk } }), _fields: "id,content", per_page: "100" })}`).catch(() => []);
    for (const item of Array.isArray(items) ? items : []) if (typeof item?.content?.rendered === "string") out.set(item.id, item.content.rendered);
  }
  return out;
}

function entry(kind, row, html, slugKey) {
  const cover = row.cover && typeof row.cover === "object" ? row.cover : null;
  const credits = Array.isArray(row.credits) ? row.credits : [];
  return {
    id: String((slugKey ? row[slugKey] : null) ?? row.id),
    data: {
      id: String(row.id),
      title: row.title ?? "",
      content: blocksFromHtml(html ?? ""),
      excerpt: row.excerpt ?? "",
      featured_image: cover ? { id: String(cover.id), src: cover.url, alt: cover.alt ?? "", width: cover.width ?? undefined, height: cover.height ?? undefined } : null,
      publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
      updatedAt: new Date(row.updatedAt ?? row.publishedAt ?? Date.now()),
      seoTitle: row.seoTitle ?? "",
      seoDescription: row.seoDescription ?? "",
      terms: { tag: (row.tag ?? []).filter((t) => typeof t === "object").map(term), category: (row.category ?? []).filter((t) => typeof t === "object").map(term) },
      bylines: credits.filter((c) => typeof c === "object").map((c) => ({ byline: { displayName: c.name }, roleLabel: c.role ?? null })),
    },
    edit: { title: {}, excerpt: {}, content: {}, featured_image: {} },
  };
}

async function withOf(kind) {
  const all = await kinds();
  const columns = all[kind]?.columns ?? {};
  const w = {};
  for (const name of ["cover", "category", "tag", "credits"]) if (columns[name]) w[name] = true;
  return w;
}

async function rows(kind, q) {
  const page = await site().request("GET", `${API}/${kind}${query({ ...q, with: await withOf(kind) })}`);
  return { rows: page.data ?? [], cursor: page.cursor ?? null };
}

async function entries(kind, list) {
  const [html, slugKey] = await Promise.all([rendered(kind, list.map((r) => r.id)), slugField(kind)]);
  return list.map((row) => entry(kind, row, html.get(row.id), slugKey));
}

/** A month (`2026-03`) as a publishedAt range. */
function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m) return null;
  const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const end = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
  return { publishedAt: { gte: start.toISOString(), lt: end.toISOString() } };
}

const and = (...parts) => {
  const p = parts.filter((x) => x && Object.keys(x).length > 0);
  return p.length === 0 ? undefined : p.length === 1 ? p[0] : { AND: p };
};

// ------------------------------------------------------------------------------------------------
// Collections

export async function getEmDashCollection(collection, options = {}) {
  const limit = options.limit ?? 20;
  const offset = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
  const filters = [];
  for (const [taxonomy, slug] of Object.entries(options.where ?? {})) {
    if (!slug) continue;
    if (!(await kinds())[collection]?.columns?.[taxonomy]) return { entries: [], total: 0, cacheHint: noCache, nextCursor: undefined };
    filters.push({ [taxonomy]: { slug: String(slug) } });
  }
  const month = requestContext.getStore()?.month;
  const where = and(...filters, month ? monthRange(month) : null);
  const page = await rows(collection, { where, orderBy: "-publishedAt,-id", limit: limit + 1, offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : 0 });
  const more = page.rows.length > limit;
  const list = await entries(collection, page.rows.slice(0, limit));
  return { entries: list, total: offset + page.rows.length, cacheHint: noCache, nextCursor: more ? String(offset + limit) : undefined };
}

export async function getEmDashEntry(collection, slug) {
  const preview = requestContext.getStore()?.preview;
  const field = await slugField(collection);
  const match = field ? { [field]: slug } : /^\d+$/.test(slug) ? { id: Number(slug) } : null;
  const { rows: found } = match ? await rows(collection, { where: match, limit: 1 }) : { rows: [] };
  let row = found[0];
  if (!row && preview) row = await previewed(collection, slug, preview);
  if (!row) return { entry: null, cacheHint: noCache };
  const html = row.__html !== undefined ? new Map([[row.id, row.__html]]) : await rendered(collection, [row.id]);
  return { entry: entry(collection, row, html.get(row.id), field), cacheHint: noCache };
}

/** A draft through a signed preview link: First's staged-version preview, for the item the token names. */
async function previewed(collection, slug, token) {
  const [, payload] = /^([^.]+)\./.exec(token) ?? [];
  let claim;
  try {
    claim = JSON.parse(Buffer.from((payload ?? "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(claim) || claim[0] !== collection || !Number.isInteger(claim[1])) return null;
  const staged = await site().request("GET", `${API}/${collection}/${claim[1]}/staged?preview=${encodeURIComponent(token)}`).then((r) => r.data).catch(() => null);
  const field = await slugField(collection);
  if (!staged?.row || String((field ? staged.row[field] : staged.row.id) ?? "") !== slug) return null;
  return { ...staged.row, __html: staged.html ?? staged.row.body ?? "" };
}

export async function getTermsForEntries(collection, ids, taxonomy) {
  const out = new Map();
  if (!ids.length || !(await kinds())[collection]?.columns?.[taxonomy]) return out;
  const { rows: found } = await rows(collection, { where: { id: { in: ids.map(Number) } }, limit: ids.length });
  for (const row of found) out.set(String(row.id), (row[taxonomy] ?? []).filter((t) => typeof t === "object").map(term));
  return out;
}

export async function getTaxonomyTermsWithCacheHint(taxonomy) {
  if (!(await has(taxonomy))) return { data: [], cacheHint: noCache };
  const data = [];
  for (let offset = 0; ; offset += 100) {
    const page = await site().request("GET", `${API}/${taxonomy}${query({ limit: 100, offset })}`);
    data.push(...(page.data ?? []).map(term));
    if (!page.cursor) break;
  }
  return { data, cacheHint: noCache };
}

// ------------------------------------------------------------------------------------------------
// Site

const mediaRef = async (id) => {
  if (!id) return undefined;
  const m = await get(`/media/${id}`).catch(() => null);
  return m ? { mediaId: String(m.id), alt: m.alt ?? "", url: m.url } : undefined;
};

export async function getSiteSettings() {
  const s = await get("/settings");
  const [logo, favicon] = await Promise.all([mediaRef(s.logo), mediaRef(s.icon)]);
  return { title: s.title ?? "", tagline: s.tagline ?? "", ...(logo ? { logo } : {}), ...(favicon ? { favicon } : {}) };
}
export const getSiteSettingsWithCacheHint = async () => ({ data: await getSiteSettings(), cacheHint: noCache });

export async function getMenuWithCacheHint(name) {
  const menus = await get("/menus").catch(() => []);
  const menu = (menus ?? []).find((m) => m.location === name);
  const flat = (items) => items.flatMap((i) => [{ type: "custom", label: i.label, url: i.url ?? "#" }, ...flat(i.children ?? [])]);
  return { data: menu ? { name, label: name, items: flat(menu.items ?? []) } : null, cacheHint: noCache };
}

/** The widget areas, from the app's `widgets` global (`{ areas: [{ name, widgets }] }`). */
export async function getWidgetAreas() {
  if (!(await kinds()) || !(await site().describe()).globals?.widgets) return [];
  const g = await get("/widgets").catch(() => null);
  return Array.isArray(g?.areas) ? g.areas : [];
}

/**
 * The signed-in WordPress user, from the visitor's cookies (`GET /me`), or null. Today this is
 * always null: core accepts a cookie only with a REST nonce, which a page served elsewhere doesn't
 * have, and the API doesn't take a cookie alone (that would let any site read who a visitor is).
 */
export async function getSession(cookie) {
  if (!cookie) return { user: null };
  const me = await site().request("GET", `${API}/me`, undefined, { cookie }).then((r) => r.data).catch(() => null);
  return { user: me ? { id: me.id, name: me.name } : null };
}

// ------------------------------------------------------------------------------------------------
// Search and comments

const escapeHtml = (v) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
function highlight(title, q) {
  const words = q.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return escapeHtml(title);
  return title.split(new RegExp(`(${words.join("|")})`, "gi")).map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))).join("");
}
export class SearchUnavailableError extends Error {}
export async function search(q, options = {}) {
  const limit = options.limit ?? 10;
  const results = await Promise.all((options.collections ?? ["posts"]).filter((c) => c === "posts" || c === "pages").map(async (c) => (await has(c)) ? (await rows(c, { search: q, limit })).rows.map((r) => ({ ...r, __kind: c })) : []));
  const slugs = Object.fromEntries(await Promise.all(["posts", "pages"].map(async (c) => [c, await slugField(c)])));
  return { items: results.flat().slice(0, limit).map((r) => ({ id: String(r.id), slug: String((slugs[r.__kind] ? r[slugs[r.__kind]] : null) ?? r.id), title: r.title ?? "", snippet: highlight(r.title ?? "", q) })) };
}

/** Approved comments of an item (`GET /comments?post=`), and whether it takes new ones. */
export async function getComments(id) {
  const preview = requestContext.getStore()?.preview;
  if (preview) return { open: false, items: [] };
  const list = await site().request("GET", `${API}/comments${query({ post: id, limit: 100 })}`).then((r) => r.data ?? []).catch(() => []);
  const route = (await kinds()).posts?.route;
  const status = route ? await site().request("GET", `/?${new URLSearchParams({ rest_route: `${route}/${id}`, _fields: "comment_status" })}`).catch(() => null) : null;
  return {
    open: status?.comment_status === "open",
    items: list.filter((c) => c.status === "approved").sort((a, b) => a.id - b.id)
      .map((c) => ({ id: String(c.id), parent: String(c.parent ?? 0), author: c.authorName ?? "", html: c.content ?? "" })),
  };
}

// ------------------------------------------------------------------------------------------------
// The rest of the `emdash` surface the templates use

export function decodeSlug(slug) {
  try {
    return slug ? decodeURIComponent(slug) : undefined;
  } catch {
    return undefined;
  }
}
export const getI18nConfig = () => ({ defaultLocale: env("FIRST_LOCALE") ?? "en" });
export function getSeoMeta(e, options) {
  const title = e.data.seoTitle || e.data.title;
  const description = e.data.seoDescription || e.data.excerpt;
  return { title, ogTitle: title, pageTitle: e.data.title, description, canonical: `${options.siteUrl}${options.path}`, ogImage: options.defaultOgImage,
    robots: undefined, ogType: "article", publishedTime: e.data.publishedAt?.toISOString(), modifiedTime: e.data.updatedAt.toISOString(),
    author: e.data.bylines.map((c) => c.byline.displayName).join(", ") };
}
export function createPublicPageContext(page) {
  return page;
}

/** `emdash/runtime`'s loader, for an unchanged `src/live.config.ts`: a live collection over every First kind. */
export { firstLiveLoader as emdashLoader } from "../index.js";
