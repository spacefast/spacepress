// First typed client: React hooks for a React frontend that runs outside First (Next.js, TanStack
// Start, an Astro island, Vite). `first build` copies this file next to `index.ts` in
// `first/_generated/client/`. Do not edit the copy.
//
// It imports nothing from "react": you pass your React to `createHooks`, so a project that never
// imports this file needs no React, and the hooks use whichever React the app already bundles.
//
//   import * as React from "react";
//   import { createClient } from "./first/_generated/client/index.ts";
//   import { createHooks } from "./first/_generated/client/react.ts";
//
//   export const first = createClient();
//   export const { useQuery, useMutation } = createHooks(React);
//
// First's own pages (`first/app/`) never run React; they keep data live with `<Live>` and `useLive`.

import type { FirstError, Query } from "./index.ts";

/** The parts of React the hooks use (React 18 and later, Preact through `preact/compat`). */
export interface ReactLike {
  useSyncExternalStore<S>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => S, getServerSnapshot?: () => S): S;
  useRef<V>(initial: V): { current: V };
  useState<S>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void];
  // `any` here only so that every function type is accepted as F.
  useCallback<F extends (...args: any[]) => any>(fn: F, deps: readonly unknown[]): F;
  useMemo<V>(factory: () => V, deps: readonly unknown[]): V;
}

export interface QueryState<T> {
  /** The latest result; `undefined` until the first answer. Kept while a later refresh fails. */
  data: T | undefined;
  /** The problem of the last refresh, if it failed: a refused read (401, 403, 404) or the network. */
  error: FirstError | undefined;
  /** True until the first answer or error. */
  loading: boolean;
}

export interface UseQueryOptions<T> {
  /** `false` subscribes to nothing and returns `{ data: undefined, loading: false }`. */
  enabled?: boolean;
  /** An answer rendered on the server (`First\Live\Module::evaluate`): shown at once, and during server rendering. */
  seed?: { token: string; data: T };
}

/** Changes what subscribers of `query` are shown until the write is answered. */
export type Apply = <T>(query: Query<T>, update: (current: T) => T) => void;

export interface UseMutationOptions<A extends unknown[]> {
  /**
   * Runs before the write is sent: call `apply(query, update)` for each read the write will change.
   * The updates are kept until the server's next answer when the write succeeds, and taken back
   * when it fails.
   */
  optimistic?: (apply: Apply, ...args: A) => void;
}

export interface Mutation<A extends unknown[], R> {
  /** Runs the write. Resolves with its result; rejects with its error after rolling back. */
  mutate(...args: A): Promise<R>;
  /** True while at least one call is waiting for its answer. */
  pending: boolean;
  /** The error of the last call that failed; cleared by the next call or `reset()`. */
  error: Error | undefined;
  reset(): void;
}

export interface Hooks {
  /**
   * Keeps a read current: `useQuery(first.todos.list({ where: { done: false } }))`. Pass the read
   * inline; it is re-subscribed only when its `key` (the call and its arguments) changes.
   * `null`, `undefined` or `false` in place of the read subscribes to nothing.
   */
  useQuery<T>(query: Query<T> | null | undefined | false, options?: UseQueryOptions<T>): QueryState<T>;
  /** Wraps a write: `useMutation((title: string) => first.todos.create({ title }), { optimistic })`. */
  useMutation<A extends unknown[], R>(run: (...args: A) => Promise<R>, options?: UseMutationOptions<A>): Mutation<A, R>;
}

export function createHooks(React: ReactLike): Hooks {
  function useQuery<T>(query: Query<T> | null | undefined | false, options: UseQueryOptions<T> = {}): QueryState<T> {
    const active = query && options.enabled !== false ? query : null;
    const key = active?.key ?? null;
    // The read is usually built inline, so a new object arrives with every render: keep the latest
    // one, and start a new subscription only when its key changes.
    const latest = React.useRef({ query: active, seed: options.seed });
    latest.current = { query: active, seed: options.seed };
    const store = React.useMemo(() => {
      const { seed } = latest.current;
      const initial: QueryState<T> = seed && key !== null ? { data: seed.data, error: undefined, loading: false } : { data: undefined, error: undefined, loading: key !== null };
      let state = initial;
      return {
        subscribe(changed: () => void): () => void {
          const read = latest.current.query;
          if (read === null) return () => {};
          return read.subscribe(
            (data) => {
              state = { data, error: undefined, loading: false };
              changed();
            },
            (error) => {
              state = { data: state.data, error, loading: false };
              changed();
            },
            seed,
          );
        },
        snapshot: () => state,
        server: () => initial,
      };
    }, [key]);
    return React.useSyncExternalStore(store.subscribe, store.snapshot, store.server);
  }

  function useMutation<A extends unknown[], R>(run: (...args: A) => Promise<R>, options: UseMutationOptions<A> = {}): Mutation<A, R> {
    const [state, setState] = React.useState<{ pending: number; error: Error | undefined }>({ pending: 0, error: undefined });
    const latest = React.useRef({ run, options });
    latest.current = { run, options };
    const mutate = React.useCallback(async (...args: A): Promise<R> => {
      const updates: { settle(): void; rollback(): void }[] = [];
      setState((s) => ({ pending: s.pending + 1, error: undefined }));
      try {
        latest.current.options.optimistic?.((query, update) => void updates.push(query.optimistic(update)), ...args);
        const result = await latest.current.run(...args);
        for (const update of updates) update.settle();
        setState((s) => ({ ...s, pending: s.pending - 1 }));
        return result;
      } catch (e) {
        for (const update of updates) update.rollback();
        const error = e instanceof Error ? e : new Error(String(e));
        setState((s) => ({ pending: s.pending - 1, error }));
        throw e;
      }
    }, []);
    const reset = React.useCallback(() => setState((s) => ({ ...s, error: undefined })), []);
    return { mutate, pending: state.pending > 0, error: state.error, reset };
  }

  return { useQuery, useMutation };
}
