// Zero typed client runtime. `zero build` copies this file next to the generated `types.ts`
// (interfaces) and `schema.ts` (the SCHEMA descriptor) in `zero/client/`. Do not edit the copy.
//
// No dependencies; `fetch`-based; erasable TypeScript only, so Node (type stripping), Bun, Deno and
// bundlers run it as-is. Wire format: design §4.8 / §7.

import { SCHEMA } from "./schema.ts";
import type { Actions, Collections, Globals, Media, RevisionSummary, Status, User } from "./types.ts";

export type * from "./types.ts";
export { SCHEMA };

// ---------------------------------------------------------------------------
// Types derived from the generated interfaces and the SCHEMA descriptor
// ---------------------------------------------------------------------------

type Descriptor = typeof SCHEMA;
type CollectionDescriptors = Descriptor["collections"];

/** Schema keys of every collection (`client.<key>`). */
export type CollectionKey = keyof Collections & keyof CollectionDescriptors & string;

type Row<K extends CollectionKey> = Collections[K]["row"];
type Rels<K extends CollectionKey> = CollectionDescriptors[K]["relations"];
type IdOf<K extends CollectionKey> = Row<K>[CollectionDescriptors[K]["primaryKey"] & keyof Row<K>];

/** `with` keys that load something (`false`/`undefined` entries load nothing). */
type Requested<W> = { [P in keyof W]-?: W[P] extends false | undefined | null ? never : P }[keyof W];

type NestedWith<V> = V extends { with: infer W } ? W : {};

type RelationValue<R, V> = R extends { kind: "one"; collection: infer T extends CollectionKey; optional: infer O }
  ? RowWith<T, NestedWith<V>> | (O extends false ? never : null)
  : R extends { kind: "many"; collection: infer T extends CollectionKey }
    ? RowWith<T, NestedWith<V>>[]
    : never;

type WithValue<K extends CollectionKey, P, V> = P extends keyof Rels<K>
  ? RelationValue<Rels<K>[P], V>
  : P extends CollectionDescriptors[K]["mediaList"][number]
    ? Media[] | (null extends Row<K>[P & keyof Row<K>] ? null : never)
    : P extends CollectionDescriptors[K]["media"][number]
      ? Media | null
      : never;

/**
 * A row of collection `K` loaded with `with: W`: `one` relations become the related row (or null when
 * optional), `many` relations a list, and requested media columns are replaced in place by media rows.
 */
export type RowWith<K extends CollectionKey, W> = [Requested<W>] extends [never]
  ? Row<K>
  : ([Requested<W> & keyof Row<K>] extends [never] ? Row<K> : Omit<Row<K>, Requested<W> & keyof Row<K>>) & {
      -readonly [P in Exclude<Requested<W>, OptionalKeys<Row<K>>>]: WithValue<K, P, W[P]>;
    } & {
      // A column the viewer may not read (field access) stays optional when populated.
      -readonly [P in Extract<Requested<W>, OptionalKeys<Row<K>>>]?: WithValue<K, P, W[P]>;
    };

type OptionalKeys<T> = { [P in keyof T]-?: {} extends Pick<T, P> ? P : never }[keyof T] & PropertyKey;

/** Rejects `with` keys that are neither relations nor media columns (`with: { autor: true }`). */
type ExactWith<K extends CollectionKey, W> = W & { [P in Exclude<keyof W, keyof Collections[K]["with"]>]: never };

type StatusQuery<K extends CollectionKey> = CollectionDescriptors[K]["drafts"] extends true
  ? { /** Shorthand for `where: { status }` (ANDed with `where`). */ status?: Status }
  : {};

export type ListQuery<K extends CollectionKey, W = Collections[K]["with"]> = {
  where?: Collections[K]["filter"];
  /** `{ createdAt: "desc", title: "asc" }` or the wire form `"-createdAt,title"`. */
  orderBy?: Collections[K]["order"];
  limit?: number;
  offset?: number;
  with?: W;
} & StatusQuery<K>;

export interface CollectionClient<K extends CollectionKey> {
  list<const W extends Collections[K]["with"] = {}>(q?: ListQuery<K, ExactWith<K, W>>): Promise<RowWith<K, W>[]>;
  get<const W extends Collections[K]["with"] = {}>(id: IdOf<K>, q?: { with?: ExactWith<K, W> }): Promise<RowWith<K, W>>;
  create(data: Collections[K]["insert"]): Promise<Row<K>>;
  update(id: IdOf<K>, patch: Collections[K]["patch"]): Promise<Row<K>>;
  delete(id: IdOf<K>): Promise<Row<K>>;
  revisions: {
    /** Newest first. Needs `update` access on the row. */
    list(id: IdOf<K>): Promise<RevisionSummary[]>;
    get(id: IdOf<K>, revisionId: number): Promise<Row<K>>;
    /** Runs the update pipeline with the revision as the patch; returns the updated row. */
    restore(id: IdOf<K>, revisionId: number): Promise<Row<K>>;
  };
}

export interface MediaQuery {
  where?: Record<string, unknown>;
  orderBy?: Record<string, "asc" | "desc"> | string;
  limit?: number;
  offset?: number;
}

export interface MediaClient {
  list(q?: MediaQuery): Promise<Media[]>;
  get(id: number): Promise<Media>;
  /** `multipart/form-data` with fields `file` and `alt`. */
  upload(file: Blob, opts?: { alt?: string; filename?: string }): Promise<Media>;
  delete(id: number): Promise<Media>;
}

export type ActionsClient = {
  [A in keyof Actions]: {} extends Actions[A]["input"]
    ? (input?: Actions[A]["input"]) => Promise<Actions[A]["output"]>
    : (input: Actions[A]["input"]) => Promise<Actions[A]["output"]>;
};

export type GlobalsClient = {
  [G in keyof Globals]: {
    get(): Promise<Globals[G]["row"]>;
    update(patch: Globals[G]["patch"]): Promise<Globals[G]["row"]>;
  };
};

export interface AuthClient {
  /** The signed-in user, or null. */
  me(): Promise<User | null>;
  /** Standalone only: exchanges a password for a token. The client uses the token from then on. */
  login(name: string, password: string): Promise<{ token: string; user: User }>;
}

export type Client = { readonly [K in CollectionKey]: CollectionClient<K> } & {
  readonly media: MediaClient;
  readonly actions: ActionsClient;
  readonly globals: GlobalsClient;
  readonly auth: AuthClient;
  /** `GET /_schema`: the app's public schema description. */
  schema(): Promise<unknown>;
};

export interface ClientOptions {
  /** Base URL including the prefix: "https://x.test/api" or "https://x.test/wp-json/zero/v1". Default: this build's prefix. */
  url?: string;
  /** Standalone bearer token (`zt_...`); sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** WordPress cookie auth: the REST nonce; sent as `X-WP-Nonce` with `credentials: "same-origin"`. */
  nonce?: string;
  fetch?: typeof fetch;
  /** Extra headers on every request (e.g. `Authorization: Basic ...` for WP application passwords). They win over the above. */
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** RFC 9457 problem document, as both targets send it. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  pointer?: string;
}

/** Thrown for every non-2xx response; the fields are the problem document. Network failures: status 0, code "network". */
export class ZeroError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly title: string;
  readonly type: string;
  readonly pointer?: string;

  constructor(problem: Problem) {
    super(problem.detail);
    this.name = "ZeroError";
    this.status = problem.status;
    this.code = problem.code;
    this.detail = problem.detail;
    this.title = problem.title;
    this.type = problem.type;
    this.pointer = problem.pointer;
  }
}

function networkError(detail: string): ZeroError {
  return new ZeroError({ type: "about:blank", title: "Network error", status: 0, code: "network", detail });
}

// ---------------------------------------------------------------------------
// Wire encoding
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** `{ a: "asc", b: "desc" }` → `"a,-b"`. */
function orderParam(order: unknown): string {
  if (typeof order === "string") return order;
  if (!isObject(order)) return "";
  return Object.entries(order)
    .filter(([, dir]) => dir === "asc" || dir === "desc")
    .map(([col, dir]) => (dir === "desc" ? `-${col}` : col))
    .join(",");
}

/** `"a,-b"` → `{ a: "asc", b: "desc" }` (nested `with` options travel as JSON objects). */
function orderObject(order: unknown): unknown {
  if (typeof order !== "string") return order;
  const out: Record<string, "asc" | "desc"> = {};
  for (const part of order.split(",").map((s) => s.trim()).filter(Boolean)) {
    out[part.replace(/^[-+]/, "")] = part.startsWith("-") ? "desc" : "asc";
  }
  return out;
}

function withJson(w: Json): Json {
  const out: Json = {};
  for (const [name, v] of Object.entries(w)) {
    if (v === true) out[name] = true;
    else if (isObject(v)) {
      out[name] = {
        ...v,
        ...(v.orderBy !== undefined ? { orderBy: orderObject(v.orderBy) } : {}),
        ...(isObject(v.with) ? { with: withJson(v.with) } : {}),
      };
    }
  }
  return out;
}

/** Comma list when every entry is `true`; JSON when any entry carries options. */
function withParam(w: unknown): string {
  if (!isObject(w)) return "";
  const json = withJson(w);
  const names = Object.keys(json);
  if (names.length === 0) return "";
  return names.some((n) => json[n] !== true) ? JSON.stringify(json) : names.join(",");
}

function listParams(q: Json | undefined): URLSearchParams {
  const p = new URLSearchParams();
  if (!q) return p;
  if (q.where !== undefined) p.set("where", JSON.stringify(q.where));
  if (typeof q.status === "string") p.set("status", q.status);
  if (q.orderBy !== undefined) {
    const order = orderParam(q.orderBy);
    if (order) p.set("orderBy", order);
  }
  if (typeof q.limit === "number") p.set("limit", String(q.limit));
  if (typeof q.offset === "number") p.set("offset", String(q.offset));
  const w = withParam(q.with);
  if (w) p.set("with", w);
  return p;
}

const seg = (v: string | number) => encodeURIComponent(String(v));

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

interface Send {
  query?: URLSearchParams;
  json?: unknown;
  form?: FormData;
}

export function createClient(options: ClientOptions = {}): Client {
  const base = (options.url ?? SCHEMA.basePath).replace(/\/+$/, "");
  let token = options.token;

  async function request<T>(method: string, path: string, send: Send = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    if (options.nonce !== undefined) headers["x-wp-nonce"] = options.nonce;
    let body: string | FormData | undefined;
    if (send.form) body = send.form;
    else if (send.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(send.json);
    }
    for (const [k, v] of Object.entries(options.headers ?? {})) headers[k.toLowerCase()] = v;

    const qs = send.query?.toString();
    const init: RequestInit = { method, headers, body };
    if (options.nonce !== undefined) init.credentials = "same-origin";
    const doFetch = options.fetch ?? globalThis.fetch;

    let res: Response;
    let text: string;
    try {
      res = await doFetch(base + path + (qs ? `?${qs}` : ""), init);
      text = await res.text();
    } catch (e) {
      throw networkError(`${method} ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    let parsed: unknown;
    try {
      parsed = text === "" ? undefined : JSON.parse(text);
    } catch {
      throw networkError(`${method} ${path}: HTTP ${res.status} with a non-JSON body`);
    }
    if (res.ok) {
      if (!isObject(parsed) || !("data" in parsed)) throw networkError(`${method} ${path}: response has no data`);
      return parsed.data as T;
    }
    throw toError(res, parsed);
  }

  function collection(key: CollectionKey) {
    const desc: { path: string } = SCHEMA.collections[key];
    const path = `/${seg(desc.path)}`;
    const one = (id: string | number) => `${path}/${seg(id)}`;
    return {
      list: (q?: Json) => request("GET", path, { query: listParams(q) }),
      get: (id: string | number, q?: Json) => request("GET", one(id), { query: listParams(q?.with ? { with: q.with } : undefined) }),
      create: (data: unknown) => request("POST", path, { json: data }),
      update: (id: string | number, patch: unknown) => request("PATCH", one(id), { json: patch }),
      delete: (id: string | number) => request("DELETE", one(id)),
      revisions: {
        list: (id: string | number) => request("GET", `${one(id)}/revisions`),
        get: (id: string | number, rid: number) => request("GET", `${one(id)}/revisions/${seg(rid)}`),
        restore: (id: string | number, rid: number) => request("POST", `${one(id)}/revisions/${seg(rid)}/restore`),
      },
    };
  }

  const client: Json = {
    media: {
      list: (q?: Json) => request("GET", "/media", { query: listParams(q) }),
      get: (id: number) => request("GET", `/media/${seg(id)}`),
      upload(file: Blob, opts: { alt?: string; filename?: string } = {}) {
        const form = new FormData();
        const name = opts.filename ?? ("name" in file && typeof file.name === "string" ? file.name : "upload");
        form.append("file", file, name);
        if (opts.alt !== undefined) form.append("alt", opts.alt);
        return request("POST", "/media", { form });
      },
      delete: (id: number) => request("DELETE", `/media/${seg(id)}`),
    },
    actions: Object.fromEntries(
      SCHEMA.actions.map((name: string) => [name, (input?: unknown) => request("POST", `/actions/${seg(name)}`, { json: input ?? {} })]),
    ),
    globals: Object.fromEntries(
      SCHEMA.globals.map((name: string) => [
        name,
        {
          get: () => request("GET", `/globals/${seg(name)}`),
          update: (patch: unknown) => request("PATCH", `/globals/${seg(name)}`, { json: patch }),
        },
      ]),
    ),
    auth: {
      me: () => request("GET", "/me"),
      async login(name: string, password: string) {
        const out = await request<{ token: string; user: User }>("POST", "/auth/token", { json: { name, password } });
        token = out.token;
        return out;
      },
    },
    schema: () => request("GET", "/_schema"),
  };
  for (const key of Object.keys(SCHEMA.collections)) client[key] = collection(key as CollectionKey);
  return client as unknown as Client;
}

/** Problem documents map field by field; WordPress core errors (`{ code, message, data: { status } }`) are mapped onto the same shape. */
function toError(res: Response, body: unknown): ZeroError {
  if (isObject(body) && typeof body.code === "string") {
    const detail = typeof body.detail === "string" ? body.detail : typeof body.message === "string" ? body.message : res.statusText;
    return new ZeroError({
      type: typeof body.type === "string" ? body.type : "about:blank",
      title: typeof body.title === "string" ? body.title : res.statusText || `HTTP ${res.status}`,
      status: typeof body.status === "number" ? body.status : res.status,
      code: body.code,
      detail,
      ...(typeof body.pointer === "string" ? { pointer: body.pointer } : {}),
    });
  }
  return new ZeroError({
    type: "about:blank",
    title: res.statusText || `HTTP ${res.status}`,
    status: res.status,
    code: "http_error",
    detail: `HTTP ${res.status}`,
  });
}
