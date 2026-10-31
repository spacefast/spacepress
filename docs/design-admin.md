# Zero Admin — design and provenance audit

Status: proposed (revision 1, 2026-10-31). Extends `design-phase2.md`; where
this document is silent, phase 2 holds. Sections 1 and 9 need rulings from the
project owner before the import PR (§8, PR 2) can merge; everything else is
decided here.

The ask: bring Spacefast's earlier WordPress admin work into Zero as an
optional plugin that `zero build --target wp` can ship next to `zero-runtime`,
`zero-identity` and `zero-app-<name>`. It is an admin UI for Zero apps on
WordPress. It is not a capsule frontend and it is not an embed for another
dashboard.

Conventions: "the source" = the admin tree in Spacefast's monorepo (1,143
files at the audited revision). "Kept" = imported and shipped. "Rewired" =
imported, then pointed at Zero's schema and APIs. "Dropped" = not imported.
Numbers below are from the audited revision and a throwaway build of it.

---

## 0. Decisions in one screen

| Area | Decision |
|---|---|
| Plugin | A fourth generated plugin, **`zero-admin`**, emitted by `zero build --target wp` only when `defineConfig({ admin: true })`. Standalone ignores the flag, like `plugins`. No admin by default. |
| Mount | Full-page app at `/zero-admin/` (rewrite rule, `auth_redirect()`), plus a wp-admin menu entry "Zero" that redirects there. Pretty permalinks required; `zero doctor` reports a plain structure. |
| Source of truth | `GET /zero/v1/_schema` describes collections, columns, globals, actions and access summaries. The admin derives its menu, list fields and edit forms from it. No admin-side copy of the schema. |
| Data path | Post-backed collections through core `/wp/v2/zero_<table>` (lists, the block editor, SCF fields through the `acf` REST field), which PR #38 puts under Zero's access rules. Everything else through `/zero/v1`. The admin plugin registers **no REST route that reads or writes Zero data**. |
| Scope | Collections, media, globals, the block editor, and a "classic admin" escape hatch. Users, themes, plugins, settings, design and taxonomy screens are dropped: they duplicate wp-admin with no Zero gain. |
| Content frame | Out of scope. The host-embed contract (`native-*`) is Spacefast-dashboard-specific and is not imported. |
| Where the JS lives | `runtime/admin/apps/` (a self-contained pnpm workspace), built into `runtime/admin/build/` which is **committed** with a source-hash manifest, exactly like `runtime/identity/{apps,build}`. The Rust binary embeds `runtime/admin/` minus `apps/`; Zero core never needs Node. |
| Pins | One exact `@wordpress/*` snapshot in one catalog, no `next` dist-tag anywhere. The nightly snapshot stays through the rewire PR; then a dedicated PR moves to the stable releases that match WordPress 7.1's bundled packages, and from then on bumps ride the platform floor in `src/platform.rs`. |
| Provenance | Upstream Gutenberg packages come from npm. Three vendored forks of Gutenberg packages are replaced by npm or kept as a renamed fork (§1.2). The rest is the internal framework the source was vendored from; it is imported only after the licence ruling in §9.1, with every internal name, link, telemetry seam and private endpoint removed (§1.3). |
| Tests | Real WordPress through the existing harness (`tests/wp/admin.test.ts`), driven by HTTP and WP-CLI with the exact calls the screens make, per role. Pure JS logic (schema → DataViews fields, menu builder) at unit level in the workspace. No browser automation unless a behaviour can't be proven otherwise. |

---

## 1. Provenance audit

### 1.1 What the source is

The tree was vendored into the monorepo on 2026-09-06 in one commit, with the
note "Vendored from a dead-upstream WordPress admin framework; there is no
upstream tracking". The upstream was an Automattic-internal admin framework
(its packages call it "CIAB Admin"). Git history before that commit is not
preserved, so original authors and dates are not recoverable from the source
tree. The `license: GPL-2.0-or-later` field in the root `package.json` was
written by the vendoring commit, not inherited from the upstream. Only two of
the twenty vendored packages carry a `license` field of their own
(`telemetry`, which Spacefast wrote, and `wp-build`). No `LICENSE` file exists
anywhere in the tree except a dashicons licence under `packages/boot`.

Eleven commits touched the tree after import. All are Spacefast's own glue
(the Content frame, kernel endpoints, media checkbox and excerpt fixes).

### 1.2 Classification

Three classes:

- **U — upstream Gutenberg/WordPress.** Published on npm under
  `@wordpress/*`, GPL-2.0-or-later, repository `WordPress/gutenberg`. Safe to
  depend on from npm instead of vendoring.
- **I — internal framework.** The upstream admin framework's own code,
  named `@automattic/*` or `@ciab/*`, never published. Importable only under
  the ruling in §9.1.
- **S — Spacefast glue.** Written in the monorepo after import. Spacefast owns
  it; it is either kernel-specific (dropped) or generic (kept).

| Path | Class | Files | What it is | Disposition |
|---|---|---|---|---|
| `@wordpress/*` (96 pinned nightlies in `pnpm-workspace.yaml` overrides) | U | n/a | Gutenberg packages, snapshot `v.202608281122` | npm, pinned (§3.3) |
| `@automattic/grid@0.2.1` (npm) | U-like | n/a | Public npm package from `Automattic/wp-calypso`, GPL-2.0-or-later | dropped with the dashboard package |
| `packages/image-cropper` | U fork | 8 | 5 of 8 files byte-identical to `@wordpress/image-cropper` at the same snapshot; the rest add a stylesheet and re-exports | **replace with npm** `@wordpress/image-cropper` |
| `packages/global-styles-engine` | U fork | 25 | 7 of 23 source files identical to `@wordpress/global-styles-engine`; the rest are an older cut of the same files | **replace with npm** `@wordpress/global-styles-engine` |
| `packages/views` | U fork | 13 | Same shape as `@wordpress/views` (use-view, load-view, preference keys) plus a `DataViews` wrapper, tab-filter merging and a stylesheet the routes depend on | keep as renamed fork `@zero-admin/views`; migrate to stable `@wordpress/views` in the pin PR (§3.3) |
| `packages/dataviews` | I | 3 | Re-exports `@wordpress/dataviews/wp` and its stylesheet | keep, rename `@zero-admin/dataviews` |
| `packages/ciab-private-apis` | I | 3 | Wraps `__dangerousOptInToUnstableAPIsOnlyForCoreModules`, presenting itself as `@wordpress/edit-site` | keep, rename `@zero-admin/private-apis` (risk: §10) |
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
| `packages/ai-agent` | I | 13 | Chat panel driven by `window.wpOrchestratorAgent` from an internal plugin; README links an internal host and a WordPress.com endpoint | **drop** |
| `packages/user-data` | I | 9 | User-invite store calling `/wp/v2/users/invite`, an endpoint no file in the tree defines (WordPress.com-only) | **drop** |
| `packages/telemetry` | S | 2 | Inert no-op shim, GPL-2.0-or-later, written by Spacefast | drop the package and its 24 import sites (they are all no-ops) |
| `packages/wp-build` | I | 10 | esbuild-based build: externalises `wp-*` classic scripts and `@wordpress/*` script modules, bundles the rest, emits `index.asset.php` per module and `build/index.php` | keep, rename `@zero-admin/wp-build` |
| `routes/*` (33) | I + S | 338 | Screens; see §4 | per §4 |
| `fields/*` (7) | I | 144 | Server-registered DataViews fields for users, media, themes, posts, plugins, terms, comments | keep media + post; drop the rest |
| `lib/**` (26 PHP files) | I + S | 26 | Registration APIs, REST controllers, menu, i18n, legacy iframe bridge | per §4.3 |
| `next-admin.php` | I + S | 1 | Plugin entry | rewritten as `zero-admin.php` |
| `types/*.d.ts` | I | 9 | Ambient typings for private APIs | keep what kept code needs |
| Monorepo `zero/native-*.ts`, `zero/php/zero-dashboard.php`, `zero/scripts/*` | S | 7 | Content-frame contract, transport, mu-plugin loader, monorepo build | **not imported** |

Size, from a throwaway build of the full tree: 83 JS modules, 7.2 MB before
compression (2.1 MB of it is the bundled `@wordpress/dataviews`, 0.6 MB the
dropped design screens, 0.5 MB the dropped user/term/theme/plugin screens).
Warm `pnpm install --frozen-lockfile` 4 s, `wp-build build` 4 s, output
byte-identical across two builds. `node_modules` is 515 MB.

### 1.3 Internal references: inventory and disposition

Counted over the tree excluding `pnpm-lock.yaml`:

| Reference | Where | Count | Disposition |
|---|---|---|---|
| `@automattic/<pkg>` workspace scopes | every `package.json` and import | ~640 | rename to `@zero-admin/<pkg>` (mechanical) |
| `@automattic/grid` (npm) | dashboard | 10 | gone with the dashboard package |
| `@automattic/agenttic-client`, `agenttic-ui` | ai-agent README | 3 | gone with ai-agent |
| `@ciab/dataviews` | imports | 171 | rename to `@zero-admin/dataviews` |
| `@ciab-next/telemetry` | 24 route/package imports | 24 | delete imports and call sites (all no-ops) |
| "CIAB Admin", "CIAB", `ciab-admin` | PHP docblocks, READMEs, comments, the `ciab-admin/navigate` ability | ~180 | rewrite docblocks; delete the ability with the frame glue |
| `big_sky_*` filters | `next-admin.php`, `lib/rest-api/class-next-admin-rest-editor-controller.php` | 3 | delete (they silence an internal plugin's agent) |
| `wpOrchestratorAgent` | ai-agent | 4 | gone with ai-agent |
| `github.a8c.com`, `teamcity.a8c.com`, `ciabp2.wordpress.com`, `linear.app/a8c` | READMEs, one SCSS comment | 6 | delete |
| `public-api.wordpress.com/wpcom/v2/ai/agent/woo-ai` | ai-agent README | 1 | gone with ai-agent |
| `/wp/v2/users/invite`, "Jetpack connection owner" | user-data, routes/user | 4 | gone with user-data and the user screens |
| `/spacefast/v1/admin/{bootstrap,resolve,sync,sync/retry,settings}`, `/spacefast/v1/redirects` | boot `content-api.ts`, routes collection-*, content-*, redirects | 9 | gone with the kernel-bound screens (§4) |
| `spacefast` (skin, frame, data attributes, canvas styles) | boot | ~60 | gone with the frame glue |
| `.jetpack-logo` CSS hook | boot `legacy-admin-ui-bridge.scss` | 1 | delete the rule |
| `next-admin` text domain, `next_admin_*` functions and filters, `Next_Admin_*` classes, `NEXT_ADMIN_*` constants | all PHP | hundreds | rename to `zero-admin` / `zero_admin_*` / `Zero_Admin_*` / `ZERO_ADMIN_*` |
| `window.__experimentalDataViewsMediaModal`, `GUTENBERG_VERSION` | `lib/pages/admin.php` | 2 | keep (public Gutenberg flags) |

Telemetry: there is no live transport anywhere in the tree. The only
telemetry code is the inert shim, and the dashboard-widget "tracking" hooks
that call it. Nothing phones home. After the cleanup there is no telemetry
seam at all; if Zero ever wants product analytics it is a new decision.

Private APIs: `packages/ciab-private-apis` and `admin-toolkit` unlock
Gutenberg's private APIs (`@wordpress/route`, `core-data`, `editor`,
`global-styles-engine`, `theme`) by opting in as `@wordpress/edit-site`. 65
files use `unlock(...)`. This is how the upstream framework worked and it is
load-bearing for routing and DataViews. It is kept, renamed and pinned (§3.3,
§10).

A note on what is already in this repo: `runtime/identity/apps/admin/src/ciab/dataviews.ts`
carries the header "Adapted from CIAB Admin … Copyright the CIAB Admin
contributors." That file belongs to the identity lane and is outside this
plan's files, but it needs the same rename before the repo goes public. Flagged
in §9.

### 1.4 Licensing

- **Zero.** `runtime/Zero/composer.json` and every generated plugin header say
  GPL-2.0-or-later. `Cargo.toml` has no `license` field and the repository has
  no top-level `LICENSE`. `design-phase2.md` §3.6 refers to "the repo's
  existing licence", which does not exist yet. Flagged in §9.2.
- **Gutenberg packages.** `@wordpress/*` on npm are GPL-2.0-or-later
  (Gutenberg itself is dual-licensed GPL-2.0-or-later / MPL-2.0). Compatible
  with Zero's PHP licence; the admin plugin is GPL-2.0-or-later like the other
  three plugins.
- **The internal framework.** Declared GPL-2.0-or-later by Spacefast at
  vendoring time. The source tree contains no licence grant from its upstream,
  no copyright holder, and no provenance for the declaration. Under the
  clean-room rule this is the one thing this plan cannot decide. Until the
  owner rules (§9.1), nothing from class I is imported. Class U comes from npm
  either way, and class S is Spacefast's own.
- **Third-party in the tree.** `routes/design-styles/.../lib/{lib-font,inflate,unbrotli}.js`
  (MIT, Pomax; zlib/brotli ports) are dropped with the design screens.
  `packages/boot/src/dashicons` (GPL-2.0-or-later, with its own LICENSE.md)
  is kept. Everything else pulled from npm is covered by the
  `THIRD-PARTY-LICENSES.txt` the build will emit, as the identity build does.

### 1.5 What the audit did not find

No credentials, no tokens, no internal hostnames in code paths (only in
READMEs and one SCSS comment), no network calls to anything but the site's
own REST root, and no PHP that talks to the monorepo kernel except through
the `spacefast/v1` REST namespace listed above (whose server side lives in the
monorepo and is not imported).

---

## 2. Target shape

### 2.1 The plugin

```
.zero/wp-content/plugins/zero-admin/
  zero-admin.php          header below; rewrite rule, menu entry, page render, module registration
  lib/                    registration APIs, kept REST controllers, menu builder, i18n, legacy bridge
  build/                  committed JS/CSS modules + index.php + THIRD-PARTY-LICENSES.txt + .manifest.json
  LICENSE                 GPL-2.0-or-later
  readme.txt
```

```
Plugin Name:       Zero Admin
Version:           {{zeroVersion}}
Requires at least: 7.1
Requires PHP:      8.2
Requires Plugins:  zero-runtime
License:           GPL-2.0-or-later
```

`zero-admin` is versioned with the binary like `zero-runtime` and
`zero-identity`. It is not in any other plugin's `Requires Plugins`: it is
optional. On `plugins_loaded` it checks `\Zero\Wp\Runtime::plugin()`; with no
registered app it shows one admin notice and registers nothing. It reads the
app's schema through `Runtime::plugin()->schema->describe()` for the server
side (menu, preload) and through `GET /zero/v1/_schema` for the client side.

### 2.2 Opt-in

```ts
export default defineConfig({ name: "blog", admin: true, /* … */ });
```

`admin?: boolean` on `ConfigInput` (default `false`), key `'admin'` in
schema.php v3, accepted by `src/extract.rs`'s config allowlist. `zero build
--target wp` emits `plugins/zero-admin` and lists it in `zero-manifest.json`
only when the flag is true; a build that turns the flag off deletes the
directory like any other `zero-*` output. Standalone builds accept the flag
and ignore it (like `plugins`), so a config stays target-independent. There is
no CLI flag: the artifact is a function of the config.

Why opt-in and not always: the plugin is several megabytes of JS, it asks the
site for pretty permalinks, and most Zero apps (headless, API-first) have no
one to sit in it. Why a config key and not a separate command: §2.1 of
phase 2 makes the wp-content artifact one build with one manifest, and
`zero doctor` can then check what the manifest promised.

### 2.3 Rust changes (the whole `src/` footprint)

- `src/extract.rs`: `"admin"` in the config allowlist; `schema.admin: bool`.
- `src/schema.rs`, `src/schema_php.rs`: the field and its `'admin' => true|false` emission.
- `src/commands/build.rs::emit_generated`: when `schema.admin`, copy every
  embedded file under `admin/` to `plugins/zero-admin/` and substitute the
  header; `emit_wp_content` adds the slug to the versions map (and to
  `php_lint_tree` + `zip_plugin`) only in that case.
- `types/zero/index.d.ts`: `admin?: boolean` with a one-line doc.
- `build.rs`: nothing. It already skips `apps`, `node_modules` and dotfiles,
  so `runtime/admin/apps/` never enters the binary and `runtime/admin/build/`
  does.

Nothing else in `src/` changes. `zero doctor --site` gains one row ("admin:
present / absent / permalinks plain") in the docs PR if it stays a one-liner;
otherwise it is left out.

### 2.4 Mount and boot

`/zero-admin/` and everything under it is served by the plugin (rewrite rule
to `index.php?zero_admin=1`, `auth_redirect()`, then the page template). The
page:

1. runs `set_current_screen()` and `do_action('zero_admin_init')` so the menu
   and routes register;
2. preloads `/wp/v2/types`, `/wp/v2/users/me`, `/wp/v2/settings`, `/zero/v1/_schema`
   and `/zero/v1/me` through `rest_preload_api_request` so the first paint
   needs no round trip;
3. registers `@zero-admin/boot` as a script module with every route, field and
   init module as a dependency, and boots it with the routes, menu items and
   schema-derived context as JSON.

The wp-admin side keeps one top-level menu entry "Zero" (capability `read`)
that redirects to `/zero-admin/`. The existing `/wp-admin/new` alias is not
kept.

### 2.5 Harness

`tests/wp/harness.sh up` activates `zero-admin` after `zero-app-<name>` when
the manifest lists it (same rule as `zero-identity`). The test app
(`tests/wp/app/zero.config.ts`) sets `admin: true`; `examples/blog` does not,
so the example keeps proving the opt-out path.

---

## 3. JS workspace, build and CI

### 3.1 Layout

```
runtime/admin/
  zero-admin.php  lib/  LICENSE  readme.txt            the plugin's PHP (embedded, emitted)
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
- `build/THIRD-PARTY-LICENSES.txt` from the esbuild metafile.

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
4. **No floating ranges.** Non-WordPress dependencies (`react`, `clsx`,
   `dequal`, `esbuild`, `sass-embedded`, …) are exact in the catalog too.

### 3.4 CI

A new `admin` job in `.github/workflows/ci.yml`, independent of the Rust and
PHP jobs:

```
setup-node 22 + pnpm (version from apps/package.json packageManager)
cd runtime/admin/apps
pnpm install --frozen-lockfile
pnpm typecheck                 # tsc -b
pnpm test                      # jest, @wordpress/jest-preset-default (the preset the source's tests were written for)
pnpm build
git diff --exit-code -- runtime/admin/build
git ls-files --others --exclude-standard -- runtime/admin/build   (must be empty)
```

Plus one line in `tests/php/vendor_drift.php`: the admin build's
`.manifest.json` `sources` must equal the digest of `runtime/admin/apps` (the
same check identity has), so a stale commit fails `tests/php/run.sh` without
Node. The `wp` job needs nothing new: `tests/wp/run.sh` builds the test app
with `admin: true` and the new suite runs with the others.

Node is a dev dependency of this repository already (`runtime/identity/apps`,
`tests/wp/*.test.ts`); the admin adds pnpm, pinned through `packageManager`.

---

## 4. Screens: keep, drop, rewire

### 4.1 What a screen must satisfy to be kept

Keep if it (a) works on Zero's model (CPT + SCF, `/_schema`, `/zero/v1`) or
can be rewired to it, and (b) adds something plain wp-admin does not have for
a Zero app. Drop if it duplicates wp-admin with no Zero gain, depends on the
monorepo kernel, or is capsule/host-specific.

### 4.2 Routes

| Route | URL(s) | Data today | Decision | Why / how |
|---|---|---|---|---|
| `dashboard` + `dashboard-widgets/*` | `/` | widget layout in user meta; widgets fetch nothing real | **drop**; `/` becomes the collections overview | the overview is what a Zero editor opens the admin for; the widget system is 240 KB plus PHP for a weather stub and "recent posts" |
| `collection-index` | `/collections` | kernel bootstrap | **rewire** → `/` | tiles per collection from `/_schema`, filtered server-side to what the viewer may read (§5) |
| `collection-list` | `/collections/$collection` | kernel bootstrap + core `/wp/v2/<type>` | **rewire** (replaces `post-list` for Zero types) | DataViews over core `/wp/v2/zero_<table>` for post-backed collections; fields from `/_schema` columns (title/content/slug/status/publishedAt as core fields, every SCF column through `acf`); `editor: false` collections over `/zero/v1/<c>` with the same field mapping |
| `collection-new` | `/collections/$collection/-/new` | kernel + core POST | **rewire** | `POST /wp/v2/zero_<table>` (post-backed) or `POST /zero/v1/<c>` (tables); required columns from `/_schema` |
| `collection-edit` | `/collections/$collection/$slug` | kernel resolve + sync + field editor | **rewire** | by id, not slug; the block editor for `content` collections with a "Fields" sidebar panel rendered from `/_schema` columns and written through the `acf` REST field; a plain form for collections without `content`; `showIf` evaluated client-side from the sibling values; `editor: false` rows use the plain form over `/zero/v1` |
| `post-list` | `/types/$type/list/$slug` | core `/wp/v2/<type>` + field collections | **keep for `attachment` only** (the media library); the generic post-type list is not exposed for Zero types | its DataViews/actions/quick-edit code is the base the collection list is built on |
| `post-list-redirect`, `post`, `post-edit`, `post-new` | `/types/$type[...]` | core | **keep** the editor host (`boot/components/editor`), **drop** the public `/types/*` routes | the editor is reached through `/collections/...` only |
| `attachment` | `/types/attachment/edit/$id` → `/media/$id` | core `/wp/v2/media`, image cropper | **keep**, re-path | Zero media columns reference attachments; crop/alt/caption editing is a real gain |
| `term-list`, `term-add`, `term-edit` | `/types/$type/taxonomies/$tax[...]` | core terms | **drop** | Zero has no taxonomies |
| `user-list`, `user-add`, `user-profile`, `user`, `profile` | `/users[...]`, `/profile` | core users + WordPress.com invites | **drop** | duplicates wp-admin; the invite flow is WordPress.com-only; `/zero/v1/me` covers "who am I" |
| `plugin-list`, `plugin` | `/plugins[...]` | core plugins + overrides | **drop** | duplicates wp-admin |
| `theme-list` | `/design/themes` | core themes + overrides | **drop** | duplicates wp-admin; themes are the Zero Blocks lane's area |
| `design-styles` | `/design/styles` | global styles entity | **drop** | 600 KB; the site editor does this; Zero Blocks owns block themes |
| `design-navigation`, `-list`, `-edit` | `/design/navigation[...]` | `wp_navigation` posts | **drop** | duplicates the site editor |
| `settings`, `settings-general`, `settings-reading` | `/settings[...]` | `root/site` | **drop** | duplicates wp-admin |
| `settings-experiments` | `/settings/experiments` | preferences | **drop** | no experiments remain |
| `content-activity`, `content-settings`, `redirects` | `/content/...`, `/redirects` | `spacefast/v1/*` | **drop** | monorepo kernel |
| `legacy-admin` | `/legacy/$slug` | iframes a wp-admin page | **keep** | the escape hatch: menu entries for SCF options pages (globals, until PR 6), media settings and "Classic admin" open here; 3 files |
| new: `globals` | `/globals/$name` | `/zero/v1/globals/<g>` | **new** (PR 6) | one form per global rendered from `/_schema` fields; `PATCH /zero/v1/globals/<g>` |
| new: `actions` | `/actions` | `/zero/v1/_schema`, `POST /zero/v1/actions/<a>` | **new, optional** (PR 6 if small) | a form per action from its `input` columns; shows only actions whose access summary the viewer meets; the response is printed as JSON |

### 4.3 PHP (`lib/`)

| File | Decision | Why |
|---|---|---|
| `api/routes.php`, `api/menu-items.php`, `api/init-modules.php`, `api/field-collections.php`, `api/view-config.php` | keep, rename | registration APIs the kept screens use |
| `api/dashboard-layout.php`, `-widgets.php`, `-context.php` | drop | dashboard |
| `rest-api/class-…-editor-controller.php` (`wp/v2/editor/{settings,assets}`) | keep, strip the internal filter | the in-app block editor needs editor settings and the assets list; it reads no Zero data |
| `rest-api/class-…-field-collections-controller.php`, `-view-config-controller.php` | keep | serve server-registered DataViews fields and view configs for media; read no Zero data |
| `rest-api/class-…-attachments-controller.php` | keep | mime-type ordering for the media library |
| `rest-api/core-rest-api-overrides.php` | trim to: auto-draft status in REST, comment-count field; drop user search, theme update/auto-update fields | only what kept screens use |
| `rest-api/class-…-themes-controller.php`, `-plugins-controller.php`, `plugins-rest-api-overrides.php`, `class-…-resolved-template-controller.php` | drop | dropped screens |
| `post.php` | trim: default view args, duplicate-post support; drop `wp_template` enabling | |
| `taxonomies.php`, `taxonomy-hierarchy.php` | drop | no taxonomies |
| `i18n.php` | keep | translations for script modules (uses reflection on `WP_Script_Modules`; §10) |
| `legacy-route.php` | keep | the iframe bridge |
| `next-admin-menu.php` | rewrite as `menu.php` | the menu is: Collections (one entry per collection the viewer may read, from the schema), Media, Globals (one entry per global, legacy iframe until PR 6), Actions (if any), Classic admin |
| `site-preview.php` | drop | front-end preview |
| `pages/admin.php` | keep, trim | the page template (§2.4) |

### 4.4 Fields (`fields/`)

Keep `core-media-fields` and `core-post-fields` (they extend DataViews for
attachments and the editor's core columns). Drop user, theme, plugin, term and
comment fields with their screens. Zero columns do not use the field-collection
mechanism at all: they are derived client-side from `/_schema` by a new
`@zero-admin/schema` package (column kind → DataViews field type, `enum` →
elements, `media` → thumbnail, `access.read` summary → hidden-by-default, and
`showIf` → the panel's visibility rule). That package is pure and unit-tested.

---

## 5. Access: the admin never bypasses Zero

Rules, in order of where they are enforced:

1. **Server-side menu and overview.** The page builds the menu from the
   schema and asks `Db::permits('read', $collection)` (PR #38's seam) for the
   current WordPress user. A collection the viewer can't read has no menu
   entry, no tile, and no preloaded data. This is a courtesy, not the guard.
2. **The guard is the API.** Post-backed collections are read and written
   through core `/wp/v2/zero_<table>`, which PR #38 puts under Zero's
   collection and field rules (`CoreAccess::mapMetaCap`, `PostsController`,
   `FieldAccess::checkWrite`). Tables, globals, actions, media and `_schema`
   go through `/zero/v1`, which has always applied them. The admin plugin
   registers no route of its own that touches Zero data, and its PHP never
   calls `Db` except `permits()` for the menu.
3. **Fields follow the response.** The edit panel renders the columns present
   in the record the API returned, not the columns in `/_schema`. A field the
   viewer can't read is absent from the response and therefore from the form;
   a field the viewer can't write produces a 403 with a pointer that the form
   shows inline. `/_schema`'s access summaries are used only to grey out
   buttons before the request ("create needs editor").
4. **Nothing trusted on the client.** No `_fields` trick, no `context=edit`
   assumption, no caching of a list across users. `wp.apiFetch` carries the
   REST nonce; application passwords work for the tests.

Dependency: PR #38 must merge before the rewire PR (§8, PR 5). PRs 2–4 do not
depend on it.

---

## 6. The Content frame

The monorepo embeds the admin in a same-origin frame of the Spacefast
dashboard through a `NativeContentHost` contract (REST proxying, host theme
tokens, host history). That contract, its transport, the skin and the
`spacefast:native-modules` virtual module are Spacefast-dashboard-specific.
They are not imported. Zero ships one full-page admin at `/zero-admin/`. If
the Spacefast dashboard wants to embed it, it embeds that URL on its side; if
it needs a message contract again, that is a Spacefast design with Zero as a
dependency, not the reverse.

---

## 7. Tests

Following the monorepo's two rules (never assert on source text; one
behaviour, one test, at the lowest level that can break it):

| Behaviour | Level | File |
|---|---|---|
| `admin: true` emits `plugins/zero-admin`, lists it in the manifest, zips it; `admin` absent emits nothing and a later build without it removes it | Rust integration (real CLI, real output dir) | `tests/wp_plugins.rs` (one new case) |
| `admin` rejected on … (nothing to reject: a boolean) | — | — |
| committed build matches sources | PHP drift suite | `tests/php/vendor_drift.php` |
| schema → DataViews fields: one case per column kind class, `enum` elements, `showIf` rule, hidden read summary | jest unit | `runtime/admin/apps/packages/schema/src/test/*.test.ts` |
| menu builder: readable collections only, globals, classic link | jest unit (pure function fed a schema and a permits map) | same workspace |
| activation: plugin active, `/zero-admin/` redirects anonymous to login, returns 200 for an editor with the boot payload listing readable collections, 200 for a subscriber listing only `anyone`-readable ones | WP e2e, HTTP + WP-CLI | `tests/wp/admin.test.ts` |
| list and edit through the guarded APIs as the screens call them: editor lists `zero_posts` with `context=edit`, creates, patches an `acf` field, sees it back | WP e2e | `tests/wp/admin.test.ts` |
| refusals: author creating into an admin-only collection → 403 with Zero's code; subscriber patching `acf.zero_salary` → 403 pointer `/salary`; viewer's boot payload and `_schema` list show nothing of a collection they can't read; unreadable field absent from the list response the screen uses | WP e2e | `tests/wp/admin.test.ts` (asserts the admin's exact requests; the rule semantics themselves stay owned by `core-access.test.ts`) |
| editor settings/assets endpoints answer for an editor and 403 for a subscriber | WP e2e | `tests/wp/admin.test.ts` |

Browser automation is not planned. Every screen above is a thin view over
calls that can be made with `fetch`; if the rewire reveals a behaviour that
only a browser can prove (for example the editor panel's `showIf` toggling),
that one case gets a Playwright test in the same file, and the doc is updated.

---

## 8. Phased PR plan (stacked on `main`)

| # | Branch | Content | Gate |
|---|---|---|---|
| 1 | `p3/admin-design` | this document | Sol review of the doc; owner rulings §9 |
| 2 | `p3/admin-import` | two commits: (a) verbatim import of the kept subset into `runtime/admin/apps` + `runtime/admin/{zero-admin.php,lib}`; (b) provenance cleanup: renames, deletions of §1.3, dropped routes/packages/PHP of §4, catalog pins, `LICENSE`, scrubbed READMEs. `pnpm install --frozen-lockfile` and `tsc -b` pass. No build output yet. | Sol reviews commit (b) and the PHP; the PR says the verbatim import commit is not reviewed line by line |
| 3 | `p3/admin-build` | `build.mjs`-style manifest and licence file, committed `runtime/admin/build/`, the `admin` CI job, the drift line in `vendor_drift.php` | CI green |
| 4 | `p3/admin-package` | `admin: true` (types, extract, schema, build.rs emission, manifest), harness activation, `tests/wp/admin.test.ts` activation + page-load cases, `tests/wp_plugins.rs` case | CI green, Sol clean |
| 5 | `p3/admin-rewire` | `@zero-admin/schema`, collections overview/list/new/edit on Zero's model, media, menu builder, legacy entries for globals; deletes the last `/types/*` public routes | needs #38 merged; CI green, Sol clean |
| 6 | `p3/admin-tests` | the refusal and viewer cases of §7, the globals form (and actions if it fits), `zero doctor` row if one line | CI green, Sol clean |
| 7 | `p3/admin-docs` | `docs/admin.md` (what it is, opt-in, URL, permalinks, what's in scope), README row, `config-api.md` entry; the pin move to stable releases (§3.3 step 2) if it is small enough, else its own PR | CI green |

Each PR is reviewed with
`git diff <base>...HEAD -- . ':!**/vendor-prefixed/**' ':!runtime/admin/build/**' ':!runtime/admin/apps/pnpm-lock.yaml'`.
Merging is the orchestrator's; every PR reports number, head SHA, CI state and
Sol outcome.

---

## 9. Open questions for the project owner

1. **Licence and provenance of the internal framework (blocks PR 2).** The
   vendored code (class I in §1.2: about 60% of the tree after pruning) was
   declared GPL-2.0-or-later by Spacefast when it was vendored, and the tree
   holds no upstream grant, copyright holder or author list. Please confirm
   (a) that Spacefast has the right to redistribute it under GPL-2.0-or-later
   in a public repository, (b) whose copyright line goes in
   `runtime/admin/LICENSE` / a `NOTICE`, and (c) whether the original
   framework should be credited by name at all (this plan assumes not: the
   public text says "Spacefast's earlier WordPress admin work"). If (a) is
   no, the fallback is to import only class U from npm and write the shell
   (router, sidebar, page, editor host, collection screens) fresh on
   `@wordpress/boot`, `route`, `dataviews`, `fields` and `ui`; that is a
   different, larger plan.
2. **Zero's top-level licence.** There is none. Options: GPL-2.0-or-later for
   the whole repository (simplest, matches every emitted artifact), or
   MIT/Apache-2.0 for the Rust compiler with GPL-2.0-or-later for `runtime/`
   and `types/`. This plan works under either; it only needs the file to exist
   before the repo goes public.
3. **Scope cut.** Users, themes, plugins, settings, design and taxonomy
   screens are dropped (§4.2). Say so if you want any of them back; users is
   the only one with a plausible case (an editor inviting an author), and it
   would need the WordPress.com invite flow replaced with core user creation.
4. **Private-API opt-in as `@wordpress/edit-site`.** The framework works by
   claiming to be a core module. It is pinned and tested, but it is the kind
   of thing a WordPress point release can break and Gutenberg's policy
   discourages. Accept (this plan's default), or make the stable-pin PR (§3.3)
   also replace every private-API use with public equivalents where they now
   exist (`@wordpress/boot`, `@wordpress/views`), which is larger.
5. **The identity lane's attribution header.** `runtime/identity/apps/admin/src/ciab/dataviews.ts`
   names the internal framework. Outside this plan's files; needs renaming
   before publication.

---

## 10. Risks

- **Nightly pins.** Mitigated by §3.3; real until PR 7 lands.
- **Private APIs.** §9.4. Also: `lib/i18n.php` reflects into
  `WP_Script_Modules::get_import_map()`. Both are pinned to WP 7.1 and proven
  by the harness; a floor bump re-proves them.
- **`design-system` is 294 files of deprecated UI.** Kept for now because
  nearly every screen uses it; migrating to `@wordpress/ui` is a separate,
  mechanical PR after PR 7, not before.
- **Binary size.** Embedding ~5 MB of JS grows the `zero` binary by that
  much. Identity already embeds 3 MB; if this becomes a problem the
  alternative is to publish `zero-admin.zip` as a release asset and let the
  plugin resolver fetch it by checksum, which the assembler already supports
  for URL plugins.
- **PR #38 timing.** The rewire PR (5) cannot merge before it. PRs 2–4 are
  independent of it.
- **Pretty permalinks.** `/zero-admin/` needs them. The harness sets
  `/%postname%/`; real sites almost always have them; `zero doctor` says so
  when they don't.
