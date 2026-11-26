# `@spacepress/blocks`

Author valid Gutenberg block content and complete WordPress block themes in **TSX** for **SpacePress** (`spacepress.dev`).

Components, imports, loops, and conditionals execute once at build time and serialize into standard Gutenberg block markup that opens cleanly without validation errors in the WordPress Block Editor and Site Editor.

## Requirements

- **Node.js 22+**

## Installation

```bash
npm install @spacepress/blocks
```

Configure TSX to use `@spacepress/blocks` in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@spacepress/blocks"
  }
}
```

## Authoring Blocks in TSX

Standard HTML elements map directly to WordPress core blocks (for example `<p>` → `core/paragraph`, `<h2>` → `core/heading`, `<ul>` → `core/list`). Use `blockComponent()` for typed block wrappers or `<Block />` as an escape hatch for any registered or third-party block:

```tsx
import { Block, blockComponent } from "@spacepress/blocks";

const Group = blockComponent<{ layout?: { type: string } }>("core/group");

export default function HeroSection() {
  return (
    <Group layout={{ type: "constrained" }}>
      <h2>Built with SpacePress</h2>
      <p>Standard HTML compiles cleanly to native Gutenberg blocks.</p>
      <Block name="core/separator" attrs={{ opacity: "css" }} />
    </Group>
  );
}
```

## CLI & Exports

- CLI binary: `spacepress-blocks` (`./bin/spacepress-blocks.mjs`)
- Main entry: `@spacepress/blocks` (`Block`, `blockComponent`, `Fragment`, `createElement`, AST & diagnostic types)
- Compiler entry: `@spacepress/blocks/compiler`
- JSX runtimes: `@spacepress/blocks/jsx-runtime`, `@spacepress/blocks/jsx-dev-runtime`

## Licensing

`MIT AND GPL-2.0-or-later`. The package's own TypeScript/JS code (`bin/`, `dist/`) is MIT. The bundled WordPress block packages (`vendor/wp.cjs`) are distributed under GPL-2.0-or-later with upstream notices in `vendor/NOTICE.md`.
