# Admin screens: declare once, show in both admins

A TypedPress app has two admins: TypedPress Admin at `/wp-admin/new/` and classic
wp-admin at `/wp-admin/`. A screen declared with `adminScreen()` in TypeScript,
or with `tp_admin_register_screen()` in PHP, appears natively in both. There is one implementation, the React component in
`runtime/admin/apps/packages/screens`, and two hosts:

| | TypedPress Admin | Classic wp-admin |
|---|---|---|
| URL | `/wp-admin/new/screens/<id>` | `/wp-admin/admin.php?page=typedpress-screen-<id>` |
| Menu | an entry in the sidebar (`menu`) | `add_menu_page` / `add_submenu_page` under `classic.parent` |
| Chrome | TypedPress Admin's page header | wp-admin's `.wrap` and title, `@wordpress/components` styling |
| Body | the same component, DataViews (list) or DataForm (form) | the same |

Both hosts read the declaration from `GET /wp-json/typedpress-admin/v1/screens/<id>`
and run actions as Abilities through core's run route
(`/wp-json/wp-abilities/v1/abilities/<name>/run`). Neither host decides access:
the screen's `capability` gates its page and its declaration, and each ability
checks its own permission when it runs. A user who may open the screen but not
run an action gets the ability's refusal, shown as an error, in either admin.

## From TypeScript

Export `adminScreen()` from `typedpress.config.ts` or any file under `tp/`, as
you would an action. The export name in kebab case is the screen's id, so
`pendingOrders` is `/wp-admin/new/screens/pending-orders` and
`admin.php?page=typedpress-screen-pending-orders`.

```ts
import { action, adminScreen, item, integer } from "typedpress";

export const listPending = action({
  input: {},
  access: "editor",
  readonly: true,                        // a screen reads through readonly actions only
  async handler() {
    return { rows: await db.query.orders.findMany({ where: { shipped: false }, limit: 100 }) };
  },
});

export const markShipped = action({
  input: { id: integer() },
  access: "editor",
  async handler({ id }) { /* … */ },
});

export const pendingOrders = adminScreen({
  title: "Pending orders",
  description: "Orders waiting to ship.",
  access: "editor",                      // or capability: "edit_others_posts"
  view: {
    action: listPending,
    items: "rows",                        // where the list is in the output
    fields: {
      id: { label: "Order", type: "integer" },
      total: { label: "Total", type: "number" },
      shipped: { label: "Shipped", type: "boolean" },
    },
    layout: { type: "table", titleField: "id", fields: ["total", "shipped"] },
  },
  actions: [
    { id: "ship", label: "Mark shipped", action: markShipped, input: { id: item("id") } },
  ],
  menu: { icon: "dashicons-cart" },     // false: not in TypedPress Admin's sidebar
  classic: { parent: "tools.php" },     // false: not in wp-admin
  data: ["Shipping runs at 4pm."],
});
```

It is the PHP declaration below, typed, with action references in place of
ability names:

| TypeScript | PHP declaration |
|---|---|
| `view.action: listPending` | `view.ability: '<app>/list-pending'` |
| `fields: { id: { label } }` | `fields: [ ['id' => 'id', 'label' => …] ]` |
| `item("id")` | `'{item.id}'` |
| `access: "editor"` | `capability: 'edit_others_posts'` (`admin` → `manage_options`, `author` → `edit_posts`, `subscriber` and `authenticated` → `read`) |
| `capability: "…"` | `capability: '…'` |
| `actions[].destructive` left out | the action's own `destructive` |

The build refuses, at the line and column, with a suggested fix:

- an action reference that isn't an exported action, or an action with
  `agents: false` (it has no Ability) or a `signature`;
- a `view.action` or `form.action` that isn't `readonly: true`;
- a field id in `layout` (`fields`, `titleField`, `mediaField`,
  `descriptionField`, `sort.field`) that `fields` doesn't declare, and a field
  `type` DataViews doesn't have;
- an action `input` key the action doesn't take, a required input left out,
  and `item("x")` where `x` isn't a field of the screen (or the item key), or in
  the list's own `input`, which runs before there are rows;
- both `view` and `form`, neither, both `access` and `capability`, an unknown
  option, an id TypedPress uses itself (`table-*`, `schema-versions`), and an
  `adminScreen()` that isn't exported.

The build writes the declarations into `schema.php` (`screens`). The app
plugin passes each one to `tp_admin_register_screen()` on
`tp_admin_screens`. With `admin: false` there is no TypedPress Admin, so the
build keeps them and nothing registers them. A TypeScript screen and a PHP
screen share the one registry and the same REST route. `data` is fixed
strings here; a value computed per request needs a PHP screen. A plugin
package (`definePlugin`) can't declare screens yet.

## From PHP

Register on the `tp_admin_screens` action, from a plugin, the runtime or a
must-use plugin:

```php
add_action( 'tp_admin_screens', static function () {
    tp_admin_register_screen( 'comment-review', array(
        'title'       => 'Comment review',
        'description' => 'Comments waiting for approval.',
        'capability'  => 'read',
        'classic'     => array( 'parent' => 'edit-comments.php' ), // false: not in wp-admin
        'menu'        => array( 'icon' => 'dashicons-admin-comments' ), // false: not in TypedPress Admin's sidebar
        'view'        => array(
            'ability' => 'blog/comments-list',     // read-only: returns the items
            'input'   => array( 'limit' => 100 ),
            'items'   => 'rows',                    // where the list is in the output
            'id'      => 'id',
            'fields'  => array(
                array( 'id' => 'name', 'label' => 'Name' ),
                array( 'id' => 'body', 'label' => 'Comment' ),
                array( 'id' => 'approved', 'label' => 'Approved', 'type' => 'boolean' ),
            ),
            'layout'  => array( 'type' => 'table', 'titleField' => 'name', 'fields' => array( 'body', 'approved' ) ),
        ),
        'actions'     => array(
            array(
                'id'      => 'approve',
                'label'   => 'Approve',
                'ability' => 'blog/comments-update',
                'input'   => array( 'id' => '{item.id}', 'patch' => array( 'approved' => true ) ),
            ),
        ),
        'data'        => array( 'Approving a comment publishes it.' ), // or a callable
    ) );
} );
```

- `view` is a list: `fields` are DataViews fields (`id`, `label`, `type` of
  `text`, `integer`, `number`, `boolean`, `datetime` or `array`, optional
  `elements`), `layout` is a DataViews view (`type`, `fields`, `titleField`,
  `sort`, `perPage`). Paging and search run in the browser over what the
  ability returned, so a list ability should return a bounded list.
- `form` instead of `view` is a form: `ability` returns the values (`item` is
  the path to them), `fields` and `layout` are a DataForm, and `submit` is an
  action that receives the edited values as `{item.<field>}`.
- `actions` run one ability each. String values in `input` that are exactly
  `{item.<path>}` take the item's value with its type. `destructive` marks the
  action; `confirm` asks a sentence first. The HTTP method comes from the
  ability's annotations (read-only GET, destructive and idempotent DELETE,
  otherwise POST), as core's run route requires.
- `data` is shown above the body: a string, a list of strings, or a callable
  that returns either, evaluated per request for the signed-in user.

## A route module of your own

A plugin whose page isn't a list or a form can ship its own React route module
and register it in TypedPress Admin from PHP. `tp_admin_register_admin_route()`
(`runtime/admin/lib/api/routes.php`) adds a route to the admin's router, and
`tp_admin_register_menu_item()` adds its sidebar entry. Call both on
`tp_admin_init`, which runs only when TypedPress Admin draws its page; it
registers its own routes there too:

```php
add_action( 'tp_admin_init', static function () {
    // The page: a script module that exports `stage` (the component) and, optionally, `inspector`,
    // as TypedPress Admin's own built routes do (runtime/admin/build/routes/*/content.js).
    wp_register_script_module( 'acme-shipping/board', plugins_url( 'build/board.js', __FILE__ ), array( '@wordpress/element' ), '1.0.0' );
    tp_admin_register_admin_route( '/shipping/board', 'acme-shipping/board' );
    if ( current_user_can( 'edit_others_posts' ) ) {
        tp_admin_register_menu_item( 'acme-shipping', array(
            'to'    => '/shipping/board',
            'label' => 'Shipping board',
            'icon'  => 'dashicons-car',
        ) );
    }
} );
```

`tp_admin_register_admin_route( $path, $content_module, $route_module, $before_load, $static_data, $gc_time )`
takes the route's content module, an optional route module (its `loader` and
`beforeLoad`) or both. The page appears only in TypedPress Admin, and access is up
to the plugin: gate the menu item, and check permissions in every REST route
or ability the module calls. A screen is the better fit whenever the page is a
list or a form.

## Screens TypedPress declares

| Screen | Where | Through |
|---|---|---|
| Schema versions (`runtimeSchema: true`) | Tools in wp-admin; TypedPress Admin's sidebar | `<app>/schema-read` |
| Each `table()` kind (`table-<name>`) | under the app's menu in wp-admin; TypedPress Admin lists it under Collections | `<app>/<kind>-list`, `<app>/<kind>-delete` |

Collections keep wp-admin's own post screens and TypedPress Admin's collection
routes. Agent credentials stay fields on core's application-password form in
the user profile, where WordPress puts application passwords.

## For the staged-versions screens

A compare/promote screen is a list over a read-only ability that returns the
staged changes, with item actions bound to the promote and discard abilities:

```php
tp_admin_register_screen( 'staged-' . $kind, array(
    'title'      => 'Staged changes',
    'capability' => 'edit_posts',
    'classic'    => array( 'parent' => 'edit.php?post_type=' . $post_type ),
    'view'       => array( 'ability' => "$app/$k-staged-list", 'items' => 'rows', 'fields' => /* … */ ),
    'actions'    => array(
        array( 'id' => 'promote', 'label' => 'Promote', 'ability' => "$app/$k-staged-promote", 'input' => array( 'id' => '{item.id}' ) ),
        array( 'id' => 'discard', 'label' => 'Discard', 'ability' => "$app/$k-staged-discard", 'input' => array( 'id' => '{item.id}' ), 'destructive' => true, 'confirm' => 'Discard this staged change?' ),
    ),
) );
```

The ability names here are placeholders for whatever that lane registers; the
screen needs only that they exist and carry their own permission checks.

## WordPress core's fields and actions registries

WordPress 7.2 keeps fields and actions per entity on the server:
`wp_register_entity_fields()` on `wp_entity_fields_api_init`, served at
`/wp/v2/entity-fields`, and `wp_register_entity_actions()` on
`wp_entity_actions_api_init`, served at `/wp/v2/entity-actions` (both in 7.2
beta; the actions API is still being completed for the editors in 7.3). A
screen's fields and actions are already in those shapes, so:

- When the running WordPress has the functions, TypedPress Admin registers every
  screen's fields and actions there, as the entity `tpAdminScreen` /
  `<id>` with origin `typedpress-admin`, and the screen reads them back from core.
  Another plugin can then adjust them with core's own
  `wp_update_entity_fields()` and `wp_unregister_entity_*()`; an action it adds
  without an `ability` is skipped by this screen, since it would need its own
  script module.
- On a WordPress without them, such as 7.1 (TypedPress's floor), the
  declaration is the registry. The screen is
  the same; `GET /wp-json/typedpress-admin/v1/screens/<id>` says which one served it
  in `registry`.

Actions keep `ability` and `input` next to core's properties (`id`, `label`,
`isPrimary`, `supportsBulk`, `context`); core's action schema allows extra
properties. The Ability stays the thing that runs and checks permission.

View layout (`view.layout`, `form.layout`) uses the same DataViews/DataForm
shapes as core's view config (`wp_get_entity_view_config()`, the
`get_entity_view_config_{kind}_{name}` filter, `GET /wp/v2/view-config`, since
7.1). That endpoint serves `postType`, `taxonomy` and `root` entities; a
screen's layout stays in the declaration until core takes arbitrary entities.

## Styles

Both hosts read WordPress's admin design tokens (`--wpds-*`). On classic pages
the screen enqueues core's `wp-theme` style (7.1's `design-tokens.css`); TypedPress
Admin sets the same tokens through its theme provider. Spacing, borders and
radii in the screen use those tokens, with the upstream values as fallbacks.
