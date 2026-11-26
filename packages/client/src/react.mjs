// spacepress/react (and @spacepress/client/react): React hooks for SpacePress sites.
//
// In `spacepress build`, `"use client"` components that import `useLive`, `useMutation`, `useMount`,
// `useEvent`, `sharedState`, and `uploadFile` here alongside `useState`, `useEffect`, and `useRef`
// from `"react"` compile directly to WordPress Interactivity API stores with zero React shipped.
//
// In tests, Storybook, or external React frontends (Next.js, Vite, Astro islands), this module
// provides real React implementations backed by `spacepress/client` (`@spacepress/client`).

let boundClient = null;

/**
 * Configure the client instance used by `useLive`, `useMutation`, and `uploadFile` when running in
 * a React app, Storybook, or test harness outside SpacePress's Interactivity API compiler.
 */
export function setClient(client) {
  boundClient = client ?? null;
}

/** Returns the configured client instance, if any. */
export function getClient() {
  return boundClient;
}

function resolveQuery(ref) {
  if (!ref) return null;
  if (typeof ref === "string") {
    throw new TypeError(
      `useLive() takes a typed query from _generated/api (e.g. useLive(api.${ref}.list())), not a string.`,
    );
  }
  if (ref.__sp === "query") {
    const client = boundClient;
    const collection = client?.[ref.kind];
    if (!collection) return null;
    if (ref.op === "get" && typeof collection.get === "function") {
      return collection.get(ref.id, ref.args);
    }
    if (typeof collection.list === "function") {
      return collection.list(ref.args);
    }
    return null;
  }
  return ref;
}

function resolveAction(ref) {
  if (typeof ref === "function") return ref;
  if (ref && ref.__sp === "action") {
    return async (input) => {
      const client = boundClient;
      if (!client?.actions?.[ref.name]) {
        throw new Error(
          `useMutation(api.actions.${ref.name}) requires a bound SpacePress client (call setClient(createClient()) in external React apps).`,
        );
      }
      return client.actions[ref.name](input);
    };
  }
  throw new TypeError("useMutation() expects an action reference from _generated/api (api.actions.<name>) or a function.");
}

/**
 * Create React `useQuery`, `useLive`, and `useMutation` hooks bound to the caller's React
 * (React 18+ or Preact via `preact/compat`), with no hard runtime dependency on React.
 */
export function createHooks(React) {
  const useLatestEffect = typeof document === "undefined" ? React.useEffect : React.useLayoutEffect;

  function useQuery(query, options = {}) {
    const resolved = options.enabled === false ? null : resolveQuery(query);
    const active = resolved && typeof resolved.subscribe === "function" ? resolved : null;
    const key = active?.key ?? null;
    const seed = options.seed;
    const store = React.useMemo(() => {
      const initial = seed && active !== null
        ? { data: seed.data, error: undefined, loading: false }
        : { data: undefined, error: undefined, loading: active !== null };
      const held = { state: initial };
      return {
        subscribe(changed) {
          if (active === null) return () => {};
          return active.subscribe(
            (data) => {
              held.state = { data, error: undefined, loading: false };
              changed();
            },
            (error) => {
              const refused = error.status === 401 || error.status === 403 || error.status === 404;
              held.state = { data: refused ? undefined : held.state.data, error, loading: false };
              changed();
            },
            seed,
          );
        },
        snapshot: () => held.state,
        server: () => initial,
      };
    }, [key]);
    return React.useSyncExternalStore(store.subscribe, store.snapshot, store.server);
  }

  function useMutationHook(target, options = {}) {
    const run = resolveAction(target);
    const [state, setState] = React.useState({ pending: 0, error: undefined });
    const latest = React.useRef({ run, options });
    useLatestEffect(() => {
      latest.current = { run, options };
    });
    const mutate = React.useCallback(async (...args) => {
      const updates = [];
      setState((s) => ({ pending: s.pending + 1, error: undefined }));
      try {
        latest.current.options.optimistic?.((query, update) => {
          const resolved = resolveQuery(query);
          if (resolved?.optimistic) updates.push(resolved.optimistic(update));
        }, ...args);
        const result = await latest.current.run(...args);
        for (const update of updates) update.settle();
        setState((s) => ({ ...s, pending: s.pending - 1 }));
        return result;
      } catch (e) {
        for (const update of updates) update.rollback();
        const error = e && typeof e === "object" && "code" in e && "message" in e
          ? e
          : { code: "error", message: e instanceof Error ? e.message : String(e) };
        setState((s) => ({ pending: s.pending - 1, error }));
        throw e;
      }
    }, []);
    const reset = React.useCallback(() => setState((s) => ({ ...s, error: undefined })), []);
    return { mutate, pending: state.pending > 0, error: state.error, reset };
  }

  return { useQuery, useLive: useQuery, useMutation: useMutationHook };
}

/**
 * Create a reactive shared state object usable both in SpacePress Interactivity API components
 * (compiled to global store `state`) and in plain React / tests.
 */
export function sharedState(initial) {
  return { ...initial };
}

/**
 * Run `effect` once on mount. Compiles to `data-wp-init` in SpacePress `"use client"` components.
 */
export function useMount(effect) {
  if (typeof globalThis.window === "undefined") return;
  try {
    const cleanup = effect();
    if (typeof cleanup === "function") return cleanup;
  } catch {
    // Let caller surface errors if run inside React lifecycle.
  }
}

/**
 * Subscribe to a `window` or `document` event. Compiles to `data-wp-on-window--<event>` /
 * `data-wp-on-document--<event>` in SpacePress `"use client"` components.
 */
export function useEvent(event, listener, target = "window") {
  if (typeof globalThis.window === "undefined") return;
  const host = target === "document" ? globalThis.document : globalThis.window;
  host?.addEventListener?.(event, listener);
  return () => host?.removeEventListener?.(event, listener);
}

/**
 * Live read kept current via `spacepress/client` (`useLive(api.notes.list({ limit: 20 }))`).
 * Compiles to a server-seeded Interactivity API subscription in SpacePress `"use client"` components.
 */
export function useLive(query, options = {}) {
  if (typeof query === "string") {
    throw new TypeError(
      `useLive() takes a typed query from _generated/api (e.g. useLive(api.${query}.list())), not a string.`,
    );
  }
  if (options.enabled === false) {
    return { data: undefined, error: undefined, loading: false };
  }
  const resolved = resolveQuery(query);
  if (!resolved) {
    return { data: undefined, error: undefined, loading: false };
  }
  return { data: undefined, error: undefined, loading: true };
}

/**
 * Bind an action reference from `_generated/api` (`useMutation(api.actions.addNote)`).
 * Compiles to reactive Interactivity API state + WP Abilities run call in `"use client"` components;
 * in non-React contexts/tests, dispatches through the bound client (`setClient`).
 */
export function useMutation(action) {
  const run = resolveAction(action);
  return {
    mutate: (...args) => run(...args),
    pending: false,
    error: undefined,
    reset() {},
  };
}

/**
 * Upload a browser `File` or `Blob` to a registered `files()` private bucket via `spacepress/client`.
 */
export async function uploadFile(bucket, file, options) {
  const client = boundClient;
  if (!client?.files?.[bucket]?.upload) {
    throw new Error(
      `uploadFile("${bucket}") requires a bound SpacePress client (call setClient(createClient()) in external React apps).`,
    );
  }
  return client.files[bucket].upload(file, options);
}
