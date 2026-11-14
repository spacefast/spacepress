# The authoring surface: rulings for the cutover

Date: 2026-11-11. Where `docs/spec/spec.md` (2026-11-08, third revision) leaves a choice open or
contradicts itself, these are the choices the cutover makes. Later owner or coordinator rulings override these. Each PR in the cutover cites the rulings it
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

## Captures from before the rename

21. **The 0.3.0 field reading.** A `zero.source-bundle.v1` upload (what released clients that predate
    the rename still send, and what hosts store for the deployed First Spaces) is source written when a
    plain builder was nullable and `.notNull()` made it required. It is read that way: `Fs::legacy_fields`,
    set only by `src/zero_bundle.rs`, turns on a reading in `src/eval.rs` (`mod legacy`) that accepts
    `.notNull()`, `id()`, `.primaryKey()`, `real()`, `text({ enum })`, `select({ options, multiple })`,
    `group({ fields })`, `blocks({ layouts })` and `json().$type<T>()` and maps each onto the same field
    model the current forms build. Nothing after that reading differs. The boundary is the bundle format,
    not `frozen_capture()`: a First-format capture and every live project get the current surface only,
    and the old forms are located errors there. This is stored-data compatibility, not an alias: a
    recompile that read `text()` as required would change the stored schema of a deployed Space. Later
    cutover slices (implicit `createdAt`, handler-typed action input) go through the same hook; one that
    can't be expressed as a reading into the current model goes to the owner. Delete the reading with
    `src/zero_bundle.rs`, once no released client uploads `zero.source-bundle.v1` and no host stores one.

22. **`ref()` refers to `id` only.** `ref(kind)` takes a kind and nothing else; a reference to
    another column (`integer().references(() => payroll.badge)`) is not part of the surface. Rulings 1
    and 2 make the field the relation, the `with` key and the reverse name, all resolved through the
    target's `id`, and a second join path would bring the hidden-key rule with it for a form no example,
    ledger or converter output uses. A kind that links by a natural key stores the value as a plain
    field and queries by it. The runtime keeps non-id references for 0.3.0 captures (ruling 21), and
    its tests move to a fixture in that format. Cost: authors lose database-enforced natural-key
    foreign keys; bringing them back is a new surface decision.

23. **One old reading, every 0.3.0 form.** Ruling 21's switch is the only old-reading mode: the one
    flag (`Fs::legacy_fields`, which only `src/zero_bundle.rs` sets, read as `Evaluator::legacy`) also
    turns on `mod legacy` in `src/extract.rs`. There is no per-form switch, CLI flag or config key, and
    nothing a normal project can reach. With it, besides ruling 21's field forms and ruling 22's
    references:
    - a table that declares its own primary key (`code: text().primaryKey()`) gets no implicit `id`,
      as 0.3.0 built it, so its stored table and snapshot are unchanged;
    - `route()` and the `routes` key (in `defineConfig` and `definePlugin`) read onto the
      `first/app/` route table, one handler route per entry, with its access rule or signature. The
      table is marked `legacyRoutes` and the runtime serves it as 0.3.0 did: a path is matched among
      the routes of the request's method (405 when only another method has it), reads in the handler
      are trusted, and the theme keeps the front end (no First 404 page). The 0.3.0 plugin lock's
      `routes` grants are ignored;
    - the signature scheme `"zero"` reads as `"first"`, the same timestamped HMAC renamed.

    `tests/fixtures/zero-0.3/forms/` holds every form 0.3.0 accepted, captured and compiled by the
    0.3.0 compiler, and `tests/zero_bundle.rs` asserts its recompile adds no migration and serves the
    0.3.0 schema; `routes/` holds what the 0.3.0 runtime answered each route request. A PR that
    removes or changes an authoring form runs that test (docs/spacefast-host-checklist.md, "Old
    bundles"). Delete `mod legacy` in both files with `src/zero_bundle.rs`.

24. **A raw 0.3 project is captured, then read as its capture.** One released client, the hosted
    MCP server 0.9.0, uploads the project itself (`zero.config.ts` at the root, the relative modules
    it imports, `public/`) and labels it `zero.source-bundle.v1`; the 0.3.0 host captured it before
    compiling. First's host entries do the same: `host::sources`, `compile-sources` and
    `compile-to-store` capture such a tree into the exact `zero.source-bundle.v1` the 0.3.0 host
    capture wrote (the fixtures check it byte for byte), and hand that to the reader of ruling 23. So
    there is still one old-reading mode and one path after the capture, and a raw upload compiles,
    migrates and is refused exactly as its capture is. The capture reads the tree through a view
    that puts the 0.3.0 paths on the current layout and turns on the same reading; nothing else
    constructs it. As 0.3.0's host did, it refuses npm imports (a host installs no packages) with
    "publish this project from the Spacefast CLI to capture installed npm sources", and refuses
    `pages/` or `zero/pages.json` with the capture's pages message. A tree that holds both
    `zero.config.ts` and `first.config.ts`, or a raw project beside a capture (`.zero-source/`,
    `.first-source/` or the bundle files), is refused as ambiguous. `first build`, `check`, `dev`
    and `sources` read only `first.config.ts`, so a normal project never reaches it. Considered and
    dropped: reading the raw tree directly in the compile, which would be a second old-reading path
    beside the capture's. Delete with `src/zero_bundle.rs`.

## Registries and user projections

35. **Two PRs, registries first.**
    - **The first PR** removes the `defineConfig` registry keys `collections`, `tables`, `users`, `globals`, `files`, `actions`, `jobs` and `hooks` (`relations` and `routes` are already refused). Everything registers by export, including the exports of `first.config.ts` itself (spec §1.1). `userProjection()` stays as a builder in this PR: an exported projection registers as the users kind under its export name.
    - **The second PR** adds `wp.users.extend()` and deletes `userProjection` (ruling 40). It brings `wp.users` alone, not every built-in. `F1220` arrives per built-in name as each built-in lands, starting with `users`, because several examples still export a `posts` collection (ruling 14).
    - **Why.** The `users` key and the `userProjection` builder are separable: the key needs nothing new, the builder's replacement needs a `wp` namespace that doesn't exist yet. Tying them together would hold about 250 config ports behind the built-ins work.

    Cost: between the two PRs, `export const members = userProjection(...)` is a form in neither the old API nor the spec, and configs that use it are touched twice.

36. **A removed key is a located error naming the export form.** The span is the key.

    | Key | Message | Fix |
    |---|---|---|
    | `collections` | `collections` is gone: a kind registers by its export | `export const posts = collection({ ... })` in `first.config.ts` or any file under `first/`; the export name is its API name |
    | `tables` | same, for `table()` | `export const likes = table({ ... })` |
    | `users` | same, for the users kind | `export const members = userProjection({ ... })` (later `export const users = wp.users.extend({ ... })`) |
    | `globals` | same, for `global()` | `export const settings = global({ ... })` |
    | `files` | same, for `files()` | `export const decks = files({ ... })`; `file(decks)` takes the export (ruling 12) |
    | `actions` | same, for `action()` | `export const like = action(...)`; the client call is `first.like()` |
    | `jobs` | same, for `job()` | `export const digest = job(...)` |
    | `hooks` | `hooks` is gone: hooks are declared on the kind | `export const posts = collection({ ... }).on({ beforeCreate(data) { ... } })` (ruling 18) |

    - **When the key was not the binding name** (`productVariants: variants`), the fix names the key ("export it as `productVariants`"), so the API name and the stored name don't change.
    - **Keys that stay:** `name`, `frontend`, `output`, `plugins`, `use`, `sealed`, `services`, `locales`, `media`, `uploads`, `webhooks`, `admin`, `publicAuthors`, `runtimeSchema`. None of them registers a named thing.
    - **Types.** The keys leave `ConfigInput`, so TypeScript reports an excess property; the compiler's error carries the fix.

    Cost: spec §6 writes the image-sizes key as `images` while the code and every example use `media`; it stays `media`, and renaming it is a separate decision.

37. **A kind, global, bucket, action or job that is built but not exported is a build error.** Every `collection()`, `table()`, `userProjection()`, `global()`, `files()`, `action()` and `job()` value built while evaluating `first.config.ts` or a module under `first/` must be a named export of one of them. The error is located at the builder call, with its own code beside `F1221`: "`hidden` is a table but isn't exported, so it has no name; write `export const hidden = table(...)`". It applies whether or not anything refers to the value: under the old API that value was registered, so ignoring it would turn a missed `export` in a port into a dropped table on the next deploy. `export { a as b }` counts, the name is `b`. Values built inside a plugin package (ruling 38) and 0.3.0 captures (ruling 41) are not covered. One namespace: an action may no longer share a name with a kind (`F1221`, spec §1.1).

    Cost: a kind can't be built as a private helper value, for example to share a field set; share the fields object instead.

38. **Plugin packages keep `definePlugin({ name, hooks, actions, jobs })` for now.** A plugin is a value passed in `use`, not a module under `first/`, and its package's exports are not scanned. Its actions and jobs keep registering as `<plugin>_<name>`, and its `hooks` stay keyed by the app's kind names, which are now export names. The plugin lock and isolation rules (docs/decisions/2026-11-07-plugin-capabilities.md) are written against this shape; changing it is a plugin-API decision with its own compatibility question for published plugin packages.

    Cost: `definePlugin` is the one place the object-of-handlers `hooks` shape and name-keyed `actions`/`jobs` survive; they need their own ruling before plugins are documented as stable.

39. **The 0.8 converter emits the export form in the same PR.** Both emitters change: the content translation and the app transform. Generated bindings stay prefixed and are exported by specifier (`export { __z08_tasks as tasks }`), so a helper in the copied 0.8 source named like a table can't collide. Users: `export { __z08Members as members }` in the first PR; in the second, `export const users = wp.users.extend(..., { guests: true })`, because 0.8 gave every visitor a guest identity. What it can't express: a query, mutation or action named like a table, which 0.8 allowed and the registries kept. The table keeps its name (its storage and ledger follow it); the handler is exported as `<name>Query`, `<name>Mutation` or `<name>Action`, and the converted client calls that; if that name is also taken, the publish gets a located refusal and stays on 0.8. A handler named `default` is a located refusal.

    Cost: a converted app with such a collision serves that action at a new path, and a caller outside the converted bundle breaks. Run the census for this collision before the PR merges; if a deployed converted Space has one, this point goes back to the owner.

40. **`userProjection` becomes `wp.users.extend(fields, options)`, and the kind is named `users`.** Stored names do not change, byte for byte: a field is usermeta `first_<field>`, the ladder role is usermeta `first_role`, the profile field key is `field_first_member_<field>`, and `email` and `name` stay `user_email` and `display_name`. Nothing stored may be derived from the kind's name: the profile field group key, today `group_first_<kind name>`, becomes the constant `group_first_members`. `email` and `name` are built in; authoring them is ruling 4's "built in; delete this field" error. The API name changes for apps on the current format: `first.members` and `/__first/api/v1/members` become `first.users` and `/__first/api/v1/users`, webhook events become `users.created` and so on, Abilities become `<app>/users-list` and so on. There is no option that keeps another name: the runtime already answers `/__first/api/v1/users` for an app with a projection, so the new name is live before the old one goes, and an option would be an alias, which the cutover doesn't have. Options: `signIn`, `guests`, `roles`, `mfa` and `organizations` as in spec §2.2, plus `access` with ruling 5's keys; a port keeps its `access` rule and writes `guests: true`, because the runtime turns guests on for every projection today. The projection's entry leaves the migration snapshot (the accepted list below) and that removal emits no SQL. Without an export, the built-in `users` kind is core's users as the facade already serves them.

    Costs: clients of a current-format app that call `members` change to `users` in the same deploy; a constraint authored on `name` or `email` (`max(80)`) is lost; removing a users field leaves its usermeta behind with no deploy warning. Open for the built-ins PR: the default `access` of `users`, and whether a row carries `role` or the spec's `roles`.

41. **A 0.3.0 capture reads every removed form as before.** Under ruling 23's one switch, all the registry keys, `userProjection`, registry keys that differ from the binding name, kinds registered without an export, and per-registry names are read onto the same model. Its users kind keeps the registry key as its name: a deployed Space's `first.members`, `/__first/api/v1/members`, events, Abilities and snapshot entry are unchanged, and `users` keeps answering beside it. Ruling 37's error is off in this mode. The model therefore keeps the users kind's name as data, and only this reading can set it to anything but `users`. `tests/zero_bundle.rs` gains one refusal per removed key and one for `userProjection` in a current project, and its recompile test must still add no migration.

    Cost: the internal registries stay as the model the 0.3.0 reading fills, until `src/zero_bundle.rs` is deleted.

42. **What else changes in the same PRs.** Docs-site tour stops quote example source by text anchors and are updated in the PR that changes their example. The generated config reference's fallback descriptions for the removed keys are deleted with them. `create-first`'s template moves to an export and is released with the compiler; an older `create-first` against a newer compiler scaffolds a project that fails with ruling 36's error on first build, which is accepted. `first add db` already uses exports. `first init`'s text describing `first.config.ts` is rewritten. `docs/config-api.md`, the README, `docs/migrating-from-zero.md` and the MCP connect skill are rewritten for exports; dated design documents are left as they are. Every example's `_generated/db.d.ts` is regenerated in the second PR. In the second PR the schema's `auth.collection` becomes `users` for current-format apps; the host-contract lane confirms nothing on the host is keyed by that value, and the stored names in ruling 40 are the contract. The legacy users suite moves to an export, then to `wp.users.extend`, and must still pass against the same stored usermeta.

    Cost: two releases in a row each change every example and the docs site.

## Stored-schema changes the cutover accepts

The criterion "the authoring rewrite produces no data migration" holds except for exactly these:

- the implicit `author` column on every table, and `createdAt`/`updatedAt` on tables that lacked them
  (existing rows get `author = NULL` and both timestamps set to the time the change applies);
- pantry's `items.tags` default metadata, if it emits no SQL;
- a `slug` entry on blog's `authors`, which maps to the core `post_name` and emits no SQL;
- blog's `members` user projection leaves the snapshot, because users are `wp_users`.

Anything else a port changes in a snapshot fails the criterion.
