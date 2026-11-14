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
