// "first/client": hooks for `"use client"` components (docs/spec/rendering.md §4.1). Types only:
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
