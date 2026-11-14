# Admin screens: declare once, show in both admins

A First app has two admins: First Admin at `/wp-admin/new/` and classic
wp-admin at `/wp-admin/`. A screen declared with `first_admin_register_screen()`
appears natively in both. There is one implementation, the React component in
`runtime/admin/apps/packages/screens`, and two hosts:

| | First Admin | Classic wp-admin |
|---|---|---|
| URL | `/wp-admin/new/screens/<id>` | `/wp-admin/admin.php?page=first-screen-<id>` |
| Menu | an entry in the sidebar (`menu`) | `add_menu_page` / `add_submenu_page` under `classic.parent` |
| Chrome | First Admin's page header | wp-admin's `.wrap` and title, `@wordpress/components` styling |
| Body | the same component, DataViews (list) or DataForm (form) | the same |

Both hosts read the declaration from `GET /wp-json/first-admin/v1/screens/<id>`
and run actions as Abilities through core's run route
(`/wp-json/wp-abilities/v1/abilities/<name>/run`). Neither host decides access:
the screen's `capability` gates its page and its declaration, and each ability
checks its own permission when it runs. A user who may open the screen but not
run an action gets the ability's refusal, shown as an error, in either admin.

## Declaring a screen

Register on the `first_admin_screens` action, from a plugin, the runtime or a
must-use plugin:

```php
add_action( 'first_admin_screens', static function () {
    first_admin_register_screen( 'comment-review', array(
        'title'       => 'Comment review',
        'description' => 'Comments waiting for approval.',
        'capability'  => 'read',
        'classic'     => array( 'parent' => 'edit-comments.php' ), // false: not in wp-admin
        'menu'        => array( 'icon' => 'dashicons-admin-comments' ), // false: not in First Admin's sidebar
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

## Screens First declares

| Screen | Where | Through |
|---|---|---|
| Schema versions (`runtimeSchema: true`) | Tools in wp-admin; First Admin's sidebar | `<app>/schema-read` |
| Each `table()` kind (`table-<name>`) | under the app's menu in wp-admin; First Admin lists it under Collections | `<app>/<kind>-list`, `<app>/<kind>-delete` |

Collections keep wp-admin's own post screens and First Admin's collection
routes. Agent credentials stay fields on core's application-password form in
the user profile, where WordPress puts application passwords.

## For the staged-versions screens

A compare/promote screen is a list over a read-only ability that returns the
staged changes, with item actions bound to the promote and discard abilities:

```php
first_admin_register_screen( 'staged-' . $kind, array(
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

- When the running WordPress has the functions, First Admin registers every
  screen's fields and actions there, as the entity `firstAdminScreen` /
  `<id>` with origin `first-admin`, and the screen reads them back from core.
  Another plugin can then adjust them with core's own
  `wp_update_entity_fields()` and `wp_unregister_entity_*()`; an action it adds
  without an `ability` is skipped by this screen, since it would need its own
  script module.
- On WordPress 7.1 (First's floor) the declaration is the registry. The screen
  is the same; `GET /wp-json/first-admin/v1/screens/<id>` says which one served
  it in `registry`.

Actions keep `ability` and `input` next to core's properties (`id`, `label`,
`isPrimary`, `supportsBulk`, `context`); core's action schema allows extra
properties. The Ability stays the thing that runs and checks permission.

View layout (`view.layout`, `form.layout`) uses the same DataViews/DataForm
shapes as core's view config (`wp_get_entity_view_config()`, the
`get_entity_view_config_{kind}_{name}` filter, `GET /wp/v2/view-config`, in
7.1). That endpoint serves `postType`, `taxonomy` and `root` entities; a
screen's layout stays in the declaration until core takes arbitrary entities.

## Styles

Both hosts read WordPress's admin design tokens (`--wpds-*`). On classic pages
the screen enqueues core's `wp-theme` style (7.1's `design-tokens.css`); First
Admin sets the same tokens through its theme provider. Spacing, borders and
radii in the screen use those tokens, with the upstream values as fallbacks.
