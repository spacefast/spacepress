/**
 * `"spacepress:db"`: every kind the app registers, by name (docs/spec/spec.md §2.1).
 *
 * ```ts
 * import { posts } from "spacepress:db";
 * ```
 *
 * The names come from `sp/_generated/db.d.ts`, which `spacepress build` writes. Until the first build,
 * the module has no names.
 *
 * A .d.cts file: `export =` is CommonJS syntax, which a .d.ts inside a "type": "module" package
 * (the published spacepress) refuses with TS1203.
 */
declare module "spacepress:db" {
  const kinds: import("spacepress").RegisteredKinds;
  export = kinds;
}
