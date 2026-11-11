# The First docs site

A [Blume](https://github.com/haydenbleasel/blume) project. It holds the guides, a page for every example, the in-browser compiler playground, the tour, and a reference generated from the code.

```sh
cd docs-site
pnpm install
rustup target add wasm32-unknown-unknown  # once
pnpm dev       # the compiler for the browser, the generated pages, then the dev server
pnpm build     # the same, to dist/
pnpm check     # generated pages current, unit tests, links, browser tests
```

## Where each page comes from

| Path | Source |
| --- | --- |
| `docs/index.mdx`, `docs/getting-started.mdx`, `docs/hosting/` | Written by hand |
| `docs/examples/` | `examples/*`: each README and config, compiled when the pages are generated |
| `docs/reference/config.mdx` | `types/first/index.d.ts` |
| `docs/reference/client.mdx` | `runtime/client/index.ts` |
| `docs/reference/cli.mdx` | `runtime/First/Cli/commands.json` |
| `docs/reference/diagnostics.mdx` | `src/diag.rs` and `tests/compatibility/registry.json` |
| `docs/reference/wordpress-plugins.mdx` | `src/wp_plugins/supported.json`, `src/platform.rs` and `tests/fixtures/platform.json` |
| `openapi/first.json`, rendered at `/rest` | The route dispatchers in `runtime/First` |
| `docs/changelog/` | `packages/*/CHANGELOG.md` |
| `pages/playground.astro`, `pages/tour/` | The examples, compiled by `public/compiler.wasm` |

`scripts/generate.ts` writes every generated file. Each one starts with a comment that names its source. `pnpm generate:check` fails when a committed file differs from what the script writes, and CI runs it on every pull request.

`public/compiler.wasm` is `src/wasm.rs` built for `wasm32-unknown-unknown` by `scripts/build-wasm.mjs`. The playground compiles in the browser with it. `tests/unit/compiler.test.ts` checks that it reports the same diagnostics as the native `first check --json` for every example and every refused fixture.

## Names

The pages use First names. Until the code on `main` is renamed too, `lib/names.ts` maps the old names in text the generator copies out of the code, and `tests/unit/names.test.ts` checks that Zero 0.8 names stay as they are. Once `main` uses First names, no rule matches and the file can go.

## Publish

The site is a Spacefast Space at <https://first-docs.space.fast/>.

```sh
cd docs-site
pnpm build                                    # ends with scripts/prepare-spacefast.mjs
sf publish dist --space first-docs.space.fast --spa false
```

`scripts/prepare-spacefast.mjs` changes two things in `dist/` for Spacefast. It drops the `_headers` rules Spacefast refuses and serves `compiler.wasm` as `application/wasm`. It also marks each `.md` copy `raw: true`, so Spacefast serves the Markdown as written instead of rendering it into a page.
