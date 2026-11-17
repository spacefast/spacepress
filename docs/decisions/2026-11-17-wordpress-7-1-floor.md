# WordPress 7.1 is the floor

Supersedes [2026-11-14-wordpress-7-2-floor](2026-11-14-wordpress-7-2-floor.md).
Ruling, 2026-11-17: TypedPress requires WordPress 7.1, the release Spacefast's
boxes run (its platform lock pins `wordpress-7.1.zip` and its readiness check
wants that exact version). Requiring 7.2-beta5 meant TypedPress could not run on
Spacefast's stable capacity.

## What 7.1 lacks, and what TypedPress does instead

Nothing TypedPress ships needs 7.2. Every 7.2 API it touches is used when
present:

| 7.2 adds | On 7.1 |
|---|---|
| Entity fields and actions registries (`wp_register_entity_fields()`, `wp_register_entity_actions()`) | A TypedPress Admin screen's declaration is its registry ([admin-screens](../admin-screens.md)); `registry` in the screen's REST answer says which served it |
| Typing ability input inside `WP_Ability::execute()` (`sanitize_input`) | The run route types a GET/DELETE query string as a REST argument, `Register::validate` keeps JSON input as sent; `TypedPressAbility::sanitize_input` is never called |
| Editor entity actions registered on the server | The attachment route removes duplicate and trash in the browser |
| Secrets API | Git dispatch reads its token from `TP_GITHUB_DISPATCH_TOKEN` only. Without one, saves queue nothing and `git-dispatch status` names the problem; the hourly sync still runs |
| `core/content-query` | Nothing to hide a kind from; `show_in_abilities` stays `false` |

The script modules the 2026-11-14 record meant to take from core
(`@wordpress/lazy-editor` and the others) stay bundled in TypedPress Admin,
as they still were. The AI client and Connectors are already in 7.1.

## How a version is compared

`Platform::WORDPRESS` (PHP) and `platform::WORDPRESS` (Rust) are `7.1`,
compared with PHP's `version_compare` against the whole `$wp_version`:
`7.1`, `7.1.4`, every 7.2 build and later boot; `7.0.x` and 7.1's own
pre-releases (`7.1-RC1`) don't. The plugin and theme headers say
`Requires at least: 7.1`.

## Test pins

The floor is what the suites run: `tests/php/wp.php` boots
`wordpress-7.1.zip` (SHA-256 checked, the same archive as Spacefast's lock),
the Docker lanes use `wordpress:7.1.0-php<version>-apache`, `typedpress dev`
asks Studio for `7.1`, and the docs site's Playground blueprints use
`latest`. `.github/workflows/wordpress-ahead.yml` still runs the nightly and
the newest beta or RC, so the 7.2 paths stay covered.

Raise the floor again when Spacefast runs the newer release and a change
needs an API it adds.
