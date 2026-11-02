# The Zero website

The site runs the Zero compiler in the visitor's browser: `src/wasm.rs` built for
`wasm32-unknown-unknown` is served as `zero.wasm`, and `src/lib/compiler.ts` calls it with a
config's sources in memory. Its diagnostics are the envelope `zero check --json` prints, so a
config that checks here checks on the command line, and vice versa; `tests/unit/compiler.test.ts`
holds the two to that over the examples and every refused fixture.

Static pages by [Astro](https://astro.build), no framework in the browser. Builds deploy to GitHub
Pages from `.github/workflows/site.yml` on pushes to `main`.

`/tour` walks through `examples/pantry` and `examples/blog`: `src/tour/stops.ts` names lines of each
config and lines of what the compiler emits for them, by anchors; `src/lib/examples.ts` compiles the
examples with the browser build at site build time, and a stop whose anchors no longer match fails
the build (`tests/unit/tour.test.ts` checks every stop). `/docs` renders `../docs/*.md` and the
README as committed, with repository links rewritten to pages here or to GitHub
(`src/lib/links.ts`). Design records (`docs/design-*.md`) and research notes are not pages.

```sh
cd site
pnpm install
pnpm build:wasm   # cargo build --lib --no-default-features --profile wasm --target wasm32-unknown-unknown
pnpm dev          # or: pnpm build && node scripts/serve-dist.mjs
pnpm check        # typecheck, parity tests (need a native `zero` under ../target), browser test
```

`rustup target add wasm32-unknown-unknown` once. The parity tests compare against the native
compiler at `../target/release/zero` or `../target/debug/zero`.
