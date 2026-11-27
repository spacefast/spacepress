// spacepress/react (and @spacepress/client/react): React hooks for external React frontends and
// SpacePress "use client" components.
import type { Query, SpacePressError } from "./index.d.ts";

/** Typed descriptor returned by `api.<kind>.list(...)` / `api.<kind>.get(...)` from `#sp/api`. */
export interface LiveQueryRef<T = unknown> {
  readonly __sp: "query";
  readonly kind: string;
  readonly op: "list" | "get";
  readonly id?: string | number;
  readonly args: Record<string, unknown>;
  readonly __type?: T;
}

/** Typed descriptor returned by `api.<query>(input)` from `#sp/api`. */
export interface LiveActionQueryRef<T = unknown> {
  readonly __sp: "actionQuery";
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly __type?: T;
}

/** Typed descriptor returned by `api.<global>.get()` from `#sp/api`. */
export interface LiveGlobalRef<T = unknown> {
  readonly __sp: "global";
  readonly name: string;
  readonly op: "get";
  readonly __type?: T;
}

/** Typed descriptor exported at `api.<bucket>` from `#sp/api`. */
export interface BucketRef<Name extends string = string> {
  readonly __sp: "bucket";
  readonly bucket: Name;
}

/** Typed descriptor exported at `api.<name>` from `#sp/api`. */
export interface ActionRef<Input = void, Output = unknown, Kind extends "query" | "mutation" = "mutation"> {
  readonly __sp: "action";
  readonly name: string;
  readonly kind: Kind;
  readonly ability?: string;
  readonly __input?: Input;
  readonly __output?: Output;
}

export type MutationArgs<Input> =
  [Input] extends [never] ? [] :
  [Input] extends [void] ? [] :
  Record<string, never> extends Input ? [input?: Input] :
  [input: Input];

/** The parts of React the hooks use (React 18 and later, Preact through `preact/compat`). */
export interface ReactLike {
  useSyncExternalStore<S>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => S, getServerSnapshot?: () => S): S;
  useRef<V>(initial: V): { current: V };
  useState<S>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void];
  useCallback<F extends (...args: any[]) => any>(fn: F, deps: readonly unknown[]): F;
  useMemo<V>(factory: () => V, deps: readonly unknown[]): V;
  useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
}

export interface QueryState<T> {
  data: T | undefined;
  error: SpacePressError | undefined;
  loading: boolean;
}

export interface UseQueryOptions<T> {
  enabled?: boolean;
  seed?: { token: string; data: T };
}

export type Apply = <T>(query: Query<T>, update: (current: T) => T) => void;

export interface UseMutationOptions<A extends unknown[]> {
  optimistic?: (apply: Apply, ...args: A) => void;
}

export interface Mutation<A extends unknown[], R> {
  mutate(...args: A): Promise<R>;
  pending: boolean;
  error: { code: string; message: string } | undefined;
  reset(): void;
}

export interface Hooks {
  useQuery<T>(query: Query<T> | LiveQueryRef<T> | LiveActionQueryRef<T> | LiveGlobalRef<T> | null | undefined | false, options?: UseQueryOptions<T>): QueryState<T>;
  useLive<T>(query: LiveQueryRef<T> | LiveActionQueryRef<T> | LiveGlobalRef<T> | Query<T> | null | undefined | false, options?: UseQueryOptions<T>): LiveState<T>;
  useMutation<Input, Output, Kind extends "query" | "mutation">(
    action: ActionRef<Input, Output, Kind>,
    options?: UseMutationOptions<MutationArgs<Input>>,
  ): Mutation<MutationArgs<Input>, Output>;
  useMutation<A extends unknown[], R>(run: (...args: A) => Promise<R>, options?: UseMutationOptions<A>): Mutation<A, R>;
}

/** Create React `useQuery`, `useLive`, and `useMutation` hooks bound to your React instance. */
export declare function createHooks(React: ReactLike): Hooks;

/** Configure the SpacePress client instance used by `useLive`, `useMutation`, and `uploadFile` in external React apps/tests. */
export declare function setClient(client: unknown): void;
export declare function getClient(): unknown;

/** Runs once, when the component's element is hydrated (`data-wp-init`). */
export declare function useMount(effect: () => void | (() => void)): void;

/** A listener on `window` (the default) or `document` (`data-wp-on-window--<event>`). */
export declare function useEvent<K extends keyof WindowEventMap>(
  event: K,
  listener: (event: WindowEventMap[K]) => void,
  target?: "window" | "document",
): void;

/** State every component of this module shares: the Interactivity API store's global `state`. */
export declare function sharedState<T extends object>(initial: T): T;

/** What `useLive` holds: the read's latest answer, the problem of the last refresh, and whether it has answered yet. */
export interface LiveState<T> {
  /** The latest result; kept while a later refresh fails. */
  data: T | undefined;
  /** The problem of the last refresh, if it failed (a refused read, or the network). */
  error: { code: string; message: string } | undefined;
  /** True until the first answer or error. The server answers in the first render, so it starts false. */
  loading: boolean;
}

/**
 * A typed live read kept current by SpacePress: `useLive(api.todos.list({ where: { done: false }, limit: 20 }))`.
 * In `"use client"` components, the server answers it in the first render as the visitor and the browser
 * subscribes to the same read automatically.
 */
export declare function useLive<T>(
  query: LiveQueryRef<T> | LiveActionQueryRef<T> | LiveGlobalRef<T> | Query<T>,
  options?: { enabled?: boolean },
): LiveState<T>;

/**
 * Bind a typed action reference from `#sp/api` (`useMutation(api.addNote)`):
 * returns `{ mutate, pending, error, reset }`.
 */
export declare function useMutation<Input, Output, Kind extends "query" | "mutation">(
  action: ActionRef<Input, Output, Kind>,
): Mutation<MutationArgs<Input>, Output>;

/** Metadata returned by `uploadFile(bucket, file, opts?)`. */
export interface UploadedFile {
  id: number;
  bucket: string;
  filename: string;
  mime: string;
  size: number;
  ownerId: number | null;
  createdAt: string;
  url: string;
}

/**
 * Upload a browser `File` or `Blob` to a registered `files()` private bucket via `spacepress/client`
 * (`await uploadFile(api.inbox, file)` or `await uploadFile("inbox", file)`).
 */
export declare function uploadFile(
  bucket: BucketRef | string,
  file: Blob,
  options?: { filename?: string },
): Promise<UploadedFile>;
