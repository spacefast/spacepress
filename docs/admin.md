# First Admin

First Admin is the default admin of every First app. `first build` puts the
`first-admin` plugin (compiled assets included) into the artifact next to
`first-runtime` and `first-app-<name>`; activate it after the app. It runs at
`/wp-admin/new/`, the address the upstream admin used, and classic
`/wp-admin/` stays complete and unchanged beside it. A subdirectory installation
uses its own prefix, for example `/blog/wp-admin/new/`.

```ts
import { collection, defineConfig, richText, text } from "first";

const posts = collection({
  title: text(),
  body: richText().optional(),
  summary: text().optional(),
}, {
  title: "title",
  content: "body",
  access: { read: "anyone", create: "editor", update: "editor", delete: "admin" },
});

// No setting needed: First Admin ships. `admin: false` leaves only classic wp-admin.
export default defineConfig({ name: "my-app", collections: { posts } });
```

Use your normal WordPress account. WordPress owns authentication, capabilities,
REST nonces, users, settings, plugins, themes, media and the block editor.

### Addresses

| URL | What it serves |
|---|---|
| `/wp-admin/new/<route>` | First Admin. Apache rewrites it to `wp-admin/admin.php?page=first-admin`; the route stays in the path. |
| `/wp-admin/admin.php?page=first-admin&p=<route>` | The same page on any server. A server that does not read `.htaccess` (nginx, and WordPress Studio's server behind `first dev`) redirects `/wp-admin/new/<route>` here. |
| `/wp-admin/` | Classic wp-admin, unchanged. Its `First` menu entry opens First Admin. |
| `/first-admin/<route>` | The earlier address: a permanent redirect to `/wp-admin/new/<route>`. |

The page is a wp-admin page: `admin.php` signs the visitor in (`auth_redirect`)
and builds wp-admin's menus, so plugin menu entries appear in First Admin's
sidebar. The plugin writes its rule into `.htaccess` on the first web request
after it is activated or updated (WP-CLI never writes that file).

After signing in, WordPress's default destination (`/wp-admin/`) becomes
`/wp-admin/new/`. A page the visitor asked for (`redirect_to`) is kept.
`Classic admin` in First Admin's sidebar and command palette opens
`/wp-admin/`; `First` in wp-admin's menu returns. Existing plugin settings and
classic plugin screens remain accessible in both.

`admin: false` in `defineConfig` leaves the plugin out of the build, and a build
that adds it removes the plugin from the output. Classic wp-admin is then the
only admin and login lands there, as in WordPress.

Editor asset URLs use WordPress's registered installation URL, including the
subdirectory prefix.

## Screens in both admins

A screen declared once with `first_admin_register_screen()` appears in First
Admin (`/wp-admin/new/screens/<id>`) and as a classic wp-admin page, rendered by
the same component, with actions that run Abilities. First declares Schema
versions and one list per `table()` kind this way. See
[admin-screens.md](admin-screens.md).

## Source scope

The admin includes the complete distributable next-admin / CIAB Admin plugin
package, route, field, dashboard-widget and PHP library trees. This includes
Dashboard, native Posts and Pages, Users, Plugins, Themes, Settings, Design,
Styles, Navigation, taxonomy and comment fields, importers and the AI-agent
integration package. These surfaces are retained alongside First's schema-driven
collections, tables, relations, media and globals.

The home route `/` is the upstream dashboard, as upstream has it;
`/collections` is First's collection overview (Collections → All collections in
the sidebar). The sidebar includes native WordPress content types as well
as First collections; mapped types appear through the access-aware First adapter.
Native content uses WordPress's editor routes. The complete upstream attachment
editor is at `/types/attachment/edit/:id`; `Edit image` opens it from First
media details, with crop/rotate/flip tools and WordPress-native image saving. First content uses the same block
editor with Secure Custom Fields and First's existing REST authorization.
Database tables use First's table forms and relation pickers. Hiding navigation
never grants or revokes access: the server remains the authority.

## Styles

First Admin keeps the upstream look. Where a pinned WordPress package changed
underneath it, the change is the smallest one that keeps that look:

| Change | Why |
|---|---|
| `font-weight: var(--wpds-typography-font-weight-emphasis, 499)` (and `-default, 400`) for `$font-weight-medium`/`-regular` | the pinned `@wordpress/base-styles` removed those variables; the tokens carry the same values |
| Color settings name the background seed `background` and use `@wordpress/theme` directly | upstream's `@first-admin/theme` shim passed the old `bg` seed; WordPress 7.1's `wp-theme` reads `background` |
| The site hub wraps its title in a `<span>` | the upstream stylesheet sizes the link's first span, which the pinned `@wordpress/ui` Link no longer adds |
| `style` on design-system popups and primitives | the pinned Base UI types moved it |
| The page opts in to view transitions (`@view-transition`) | the router starts one on each navigation; without the opt-in the browser aborts it with an error |

Everything else that differs from the retained originals is behaviour: the
mount and subdirectory URLs, First's schema screens, and the AI chat button,
which needs a provider (see External services). First's own screens
(`packages/schema`) use `@wordpress/components` and DataViews with upstream's
spacing.

## WordPress packages instead of copies

Where the WordPress floor (7.1) allows it, First Admin uses WordPress's own
packages instead of the copies the upstream admin carried:

| Was | Now | How it loads |
|---|---|---|
| `packages/theme` (`@first-admin/theme`) | `@wordpress/theme` | WordPress 7.1's `wp-theme` script; `useThemeProviderStyles` is its private API, unlocked as core's packages do. WordPress 7.1 marks that private API deprecated (removal planned for 7.3), so the AI panel and the editor settings need a replacement before First supports 7.3 |
| `packages/views`: `useView`, `loadView`, the view types and preference keys | `@wordpress/views` | bundled into the admin (WordPress 7.1 has no `wp-views` script) |
| `packages/views`: `useViewConfig`, the `DataViews` layout wrapper | stays First's | `useViewConfig` reads First Admin's own fields (tabs, quick and add forms, labels, actions) from `/first-admin/v1/view-config`, which core's endpoint doesn't serve |
| `packages/wp-build` | stays for now | `@wordpress/build` targets WordPress core's admin boot and a newer `@wordpress/theme` than 7.1 ships; it moves with First Admin onto core's boot |

The packages are pinned with the rest in `apps/pnpm-workspace.yaml`. Their former
copies stay recorded in `upstream-inventory.json`, with each retained input.

### Saved list layouts reset once

`@wordpress/views` stores a user's list layout (columns, sort, layout type,
page size) under `dataviews-<kind>-<name>-<tab>` where the copy used
`<kind>-<name>`, and it saves only what the user changed from the default.
Layouts saved before this change are not read: every list opens on its default
layout once, then saves under the new key. Nothing is migrated.

The six lists that change, and how:

| List | Route | What changes |
|---|---|---|
| Users | `/users`, `/users/list/<role>` | each role tab keeps its own layout; the role filter is the tab's and is never saved |
| Posts and pages (each post type) | `/types/<type>/list/<tab>` | each status tab keeps its own layout; the tab's status filter is never saved |
| Plugins | `/plugins/list/<tab>` | each tab (all, active, inactive, …) keeps its own layout |
| Categories, tags and other taxonomies | `/types/<type>/taxonomies/<taxonomy>` | layout saved under `all` |
| Themes | `/design/themes` | layout saved under `all` |
| Navigation menus | `/design/navigation/list` | layout saved under `all` |

Changing a column and changing it back now removes the saved layout rather than
saving a copy of the default. A tab's filters (a role, a status) are applied on
top of whatever the user saved, so a saved filter on the same field can't
override the tab.

## Provenance and updates

The input distribution declares GPL-2.0-or-later. Its archive contains no Git
metadata, so an upstream Git revision could not be verified. The exact input is
recorded in `runtime/admin/upstream-inventory.json`: each original path and
SHA-256, its destination, and the adapter disposition. The input digest is:

```text
06b2a01779baec3292803ad57704981703e4f0783230097746baeb67f456e8cf
```

This digest covers the 1,094 distributable plugin source files; repository agent
instruction files are excluded. It identifies the archive, not a Git commit.
Upstream root configuration/bootstrap and PHP tests are retained under
`upstream-metadata/` as reference material, outside the active plugin loader; `first build` leaves
that folder out of the plugin, as it leaves out the JS workspace `apps/`.
For each adapted file, `upstream-metadata/adapter-originals/` retains its complete
input after namespace and privacy normalization. `retainedSourcePath` and
`normalizedSha256` identify that copy; unchanged inputs point to their active
file. This includes the original image-edit backport: the active attachment
controller uses WordPress's current native implementation instead.
Private tracker links and service references in documentation are redacted.
Dependency packages retain their original notices. The generated
`build/THIRD-PARTY-LICENSES.txt` includes bundled dependency licenses and every
workspace notice.

Local changes use `@first-admin/*` and `first_admin_*` names, the existing First
mount/login/iframe adapter, a schema bridge, native menu merging, widget
registration and compatibility adjustments for the pinned WordPress packages.
The package tree remains intact. Review `adaptedSha256` and `adaptation` in the
inventory before rebasing an upstream file; a matching original hash identifies
an unchanged input. Replace source and rebuild the complete workspace together.

## Build and verification

Use Node 22 or later and pnpm 10.16.0. WordPress dependencies are pinned to one
snapshot in `apps/pnpm-workspace.yaml`; the lockfile pins transitive packages.
Build in a private copy when another worker uses the checkout:

```sh
cd runtime/admin/apps
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm exec jest --runInBand
```

From the repository root, `node --test tests/wp/admin/upstream-drift.test.mjs`
checks every retained input and active adapter against the generated inventory.

`pnpm build` writes the full module registry, route/field/widget registrations,
assets, license bundle and source manifest to `../build`. Commit source and
compiled output together. `php tests/php/vendor_drift.php` checks the committed
admin source digest and license inventory, alongside the repository's other
vendor guards. Two builds from identical inputs must produce identical files.

The existing browser owner is `apps/wp-journey/admin.spec.ts`. Against a
disposable WordPress artifact created by `tests/wp/harness.sh`, run:

```sh
cd runtime/admin/apps
pnpm exec playwright install chromium
FIRST_WP_HARNESS=/path/to/disposable-harness.json \
pnpm exec playwright test --config wp-journey/playwright.config.ts
```

Those journeys execute real WordPress/SCF saves, publish and anonymous reads,
table relations, media upload/edit/delete, role restrictions, native settings,
users/plugins/themes/design/editor routes and classic navigation. The upstream
PHPUnit sources are retained as reference; their original monorepo bootstrap
requires fixtures outside this plugin and is not the standalone test runner.
The pre-existing Jest exclusion for the pinned design-system tabs primitive is
unchanged; it remains a known verification gap.

## External services and examples

The AI-agent package includes its context store, abilities lifecycle, cache
invalidation and provider slot. It includes no AI service. A WordPress plugin
may enable `ai_agent_enabled` through `first_admin_boot_context` and implement
`window.wpOrchestratorAgent.ask`. Missing providers reject requests explicitly.
See the package README for its events and slot contract. Hosted AI execution
and hosted account invitations are not proven by local WordPress tests.

The slot stays unwired on purpose. It needs a model that turns a prompt into
answers and tool calls; First's agent surface (the site's MCP endpoint,
`/wp-json/mcp/first-<app>`, and the app's Abilities) is the tools side of that,
not a model. Wiring the two together would still need a hosted model and its
credentials, which First does not ship. An agent outside the site (Claude Code,
an MCP client) already uses that endpoint and the same Abilities the admin's
screens run, under the same permissions; see `first mcp` and docs/agents.md.

Telemetry calls use an inert compatibility adapter: First sends no upstream
usage events. The three upstream dashboard demonstration widgets retain their
example data and explicitly label it as such. They do not report live traffic,
weather or recent posts. Native plugin/theme catalog installation, update,
mail delivery, external AI providers and publishing services need their own live
provider verification; rendering their routes does not establish those effects.
