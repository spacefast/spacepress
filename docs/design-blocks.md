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

## 0. Decisions in one screen

| Area | Decision |
|---|---|
| Package | `@spacefast/zero-blocks`, in `packages/blocks/`. Node ≥ 22, TypeScript, pnpm with a committed lockfile, `node --test`. Published to npm later; never a dependency of anything else in this repo. |
| What it is | Two things sharing one core: **content** (TSX → serialized Gutenberg block markup) and **theme** (a directory of TSX → a complete WordPress block theme). |
| JSX | `jsxImportSource: "@spacefast/zero-blocks"`. No React, no vdom. HTML tags map to core blocks (`<p>` → `core/paragraph`), components are transparent functions, blocks are named components. Every node carries its source location, so every diagnostic has `file:line:col`. |
| Serializer | Core's own `createBlock()` + `serialize()` from `@wordpress/blocks` with `@wordpress/block-library` registered under happy-dom, pinned to the exact package versions WordPress 7.1 bundles. Byte-parity with each block's `save()` is what makes templates open valid in the Site Editor; nothing leaner can promise that. |
| Codegen | `Block.Core.*`: one typed component per registered core block, generated from `getBlockTypes()` (so `supports`-derived attributes are included), committed, drift-guarded by a test. `theme.json` types generated from the official 7.1 schema. |
| Theme output | A real block theme: `style.css` (header), `theme.json` (v3), `templates/*.html`, `parts/*.html`, `patterns/*.php`, `styles/*.json`, copied `assets/`, plus `<slug>.zip`. Installable with `wp theme install`, no PHP of ours in it. |
| Theme source | `theme.config.ts` (`defineTheme`: header + typed `theme.json`), `templates/<slug>.tsx`, `parts/<slug>.tsx`, `patterns/<name>.tsx`, `styles/<name>.ts`, `assets/`. File names are the template hierarchy. |
| Validation | Unknown core block, unknown or mistyped attribute, `style` prop on an HTML tag, unmappable tag, missing part or pattern reference, unknown preset slug, template name outside WP's hierarchy without a custom-template declaration, `theme.json` failing the 7.1 schema: all errors with locations. Never silently dropped. |
| Zero collections | Optional sugar in `@spacefast/zero-blocks/zero`: `collection("posts")` → the post type Zero registers (`zero_posts`) for query loops, and `bind.field("dek")` → an SCF block binding. Pure markup; no runtime dependency on Zero. |
| Not in scope | Capsule frontends, islands, the `zero/component` dynamic block, `_pages` system pages, any JS app runtime, HTML→TSX, live editing, Markdown. See §9. |
| Proof | `packages/blocks/tests/wp/run.sh`: a fresh WordPress from `tests/wp/harness.sh up --bare` (own compose project, port 8840), the built example theme installed from its zip and activated, front-end render, `theme.json` styles in the page, and every template and part opened in the real Site Editor with no invalid block, read from the editor's own store. |
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
| Content pages served by a Spacefast runtime, with a static lane and a WordPress lane | Content compiles to markup; themes compile to a theme. WordPress renders everything. | No capsule frontends, no second runtime. |
| Islands (`client/` components → hydrated mounts), `zero/component` block | Removed. `core/html` remains for static HTML only. | A JS app runtime is out of scope by ruling. |
| `_pages/*.tsx` system pages → HTML documents | Removed. | Spacefast platform pages; nothing in Zero corresponds. |
| `ZERO_DYNAMIC_BLOCKS` decided which serving lane a page needed | Removed. | Only mattered for the static lane. In a theme every template block is dynamic and that is fine. |
| Diagnostics per entry file | Diagnostics per JSX node: `templates/index.tsx:14:9`. | `jsxDEV` hands the runtime each element's source position; the mapper and serializer keep it. |
| `core/query` forbidden from `inherit: true` | `inherit` is the normal archive loop in a template; `<QueryLoop>` requires the author to choose `inherit` or an explicit query. | The serving lane that had no main query is gone. |
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
      index.ts            `@spacefast/zero-blocks/zero`: collection(), bind.*
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
| `@spacefast/zero-blocks/zero` | Zero app authors | `collection`, `bind` |
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
module that imports `node:*` fails to bundle (neutral platform), which is the
intended "no I/O at authoring time" boundary. A thrown error reports with the
author's file and line through the source map.

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
   type (`unknown_attribute`, with the nearest attribute name) and its JSON
   type must match the declared `type`/`enum` (`attribute_type`). Sourced
   attributes (`source: html|rich-text|attribute|query`) are set only by the
   mapper and the serializer; an author writing `content` on a paragraph gets
   a hint to use children. `createBlock` would otherwise drop the attribute
   silently, which is exactly the failure this package exists to prevent.
3. **Rich text.** Phrasing nodes render to an HTML string and land in the
   block's `content` attribute when the registered type has one with a
   rich-text or HTML source; a block with no body (a cover, a group) gets an
   implicit paragraph, as typing into one in the editor would.
4. `createBlock(name, attrs, innerBlocks)` then `serialize()` over the whole
   tree. `core/html` writes its `content` as `innerContent` verbatim (ported).

Output is the markup WordPress stores and the Site Editor opens. The parity
test is the editor's own check: `parse(markup)` under the same pinned package
reports `isValid: true` for every block, which is the assertion the unit
suite makes for each mapped construct. This stays the single serializer for
content, templates, parts and patterns.

### 3.5 CLI

`zero-blocks content <file.tsx> [--out <file.html>]` prints or writes the
markup. It is the lowest-level tool and what the theme compiler calls per
template. Feeding markup into a Zero collection is possible today without any
seam: the typed client writes it to a `richText` column, or the file goes into
a `sync` directory as `*.html` (phase 2 §5.2 stores HTML bodies verbatim, so
block delimiters survive). Deeper integration (a `*.tsx` sync format) would be
a Zero-core seam and is deferred.

## 4. Themes: a directory of TSX → a block theme

### 4.1 Source layout

```
my-theme/
  theme.config.ts        defineTheme(): header fields + theme.json settings/styles
  templates/
    index.tsx            required
    single.tsx  page.tsx  archive.tsx  404.tsx  search.tsx  front-page.tsx
    single-zero_posts.tsx
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

No `functions.php`, no PHP logic: a theme this package builds is data. Should
a theme ever need PHP, the author adds a plugin; this package will not grow a
PHP lane.

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
- `templateParts`, `customTemplates` and `patterns` in `theme.json` are
  **derived** from the files (§4.3–4.5) and merged with anything declared in
  `defineTheme`; a declaration that names a file that does not exist is an
  error.

### 4.3 Templates and the hierarchy

A template is `templates/<slug>.tsx` default-exporting a component; the file
name is the slug WordPress resolves. `hierarchy.ts` holds WordPress's own
list: the default block template types (`index`, `home`, `front-page`,
`singular`, `single`, `page`, `archive`, `author`, `category`, `taxonomy`,
`date`, `tag`, `attachment`, `search`, `privacy-policy`, `404`) and the
derived forms (`single-<post_type>`, `single-<post_type>-<slug>`,
`page-<slug>`, `page-<id>`, `archive-<post_type>`, `category-<slug>`,
`tag-<slug>`, `taxonomy-<taxonomy>`, `taxonomy-<taxonomy>-<term>`,
`author-<nicename>`). Any other name must export
`meta = defineTemplate({ title, postTypes? })`, which puts it in
`customTemplates`; otherwise `unknown_template` with both options as the hint.
`templates/index.tsx` is required (`index_template_missing`).

Template vocabulary (hand-written components over the generated set, all
checked by the serializer like any block):

| Component | Block | Notes |
|---|---|---|
| `<TemplatePart slug="header" />` | `core/template-part` | `slug` must be a file in `parts/` → else `unknown_template_part`. `tagName`, `area` from the part's declaration. |
| `<Pattern slug="zero-starter/hero" />` | `core/pattern` | slug must be a theme pattern or declared as external in `defineTheme({ patterns })`. |
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
`patterns/<name>.php` with WordPress's pattern header comment and the markup;
the slug defaults to `<theme-slug>/<name>`. A pattern component can also be
called inline in a template (`<Hero />`), which inlines its blocks; `<Pattern
slug>` references it by name instead and lets the user swap it in the editor.

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
for the same input (the unit suite builds the example theme twice and compares).

Diagnostics print as `templates/single.tsx:22:7 unknown_attribute: core/post-date
has no attribute "fmt". Did you mean "format"?` and exit 1; `--json` prints
them as `{ code, message, hint, file, line, column }` for tools.

## 5. Zero collections (optional sugar)

`@spacefast/zero-blocks/zero` knows two Zero conventions and nothing else:

- `collection("posts")` → `"zero_posts"`, the post type Zero's WordPress
  target registers for a post-backed collection, for `<QueryLoop
  postType={collection("posts")}>` and for naming templates
  (`single-zero_posts.tsx`). Given the app's generated `zero/client/schema.ts`
  (`collection(schema, "posts")`) the name is type-checked against the app's
  collections.
- `bind.field("dek")` → `{ source: "acf/field", args: { field: "zero_dek" } }`,
  the Secure Custom Fields block-binding source for the meta key Zero writes
  (`zero_<column>`), usable as `<Paragraph bindings={{ content: bind.field("dek") }}>`
  which lands in the block's `metadata.bindings`. SCF resolves it at render
  time; nothing of ours runs.

Both emit plain block markup. A theme built with them works on any site with
SCF and the Zero app plugin active, and the package has no import of Zero.

Limit to state plainly: Zero today registers its post types `public: false`,
`rewrite: false`, `has_archive: false`. A query loop over `zero_posts` renders
(WP_Query takes an explicit post type regardless), but `single-zero_posts`
templates have no front-end URL to resolve to until a collection can opt into
public permalinks. That is a Zero-core decision (a collection option, phase 3
of the core design), not this package's; the example theme loops over a Zero
collection and uses core `post`/`page` for single views.

## 6. Diagnostics (complete list)

| Code | Severity | Where |
|---|---|---|
| `style_prop_unsupported`, `unmappable_element` | error | mapper, node loc |
| `unknown_block`, `unknown_attribute`, `attribute_type`, `sourced_attribute` | error | serializer, node loc |
| `unverified_block` | info (`--verbose`) | serializer, first use |
| `module_failed` (bundle or execution error), `default_export_missing`, `not_content` (a component returned something that is not JSX, text or a number) | error | module, mapped through the source map |
| `index_template_missing`, `unknown_template`, `unknown_template_part`, `unknown_pattern`, `query_mode_required`, `unknown_preset`, `theme_json_invalid`, `declared_file_missing`, `duplicate_slug` | error | theme compiler |
| `unused_part` | warning | theme compiler |

## 7. The example theme: `packages/blocks/examples/starter`

A small, complete block theme: `theme.config.ts` with a palette, two font
sizes, spacing scale, a font face from `assets/`; `templates/` index, single,
page, archive, search, 404, front-page; `parts/` header (site title +
navigation), footer; `patterns/` hero and a call to action; `styles/dark.ts`.
The front page uses `<QueryLoop inherit>`; a `latest.tsx` custom template
loops over `collection("posts")` to show the Zero sugar. It lives inside the
package rather than in `examples/` because that directory is being reworked by
the integration PR; moving it is a one-line change later.

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
   the theme's files.
6. **Style:** the front page's global-styles stylesheet declares
   `--wp--preset--color--primary` with the palette value, and a block the
   template gave `backgroundColor={theme.tokens.color.primary}` renders with
   `has-primary-background-color`. `wp theme` reports the variation `Dark`
   through `GET /wp/v2/global-styles/themes/zero-starter/variations`.
7. **Validate in the Site Editor:** Playwright (Chromium) logs in as admin and,
   for every template and part the REST API lists for the theme
   (`/wp/v2/templates?wp_theme=…`, `/wp/v2/template-parts?…`), opens
   `site-editor.php?postType=<type>&postId=zero-starter//<slug>&canvas=edit`,
   waits for the editor to be ready, and reads
   `wp.data.select("core/block-editor").getBlocks()` flattened; asserts no
   block has `isValid === false`, none is `core/missing`, and the count of
   top-level blocks equals what `parse()` of the REST `content.raw` gives.
   This is the editor's own validation, in the editor, against the site's
   real theme.json and block registry. It is what "opens cleanly in the Site
   Editor" means and the only level that can prove it; the unit suite already
   proves the pinned parser agrees per construct, so the two are not
   redundant.
8. Teardown unless `ZERO_WP_KEEP=1`.

CI job `blocks-wp` runs it on `ubuntu-24.04` (Docker preinstalled) with
`npx playwright install --with-deps chromium`; job `blocks` runs
`pnpm install --frozen-lockfile`, `tsc --noEmit`, `node --test`, and both
codegen scripts in check mode. Neither job is added to the existing ones.

## 9. Out of scope, and non-goals

- Capsule frontends, islands, hydration, any browser JavaScript the package
  emits. Not "later": the WordPress Interactivity API would be the way to add
  behaviour to a block theme and would be a separate design.
- `_pages` system pages, Tailwind/`zero.css`, the Spacefast serving lane.
- HTML/blocks → TSX (decompilation), two-way editing, live collaboration.
- Markdown (Zero's sync owns it), classic themes, child themes (a `parent`
  header field is trivial and may land when asked), `functions.php` or any
  PHP, block registration, block style variations beyond `theme.json`,
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
| 1 | `p3/blocks-content` | `packages/blocks/` skeleton (package.json, pnpm lock, tsconfig, bin), JSX runtime with locations, nodes, mapper, diagnostics, module executor, serializer with name/attribute checks, `compileContent`, `zero-blocks content`; `.gitignore` lines; CI job `blocks` | unit: runtime, mapping table, serializer parity by reparse `isValid`, attribute refusals, located diagnostics through a real `.tsx`; one golden for the pricing page |
| 2 | `p3/blocks-codegen` | `scripts/codegen-blocks.ts`, `blocks.generated.ts`, `blocks-popular.ts`, `Block` namespace; `schemas/theme-7.1.json`, `codegen-theme-json.ts`, `theme-json.generated.d.ts` | codegen determinism and committed-mirror parity (drift guard); a generated component builds its node; a popular builds its tree |
| 3 | `p3/blocks-theme` | `defineTheme`/`defineTemplate`/`definePart`/`definePattern`/`defineStyleVariation`, `preset`, tokens, hierarchy, `buildTheme`, `theme.json` schema validation, template vocabulary, `zero-blocks build/check` | goldens of a fixture theme's output; every theme diagnostic by a fixture that triggers it; determinism; zip contents |
| 4 | `p3/blocks-example` | `examples/starter`, `tests/wp/run.sh` + tests, CI job `blocks-wp`; `zero` sugar (`collection`, `bind`) used by the example | §8 on real WordPress |
| 5 | `p3/blocks-docs` | `packages/blocks/README.md` (authoring guide), `docs/blocks.md` (how it fits Zero), a pointer section in the root README | docs render; links resolve |

Order is fixed; 2 could be folded into 1 if the first review prefers fewer PRs.

## 11. Judgment calls to review

1. **Core serializer under happy-dom, pinned to WP 7.1's packages.** Heavy
   (≈15 s to register the library, a React 18 peer) but the only way to
   promise `isValid` without transcribing every `save()`. A leaner
   hand-written serializer was rejected: it would be right for `core/post-*`
   (no save) and wrong for `core/group` the day core changes a class name.
2. **Attribute validation against the registry** is new and strict: a prop a
   block does not register is an error, not a warning. It can be relaxed per
   block with `<Block name="core/x" attrs>` (passthrough semantics) if a real
   case appears.
3. **Site Editor validation via Playwright** adds Chromium to one CI job. The
   REST-plus-pinned-parser alternative proves less than the ask requires
   ("opens cleanly in the Site Editor"), so Playwright stays, in the WP job
   only.
4. **Example inside the package**, not under `examples/`, to stay out of the
   integration PR's way. Move later.
5. **`@spacefast/zero-blocks`** as the npm name (free; mirrors how
   Spacefast scoped its earlier packages). The bare `zero-blocks` name is
   taken on npm.
6. **No Zero-core seam in this phase.** The one real gap (public permalinks
   for collections, §5) is reported upward rather than patched here.
