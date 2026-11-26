// The local NAMES wins over `export *` even when the star comes after it.
export const NAMES = { a: 1 };
export * from "./names";
