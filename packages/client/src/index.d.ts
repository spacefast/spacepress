// @spacepress/client: typed fetch client SDK for SpacePress sites (browser, Node, Bun, Deno).
// Supports WordPress Abilities execution (`/wp-json/wp-abilities/v1/abilities/<app>/<name>/run`)
// alongside the SpacePress REST API (`/wp-json/spacepress/v1/*`).

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  pointer?: string;
}

export declare class SpacePressError extends Error {
  readonly status: number;
  readonly code: string;
  readonly type: string;
  readonly title: string;
  readonly detail: string;
  readonly pointer?: string;
  constructor(problem: Problem);
}

export interface ChangeNotice {
  id: string;
  at: string;
  changes: { collection: string; ops: ("create" | "update" | "delete")[]; ids: number[] | null }[];
}

export interface RealtimeTransport {
  connect(onNotice: (notice: ChangeNotice) => void, onStatus?: (status: "connecting" | "live" | "offline") => void): () => void;
}

export interface RealtimeOptions {
  transport?: RealtimeTransport;
  pollMs?: number | false;
}

export declare function registerRealtimeTransport(transport: RealtimeTransport): void;

export interface AuthOptions {
  storage?: "memory" | "session";
  clientId?: string;
  redirectUri?: string;
  scopes?: string[];
  autoGuest?: boolean;
}

export interface ClientOptions {
  url?: string;
  api?: string;
  nonce?: string;
  wordpress?: boolean;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  auth?: AuthOptions;
  realtime?: RealtimeOptions;
}

export interface Query<T> extends Promise<T> {
  readonly key: string;
  subscribe(
    onData: (value: T) => void,
    onError?: (error: SpacePressError) => void,
    seed?: { token: string; data: T },
  ): () => void;
  optimistic(update: (current: T) => T): { settle(): void; rollback(): void };
}

export interface Session {
  user: { id: number; name?: string; email?: string; role: string } | null;
  authenticated: boolean;
  guest: boolean;
  scopes?: string[];
  expiresAt?: string;
}

export interface AuthClient {
  me(): Promise<Session>;
  guest(): Promise<Session>;
  signIn(options?: { provider?: string; redirectUri?: string; returnTo?: string }): Promise<void>;
  handleCallback(url?: string): Promise<Session>;
  signOut(): Promise<void>;
  onChange(listener: (session: Session | null) => void): () => void;
}

export interface MediaClient {
  list(query?: { mime?: string; search?: string; limit?: number; offset?: number }): Promise<unknown[]>;
  get(id: number): Promise<unknown>;
  upload(file: Blob, options?: { filename?: string; alt?: string; title?: string }): Promise<unknown>;
  delete(id: number): Promise<{ deleted: true; id: number }>;
}

export interface FileBucketClient {
  upload(file: Blob, options?: { filename?: string }): Promise<{
    id: number;
    bucket: string;
    filename: string;
    mime: string;
    size: number;
    ownerId: number | null;
    createdAt: string;
    url: string;
  }>;
  get(id: number): Promise<unknown>;
  url(id: number): string;
  delete(id: number): Promise<{ deleted: true; id: number }>;
}

export interface SchemaDescriptor {
  readonly name: string;
  readonly app: string;
  readonly abilities: {
    readonly collections?: Record<string, unknown>;
    readonly actions: Record<string, { readonly ability: string; readonly readonly?: boolean; readonly destructive?: boolean; readonly idempotent?: boolean }>;
    readonly globals: Record<string, string>;
  };
  readonly collections: Record<string, {
    readonly path: string;
    readonly ability?: string;
    readonly primaryKey?: string;
    readonly drafts?: boolean;
    readonly localized?: boolean;
    readonly media?: readonly string[];
    readonly mediaList?: readonly string[];
    readonly files?: readonly string[];
    readonly relations?: Record<string, { readonly kind: "one" | "many"; readonly collection: string; readonly optional?: boolean }>;
  }>;
  readonly globals: readonly string[];
  readonly actions: readonly string[];
  readonly buckets: readonly string[];
}

export interface CollectionClient<
  TRow = Record<string, unknown>,
  TInsert = Record<string, unknown>,
  TPatch = Record<string, unknown>,
  TFilter = Record<string, unknown>,
  TOrder = Record<string, "asc" | "desc"> | string,
  TWith = Record<string, unknown>,
> {
  list(query?: { where?: TFilter; orderBy?: TOrder; limit?: number; offset?: number; with?: TWith; deleted?: "exclude" | "include" | "only"; status?: string; locale?: string }): Query<TRow[]>;
  get(id: number | string, options?: { with?: TWith; deleted?: "exclude" | "include" | "only"; locale?: string }): Query<TRow>;
  count(query?: { where?: TFilter; deleted?: "exclude" | "include" | "only"; status?: string; locale?: string }): Query<number>;
  create(data: TInsert): Promise<TRow>;
  update(id: number | string, patch: TPatch, conditions?: { ifMatch?: string; ifUnmodifiedSince?: string }): Promise<TRow>;
  delete(id: number | string, conditions?: { ifMatch?: string; ifUnmodifiedSince?: string }): Promise<{ deleted: true; id: number | string }>;
  restore?(id: number | string): Promise<TRow>;
  purge?(id: number | string): Promise<{ purged: true; id: number | string }>;
  paginate?(query?: Record<string, unknown>): AsyncIterable<TRow>;
  revisions?: {
    list(id: number | string): Promise<unknown[]>;
    get(id: number | string, revisionId: number): Promise<unknown>;
    diff(id: number | string, fromId: number, toId: number): Promise<unknown>;
    restore(id: number | string, revisionId: number): Promise<TRow>;
  };
  staged?: {
    get(id: number | string): Promise<unknown>;
    diff(id: number | string): Promise<unknown>;
    save(id: number | string, patch: TPatch): Promise<unknown>;
    promote(id: number | string): Promise<TRow>;
    discard(id: number | string): Promise<void>;
    preview(id: number | string): Promise<{ url: string; expiresAt: string }>;
  };
}

export interface AppDefinition {
  collections?: Record<string, { row: unknown; insert?: unknown; patch?: unknown; filter?: unknown; order?: unknown; with?: unknown }>;
  globals?: Record<string, { row: unknown; patch?: unknown }>;
  actions?: Record<string, { input: unknown; output: unknown }>;
  buckets?: readonly string[];
}

export type BoundClient<TApp extends AppDefinition = AppDefinition> = {
  readonly [K in keyof NonNullable<TApp["collections"]>]: NonNullable<TApp["collections"]>[K] extends {
    row: infer R;
    insert?: infer I;
    patch?: infer P;
    filter?: infer F;
    order?: infer O;
    with?: infer W;
  }
    ? CollectionClient<R, I, P, F, O, W>
    : CollectionClient;
} & {
  readonly media: MediaClient;
  readonly files: Record<string, FileBucketClient>;
  readonly actions: {
    readonly [K in keyof NonNullable<TApp["actions"]>]: NonNullable<TApp["actions"]>[K] extends {
      input: infer I;
      output: infer O;
    }
      ? {} extends I
        ? (input?: I) => Promise<O>
        : (input: I) => Promise<O>
      : (input?: Record<string, unknown>) => Promise<unknown>;
  };
  readonly globals: {
    readonly [K in keyof NonNullable<TApp["globals"]>]: NonNullable<TApp["globals"]>[K] extends {
      row: infer R;
      patch?: infer P;
    }
      ? { get(): Query<R>; update(patch: P): Promise<R> }
      : { get(): Query<Record<string, unknown>>; update(patch: Record<string, unknown>): Promise<Record<string, unknown>> };
  };
  readonly auth: AuthClient;
  readonly schema: () => Promise<unknown>;
  [collection: string]: any;
};

/**
 * Bind a generated `SCHEMA` descriptor to produce a typed `createClient(options?)` factory
 * (the Convex / Prisma 7 pattern: generated code holds the app's types and SCHEMA; the runtime
 * ships in `@spacepress/client`).
 */
export declare function bind<TApp extends AppDefinition = AppDefinition>(
  schema: SchemaDescriptor,
): (options?: ClientOptions) => BoundClient<TApp>;

/** Create a client directly from a generated `SCHEMA` descriptor and optional `ClientOptions`. */
export declare function createClient<TApp extends AppDefinition = AppDefinition>(
  schema: SchemaDescriptor,
  options?: ClientOptions,
): BoundClient<TApp>;

export declare function pageRead(
  client: BoundClient<any>,
  url: string,
  region: string,
  deps: readonly string[],
): Query<{ html: string; kinds: string[] }>;

export declare function watch<T>(
  client: BoundClient<any>,
  collections: readonly string[],
  read: () => Promise<T>,
  onResult: (value: T) => void,
  onError?: (error: SpacePressError) => void,
): () => void;
