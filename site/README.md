# The First website

The site runs the First compiler in the visitor's browser: `src/wasm.rs` built for
`wasm32-unknown-unknown` is served as `first.wasm`, and `src/lib/compiler.ts` calls it with a
config's sources in memory. Its diagnostics are the envelope `first check --json` prints, so a
config that checks here checks on the command line, and vice versa; `tests/unit/compiler.test.ts`
holds the two to that over the examples and every refused fixture.

Static pages by [Astro](https://astro.build), no framework in the browser. Builds deploy to GitHub
Pages from `.github/workflows/site.yml` on pushes to `main`.

`/playground` starts with the kitchen-sink example: native WordPress pages and events, users,
custom tables, settings, custom fields, media, localization, hooks, actions, jobs and plugins.
The menu also includes Blog, Pantry, Reusable Fields and Plugin Dependencies. All five examples
compile during the site build, and edits recompile in the browser.

Inspect or download the complete generated `functions.php` and `schema.php`, SQL migrations,
TypeScript files and migration snapshot. The “Inside WordPress” buttons open the real shared
runtime files and select the relevant integration call. Runtime files and plugin templates have
their own groups and descriptions; they are read from the repository at build time. Invalid
configs show compiler diagnostics and clear generated output; runtime sources remain available.

`/tour` walks through `examples/pantry` and `examples/blog`: `src/tour/stops.ts` names lines of each
config and lines of what the compiler emits for them, by anchors; `src/lib/examples.ts` compiles the
examples with the browser build at site build time, and a stop whose anchors no longer match fails
the build (`tests/unit/tour.test.ts` checks every stop). `/docs` renders `../docs/*.md` and the
README as committed, with repository links rewritten to pages here or to GitHub
(`src/lib/links.ts`). Design records (`docs/design-*.md`) and research notes are not pages.

```sh
cd site
pnpm install
rustup target add wasm32-unknown-unknown  # once
pnpm dev          # or: pnpm build && node scripts/serve-dist.mjs
pnpm check        # typecheck, parity tests (need a native `first` under ../target), browser test
```

The parity tests compare against the native compiler at `../target/release/first` or
`../target/debug/first`.

`pnpm dev` and `pnpm build` build `public/first.wasm` before starting Astro. Cargo reuses unchanged
builds. Run `pnpm build:wasm` to refresh the compiler after editing Rust sources while dev is running.
