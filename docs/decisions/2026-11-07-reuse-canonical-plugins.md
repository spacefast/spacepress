# Reuse WordPress core and canonical plugins before writing our own

Zero runs only inside WordPress. Before keeping hand-written runtime code, we
check for a replacement in this order: WordPress core (7.1.4 is current; 7.2
is at beta 4 and unreleased), then plugins the core team maintains, then
plugins Automattic maintains. Action Scheduler, MCP Adapter and Secure Custom
Fields are already platform pins. This record covers `runtime/Zero`,
`runtime/identity`, `runtime/pages`, `runtime/wp-plugin` and the plugin
catalog (`src/platform.rs`). Vendored trees, the database layer, the core-API
swaps and build I/O belong to other changes.

Upstream facts were checked on 2026-11-07 against wordpress.org SVN and the
plugin API, GitHub releases, and `wordpress-develop` at the 7.1.4 tag.

## Decisions

| Zero code | Candidate (maintainer, version, licence) | Covers Zero's needs? | Decision |
| --- | --- | --- | --- |
| `runtime/Zero/Media/Images.php:23-71`: a port of `image_resize_dimensions()` and `wp_constrain_dimensions()` | WordPress core 7.1 `image_resize_dimensions()`, `wp_constrain_dimensions()` (GPL-2.0-or-later) | Yes. Core computes the same rectangle. Zero only moves the crop origin to the focal point. Calling core also applies the `image_resize_dimensions`, `wp_constrain_dimensions` and `wp_image_resize_identical_dimensions` filters, as core's own sizes do. | **Replace.** Zero keeps only the focal shift. |
| `runtime/identity/src/Maintenance.php:17-83`: polls a deliveries table on an hourly WP-Cron event, with a 2-minute lease and a batch of 30 | Action Scheduler 4.2.0 (Automattic/WooCommerce, GPL-3.0; already a platform pin, wordpress.org ZIP checksum `a360712a…4551`) | Partly. Action Scheduler claims, runs and logs each delivery when it is due, so a retry no longer waits up to an hour for WP-Cron. It has no retry or backoff of its own (4.2.0 source; issue #612 was closed without shipping), so the backoff schedule stays in Zero. | **Replace the queue.** Each delivery is one Action Scheduler action. A delivery schedules its next attempt before it posts, so a crash mid-request still leaves a retry. The deliveries table stays as the delivery record that the admin screen and `webhooks` list. Expired-row cleanup becomes a recurring Action Scheduler action. `zero-identity` now declares `Requires Plugins: action-scheduler`. |
| `runtime/identity` webhooks vs `runtime/Zero/Jobs/Webhooks.php` | Zero's own job runner | No. Identity runs without an app (and without `zero-runtime`). Zero's jobs live in an app's tables. | **Keep separate.** Both now schedule on Action Scheduler. |
| `runtime/Zero/Jobs/Runner.php:21-22,104-126`: retry and backoff | Action Scheduler 4.2.0 | No. It has no retries (as above). Its 4.0 change only purges failed actions after three months. | **Keep.** |
| `runtime/identity/src/Mfa.php` (111 lines): TOTP through `spomky-labs/otphp` 11.5.0 (MIT, 120 KB) | Two Factor 0.17.0 (WordPress core team, GPL-2.0-or-later, 2026-09-25): TOTP, backup codes, email | No, not as it ships. (1) It stores the TOTP secret as plain user meta (`_two_factor_totp_key`); identity seals it with the site salts (`docs/identity-security.md`). (2) It accepts ±4 time steps (±2 minutes) through a site-wide filter; identity accepts only the current step. (3) Its backup codes are 8 digits, bcrypt-hashed in one meta array and checked in a loop; identity uses 12-character tokens, each in its own row. (4) Activating it adds a second enrolment surface: its own wp-login step, profile screen and `/two-factor/1.0` REST routes. (5) Dropping otphp saves 120 KB of the 9.2 MB identity vendor tree. (6) Identity's MFA is wired through `Api.php`, which PR #137 is changing. | **Keep for now.** Revisit if Two Factor gains a provider API that can store sealed secrets. Any switch also needs a data migration and goes after #137. |
| `runtime/identity/src/Passkeys.php` (265 lines) on `web-auth/webauthn-lib` 5.3.9 plus Symfony serializer and related packages (MIT; about 7.5 MB of the 9.2 MB tree) | Core 7.1 and 7.2 trunk: no WebAuthn. Two Factor: passkey PRs #427 and #916 are still open. "Two-Factor Provider: WebAuthn" 2.6.2 is by an independent author (MIT). Automattic `passkey-poc` is archived. | Nothing canonical exists. | **Keep.** Revisit when Two Factor merges passkeys or core ships WebAuthn. |
| `runtime/identity/src/OAuth.php`, `Keys.php`, `Bearer.php`, `Protocol/`: the OIDC issuer | OpenID Connect Server 2.0.3 (Automattic, GPL-2.0, bshaffer/oauth2-server-php) | No. It has no refresh tokens, so no rotation or reuse detection. Clients are defined only through constants and filters, so there is no registration from the CLI or admin screen. Public-client PKCE, guest upgrade and per-application origins are not covered either. | **Keep.** |
| `runtime/Zero/Services/Mail.php:24-66`: optional SMTP transport | Core: none. Core team and Automattic: none (all 134 Automattic and 55 WordPress.org-authored plugins checked; Jetpack has no SMTP) | Nothing canonical exists. With no `ZERO_SERVICES_SMTP_HOST`, existing mail plugins stay in charge. | **Keep.** |
| `runtime/Zero/Abilities/Module.php`, `runtime/Zero/Wp/Abilities/*` | Abilities API in core since 6.9 (`wp_register_ability`, `wp-abilities/v1`). The feature plugin is archived. | Zero already registers through core's API and runs through `WP_Ability::execute()`. What remains is Zero's own work: operation descriptors, JSON Schema derivation and the input-fidelity bracket. | **Keep.** The 7.1 `wp_ability_normalize_input` filter could replace the `rest_pre_dispatch` raw-input bracket in `Register.php:113-161`. That is a separate change with its own Docker suite. |
| `wp zero abilities` / `wp zero run` (`Abilities/Module.php:51-73`) | `wp ability list|run` (wp-cli/ability-command 1.0.4, WP-CLI team) | No. It is only in the WP-CLI nightly bundle; stable 2.12.0 predates it. `wp ability run` also decodes `--input` with `json_decode(…, true)`, which turns a nested `{}` into `[]`, and `tests/wp/abilities.test.ts` relies on keeping `{}`. | **Keep** until a stable WP-CLI bundles the command. Then point users at `wp ability` and keep only what Zero adds. |
| `runtime/identity/src/Security.php` `seal()` / `open()` | Core Secrets API (7.2 trunk only) | Not released. | **Follow-up** after 7.2 ships. The file belongs to the core-API change. |
| `runtime/Zero/Jobs/Outbox.php`, `Receipts.php`: (job, key) dedupe | Action Scheduler unique actions (atomic since 4.2) | No. Action Scheduler's uniqueness is per hook, args and group, and is never released when an action fails. Zero's key frees up when a job fails or finishes. | **Keep.** |
| `runtime/Zero/Services/Payments.php` | WooCommerce Stripe Gateway (Automattic) | No. It requires WooCommerce and its order model. | **Keep.** |
| Platform pins (`src/platform.rs`) | SCF 6.9.7, Action Scheduler 4.2.0, MCP Adapter 0.7.1, Polylang 3.9 | The first three are the latest releases. SQLite Database Integration 3.1.3 shipped on 2026-11-03, but `zero dev` gets it from Studio CLI. Performance Lab 4.2.0 modules are all front-end or image work, and Performant Translations is mostly in core. Preferred Languages is user-language fallback, not content translation. | **No catalog change.** |

## Consequences

- Identity webhooks retry when they are due instead of on the next hourly
  WP-Cron run. Operators run due deliveries with
  `wp action-scheduler run --group=zero-identity`. `wp zero-identity
  maintenance` now only removes expired rows.
- `zero-identity` depends on Action Scheduler like `zero-runtime` does.
  `zero build` already installs it, and the identity test stack installs the
  same pinned ZIP.
- Image sizes follow core's resize filters. A site that changes core's
  rectangles (to allow upscaling, for example) changes Zero's renditions the
  same way.
