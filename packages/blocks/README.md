# @spacefast/zero-blocks

Write Gutenberg content in TSX and compile it to block markup that opens valid
in the WordPress editor. An optional add-on for WordPress sites, including
sites built with Zero; nothing in Zero depends on it.

**Status: phase 1.** This release compiles single TSX files to block markup.
Typed `Block.Core.*` components, block themes (`theme.json`, templates, parts,
patterns) and the WordPress proof suite follow in later releases; the design
is in the Zero repository under `docs/design-blocks.md`.

Requires Node 22. Output targets WordPress 7.1: the serializer runs the block
library WordPress 7.1 bundles, so the markup is what that editor's own `save()`
produces.

## Use

```sh
pnpm add -D @spacefast/zero-blocks
```

```tsx
// pricing.tsx
import { Block } from "@spacefast/zero-blocks";
import { plans } from "./plans";

export default function Pricing() {
  return (
    <>
      <h1 id="pricing">Plans</h1>
      <p class="lead">Simple, <strong>honest</strong> pricing.</p>
      {plans.map((plan) => (
        <section class="card" key={plan.id}>
          <h3>{plan.name}</h3>
          <p>{plan.price} / month</p>
        </section>
      ))}
      <Block name="acme/testimonials" attrs={{ count: 3 }} />
    </>
  );
}
```

```sh
zero-blocks content pricing.tsx --out pricing.html
```

`tsconfig.json` for the authored files:

```json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@spacefast/zero-blocks" } }
```

The file's default export runs once, at build time. Imports, loops and
components are ordinary code. What ships is serialized block markup.

## What HTML becomes

| HTML | Block |
|---|---|
| `p`, loose text | `core/paragraph` |
| `h1`–`h6` | `core/heading` |
| `ul`, `ol` → `li` | `core/list` → `core/list-item` |
| `blockquote` | `core/quote` |
| `pre` (`> code`) | `core/code` |
| `img`; `figure > img (+ figcaption)` | `core/image` |
| `table` | `core/table` (cells as attributes) |
| `hr` | `core/separator` |
| `details (> summary)` | `core/details` |
| `section article aside header footer main nav` | `core/group` with `tagName` |
| `div` with `class` or `id` | `core/group`; a bare `div` dissolves |
| `a strong em code span …` | rich text inside the enclosing block |

`class`/`className` → `className`; `id` → `anchor`. Nothing is inferred
beyond this table: a flex-looking `div` is a group with those classes, never
columns.

Three ways to name a block: an HTML tag, `blockComponent("core/cover")` for a
typed component, and `<Block name="vendor/thing">` for anything else. A
third-party block is written as authored and cannot be checked; `--verbose`
says so once.

## Errors

Every error names the author's file, line and column, and nothing is written:

```
pricing.tsx:12:7 unknown_attribute: core/heading has no attribute "levl". Did you mean "level"?
```

| Code | Meaning |
|---|---|
| `style_prop_unsupported` | a `style` prop on an HTML tag; use a class or a block's `style` attribute |
| `unmappable_element` | a tag with no block; use a mapped tag or `<Block name>` |
| `unknown_block` | a `core/*` name WordPress 7.1 does not register |
| `unknown_attribute`, `attribute_type` | an attribute the block does not register, or the wrong type |
| `local_attribute` | an editor-session attribute (`role: "local"`) WordPress never saves |
| `content_and_children` | both a `content` attribute and children on one block |
| `save_failed` | the block's own `save()` threw |
| `module_failed`, `default_export_missing`, `not_content` | the file could not be bundled or run, has no default export, or rendered a value that is not content |

`--json` prints the same diagnostics as JSON for tools.

## How it works

The file is bundled with esbuild using the development JSX transform, so
every element carries its source position, and executed once in the build's
Node process (trusted code, like a build config; a static `node:*` import is
a bundle error, but this is not a sandbox). HTML maps to blocks by the table
above. Each block is checked against the registered block type, then built
with `createBlock()` and written with `serialize()` from `@wordpress/blocks`,
with `@wordpress/block-library` registered under happy-dom, all pinned to the
versions WordPress 7.1 ships. The `@wordpress/*` graph is prebundled on
install (`scripts/bundle-wp.mjs`) so one copy of each package exists.

## Develop

```sh
pnpm install          # also prebundles the pinned @wordpress packages into vendor/
pnpm check            # typecheck + unit tests
pnpm build            # dist/ for the published package and the zero-blocks bin
```

## License

The package's own source is MIT. The prebundled `vendor/wp.cjs` is built from
the pinned `@wordpress/*` packages (GPL-2.0-or-later) and React (MIT); their
license headers are kept in `vendor/wp.cjs.LEGAL.txt` beside it.
