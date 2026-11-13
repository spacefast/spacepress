# Zero v2 0.3.0 apps, as deployed hosts hold them

The First compiler at commit `61c22fc2` (0.3.0, before the rename to First) produced these files.
Released clients that predate the rename (the `spacefast` CLI and `@spacefast/mcp` 0.9.0) upload
`sources/`; hosts that compiled them keep `compiled/`. Tests read them as frozen data.

Two apps:

- the top level: a small app (`zero.config.ts`, a relative helper) with `.notNull()`, `action()`,
  `db.insert` and `db.query`.
- `forms/`: every authoring form the 0.3.0 compiler accepted, in one app: each field builder and
  modifier (`id()`, `real()`, `text({ enum })`, `select({ options, multiple })`, `group({ fields })`,
  `blocks({ layouts })`, `json().$type<T>()`, `$default`, `$onUpdate`, `.primaryKey()` on text,
  `.references()`, `.localized()`, `.access()`, `.showIf()`, `.ui()`, `.validate()`), collections,
  tables (`storageName`, `existingTable`, `drafts`, `revisions`, `uid`, `sync`, `api`, `agents`), a user
  projection, `defineRelations`, a global, all six hooks, a job with `jobs.<name>.enqueue`, `routes`
  with `route()` (access rule, function rule, `:param`, `*rest`, signature), actions (`idempotent`,
  `agents`, `signature` with both schemes, `once`, `mail`, `db.update`/`db.delete`, `db.globals`),
  webhooks, files, uploads, media sizes, locales, services, `admin`, a plugin package with
  `definePlugin` (hooks, actions, jobs, routes), `wp-hooks/`, `"php/wordpress"` functions and
  abilities, `node:crypto`, `fetch`, a class, a synced Markdown file and `public/`.

- `routes/`: `routes` with `route()` (a literal beside a `:param`, two methods on one path, a
  `*rest`, an access function, a `"zero"` signature). Its `served.json` is what each request
  answered on the 0.3.0 runtime: tests/php/zero_routes.php, renamed to the 0.3.0 names
  (`zero-runtime`, `zero-app-`, `zero-manifest.json`, `\Zero\db()`), run with that checkout's
  tests/php/wp.php on `zero compile-sources sources <dir> sources` (no previous output). The
  0.3.0 harness turns the theme off, so the home page is left out.

In each:

- `app/`: the project and its ledger after `zero build`.
- `sources/`: `zero sources app --out sources` (format `zero.source-bundle.v1`).
- `compiled/`: `snapshot.json`, `manifest.json` and `migrations/` from
  `zero compile-sources sources compiled sources` (the plugin trees are left out). `forms/compiled/`
  also keeps the app plugin's `schema.php` (from `plugins/zero-app-forms/zero/app/`), the schema the
  0.3.0 runtime served.

Regenerate from a detached checkout of `61c22fc2`: `cargo build --bin zero`, then, from the app's
directory (this one, `forms/` or `routes/`), `zero build app` followed by the two commands above, with that
binary. Do not edit these files by hand.

`pages/sources/` is `examples/full-site` of that checkout (TSX pages with their committed
`zero/pages.json`, and `routes`), captured with `zero sources app --out sources`: a bundle that
carries pages, which First refuses.
