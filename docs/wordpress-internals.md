# WordPress internals TypedPress relies on

Upgrading WordPress must always work. TypedPress uses WordPress's public API wherever there is one:
functions, hooks, the REST server's documented filters, and the public methods of its classes. This
page lists the places where there is no public way, so TypedPress relies on something core doesn't
promise to keep: protected members of the classes TypedPress subclasses, globals, the shape of stored
data, and the internals of two plugins it ships with.

Each entry says where TypedPress uses it, why nothing public does the job, and what to check when a
WordPress release changes it. Two tests keep the list honest. Both read the installed WordPress by
reflection, not source text, so a release that renames, hides or reshapes one of these fails there
by name:

- `tests/php/core_shape_test.php` (in `tests/php/run.sh`): core's classes, globals and stored shapes,
  on the pinned core and, in `.github/workflows/wordpress-ahead.yml`, on the nightly and the next
  beta or release candidate.
- `tests/wp/core-shape.test.ts` (in `tests/wp/run.sh`): the same classes as the web server loads them,
  and Polylang, which only runs on that lane.

When either fails on a new WordPress, that build's job summary in the WordPress-ahead workflow names
the entry. Find it below, read the core change (the summary links the Trac log), and adapt the TypedPress
code it names before the release reaches the floor.

## Core REST controllers TypedPress subclasses

TypedPress's kinds are served on core's own REST routes, so the block editor, wp-admin and every core
client see TypedPress's rules. Core has no extension point for "a post type whose rows another pipeline
owns", so TypedPress subclasses its controllers and overrides the methods that read and write.

| Class | Member TypedPress uses | Where | Why there is no public way |
|---|---|---|---|
| `WP_REST_Posts_Controller` | protected `$meta`, `$post_type`; protected `get_post()`; overrides `get_items`, `get_item`, `create_item`, `update_item`, `delete_item`, their permission checks, `prepare_item_for_response`, `get_collection_params` | `runtime/TypedPress/Wp/PostsController.php` | `rest_controller_class` takes a subclass. The read and write paths have no filter that can replace the query or the save. |
| `WP_REST_Controller` | protected `update_additional_fields_for_object()`; public `get_fields_for_response()`, `prepare_response_for_collection()`; protected `$namespace`, `$rest_base` | `PostsController.php`, `UserMeta.php` (member create), `TableController.php` | Running other plugins' `register_rest_field` update callbacks for a save that TypedPress performs. Core lists those fields only through this protected method. |
| `WP_REST_Meta_Fields` | protected `get_registered_fields()`; `get_value()`, `update_value()` | `runtime/TypedPress/Wp/PostMeta.php` (extends `WP_REST_Post_Meta_Fields`) | Keeping a kind's own fields out of the generic meta path while other plugins' meta still works. |
| `WP_REST_Users_Controller` | the protected `update_additional_fields_for_object()` it inherits, called on core's own instance | `runtime/TypedPress/Wp/UserMeta.php` | As above, for a member TypedPress creates. |
| `WP_REST_Search_Handler` | protected `$type`, `$subtypes`; overrides `search_items`, `prepare_item`, `prepare_item_links` | `runtime/TypedPress/Wp/SearchHandler.php` | `wp_rest_search_handlers` takes handler instances. The base class has no constructor arguments for type and subtypes. |
| `WP_Ability` | overrides `get_meta_item()` | `runtime/TypedPress/Wp/Abilities/TypedPressAbility.php` | An ability hidden from REST discovery (`agents: false`) must still run for the app's own API. `show_in_rest` has no per-request form. |
| `WP_Sitemaps_Provider` | overrides `get_url_list()`, `get_max_num_pages()`; `get_object_subtypes()` | `runtime/TypedPress/Wp/Sitemap.php` | This is core's documented way to add a provider. It's listed because the class is abstract and its method signatures are the contract. |
| `WP_REST_Terms_Controller` | (when #455 lands) protected `$meta`, `get_term()` | `runtime/TypedPress/Wp/TermsController.php` | As for posts, for `taxonomy()` kinds. |

To check on an upgrade: each class's method signatures (argument count, return type) and
visibility, and whether core moved a step of `create_item`/`update_item` that `PostsController`
repeats after its own save (`rest_insert_*`, meta, additional fields, `rest_after_insert_*`).

## Globals and stored shapes

| What | Where | Why there is no public way | To check |
|---|---|---|---|
| `$GLOBALS['wp_rest_additional_fields']`: the fields plugins registered with `register_rest_field` | `runtime/TypedPress/Wp/Kinds.php` (`restField`) | A facade write needs to know whether another plugin's field on a post type is writable, so that core's save can run it. Core has no function that lists registered fields. | That `register_rest_field()` still stores `[$object_type][$field]['update_callback']` there. |
| `$GLOBALS['wp_query']`, `$GLOBALS['wp_the_query']`, `$GLOBALS['post']` replaced with a hand-built `WP_Query` | `runtime/TypedPress/Wp/AppRouter.php` | A `tp/app/` page answers a URL WordPress didn't query. Template tags and the theme read these globals. | That template tags (`is_page`, `the_post`, `get_queried_object`) still read them. |
| Autosaves are revisions named `<parent>-autosave-v1` (`wp_is_post_autosave()`) | `runtime/TypedPress/Wp/Facade.php` (revisions list), `runtime/TypedPress/Wp/WpPostStore.php` (staged versions as `<parent>-autosave-staged-v1`) | Leaving every user's autosaves out of a revisions list (`wp_get_post_autosave()` takes one user), and keeping TypedPress's staged versions apart from them. | The name format, and that `rest_revision_query` still takes `post__not_in`. |
| Direct SQL on `wp_posts`/`wp_postmeta` with `FOR UPDATE` | `runtime/TypedPress/Wp/WpPostStore.php` | Uniqueness checks under a row lock inside TypedPress's transaction. `WP_Query` doesn't lock. | The two tables' columns TypedPress reads (`ID`, `post_type`, `post_status`, `post_name`, `post_title`, `post_parent`, `meta_key`, `meta_value`). |
| The restore order in wp-admin: the `check_admin_referer('restore-post_…')` action, then `wp_restore_post_revision` | `runtime/TypedPress/Wp/EditorSave.php` | Nothing public marks the start of a restore. `wp_restore_post_revision` marks its end. | That `wp-admin/revision.php` still checks that nonce first. |

## Plugins TypedPress ships with

| Plugin internal | Where | Why | To check |
|---|---|---|---|
| The SQLite driver's `create_parser()` and its parser's private `$tokens` (read by reflection) | `runtime/TypedPress/Wp/Connection.php` | The one tokenizer that reads SQL exactly as the driver will execute it. | The driver's release notes when its pin in `tests/fixtures/platform.json` moves. |
| Polylang: `PLL()->model` (`get_language`, `add_language`, `update_default_lang`, `clean_languages_cache`), the `pll_context` filter and `PLL_REST_Request` | `runtime/TypedPress/Wp/Polylang.php`, `runtime/TypedPress/Wp/Runtime.php` | Adding a language and choosing Polylang's REST context for `/__tp/api/v1`. `pll_languages_list()` reads languages but nothing public adds one. | Since Polylang 3.7 the three language methods are its backward-compatibility `PLL_Model::__call`, which forwards to `PLL()->model->languages` (`get`, `add`, `update_default`). A Polylang that drops that shim breaks them, so read its changelog for it when the pin moves, and consider calling `->languages` directly. |

## Not on this list

These are public API, so a release keeps them:
- `rest_do_request` and `rest_get_server()->response_to_data()`;
- the `X-WP-Total` header;
- `rest_request_before_callbacks`, `rest_dispatch_request` and `rest_pre_dispatch`;
- `rest_menu_read_access`;
- the `application_password_*` and `auth_cookie_valid` actions;
- `set_post_thumbnail`, `wp_set_object_terms`, `handle_template` (public on the posts controller);
- `get_editable_roles()`;
- `WP_REST_User_Meta_Fields`.

TypedPress moved to them from internals in #460.
