// The local NAMES wins over the one `export *` brings, and so does its (inferred) type.
export * from "./names";
export const NAMES = { a: 1 };
