/**
 * `"typedpress:db"`: every kind the app registers, by name (docs/spec/spec.md §2.1).
 *
 * ```ts
 * import { posts } from "typedpress:db";
 * ```
 *
 * The names come from `tp/_generated/db.d.ts`, which `typedpress build` writes. Until the first build,
 * the module has no names.
 *
 * A .d.cts file: `export =` is CommonJS syntax, which a .d.ts inside a "type": "module" package
 * (the published typedpress) refuses with TS1203.
 */
declare module "typedpress:db" {
  const kinds: import("typedpress").RegisteredKinds;
  export = kinds;
}
