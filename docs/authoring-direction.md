# Authoring direction: content, data and optional pages

Selected direction, 2026-11-02. This is a design and implementation brief,
not documentation of released APIs. Main at `2700ebc1` has the previous
config surface. Explicit storage and class support are separate implementation
changes in progress. The pages and agents proposal remains a draft.

The latest owner requirements are explicit: collections and tables are
different authoring concepts, both support relations, TypeScript support
must grow, and the product must earn a better authoring experience than
Payload, EmDash and Sanity. This supersedes #55's proposed storage inference.
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

These are target snippets, not a claim that current main accepts the new config.
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

## Special files

```text
shop/
├── zero.config.ts             # required: content, tables, access and backend behavior
├── zero.gen.ts                # generated editor types; never hand-edit
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
├── agents/                   # optional instruction files, referenced by agent declarations
│   └── editor.md
├── content/products/         # optional collection file sync
├── zero/
│   ├── client/               # generated typed HTTP client
│   ├── migrations/           # reviewed database migrations
│   └── wp-plugins.lock.json  # pinned plugin artifacts
└── .zero/                    # generated build/staging output
```

Do not require a folder per collection, service classes, a route handler per
resource, or a special file for every backend operation. Splitting the config
into ordinary relative imports is optional. Discovery applies only to the
documented page entry files. Co-located helper and test files are not routes.
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

## What better UX must demonstrate

The competitor research is recorded in [research adoption](research-adoption.md)
and [config migration](config-migration.md). It motivates these acceptance
criteria; it is not an executed current-version comparison of all products.

| User task | Acceptance bar |
|---|---|
| Start a content app | One config and one dev command; working content editor/client, not plugin setup instructions on the main path |
| Mix content and app data | Explicit collection/table choice, same field vocabulary and relation queries, no storage inference surprises |
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

1. Finish and independently review class support and the explicit data model.
   Prove one mixed-storage application with relation loading, target access and
   generated-client typing through the existing owners.
2. Run the current system against real disposable WordPress, its pinned plugins
   and database. Report exact revisions and failed checks, including editor,
   installed-system and migration seams; do not replace these with mocks.
3. Reconcile this direction with the draft pages design. Keep the reviewed
   process/session drain, cache, password, private-memory and durable retirement
   contracts. Do not call them qualified because the design passed review.
4. Implement optional pages and agents in dependency order. One qualified
   Action Scheduler runner, pinned DM adapter and qualified approval bridge
   remain acceptance gates, not claims about shipped code.
5. Update executable examples, public docs and the explainer from the exact
   merged implementation. Maintain one behavioral test owner per seam.

The fresh system run and new implementation reviews are still in progress.
This file makes no passing-test claim on their behalf.
