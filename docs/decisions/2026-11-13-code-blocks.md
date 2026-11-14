# Code blocks are highlighted where they are stored, in PHP

Date: 2026-11-13. Status: accepted. Spec: [spec.md](../spec/spec.md) §1 (`content/` synced into
kinds), [rendering.md](../spec/rendering.md) §4 (no client JavaScript a page doesn't need).

## Problem

A docs page shows code: highlighted in light and dark themes, with a title, highlighted lines,
and a group of files shown as tabs, with no JavaScript needed to read it. The content is a kind an
editor changes in the block editor, so a code block changes on the site as often as in a file.
Highlighting only "at build time" would leave every block an editor writes plain.

## Decision

**A code block is core's `core/code` block; its colours are added when the page renders, in PHP.**

- The source is what WordPress stores: `core/code`, its language as the `language-<x>` class the
  editor writes, plus three attributes First adds to core's block: `title`, `highlight` (line
  ranges) and `group` (blocks with one group name sit together as tabs).
- In Markdown, the fence carries them, as other docs tools spell it:
  ```` ```ts title="first.config.ts" {2,4-5} ````. `first sync` writes them back the same way.
- At render, `render_block_core/code` replaces the block's code with highlighted HTML: a
  `<span>` per token, coloured by class. One stylesheet holds a light and a dark theme (Atom One
  Light and Atom One Dark, from highlight.php's bundled styles), switched by
  `prefers-color-scheme`. Highlighted lines get a class; a titled block a caption.
- Consecutive blocks with one `group` render as one figure with a tab per block, switched by
  radio inputs and CSS, so they need no JavaScript.
- The highlighter is `scrivo/highlight.php` (BSD-3-Clause), vendored like the runtime's other PHP
  dependencies. It ships 185 languages and highlight.js's themes; the themes used here are MIT. Rendered output is cached by
  Batcache and the edge with the page, so a block is highlighted once per cache miss.

## Alternatives not taken

- **Highlight in the Rust build** (`syntect`): the build never sees a block an editor writes in
  wp-admin, and the site has no Rust at request time. It would colour files and leave the site's
  own edits plain.
- **Store highlighted HTML in the block**: the editor would show and save markup instead of code,
  and `first sync` would write it into Markdown files.
- **Highlight in the browser** (Prism, Shiki): every page loads JavaScript to show text.

## Cost

- highlight.php's JavaScript grammar handles JSX better than its TypeScript grammar, so `tsx`
  and `jsx` blocks use its JavaScript grammar.
- The runtime grows by about 1.6 MB of PHP (grammars and styles) in the vendored tree.
