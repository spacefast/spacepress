# EmDash coverage on native Zero

This guide describes the qualification target, recorded native results and known
differences. **Runtime qualification is partial:** the publication, marketing,
portfolio, plugins, agent and platform suites have passed their recorded native
checks. `partial` means a named subset has executed
evidence; `pending` means proof is outstanding; `gap` means a specific contract
or provider differs. `proven` applies only to a recorded run or scoped behavior,
with its revision/runtime context and cleanup evidence.

The [versioned manifest](../examples/emdash/manifest.json) owns the detailed
inventory and commands. It contains nine templates, six demos, thirteen plugins,
50 documentation examples with 411 fenced snippets, 30 agent-reference files
with 217 snippets, 22 supporting packages and ten additional official organization
repositories. Snippet hashes and Git object IDs establish provenance and
freshness; they do not test behavior. Source links are immutable.

## Canonical examples

All sources in this table use
[EmDash `1824902c0c383c052b623528799427b8a5ff75d0`](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0).
The manifest's `source` and `sources` give each exact pinned directory/file.

| Official source | Concrete application behavior | Zero owner |
| --- | --- | --- |
| `templates/blank` | Welcome page, empty CMS and admin entry | `blank` |
| `templates/starter` | Recent posts, posts/pages, rich text/media, category/tag archives, menus and settings | `starter` |
| `templates/blog` | Featured hero, bylines, reading time, related posts, archives/pagination, search, comments, widgets, RSS, SEO and theme | `blog` |
| `templates/marketing` | Hero, features, testimonials, pricing, FAQ, logos, split, stats, CTA, contact and text blocks; editor-created pages | `marketing` |
| `templates/portfolio` | Featured/newest project selection, galleries, tag-filtered/paginated work, next project, layouts, placeholders, RSS and theme | `portfolio` |
| `templates/starter-cloudflare` | Starter application plus D1/R2/Worker deployment | `starter`; provider gap |
| `templates/blog-cloudflare` | Blog application plus D1/R2/Worker deployment | `blog`; provider gap |
| `templates/marketing-cloudflare` | Marketing application plus D1/R2/Worker deployment | `marketing`; provider gap |
| `templates/portfolio-cloudflare` | Portfolio application plus D1/R2/Worker deployment | `portfolio`; provider gap |
| `demos/simple` | Blog plus audit-log and MCP-smoke registrations | `blog`, `plugins`, `agents` |
| `demos/plugins-demo` | Audit history, webhook delivery, embeds and plugin API diagnostic routes | `plugins` |
| `demos/cloudflare` | Blog, locale fallback, forms, AI Search, Access, Images/Stream, sandboxed webhooks and native Workers cache | `platform`, `plugins`; provider gaps |
| `demos/playground` | Blog with bundled seed media, per-session Durable Object database/storage and setup bypass | `platform`; session/provider gap |
| `demos/preview` | Signed snapshot preview, expiry and per-session Durable Object database override | `platform`; preview/provider gap |
| `demos/postgres` | Blog on the actual PostgreSQL adapter | `blog`, `platform`; database gap |

These are 15 source entries, not 15 independent frontends. The pinned
[sync-cloudflare-templates script](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/scripts/sync-cloudflare-templates.sh)
and [sync-blog-demos script](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/scripts/sync-blog-demos.sh)
state which content is shared. Demo configuration remains independent. In
particular, the Cloudflare demo replaces ordinary search controls with AI Search,
and playground/preview have their own session behavior.

The current marketing template's contact block uses email/phone/address links.
It does not implement a submission backend. Submission, spam and email delivery
belong to the forms plugin; a decorative contact form cannot qualify that plugin.

## Original source migrations

[The original-source applications](../examples/emdash/official-sites/README.md)
retain pinned blank, starter and blog Astro routes, components, styles and
utilities with a source-hash drift guard. Astro compiles to a Node frontend;
Zero compiles its backend and the original reading-time algorithm to PHP.
The native adapter supplies WordPress/SCF content, menus, media, comments,
Appearance widgets, saved-draft previews and privacy rules to those original
routes. The deeper marketing and portfolio examples above remain behavioral
counterparts; they do not claim unchanged upstream frontend source.

Run the full application seam with `node examples/emdash/test.mjs official-source`.
This is separate from EmDash's staged edit locks, unsaved inline editor,
plugin contributions, sandbox execution and provider infrastructure, which
remain explicit gaps. For npm source algorithms, the independent
[package probe harness](../examples/npm-compat/README.md) distinguishes raw
imports, export adaptation, authored parameter types and Node/PHP parity.

## All thirteen plugin directories

| Source under `packages/plugins/` | Observable requirement | Owner / boundary |
| --- | --- | --- |
| `audit-log` | Durable create/update/delete/media history and before/after values | `plugins` |
| `webhook-notifier` | Configured delivery, authentication, retries/history and URL safety | `plugins`; real receiver |
| `embeds` | Saved YouTube/Vimeo/X/Bluesky/Mastodon/Gist/link content renders safely | `plugins`; remote embeds need reachable providers |
| `color` | Editable hex color picker and persisted value | `plugins`; storage alone misses widget behavior |
| `field-kit` | Editable object/list/grid/tags with preserved values/order | `plugins`; JSON storage alone misses widgets |
| `forms` | Rendered form, validation, durable submissions, spam controls and notifications | `plugins`; delivery needs a provider |
| `ai-moderation` | Llama Guard decisions/categories affect comments | `plugins`; live Workers AI gap |
| `ai-search` | Index published content/bylines, search, remove unpublished/deleted documents | `plugins`; live AI Search gap |
| `atproto` | Actual publication/document/Bluesky records, blobs, update/delete and status | `plugins`; real PDS gap |
| `api-test` | Plugin identity, KV, storage, content, media and network diagnostics | Private fixture; `plugins` |
| `mcp-smoke` | Validated 1–200 character echo returns message and length over real MCP | Private fixture; `agents` |
| `marketplace-test` | Registry consent/lifecycle, capability checks, conditional storage and declarative admin surfaces | Private fixture; `plugins`; capability checks and consent are [plugin packages](config-api.md#plugin-packages) (inferred grant, committed lock); registry, plugin storage and admin surfaces remain gaps |
| `sandboxed-test` | Hook transforms plus denied hosts/capabilities and plugin-storage isolation | Private fixture; `plugins`; hook transforms, denied capabilities and denied hosts are compile-time [plugin packages](config-api.md#plugin-packages) (`tests/compiler.rs` `a_plugin_package_runs_under_its_locked_grant`); plugin KV/storage remains a gap |

Private fixture status comes from the pinned packages' `package.json` and runtime
implementations, not their names. Keep their useful contracts in the inventory;
do not deploy their deliberate probes or fake providers as public examples.
The remaining 22 workspace packages are separately classified in the manifest:
framework/admin/auth, converters, scaffolding/upgrades, registry services/types,
workerd test/runtime support, external auth and x402. They are not thirteen
additional plugin examples. Provider/converter behavior remains an explicit gap
where Zero's different implementation does not hold the same contract.

## Agent and tutorial workflows

The [official AI tools guide](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/ai-tools.mdx)
and [MCP reference](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/reference/mcp-server.mdx)
cover content, bylines, media, search, taxonomies, menus, settings, schema,
revisions and whole-site transfer. Generated Zero operations expose the compiled
model through core WordPress Abilities and MCP Adapter. For the agent example,
the endpoint is `/wp-json/mcp/zero-agents`; use its actual `tools/list` schemas
and application-password authentication. EmDash's endpoint, tool names and
OAuth scopes are different.

Agent acceptance must initialize an authenticated HTTP MCP connection, discover
and call generated tools, then observe the same saved data through native
WordPress REST/SCF and the public page. It must also check a denied caller, hidden
field, invalid input, global update and the stored result of a queued job.
`tests/wp/abilities.test.ts` owns existing lower-level parity; its presence is
not evidence that it passed on Studio.

Three official contracts require separate attention:

- **Published and staged content:** EmDash stages edits without replacing the
  live version. Compare/discard/promote uses `_rev`; held edit locks reject
  writes. Native status/revision support alone does not prove this contract.
- **Schema changes:** EmDash tools create collections/fields/block versions at
  runtime. Zero declares them in `zero.config.ts` and compiles them. A source
  edit plus rebuild is a different agent workflow, not the same runtime tool.
- **Whole-site transfer:** portable export/analyze/import/resume/receipt includes
  media, principals, comments and approvals. Config migration and Markdown sync
  cover smaller seams.

The manifest also maps the actual blog tutorial, reusable independent-copy
sections, shared widgets, menu links, layout selection, structured blocks,
relations, locale queries/fallback, media editing/usage, SEO/redirects,
provider auth/email, domain changes, backup/restore, AdSense and x402 recipes.
Each fenced example has source lines and a content hash. Agent references cover
building sites, creating plugins, CLI/editing flow, upgrades and WordPress
plugin/theme conversion; upstream skills are reference material, not instructions
to run external mutations.

## Other official organization repositories

The public organization listing contained eleven repositories on 2026-11-03.
The CMS is the fixed pin above; each remaining repository has an independent
commit pin in the manifest. The following links are also pinned.

| Repository | Classification and required distinction |
| --- | --- |
| [templates](https://github.com/emdash-cms/templates/tree/a7bb43df40b2a1dbc63495579be612837e95aa2e) | Auto-synced deployment mirror; use the canonical nine templates |
| [skills](https://github.com/emdash-cms/skills/tree/f0e2da725244e277591d805e3977f072a59ec13e) | Synced agent guidance; not additional applications |
| [emdash-build](https://github.com/emdash-cms/emdash-build/tree/e072f0f92f3545a000df62003fa88b67cdfcb1ca) | Real reference application: chat clarification, schema/MCP population, frontend repair, saved source/CMS history and controlled publishing |
| [emdashcms.com](https://github.com/emdash-cms/emdashcms.com/tree/2885092c6f7dd54ac8433cd2a32a926b2ca045f8) | Custom marketing site with capabilities blocks, blog/tag/OG routes and agent onboarding; broader than its template-style README |
| [plugin-troubleshooting](https://github.com/emdash-cms/plugin-troubleshooting/tree/4abfca4508294e2ee7c6cf5a16f4ff0573784950) | Cache-clear plugin; object and Workers-cache actions depend on availability |
| [wp-emdash](https://github.com/emdash-cms/wp-emdash/tree/fe29aa3c73f0dc781bd0c89fb8be62e4e8d46347) | GPL3 migration exporter/wizard, not MIT template code |
| [blob-proxy](https://github.com/emdash-cms/blob-proxy/tree/0c0729633e2d4bb349716eda4fba26848f6732bd) | Registry blob CDN: CID verification, MIME policy, labels and cache purge |
| [factory](https://github.com/emdash-cms/factory/tree/f186252add6b68627c12ef0c304bcb6fd61b0059) | Development orchestration infrastructure, not a CMS template |
| [tack](https://github.com/emdash-cms/tack/tree/6493b3e0cc3c07ec7a1fa1354eb4685b764c9a2d) | GitHub multiplayer whiteboard, separate from the CMS examples |
| [emdash-bot](https://github.com/emdash-cms/emdash-bot/tree/574e05c44f78ba14d1322a7d8bce8d05cff8fabd) | Issue/PR author infrastructure; no GitHub actions needed for local qualification |

`emdash-build` uses BuilderAgent, a real model/tool loop, Cloudflare Sandbox,
Artifacts and private previews. Its hosted demo disables publishing. A local
agent notebook proves useful connectivity, but not that builder's generation,
repair, durable restore or publishing contract. Record the missing provider
and application work instead of adding an echo/mock under its name.

## Native execution and evidence

Use the [root example commands](../examples/emdash/README.md) from the repository
root: `node examples/emdash/test.mjs`. The runner builds with
`cargo build --locked` unless `ZERO_BIN` selects a matching existing binary,
and installs the shared browser dependencies and Chromium.
Its default suites run sequentially; `publishing` owns blank/starter/blog,
and `publishing-browser` holds their browser seam. Select owners with arguments
such as `node examples/emdash/test.mjs marketing portfolio`; request the optional
native lifecycle suite with `node examples/emdash/test.mjs lifecycle`.

The campaign recorded these results on native WordPress Studio 2.1.1 and SQLite:

| Executed owner | Result and qualified subset | Still outside that result |
| --- | --- | --- |
| Publishing | Four tests passed: blank native page/admin; starter native REST/SCF/page edits, drafts, search and revisions; blog taxonomy, real uploads, pagination, RSS, submitted/moderated comments, appearance and restart persistence. | FTS ranking, opaque cursors, guest/multiple bylines, inline editing and composable widgets. |
| Publishing browser | One test passed: native Quick Edit becomes public, theme persists, search navigation works, and mobile has no horizontal overflow or page errors. | Complete editorial UI and every upstream widget. |
| Marketing | Native acceptance and separate browser pass: eleven saved layouts, native options/SCF saves, public ordering, validation, draft isolation and rebuild preservation; desktop/mobile navigation, FAQ and theme controls. | Portable Text storage, signed/inline preview protocol and Cloudflare deployment. The separate select-based page-layout tutorial remains untested. |
| Portfolio | One native test passed: six cases, uploads/replacement, galleries, filtering/pagination, featured fallback, metadata/RSS, native edits/revisions, authenticated saved previews and an Ability mutation. Original-photo import separately verified served bytes and desktop/mobile behavior. | Opaque cursors, dark-media variants, unsaved autosave previews and menu-aware missing-page placeholders. |
| Agents | One test passed: real authenticated HTTP MCP and core Abilities, discovery/echo, native REST/SCF editing, publication, row/field restrictions, failures, global mutation, durable job effect and browser rendering. | Runtime schema mutation, staged/live drafts, full site transfer and the hosted AI builder. |
| Platform | One test passed with nine passing journeys: native nested fields, roles, representative relations/jobs, revisions, Polylang English/French, real uploads/transform, local HMAC webhook effects, Markdown sync, migration/restart preservation and browser/admin access. | Scheduling/autosaves/trash, full relation/conflict matrices, private-file authorization and external services. |
| Native lifecycle | One test passed: native editing, identity, uploads/jobs, schema/public watching, invalid-build recovery, persistent restart and unchanged numeric-constraint preservation. | Complete backup recovery or provider migration. |
| Plugins | One native/Chromium test passed: stored fields, API/options diagnostics, Abilities/MCP, multi-page form navigation and conditional visibility, blank optional typed inputs and persisted private inbox, saved YouTube/Vimeo markup, local signed delivery/retry, protected-content boundaries, plugin lifecycle/coexistence and an unchanged bounded-field restart without a destructive override. | Complete widgets/marketplace, form builder/mail/digest/retention/Turnstile/per-form webhooks, remote embed providers, AI/PDS and Worker isolation. |

All seven default suites passed together. After the final native REST
password-parameter compatibility change, plugin and platform acceptance passed
again on the rebuilt binary. All fifteen PHP suites and fresh marketing/portfolio
password-leak reproductions also passed. Locked records are hidden before query
selection; native editor, cookie and scoped password access remain supported.

The manifest's `nativeAcceptance.executedRuns` records artifact labels, commands,
results, revision context, exercised checks and cleanup. Agent/platform reruns
include the shared nullable-SCF-boolean fix. Some earlier example evidence was
collected from pre-commit working trees; these receipts do not certify later
edits. Whole upstream source entries remain pending or gaps rather than
inheriting a suite's pass. Source-object and snippet audits remain unchanged.

Each suite must create a unique disposable Studio project,
allocate a free port, verify `.zero/dev/owner.json`, use real native saves,
and stop/unregister only its exact site. Keep full native admin/plugins/settings
available. Preserve unrelated plugins, credentials, content and uploads across
restarts. Keep failed-run receipts for precise cleanup; never stop/delete globally.

Use an existing matching binary only while its compiler/runtime inputs match.
Concurrent workers must isolate build outputs and pass their matching binary as
`ZERO_BIN`. Record which binary/revision produced the evidence. Disposable local
credentials are documented deliberately in the examples; they must never be
reused for deployed sites or personal accounts.

A `proven` receipt needs the exact command/result, behavior IDs, revision/runtime,
actual served responses or screenshots where relevant, and cleanup proof.
Promote only the checks that ran. Browser assertions inspect the live product;
source/snippet inventory checks establish provenance only. Keep comprehensive
run artifacts outside tracked documentation and record failures plainly.

Zero alternatives currently include native Gutenberg/SCF instead of Portable
Text/Astro, native WordPress search instead of EmDash FTS, numbered pages
instead of opaque cursors, and native authors instead of multiple/guest bylines.
CSS theme switching alone does not prove saved dark-image variants. PHP plugins
have process authority and do not establish Worker-isolate/host-allowlist security.

Cloudflare, PostgreSQL, AT Protocol, AI, mail, payment and ad-delivery claims need
actual provider evidence. The upstream notifier uses optional Bearer-token authorization; Zero built-in
webhooks use HMAC. Record the declared wire contract rather than treating them
as identical. The plugin workshop's notifier sends both Bearer authorization
and an `x-zero-signature` HMAC, verified by its owned HTTP receiver; the platform
journey exercises Zero's separate built-in signature formats.
A local receiver can prove received webhook bytes;
mail capture can prove dispatch; neither demonstrates external delivery or
provider parity. Existing Docker suites remain useful lower-level regression
owners, but new native acceptance must run through Studio.

Keep [the upstream MIT notice](../examples/emdash/UPSTREAM-NOTICE.txt) with
adaptations and retain independent repository/file/media licenses. The inventory
is an acceptance contract and provenance record, not a claim of complete parity.
