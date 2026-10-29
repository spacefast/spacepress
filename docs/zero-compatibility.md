# Zero compatibility and migration coverage

The compatibility baseline is the original `@spacefast/zero` and
`@spacefast/zero-compile` 0.8.1 authoring, client, compiler and runtime contracts.
The dashboard is not the whole product. The Rust compiler's accepted config
surface is also not evidence that every runtime feature is implemented.

Zero runs on WordPress using its posts, metadata, attachments, users, block
editor, revisions and plugin lifecycle. Compiling a deployable `wp-content`
tree does not replace WordPress core or execute a plugin's installation hooks.
Extra plugins still depend on the deployed WordPress/PHP environment, compatible
themes, their own activation and any external services they require. Standalone
PHP provides the Zero API; it cannot run arbitrary WordPress plugins.

## Original Zero feature inventory

This inventory separates existing Rust/PHP behavior, the phase-2 plan, and
additional legacy compatibility work. A migration is complete only when data,
permissions, routes, browser behavior and failure semantics are preserved or
explicitly changed with the application's owner.

| Original Zero 0.8.1 capability | Current Rust/PHP position | Migration work still required |
| --- | --- | --- |
| Capsule content fields, labels, `publicRead` | Primitive fields and enums can be imported; compiler supports richer fields than the importer | Add asset/reference/block conversions with data and permission proofs; editor field metadata mapping |
| Native `posts`, `pages`, `media` ownership | New content collections are `zero_<name>` CPTs; media is built in | Explicit native-store adoption and stable route/data mapping; importer refuses these legacy stores |
| `table`, `string`, `number`, `boolean`, `userId`, `id`, defaults, optional fields | Drizzle-style collections use numeric IDs and nullable fields | Preserve branded string IDs, reference/user identities, implicit timestamps, absent-versus-null/default behavior; no automatic table rewrite yet |
| Named indexes, `by_creation`, range cursors and count | SQL filters/order/limit/offset and relations exist | Compatible named-index/cursor API and deterministic pagination under changes |
| Queries, mutations, actions and their execution contexts | Hooks/actions compile to PHP; the request pipeline uses transactions | Preserve read-only queries/actions, mutation atomicity, action nontransactional effects, per-handler limits and return/error shapes; the action APIs are not equivalent |
| Custom method/path endpoints, read-only overrides, response helpers | Generated collection/action REST routes exist | Endpoint compilation, HTTP response/header semantics and collision checks shared with page routing |
| Markdown/HTML/TSX documents and `pages/` file routes | Public assets can be copied; phase 2 plans record sync | Page compiler, `[id]`/catchall precedence, route ownership, `_pages` response templates and reload/client-navigation parity |
| Gutenberg TSX serialization, islands, client pages and layouts | No old TSX/island compiler in this Rust branch | Client build boundary, hydration, CSS/assets, dynamic-block rendering and code-owned versus editor-owned pages |
| Canonical HTML edits, sealed content-model releases, rollback | Revisions exist; phase 2 plans content sync | Source/editor conflict protocol, writeback, byte verification, pinned version rendering and content-model rollback |
| Shared context document and live Gutenberg collaboration | WordPress editor integration exists for collections | Context block binding, live editing/save arbitration and collaborative draft service integration |
| Typed client, Preact/React hooks, subscriptions, invalidation | Dependency-free generated REST client exists | Old hook/loading/error contracts, realtime transport, invalidation rules, router and UI/context/kit/chart adapters |
| Guests, signed-in users, atomic ownership transfer | Basic WordPress/standalone identity exists; phase 2 plans the identity plugin and frontend auth | Guest continuity, `onGuestUpgrade`, userId transfer atomicity and original app-user/session clients |
| Sign-in providers, revocation, SSR session verification | Full identity integration is pending in phase 2 | Provider configuration and account/client mappings; confirm which behaviors came from platform services |
| Private storage, upload URLs, revocable public read keys | Public media exists; phase 2 plans private file buckets | Storage API/key migration and revocation/authorization tests; uploads are not automatically migrated |
| SHA/HMAC, timing-safe comparisons, secret-named crypto, EdDSA tokens | Not exposed through the old handler context API | PHP implementations and secret-boundary/key-rotation parity before migrating handlers |
| Connector authority (`team`/`owner`/`visitor`), email, fetch and spam services | Old service context has no equivalent here | Explicit PHP service adapters, authorization, credential ownership and failure/idempotency contracts |
| Ability catalogs and typed CLI calls | Phase 2 plans WordPress Abilities + MCP | Preserve names/schema/capabilities, platform/content catalog composition and original CLI discovery/call behavior |
| Server environment, local dev identities, publish/sealed releases | Rust build/check/dev and PHP migrations exist | Secret injection, environment differences, deployment activation/rollback and release validation integration |

The phase-2 plan includes field access, content sync, jobs/outbox/webhooks,
frontend auth, Abilities/MCP, image/private-file features and localization.
Those lanes need their runtime tests and integration; accepting declarations in
schema v3 is not completion. Pages/islands/realtime, legacy table semantics and
the platform service/release contracts above require additional work beyond
those lanes. Keep the PHP-only request runtime; build and import logic stay Rust.

## Comparison with other CMS authoring models

The immediate gaps are behavioral, not extra field spellings:

| Source ecosystem | Existing Zero direction | Missing for a faithful migration |
| --- | --- | --- |
| WordPress | Native PHP plugin runtime, posts/meta/media/editor/revisions; split runtime/app artifacts, exact plugin resource acquisition and platform diagnostics | Deployment activation, native legacy-store adoption and tested compatibility of deployed third-party plugins |
| EmDash | Primitive seed schema import and planned content sync/localization | Portable Text/custom blocks, seeded documents/assets, taxonomies, menus, widgets, settings, routes and publication semantics |
| Payload | Collections, typed fields, access/hooks/actions, globals, drafts/revisions; primitive config import | Execute neither Payload callbacks nor plugins automatically; port hook/access behavior, relationships/uploads, nested fields, Lexical content, auth and data IDs |
| Sanity | Primitive document schema import; structured fields in Zero's API | Portable Text/custom annotations, named object/array/reference types, validation chains, live query/client behavior, localization and dataset/asset migration |

Official schema references used for the importer:

- [EmDash seed definitions](https://github.com/emdash-cms/emdash/blob/403e4eb6c09704f808a5301235eda98dda41b753/packages/core/src/seed/types.ts) and [export command](https://github.com/emdash-cms/emdash/blob/403e4eb6c09704f808a5301235eda98dda41b753/packages/core/src/cli/commands/export-seed.ts).
- [Payload config definitions](https://github.com/payloadcms/payload/blob/ae600cf5a6a8aa29a7f88ec6141cb755bf6c0bac/packages/payload/src/config/types.ts), [Payload configuration](https://payloadcms.com/docs/configuration/overview), [fields](https://payloadcms.com/docs/fields/overview) and [access control](https://payloadcms.com/docs/access-control/overview).
- [Sanity schema types](https://www.sanity.io/docs/studio/schema-types), [validation](https://www.sanity.io/docs/studio/validation) and [configuration types](https://github.com/sanity-io/sanity/blob/126f2bd330f84f0e4ee9157c505c37b03bb3fb34/packages/sanity/src/core/config/types.ts).

No upstream translator implementation is copied. Existing legacy importers emit
the old content model; their output is not a new `zero.config.ts`. Rich text,
callbacks and unknown options must be converted deliberately, not stripped to
make a migration appear successful.

## Completion gate for full legacy support

The [config importer](config-migration.md) is the first migration step, with
explicit refusal for unsupported behavior. Full application support requires:

1. An inventory of the application's capsules, pages, clients, assets and
   external service requirements.
2. Implementations of each missing PHP/runtime and Rust/build contract above,
   with tests against legacy behavior.
3. A data migration preserving IDs/references/ownership/URLs, rich content and
   private file permissions, plus a recoverable cutover.
4. A migrated application proof covering editor changes, client navigation,
   subscriptions, identity upgrade, publication and rollback.

Until those gates hold, the project must not claim all original Zero features
are supported or that config import alone migrates an application.
