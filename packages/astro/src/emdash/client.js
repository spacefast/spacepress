// The `emdash` module for EmDash's official Astro templates, over a SpacePress site's API
// (`/wp-json/spacepress/v1`). spEmdash() points `emdash` here, so a template's
// `import { getEmDashCollection } from "emdash"` reads SpacePress kinds with no code in the template.
//
// The SpacePress app is expected to declare what the templates read: `posts` and `pages` collections
// (title, body, excerpt, cover, seoTitle, seoDescription), `category`, `tag` and `credits`
// taxonomies on posts, and a `widgets` global. Missing pieces read as empty.
import { parseHTML } from "linkedom";

import { connect } from "../index.js";
import { requestContext } from "./context.js";

const API = "/wp-json/spacepress/v1";
const env = (name) => {
  const value = globalThis.process?.env?.[name];
  return typeof value === "string" && value !== "" ? value : undefined;
};
const noCache = false;

/** The SpacePress site's URL: SP_URL (SP_BACKEND_URL is read too, as the earlier bridge named it). */
export function backendUrl() {
  const url = env("SP_URL") ?? env("SP_BACKEND_URL");
  if (!url) throw new Error("@spacepress/astro/emdash: set SP_URL to the SpacePress site's URL");
  return url.replace(/\/+$/, "");
}

let connection;
// Always as an anonymous visitor: the pages this renders are public, whatever credentials the
// server's environment holds for builds (SP_APP_PASSWORD would show drafts to everyone).
const site = () => (connection ??= connect({ site: backendUrl(), anonymous: true }));
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

/**
 * WordPress's rendered HTML as the Portable Text view the templates read: one block per top-level
 * node (an element, or a run of text), its text for reading time and headings, and `_html` for
 * <PortableText> to render as is. Parsed as HTML, so nesting, void elements and entities are
 * WordPress's own.
 */
export function blocksFromHtml(html) {
  if (!html) return [];
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const blocks = [];
  let i = 0;
  for (const node of [...document.body.childNodes]) {
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (text) blocks.push({ _type: "block", _key: String(i++), style: "normal", children: [{ _type: "span", text }], _html: node.toString() });
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toLowerCase();
    const style = /^h[1-6]$/.test(tag) ? tag : tag === "blockquote" ? "blockquote" : "normal";
    blocks.push({ _type: "block", _key: String(i++), style, children: [{ _type: "span", text: node.textContent.replace(/\s+/g, " ").trim() }], _html: node.outerHTML });
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
  // The API takes offsets of at most nine digits; any other cursor is the first page.
  const offset = /^\d{1,9}$/.test(String(options.cursor ?? "")) ? Number(options.cursor) : 0;
  const filters = [];
  for (const [taxonomy, slug] of Object.entries(options.where ?? {})) {
    if (!slug) continue;
    if (!(await kinds())[collection]?.columns?.[taxonomy]) return { entries: [], total: 0, cacheHint: noCache, nextCursor: undefined };
    filters.push({ [taxonomy]: { slug: String(slug) } });
  }
  const month = requestContext.getStore()?.month;
  const where = and(...filters, month ? monthRange(month) : null);
  const page = await rows(collection, { where, orderBy: "-publishedAt,-id", limit: limit + 1, offset });
  const more = page.rows.length > limit;
  const list = await entries(collection, page.rows.slice(0, limit));
  return { entries: list, total: offset + list.length, cacheHint: noCache, nextCursor: more ? String(offset + limit) : undefined };
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

/** A draft through a signed preview link: SpacePress's staged-version preview, for the item the token names. */
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
  // A staged version isn't rendered by WordPress: its block markup is shown as saved.
  return { ...staged.row, __html: staged.row.body ?? "" };
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
 * The signed-in WordPress user: always null. Core accepts the login cookie only with a REST nonce,
 * which a page served from another origin doesn't have, and taking the cookie alone would let any
 * site learn who a visitor is. So the templates' signed-in extras (the admin link) don't show.
 */
export async function getSession() {
  return { user: null };
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

/**
 * A comment as plain paragraphs of its text, escaped: comment HTML is filtered only when it was
 * saved (not at all for users with unfiltered_html), so none of it is passed on.
 */
function commentHtml(rendered) {
  const { document } = parseHTML(`<!doctype html><html><body>${rendered}</body></html>`);
  const escape = (v) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const paragraphs = [...document.body.querySelectorAll("p")].map((p) => p.textContent.trim()).filter(Boolean);
  const parts = paragraphs.length ? paragraphs : [document.body.textContent.trim()].filter(Boolean);
  return parts.map((p) => `<p>${escape(p)}</p>`).join("\n");
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
      .map((c) => ({ id: String(c.id), parent: String(c.parent ?? 0), author: c.authorName ?? "", html: commentHtml(c.content ?? "") })),
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
export const getI18nConfig = () => ({ defaultLocale: env("SP_LOCALE") ?? "en" });
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

/** `emdash/runtime`'s loader, for an unchanged `src/live.config.ts`: a live collection over every SpacePress kind. */
export { spLiveLoader as emdashLoader } from "../index.js";
