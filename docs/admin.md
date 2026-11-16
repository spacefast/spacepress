# Zero Admin

Set `admin: true` in `defineConfig`, then run `zero build`. The generated
WordPress artifact includes `plugins/zero-admin` with compiled assets. Activate
the artifact's declared dependencies, the Zero runtime and app, then Zero Admin.
Enable pretty permalinks and visit `/zero-admin/`. A subdirectory installation
uses its own prefix, for example `/blog/zero-admin/`.

```ts
import { collection, defineConfig, id, richText, text } from "zero";

const posts = collection({
  id: id(),
  title: text().notNull(),
  body: richText(),
  summary: text(),
}, {
  title: "title",
  content: "body",
  access: { read: "anyone", create: "editor", update: "editor", delete: "admin" },
});

export default defineConfig({
  name: "my-app",
  admin: true,
  collections: { posts },
});
```

Editor asset URLs use WordPress's registered installation URL, including the
subdirectory prefix. Use your normal WordPress account. WordPress owns authentication, capabilities,
REST nonces, users, settings, plugins, themes, media and the block editor.
`Classic admin` opens the complete `/wp-admin/`; its `Zero` menu item returns.
Existing plugin settings and classic plugin screens remain accessible.

## Source scope

The admin includes the complete distributable next-admin / CIAB Admin plugin
package, route, field, dashboard-widget and PHP library trees. This includes
Dashboard, native Posts and Pages, Users, Plugins, Themes, Settings, Design,
Styles, Navigation, taxonomy and comment fields, importers and the AI-agent
integration package. These surfaces are retained alongside Zero's schema-driven
collections, tables, relations, media and globals.

The default `/` route is Zero's collection overview. `/dashboard` opens the
upstream dashboard. The sidebar includes native WordPress content types as well
as Zero collections; mapped types appear through the access-aware Zero adapter.
Native content uses WordPress's editor routes. The complete upstream attachment
editor is at `/types/attachment/edit/:id`; `Edit image` opens it from Zero
media details, with crop/rotate/flip tools and WordPress-native image saving. Zero content uses the same block
editor with Secure Custom Fields and Zero's existing REST authorization.
Database tables use Zero's table forms and relation pickers. Hiding navigation
never grants or revokes access: the server remains the authority.

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
`upstream-metadata/` as reference material, outside the active plugin loader.
For each adapted file, `upstream-metadata/adapter-originals/` retains its complete
input after namespace and privacy normalization. `retainedSourcePath` and
`normalizedSha256` identify that copy; unchanged inputs point to their active
file. This includes the original image-edit backport: the active attachment
controller uses WordPress's current native implementation instead.
Private tracker links and service references in documentation are redacted.
Dependency packages retain their original notices. The generated
`build/THIRD-PARTY-LICENSES.txt` includes bundled dependency licenses and every
workspace notice.

Local changes use `@zero-admin/*` and `zero_admin_*` names, the existing Zero
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
ZERO_WP_HARNESS=/path/to/disposable-harness.json \
ZERO_ADMIN_BROWSER_OUTPUT=/tmp/zero-admin-browser \
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
may enable `ai_agent_enabled` through `zero_admin_boot_context` and implement
`window.wpOrchestratorAgent.ask`. Missing providers reject requests explicitly.
See the package README for its events and slot contract. Hosted AI execution
and hosted account invitations are not proven by local WordPress tests.

Telemetry calls use an inert compatibility adapter: Zero sends no upstream
usage events. The three upstream dashboard demonstration widgets retain their
example data and explicitly label it as such. They do not report live traffic,
weather or recent posts. Native plugin/theme catalog installation, update,
mail delivery, external AI providers and hosting services need their own live
provider verification; rendering their routes does not establish those effects.
