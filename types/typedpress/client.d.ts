// "typedpress/client": hooks for `"use client"` components (docs/spec/rendering.md §4.1). Types only:
// the compiler turns the component into server HTML plus an Interactivity API store module.

/** A value of the component's state: a `data-wp-context` field. */
export declare function useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void];
/** Runs after a change to the values it reads (`data-wp-watch`). */
export declare function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
/** Runs once, when the component's element is hydrated (`data-wp-init`). */
export declare function useMount(effect: () => void | (() => void)): void;
/** A listener on `window` (the default) or `document` (`data-wp-on-window--<event>`). */
export declare function useEvent<K extends keyof WindowEventMap>(event: K, listener: (event: WindowEventMap[K]) => void, target?: "window" | "document"): void;
/** The element the ref is attached to (`getElement().ref`). */
export declare function useRef<T extends Element = HTMLElement>(): { readonly current: T | null };
/** State every component of this module shares: the store's global `state`. */
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
 * read through the app's typed client, so another visitor's write shows without a reload. The
 * query reads props and literals. `{ enabled: false }` reads nothing.
 */
export declare function useLive<T = any>(kind: string, query?: Record<string, unknown>, options?: { enabled?: boolean }): LiveState<T[]>;
