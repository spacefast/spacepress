// @spacepress/client/react: React hooks for external React frontends and SpacePress "use client" components.
import type { Query, SpacePressError } from "./index.d.ts";

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
  error: Error | undefined;
  reset(): void;
}

export interface Hooks {
  useQuery<T>(query: Query<T> | null | undefined | false, options?: UseQueryOptions<T>): QueryState<T>;
  useMutation<A extends unknown[], R>(run: (...args: A) => Promise<R>, options?: UseMutationOptions<A>): Mutation<A, R>;
}

/** Create React `useQuery` and `useMutation` hooks bound to your React instance. */
export declare function createHooks(React: ReactLike): Hooks;

/** Configure the `@spacepress/client` instance used by `useLive` and `uploadFile` in external React apps/tests. */
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
 * A list read the browser keeps current: `useLive("todos", { where: { done: false }, limit: 20 })`.
 * The server answers it in the first render, as the visitor; the page then subscribes to the same
 * read through the app's typed client, so another visitor's write shows without a reload.
 */
export declare function useLive<T = any>(
  kind: string,
  query?: Record<string, unknown>,
  options?: { enabled?: boolean },
): LiveState<T[]>;

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
 * Upload a browser `File` or `Blob` to a registered `files()` private bucket via `@spacepress/client`
 * (using the page's REST nonce). Must be called inside a `"use client"` event handler or effect with
 * a string literal naming an exported bucket: `const uploaded = await uploadFile("inbox", file)`.
 */
export declare function uploadFile(
  bucket: string,
  file: Blob,
  options?: { filename?: string },
): Promise<UploadedFile>;
