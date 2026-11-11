/**
 * `"first:db"`: every kind the app registers, by name (docs/spec/spec.md §2.1).
 *
 * ```ts
 * import { posts } from "first:db";
 * ```
 *
 * The names come from `first/_generated/db.d.ts`, which `first build` writes. Until the first build,
 * the module has no names.
 *
 * A .d.cts file: `export =` is CommonJS syntax, which a .d.ts inside a "type": "module" package
 * (the published @spacefast/first-cli) refuses with TS1203.
 */
declare module "first:db" {
  const kinds: import("first").RegisteredKinds;
  export = kinds;
}
