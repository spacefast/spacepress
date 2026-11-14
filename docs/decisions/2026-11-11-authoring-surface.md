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

## Taxonomies

Rulings for `taxonomy()` and `terms()` (spec §2.1, §2.4, §2.6, §2.7). They describe what the first PR ships; the deferrals are listed at the end. The list-relation operators (`has`, `[]`, a filter object) are the ones `ref(kind).many()` defines (ruling 3), so the first PR lands after that one.

24. **Storage and registration.** A taxonomy's storage name is its export name in snake_case, or `storageName`, in the same namespace as collections and tables: two kinds can't share one. WordPress limits taxonomy names to 32 characters and First prefixes `first_`, so the storage name is at most 26 characters; longer is a build error that says so.
    - It registers at `init` with `register_taxonomy('first_<name>', <post types>)`, `show_in_rest`, `rest_base` `first_<name>` (served by core at `/wp/v2/first_<name>`, and by First at `/__first/api/v1/<export name>`), `rewrite => false` and `query_var => false`.
    - Fields are term meta under the key `first_<field>`, registered with `register_term_meta` the way post fields are (`auth_callback` false, so core's generic meta path never writes them).
    - The SCF field group is `group_first_<name>` with field keys `field_first_<name>_<field>` and location `taxonomy == first_<name>`.
    - `schema.php` gets a top-level `taxonomies` array, with `'wp' => ['taxonomy' => 'first_<name>', 'groupKey' => …, 'metaPrefix' => 'first_', 'fieldKeyPrefix' => …]`.
    - Terms are read and written by a new term store behind the same query pipeline as every other kind, so `where`, `with`, access rules and field masks behave the same.

    Cost: one more store to keep in step with the post store's meta handling, and six characters of every taxonomy name go to the prefix.

25. **`on` and `terms()` are one attachment, declared from either side.** `on: [posts]` gives each listed kind a field named after the taxonomy's export (`topics`). `terms(topics)` is the same field written out, for when it needs another name or a modifier (`.access()`, `.ui()`, `.reverse()`). Neither needs the other: the taxonomy is registered for the union of its `on` and every kind with a `terms()` field for it.
    - **Name.** Per ruling 1 the field name is the stored name, the relation name and the `with` key. The value is a list of term ids (`number[]`, `[]` when none), and `with: { topics: true }` replaces the ids with term rows.
    - **Storage.** The links are core's `wp_term_relationships` rows. There is no join table and no meta.
    - **Build errors.** A kind in `on` that also has a `terms()` field for that taxonomy keeps the one explicit field. Two `terms()` fields for one taxonomy on one kind is an error, because core keeps one term set per item and taxonomy. An `on` field that collides with an authored field is an error naming both.
    - **Reverse.** Per ruling 2 the reverse relation on the taxonomy is named after the kind's export (`topics.list({ with: { posts: true } })`), `.reverse("name")` renames it, and a reverse named like a term field is an error.
    - **Tables.** `terms()` on a `table()` kind, or a table in `on`, is a build error. `wp_term_relationships.object_id` carries no object type, so a table row and a post with the same id would share term sets, and core's counts and deletes assume posts.
    - **Other refusals.** `terms()` takes a `taxonomy()` export only, takes no `.many()`, `.unique()`, default or `.onDelete()`, and isn't allowed in sub-fields, globals, or action and job inputs.

    Cost: two spellings of one thing, and tables have no way to use a taxonomy in this PR.

26. **Term rows.** A term row is `id` (the `term_id`), `name`, `slug`, `description`, `parent` (hierarchical taxonomies only), `count`, `url` (null without a `url` option), and the authored fields.
    - **Writable:** `name` (required on create), `slug` (derived from the name when absent, unique within the taxonomy as core makes it), `description`, `parent`, and the authored fields under their own `.access()`.
    - **Read-only:** `id`, `count` and `url`.
    - **No `author`, `createdAt` or `updatedAt`.** Ruling 4 already says taxonomies have no author. Core stores no times for a term and First doesn't invent meta for them. The spec's "every kind with rows" line changes to say so.
    - **Reserved names.** An authored field named after any implicit field, or `author`, `createdAt`, `updatedAt`, is a build error.
    - **`count`** is core's stored count: published items across every attached kind, the same for every viewer.
    - **Field builders in the first PR:** `text`, `number`, `integer`, `boolean`, `date`, `timestamp`, `select` (with `.many()`), `email`, `url`, `json`, `media` and a single `ref`.

    Cost: `count` can include items a viewer can't read, and there is no "recently changed terms" query.

27. **Queries.**
    - **On a kind with the field:** `where: { topics: { has: 5 } }` matches items carrying term 5. `where: { topics: { slug: "x" } }` matches items where some term matches the filter. `where: { topics: [] }` matches items with none. `true` and `false` test for any or none.
    - **Hierarchy.** A match is exact: `has` on a parent term doesn't match items that carry only its children.
    - **Order.** `with: { topics: true }` returns the terms in the order they were written, the same rule as a many-ref's `position`. The taxonomy registers with `sort => true` and `args => ['orderby' => 'term_order']`, so core stores and reads that order too. Nested `orderBy`, `where` and `limit` apply per item.
    - **On the taxonomy:** `where` and `orderBy` take the implicit and authored fields. The default order is `name`, then `id`, as core lists terms. `where: { posts: { status: "published" } }` and `with: { posts: true }` use the reverse relation, under the viewer's read rule for that kind.
    - **`terms` is not an `orderBy` key** on the kind that has the field.

    Cost: "everything under this topic" needs the child ids listed by the caller.

28. **Access.** Defaults are the spec's: anyone reads, `editor` creates, updates and deletes. The `access` option takes the same keys and values as any kind (ruling 5).
    - **Capabilities.** `manage_terms`, `edit_terms`, `delete_terms` and `assign_terms` are per-taxonomy primitives (`manage_first_<name>` and so on), answered from the taxonomy's rules in `CoreAccess::mapMetaCap`, never from roles.
    - **Assigning terms** is a write to the item. It needs the item kind's `create` or `update` rule, the `terms` field's own `.access({ write })` if it has one, and read access to each term id sent. It doesn't need write access to the taxonomy. `assign_first_<name>` is granted to anyone whose rule may allow a write to some attached kind, and the item's rule decides the actual save.
    - **Creating terms** always needs the taxonomy's `create` rule. Core lets `assign_terms` create terms in a flat taxonomy, so First refuses in `pre_insert_term` when the rule denies. Through First's API a `terms` field takes ids only; a name never creates a term.

    Cost: an author can't add a tag while writing unless the taxonomy's `create` rule is widened to them.

29. **Hierarchy, URLs and `on`.**
    - **Hierarchy.** `hierarchical: true` registers a hierarchical taxonomy and adds `parent` (a term id of the same taxonomy, or null). Deleting a term moves its children to its parent and removes its links, as core does.
    - **Pattern.** `url` takes `:slug`, `:id` and, on a hierarchical taxonomy, `:path` (the chain of ancestor slugs). Other placeholders are a build error.
    - **Mechanism.** The pattern compiles to one rewrite rule, resolved in the request filter to a term of that taxonomy only. It also drives a `term_link` filter that builds the same URL, and the row's `url` field. Patterns are checked for overlap with every other kind's.
    - **With a `url`** the taxonomy registers as public, so core's sitemap lists its terms and a URL without an `app/` route renders through the template hierarchy. The term's archive lists items of attached kinds that have a `url` of their own, under those kinds' rules.
    - **Without a `url`** the taxonomy is not public and has no archive.
    - **On the item side,** `:topics.slug` in a kind's `url` is the slug of the first term in write order. An item with no term has no URL until it gets one.
    - **`on`** takes the app's collections only, until the `wp.*` built-ins exist. `on: [wp.posts]` then adds the core `post` type and gives `posts` rows the same field.

    Cost: a term's URL can't use its own fields, and a slug or pattern change leaves no redirect yet (see deferrals).

30. **Built-in `categories` and `tags`** stay core's. First registers nothing for them, and the facade keeps routing those two names to core's term routes. `terms(wp.categories)` on an app collection waits for the `wp.*` built-ins. `wp` isn't in the authoring surface yet, and attaching `category` to a First post type means deciding the core taxonomy's access and count behaviour for First kinds, which belongs with that work. Until then a `terms()` argument that isn't a `taxonomy()` export is a build error.

    Cost: an app that wants core's categories on its own collection declares its own taxonomy for now.

31. **Translations and sync.** Neither is built for taxonomies in the first PR, and each refusal is explicit so the later default changes nothing silently.
    - **`locales` set:** a taxonomy must say `translations: false`. It is then one vocabulary shared by every locale, and First keeps it out of Polylang's taxonomy list. Without the option the build fails with "taxonomy translations aren't built yet; add `translations: false`". Ruling 7's default (translated) arrives with term translation groups.
    - **Term set per translation:** each translation of an item has its own term set. `.shared()` on a `terms` field or on a taxonomy's field is a build error for now.
    - **`sync` on a taxonomy** is a build error (the option is for collections and tables).
    - **A synced kind** with a `terms` field, declared or through `on`, is a build error, as a many-ref on a synced kind is.

    Cost: multilingual sites get untranslated term names, and synced content can't be classified yet.

32. **The 0.8 converter emits nothing for taxonomies.** 0.8 had no taxonomy or term construct, and the converter has no match for either. The only taxonomy in the legacy code is `zero_collection`, a hidden storage tag the legacy migration removes when it moves posts to `first_<name>` post types. It is not an authoring construct and its name can't collide with a `first_` taxonomy. Cost: none.

33. **Migrations and the snapshot.** A taxonomy creates no SQL table and no column. Terms, term meta and links live in core's tables.
    - **Snapshot.** Nothing about a taxonomy enters the migration snapshot. A `terms` field is left out of its kind's snapshot columns and adds no join entry. A project without taxonomies produces the same snapshot as before, so existing ledgers gain no migration.
    - **`was` is a build error** in the first PR. A rename has to move `wp_term_taxonomy.taxonomy`, and no post-type or taxonomy rename step exists to extend. The message names the alternative: `storageName` keeps the stored name under a new export, which moves nothing because term meta keys don't contain the taxonomy name.
    - **Removal.** Removing a taxonomy from the schema leaves its terms and links in the database, unregistered. Declaring it again brings them back.

    Cost: removing a taxonomy gives no deploy warning, and changing a stored name isn't possible yet.

**Deferred, each a build error or absent until its own PR:**

- `was` on a taxonomy.
- Term translations and `.shared()` on term data.
- `sync` for kinds with terms (front matter by slug).
- `terms(wp.categories)`, `terms(wp.tags)` and `on: [wp.posts]`.
- Terms on `table()` kinds, and `ref(taxonomy)` from any kind.
- `.min()` and `.max()` on a `terms` field.
- Create-by-name when assigning.
- Matching descendants in `has`.
- Containers, `richText`, `file()`, `ref().many()` and `.unique()` on term fields.
- `.on()` hooks, `abilities` and `search` on a taxonomy.
- Runtime schema changes to taxonomies (build-only for now).
- The automatic 301 when a term's slug or a taxonomy's pattern changes. Core keeps old slugs for posts only, so spec §2.7's promise holds for post kinds until this is built.

## Stored-schema changes the cutover accepts

The criterion "the authoring rewrite produces no data migration" holds except for exactly these:

- the implicit `author` column on every table, and `createdAt`/`updatedAt` on tables that lacked them
  (existing rows get `author = NULL` and both timestamps set to the time the change applies);
- pantry's `items.tags` default metadata, if it emits no SQL;
- a `slug` entry on blog's `authors`, which maps to the core `post_name` and emits no SQL;
- blog's `members` user projection leaves the snapshot, because users are `wp_users`.

Anything else a port changes in a snapshot fails the criterion.
