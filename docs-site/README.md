# The First docs site

A [Blume](https://github.com/haydenbleasel/blume) project. It holds the guides, a page for every example, the in-browser compiler playground, the tour, and a reference generated from the code.

```sh
cd docs-site
pnpm install
rustup target add wasm32-unknown-unknown  # once
pnpm dev       # the compiler for the browser, the generated pages, then the dev server
pnpm build     # the same, to dist/
pnpm check     # generated pages current, unit tests, links, browser tests, Playground boots
```

`pnpm test:playground` boots every example's blueprint in WordPress Playground (`@wp-playground/cli`) and checks that First's plugins are active, that each collection answers on the REST API and has its wp-admin list and editor, that the example's landing page opens, and that its sample data shows what the app does with it (for full-site, the TSX pages a signed-out visitor reads). It needs network access for WordPress and the WordPress.org plugins. It also edits a config the way a visitor would, builds the blueprint the playground page's "Run in WordPress" builds for it (lib/blueprint.ts), boots it and reads the new field back.

The examples the site features are listed in `lib/site-examples.ts`. Each one says how the site shows it in its own directory: `playground.json` (title, summary, the page Playground opens) and, if it has sample data, `playground-seed.php`. `pnpm showcase` also puts the rows of a synced collection's content files into its blueprint.

## Parity suite

`tests/parity/` holds what the site served when it was built with Blume, before it moved to First, and a browser suite that any build must pass. `inventory.json` lists every URL: each page's title, heading, description, social tags, head links for agents, section tab, sidebar (labels, groups and order), table of contents, tour stops, previous and next, edit link and Markdown twin; every redirect, Markdown file, `.mdx` source and static file; the `_headers` rules; and the sitemap and `llms.txt` entries. `inventory.mjs` wrote it from that build. It reads Blume's markup, so it runs only on a Blume build: when a page's content changes on `main` before the move, run it on a fresh build of `main` and commit the new record. `parity.spec.ts` reads each URL as a reader or an agent would, by role, label and text. It also checks the header, footer, theme toggle, search, the narrow-screen menu, copy buttons, highlighting in both themes, callouts, cards, the components in `lib/`, the REST reference, the playground, the tour, the example pages and their Playground blueprints.

```sh
pnpm test:parity                                    # the build in dist/
PARITY_DIST=/path/to/dist pnpm test:parity          # another build
PARITY_BASE_URL=https://<site>/ pnpm test:parity    # a deployed site
PARITY_HEADERS=1 pnpm test:parity                   # also the _headers rules, on a host that applies them
```

## Where each page comes from

| Path | Source |
| --- | --- |
| `docs/index.mdx`, `docs/getting-started.mdx`, `docs/publishing/` | Written by hand |
| `docs/agents.mdx` | `docs/agents.md` |
| `docs/examples/` | `examples/*`: each README and config, compiled when the pages are generated |
| `docs/reference/config.mdx` | `types/first/index.d.ts` |
| `docs/reference/client.mdx` | `runtime/client/index.ts` |
| `docs/reference/cli.mdx` | `runtime/First/Cli/commands.json` |
| `docs/reference/diagnostics.mdx` | `src/diag.rs` and `tests/compatibility/registry.json` |
| `docs/reference/wordpress-plugins.mdx` | `src/wp_plugins/supported.json`, `src/platform.rs` and `tests/fixtures/platform.json` |
| `openapi/first.json`, rendered at `/rest` | `examples/blog`: the OpenAPI document `first build` writes for it (`src/openapi.rs`) |
| `docs/changelog/` | `packages/*/CHANGELOG.md` |
| `pages/playground.astro`, `pages/tour/` | The examples, compiled by `public/compiler.wasm` |

`scripts/generate.ts` writes every generated file. Each one starts with a comment that names its source. `pnpm generate:check` fails when a committed file differs from what the script writes, and CI runs it on every pull request.

`public/compiler.wasm` is `src/wasm.rs` built for `wasm32-unknown-unknown` by `scripts/build-wasm.mjs`. The playground compiles in the browser with it. `tests/unit/compiler.test.ts` checks that it reports the same diagnostics as the native `first check --json` for every example and every refused fixture.

## Names

The pages use First names. Until the code on `main` is renamed too, `lib/names.ts` maps the old names in text the generator copies out of the code, and `tests/unit/names.test.ts` checks that Zero 0.8 names stay as they are. Once `main` uses First names, no rule matches and the file can go.

## Publish

The site is a Spacefast Space at <https://first-docs.space.fast/>. CI builds and tests it on every pull request and push (`.github/workflows/docs-site.yml`) but deploys it nowhere.

To publish the Space by hand:

```sh
cd docs-site
pnpm build                                    # ends with scripts/prepare-spacefast.mjs
sf publish dist --space first-docs.space.fast --spa false
```

`scripts/prepare-spacefast.mjs` changes two things in `dist/` for Spacefast. It drops the `_headers` rules Spacefast refuses and serves `compiler.wasm` as `application/wasm`. It also marks each `.md` copy `raw: true`, so Spacefast serves the Markdown as written instead of rendering it into a page.
