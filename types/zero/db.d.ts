/**
 * `"zero:db"`: every kind the app registers, by name (docs/spec/spec.md §2.1).
 *
 * ```ts
 * import { posts } from "zero:db";
 * ```
 *
 * The names come from `zero/_generated/db.d.ts`, which `zero build` writes. Until the first build,
 * the module has no names.
 */
declare module "zero:db" {
  const kinds: import("zero").RegisteredKinds;
  export = kinds;
}
