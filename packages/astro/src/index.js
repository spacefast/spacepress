// @first/astro: a First site as the content source of an Astro site.
//
// - firstLoader(kind): a build-time content collection. Each build asks the site whether each page
//   of the collection changed since the last one, with the tokens `POST /__first/api/v1/_live`
//   issued; a page that didn't change costs no rows, and Astro's digest skips the unchanged
//   entries of a page that did.
// - firstLiveLoader(kind?): a live collection, read at request time, with cache hints tagged
//   `<kind>` and `<kind>:<id>`.
// - firstWebhook(): an Astro endpoint that verifies First's signed webhook and invalidates those tags.
//
// It speaks the same HTTP API as the typed client `first build` generates (`/__first/api/v1`), so the
// Astro project needs only the site's URL, in this repository or another one.

import { z } from "astro/zod";

const API = "/__first/api/v1";
/** The API's largest page (Facade::MAX_LIMIT, Live\Module::MAX_LIST_LIMIT). */
const PAGE = 100;
/** Reads one `_live` request may carry (Live\Module::MAX_QUERIES). */
const BATCH = 20;
/** The meta key a build-time collection keeps its page tokens under. */
const STATE = "first:pages";
/** How old a webhook's timestamp may be, in seconds (the runtime's own tolerance). */
const TOLERANCE_S = 300;

/** Thrown for every answer that is not a 2xx; the fields are the problem document's. */
export class FirstError extends Error {
  /** @param {number} status @param {string} code @param {string} detail @param {string} [pointer] */
  constructor(status, code, detail, pointer) {
    super(`${status} ${code}: ${detail}${pointer ? ` (at ${pointer})` : ""}`);
    this.name = "FirstError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.pointer = pointer;
  }
}

const env = (name) => {
  const value = globalThis.process?.env?.[name];
  return typeof value === "string" && value !== "" ? value : undefined;
};

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The site's origin and path, without the API prefix or a trailing slash. */
function siteUrl(site) {
  const url = site ?? env("FIRST_URL");
  if (!url) throw new Error("@first/astro: set FIRST_URL to the First site's URL, or pass { site }");
  return String(url).replace(/\/+$/, "").replace(/\/__first\/api\/v1$/, "");
}

const connections = new Map();

/**
 * One site's connection: the URL, the credentials and the site's description (fetched once).
 * @param {import("./index.d.ts").FirstOptions} [options]
 */
export function connect(options = {}) {
  const site = siteUrl(options.site);
  const headers = { accept: "application/json", ...options.headers };
  const password = options.appPassword ?? env("FIRST_APP_PASSWORD");
  const token = options.token ?? env("FIRST_TOKEN");
  if (!Object.keys(headers).some((h) => h.toLowerCase() === "authorization")) {
    if (password) headers.authorization = `Basic ${base64(password)}`;
    else if (token) headers.authorization = `Bearer ${token}`;
  }
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const key = JSON.stringify([site, headers]);
  // The description is shared by every collection of one build; a custom fetch gets its own.
  if (!options.fetch && connections.has(key)) return connections.get(key);

  async function request(method, path, body) {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await doFetch(path.startsWith("http") ? path : site + path, init);
    } catch (e) {
      throw new FirstError(0, "network", `${method} ${site + path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
      // not JSON: reported below with the status
    }
    if (!response.ok) {
      throw new FirstError(response.status, parsed?.code ?? "http_error", parsed?.detail ?? (text.slice(0, 200) || response.statusText), parsed?.pointer);
    }
    if (parsed === null && text !== "") throw new FirstError(response.status, "invalid_json", `${method} ${path} did not answer JSON`);
    return parsed;
  }

  let described;
  const connection = {
    site,
    request,
    /** `GET /__first/api/v1`: the app's kinds, fields and actions. */
    describe() {
      described ??= request("GET", API).then((r) => r.data).catch((e) => {
        described = undefined;
        throw e;
      });
      return described;
    },
    /** What the loaders need to know about one kind. */
    async kind(name) {
      const app = await this.describe();
      const kind = app.kinds?.[name];
      if (!kind) {
        const known = Object.keys(app.kinds ?? {}).filter((k) => k !== "settings");
        throw new Error(`@first/astro: ${site} has no kind '${name}' (it has ${known.join(", ")})`);
      }
      return kindInfo(name, kind);
    },
  };
  if (!options.fetch) connections.set(key, connection);
  return connection;
}

/** A kind as the loaders use it. Built-in WordPress kinds have no field list in the description. */
function kindInfo(name, kind) {
  const first = kind.type !== "builtin";
  const columns = first ? kind.columns ?? {} : {};
  const media = Object.entries(columns).filter(([, c]) => c.type === "media" || c.type === "mediaList").map(([n]) => n);
  return {
    name,
    first,
    route: kind.route,
    type: kind.type,
    primaryKey: first ? kind.primaryKey : "id",
    slug: first ? kind.slug ?? null : ["posts", "pages", "categories", "tags"].includes(name) ? "slug" : null,
    content: first ? kind.content ?? null : null,
    drafts: first ? Boolean(kind.drafts) : name === "posts" || name === "pages",
    columns,
    relations: first ? kind.relations ?? {} : {},
    media,
  };
}

/** The entry id of a row: the `id` option, else the kind's slug, else its primary key. */
function entryId(info, options, row) {
  if (typeof options.id === "function") return String(options.id(row));
  const field = options.id ?? info.slug ?? info.primaryKey;
  const value = row[field] ?? row[info.primaryKey];
  return String(value);
}

/** `with`: what the options ask for, plus every media field, so entries carry media URLs. */
function withOf(info, options) {
  const out = {};
  if (info.first && options.media !== false) for (const m of info.media) out[m] = true;
  return { ...out, ...(options.with ?? {}) };
}

/** The `where` every read of the collection starts from: the options' own, published rows only by default. */
function whereOf(info, options) {
  const parts = [];
  if (options.where !== undefined) parts.push(options.where);
  if (info.drafts && !options.drafts && info.first) parts.push({ status: "published" });
  return parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { AND: parts };
}

const nonEmpty = (o) => o && Object.keys(o).length > 0;

/** Facade list parameters (the generated client's `listParams`). */
function listQuery(q) {
  const p = new URLSearchParams();
  if (nonEmpty(q.where)) p.set("where", JSON.stringify(q.where));
  if (typeof q.status === "string") p.set("status", q.status);
  if (typeof q.locale === "string") p.set("locale", q.locale);
  if (typeof q.search === "string") p.set("search", q.search);
  if (q.orderBy !== undefined) {
    const order = typeof q.orderBy === "string" ? q.orderBy
      : Object.entries(q.orderBy).filter(([, d]) => d === "asc" || d === "desc").map(([c, d]) => (d === "desc" ? `-${c}` : c)).join(",");
    if (order) p.set("orderBy", order);
  }
  if (typeof q.limit === "number") p.set("limit", String(q.limit));
  if (typeof q.offset === "number") p.set("offset", String(q.offset));
  if (nonEmpty(q.with)) p.set("with", JSON.stringify(q.with));
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

/** Core's rendered HTML of a post kind's content (blocks, shortcodes and embeds run by WordPress), by id. */
async function renderedHtml(connection, info, ids) {
  const out = new Map();
  if (!info.content || !info.route || info.type !== "post" || ids.length === 0) return out;
  for (let i = 0; i < ids.length; i += PAGE) {
    const chunk = ids.slice(i, i + PAGE);
    const q = new URLSearchParams({
      rest_route: info.route,
      where: JSON.stringify({ [info.primaryKey]: { in: chunk } }),
      _fields: "id,content",
      per_page: String(PAGE),
    });
    const items = await connection.request("GET", `/?${q}`);
    for (const item of Array.isArray(items) ? items : []) {
      if (typeof item?.content?.rendered === "string") out.set(item.id, item.content.rendered);
    }
  }
  return out;
}

/** The cache tags of a row: `<kind>:<id>`, and the same for each row and media item loaded through `with`. */
function rowTags(info, row) {
  const tags = [`${info.name}:${row[info.primaryKey]}`];
  for (const [field, rel] of Object.entries(info.relations)) {
    const value = row[field];
    const target = rel?.collection;
    if (!target) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v && typeof v === "object" && v.id !== undefined) tags.push(`${target}:${v.id}`);
    }
  }
  for (const field of info.media) {
    const value = row[field];
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v && typeof v === "object" && v.id !== undefined) tags.push(`media:${v.id}`);
    }
  }
  return tags;
}

// ---------------------------------------------------------------------------------------------
// Build-time collections
// ---------------------------------------------------------------------------------------------

/**
 * A build-time content collection of one First kind.
 * @param {string} kind
 * @param {import("./index.d.ts").FirstLoaderOptions} [options]
 */
export function firstLoader(kind, options = {}) {
  return {
    name: "@first/astro",
    async createSchema() {
      const info = await connect(options).kind(kind);
      return { schema: zodSchema(info, options), types: tsTypes(info, options) };
    },
    async load(context) {
      const connection = connect(options);
      const info = await connection.kind(kind);
      const query = { where: whereOf(info, options), with: withOf(info, options) };
      const key = JSON.stringify([connection.site, kind, query, typeof options.id === "function" ? String(options.id) : options.id ?? null]);
      let saved = null;
      try {
        saved = JSON.parse(context.meta.get(STATE) ?? "null");
      } catch {
        saved = null;
      }
      const result = info.first
        ? await syncPages(connection, info, query, saved?.key === key ? saved.pages : null, context.store, options)
        : { rows: await readAll(connection, info, query, options), pages: null, unchanged: 0, total: 0 };
      const keep = new Set(result.kept);
      // What changed: rows whose digest differs from the stored entry's.
      const writes = [];
      for (const row of result.rows) {
        const id = entryId(info, options, row);
        keep.add(id);
        const digest = context.generateDigest(row);
        if (context.store.get(id)?.digest === digest) continue;
        writes.push({ id, row, digest });
      }
      const html = await renderedHtml(connection, info, writes.map((w) => w.row[info.primaryKey]));
      for (const w of writes) {
        const data = await context.parseData({ id: w.id, data: w.row });
        const rendered = html.has(w.row[info.primaryKey]) ? { html: html.get(w.row[info.primaryKey]) } : undefined;
        context.store.set({ id: w.id, data, digest: w.digest, ...(rendered ? { rendered } : {}) });
      }
      let removed = 0;
      for (const id of context.store.keys()) {
        if (!keep.has(id)) {
          context.store.delete(id);
          removed++;
        }
      }
      if (result.pages) context.meta.set(STATE, JSON.stringify({ key, pages: result.pages }));
      else context.meta.delete(STATE);
      context.logger.info(`${kind}: ${writes.length} changed, ${removed} removed, ${keep.size} entries`
        + (result.pages ? `, ${result.unchanged} of ${result.pages.length} pages not modified` : ""));
    },
  };
}

/** Rows per request: the `pageSize` option, 1 to 100. */
function pageSize(options) {
  const n = options.pageSize ?? PAGE;
  if (!Number.isInteger(n) || n < 1 || n > PAGE) throw new Error(`@first/astro: pageSize is a whole number from 1 to ${PAGE}`);
  return n;
}

/** Every row of a kind the subscription endpoint doesn't answer (WordPress's own kinds), page by page. */
async function readAll(connection, info, query, options) {
  const rows = [];
  const size = pageSize(options);
  for (let offset = 0; ; offset += size) {
    const page = await connection.request("GET", `${API}/${encodeURIComponent(info.name)}${listQuery({ where: query.where, limit: size, offset, orderBy: { [info.primaryKey]: "asc" } })}`);
    rows.push(...(page.data ?? []));
    if (!page.cursor || (page.data ?? []).length === 0) return rows;
  }
}

/**
 * The collection as pages, each "the first `pageSize` rows after `lo`" in primary-key order (no `lo`
 * for the first), with the token of its last answer. A write to a row changes only the answer of the
 * page that holds it, and a new row with a higher key only that of the last page, which is never left
 * full: a full last page gets a page after it. Pages answered "not modified" keep their entries;
 * changed pages return their rows. A deleted row lets the next one into its page, so neighbouring
 * pages can overlap; a row inserted with a lower key can push a page's end below the next page's
 * start, and the gap gets a page of its own.
 *
 * @returns {Promise<{ rows: object[], kept: string[], pages: object[], unchanged: number }>}
 */
async function syncPages(connection, info, query, saved, store, options) {
  const pk = info.primaryKey;
  const size = pageSize(options);
  const pages = Array.isArray(saved) && saved.length > 0 ? saved.map((p) => ({ ...p })) : [{ lo: null, token: null, ids: [] }];
  // A saved page whose entries are no longer stored (a cleared cache) is read again.
  for (const p of pages) if (p.token && !p.ids.every((id) => store.has(id))) p.token = null;
  const args = (p) => {
    const where = [query.where, p.lo === null ? null : { [pk]: { gt: p.lo } }].filter(nonEmpty);
    return {
      where: where.length === 0 ? {} : where.length === 1 ? where[0] : { AND: where },
      orderBy: { [pk]: "asc" },
      limit: size,
      ...(nonEmpty(query.with) ? { with: query.with } : {}),
    };
  };
  /** @type {Map<object, object[]>} the rows of each page read in this build */
  const rows = new Map();
  let unchanged = 0;
  let todo = [...pages];
  for (let requests = 0; todo.length > 0; requests++) {
    if (requests > 10_000) throw new Error(`@first/astro: ${info.name} did not finish paging`);
    const batch = todo.slice(0, BATCH);
    todo = todo.slice(BATCH);
    const answer = await connection.request("POST", `${API}/_live`, {
      queries: batch.map((p) => ({ kind: info.name, op: "list", args: args(p), ...(p.token ? { token: p.token } : {}) })),
    });
    const results = answer?.data?.results ?? [];
    for (const [n, page] of batch.entries()) {
      const r = results[n] ?? { pending: true };
      if (r.error) throw new FirstError(r.error.status ?? 0, r.error.code ?? "error", r.error.detail ?? "", r.error.pointer);
      if (r.pending) {
        todo.push(page);
        continue;
      }
      page.token = r.token;
      if (r.changed === false) {
        unchanged++;
        continue;
      }
      const data = Array.isArray(r.data) ? r.data : [];
      rows.set(page, data);
      page.ids = data.map((row) => entryId(info, options, row));
      if (data.length < size) continue;
      // Full: the rows after its last one belong to the next page, or to a new one.
      const last = data[data.length - 1][pk];
      const next = pages[pages.indexOf(page) + 1];
      if (next === undefined || last < next.lo) {
        const rest = { lo: last, token: null, ids: [] };
        pages.splice(pages.indexOf(page) + 1, 0, rest);
        todo.push(rest);
      }
    }
  }
  const kept = pages.filter((p) => !rows.has(p)).flatMap((p) => p.ids);
  return { rows: [...rows.values()].flat(), kept, pages, unchanged };
}

// ---------------------------------------------------------------------------------------------
// Schemas from the site's description
// ---------------------------------------------------------------------------------------------

const media = () => z.looseObject({ id: z.number(), url: z.string() });

function zodColumn(col, expanded) {
  if (expanded) return z.unknown();
  let s;
  switch (col.type) {
    case "integer":
    case "real":
      s = z.number();
      break;
    case "boolean":
      s = z.boolean();
      break;
    case "media":
    case "file":
      s = z.union([z.number(), media()]);
      break;
    case "mediaList":
      s = z.array(z.union([z.number(), media()]));
      break;
    case "select":
      s = z.array(z.string());
      break;
    case "refList":
      s = z.array(z.union([z.number(), z.string(), z.looseObject({})]));
      break;
    case "group":
      s = z.looseObject({});
      break;
    case "repeater":
    case "blocks":
      s = z.array(z.looseObject({}));
      break;
    case "json":
      return z.unknown();
    default:
      s = Array.isArray(col.enum) && col.enum.length > 0 && col.enum.every((v) => typeof v === "string") ? z.enum(col.enum) : z.string();
  }
  if (!col.notNull) s = s.nullable();
  if (col.access) s = s.optional(); // a field the reader may not see is left out
  return s;
}

function expandedFields(info, options) {
  return new Set(Object.keys(options.with ?? {}).filter((k) => !info.media.includes(k)));
}

/** A Zod schema for the kind's rows (extra keys pass, so `with` relations and new fields survive). */
export function zodSchema(info, options = {}) {
  if (!info.first) return z.looseObject({ id: z.number() });
  const expanded = expandedFields(info, options);
  const shape = {};
  for (const [name, col] of Object.entries(info.columns)) shape[name] = zodColumn(col, expanded.has(name));
  return z.looseObject(shape);
}

const MEDIA_TS = "{ id: number; url: string; mime: string; width: number | null; height: number | null; alt: string | null; sizes: Record<string, { url: string; width: number; height: number }>; [key: string]: unknown }";

function tsColumn(col, expanded, mediaExpanded) {
  if (expanded) return "unknown";
  const m = mediaExpanded ? MEDIA_TS : "number";
  let t;
  switch (col.type) {
    case "integer":
    case "real":
      t = "number";
      break;
    case "boolean":
      t = "boolean";
      break;
    case "media":
    case "file":
      t = col.type === "media" ? m : "number | Record<string, unknown>";
      break;
    case "mediaList":
      t = `(${m})[]`;
      break;
    case "select":
      t = "string[]";
      break;
    case "refList":
      t = "(number | string)[]";
      break;
    case "group":
      t = "Record<string, unknown>";
      break;
    case "repeater":
    case "blocks":
      t = "Record<string, unknown>[]";
      break;
    case "json":
      return "unknown";
    default:
      t = Array.isArray(col.enum) && col.enum.length > 0 ? col.enum.map((v) => JSON.stringify(v)).join(" | ") : "string";
  }
  return col.notNull ? t : `${t} | null`;
}

/** The TypeScript type Astro writes for the collection's entries (`createSchema().types`). */
export function tsTypes(info, options = {}) {
  if (!info.first) return "export type Entry = { id: number; [key: string]: unknown };\n";
  const expanded = expandedFields(info, options);
  const fields = Object.entries(info.columns).map(([name, col]) =>
    `  ${/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)}${col.access ? "?" : ""}: ${tsColumn(col, expanded.has(name), options.media !== false)};`);
  return `// The rows of the First kind '${info.name}', as its site describes them.\nexport type Entry = {\n${fields.join("\n")}\n  [key: string]: unknown;\n};\n`;
}

// ---------------------------------------------------------------------------------------------
// Live collections
// ---------------------------------------------------------------------------------------------

/**
 * A live collection: read at request time, never stored. With a kind, the collection is that kind:
 * `getLiveEntry("posts", "hello")` finds by slug (or the `id` option). Without one, each filter
 * names its kind: `getLiveEntry("first", { kind: "posts", slug: "hello" })`.
 * @param {string | import("./index.d.ts").FirstLiveOptions} [kindOrOptions]
 * @param {import("./index.d.ts").FirstLiveOptions} [maybeOptions]
 */
export function firstLiveLoader(kindOrOptions, maybeOptions) {
  const fixed = typeof kindOrOptions === "string" ? kindOrOptions : undefined;
  const options = (typeof kindOrOptions === "string" ? maybeOptions : kindOrOptions) ?? {};
  const pick = (filter) => {
    const { kind = fixed, ...rest } = filter ?? {};
    if (!kind) throw new Error("@first/astro: this live collection serves every kind; name one: { kind: \"posts\", ... }");
    if (fixed && kind !== fixed) throw new Error(`@first/astro: this live collection serves '${fixed}', not '${kind}'`);
    return { kind, rest };
  };
  const toEntry = (info, row, html) => {
    const updated = typeof row.updatedAt === "string" ? new Date(row.updatedAt) : undefined;
    return {
      id: entryId(info, options, row),
      data: row,
      ...(html !== undefined ? { rendered: { html } } : {}),
      cacheHint: { tags: rowTags(info, row), ...(updated && !Number.isNaN(updated.valueOf()) ? { lastModified: updated } : {}) },
    };
  };
  const fail = (e) => ({ error: e instanceof Error ? e : new Error(String(e)) });
  return {
    name: "@first/astro/live",
    async loadCollection({ filter }) {
      try {
        const { kind, rest } = pick(filter);
        const connection = connect(options);
        const info = await connection.kind(kind);
        const { where, with: w, rendered, ...list } = rest;
        const query = { ...list, where: whereOf(info, { ...options, where: where ?? options.where }), with: withOf(info, { ...options, with: w ?? options.with }) };
        const page = await connection.request("GET", `${API}/${encodeURIComponent(kind)}${listQuery(query)}`);
        const rows = page.data ?? [];
        const html = rendered ?? options.rendered === "always" ? await renderedHtml(connection, info, rows.map((r) => r[info.primaryKey])) : new Map();
        const entries = rows.map((row) => toEntry(info, row, html.get(row[info.primaryKey])));
        return { entries, cacheHint: { tags: [kind, ...new Set(entries.flatMap((e) => e.cacheHint.tags))] } };
      } catch (e) {
        return fail(e);
      }
    },
    async loadEntry({ filter }) {
      try {
        const { kind, rest } = pick(filter);
        const connection = connect(options);
        const info = await connection.kind(kind);
        const { id, where, with: w, ...fields } = rest;
        let match = where ?? (Object.keys(fields).length > 0 ? fields : undefined);
        if (match === undefined && id !== undefined) {
          const field = typeof options.id === "string" ? options.id : info.slug ?? info.primaryKey;
          const numeric = info.columns[field]?.type === "integer" || (field === info.primaryKey && !info.first);
          match = { [field]: numeric && /^\d+$/.test(String(id)) ? Number(id) : String(id) };
        }
        if (match === undefined) throw new Error("@first/astro: loadEntry needs an id or a filter");
        const query = { where: whereOf(info, { ...options, where: match }), with: withOf(info, { ...options, with: w ?? options.with }), limit: 1 };
        const page = await connection.request("GET", `${API}/${encodeURIComponent(kind)}${listQuery(query)}`);
        const row = (page.data ?? [])[0];
        if (row === undefined) return undefined;
        const html = options.rendered === "never" ? new Map() : await renderedHtml(connection, info, [row[info.primaryKey]]);
        return toEntry(info, row, html.get(row[info.primaryKey]));
      } catch (e) {
        return fail(e);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------------

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Whether `header` (`First-Signature: t=<unix>,v1=<hex>[,v1=…]`) signs `body` with `secret`:
 * `v1 = hex(HMAC-SHA256(secret, "<t>.<body>"))`, `t` within five minutes of now.
 */
export async function verifySignature(secret, header, body, now = Date.now()) {
  if (!secret || typeof header !== "string") return false;
  let t = null;
  const candidates = [];
  for (const part of header.split(",")) {
    const [k, v = ""] = part.trim().split("=", 2);
    if (k === "t" && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === "v1") candidates.push(v.toLowerCase());
  }
  if (t === null || Math.abs(Math.floor(now / 1000) - t) > TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  // Compared in full, whatever the first difference.
  return candidates.some((c) => c.length === expected.length && [...c].reduce((d, ch, i) => d | (ch.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0);
}

/** The cache tags of a webhook event: `<collection>` and `<collection>:<id>`. */
export function eventTags(event) {
  const collection = event?.collection;
  if (typeof collection !== "string" || collection === "") return [];
  const id = event?.data?.row?.id ?? event?.data?.previous?.id;
  return id === undefined || id === null ? [collection] : [collection, `${collection}:${id}`];
}

/**
 * An Astro endpoint for First's webhooks (`export const POST = firstWebhook()` in
 * `src/pages/api/first.ts`). It verifies the signature, then invalidates the event's tags in
 * Astro's route cache (when one is configured) and calls `onEvent`, which a static site uses to
 * start a rebuild instead.
 * @param {import("./index.d.ts").FirstWebhookOptions} [options]
 */
export function firstWebhook(options = {}) {
  return async (context) => {
    const secret = options.secret ?? env("FIRST_WEBHOOK_SECRET");
    if (!secret) return new Response("FIRST_WEBHOOK_SECRET is not set", { status: 500 });
    if (context.request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    const body = await context.request.text();
    if (!(await verifySignature(secret, context.request.headers.get("first-signature"), body))) {
      return new Response("invalid signature", { status: 401 });
    }
    let event;
    try {
      event = JSON.parse(body);
    } catch {
      return new Response("invalid JSON", { status: 400 });
    }
    const tags = eventTags(event);
    if (tags.length > 0 && context.cache?.enabled) await context.cache.invalidate({ tags });
    await options.onEvent?.({ tags, event, context });
    return new Response(JSON.stringify({ tags }), { status: 200, headers: { "content-type": "application/json" } });
  };
}
