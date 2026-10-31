# Zero Blocks — Gutenberg JSX and TSX block themes

Status: proposed, for review. An optional package in this repo. Nothing in
Zero core (`src/`, `runtime/`, the `zero-*` plugins) depends on it, and a Zero
app that does not use it gains no build step, dependency or output.

This document decides the package, its authoring API, how a TSX theme becomes
a block theme, how it is built, validated and tested, and in which PRs it
lands. It ports Spacefast's earlier Gutenberg JSX work where that work was
right and redesigns it where Zero v2's first principles say otherwise.

Conventions: "error" = the build fails with `file:line:col` and a fix, and
nothing is written. "WP" = WordPress 7.1, the pinned platform (`docs/design-phase2.md` §2.7).
Zero is WordPress-only; everything this package produces is rendered by
WordPress and nothing else.

## 0. Decisions in one screen

| Area | Decision |
|---|---|
| Package | `@spacefast/zero-blocks`, in `packages/blocks/`. Node ≥ 22, TypeScript, pnpm with a committed lockfile, `node --test`. Published to npm later; never a dependency of anything else in this repo. |
| What it is | Two things sharing one core: **content** (TSX → serialized Gutenberg block markup) and **theme** (a directory of TSX → a complete WordPress block theme). |
| JSX | `jsxImportSource: "@spacefast/zero-blocks"`. No React, no vdom. HTML tags map to core blocks (`<p>` → `core/paragraph`), components are transparent functions, blocks are named components. Every node carries its source location, so every diagnostic has `file:line:col`. |
| Serializer | Core's own `createBlock()` + `serialize()` from `@wordpress/blocks` with `@wordpress/block-library` registered under happy-dom, pinned to the exact package versions WordPress 7.1 bundles. Byte-parity with each block's `save()` is what makes templates open valid in the Site Editor; nothing leaner can promise that. |
| Codegen | `Block.Core.*`: one typed component per registered core block, generated from `getBlockTypes()` (so `supports`-derived attributes are included), committed, drift-guarded by a test. `theme.json` types generated from the official 7.1 schema. |
| Theme output | A real block theme: `style.css` (header), `theme.json` (v3), `templates/*.html`, `parts/*.html`, `patterns/*.php`, `styles/*.json`, copied `assets/`, plus `<slug>.zip`. Installable with `wp theme install`; no executable PHP logic, only the pattern header comments WordPress requires. |
| Theme source | `theme.config.ts` (`defineTheme`: header + typed `theme.json`), `templates/<slug>.tsx`, `parts/<slug>.tsx`, `patterns/<name>.tsx`, `styles/<name>.ts`, `assets/`. File names are the template hierarchy. |
| Validation | Unknown core block, unknown or mistyped attribute, a `save()` that throws, `style` prop on an HTML tag, unmappable tag, missing part or pattern reference, unknown preset slug, template name outside WP's hierarchy without a custom-template declaration, `theme.json` failing the 7.1 schema: all errors with locations. Never silently dropped. |
| Zero collections | Optional sugar in `@spacefast/zero-blocks/zero`: `bind.field("excerpt")` → the SCF block binding `{ source: "acf/field", args: { key: "zero_excerpt" } }` for the meta key Zero writes. Pure markup; no runtime dependency on Zero. Query loops over Zero collections are **not** offered: `core/query` ignores non-viewable post types and Zero's are private (§5). |
| Not in scope | Capsule frontends, islands, the `zero/component` dynamic block, `_pages` system pages, any JS app runtime, HTML→TSX, live editing, Markdown. See §9. |
| Proof | `packages/blocks/tests/wp/run.sh`, one stack (own compose project, port 8840): a fresh WordPress from `tests/wp/harness.sh up --bare`; the built example theme installed from its zip and activated; front-end render; `theme.json` styles in the page; every template and part opened in the real Site Editor with no invalid or missing block, read from the editor's own store. Then the pinned platform plugins and the blog example's Zero artifact are installed into the same site and the binding sugar is proven on a real collection row through a real SCF field. |
| CI | Two jobs in `.github/workflows/ci.yml`: `blocks` (typecheck, unit tests, codegen drift) and `blocks-wp` (the Docker proof). Zero core's jobs are untouched. |

## 1. Why, and what changes from the earlier work

Zero is a data/API layer plus a typed client: "bring your own frontend". On
WordPress the frontend that is already there is the block theme. Writing one
in TSX gives real functions, imports, loops and types where today there are
hand-edited HTML files and a 400-line `theme.json`, while the output stays a
plain theme the Site Editor can open and a designer can keep editing.

Spacefast's earlier Gutenberg JSX work proved the core idea: execute an
authored TSX module once at build time, map HTML tags to core blocks, and run
core's own serializer so the result validates in the editor. That core is
ported almost intact. What changes:

| Earlier work | Here | Why |
|---|---|---|
| Content pages served by a Spacefast runtime | Content compiles to markup; themes compile to a theme. WordPress serves and renders all of it; the package renders nothing. | No capsule frontends, no second runtime. |
| Islands (`client/` components → hydrated mounts), `zero/component` block | Removed. `core/html` remains for verbatim HTML only. | A JS app runtime is out of scope by ruling. |
| `_pages/*.tsx` system pages → HTML documents | Removed. | Spacefast platform pages; nothing in Zero corresponds. |
| `ZERO_DYNAMIC_BLOCKS` decided whether WordPress or the Spacefast runtime had to serve a page | Removed. | WordPress serves every page, so the distinction has no meaning. In a theme every template block is dynamic and that is fine. |
| Diagnostics per entry file | Diagnostics per JSX node: `templates/index.tsx:14:9`. | `jsxDEV` hands the runtime each element's source position; the mapper and serializer keep it. |
| `core/query` forbidden from `inherit: true` | `inherit` is the normal archive loop in a template; `<QueryLoop>` requires the author to choose `inherit` or an explicit query. | The restriction existed for a renderer with no main query; WordPress always has one. |
| Attribute drift silently dropped by `createBlock` | Attributes checked against the registered schema; unknown or mistyped → error. | "never silently dropped" was the stated goal; this closes the gap. |
| Nine hand-written "popular" blocks | Kept, extended with the template vocabulary (`TemplatePart`, `QueryLoop`, `PostContent`, `Navigation`, …). | Themes reach for those constantly. |
| bun, `@spacefast/common`, zod | Node 22, `node --test`, no shared internal packages, hand-written narrowing. | This repo has no monorepo tooling, and the package must stand alone when published. |
| TSX → blocks is one-way; an editor save supersedes the TSX | Same. A theme is a starting point the Site Editor can override through user customisations (`wp_template` posts), as with any block theme. | WordPress's own model. |

## 2. Package

```
packages/blocks/
  package.json            name @spacefast/zero-blocks, "type": "module", bin zero-blocks, exact @wordpress pins
  pnpm-lock.yaml
  tsconfig.json
  README.md
  src/
    jsx-runtime.ts        jsx, jsxs, jsxDEV, Fragment; the JSX namespace
    nodes.ts              ElementNode | BlockNode | TextNode, each with `loc`
    mapping.ts            HTML tags → core blocks; rich text rendering
    diagnostics.ts        Diagnostic { code, message, hint, loc }, formatting
    blocks.generated.ts   GENERATED: Block.Core.* and attribute types
    blocks-popular.ts     hand-written components (content + theme vocabulary)
    index.ts              `@spacefast/zero-blocks`: Block, Fragment, popular components, types
    theme/
      define.ts           defineTheme, defineTemplate, definePattern, defineStyleVariation, preset.*
      theme-json.generated.d.ts   GENERATED from the 7.1 theme.json schema
      index.ts            `@spacefast/zero-blocks/theme`
    compiler/
      module.ts           bundle one TSX with esbuild, execute it, return its default export
      serialize.ts        happy-dom + @wordpress/blocks: validate attrs, createBlock, serialize
      content.ts          compileContent(file) → { markup, diagnostics }
      theme.ts            buildTheme(dir, out) → files + diagnostics
      hierarchy.ts        WordPress template slugs and their patterns
      index.ts            `@spacefast/zero-blocks/compiler`
    zero/
      index.ts            `@spacefast/zero-blocks/zero`: bind.*
    cli.ts                zero-blocks build | check | content
  scripts/
    codegen-blocks.ts     --write regenerates blocks.generated.ts; no flags = parity check
    codegen-theme-json.ts same for theme-json.generated.d.ts from schemas/theme-7.1.json
  schemas/theme-7.1.json  the official schema, fetched once, committed
  examples/starter/       the example theme (§7)
  tests/
    *.test.ts             unit: jsx-runtime, mapping, serialize (reparse isValid), theme build goldens, diagnostics
    wp/run.sh, wp/*.test.ts   the Docker proof (§8)
```

Exports:

| Subpath | Audience | Contents |
|---|---|---|
| `@spacefast/zero-blocks` | authors | `Block`, `Fragment`, popular components, node types |
| `@spacefast/zero-blocks/jsx-runtime`, `/jsx-dev-runtime` | the TSX transform | `jsx`, `jsxs`, `jsxDEV`, `Fragment` |
| `@spacefast/zero-blocks/theme` | theme authors | `defineTheme`, `defineTemplate`, `definePattern`, `defineStyleVariation`, `preset`, `TemplatePart`, `Pattern`, `QueryLoop`, … |
| `@spacefast/zero-blocks/compiler` | tools, tests | `compileContent`, `buildTheme`, `Diagnostic` |
| `@spacefast/zero-blocks/zero` | Zero app authors | `bind` |
| bin `zero-blocks` | everyone | `build`, `check`, `content` |

Dependencies, all pinned exactly: `esbuild` (bundle + execute authored TSX),
`happy-dom` (the DOM `@wordpress/*` expects at import time), `@wordpress/blocks`
15.24.0, `@wordpress/block-library` 10.2.0, `@wordpress/element` 8.3.0, `react`
and `react-dom` 18.3.1 (peers of `@wordpress/element`), `ajv` (the `theme.json`
schema check). The `@wordpress/*` versions are the ones WordPress 7.1 ships
(Gutenberg `8daba429`); raising the WordPress floor means bumping these three
pins and regenerating. Dev: `typescript` 5.9.3 (as CI), `@types/node`,
`playwright` (the Site Editor proof only), `json-schema-to-typescript`.

Rules the package keeps: no Rust changes; nothing in `src/`, `runtime/`,
`tests/wp/*.test.ts`, `tests/system/`; root `.gitignore` gains two lines
(`packages/blocks/node_modules/`, `packages/blocks/**/dist/`). No `cargo test`
or PHP suite learns about it.

License: the package is MIT, as Spacefast's earlier Gutenberg JSX package
was, so the ported code keeps its license; the themes it builds declare
GPL-2.0-or-later in `style.css` (the author can override the header field),
which is what WordPress expects of a theme. The ported files are rewritten
rather than copied where this design changes them (locations, attribute
checks, the theme lane) and copied where it does not (the mapping table, the
happy-dom registration, the passthrough block); either way they ship under
this package's license.

## 3. Content: TSX → block markup

### 3.1 Authoring

```tsx
// pricing.tsx
import { Block, Buttons, Button } from "@spacefast/zero-blocks";
import { plans } from "./plans";

export default function Pricing() {
  return (
    <>
      <h1 id="pricing">Plans</h1>
      <p class="lead">Simple, honest pricing.</p>
      <Block.Core.Columns>
        {plans.map((plan) => (
          <Block.Core.Column key={plan.id}>
            <h3>{plan.name}</h3>
            <p><strong>{plan.price}</strong> / month</p>
            <Buttons><Button url={plan.href} text="Start" /></Buttons>
          </Block.Core.Column>
        ))}
      </Block.Core.Columns>
      <Block name="acme/testimonials" attrs={{ count: 3 }} />
    </>
  );
}
```

Three ways to name a block, in the order to reach for them: an HTML tag (mapped
for you), a hand-written component (`Buttons`, `Cover`, `QueryLoop`, …), and
`Block.Core.<Name>` for every registered core block with every registered
attribute. `<Block name="vendor/thing">` is the escape hatch for third-party
blocks; the compiler cannot validate those and says so once per build.

### 3.2 The mapping table (ported)

| HTML | Block | Notes |
|---|---|---|
| `p` | `core/paragraph` | loose text and phrasing runs at block level also become one paragraph |
| `h1`–`h6` | `core/heading` | `level` from the tag |
| `ul`, `ol` → `li` | `core/list` → `core/list-item` | `ordered` on `ol`; nested lists ride inside the item |
| `blockquote` | `core/quote` | loose text inside becomes a paragraph |
| `pre` (`> code`) | `core/code` | |
| `img`; `figure > img (+ figcaption)` | `core/image` | `src`→`url`, `alt`, caption |
| `table` (`thead/tbody/tfoot > tr > th/td`) | `core/table` | cells are attributes, as core stores them |
| `hr` | `core/separator` | |
| `details (> summary)` | `core/details` | |
| `section article aside header footer main nav` | `core/group` with `tagName` | |
| `div` with `class`/`id` | `core/group` | a bare `div` dissolves into its children; never a free wrapper |
| `a abbr b br cite code del em i ins kbd mark q s samp small span strong sub sup time u var` | rich text | inline inside the enclosing block |
| `class`/`className` | `className`; `id` | `anchor` |

Refused: a `style` prop on any HTML tag (`style_prop_unsupported`; hint: use
the block's own `style` attribute object through a block component, or a
class), and a tag with no block (`unmappable_element`; hint: a mapped tag or
`<Block name>`). No layout inference: a flex-looking `div` is a group with
those classes, never columns.

### 3.3 Executing a module

`compileContent(file)` bundles the file with esbuild (`format: "esm"`,
`platform: "neutral"`, `jsx: "automatic"`, `jsxDev: true`,
`jsxImportSource: "@spacefast/zero-blocks"`, `sourcemap: "inline"`), resolving
the JSX runtime to this package's own copy so an author's `node_modules` cannot
change what a page compiles to, writes the bundle to a fresh temp directory,
imports it with source maps enabled, and calls the default export once. A
thrown error reports with the author's file and line through the source map.

Execution model, stated plainly: authored modules are **trusted code run in
the build's own Node process**, like a `vite.config.ts` or a Zero
`zero.config.ts` before Zero's evaluator existed. The neutral platform makes
static `node:*` imports a bundle error, which catches the common accident; it
is not a sandbox, and `fetch`, `process`, `Date.now()` and `Math.random()`
remain reachable. Determinism is therefore a contract the author keeps, not
one the compiler enforces: the build runs each module once, and the
double-build test over the compiler's fixture theme (§4.7) proves the
*compiler* adds no nondeterminism of its own. A restricted evaluator (Zero's Rust evaluator
handles `zero.config.ts` this way) is the obvious upgrade if untrusted themes
ever need building; it is out of scope here.

`jsxDEV(type, props, key, isStatic, source)` receives `{fileName, lineNumber,
columnNumber}` for every element; the runtime stores it as `loc` on the node,
components stay transparent (the node a component returns keeps the location
of the JSX inside the component, and the call site is appended to the
diagnostic as "used at …"). This is how every diagnostic gets `file:line:col`
without parsing TSX ourselves.

### 3.4 Serializing

`serialize.ts` registers the pinned `@wordpress/block-library` under happy-dom
once per process (the DOM globals are installed for the duration of a call and
restored after, as before) and, for each block node:

1. **Name check.** `core/*` must be registered → else `unknown_block` with the
   nearest registered name as the hint. Other namespaces are passthrough
   blocks: registered on the fly with the attributes the author wrote and a
   `save()` that emits the children verbatim (ported), reported once as
   `unverified_block` at the `--verbose` level, never an error.
2. **Attribute check** (new). Every attribute must exist on the registered
   type (`unknown_attribute`, with the nearest attribute name) and its value
   must fit the declared type (`attribute_type`). Sourced attributes are
   ordinary inputs: `core/image.url`, `core/button.url`/`text`,
   `core/heading.content` are all registered attributes that `createBlock`
   accepts and `save()` writes into the markup rather than the comment, so
   they are allowed like any other. Attributes registered with
   `role: "local"` (`core/image.blob` for one) are editor-session state that
   WordPress's serializer deliberately never writes; setting one is
   `local_attribute`, with the hint that it cannot reach the saved markup,
   and the codegen omits them from the generated props. The single exception
   is `core/html.content`, also `role: "local"`: it is the Custom HTML
   block's whole body, stored as the block's `innerContent` rather than an
   attribute, so the codegen keeps it as the author-facing prop and the
   serializer writes it into `innerContent` (ported; preservation is tested
   by reparsing the inner HTML, not an attribute). The one rule about
   `content`: when a block has both children and a `content` prop, that is
   two bodies for one block (`content_and_children`). `createBlock` drops
   an unknown attribute silently and `serialize()` drops a local one
   silently, which are exactly the failures this package exists to prevent.

   Value typing follows the registry's vocabulary, not raw JSON types:
   `string` and `rich-text` accept a string (`rich-text` is what `createBlock`
   turns into `RichTextData`; the author-facing type is `string` and the
   mapper's rendered HTML is such a string); `number`/`integer` a finite
   number (`integer` also whole); `boolean`; `array`; `object` a plain
   object; `null`; a `type` array is a union; `enum` narrows to the listed
   literals. Structured `object` attributes (`style`, `layout`, `lock`,
   `metadata`, `query`) are not validated deeper than "plain object": their
   shapes belong to WordPress and are typed `BlockObjectAttribute` in the
   generated components (ported decision). The same table drives the codegen
   in §2, so what TypeScript accepts and what the serializer accepts are one
   definition.
3. **Rich text.** Phrasing nodes render to an HTML string and land in the
   block's `content` attribute when the registered type has one with a
   rich-text or HTML source; a block with no body (a cover, a group) gets an
   implicit paragraph, as typing into one in the editor would.
4. `createBlock(name, attrs, innerBlocks)` then `serialize()` over the whole
   tree. `core/html` writes its `content` as `innerContent` verbatim (ported).
   `serialize()` catches a throwing `save()` and emits an empty block, so the
   serializer calls `getSaveContent(type, attrs, innerBlocks)` itself per
   block first; a `save()` that throws becomes `save_failed` at the node's
   location instead of silent empty markup.

Output is the markup WordPress stores and the Site Editor opens. Two
separate guarantees are tested, at the unit level, through the pinned
parser: **validity** (`parse(markup)` reports `isValid: true` for every
block and no `core/missing`) and **preservation** (the reparsed tree has the
block names, nesting, rich-text strings and the attributes the author set).
Validity alone would pass a block whose attribute vanished. This stays the
single serializer for content, templates, parts and patterns.

### 3.5 CLI

`zero-blocks content <file.tsx> [--out <file.html>]` prints or writes the
markup. It is the lowest-level tool and what the theme compiler calls per
template. Feeding markup into a Zero collection is possible today without any
seam: the typed client (or `wp post update`) writes it to the collection's
content `richText` column, where block markup is stored as-is as the post's
content. Zero's file sync is **not** the route: its `*.html` format pulls by
stripping block delimiters and refuses server-rendered blocks (phase 2 §5.2),
so a round trip would not preserve what this package produced. A `*.tsx` sync
format would be a Zero-core seam and is deferred.

## 4. Themes: a directory of TSX → a block theme

### 4.1 Source layout

```
my-theme/
  theme.config.ts        defineTheme(): header fields + theme.json settings/styles
  templates/
    index.tsx            required
    single.tsx  page.tsx  archive.tsx  404.tsx  search.tsx  front-page.tsx
    landing.tsx          custom: export const meta = defineTemplate({ title: "Landing", postTypes: ["page"] })
  parts/
    header.tsx  footer.tsx  sidebar.tsx
  patterns/
    hero.tsx             export const meta = definePattern({ title: "Hero", categories: ["banner"] })
  styles/
    dark.ts              export default defineStyleVariation({ title: "Dark", styles: {...} })
  assets/                copied as-is (fonts, screenshot.png, images)
```

Output (`zero-blocks build my-theme --out dist`):

```
dist/zero-starter/
  style.css              header only: Theme Name, Theme URI, Author, Description, Version, Requires at least 7.1,
                         Requires PHP 8.2, License, Text Domain = slug, Tags
  theme.json             version 3, $schema https://schemas.wp.org/wp/7.1/theme.json
  templates/*.html  parts/*.html  patterns/*.php  styles/*.json  readme.txt  assets/**  screenshot.png
dist/zero-starter.zip
```

No `functions.php`, no PHP logic: a theme this package builds is data. The
one PHP the compiler writes is the pattern file header WordPress requires
(§4.5), a comment and nothing executable. Should a theme ever need PHP, the
author adds a plugin; this package will not grow a PHP lane.

### 4.2 `theme.config.ts` and typed tokens

```ts
import { defineTheme, preset } from "@spacefast/zero-blocks/theme";

export default defineTheme({
  name: "Zero Starter",
  slug: "zero-starter",
  version: "0.1.0",
  description: "A block theme written in TSX.",
  author: "Spacefast",
  license: "GPL-2.0-or-later",
  settings: {
    appearanceTools: true,
    useRootPaddingAwareAlignments: true,
    layout: { contentSize: "44rem", wideSize: "72rem" },
    color: {
      defaultPalette: false,
      palette: [
        { slug: "base", name: "Base", color: "#ffffff" },
        { slug: "contrast", name: "Contrast", color: "#111111" },
        { slug: "primary", name: "Primary", color: "#3858e9" },
      ],
    },
    typography: {
      fontFamilies: [{ slug: "body", name: "Body", fontFamily: "Inter, sans-serif",
        fontFace: [{ fontFamily: "Inter", fontWeight: "400 700", fontStyle: "normal", src: ["file:./assets/fonts/inter.woff2"] }] }],
      fontSizes: [{ slug: "sm", name: "Small", size: "0.875rem" }, { slug: "lg", name: "Large", size: "1.5rem" }],
    },
    spacing: { spacingSizes: [{ slug: "20", name: "2", size: "1rem" }, { slug: "40", name: "4", size: "2rem" }] },
  },
  styles: {
    color: { background: preset.color("base"), text: preset.color("contrast") },
    typography: { fontFamily: preset.fontFamily("body") },
    elements: { link: { color: { text: preset.color("primary") } } },
    blocks: { "core/button": { border: { radius: "4px" } } },
  },
});
```

- The `settings`/`styles`/`customTemplates`/`templateParts`/`patterns` shapes
  are the generated `ThemeJson` type from the official 7.1 schema, so the
  editor completes and checks every key WordPress knows. Header fields are a
  small hand-written type.
- `defineTheme` uses a `const` type parameter, so the returned value carries
  literal slugs: `theme.tokens.color.primary === "primary"`,
  `theme.tokens.fontSize.lg`, `theme.tokens.spacing["40"]`,
  `theme.tokens.fontFamily.body`. Templates import the default export and pass
  tokens to block props (`<Group backgroundColor={theme.tokens.color.primary}>`),
  which is how a renamed slug becomes a type error instead of a silently
  unstyled block.
- `preset.color(slug)` and friends return `var:preset|color|<slug>`, the form
  `theme.json` styles use. At build time every preset reference in `styles`
  and every preset-slug attribute in templates (`backgroundColor`, `textColor`,
  `borderColor`, `overlayColor`, `gradient`, `fontSize`, `fontFamily`) is
  checked against the palette, including WordPress's defaults unless
  `defaultPalette`/`defaultFontSizes`/`defaultGradients` are false →
  `unknown_preset` with the file and line of the attribute.
- The emitted `theme.json` is validated against the committed 7.1 schema with
  ajv; a failure reports the JSON pointer and `theme.config.ts`.
- `templateParts` and `customTemplates` in `theme.json` are **derived** from
  the files (§4.3–4.4) and merged with anything declared in `defineTheme`; a
  declaration that names a file that does not exist is an error.
  `theme.json`'s `patterns` key means something else in WordPress (slugs to
  pull from the wordpress.org Pattern Directory), so it is passed through
  from `defineTheme({ patterns })` untouched and never derived. Local
  patterns register themselves from `patterns/*.php` (§4.5). Patterns a
  plugin registers can be referenced with `<Pattern slug>` when listed under
  `defineTheme({ externalPatterns: ["acme/testimonials"] })`, which is only a
  compile-time allow-list and writes nothing.

### 4.3 Templates and the hierarchy

A template is `templates/<slug>.tsx` default-exporting a component; the file
name is the slug WordPress resolves. `hierarchy.ts` holds WordPress's own
list: the default block template types WordPress 7.1 declares
(`get_default_block_template_types()`: `index`, `home`, `front-page`,
`singular`, `single`, `page`, `archive`, `author`, `category`, `taxonomy`,
`date`, `tag`, `attachment`, `search`, `privacy-policy`, `404`), the derived
forms (`single-<post_type>`, `single-<post_type>-<slug>`, `page-<slug>`,
`page-<id>`, `archive-<post_type>`, `category-<slug>`, `tag-<slug>`,
`taxonomy-<taxonomy>`, `taxonomy-<taxonomy>-<term>`, `author-<nicename>`),
and the attachment MIME forms (`<type>`, `<subtype>`, `<type>-<subtype>` for
the types WordPress serves: `image`, `video`, `audio`, `application`, `text`,
plus any `<type>-<subtype>` whose type is one of those). Any other name must
export `meta = defineTemplate({ title, postTypes? })`, which puts it in
`customTemplates`; otherwise `unknown_template` with both options as the hint.
The proof suite (§8 step 5) checks three representatives of the derived
forms resolve on real WordPress, using a disposable copy of the example
theme with `single-post.tsx`, `page-<slug>.tsx` and `image.tsx` added, each
containing a marker block only that template renders.
`templates/index.tsx` is required (`index_template_missing`).

Template vocabulary (hand-written components over the generated set, all
checked by the serializer like any block):

| Component | Block | Notes |
|---|---|---|
| `<TemplatePart slug="header" />` | `core/template-part` | `slug` must be a file in `parts/` → else `unknown_template_part`. `tagName`, `area` from the part's declaration. |
| `<Pattern slug="zero-starter/hero" />` | `core/pattern` | slug must be a theme pattern (§4.5) or listed in `defineTheme({ externalPatterns })`. |
| `<QueryLoop inherit>` / `<QueryLoop postType perPage orderBy order …>` | `core/query` + `core/post-template` | exactly one of `inherit` or an explicit query (`query_mode_required`). Children are the per-post template; `NoResults`, `Pagination` are siblings inside the loop. |
| `PostTitle PostContent PostExcerpt PostDate PostFeaturedImage PostAuthorName PostTerms ReadMore` | `core/post-*`, `core/read-more` | |
| `SiteTitle SiteTagline SiteLogo Navigation` | `core/site-*`, `core/navigation` | `Navigation` with children `NavigationLink`/`PageList`; or `ref` for a saved menu |
| `Group Columns Column Cover Spacer Separator Buttons Button MediaText Gallery Embed` | as named | the content populars, with `layout`/`style` objects typed as `BlockObjectAttribute` |
| `CommentsArea`, `Comments…` | `core/comments` and children | the hierarchy WordPress's default theme uses |

Templates are dynamic by nature; a template that uses no post block at all is
still valid (a 404 page).

### 4.4 Parts

`parts/<slug>.tsx` default-exports a component. Optional
`meta = definePart({ title, area })`; `area` defaults to `header` for
`header*`, `footer` for `footer*`, else `uncategorized`. The compiler writes
`parts/<slug>.html` and the `templateParts` entry. A part referenced nowhere
is a warning, not an error (themes legitimately ship optional parts).

### 4.5 Patterns

`patterns/<name>.tsx` exports `meta = definePattern({ title, slug?,
description?, categories?, keywords?, blockTypes?, postTypes?, templateTypes?,
inserter?, viewportWidth? })` and a default component. The compiler writes
`patterns/<name>.php` in the exact form WordPress's theme loader reads
(`WP_Theme::get_block_patterns()`): a `<?php` opening, one `/** … */`
comment with the headers `Title`, `Slug`, `Description`, `Viewport Width`,
`Inserter`, `Categories`, `Keywords`, `Block Types`, `Post Types`, `Template
Types` (lists comma-separated, booleans `yes`/`no`, only the ones set,
`Title` and `Slug` always), then `?>` and the markup. No other PHP. The slug
defaults to `<theme-slug>/<name>` and must be unique (`duplicate_slug`). A
pattern component can also be called inline in a template (`<Hero />`),
which inlines its blocks; `<Pattern slug>` references it by name instead and
lets the user swap it in the editor. The proof suite checks registration
through `GET /wp/v2/block-patterns/patterns` (title, categories, content)
and the pattern's blocks in a rendered page, never the PHP text.

### 4.6 Style variations

`styles/<name>.ts` default-exports `defineStyleVariation({ title, settings?,
styles? })` → `styles/<name>.json`, validated against the same schema and the
same preset checks (a variation may add presets of its own).

### 4.7 `build`, `check`, determinism

`zero-blocks build <dir> [--out <dir>] [--zip]` runs: load `theme.config.ts`
(esbuild, same executor) → derive the file manifest → compile every template,
part, pattern and variation (one shared block registry, deterministic order)
→ validate `theme.json` → write to a staging directory → replace `<out>/<slug>`
atomically → zip. Any diagnostic of severity error means nothing is written.
`zero-blocks check <dir>` is the same without writing. Output is byte-stable
for the same input (the unit suite builds its fixture theme twice and
compares; PR 4 does the same for the example theme).

Diagnostics print as `templates/single.tsx:22:7 unknown_attribute: core/post-date
has no attribute "fmt". Did you mean "format"?` and exit 1; `--json` prints
them as `{ code, message, hint, file, line, column }` for tools.

## 5. Zero collections (optional sugar)

`@spacefast/zero-blocks/zero` knows one Zero convention and nothing else:

- `bind.field("excerpt")` → `{ source: "acf/field", args: { key: "zero_excerpt" } }`,
  the Secure Custom Fields block-binding source (SCF 6.9.7 reads
  `$source_attrs['key']` as the field name or key) for the meta key Zero
  writes (`zero_<column>`), usable as
  `<Paragraph bindings={{ content: bind.field("excerpt") }}>` which lands in
  the block's `metadata.bindings`. SCF resolves it at render time against the
  post being rendered; nothing of ours runs. Only field types SCF allows in
  bindings resolve (text, textarea, number, email, url, select, …); a
  `richText` column is a WYSIWYG field and SCF refuses it, which is
  documented, not detected.

It emits plain block markup. A theme built with it works on any site with
SCF and a Zero app plugin active, and the package has no import of Zero.

**What is deliberately not offered, and why.** A `collection("posts")`
helper that names Zero's post type (`zero_posts`) for `<QueryLoop postType>`
or `single-zero_posts` templates was in the first draft and is withdrawn.
WordPress 7.1's `build_query_vars_from_query_block()` honours a
`query.postType` only when `is_post_type_viewable()` is true; Zero registers
its collections `public: false`, `publicly_queryable` unset, `rewrite:
false`, so a loop over `zero_posts` silently falls back to core `post`, and
an unregistered type does the same. A helper whose output looks right and
quietly shows the wrong posts is worse than none. The same registration
means `single-zero_posts` has no front-end URL to resolve to. Both become
possible the day a Zero collection can opt into being publicly viewable
(a collection option in Zero core, outside this design); this package would
then add `collection()` as a one-line helper. Until then the README says:
a binding resolves against the post WordPress is currently rendering, so it
reads a Zero row's field only when that row *is* the current post (wp-admin
previews, a plugin's own query loop with `setup_postdata`); a theme on its
own cannot select a collection row from a core post. Other routes to Zero
data from a theme are a plugin reading the Zero REST API, or writing
`zero-blocks content` output into a collection's content column.

## 6. Diagnostics (complete list)

| Code | Severity | Where |
|---|---|---|
| `style_prop_unsupported`, `unmappable_element` | error | mapper, node loc |
| `unknown_block`, `unknown_attribute`, `attribute_type`, `local_attribute`, `content_and_children`, `save_failed` | error | serializer, node loc |
| `unverified_block` | info (`--verbose`) | serializer, first use |
| `module_failed` (bundle or execution error), `default_export_missing`, `not_content` (a component returned something that is not JSX, text or a number) | error | module, mapped through the source map |
| `index_template_missing`, `unknown_template`, `unknown_template_part`, `unknown_pattern`, `query_mode_required`, `unknown_preset`, `theme_json_invalid`, `declared_file_missing`, `duplicate_slug` | error | theme compiler |
| `unused_part` | warning | theme compiler |

## 7. The example theme: `packages/blocks/examples/starter`

A small, complete block theme: `theme.config.ts` with a palette, two font
sizes, spacing scale, a font face from `assets/`; `templates/` index, single,
page, archive, search, 404, front-page; `parts/` header (site title +
navigation), footer; `patterns/` hero and a call to action; `styles/dark.ts`.
The front page uses `<QueryLoop inherit>`; the hero pattern has several
top-level blocks so the editor's pattern expansion is exercised. A
`single-zero_posts.tsx`-style template is *not* included (§5); instead the
`single.tsx` template carries one paragraph bound with
`bind.field("excerpt")` under the post content. On a site without SCF the
binding source is unregistered and the paragraph shows its static fallback
text ("No summary."), a legitimate state for a theme. With SCF and a Zero app
active, and a Zero row as the post being rendered, it shows that row's
`excerpt` (or nothing when the row has none, since SCF answers `""` rather
than `null`). A core post with no matching SCF field also renders an empty
paragraph: SCF returns `""` when the field is absent, so the fallback survives
only while the binding source is unregistered. The second half of §8 proves
these states.
It lives inside the package rather than in `examples/` because that directory
is being reworked by the integration PR; moving it is a one-line change later.

## 8. Proof on real WordPress

`packages/blocks/tests/wp/run.sh` (own stack: `ZERO_WP_PROJECT=zero-blocks`,
`ZERO_WP_PORT=8840`, overridable):

1. `pnpm build` the package, `zero-blocks build examples/starter --zip`.
2. `tests/wp/harness.sh up --wp-content <empty dir> --bare`: WordPress 7.1,
   users, no plugins. No change to the harness, compose file or its mounts.
3. **Install:** copy the zip into the CLI container (`docker compose cp`) and
   `wp theme install /tmp/zero-starter.zip`; assert `wp theme list` shows it
   with the header's version.
4. **Activate:** `wp theme activate zero-starter`; assert `wp theme status`
   and that `wp option get stylesheet` is the slug. Create a post and a page
   through `wp post create` so templates have content.
5. **Render:** fetch `/`, `/<post>/`, `/<page>/`, `/?s=x`, a 404: HTTP 200/404
   as appropriate, body carries the rendered site title from the header part
   and the post title inside the single template's markup, `<body>` has the
   `wp-site-blocks` wrapper. Assertions on rendered HTML responses, never on
   the theme's files. **Hierarchy:** build a disposable copy of the example
   with `single-post.tsx`, `page-<slug>.tsx` and `image.tsx` added (each with
   a marker block), install it as a second theme and activate it; `wp option
   update wp_attachment_pages_enabled 1` (a fresh 7.1 site redirects
   attachment pages away); upload an image with `wp media import`; fetch the
   post, the page by that slug and the attachment page and assert each
   marker appears only on its own URL. Then reactivate the example theme.
6. **Style:** the front page's global-styles stylesheet declares
   `--wp--preset--color--primary` with the palette value, and a block the
   template gave `backgroundColor={theme.tokens.color.primary}` renders with
   `has-primary-background-color`. `wp theme` reports the variation `Dark`
   through `GET /wp/v2/global-styles/themes/zero-starter/variations`.
7. **Validate in the Site Editor:** Playwright (Chromium) logs in as admin and,
   for every template and part the REST API lists for the active theme
   (`/wp/v2/templates` and `/wp/v2/template-parts`, keeping the records whose
   `theme` is the slug; the endpoint has no theme filter parameter), opens
   `site-editor.php?postType=<type>&postId=zero-starter//<slug>&canvas=edit`,
   waits (Playwright `waitForFunction`, no sleeps) until the edited entity
   record for that id is loaded, `getBlocks()` is non-empty, no
   `core/pattern` block remains in the flattened tree (the editor replaces
   each reference with the pattern's blocks asynchronously), and the
   template's distinguishing block is present (the header part's
   `core/site-title`, the single template's `core/post-content`, a block
   from the hero pattern on the front page); then reads the flattened tree
   and asserts no block has `isValid === false` and none is `core/missing`.
   Counts are not compared, since pattern expansion changes them. This is
   the editor's own validation,
   in the editor, against the site's real theme.json and block registry. It
   is what "opens cleanly in the Site Editor" means and the only level that
   can prove it; the unit suite already proves the pinned parser agrees per
   construct, so the two are not redundant.
8. **Binding sugar on a real app** (same stack). Before this step, with SCF
   absent, the single template's bound paragraph on a core post shows its
   static text ("No summary."), which proves the theme degrades to a plain
   paragraph when the binding source is unregistered. Then: `zero build
   examples/blog` (the WordPress artifact), which already contains the resolved,
   checksum-verified dependency plugins (`secure-custom-fields`,
   `action-scheduler`, `mcp-adapter`) beside `zero-runtime` and
   `zero-app-blog`; copy all of `plugins/` from the artifact into the site's
   `plugins/` through the harness's mounted `wp-content` and
   `wp plugin activate` in dependency order exactly as
   `tests/system/wp.test.ts` does (no separate download; `--bare` does not
   fetch the platform zips); create two posts through
   `/wp-json/zero/v1/posts`, one with an `excerpt` and one without. Because
   Zero's post type is not viewable on the front end (§5), the bound
   paragraph is checked where SCF resolves it: `wp eval` renders the single
   template's markup with `do_blocks()` inside a `WP_Query` loop for each
   post (`setup_postdata`). The test asserts the `excerpt` text appears
   inside the bound paragraph for the first post, and that the paragraph is
   empty for the second (SCF returns `""` for an unset field, and WordPress
   keeps the static fallback only for `null`). Render the same markup for
   the core post created before SCF was activated and assert its paragraph
   is now empty too: an absent SCF field also returns `""`. This proves `bind.field()`
   emits a binding SCF 6.9.7 resolves from Zero's meta key, on the real
   pinned plugins. It adds a `cargo build` to the job.
9. Teardown unless `ZERO_WP_KEEP=1`.

CI job `blocks-wp` runs it on `ubuntu-24.04` (Docker preinstalled) with
`npx playwright install --with-deps chromium`; job `blocks` runs
`pnpm install --frozen-lockfile`, `tsc --noEmit`, `node --test`, and both
codegen scripts in check mode. Neither job is added to the existing ones.

## 9. Out of scope, and non-goals

- Capsule frontends, islands, hydration, any browser JavaScript the package
  emits. Not "later": the WordPress Interactivity API would be the way to add
  behaviour to a block theme and would be a separate design.
- `_pages` system pages, Tailwind/`zero.css`, the Spacefast runtime. The
  package renders nothing; WordPress is the only renderer of its output.
- HTML/blocks → TSX (decompilation), two-way editing, live collaboration.
- Markdown (Zero's sync owns it), classic themes, child themes (a `parent`
  header field is trivial and may land when asked), `functions.php` or any
  executable PHP (the pattern header comment in §4.5 is the one exception),
  block registration, block style variations beyond `theme.json`,
  `block.json` custom blocks.
- A watch/dev server. `zero-blocks build` is fast enough to run on save from
  any file watcher; `zero dev --wp` does not learn about themes in this phase.
- Changes to `zero build`, `zero.config.ts`, the harness, or `tests/wp/`.
  Public permalinks for Zero collections (§5) are flagged for core.

## 10. PR plan

Stacked on `main`, each reviewed with Sol on its own diff, each green on every
existing job plus the package's:

| PR | Branch | Contents | Proof |
|---|---|---|---|
| 0 | `p3/blocks-design` | this document | review |
| 1 | `p3/blocks-content` | `packages/blocks/` skeleton (package.json, pnpm lock, tsconfig, bin), JSX runtime with locations, nodes, mapper, diagnostics, module executor, serializer with name/attribute checks, `compileContent`, `zero-blocks content`; `.gitignore` lines; CI job `blocks` (install, `tsc --noEmit`, `node --test`) | unit: runtime, mapping table, serializer validity and preservation by reparse, attribute refusals including a `role: "local"` attribute from the real registry, `core/html` body preserved through `innerContent`, `save_failed`, located diagnostics through a real `.tsx` (file, line, column); one golden of a page with the HTML-mapped constructs as a drift guard |
| 2 | `p3/blocks-codegen` | `scripts/codegen-blocks.ts`, `blocks.generated.ts`, `blocks-popular.ts`, `Block` namespace; `schemas/theme-7.1.json`, `codegen-theme-json.ts`, `theme-json.generated.d.ts`; the `blocks` job gains both codegen check-mode steps | codegen determinism and committed-mirror parity (drift guard); a generated component builds its node; a popular builds its tree; a `tsc` negative fixture proves a mistyped attribute is a type error |
| 3 | `p3/blocks-theme` | `defineTheme`/`defineTemplate`/`definePart`/`definePattern`/`defineStyleVariation`, `preset`, tokens, hierarchy, `buildTheme`, `theme.json` schema validation, template vocabulary, `zero-blocks build/check`; a fixture theme under `tests/fixtures/theme/` | one behaviour per test at the compiler level: manifest derivation and merge with declarations, part/pattern reference resolution, hierarchy acceptance per derived form, preset lookup against palette and defaults, schema acceptance and the pointer on failure, `theme.json` passthrough of `patterns`, pattern header fields read back by a real header parser, a failed build leaving the previous output intact, zip entry list; every diagnostic by the fixture that triggers it; one golden of the fixture theme's output as a drift guard; fixture double build byte-equal |
| 4 | `p3/blocks-example` | `examples/starter`, `tests/wp/run.sh` + tests, CI job `blocks-wp`; `zero` sugar (`bind`) used by the example | §8 on real WordPress, both halves; unit: `bind.field` emits the SCF source and key; the example builds without diagnostics and byte-equal twice |
| 5 | `p3/blocks-docs` | `packages/blocks/README.md` (authoring guide), `docs/blocks.md` (how it fits Zero), a pointer section in the root README | docs render; links resolve |

Order is fixed; 2 could be folded into 1 if the first review prefers fewer PRs.

## 11. Judgment calls to review

1. **Core serializer under happy-dom, pinned to WP 7.1's packages.** Heavy
   (≈15 s to register the library, a React 18 peer) but the only way to
   promise `isValid` without transcribing every `save()`. A leaner
   hand-written serializer was rejected: it would be right for `core/post-*`
   (no save) and wrong for `core/group` the day core changes a class name.
2. **Attribute validation against the registry** is new and strict: a prop a
   core block does not register is an error, not a warning, and there is no
   opt-out for `core/*` (passthrough semantics are for other namespaces
   only). If a real case appears where WordPress accepts an attribute the
   pinned registry does not list, the fix is a registry pin bump, not an
   escape hatch.
3. **Site Editor validation via Playwright** adds Chromium to one CI job. The
   REST-plus-pinned-parser alternative proves less than the ask requires
   ("opens cleanly in the Site Editor"), so Playwright stays, in the WP job
   only.
4. **Example inside the package**, not under `examples/`, to stay out of the
   integration PR's way. Move later.
5. **`@spacefast/zero-blocks`** as the npm name (free; mirrors how
   Spacefast scoped its earlier packages). The bare `zero-blocks` name is
   taken on npm.
6. **No Zero-core seam in this phase.** The one real gap (publicly viewable
   collections, §5, which would unlock query loops and single templates over
   Zero post types) is reported upward rather than patched here, and the
   helper that depended on it is withdrawn rather than shipped half-working.
7. **Trusted execution of authored TSX** (§3.3), as every JS build tool does.
   Zero core evaluates `zero.config.ts` in a pure Rust evaluator; this
   package does not, because themes are the site owner's own code and the
   block library it must run is itself a large untrusted-by-that-standard
   JavaScript dependency.
8. **The proof installs the platform plugins and the blog example's Zero
   artifact** into the same WordPress to exercise the binding sugar (§8 step
   8). It makes the `blocks-wp` job build the Rust binary, which roughly
   doubles its runtime; the alternative, not proving `bind.field()` at all,
   would leave the one Zero-specific feature untested.
