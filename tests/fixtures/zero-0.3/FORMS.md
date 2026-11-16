# The 0.3.0 authoring forms

Every authoring form the 0.3.0 compiler (commit `61c22fc2`) accepted, from its `types/zero/index.d.ts`,
`docs/config-api.md` and `examples/`. `forms/` uses each one. "TypedPress project" is what the current
compiler does with the form in a project of its own; "0.3.0 capture" is what it does with the form in
a stored `zero.source-bundle.v1`, found by capturing a probe app with the 0.3.0 compiler and
recompiling it (`tests/zero_bundle.rs`). "As 0.3.0" means: compiles, plans no migration, and keeps the
0.3.0 snapshot and served schema.

| Form | Example | TypedPress project | 0.3.0 capture before this table | 0.3.0 capture now |
|---|---|---|---|---|
| `.notNull()` | `text().notNull()` | refused: "`.notNull()` is gone: fields are required by default" | as 0.3.0 (ruling 21) | as 0.3.0 |
| plain builder is nullable | `text()` | read as required (`.optional()` for nullable) | as 0.3.0 (ruling 21) | as 0.3.0 |
| `id()` | `id: id()` | refused: "`id()` is gone: every kind already has an integer `id`" | as 0.3.0 | as 0.3.0 |
| `.primaryKey()` on integer | `n: integer().primaryKey()` | refused: "`.primaryKey()` is gone: every kind has an integer `id`" | as 0.3.0 | as 0.3.0 |
| `.primaryKey()` on text | `code: text().primaryKey().max(40)` | refused, as above | **compiled differently**: an `id` column added, migration `ALTER TABLE … ADD COLUMN id` planned | as 0.3.0 |
| `real()` | `score: real()` | refused: "`real()` is now `number()`" | as 0.3.0 | as 0.3.0 |
| `text({ enum })` | `text({ enum: ["a", "b"] })` | refused: "`text({ enum })` is now `select([...])`" | as 0.3.0 | as 0.3.0 |
| `text({ multiline })` | `text({ multiline: true })` | accepted | as 0.3.0 | as 0.3.0 |
| `select({ options, multiple })` | `select({ options: ["x"], multiple: true })` | refused: "select() takes its options as an array" | as 0.3.0 | as 0.3.0 |
| `media({ multiple })` | `media({ multiple: true })` | refused: "`media({ multiple: true })` is now `.many()`" | as 0.3.0 | as 0.3.0 |
| `group({ fields })`, `repeater({ fields })`, `blocks({ layouts })` | `group({ fields: { a: text() } })` | refused: "group() takes its fields directly, without the `{ fields }` wrapper" | as 0.3.0 | as 0.3.0 |
| `json().$type<T>()` | `json().$type<string[]>()` | refused: "`json().$type<T>()` is now `json<T>()`" | as 0.3.0 | as 0.3.0 |
| `.references()` | `integer().references(() => a.id, { onDelete })` | refused: "`.references()` is gone: a reference is a `ref()` field" (#295) | as 0.3.0 (#295 kept it for captures) | as 0.3.0 |
| `defineRelations` and `relations` | `defineRelations(entities, (r) => …)` | refused: "`defineRelations()` is gone" / "`relations` is gone" (#295) | as 0.3.0 (#295) | as 0.3.0 |
| `route()` and `routes` | `routes: { feed: route({ method, path, access, handler }) }` | refused: "\"typedpress\" has no export named `route`" / "defineConfig() has no option `routes`" (#304) | **fails**: "\"typedpress\" has no export named `route`" | as 0.3.0, served as the 0.3.0 runtime served it (`routes/served.json`) |
| `definePlugin({ routes })` | a plugin package's `routes` | refused: "definePlugin has no option `routes`" (#304) | **fails**, as above | as 0.3.0 |
| signature scheme `"zero"` | `signature: { …, scheme: "zero" }` | refused: "signature.scheme must be first or hmac-sha256" (renamed in #243) | **fails**: "signature.scheme must be zero or hmac-sha256" | as 0.3.0 (reads as `"first"`) |
| `slug({ source })` | `slug: slug({ source: "title" })` | accepted | as 0.3.0 | as 0.3.0 |
| `.localized()` and `locales` | `text().localized()` | accepted | as 0.3.0 | as 0.3.0 |
| `$default`, `$defaultFn`, `$onUpdate`, `$onUpdateFn`, `.defaultNow()`, `.default()` | `timestamp().$onUpdate(() => new Date())` | accepted | as 0.3.0 | as 0.3.0 |
| `.access()`, `.showIf()`, `.ui()`, `.validate()`, `.pattern()`, `.min()`, `.max()`, `.unique()` | `text().access({ read: "editor" })` | accepted | as 0.3.0 | as 0.3.0 |
| `collection()`, `table()` and their options | `{ storageName, existingTable, drafts, revisions, uid, sync, api, agents, label, title, content, access }` | accepted | as 0.3.0 | as 0.3.0 |
| access values `"authenticated"`, `true`, `false`, `"self"`, `"owner"`, functions | `access: { read: "authenticated" }` | accepted | as 0.3.0 | as 0.3.0 |
| `userProjection()` and `users` | `users: { members }` | accepted | as 0.3.0 | as 0.3.0 |
| `global(name, fields)` and `globals` | `global("settings", { … })` | accepted | as 0.3.0 | as 0.3.0 |
| `defineConfig` registries | `collections`, `tables`, `users`, `globals`, `actions`, `jobs` | accepted | as 0.3.0 | as 0.3.0 |
| `hooks` (all six) | `hooks: { posts: { beforeCreate(data) { … } } }` | accepted | as 0.3.0 | as 0.3.0 |
| `action({ input, access, handler })` with `idempotent`, `agents`, `signature` | `action({ input: {}, handler() {} })` | accepted | as 0.3.0 | as 0.3.0 |
| `job({ input, retries, handler })`, `jobs.<name>.enqueue` | `jobs.record.enqueue({ id }, { key, delay })` | accepted | as 0.3.0 | as 0.3.0 |
| `db.query.*.findMany/findFirst`, `db.insert/update/delete`, `db.globals` | `db.insert(notes).values(row).returning()` | accepted | as 0.3.0 | as 0.3.0 |
| `once`, `mail.send`, `env`, `HttpError`, `fetch`, `node:crypto` | `once(key, fn)` | accepted | as 0.3.0 | as 0.3.0 |
| `webhooks`, `files`/`file({ bucket })`, `uploads`, `media.sizes`, `services`, `admin`, `plugins` | `files: { decks: files("decks", { … }) }` | accepted | as 0.3.0 | as 0.3.0 |
| `use` with `definePlugin({ hooks, actions, jobs })` | `use: [seo({ suffix })]` | accepted | as 0.3.0 | as 0.3.0 |
| `wp-hooks/`, `"php/wordpress"` functions and `abilities.call` | `wp-hooks/the_content/10-frame.ts` | accepted | as 0.3.0 | as 0.3.0 |
| exports that no registry lists | `export const spare = table({ … })` | registered by export name (spec §1.1) | as 0.3.0 (sources outside `tp/` aren't scanned) | as 0.3.0 |
| `import * as z from "zero"` | `z.table({ id: z.id() })` | `id`, `real`, `route` absent from the namespace | **fails**: "undefined isn't a function" | as 0.3.0 |
| relative helpers outside `tp/` | `import { clamp } from "./lib/util"` | refused: "… is outside tp/" | as 0.3.0 | as 0.3.0 |
| `public/` files, synced `content/*.md` | `sync: "content/posts/*.md"` | accepted | as 0.3.0 | as 0.3.0 |
| TSX pages (`pages/`, `zero/pages.json`) | 0.3.0's `examples/full-site` | `tp/app/` replaces them | refused with a message | refused: "this bundle has TSX pages (pages/) …", help names `tp/app/<path>/page.tsx` and `typedpress sources` |

Not covered by a fixture: `existingTable` adoption on a live site, and Polylang behaviour for
`.localized()` at runtime (both compile as 0.3.0; their runtime paths are other suites').
