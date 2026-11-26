/**
 * `"spacepress/server/db"`: every kind the app registers, by name (docs/spec/spec.md §2.1).
 *
 * ```ts
 * import { posts } from "spacepress/server/db";
 * ```
 *
 * The names come from `<dir>/_generated/db.d.ts`, which `spacepress build` writes. Until the first
 * build, the module has no names.
 *
 * A .d.cts file: `export =` is CommonJS syntax, which a .d.ts inside a "type": "module" package
 * refuses with TS1203.
 */
import type { RegisteredKinds } from "./index.d.ts";
declare const kinds: RegisteredKinds;
export = kinds;
