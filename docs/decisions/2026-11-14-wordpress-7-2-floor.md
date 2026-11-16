# WordPress 7.2-beta5 is the floor

First required WordPress 7.1 ([2026-11-07](2026-11-07-wp-core-apis.md) kept
it there because 7.2 wasn't out). Ruling, 2026-11-14: First may require a
beta, and the minimum is 7.2-beta5. Nobody runs First in production yet, so
there are no sites to move.

## Why

WordPress 7.2 ships what First otherwise keeps its own copies of: the script
modules `@wordpress/lazy-editor`, `widget-primitives`, `dashboard-init`,
`workflow`, `core-fields` and `core-actions`, the Entity fields and actions
APIs (`wp_register_entity_fields()`, `wp_register_entity_actions()`,
`/wp/v2/entity-fields`, `/wp/v2/entity-actions`), and connectors. Requiring
7.2 lets later changes use those and delete First's copies. This record moves
the floor and the test pins only.

## How a version is compared

`Platform::WORDPRESS` (PHP) and `platform::WORDPRESS` (Rust) are `7.2-beta5`.
The runtime's boot check, `Platform::problems()` and `first doctor` compare
the whole `$wp_version` with PHP's `version_compare` order (Rust:
`wp_plugins::version::at_least`, which matches PHP's). In that order:

| `$wp_version` | Boots |
|---|---|
| `7.2-beta5`, `7.2-beta5-65525` (a nightly after beta 5), `7.2-beta6`, `7.2-RC1`, `7.2`, `7.2.1`, `7.3-alpha-61000` | yes |
| `7.1`, `7.1.4`, `7.2-beta4`, `7.2-alpha-64000` | no |

Core's `is_wp_version_compatible()`, which reads the `Requires at least`
plugin header, drops everything after the first `-` before comparing. With a
`7.2-beta5` header it lets every 7.2 pre-release activate, `7.2-beta4`
included. The header still says `7.2-beta5`, which rejects 7.1. The
runtime's own check catches older 7.2 betas: it shows an admin notice and
doesn't boot.

## Test pins

- `tests/php/wp.php` boots `wordpress-7.2-beta5.zip` from wordpress.org,
  SHA-256 checked.
- The Docker lanes (`tests/wp/compose.yml`, `compose.s3.yml`,
  `tests/identity/compose.yml`, the identity job in `ci.yml`) use Docker
  Hub's `wordpress:beta-7.2-beta5-php<version>-apache` images.
- `first dev` and `first export` ask Studio for `7.2-beta5`.
- The docs site's Playground blueprints use Playground's `beta` build until
  7.2 ships.
- `.github/workflows/wordpress-ahead.yml` still runs the nightly and the
  newest beta or RC against these pins.

When 7.2 ships, the pins move to 7.2 and the blueprint back to `latest`. The
floor stays `7.2-beta5` until a change needs something newer.
