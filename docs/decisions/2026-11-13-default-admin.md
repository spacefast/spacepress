# First Admin is the default admin, at /wp-admin/new/

Date: 2026-11-13. Reverses the earlier ruling "classic wp-admin is the default;
the custom admin stays behind `admin: true`".

## Decision

1. Every build ships `first-admin`. `defineConfig({ admin })` defaults to `true`;
   `admin: false` stays as the opt-out for apps that want only classic wp-admin
   (the EmDash comparisons and the full-site example use it). Nobody runs First
   in production yet, so there is no compatibility path for configs that set
   `admin: true`: it is accepted and means the default.
2. The admin mounts where the upstream admin did, `/wp-admin/new/<route>`, which
   the upstream rewrite rule maps to `wp-admin/admin.php?page=first-admin` with
   the route left in the path. The page is a real wp-admin page: `admin.php`
   authenticates it and builds wp-admin's menus, as upstream. This replaces
   First's front-end mount at `/first-admin/` and its own session check.
3. The rule points outside `index.php`, so WordPress writes it to `.htaccess`.
   The plugin writes it on the first web request after activation or an update,
   because WP-CLI never writes that file. A server that does not apply it sends
   `/wp-admin/new/<route>` to `index.php`, which redirects to the query form
   `admin.php?page=first-admin&p=<route>`; the router already reads both.
4. After login, WordPress's default destination (`/wp-admin/`) becomes
   `/wp-admin/new/`. Any other `redirect_to` is kept, so links into classic
   screens and front-end sign-ins still land where they asked.
5. Classic wp-admin is unchanged. First Admin's sidebar and command palette
   have `Classic admin`; wp-admin's menu has `First`.
6. `/first-admin/<route>` answers with a 301 to `/wp-admin/new/<route>`, query
   kept, for bookmarks and the examples' old links.

## Why

The owner asked for the original admin, at its original URL, with the least
change to upstream code. Mounting inside wp-admin removes First's own login
check and its admin-bar shim, and makes the upstream bootstrap's URL handling
apply unchanged.

## Screens declared once (follow-up)

A screen is a PHP declaration (`first_admin_register_screen()`): a DataViews
list or a DataForm, with actions bound to Abilities. One React component renders
it; First Admin mounts it on `/screens/<id>`, classic wp-admin on its own
`add_submenu_page` page. The declaration is served by one REST route, and every
action runs an Ability through core's run route, so the server is the only
place access is decided. See [admin-screens.md](../admin-screens.md).

Why PHP declarations and not TSX modules: the server must know a screen to
register its wp-admin page and menu entry and to gate it, and the screens First
needs are generated from the schema or from runtime state (schema versions,
table kinds), which PHP has. A TSX module would need a build step per app and a
second registry. DataViews/DataForm shapes and Abilities are the parts core is
standardising (view config in 7.1, server-registered fields and actions next),
so declarations stay portable to those APIs.

Fields and actions map onto WordPress 7.2's server registries
(`wp_register_entity_fields()`, `wp_register_entity_actions()`, checked on the
7.2 beta sources): when present, First Admin registers each screen there as
`firstAdminScreen`/`<id>` and reads them back; on 7.1 the declaration is the
registry. Actions stay bound to Abilities, which core's action schema carries as
extra properties, so a screen keeps working as core's action API grows in 7.3.

## View config and field collections against core

- **View config.** WordPress 7.1 serves `GET /wp/v2/view-config` and runs
  `get_entity_view_config_{kind}_{name}` (`WP_View_Config_Data`). First Admin's
  own controller registered the same route earlier and answered first, so core's
  route and its filter did nothing on a First site. First Admin's controller now
  lives at `/first-admin/v1/view-config` (its fields `quick_edit_form`,
  `add_form`, `labels`, `actions` have no core counterpart). It runs core's
  filter over its configuration, mapping `tabs` ↔ `view_list`, `edit_form` ↔
  `form`, and `default_view`/`default_layouts` as is. `variant` stays: nothing
  in the admin passes it today, and dropping it would change the upstream
  route module. The user and taxonomy configurations upstream registered in its
  bootstrap (and First had lost) are back, in `lib/view-configs.php`.
- **Field collections.** First Admin's field collections
  (`first_admin_register_field_collection()`, `/wp/v2/field-collections`) are
  the model WordPress 7.2 adopts as `wp_register_entity_fields()` and
  `/wp/v2/entity-fields`. Mapping: a collection's `kind`/`name` are the entity's;
  each field definition is a DataViews field in both; the collection's
  `fields_module` is core's `$script_module`. Declared screens already register
  with core when it has the API. When First's floor moves to 7.2, the field
  collections register through core too, and `lib/api/field-collections.php`
  and its controller are deleted.

## Classic wp-admin behind developer mode (follow-up, 2026-11-15)

First Admin is the only admin people see; classic wp-admin is for developers.

1. **Developer mode** is a per-user setting, the user meta `first_admin_developer_mode`, off unless
   set. The user turns it on under Admin on their profile in First Admin (`/profile`), which saves
   it through core's user route (`first_admin_developer_mode` on `/wp/v2/users/<id>`; a user may set
   it where they may edit that user).
2. **Off (the default)**, First Admin's sidebar and command palette have no `Classic admin`, and a
   classic page that the browser opens as a page of its own (`Sec-Fetch-Dest: document`, a GET)
   answers with a redirect to the same page framed in First Admin: the classic dashboard
   (`/wp-admin/`, `index.php`) to `/wp-admin/new/`, the rest to `/wp-admin/new/classic/<slug>`. The
   frame's own request (`Sec-Fetch-Dest: iframe`) and any request that doesn't say it is a page
   (scripts, WP-CLI, REST, a browser without Fetch Metadata) are served as before. Only an allowlist
   of pages redirects (`first_admin_framed_pages`, filterable): the dashboard, Comments, Settings,
   Tools and its pages, Profile, Users, Plugins, Themes, Media, list screens and plugin pages
   (`admin.php?page=…`). Editing (`post.php`, `post-new.php`), uploads (`media-new.php`,
   `async-upload.php`), `admin-ajax.php`, `admin-post.php` and wp-login.php are not on it. First's
   own pages (`admin.php?page=first-admin…`, the app's menu entry) decide for themselves.
3. **On**, classic wp-admin is as before: `Classic admin` in the sidebar and command palette, and its
   pages open on their own.
4. **The frame route is `/classic/<slug>`** (it was `/legacy/<slug>`; the route package is
   `routes/classic-admin`, the PHP `lib/classic-route.php`, the menu filters
   `first_admin_classic_menu_items_exclude` and `first_admin_classic_meta_menu_items_exclude`).
   `/legacy/<slug>` answers with a 301 to `/classic/<slug>`, in the pretty and the query form.
5. **Classic-only screens are in the sidebar**, framed: Settings → Writing, Discussion, Media,
   Permalinks, Privacy and plugin settings pages; Tools (with Site Health, Import, Export, the
   personal-data tools and plugin pages); Comments. Each entry is read from wp-admin's own menu for
   the signed-in user, so a page the user may not open is not listed. Plugin top-level pages were
   already in the sidebar through `/classic/`.
6. **Only what the app uses is shown**, from runtime state rather than a per-app list: Comments
   appears while a collection takes comments (`comments: true`, the only kinds the `comments`
   hardening switch leaves open) or the site has comments to moderate. Plugin and theme installs,
   the file editors and the Customizer are refused by the hardening switches through capabilities
   (`install_plugins`, `edit_themes`, `customize`, …), and every entry that leads to them is gated on
   those capabilities, so none appears.
7. **The app's own wp-admin entry** (`first-<app>`, parent of its globals and table screens) opens
   `/wp-admin/new/collections` instead of an empty page. With `admin: false` it lists the pages
   under it. The table screens and globals under it are unchanged.

Why the redirect keys on `Sec-Fetch-Dest`: the frame and the page ask for the same URL, and the
header is the only thing a browser sends that tells them apart without changing the URL the frame
loads (a query argument would leak into every link and form inside the frame). A browser that sends
no Fetch Metadata gets classic wp-admin unframed, as before; nothing breaks.
