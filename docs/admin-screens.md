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

## Relation to WordPress core

Core 7.1 serves view configurations for its own entities
(`wp_get_entity_view_config()`, the `get_entity_view_config_{kind}_{name}`
filter, `GET /wp/v2/view-config`), and its next releases move fields and
actions to the server. A screen's `view.layout` and `form.layout` use the same
DataViews/DataForm shapes, and its actions are Abilities, so a screen can move
onto those APIs when core exposes them for arbitrary screens; the declaration
would not change.
