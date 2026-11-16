// The slice of @wordpress/interactivity (bundled with WordPress 7.1) the island uses.
export function store(namespace: string, definition: Record<string, unknown>): unknown;
export function getContext<T>(): T;
export function getConfig<T = Record<string, unknown>>(namespace?: string): T;
