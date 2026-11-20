# TypedPress Admin — design and provenance audit

> Superseded in part (2026-11-13): TypedPress Admin now ships with every build, mounted at
> `/wp-admin/new/` inside wp-admin; `admin: false` opts out. See
> [decisions/2026-11-13-default-admin.md](decisions/2026-11-13-default-admin.md) and
> [admin.md](admin.md). The mount, rewrite and harness sections below describe the earlier design.

Status: approved for build (revision 12, 2026-10-31). Extends
`design-phase2.md`; where this document is silent, phase 2 holds. The
licensing and scope decisions in §1 and §9 govern the import PR (§8, PR 2).

The ask: bring Spacefast's earlier WordPress admin work into TypedPress as an
optional plugin that `typedpress build` can ship next to `typedpress-runtime`,
`typedpress-identity` and `typedpress-app-<name>`. It is an admin UI for TypedPress apps on
WordPress. It is not an app frontend and it is not an embed for another
dashboard.

Conventions: "the source" = Spacefast's earlier WordPress admin work, an
admin tree of 1,143 files in a private repository; this document carries
classifications, counts and dispositions. "Kept" = imported and shipped.
"Rewired" = imported, then pointed at TypedPress's schema and APIs. "Dropped" =
not imported. Numbers below are from the audited revision and a throwaway
build of it.

---

## 0. Decisions in one screen

| Area | Decision |
|---|---|
| Plugin | A fourth generated plugin, **`typedpress-admin`**, emitted by `typedpress build` only when `defineConfig({ admin: true })`. No admin by default. |
| Mount | Full-page app at `/typedpress-admin/` (rewrite rule, frontend logged-in session check), plus a wp-admin menu entry "TypedPress" that redirects there. Pretty permalinks required; `typedpress doctor` reports a plain structure. |
| Source of truth | `GET /tp/v1/_schema` describes collections, columns, globals, actions and access summaries. It is public metadata (it always was: the typed client, `typedpress doctor` and MCP read it) and stays so. The admin derives list fields and edit forms from it; what a viewer may *see* is decided by the data endpoints, never by the schema (§5). |
| Data path | Post-backed collections through core `/wp/v2/tp_<table>` (lists, the block editor, SCF fields through the `acf` REST field), which PR #38 puts under TypedPress's access rules. Tables, globals, actions and the schema through `/tp/v1`. Media through `/tp/v1/media` for upload, delete, alt text and focal point; core `/wp/v2/media` only for reads and for the two attachment fields TypedPress has no column for, caption and title (§5.3). Image cropping is dropped. The admin plugin registers **no REST route that reads or writes TypedPress data**. |
| Scope | Collections, media, globals, the block editor, and a "classic admin" escape hatch. Users, themes, plugins, settings, design and taxonomy screens are dropped: they duplicate wp-admin with no TypedPress gain. |
| Content frame | Out of scope. The host-embed contract (`native-*`) is Spacefast-dashboard-specific and is not imported. |
| Where the JS lives | `runtime/admin/apps/` (a self-contained pnpm workspace), built into `runtime/admin/build/` which is **committed** with a source-hash manifest, exactly like `runtime/identity/{apps,build}`. The Rust binary embeds `runtime/admin/` minus `apps/`; TypedPress core never needs Node. |
| Pins | One exact `@wordpress/*` snapshot in one catalog, no `next` dist-tag anywhere. The nightly snapshot stays through the rewire PR; then a dedicated PR moves to the stable releases that match WordPress 7.1's bundled packages, and from then on bumps ride the platform floor in `src/platform.rs`. |
| Provenance | Upstream Gutenberg packages come from npm. Three vendored forks of Gutenberg packages are replaced by npm or kept as a renamed fork (§1.2). The rest is the internal framework the source was vendored from; it is imported only after the licence ruling in §9.1, with every internal name, link, telemetry seam and private endpoint removed (§1.3). |
| Licence | TypedPress is MIT by default and GPL-2.0-or-later only where WordPress forces it (§1.4). The admin plugin runs inside WordPress and bundles GPL Gutenberg packages, so `runtime/admin/` is GPL-2.0-or-later, like `runtime/identity/`. |
| Tests | Real WordPress through the existing harness (`tests/wp/admin.test.ts`), driven by HTTP and WP-CLI with the exact calls the screens make, per role, plus **one** browser acceptance run (Playwright) that boots the shipped modules, opens a collection, edits a field and reloads. Pure JS logic (schema → DataViews fields, menu builder) at unit level in the workspace. |

---

## 1. Provenance audit

### 1.1 What the source is

The source is Spacefast's earlier WordPress admin work: a WordPress admin
application that Spacefast vendored from a no-longer-maintained framework and
then extended with its own glue (the Content frame, kernel endpoints, media
fixes). Spacefast holds the rights to it and distributes it under
GPL-2.0-or-later (§9.1). The tree declares that licence in its root
`package.json`; it carries no upstream `LICENSE` file and no upstream
copyright headers. The only third-party notices in it are the dashicons
licence under `packages/boot` and the headers of two small MIT libraries in a
screen this plan drops.

### 1.2 Classification

Three classes:

- **U — upstream Gutenberg/WordPress.** Published on npm under
  `@wordpress/*`, GPL-2.0-or-later, repository `WordPress/gutenberg`. Safe to
  depend on from npm instead of vendoring.
- **I — internal framework.** The upstream admin framework's own code,
  under two private npm scopes, never published. Importable only under the
  ruling in §9.1. **Forks of class-U packages that add code of their own are
  class I for the added code**, and go through the same ruling.
- **S — Spacefast glue.** Written by Spacefast after vendoring. Spacefast owns
  it; it is either kernel-specific (dropped) or generic (kept).

| Path | Class | Files | What it is | Disposition |
|---|---|---|---|---|
| `@wordpress/*` (96 pinned nightlies in `pnpm-workspace.yaml` overrides) | U | n/a | Gutenberg packages, snapshot `v.202608281122` | npm, pinned (§3.3) |
| one public npm grid-layout package under the framework's scope | U-like | n/a | Published on npm, GPL-2.0-or-later | dropped with the dashboard package |
| `packages/image-cropper` | U fork | 8 | 5 of 8 files byte-identical to `@wordpress/image-cropper` at the same snapshot; the rest add a stylesheet and re-exports | **drop** with the crop editor (§4.2 `attachment`) |
| `packages/global-styles-engine` | U fork | 25 | 7 of 23 source files identical to `@wordpress/global-styles-engine`; the rest are an older cut of the same files | **replace with npm** `@wordpress/global-styles-engine` |
| `packages/views` | U fork + I additions | 13 | Same shape as `@wordpress/views` (use-view, load-view, preference keys) but no file identical; adds a `DataViews` wrapper, tab-filter merging and a stylesheet the routes depend on | keep as renamed fork `@typedpress-admin/views` **under the §9.1 ruling** (the additions are class I); migrate to stable `@wordpress/views` in the pin PR (§3.3) |
| `packages/dataviews` | I | 3 | Re-exports `@wordpress/dataviews/wp` and its stylesheet | keep, rename `@typedpress-admin/dataviews` |
| `packages/schema` | new | — | Not in the source: maps `/_schema` to DataViews fields and form panels (§4.4) | written fresh in PR 5 |
| `packages/<scope>-private-apis` | I | 3 | Wraps `__dangerousOptInToUnstableAPIsOnlyForCoreModules`, presenting itself as `@wordpress/edit-site` | keep, rename `@typedpress-admin/private-apis` (risk: §10) |
| `packages/theme` | I | 5 | Exposes `@wordpress/theme` private APIs as a `ThemeProvider` | keep, rename |
| `packages/admin-toolkit` | I | 45 | `Page`, `RouterLink`, `unlock`, save-dirty-entities, experiments hook | keep, rename, drop the experiments hook |
| `packages/boot` | I + S | 95 | The app shell: router, sidebar, editor host, media modal, stores. 18 of its files are Spacefast's Content-frame glue (`native*.ts`, `content-api.ts`, `host.ts`, `frame-navigation.ts`, `spacefast-skin.scss`, `use-content-sync.ts`, `content-deployment.tsx`, `use-spacefast-links.ts`, `content-icons.ts`, `native-media-blocks.tsx`, `abilities/navigate.ts`) | keep the shell, rename; delete the frame glue, the AI-agent slot and the `navigate` ability |
| `packages/core-data-next` | I | 14 | Store for "field collections" (server-registered DataViews fields) and view configs | keep, rename |
| `packages/fields-next` | I | 11 | Post, media, term and theme field hooks over Gutenberg's private `usePostFields` | keep post + media hooks, rename; drop term/theme |
| `packages/lazy-editor`, `packages/load-assets` | I | 13 | Loads editor settings and assets from `wp/v2/editor/{settings,assets}` | keep, rename (a public `@wordpress/lazy-editor` 2.0.0 now exists; evaluate in the pin PR) |
| `packages/attachment-importer` | I | 2 | Upload helper for the media library | keep, rename |
| `packages/post-importer` | I | 2 | Unused (no importer anywhere in the tree) | drop |
| `packages/dashboard` + `dashboard-widgets/*` | I | 49 | Widget dashboard with drag-and-drop layout; the weather widget is a stub with hard-coded data | drop (the landing page is the collections overview, §4) |
| `packages/design-system` | I | 294 | Component library. Its own README marks it deprecated in favour of `@wordpress/ui` and links an internal storybook, an internal P2 and an internal tracker | keep, rename, scrub README; migrate to `@wordpress/ui` later (§8, after PR 7) |
| `packages/ai-agent` | I | 13 | Chat panel driven by a `window` global that an internal AI plugin exposes; README links an internal host and a hosted-platform endpoint | **drop** |
| `packages/user-data` | I | 9 | User-invite store calling `/wp/v2/users/invite`, an endpoint no file in the tree defines (WordPress.com-only) | **drop** |
| `packages/telemetry` | S | 2 | Inert no-op shim, GPL-2.0-or-later, written by Spacefast | drop the package and its 24 import sites (they are all no-ops) |
| `packages/wp-build` | I | 10 | esbuild-based build: externalises `wp-*` classic scripts and `@wordpress/*` script modules, bundles the rest, emits `index.asset.php` per module and `build/index.php` | keep, rename `@typedpress-admin/wp-build` |
| `routes/*` (33) | I + S | 338 | Screens; see §4 | per §4 |
| `fields/*` (7) | I | 144 | Server-registered DataViews fields for users, media, themes, posts, plugins, terms, comments | keep media + post; drop the rest |
| `lib/**` (26 PHP files) | I + S | 26 | Registration APIs, REST controllers, menu, i18n, legacy iframe bridge | per §4.3 |
| the source's plugin entry file | I + S | 1 | Plugin entry | rewritten as `typedpress-admin.php` |
| `types/*.d.ts` | I | 9 | Ambient typings for private APIs | keep what kept code needs |
| Spacefast-side `native-*.ts`, the mu-plugin loader and the build script | S | 7 | Content-frame contract, transport, mu-plugin loader, monorepo build | **not imported** |

Size, from a throwaway build of the full tree: 83 JS modules, 7.2 MB before
compression (2.1 MB of it is the bundled `@wordpress/dataviews`, 0.6 MB the
dropped design screens, 0.5 MB the dropped user/term/theme/plugin screens).
Warm `pnpm install --frozen-lockfile` 4 s, `wp-build build` 4 s, output
byte-identical across two builds. `node_modules` is 515 MB.

### 1.3 Internal references: inventory and disposition

Counted over the tree excluding `pnpm-lock.yaml`, described by kind.

| Reference kind | Where | Count | Disposition |
|---|---|---|---|
| The framework's private npm scope on its workspace packages | every `package.json` and import | ~640 | rename to `@typedpress-admin/<pkg>` (mechanical) |
| One public npm package under that scope (a grid layout library) | dashboard | 10 | gone with the dashboard package |
| Two packages of an internal AI-agent client library | ai-agent README | 3 | gone with ai-agent |
| A second private scope on the DataViews wrapper | imports | 171 | rename to `@typedpress-admin/dataviews` |
| The inert telemetry shim's scope | 24 route/package imports | 24 | delete imports and call sites (all no-ops) |
| The framework's product name | PHP docblocks, READMEs, comments, one Abilities category + ability name | ~180 | rewrite docblocks; delete the ability with the frame glue |
| Filters that silence an internal AI plugin's agent | plugin entry, editor REST controller | 3 | delete |
| A `window` global exposed by that plugin | ai-agent | 4 | gone with ai-agent |
| Internal hosts: a source forge, a CI server, an internal blog, an issue tracker | READMEs, one SCSS comment | 6 | delete |
| One hosted-platform AI endpoint URL | ai-agent README | 1 | gone with ai-agent |
| A hosted-platform user-invite endpoint and a comment naming its connection plugin | user-data, routes/user | 4 | gone with user-data and the user screens |
| Spacefast's own kernel REST namespace (six routes) | boot `content-api.ts`, routes collection-*, content-*, redirects | 9 | gone with the kernel-bound screens (§4) |
| Spacefast's host-skin and frame identifiers | boot | ~60 | gone with the frame glue |
| One CSS hook for a hosted-platform plugin's logo | boot `legacy-admin-ui-bridge.scss` | 1 | delete the rule |
| The framework's text domain, function/filter prefix, class prefix and constant prefix | all PHP | hundreds | rename to `typedpress-admin` / `tp_admin_*` / `TypedPress_Admin_*` / `TP_ADMIN_*` |
| `window.__experimentalDataViewsMediaModal`, `GUTENBERG_VERSION` | `lib/pages/admin.php` | 2 | keep (public Gutenberg flags) |

**Notices.** The scrub removes product names from prose and identifiers; it
never touches a third-party licence notice (the dashicons `LICENSE.md`, the
licence headers of bundled npm packages, the generated
`THIRD-PARTY-LICENSES.txt`). The source carries no upstream copyright notice
of its own, so the plugin's `NOTICE` states Spacefast's copyright and the
GPL-2.0-or-later licence and credits "Spacefast's earlier WordPress admin
work"; the framework's product name is an identifier, not a notice, and does
not appear (§9.5 gives the same disposition for the identity plugin).

Telemetry: there is no live transport anywhere in the tree. The only
telemetry code is the inert shim, and the dashboard-widget "tracking" hooks
that call it. Nothing phones home. After the cleanup there is no telemetry
seam at all; if TypedPress ever wants product analytics it is a new decision.

Private APIs: the private-apis package and `admin-toolkit` unlock
Gutenberg's private APIs (`@wordpress/route`, `core-data`, `editor`,
`global-styles-engine`, `theme`) by opting in as `@wordpress/edit-site`. 65
files use `unlock(...)`. This is how the upstream framework worked and it is
load-bearing for routing and DataViews. It is kept, renamed and pinned (§3.3,
§10).

The identity plugin carries the same kind of Spacefast-authored source credit
in `runtime/identity/NOTICE` and one adapted file under
`runtime/identity/apps/admin/src/`; §9.5 gives both plugins one disposition:
those lines read `Copyright (c) 2026 Spacefast`, GPL-2.0-or-later, "adapted
from Spacefast's earlier WordPress admin work"; third-party notices stay
verbatim.

### 1.4 Licensing

- **TypedPress.** TypedPress is licensed **by component** (§9.2): anything that runs
  inside WordPress is GPL-2.0-or-later (WordPress plugins are derivative works
  of WordPress); everything else, the Rust compiler and CLI, the typed client,
  the type declarations, examples, docs, scripts and tests, is MIT. The
  top-level `LICENSE` stating this, with `LICENSE-GPL` and `LICENSE-MIT`,
  lands with the README PR; the admin adds one line to its GPL list.
- **The admin plugin is on the GPL side.** `runtime/admin/` (the PHP, the
  workspace and the committed build) is GPL-2.0-or-later, like
  `runtime/identity/`: it runs only inside WordPress, it bundles
  GPL-2.0-or-later Gutenberg packages (`dataviews`, `fields`, `ui`, `icons`)
  into its modules, and the source it is ported from is declared GPL. The
  fresh code this plan writes (`@typedpress-admin/schema`, the menu builder, the
  browser journey) is GPL too; splitting MIT files into a GPL bundle would
  buy nothing and complicate the notice. Every workspace `package.json`
  carries `"license": "GPL-2.0-or-later"`, `runtime/admin/LICENSE` is the
  GPL text, and the plugin header says the same.
- **Gutenberg packages.** `@wordpress/*` on npm are GPL-2.0-or-later
  (Gutenberg itself is dual-licensed GPL-2.0-or-later / MPL-2.0). Compatible
  with TypedPress's PHP licence; the admin plugin is GPL-2.0-or-later like the other
  three plugins.
- **The source.** Spacefast holds the rights to the vendored admin work and
  distributes it under GPL-2.0-or-later (§9.1), so class I, including the
  additions inside the `views` fork, is imported under that licence. The
  `NOTICE` file in PR 2 follows §1.3.
- **Third-party in the tree.** `routes/design-styles/.../lib/{lib-font,inflate,unbrotli}.js`
  (MIT, Pomax; zlib/brotli ports) are dropped with the design screens.
  `packages/boot/src/dashicons` (GPL-2.0-or-later, with its own LICENSE.md)
  is kept. Everything else pulled from npm is covered by the
  `THIRD-PARTY-LICENSES.txt` the build will emit, as the identity build does.

### 1.5 What the audit did not find

No credentials, no tokens, no internal hostnames in code paths (only in
READMEs and one SCSS comment), no network calls to anything but the site's
own REST root, and no PHP that talks to the content kernel except through
Spacefast's own kernel REST namespace listed above (whose server side stays
in Spacefast's repository and is not imported).

---

## 2. Target shape

### 2.1 The plugin

```
tp/dist/wp-content/plugins/typedpress-admin/
  typedpress-admin.php          header below; rewrite rule, menu entry, page render, module registration
  lib/                    registration APIs, kept REST controllers, menu builder, i18n, legacy bridge
  build/                  committed JS/CSS modules + index.php + THIRD-PARTY-LICENSES.txt + .manifest.json
  LICENSE                 GPL-2.0-or-later
  readme.txt
```

```
Plugin Name:       TypedPress Admin
Version:           {{tpVersion}}
Requires at least: 7.1
Requires PHP:      8.2
Requires Plugins:  typedpress-runtime
License:           GPL-2.0-or-later
```

`typedpress-admin` is versioned with the binary like `typedpress-runtime` and
`typedpress-identity`. It is not in any other plugin's `Requires Plugins`: it is
optional. On `plugins_loaded` it checks `\TypedPress\Wp\Runtime::plugin()`; with no
registered app it shows one admin notice and registers nothing. It reads the
app's schema through `Runtime::plugin()->schema->describe()` for the server
side (menu, preload) and through `GET /tp/v1/_schema` for the client side.

### 2.2 Opt-in

```ts
export default defineConfig({ name: "blog", admin: true, /* … */ });
```

`admin?: boolean` on `ConfigInput` (default `false`), key `'admin'` in
schema.php v3, accepted by `src/extract.rs`'s config allowlist. `typedpress build`
emits `plugins/typedpress-admin` and lists it in `typedpress-manifest.json` only when the
flag is true; a build that turns the flag off deletes the directory like any
other `typedpress-*` output. There is no CLI flag: the artifact is a function of the
config. The plugin runs only inside WordPress, so the flag has no meaning
elsewhere.

Why opt-in and not always: the plugin is several megabytes of JS, it asks the
site for pretty permalinks, and a headless, API-first TypedPress app has no one
to sit in it. Why a config key and not a separate command: §2.1 of
phase 2 makes the wp-content artifact one build with one manifest, and
`typedpress doctor` can then check what the manifest promised.

### 2.3 Rust changes (the whole `src/` footprint)

- `src/extract.rs`: `"admin"` in the config allowlist; `schema.admin: bool`.
- `src/schema.rs`, `src/schema_php.rs`: the field and its `'admin' => true|false` emission.
- `src/commands/build.rs::emit_generated`: when `schema.admin`, copy every
  embedded file under `admin/` to `plugins/typedpress-admin/` and substitute the
  header; `emit_wp_content` adds the slug to the versions map (and to
  `php_lint_tree` + `zip_plugin`) only in that case.
- `types/typedpress/index.d.ts`: `admin?: boolean` with a one-line doc.
- `build.rs`: nothing. It already skips `apps`, `node_modules` and dotfiles,
  so `runtime/admin/apps/` never enters the binary and `runtime/admin/build/`
  does.

Nothing else in `src/` changes except one `typedpress doctor` row, delivered in
PR 6 (§8). The admin plugin contributes an object to `GET /_schema` through
the runtime's `Extensions::schemaDescribe` seam (so the runtime never learns
about the admin):

```
runtime.wp.admin = {
  version: "<plugin version>",
  permalinks: bool,     // get_option('permalink_structure') !== ''
  rewrite: bool,        // the /typedpress-admin/ regex is present in the persisted rewrite_rules option
}
```

Absent key = plugin inactive. `src/commands/doctor.rs` reads it and, when
the manifest lists `typedpress-admin`, prints one row:

| state | result |
|---|---|
| key absent | ✗ "typedpress-admin is not active" |
| `permalinks: false` | ✗ "plain permalinks: /typedpress-admin/ needs a permalink structure" |
| `rewrite: false` | ✗ "rewrite rule not persisted: deactivate and reactivate typedpress-admin" |
| site WordPress minor above the floor | ✗ "WordPress <version> is newer than the tested 7.1.x" (§3.3 step 3b). `doctor` has no warning level: any ✗ makes `ok` false and exits 1, and this row is no exception; a site on a newer WordPress is outside the admin's supported range until the floor moves |
| all true | doctor then sends one anonymous `GET /typedpress-admin/` with redirects disabled; a 302 whose `Location` is the site's `wp-login.php` is ✓ (the route resolves and the frontend logged-in session check fired), anything else is ✗ with the status |

That probe is the only new request `doctor` makes; it reuses the HTTP client
`doctor.rs` already has for `/_schema`.

### 2.4 Mount and boot

`/typedpress-admin/` and everything under it is served by the plugin (rewrite rule
to `index.php?tp_admin=1`, the frontend logged-in session check, then the page template). The
page:

1. runs `set_current_screen()` and `do_action('tp_admin_init')` so the menu
   and routes register;
2. preloads `/wp/v2/types`, `/wp/v2/users/me`, `/wp/v2/settings`, `/tp/v1/_schema`
   and `/tp/v1/me` through `rest_preload_api_request` so the first paint
   needs no round trip;
3. registers `@typedpress-admin/boot` as a script module with every route, field and
   init module as a dependency, and boots it with the routes, menu items and
   schema-derived context as JSON.

The wp-admin side keeps one top-level menu entry "TypedPress" (capability `read`)
that redirects to `/typedpress-admin/`. The existing `/wp-admin/new` alias is not
kept.

Rewrite lifecycle. One function, `tp_admin_add_rewrite_rule()`, adds the
rule; it is called from `init` on every request (so `wp rewrite flush` and
any site-side regeneration include it). Activation runs after `init` has
already fired for that request, so the activation hook calls the function
itself and then `flush_rewrite_rules()`: register, then persist. Deactivation
runs with the rule already registered in that request, so the hook first
removes it from `$wp_rewrite->extra_rules_top` (`remove_rewrite_rule` does
not exist in core; the key is the regex) and then flushes, so the persisted
`rewrite_rules` option no longer contains it. A one-shot `admin_init` check
keyed on an option `tp_admin_rewrite` holding the plugin version covers
file-copy updates where no activation hook runs (the runtime's
`tp_runtime_tables` pattern); it also calls the function before flushing.
The harness activates the plugin **after** `wp rewrite structure` has already
generated rules, which is the ordering a real site has. The activation test
asserts the route answers on the very next request without a manual flush,
and the deactivation test asserts that the persisted `rewrite_rules` option
no longer contains the regex (read through WP-CLI), not just that the URL is
404.

### 2.5 Harness

`tests/wp/harness.sh up` activates `typedpress-admin` after `typedpress-app-<name>` when
the manifest lists it (same rule as `typedpress-identity`). The test app
(`tests/wp/app/typedpress.config.ts`) sets `admin: true`; `examples/blog` does not,
so the example keeps proving the opt-out path.

---

## 3. JS workspace, build and CI

### 3.1 Layout

```
runtime/admin/
  typedpress-admin.php  lib/  LICENSE  readme.txt            the plugin's PHP (embedded, emitted)
  build/                                               committed build output (embedded, emitted)
    index.php  packages/<name>/index.{js,asset.php}  routes/<name>/...  fields/<name>/...
    THIRD-PARTY-LICENSES.txt  .manifest.json
  apps/                                                the pnpm workspace (never embedded)
    package.json  pnpm-workspace.yaml  pnpm-lock.yaml  tsconfig*.json  .npmrc
    packages/*  routes/*  fields/*  types/*
```

The workspace is self-contained: its own lockfile, its own catalog, no link to
`runtime/identity/apps`. The two workspaces share nothing but a Node version;
merging them is not worth coupling identity's small esbuild app to a 500 MB
`node_modules`.

### 3.2 Build

`cd runtime/admin/apps && pnpm install --frozen-lockfile && pnpm build`
writes `../build`. The build is the vendored `wp-build` (esbuild + sass +
lightningcss), which already produces byte-identical output for identical
inputs. Two additions, both copied from `runtime/identity/apps/build.mjs`:

- `build/.manifest.json` with `sources` = sha256 over every file under
  `apps/` except `node_modules`, so a drift check can tell a stale build;
- `build/THIRD-PARTY-LICENSES.txt` from the esbuild metafile, **plus every
  notice that lives in the workspace itself** (today: the dashicons
  `LICENSE.md` under the boot package; tomorrow: any file the §9.1 ruling
  requires). Identity's generator only walks `node_modules` inputs, so the
  admin's build script also appends each `LICENSE*`/`NOTICE*` file found under
  `apps/packages/**` and `apps/routes/**` (excluding `node_modules`) with its
  path as the heading. `build/` is what `build.rs` embeds and `typedpress build`
  emits, so that one file is the complete notice bundle of the shipped plugin.
  The drift suite checks that the bundle names every such workspace notice
  (one assertion over the committed file against a glob of the sources).

What is bundled and what is external is decided by `wp-build`'s rule, which is
the right one for a WordPress plugin: classic `@wordpress/<x>` packages that
WordPress ships as `wp-<x>` scripts are externals (components, core-data,
editor, block-editor, data, element, …), `@wordpress/<x>` script modules that
core registers (`route`, `a11y`, `abilities`, `interactivity`) are module
externals, and everything else is bundled (dataviews, fields, ui, icons,
interface, global-styles-engine, the workspace packages). WordPress 7.1 ships
React 18.3.1, which is what the snapshot pins.

### 3.3 Pinning policy

The source pins 96 `@wordpress/*` packages to one nightly snapshot
(`-next.v.202608281122.0`) through `pnpm.overrides`, because the upstream
framework ran ahead of Gutenberg releases. That is a long-term risk: nightlies
are not curated, the `next` dist-tag moves, and nothing ties the snapshot to
the WordPress version the plugin runs on.

Policy:

1. **One place.** Every `@wordpress/*` version is set once, in the workspace
   catalog; every package.json says `catalog:`. The `next` dist-tag appears
   nowhere (the source's route packages still say `"next"`, resolved by the
   overrides; that is removed in the import PR). `pnpm install
   --frozen-lockfile` everywhere, including CI.
2. **Snapshot now, stable next.** The import, build and rewire PRs keep the
   audited snapshot so behaviour stays provable against the source. The first
   PR after rewire (§8, PR 7) moves every pin to the stable release line that
   matches WordPress 7.1's bundled Gutenberg (stable `@wordpress/dataviews`
   21, `route` 0.24, `ui` 0.25, `fields` 0.50, `views` 3, `boot` 0.25,
   `lazy-editor` 2 exist on npm as of this audit). That PR also retires the
   vendored forks that the stable packages make redundant (`views`, possibly
   `lazy-editor`).
3. **Bumps ride the platform floor.** After that, `@wordpress/*` is bumped
   only together with the WordPress floor in `src/platform.rs` and the
   harness image, in one PR that rebuilds `build/` and passes the WP suite.
   The externals come from the running WordPress, so a pin that drifts from
   the floor is a type-level lie; keeping them in lockstep is the whole
   policy.
3b. **Supported range is the floor's minor series.** The plugin header says
   `Requires at least: 7.1` and `Tested up to: 7.1`; `typedpress doctor --site`
   fails (✗, exit 1) on a newer major/minor (§2.3). The externals and private APIs are proven
   only on the pinned floor (the harness image), so the honest claim is "runs
   on 7.1.x"; a newer WordPress is supported when the floor moves to it. This
   is tighter than the runtime's own floor policy on purpose: the runtime
   calls public PHP APIs, the admin consumes unstable JS ones.
4. **No floating ranges.** Non-WordPress dependencies (`react`, `clsx`,
   `dequal`, `esbuild`, `sass-embedded`, …) are exact in the catalog too.

### 3.4 CI

A new `admin` job in `.github/workflows/ci.yml`, independent of the Rust and
PHP jobs:

```
setup-node 22; corepack enable                    # pnpm version from runtime/admin/apps/package.json packageManager
# working-directory: runtime/admin/apps
pnpm install --frozen-lockfile
pnpm typecheck                                    # tsc -b
pnpm test                                         # jest, @wordpress/jest-preset-default (the preset the source's tests were written for)
pnpm build
# working-directory: repository root, so the pathspecs mean what they say:
git diff --exit-code -- runtime/admin/build
test -z "$(git ls-files --others --exclude-standard -- runtime/admin/build)"
```

The build runs in the CI container and the diff check is the arbiter of
"reproducible": `wp-build` uses native `sass-embedded` and `lightningcss`
binaries, and the throwaway build only proved byte-identity on one Linux
machine. Until a macOS rebuild has been shown identical, the rule is that
`build/` is regenerated on Linux (CI or a container) and a PR whose
`build/` differs from CI's is fixed by taking CI's output, not by relaxing the
check.

Plus one line in `tests/php/vendor_drift.php`: the admin build's
`.manifest.json` `sources` must equal the digest of `runtime/admin/apps` (the
same check identity has), so a stale commit fails `tests/php/run.sh` without
Node.

The `wp` job runs the HTTP suite unchanged: `tests/wp/run.sh` builds the test
app with `admin: true` and `tests/wp/admin.test.ts` runs under `node --test`
with the others.

The browser journey (§7) runs **inside `run.sh`**, after the `node --test`
suites and before tear-down, against the same stack. It is not a separate
workflow step; the `wp` job gains pnpm and the two install lines before
invoking `run.sh`, and its cache key gains the workspace lockfile. The
workflow today has no pnpm (identity's screens are prebuilt and committed),
so both the `admin` job and the `wp` job enable it the same way:

```
corepack enable                                   # Node 22 ships Corepack; the version comes from packageManager
# working-directory: runtime/admin/apps  (Corepack reads packageManager from the cwd, not from --dir)
pnpm install --frozen-lockfile                    # Playwright is a devDependency of the workspace
pnpm exec playwright install --with-deps chromium
# working-directory: repository root
tests/wp/run.sh
```

Every pnpm invocation in CI runs with `working-directory: runtime/admin/apps`
(the `admin` job's install, typecheck, test and build steps too; only the
`git diff` checks and `run.sh` run from the root). `pnpm --dir` is not used:
Corepack resolves the pinned version from the current directory's
`package.json`, so a root-level invocation would pick an unpinned fallback.
`runtime/admin/apps/package.json` carries `"packageManager": "pnpm@<exact>"`,
as the identity workspace already does.

Inside `run.sh`, the step is one command run from the repository root:

```
runtime/admin/apps/node_modules/.bin/playwright test --config runtime/admin/apps/wp-journey/playwright.config.ts
```

Both the config and the spec live **inside the workspace**, under
`runtime/admin/apps/wp-journey/` (`playwright.config.ts`, `admin.spec.ts`),
because a spec's imports resolve from the spec's own location: a spec under
`tests/wp/` cannot see the workspace's `node_modules`, and the repository
root has none. The spec reads the harness receipt by absolute path derived
from `import.meta.url` (`../../../../tests/wp/.harness.json`), the same data
`env.ts` reads, so it is independent of the working directory. Nothing under
`tests/wp/` changes except `run.sh`, and the `node --test` glob there never
sees the spec. `wp-journey/` is part of the `sources` digest like every other workspace
file (the digest excludes only `node_modules`, exactly as identity's
generator and the PHP drift checker do, so the two implementations agree);
it produces nothing under `build/` because `wp-build` only builds
`packages/`, `routes/` and `fields/`, and `build.rs` never embeds `apps/`
anyway. `run.sh` runs the step when the workspace's Playwright binary
exists and otherwise prints "browser journey skipped: run `cd runtime/admin/apps &&
pnpm install --frozen-lockfile`" and exits non-zero, so a local run without the
workspace is an explicit failure, never a silent pass;
`TP_WP_SKIP_BROWSER=1` turns that into a skip for people iterating on PHP
only.

Node is a dev dependency of this repository already (`runtime/identity/apps`,
`tests/wp/*.test.ts`); the admin adds pnpm, pinned through `packageManager`.

---

## 4. Screens: keep, drop, rewire

### 4.1 What a screen must satisfy to be kept

Keep if it (a) works on TypedPress's model (CPT + SCF, `/_schema`, `/tp/v1`) or
can be rewired to it, and (b) adds something plain wp-admin does not have for
a TypedPress app. Drop if it duplicates wp-admin with no TypedPress gain, depends on the
the content kernel TypedPress replaces, or is host-specific.

### 4.2 Routes

| Route | URL(s) | Data today | Decision | Why / how |
|---|---|---|---|---|
| `dashboard` + `dashboard-widgets/*` | `/` | widget layout in user meta; widgets fetch nothing real | **drop**; `/` becomes the collections overview | the overview is what a TypedPress editor opens the admin for; the widget system is 240 KB plus PHP for a weather stub and "recent posts" |
| `collection-index` | `/collections` | kernel bootstrap | **rewire** → `/` | tiles per collection from `/_schema`, filtered server-side to what the viewer may read (§5) |
| `collection-list` | `/collections/$collection` | kernel bootstrap + core `/wp/v2/<type>` | **rewire** (replaces `post-list` for TypedPress types) | DataViews over core `/wp/v2/tp_<table>` for post-backed collections; fields from `/_schema` columns (title/content/slug/status/publishedAt as core fields, every SCF column through `acf`); `table()` definitions over `/tp/v1/<c>` with the same field mapping |
| `collection-new` | `/collections/$collection/-/new` | kernel + core POST | **rewire** | `POST /wp/v2/tp_<table>` (post-backed) or `POST /tp/v1/<c>` (tables); required columns from `/_schema` |
| `collection-edit` | `/collections/$collection/$slug` | kernel resolve + sync + field editor | **rewire** | by id, not slug; the block editor for `content` collections with a "Fields" sidebar panel rendered from `/_schema` columns and written through the `acf` REST field; a plain form for collections without `content`; `showIf` evaluated client-side from the sibling values; table rows use the plain form over `/tp/v1` |
| `post-list` | `/types/$type/list/$slug` | core `/wp/v2/<type>` + field collections | **keep for `attachment` only** (the media library); the generic post-type list is not exposed for TypedPress types | its DataViews/actions/quick-edit code is the base the collection list is built on |
| `post-list-redirect`, `post`, `post-edit`, `post-new` | `/types/$type[...]` | core | **keep** the editor host (`boot/components/editor`), **drop** the public `/types/*` routes | the editor is reached through `/collections/...` only |
| `attachment` | `/types/attachment/edit/$id` → `/media/$id` | core `/wp/v2/media`, image cropper | **keep** the details screen, re-path, mutations rewired; **drop the cropper** | the list reads core `/wp/v2/media`; the details screen reads **both** `GET /wp/v2/media/{id}` (caption, title, dimensions, sizes WordPress knows) and `GET /tp/v1/media/{id}` (`alt`, `focal`, TypedPress's `sizes`), because core REST does not expose TypedPress's focal meta. **Upload, delete, alt text and focal point go through `/tp/v1/media`** so TypedPress's fixed media rules (`create: author`, `update: editor`, `delete: editor`) and reference cleanup apply; caption and title, which TypedPress has no column or rule for, stay on core (§5.3). The crop/rotate editor rewrites the file through core's `/wp/v2/media/{id}/edit` with WordPress capabilities and would bypass TypedPress's `update` rule, so it goes; a focal-point picker over `PATCH /tp/v1/media/{id}` replaces it (the runtime regenerates `cover` sizes from `focal`) |
| `term-list`, `term-add`, `term-edit` | `/types/$type/taxonomies/$tax[...]` | core terms | **drop** | TypedPress has no taxonomies |
| `user-list`, `user-add`, `user-profile`, `user`, `profile` | `/users[...]`, `/profile` | core users + WordPress.com invites | **drop** | duplicates wp-admin; the invite flow is WordPress.com-only; `/tp/v1/me` covers "who am I" |
| `plugin-list`, `plugin` | `/plugins[...]` | core plugins + overrides | **drop** | duplicates wp-admin |
| `theme-list` | `/design/themes` | core themes + overrides | **drop** | duplicates wp-admin; themes are the TypedPress Blocks lane's area |
| `design-styles` | `/design/styles` | global styles entity | **drop** | 600 KB; the site editor does this; TypedPress Blocks owns block themes |
| `design-navigation`, `-list`, `-edit` | `/design/navigation[...]` | `wp_navigation` posts | **drop** | duplicates the site editor |
| `settings`, `settings-general`, `settings-reading` | `/settings[...]` | `root/site` | **drop** | duplicates wp-admin |
| `settings-experiments` | `/settings/experiments` | preferences | **drop** | no experiments remain |
| `content-activity`, `content-settings`, `redirects` | `/content/...`, `/redirects` | Spacefast's kernel REST namespace | **drop** | Spacefast's content kernel, which TypedPress replaces |
| `legacy-admin` (now `classic-admin`, `/classic/$slug`; see decisions/2026-11-13-default-admin.md) | `/legacy/$slug` | iframes a wp-admin page | **keep** | the escape hatch: "Classic admin" and media settings open here; 3 files. **Not** used for globals (their SCF options pages are governed by WordPress capabilities, not TypedPress's global rules; §5.3) |
| new: `globals` | `/globals/$name` | `/tp/v1/globals/<g>` | **new** (PR 5, not 6) | one form per global rendered from `/_schema` fields; `GET`/`PATCH /tp/v1/globals/<g>`; the menu lists a global only when `GET` succeeds for the viewer |
| new: `actions` | `/actions` | `/tp/v1/_schema`, `POST /tp/v1/actions/<a>` | **new, optional** (PR 6 if small) | a form per action from its `input` columns. Visibility: an action whose access summary is a role or `anyone`/`authenticated` is shown only when the viewer meets it; an action summarised as `"rule"` (a function) is always shown, because only the submission can decide, and its 401/403 is displayed inline. The response is printed as JSON |

### 4.3 PHP (`lib/`)

| File | Decision | Why |
|---|---|---|
| `api/routes.php`, `api/menu-items.php`, `api/init-modules.php`, `api/field-collections.php`, `api/view-config.php` | keep, rename | registration APIs the kept screens use |
| `api/dashboard-layout.php`, `-widgets.php`, `-context.php` | drop | dashboard |
| `rest-api/class-…-editor-controller.php` (`wp/v2/editor/{settings,assets}`) | keep, strip the internal filter | the in-app block editor needs editor settings and the assets list; it reads no TypedPress data |
| `rest-api/class-…-field-collections-controller.php`, `-view-config-controller.php` | keep | serve server-registered DataViews fields and view configs for media; read no TypedPress data |
| `rest-api/class-…-attachments-controller.php` | keep | mime-type ordering for the media library |
| `rest-api/core-rest-api-overrides.php` | trim to: auto-draft status in REST, comment-count field; drop user search, theme update/auto-update fields | only what kept screens use |
| `rest-api/class-…-themes-controller.php`, `-plugins-controller.php`, `plugins-rest-api-overrides.php`, `class-…-resolved-template-controller.php` | drop | dropped screens |
| `post.php` | trim: default view args, duplicate-post support; drop `wp_template` enabling | |
| `taxonomies.php`, `taxonomy-hierarchy.php` | drop | no taxonomies |
| `i18n.php` | keep | translations for script modules (uses reflection on `WP_Script_Modules`; §10) |
| `legacy-route.php` | keep | the iframe bridge |
| the default-menu file | rewrite as `menu.php` | the menu is: Collections (one entry per collection the viewer may read, §5.1), Media, Globals (one per global the viewer may read), Actions (if any), Classic admin |
| `site-preview.php` | drop | front-end preview |
| `pages/admin.php` | keep, trim | the page template (§2.4) |

### 4.4 Fields (`fields/`)

Keep `core-media-fields` and `core-post-fields` (they extend DataViews for
attachments and the editor's core columns). Drop user, theme, plugin, term and
comment fields with their screens. First columns do not use the field-collection
mechanism at all: they are derived client-side from `/_schema` by the new
`@typedpress-admin/schema` package (column kind → DataViews field type, `enum` →
elements, `media` → thumbnail, `access.read` summary → hidden-by-default, and
`showIf` → the panel's visibility rule). That package is pure and unit-tested.

---

## 5. Access: the admin never bypasses TypedPress

Rules, in order of where they are enforced:

1. **Server-side menu and overview.** The page builds the menu from the
   schema and, per collection, asks whether the viewer's `read` rule *may
   allow anything*: `Access::evaluate(rule, viewer, 'read') !== false`, or
   the rule is a function (which can only be answered per row). That is the
   same "could the rule allow anything" test PR #38's `CoreAccess` uses for
   type-wide capabilities; it is exposed by the runtime as one static method
   (`CoreAccess::mayRead($collection, $viewer)`, a one-line public wrapper
   over the existing private helper, added in PR 5 and the only runtime edit
   this plan makes). A collection whose rule denies outright has no menu
   entry and no tile; a filtered or function rule gets an entry, and the list
   may then be empty. This is a courtesy for navigation, not the guard. The
   schema itself stays public (§0): the boot payload carries the full
   `/_schema` like every other client of it, and nothing in it is secret
   (names, kinds and access *summaries*, not data).
2. **The guard is the API.** Post-backed collections are read and written
   through core `/wp/v2/tp_<table>`, which PR #38 puts under TypedPress's
   collection and field rules (`CoreAccess::mapMetaCap`, `PostsController`,
   `FieldAccess::checkWrite`; SCF fields are exposed on that route through
   SCF's `acf` REST field, which `show_in_rest` on the field groups already
   enables, and refusals are core 401/403 responses carrying TypedPress's `code`
   and `data.pointer`). Tables, globals, actions and media mutations go
   through `/tp/v1`, which has always applied them. The admin plugin
   registers no route of its own that touches TypedPress data, and its PHP calls
   nothing in `Db`.
3. **Where WordPress rules apply instead, say so.** Two surfaces are
   governed by WordPress capabilities, not TypedPress rules, and the admin does not
   pretend otherwise:
   - **Attachment caption and title** are edited through core `/wp/v2/media`,
     whose `edit_post` capability on attachments is WordPress's. TypedPress's media
     row has no caption or title column and no rule about them. Everything
     TypedPress *does* govern goes through `/tp/v1/media`: upload (`create:
     author`), delete (`delete: editor`, with the reference cleanup that nulls
     `media` columns), and `PATCH /media/{id}` for `alt` and `focal`
     (`update: editor`, phase 2 §7.2). The crop/rotate editor is dropped
     (§4.2) because its save rewrites the file through core with WordPress
     capabilities only. The media list reads core `/wp/v2/media` (read is
     `anyone` in TypedPress too); the details screen also reads
     `GET /tp/v1/media/{id}` for `alt` and `focal`, which only TypedPress's
     response carries (§4.2).
   - **SCF options pages for globals** in wp-admin are governed by SCF's
     `capability` (`edit_others_posts`). The admin does not link to them;
     globals are edited through `/tp/v1/globals/<g>`, which applies the
     global's `update` rule. A site that wants the SCF page restricted to
     TypedPress's rule has the same gap it has today without the admin; that is a
     runtime question outside this plan and is noted in §10.
4. **Fields follow the response.** The edit panel renders the columns present
   in the record the API returned, not the columns in `/_schema`. A field the
   viewer can't read is absent from the response and therefore from the form;
   a field the viewer can't write produces a 403 with a pointer that the form
   shows inline. `/_schema`'s access summaries are used only to grey out
   buttons before the request ("create needs editor").
5. **Nothing trusted on the client.** No `_fields` trick, no `context=edit`
   assumption, no caching of a list across users. `wp.apiFetch` carries the
   REST nonce; application passwords work for the tests.

Dependency: PR #38 must merge before the rewire PR (§8, PR 5). PRs 2–4 do not
depend on it; PR 4's page-load test asserts only activation, the redirect for
anonymous viewers, and a 200 with the boot payload for signed-in roles. The
readable-menu assertions are PR 5's.

`table()` definitions: `/tp/v1/<c>` lists take `where`, `orderBy`,
`limit` (max 200) and `offset`, so DataViews pagination, sorting and
per-field filters map onto them directly; free-text search maps onto `like`
over the title column and is noted in the UI as such. No runtime change.

---

## 6. The Content frame

Spacefast embeds the admin in a same-origin frame of its own
dashboard through a `NativeContentHost` contract (REST proxying, host theme
tokens, host history). That contract, its transport, the skin and the
`spacefast:native-modules` virtual module are Spacefast-dashboard-specific.
They are not imported. TypedPress ships one full-page admin at `/typedpress-admin/`. If
the Spacefast dashboard wants to embed it, it embeds that URL on its side; if
it needs a message contract again, that is a Spacefast design with TypedPress as a
dependency, not the reverse.

---

## 7. Tests

Following Spacefast's two testing rules (never assert on source text; one
behaviour, one test, at the lowest level that can break it):

| Behaviour | Level | File |
|---|---|---|
| `admin: true` emits `plugins/typedpress-admin`, lists it in the manifest, zips it; `admin` absent emits nothing and a later build without it removes it | Rust integration (real CLI, real output dir) | `tests/wp_plugins.rs` (one new case) |
| `admin` rejected on … (nothing to reject: a boolean) | — | — |
| committed build matches sources | PHP drift suite | `tests/php/vendor_drift.php` |
| schema → DataViews fields: one case per column kind class, `enum` elements, `showIf` rule, hidden read summary | jest unit | `runtime/admin/apps/packages/schema/src/test/*.test.ts` |
| menu builder: readable collections only, globals, classic link | jest unit (pure function fed a schema and a permits map) | same workspace |
| activation: plugin active, `/typedpress-admin/` redirects anonymous to login, returns 200 for an editor with the boot payload listing readable collections, 200 for a subscriber listing only `anyone`-readable ones | WP e2e, HTTP + WP-CLI | `tests/wp/admin.test.ts` |
| list and edit through the guarded APIs as the screens call them: editor lists `tp_posts` with `context=edit`, creates, patches an `acf` field, sees it back | WP e2e | `tests/wp/admin.test.ts` |
| refusals: author creating into an admin-only collection → 403 with TypedPress's code; subscriber patching `acf.tp_salary` → 403 pointer `/salary`; the subscriber's boot payload lists no menu entry for an admin-only collection while `_schema` still describes it; unreadable field absent from the list response the screen uses | WP e2e | `tests/wp/admin.test.ts` (asserts the admin's exact requests; the rule semantics themselves stay owned by `core-access.test.ts`) |
| media: upload and delete as the screen does them go through `/tp/v1/media`; a subscriber's upload is 403; deleting an attachment referenced by a `media` column nulls the column | WP e2e | `tests/wp/admin.test.ts` (one case; `media.test.ts` owns the rules) |
| editor settings/assets endpoints answer for an editor and 403 for a subscriber | WP e2e | `tests/wp/admin.test.ts` |
| rewrite: `/typedpress-admin/` answers after activation on a site whose rules were generated before the plugin existed; 404 after deactivation | WP e2e | `tests/wp/admin.test.ts` |
| **the shipped admin runs**: a signed-in editor opens `/typedpress-admin/`, the boot module and its external imports load with no console error, the collections overview renders the test app's readable collections, opening one lists rows, editing a text field and saving persists it (asserted through `/tp/v1` after reload) | browser acceptance (Playwright, one spec, against the emitted assets in the harness; wiring in §3.4) | `runtime/admin/apps/wp-journey/admin.spec.ts` |

The browser run is deliberately one journey, not a screen matrix: it exists
to prove that the committed modules, the import map, the externals and the
router actually execute on the pinned WordPress, which no HTTP test can. The
per-role permission proofs stay at the HTTP level where they are cheap and
precise. Playwright is a devDependency of the workspace; `tests/wp/run.sh`
runs the spec when the browser is installed and fails loudly, not silently,
when it is not. If the rewire reveals another browser-only behaviour (for
example the editor panel's `showIf` toggling), it joins the same spec.

---

## 8. Phased PR plan (stacked on `main`)

| # | Branch | Content | Validation |
|---|---|---|---|
| 1 | `p3/admin-design` | this document | |
| 2 | `p3/admin-import` | **one commit**: the kept subset, already pruned (§4) and scrubbed (§1.3), under `runtime/admin/apps` + `runtime/admin/{typedpress-admin.php,lib,LICENSE,NOTICE}`, with catalog pins and no `next` dist-tag. No pre-cleanup state is ever committed. No build output yet. | `pnpm install --frozen-lockfile`, `tsc -b`, the workspace tests; every repo suite stays green without Node |
| 3 | `p3/admin-build` | `build.mjs`-style manifest and licence file, committed `runtime/admin/build/`, the `admin` CI job, the drift line in `vendor_drift.php` | CI, including the new job and the drift check |
| 4 | `p3/admin-package` | `admin: true` (types, extract, schema, build.rs emission, manifest), harness activation, `tests/wp/admin.test.ts` activation + page-load cases, `tests/wp_plugins.rs` case | CI; the WP suite on a real stack |
| 5 | `p3/admin-rewire` | `@typedpress-admin/schema`, collections overview/list/new/edit on TypedPress's model, media mutations over `/tp/v1/media`, the globals form, the menu builder with `CoreAccess::mayRead`, the readable-menu test; deletes the last `/types/*` public routes | needs #38 merged; CI; the WP suite |
| 6 | `p3/admin-tests` | the refusal, media, rewrite and viewer cases of §7, the browser acceptance spec, actions form if it fits, the `typedpress doctor` row of §2.3 | CI; the WP suite and the browser journey |
| 7 | `p3/admin-docs` | `docs/admin.md` (what it is, opt-in, URL, permalinks, what's in scope), README row, `config-api.md` entry; the pin move to stable releases (§3.3 step 2) if it is small enough, else its own PR | CI |

---

## 9. Decisions

1. **Provenance and licence of the source.** Spacefast holds the rights to
   the vendored admin work and distributes it under GPL-2.0-or-later, and may
   change it freely. `runtime/admin/LICENSE` is the GPL-2.0-or-later text;
   `NOTICE` says `Copyright (c) 2026 Spacefast` and credits "Spacefast's
   earlier WordPress admin work". The framework it descends from is not
   named. The `views` fork's additions are covered by the same grant, and the
   port may rewrite, prune or restructure any imported file.
2. **TypedPress's licence.** Split by component: MIT by default, GPL-2.0-or-later
   for what runs inside WordPress. The top-level `LICENSE`, `LICENSE-GPL` and
   `LICENSE-MIT` are owned by the README PR; `runtime/admin/` is on the GPL
   side (§1.4).
3. **Scope.** Users, themes, plugins, settings, design and taxonomy screens
   stay dropped (§4.2).
4. **Private-API opt-in.** The framework's unlock of Gutenberg private APIs
   stays, pinned and tested; the stable-pin PR (§3.3) replaces each use that
   has a public equivalent by then.
5. **NOTICE disposition, admin and identity alike.** Third-party licence
   notices are preserved verbatim. Notices that only name the source
   framework (its product name, a snapshot path, "its contributors" as
   holder) are Spacefast-authored courtesy lines, not upstream notices, and
   under decision 1 they read `Copyright (c) 2026 Spacefast`, GPL-2.0-or-later,
   "adapted from Spacefast's earlier WordPress admin work". That applies to
   `runtime/identity/NOTICE` and the one adapted file under
   `runtime/identity/apps/admin/src/`, which the README PR or the identity
   lane rewords; this plan does not touch them.

---

## 10. Risks

- **Nightly pins.** Mitigated by §3.3; real until PR 7 lands.
- **Private APIs.** §9.4. Also: `lib/i18n.php` reflects into
  `WP_Script_Modules::get_import_map()`. Both are proven only on the pinned
  floor (§3.3 step 3b); a newer WordPress may break them, which is why the
  header's `Tested up to` and `typedpress doctor` say so instead of pretending.
- **Globals' SCF options pages** are reachable in wp-admin under SCF's
  capability, not the global's TypedPress `update` rule. Pre-existing, not widened
  by the admin (which does not link there); a runtime fix would mirror PR
  #38's approach for options pages and is out of this plan's scope.
- **`design-system` is 294 files of deprecated UI.** Kept for now because
  nearly every screen uses it; migrating to `@wordpress/ui` is a separate,
  mechanical PR after PR 7, not before.
- **Binary size.** Embedding ~5 MB of JS grows the `typedpress` binary by that
  much. Identity already embeds 3 MB; if this becomes a problem the
  alternative is to publish `typedpress-admin.zip` as a release asset and let the
  plugin resolver fetch it by checksum, which the assembler already supports
  for URL plugins.
- **PR #38 timing.** The rewire PR (5) cannot merge before it. PRs 2–4 are
  independent of it.
- **Pretty permalinks.** `/typedpress-admin/` needs them. The harness sets
  `/%postname%/`; real sites almost always have them; the `typedpress doctor` row
  of §2.3 says so when they don't.
