import type { APIContext } from "astro";
import type { Loader, LiveLoader } from "astro/loaders";

/** Where the TypedPress site is and who reads it. Every option has an environment variable. */
export interface TypedPressOptions {
  /** The site's URL (`https://example.com`). Default: `TP_URL`. */
  site?: string;
  /** `user:application-password`, sent as Basic auth. Default: `TP_APP_PASSWORD`. */
  appPassword?: string;
  /** A TypedPress Identity bearer token. Default: `TP_TOKEN`. */
  token?: string;
  /** Read as an anonymous visitor: ignore `appPassword`, `token`, TP_APP_PASSWORD and TP_TOKEN. */
  anonymous?: boolean;
  /** Extra headers on every request; an `Authorization` here wins over the two above. */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

/** Which rows of the kind become entries, and how they are named. */
export interface TypedPressQueryOptions extends TypedPressOptions {
  /** A TypedPress filter, as the typed client takes it: `{ featured: true }`. */
  where?: Record<string, unknown>;
  /** Relations to load into each row: `{ author: true }`. Media fields are loaded unless `media: false`. */
  with?: Record<string, unknown>;
  /** Load every media field as its media row (URL, sizes, alt). Default: true. */
  media?: boolean;
  /** Include drafts (needs a reader who may see them). Default: published rows only. */
  drafts?: boolean;
  /** WordPress's own kinds (posts, pages, ...) only: core's list parameters, e.g. `{ categories: 3, search: "x" }`. */
  query?: Record<string, string | number | (string | number)[]>;
  /** The entry id: a field name, or a function of the row. Default: the kind's slug, else its primary key. */
  id?: string | ((row: Record<string, unknown>) => string | number);
}

export interface TypedPressLoaderOptions extends TypedPressQueryOptions {
  /** Rows per request, 1 to 100 (the API's largest page). Default: 100. */
  pageSize?: number;
}

export interface TypedPressLiveOptions extends TypedPressQueryOptions {
  /** Attach core's rendered HTML of the content field: on single entries (default), on lists too ("always"), or never. */
  rendered?: "entries" | "always" | "never";
}

/** A build-time content collection of one TypedPress kind. */
export declare function tpLoader(kind: string, options?: TypedPressLoaderOptions): Loader;

/** A live collection filter: a field match, `id` (matched against the slug or the `id` option), or `where`. */
export type TypedPressEntryFilter = { kind?: string; id?: string | number; where?: Record<string, unknown>; with?: Record<string, unknown> } & Record<string, unknown>;
export type TypedPressCollectionFilter = {
  kind?: string;
  where?: Record<string, unknown>;
  with?: Record<string, unknown>;
  orderBy?: Record<string, "asc" | "desc"> | string;
  limit?: number;
  offset?: number;
  search?: string;
  locale?: string;
  /** Attach rendered HTML to each entry of the list. */
  rendered?: boolean;
  /** WordPress's own kinds only: core's list parameters. */
  query?: Record<string, string | number | (string | number)[]>;
};

/** A live collection; entries carry `cacheHint.tags` (`<kind>`, `<kind>:<id>`) for `Astro.cache.set`. */
export declare function tpLiveLoader(kind?: string, options?: TypedPressLiveOptions): LiveLoader<Record<string, any>, TypedPressEntryFilter, TypedPressCollectionFilter>;
export declare function tpLiveLoader(options?: TypedPressLiveOptions): LiveLoader<Record<string, any>, TypedPressEntryFilter, TypedPressCollectionFilter>;

export interface TypedPressWebhookEvent {
  id: number | string;
  event: string;
  collection: string;
  at: string;
  data: { row: Record<string, unknown>; previous?: Record<string, unknown> };
}

export interface TypedPressWebhookOptions {
  /** The webhook's secret, as in `typedpress.config.ts`'s `webhooks`. Default: `TP_WEBHOOK_SECRET`. */
  secret?: string;
  /** Runs after a verified event: start a static rebuild, log, or purge another cache. */
  onEvent?: (event: { tags: string[]; event: TypedPressWebhookEvent; context: APIContext }) => void | Promise<void>;
}

/** An Astro endpoint that verifies TypedPress's signed webhook and invalidates the event's cache tags. */
export declare function tpWebhook(options?: TypedPressWebhookOptions): (context: APIContext) => Promise<Response>;

/** Whether `TypedPress-Signature` signs `body` with `secret` (`t=<unix>,v1=hex(HMAC-SHA256(secret, "t.body"))`, five minutes' tolerance). */
export declare function verifySignature(secret: string, header: string | null, body: string, now?: number): Promise<boolean>;

/** `<collection>` and `<collection>:<id>` of a webhook event. */
export declare function eventTags(event: unknown): string[];

export declare class TypedPressError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly pointer?: string;
}

export interface TypedPressConnection {
  readonly site: string;
  /** `extra`: headers for this one request, such as a visitor's `cookie`. */
  request(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<any>;
  describe(): Promise<Record<string, any>>;
}

/** The connection the loaders share for one site and set of credentials. */
export declare function connect(options?: TypedPressOptions): TypedPressConnection;
