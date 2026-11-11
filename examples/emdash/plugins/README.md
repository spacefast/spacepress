# Official EmDash plugins on native First + WordPress

This runnable workshop maps the actual plugin examples at
[`emdash-cms/emdash@1824902c0c383c052b623528799427b8a5ff75d0`](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0).
The original implementations use EmDash's plugin context and, for several
examples, Cloudflare infrastructure. Here the local equivalents use a compiled
First collection/action API, native WordPress hooks and Secure Custom Fields,
WordPress posts/options, core Abilities and the real MCP Adapter. They are
original implementations of the mapped behavior, not bundled EmDash plugins.
[The upstream MIT notice](LICENSE.upstream) is preserved with the example and
copied into the installed plugin.

From the repository root, with the baseline binary available:

```sh
./target/debug/first check examples/emdash/plugins --json
node --test examples/emdash/plugins/acceptance.test.mjs
node examples/emdash/plugins/studio.mjs
```

`FIRST_BIN=/absolute/path/to/first` selects another built binary. Acceptance and the
interactive launcher each create their own disposable project, random port,
`.first/dev` receipt, database, uploads and Studio registration. No Docker or host
PHP server is used. The launcher seeds a published story and a working two-page
contact form, prints the publication/admin URLs and exact cleanup commands, and
leaves that site running. It never targets an existing project. The acceptance
runner stops and deletes only its own exact Studio site and removes its project;
its separate `/tmp/first-official-plugins-*-evidence/` directory retains results,
rendered publication HTML and cleanup proof.

The normal WordPress credentials created by `first dev` remain available. The
seed application password is revoked after seeding. Plugins, Settings, native
content editing, media and other installed plugins stay available. Nothing
replaces the admin or changes unrelated plugin settings.

## Source and behavior mapping

Every upstream link below is pinned. “Local” means the described behavior runs
against the disposable real WordPress site. It does not imply provider or
sandbox equivalence.

| Upstream example | Actual upstream behavior | Local implementation and qualification boundary |
| --- | --- | --- |
| [demos/plugins-demo](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/demos/plugins-demo) | Composes audit-log, webhook-notifier, embeds and api-test; public post list/detail and embed test page | The seeded workshop publication, entry view, native admin links and the four corresponding local features below. |
| [field-kit](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/field-kit/src) | Configurable JSON object form, ordered list, grid and free-form tags | `first.config.ts` uses native SCF group and repeaters for object/list/grid. Tags remain JSON string arrays and `field-kit.js` provides add/remove/deduplicate chips. Native REST/SCF saves prove persisted data. The grid has two authored columns; arbitrary widget options and React UI parity are not claimed. |
| [color](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/color/src) | Hex-string visual color picker | `admin.php` extends the generated SCF field to `color_picker`; First validates six-digit hex; the stored color controls the published article accent. |
| [embeds](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/embeds/src) | YouTube, Vimeo, tweet, Bluesky, Mastodon, Open Graph and Gist block schemas/rendering; remote HTML sanitization | `embeds.php` implements all seven renderers, safe remote HTTP and HTML sanitization, with visible provider-unavailable fallbacks. Deterministic YouTube/Vimeo output is locally qualified. The five remote fetch/render paths require real reachable services and are **not externally qualified** by the local run. No remote-service fake is used. |
| [forms](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/forms/src) | Definition editor, public multi-page/conditional forms, thirteen field types, validation, file upload, inbox, notifications/webhooks, digest and retention | `forms.php`, REST routes and `workshop.js` supply persisted definitions, all thirteen input renderers, pages, conditional validation, honeypot, real multipart image/PDF media, private inbox review, pause and global event webhooks. Acceptance exercises representative validation boundaries and a real uploaded/served image. Email/autoresponder, digest, retention automation, Turnstile verification, per-form webhook and the upstream visual drag/drop builder are **gaps**. Turnstile-configured submissions fail with 424. Definition authoring uses REST or the JSON editor in the workshop. |
| [audit-log](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/audit-log/src/plugin.ts) | Lifecycle and create/update/delete/media history with before/after snapshots and admin history | `hooks.php` captures pre-update state and final SCF state at request shutdown; stores private audit posts with actor/time. Admin history shows details. Acceptance checks native update snapshots, media upload, deletion, deactivate/reactivate and restart persistence. |
| [webhook-notifier](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/webhook-notifier/src/plugin.ts) | Configurable URL/token/events, content/media notifications, retries, delivery tracking and SSRF checks | `hooks.php` queues real Action Scheduler deliveries with three attempts and exponential backoff, durable status, Bearer token and HMAC. A real local HTTP receiver returns 503 once, then 204. Private destinations are rejected; an exact loopback URL needs an operator-owned wp-config constant. Redirects are disabled. Delivery retention/pruning and per-event admin controls are not implemented. |
| [api-test](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/api-test/src/index.ts) | Logs, KV CRUD/list, indexed storage CRUD/counters/query/count, content CRUD, media and network probes | Native options KV endpoints, First's unique/indexable `records` table and `advance` action, native content/media APIs, actual HTTP webhook, lifecycle/events and taxonomy/queue diagnostics. The run proves representative real effects; it does not duplicate every upstream diagnostic route or its API shape. |
| [mcp-smoke](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/mcp-smoke/src/sandbox-entry.ts) | A schema-validated echo route and MCP echo tool | Compiled `echo` action, `official-plugins/echo` core Ability and the generated MCP tool. Acceptance calls Abilities REST and the real MCP Adapter initialize/tools-list/tools-call, including unauthorized REST denial. No handwritten MCP transport. |
| [sandboxed-test](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/sandboxed-test/src/plugin.ts) | Hooks/KV/storage/content/HTTP and adversarial checks for host restrictions, per-plugin KV/storage, absent globals/raw DB and capability escalation | Trusted PHP hooks and persisted effects have local counterparts. `/sandbox/probe` returns **501**, because WordPress PHP has no per-plugin isolate or capability membrane. None of the adversarial isolation probes are reported as passed. |
| [marketplace-test](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/marketplace-test/src/plugin.ts) | Maximal registry/consent/sandbox fixture: lifecycle, Block Kit, draft read/patch, content policies/revisions/restore, media bytes/metadata, comments, taxonomy, users/bylines, redirects, settings/secrets, indexed storage, KV, cron, email, HTTP body modes, fragments and MCP | Representative native lifecycle, typed settings, persistent storage, taxonomy, media bytes, comments held pending, Action Scheduler and action/Ability/MCP behavior are exercised. **This is not the full marketplace fixture.** Registry signatures/consent, sandbox authority, Block Kit/RTL, draft patch protocol, translation probes, email transport, redirect rules, byline APIs, and the complete HTTP request/response diagnostic matrix remain gaps. Core WordPress features alone are not counted as proof of those plugin contracts. |
| [ai-moderation](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/ai-moderation/src) | Workers AI Llama Guard 3 8B taxonomy classifier, enrichment hook and exclusive moderation decision | Local counterpart conservatively holds comments and records `provider=unconfigured`, `decision=hold`. The native comment and metadata persist. `/ai-moderation/analyze` returns **424**. No AI classification, category editor, or provider parity claim. |
| [ai-search](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/ai-search/src) | Cloudflare AI Search binding/REST adapter, ingestion/index build, snapshots, source/author/media indexing, semantic search and admin connection/activity | Local public WordPress lexical search over actual published stories, explicitly `semantic=false`, feeds the publication search UI. `/ai-search/semantic` returns **424**. No embedding, ingestion/index-build, Cloudflare account/instance or semantic-result claim. |
| [atproto](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/atproto/src) | AT Protocol PDS sessions and standard.site publication/document synchronization, optional Bluesky cross-posting/media | Real local standard.site publication/document JSON exports, derived from published WordPress content and refreshed on save. `/atproto/sync` returns **424**. PDS authentication, actual record put/delete, DID/handle resolution, blob upload, verification and Bluesky cross-posting need the real external service and remain unqualified. |

## Official plugin tutorials

The mapping follows the pinned [creating-plugins tutorial](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/skills/creating-plugins)
and its actual reference chapters:

- `hooks.md`: WordPress activation/deactivation and native content/media/comment hooks; persisted events and queued deliveries. Trusted PHP does not inherit EmDash hook priorities, timeouts, dependency/exclusive registration semantics or plugin capability consent.
- `storage.md`, `api-routes.md`: options KV and typed First SQL records; native REST permission callbacks. The storage layout and route envelopes are WordPress/First contracts, not EmDash API compatibility.
- `admin-ui.md`, `block-kit.md`: native SCF controls and the workshop settings/history/form editor. The declarative Block Kit protocol is not implemented.
- `content.md`, `comments.md`, `media.md`: actual First collection, native REST/SCF persistence, comment hold metadata, multipart media and served bytes. External email delivery is not inferred from a stored event.
- `taxonomies-and-redirects.md`: real taxonomy creation/cron diagnostic. Redirect-provider integration remains a gap.
- `portable-text-blocks.md`: stored embed descriptors render on the actual publication. Portable Text is represented as WordPress content plus JSON descriptors; no cross-runtime serialization compatibility is claimed.
- `sandbox-boundaries.md`, `publishing.md`: WordPress plugin lifecycle is exercised, but workerd isolates, registry publishing/signatures and marketplace consent are outside the local runtime.

## Persistent restarts

Acceptance restarts its own site without destructive approval and verifies
bounded text fields, content, submissions, settings and unrelated plugins survive.
Numeric bounds retain their meaning across the native development snapshot's
JSON roundtrip.

## Runtime and privacy choices

Webhook settings are admin-only. GET settings never returns the token. Public
form definitions omit notification settings. Submissions are private posts and
their list/review routes require an administrator. Uploaded form files use the
normal **public WordPress media library**: do not use this demo form to collect
sensitive files. Only verified PNG/JPEG/PDF files up to 2 MiB are accepted.

The acceptance receiver is a real local HTTP server, not a provider stand-in.
Only its exact URL can be opted into using `FIRST_PLUGINS_LOCAL_WEBHOOK` in the
disposable site's `wp-config.php`; dashboard/API callers cannot supply that
constant. Production HTTPS destinations use WordPress's safe transport. No
localhost escape, public service credential or reusable token is tracked.

A passing local acceptance run proves the listed local effects only. Full upstream
parity remains incomplete because of the explicit feature/provider/isolation gaps
in the mapping above.
