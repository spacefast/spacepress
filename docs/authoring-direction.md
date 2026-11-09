# Authoring direction: content, data, files and optional pages

Selected direction, 2026-11-02; implementation status refreshed 2026-11-03
against main `4fc803b6`. This brief records the authoring direction and future
pages/agents contracts. Released API details belong to the implementation docs.

| Implemented foundation | Current reference |
|---|---|
| Concrete classes, inheritance and instance identity | [Class compilation](class-compilation.md), shipped in `a2ec286d` |
| Finite TypeScript type algebra and bounded normalization | [Runtime contract](runtime-contract.md), shipped in `9395ba26` and `df61274a` |
| Explicit collections, tables, user projections and shared relations | [Config API](config-api.md), shipped in `a08b2d16` |
| Shared S3 files, native media originals and derivatives | [Uploads](uploads.md), shipped in `b8c2a670`; qualification is S3-compatible/Garage, not every provider |
| Native admin login, editing and draft protection | Shipped in `d6d10eda`; [examples](examples.md) describe the current workflows |

Optional pages, universal components, paired theme publishing, host process
drain, the Data Machine adapter and approval bridge remain future design.
Their acceptance obligations below are not qualified by the shipped foundation.

The latest owner requirements are explicit: collections and tables are
different authoring concepts, both support relations, files need an S3-compatible
backend for all managed uploads, TypeScript support must grow, and the product
must earn a better authoring experience than Payload, EmDash and Sanity.
This supersedes #55's proposed storage inference.
It does not approve every unrelated deletion or default in #55.

## The smallest app

`zero.config.ts` alone remains a complete backend. Every additional directory
below is optional. Names and storage choices appear once:

```ts
import { collection, table, text, integer, richText, slug, defineConfig, defineRelations } from "zero";

// A WordPress content type: editor, post identity and editorial lifecycle.
export const products = collection({
  title: text().notNull(),
  slug: slug({ source: "title" }),
  description: richText(),
}, { content: "description" });

// Application data in a separate SQL table; never becomes a post type.
export const stock = table({
  productId: integer().notNull().references(() => products.id, { onDelete: "cascade" }),
  quantity: integer().notNull().default(0),
});

// One graph across both registries; the existing typed relation vocabulary.
export const relations = defineRelations({ products, stock }, (r) => ({
  products: { stock: r.many.stock() },
  stock: {
    product: r.one.products({ from: r.stock.productId, to: r.products.id }),
  },
}));

export default defineConfig({
  name: "shop",
  collections: { products },
  tables: { stock },
  relations,
  admin: true,
});
```

The target builders supply the default `id`; this example intentionally does
not repeat it. The registered key supplies identity. Referencing a target's
typed column retains the current foreign-key machinery instead of introducing
a second relation implementation during this cutover. Hook placement, access
defaults, global configuration and action signatures otherwise retain current
behavior in the first implementation change. A concise `ref()` vocabulary and
co-located hooks remain separate decisions; they are not prerequisites for
explicit storage or cross-kind relations.

Both kinds can appear on either side of a relation. One-to-one and one-to-many
use the existing cardinality declarations; many-to-many uses an explicit join
table and its relations. An inverse relation does not add a second writable
copy of the foreign key. Ambiguous reverse relations require an explicit
selection. Cross-kind references use logical Zero IDs, not unchecked native
post IDs. Backend validation must reject an ID for the wrong content type.

The generated client keeps the existing flat resource vocabulary:

```ts
const rows = await zero.stock.list({ with: { product: true } });
const products = await zero.products.list({ with: { stock: true } });
```

The collection/table example uses the accepted configuration vocabulary;
optional page, theme and agent declarations below remain proposal snippets.
Resource keys must be unique across both registries. SQL name derivation must
detect collisions as well. Changing fields never changes storage. The initial
cutover preserves existing physical names and snapshots so a syntax change
does not drop data or manufacture a post/table conversion.

## Two storage choices, one data contract

| Contract | Collection | Table |
|---|---|---|
| Purpose | Editorial content | Application and relational data |
| Persistence | Native WordPress posts plus declared fields | Dedicated SQL table |
| Editing | Native content editor and schema-driven fields | Schema-driven data form/list |
| Drafts and publishing | Native editorial lifecycle | No implicit post lifecycle |
| Relations | Same graph, including table targets | Same graph, including collection targets |
| Access and field masking | Enforced on direct and related reads | Enforced on direct and related reads |
| Public URL | Optional content route; not inferred | No native post URL; a page loader may query it |
| Auth identities | Preserve the existing WP-user projection | Preserve the existing WP-user projection |

Neither builder creates a second identity engine. Current auth collections
project `wp_users`; the implementation must preserve their IDs, permissions
and migration behavior rather than forcing them into post storage. The exact
auth declaration must be explained alongside the implementation and must not
reintroduce field-based storage inference.

Cross-kind relations do not make forbidden rows public. Public client loading
retains target row access, field masking and appropriate nullable/omitted
relation types. Trusted server `db` and viewer-bound reads keep their existing
different authority contracts. SQL joins, filters and pagination must not leak
denied target rows. An SQL foreign-key declaration alone cannot provide
referential integrity against shared `wp_posts`; Zero must validate the target
kind and implement the declared delete behavior at its write boundary.

## Files and stateless app replicas

Files are the app-facing upload resource. An S3 bucket is a physical storage
option, separate from a collection or SQL table. Keep logical file names,
permissions and typed file references independent of provider bucket names.
Both collections and tables can reference files and media.

The implemented shared storage backend configures S3 bucket, region,
optional compatible-service endpoint, path-style addressing and an app-specific
object prefix. Use the accepted spelling and executable configuration in
[uploads](uploads.md); this brief does not define a second storage API.
Runtime environment references supply credentials. Generated clients, public
schemas, build artifacts and diagnostics must not contain credential values.

The S3 backend must cover private files, public media originals, generated
image sizes and crops, and uploads through the supported native editor. An
S3 setting that only changes private-file downloads does not meet this
requirement. Qualify any third-party upload integrations separately rather
than claiming their support from a storage adapter alone.

Keep file metadata, ownership, reference validation and cleanup state in the
existing database. Keep durable bytes in object storage. A successful upload
must be readable by another app replica after the first replica's local upload
directory is removed. Temporary upload and image-processing files are allowed,
must be cleaned up, and must not become the durable source. Database state also
needs a shared durable database; moving bytes to S3 alone does not make a local
database deployment stateless.

Private reads retain authorization and bounded signed grants. Public media
needs stable URLs for originals and derivatives. Provider failures must not
report success or silently fall back to local durable storage. Upload rollback,
deletion and retry must account for the separate database and object store;
use existing durable jobs where cleanup needs recovery. Local storage can
remain an explicit development option.

Acceptance requires real WordPress and an actual S3-compatible service: upload
a private non-image and an image with a derivative through one replica, then
read and delete through a fresh replica without the first replica's local
files. Existing access, MIME/size validation and reference behavior must hold.
The implementation must also exercise provider failure and credential
redaction through their existing test owners.

## Special files

```text
shop/
├── zero.config.ts             # required: content, tables, access and backend behavior
├── zero/_generated/db.d.ts                # generated editor types; never hand-edit
├── tsconfig.json
├── lib/                      # ordinary imported TS; no discovery conventions
│   └── pricing.ts
├── pages/                    # optional pages add-on
│   ├── layout.tsx            # shared root chrome and metadata defaults
│   ├── page.tsx              # /
│   ├── not-found.tsx         # 404 for claimed routes
│   ├── theme.config.ts       # opt in to an emitted block theme
│   ├── about/page.tsx        # code-owned /about
│   ├── help/page.md          # content-owned /help; optional sync
│   └── products/
│       ├── page.tsx          # listing loader
│       └── [slug]/page.tsx   # collectionPage(products)
├── components/               # ordinary imports; shared React/WP subset when requested
│   └── ProductCard.tsx
├── styles/
│   ├── tokens.ts
│   └── global.css
├── wp-hooks/                 # optional WordPress actions/filters, one per hook name
│   ├── save_post.ts          # default-exports the handler
│   └── the_content/          # several handlers, registered in file-name order
│       └── frame.ts
├── agents/                   # optional instruction files, referenced by agent declarations
│   └── editor.md
├── content/products/         # optional collection file sync
├── zero/
│   ├── client/               # generated typed HTTP client
│   ├── migrations/           # reviewed database migrations
│   ├── abilities.json        # optional: abilities locked by `zero abilities pull`
│   └── wp-plugins.lock.json  # pinned plugin artifacts
└── .zero/                    # generated build/staging output
```

Do not require a folder per collection, service classes, a route handler per
resource, or a special file for every backend operation. Splitting the config
into ordinary relative imports is optional. Discovery applies only to the
documented page entry files and to `wp-hooks/`, where a file or directory
name is a WordPress hook name and each file default-exports its handler.
Co-located helper and test files are not routes; helpers for hooks live outside
`wp-hooks/` and are imported.
`page.blocks.html` is the alternative content-owned page format described in
the pages proposal; one route cannot declare competing ownership formats.

Keep the reviewed page contracts: hidden code-owned Page records, no editing
generated TSX, public-query guards, canonical/permalink agreement, one title
emitter, password-bearing managed-item exclusion and early HTML-cache bypass.
`collectionPage()` gives a collection its native item route. A custom page can
read a table through a viewer-authorized loader without turning that table
into a public post type.

`layout.tsx` works without forcing theme ownership. `theme.config.ts` opts
into paired app/theme deployment. Without `pages/`, builds need no page
serializer, Node rendering toolchain or theme output. Interactivity API islands
are the initial WordPress interaction mechanism; React hydration and Astro
islands remain later work.

## More TypeScript, with a sound PHP target

Use the existing OXC parser/AST family as the frontend. The crate registry was
checked on 2026-11-02: matching `oxc_semantic`, `oxc_ast_visit` and
`oxc_transformer` 0.152.0 are MIT and require Rust 1.96, matching Zero's pin.
Their latest releases were 0.156.0; upgrade the family together only for a
demonstrated need. These crates were assessed, not added or runtime-qualified
by this document.

| Layer | Reuse and responsibility |
|---|---|
| Parse and source locations | Existing OXC parser, allocator, AST and spans |
| Scope and references | Evaluate matching OXC semantic analysis/visitors before writing more scope walkers |
| TS-only syntax | Reuse appropriate transforms when they preserve declarations, types and source provenance needed by Zero |
| PHP lowering | Zero's typed IR, effect/reachability analysis and emitter |
| JS runtime semantics | Existing handle/runtime library, extended against Node behavior |
| Editor and generated-client types | Schema-derived declarations and strict TypeScript checks |
| Browser compiler | Same compiler core; compare native and WASM results |

OXC and SWC transform TypeScript/JavaScript; neither is a ready-made PHP
backend. Adding SWC beside OXC introduces another AST without supplying the
missing runtime semantics. Boa is a JavaScript engine, not a PHP compiler;
embedding it does not replace the deployed PHP contract. Do not adopt either
just to advertise broader TypeScript support.

Prioritize real authoring failures: classes and instance identity first, then
interface inheritance, practical generics/utility types and supported module
composition. Separate type-only features from runtime features such as enums,
class initialization, `super`, iteration and built-in APIs. An accepted program
must behave correctly, produce an accurate client type and retain sound access
analysis. Unsupported semantics get a located diagnostic; silently widening
to `unknown` or accepting incorrect PHP is not support. Preserve intentional
documented differences such as undefined/null and lone-surrogate refusal.

Reuse licensed code and maintained libraries rather than copying an entire
compiler. Retain required notices and upstream revision/provenance with any
adapted code, including its tests. Existing adoption evidence already records
the limited ts2php URI helper reuse; it does not establish that another
project's complete emitter is compatible.

## Native providers and automated setup

Selected direction: expose typed Zero capabilities backed by maintained PHP
libraries and WordPress plugins where they fit. Keep expanding compilation for
authored TypeScript; importing an npm package does not by itself make that
package compatible with PHP. Avoid porting a library when a maintained native
implementation already provides the required behavior.

Reuse WordPress authentication, capabilities, Gutenberg and media processing.
The existing platform already pins Secure Custom Fields, Action Scheduler and
MCP Adapter, with Polylang when locales are configured. Additional plugins use
the existing exact-version declarations and checksum lock. Existing PHP
`Extensions` registrations provide integration hooks; this direction does not
add a general-purpose PHP-call escape to compiled TypeScript.

For each supported integration, define its typed inputs/results, effects,
authority and target requirements. Access analysis must still distinguish a
pure helper from database writes or network effects. A WordPress-only provider
must produce a located diagnostic on an unsupported target. An installed plugin
is not evidence that its operations obey Zero's row access or field masking;
the adapter must retain those boundaries.

Dependency acquisition, installation, activation, configuration and readiness
are separate states. Today a WordPress build bundles pinned plugins but does
not activate them. Supported integrations should automate repeatable setup in
dependency order, preserving unrelated site settings and reporting actionable
failures. Runtime credentials come from environment configuration; do not put
them in the plugin lock or public schema. Readiness must exercise the declared
capability rather than merely detect the plugin's files.

The S3 implementation uses the maintained AsyncAWS SDK; its selection and
scope are recorded in the [provider decision](decisions/2026-11-02-upload-provider-adapter.md).
Any additional provider must meet the complete files contract. Originals,
derivatives, private reads, native-editor uploads and replica replacement must
all work; a public-media-only offload plugin is insufficient for private files.
This document adds no provider qualification or SEO integration. A PHP
library may still be bundled and scoped for reproducible deployment; reuse
means avoiding a hand-written replacement, not requiring a live package manager
on the deployed site. Retain dependency licenses, exact pins and provenance.

Extend existing plugin acquisition and runtime integration owners. Prove setup
can run twice without changing unrelated state, and prove real operations on a
disposable WordPress installation. Use the existing WordPress/S3 acceptance
owners for the actual storage behavior rather than adding a parallel harness.

## What better UX must demonstrate

The competitor research is recorded in [research adoption](research-adoption.md)
and [config migration](config-migration.md). It motivates these acceptance
criteria; it is not an executed current-version comparison of all products.

| User task | Acceptance bar |
|---|---|
| Start a content app | One config and one dev command; working content editor/client, not plugin setup instructions on the main path |
| Mix content and app data | Explicit collection/table choice, same field vocabulary and relation queries, no storage inference surprises |
| Store uploads | One files surface with S3 options; private files and media survive replacement of an app replica |
| Edit related content | Labeled searchable pickers, useful empty states and field errors; do not expose raw foreign-key IDs as the main editing flow |
| Change the schema | Explain the migration and storage choice; preserve existing content and show located errors before changing output |
| Publish content | Visible drafts/publish permissions, preview and editor recovery; no success message before durable completion |
| Reuse frontend work | Optional pages/layouts or a dependency-free client in an existing frontend; neither requires adopting the other |
| Move from another CMS | Honest loss/refusal report with valid pointers; distinguish config import from content, identity and application migration |
| Let an agent operate | Same access and validation contract as the API/editor; clear receipts and recoverable errors |

Payload's schema/hooks/local API ergonomics, EmDash's small project surface
and Sanity's editorial/composition model are useful benchmarks. Matching a
builder syntax does not establish parity in rich text, collaboration, preview,
media, localization, revisions or deployment. Keep those as explicit tested
capabilities and gaps rather than claiming full product equivalence.

## Delivery and evidence

1. Preserve the shipped class support and explicit data model. Their existing
   owners qualify mixed-storage relations, target access and generated-client
   typing; extend those owners when the contract changes.
2. Continue qualifying the current system against real disposable WordPress, its pinned plugins
   and database. Report exact revisions and failed checks, including editor,
   installed-system and migration seams; do not replace these with mocks.
3. Preserve the shipped S3 replica-replacement and native admin browser owners.
   They qualify their recorded service/artifact scope. Additional providers,
   plugins and new editing flows need their own real operations; packaging and
   unit tests alone do not prove browser reachability or usable screens.
4. Reconcile this direction with the draft pages design. Keep the reviewed
   process/session drain, cache, password, private-memory and durable retirement
   contracts. Do not call them qualified because the design passed review.
5. Implement optional pages and agents in dependency order. One qualified
   Action Scheduler runner, pinned DM adapter and qualified approval bridge
   remain acceptance gates, not claims about shipped code.
6. Update executable examples, public docs and the explainer from the exact
   merged implementation. Maintain one behavioral test owner per seam.

Historical validation of the tracked tree at main `2700ebc1` passed its existing
Rust, PHP, types/client, Docker WordPress, system/installed, legacy, identity,
admin bundle and native/WASM/site owners. A separate real-browser audit found
an admin login loop and missing or blank SPA routes; native Gutenberg saved
successfully. Later implementation `d6d10eda` supplied the native login/editing
boundaries and browser ownership. The old failure is not a current-head result.
Neither that historical baseline nor the later foundation checks qualify the
future pages/agents implementation, host publisher or Data Machine bridge.
