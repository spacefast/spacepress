# The authoring surface: rulings for the cutover

Date: 2026-11-11. Decided for the First authoring lane (a design subagent, Fable 5.2, at medium
effort) where `docs/spec/spec.md` (2026-11-08, third revision) leaves a choice open or contradicts
itself. Later owner or coordinator rulings override these. Each PR in the cutover cites the rulings it
implements.

Owner and coordinator rulings already in force: kind `label` stays as the one named override for the
inferred label; raw signed webhooks are `app/**/route.ts`, not an action `signature` option;
diagnostic codes are not renamed; the Zero 0.8 converter keeps emitting valid code in every PR.

## Fields

1. **`ref` storage.** The field name is the stored column, the relation name and the `with` key, with
   no `Id` suffix added. `with: { location: true }` replaces the id with the row under the same key.
   Ports keep their existing column names (`locationId: ref(locations).optional()`), so nothing is
   stored differently.
2. **Reverse relations** are named after the referencing kind's export (`locations.list({ with: {
   items: true } })`). `.reverse("name")` names one. Two refs from one kind to the same target get no
   default reverse: using one without `.reverse()` is a build error that names both fields. A reverse
   named like a field of the target is a build error.
3. **`.many()` on `ref`** gets one First-owned join table per field, `<kind storage name>_<field
   snake_case>`, with `owner_id`, `target_id` and a 0-based `position` (write order), primary key
   `(owner_id, target_id)` and an index on `target_id`. Deleting either side deletes the link;
   `.onDelete("restrict")` is the only other value.
4. **Implicit `id`, `author`, `createdAt`, `updatedAt`.** An authored field with one of these names
   is a build error ("built in; delete this field"). On tables they are columns: `author` is a
   nullable, indexed user id; the timestamps are not null. On post kinds, `author` is `post_author`,
   `updatedAt` is `post_modified_gmt`, `publishedAt` is `post_date_gmt`, and `createdAt` is post meta
   written once at insert, falling back to `post_date_gmt`. `users`, taxonomies, globals and files have
   no `author`.
5. **Access values.** `"author"` means "this row's author, or editor and up". Where there is no row
   yet (`create`, an action's `access`), it means the role author and up. `"authenticated"` becomes
   `"subscriber"`; `true` becomes `"anyone"`; `false` becomes `"system"` (trusted code only). `"self"`
   survives only in `users` field access. Kind access keys are `read`, `create`, `update`, `delete`
   and `write`, where `write` fills whichever of create, update and delete aren't given.
6. **Field access** is `.access({ read?, write? })`. `write` covers create and update. Server-set
   fields are `.access({ write: "system" })`. A function receives `(ctx, row?)`, with `row` undefined
   on create.
7. **Translations.** With `locales` set, every field of a translated kind is per locale unless
   `.shared()`. `.localized()` is deleted. Translated kinds are collections, taxonomies and the built-in
   post and term kinds. A kind option `translations: false` opts a collection or taxonomy out.
   `.shared()` on a kind that isn't translated is a build error.
8. **Primary keys.** `id()` and `.primaryKey()` are deleted. Every kind with rows has an integer `id`.
   A text key becomes `code: text().unique().max(191)`, read with `get({ code })`.
9. **Defaults.** `.default(v)` takes a literal, including a JSON literal. `.defaultNow()` stays, on
   `date()` and `timestamp()`. A function default is a build error ("use a literal or set it in
   `beforeCreate`"). `$default` and `$onUpdate` are deleted; the implicit `updatedAt` was the only use
   of `$onUpdate`.
10. **Select and slug.** `select(["a", "b"])` replaces `select({ options })` and `text({ enum })`;
    `.many()` replaces `multiple: true`. `slug()` is deleted: collections have the implicit `slug`
    (`post_name`), derived from the title. A table that wants one declares `slug:
    text().unique().max(191)` and fills it in `beforeCreate`.
11. **Containers** take their fields directly: `group({ ... })`, `repeater({ ... })`, `blocks({
    layoutName: { ... } })`. `.min()`/`.max()` apply to `repeater` and `blocks`. `layout` is reserved
    inside a block layout.
12. **Files.** `file(bucket)` takes the exported `files()` value; a string is a build error. The
    bucket's name is its export name.
20. **Title and content.** `{ title: "name" }` becomes `name: text().title()`, needed only when
    inference would pick another field. Inference: the `title` field, else the first `text()`; the
    body is the only `richText()`.

Nothing is translated, defaulted or required differently in a port: a field without `.notNull()` on
the earlier API becomes `.optional()`.

## Kinds

13. **Kind options.**

    | Option | Ruling |
    |---|---|
    | `drafts`, `revisions` | deleted; collections always have both, tables neither |
    | `api` | deleted; exposure is the access rule, and `"system"` hides a kind |
    | `uid` | the option is deleted; the `uid` column exists when the kind has `sync` or a synced kind refers to it |
    | `agents` | renamed `abilities`: `true`, `false` or `{ public: true }` |
    | `title`, `content` | deleted (ruling 20) |
    | `existingTable` | kept, tables only: it binds an exact table First doesn't own (app adoption and the 0.8 converter use it) |
    | `label` | kept (owner ruling) |
    | `translations` | new (ruling 7) |

14. **Built-in names.** `F1220` governs export names, not storage names. A kind exported under another
    name keeps any unique `storageName`, so a converted 0.8 app with a `posts` table keeps its data:
    `export const articles = collection({ ... }, { storageName: "posts" })`. `wp.settings.extend(fields)`
    replaces a global named `settings`. `examples/blog` keeps its own storage under new export names,
    and `examples/emdash/blog` is the example that runs on `wp.posts`.
18. **Hooks.** `.on()` returns the kind and may be chained; handlers run in order. It belongs to the
    exported declaration: `.on()` on a kind imported from another file is a build error. Handler
    functions may come from anywhere.
19. **Index reasons.** Each index in `first check --json` is `{ kind, fields, unique, reasons: [{
    type, at? }] }`, where `type` is `ref`, `unique`, `author`, `uid`, `url`, `where`, `orderBy` or
    `declared`. `where`, `orderBy` and `declared` carry `at: "first/server/x.ts:12"`.

## Server code

15. **Action input** comes from the handler's first parameter; `input: { ... }` is deleted. `number`
    validates as a finite number, and `Int` (a type exported by `"first"`) as an integer. Accepted
    types: `string`, `number`, `Int`, `boolean`, string and number literal unions, `T[]`, nested object
    literals, `?`, `| null`, and same-file aliases or interfaces built from those. Anything else is a
    build error naming the parameter, with the fix "inline the shape". There is no constraint syntax:
    check in the handler and throw `HttpError(422, …)`. Defaults are literal destructuring defaults. The
    output schema comes from an explicit return annotation; without one the Ability output is untyped.
16. **Jobs and actions as calls.** Calling a job enqueues it: `await notifyEditors({ commentId }, {
    key, delay })`, with `delay` in seconds or a duration string, returning `Promise<void>` and running
    after commit as the system. The `.enqueue` in spec §4's comment is stale. An action called from
    server code runs as the current viewer with its access check, and as the system inside jobs.
17. **The query API** on every kind:
    `list({ where?, orderBy?, limit?, offset?, with?, search? })` (limit default 100, max 1000),
    `paginate({ ..., cursor? })` → `{ rows, cursor }`, `get(id | { uniqueField })`,
    `count({ where?, search? })`, `create(data)` → row, `update(idOrUnique, patch)` → row,
    `delete(idOrUnique)`, `updateMany({ where }, patch)` and `deleteMany({ where })` → count (`where`
    required; `{}` means every row). `x.system` has the same methods without access rules or field
    masks; validation and hooks still run. Hooks, actions, pages, components and unsigned routes run as
    the visitor; jobs and signed routes as the system; `first/wp-hooks/` as the request's visitor, or
    the system under WP-Cron, Action Scheduler and WP-CLI.

## Stored-schema changes the cutover accepts

The criterion "the authoring rewrite produces no data migration" holds except for exactly these:

- the implicit `author` column on every table, and `createdAt`/`updatedAt` on tables that lacked them
  (existing rows get `author = NULL` and both timestamps set to the time the change applies);
- pantry's `items.tags` default metadata, if it emits no SQL;
- a `slug` entry on blog's `authors`, which maps to the core `post_name` and emits no SQL;
- blog's `members` user projection leaves the snapshot, because users are `wp_users`.

Anything else a port changes in a snapshot fails the criterion.
