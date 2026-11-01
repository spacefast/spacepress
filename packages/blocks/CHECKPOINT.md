# Phase 2 checkpoint (paused)

Branch `p3/blocks-theme`, paused while the page/template design is re-opened.
No PR is open. The package builds, `pnpm check` passes (210 tests), both
codegen scripts are in parity, and the fixture theme installs, renders and
opens valid in the Site Editor on WordPress 7.1.4.

## Open review findings (Sol pass 2, not yet fixed)

Blocking:

1. `viewportWidth` is written into the pattern header without the
   header-value check; a JavaScript author can pass a string that closes the
   comment. Check every rendered header value, not the typed ones.
2. A variation that replaces the palette is checked only against its own
   `styles`; the theme's inherited `styles` can reference a slug the
   variation removed. Check the merged styles against the variation's
   effective presets.

Should:

- `spacingScaleSlugs()` is wrong for `operator: "+"` when steps fall to zero
  below the midpoint, and ignores a `spacingScale` with only `steps`
  (WordPress fills the other fields). Port `compute_spacing_sizes` fully.
- Two concurrent `writeTheme` calls on one destination can leave directory
  B beside zip A; serialize per destination.
- `tags` are not header-checked; a newline in a tag forges a header.
- A pattern slug of `"0"` passes but WordPress treats it as missing.
- A header longer than 8 KiB pushes `Slug` past `get_file_data`'s read.
- `kind in table.root` accepts inherited keys (`constructor`); use `hasOwn`.

## Where things are

- Compiler: `src/compiler/theme.ts`, `presets.ts`, `pattern-file.ts`,
  `theme-json.ts`, `zip.ts`; vocabulary: `src/theme/*`; generated:
  `src/blocks.generated.ts`, `src/theme/theme-json.generated.d.ts`.
- Tests: `tests/unit/theme.test.ts` (fixture under `tests/unit/fixtures/theme`,
  variants via `theme-fixtures.ts`), `types.test.ts`, `zip.test.ts`, CLI tests.
- Proof recipe and WordPress facts: `~/.claude/.../memory/zero-blocks-project.md`
  in the operator's notes; the stack is `ZERO_WP_PROJECT=zero-blocks`,
  port 8840.
