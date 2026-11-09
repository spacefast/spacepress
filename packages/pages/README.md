# @spacefast/zero-pages

Optional TSX pages, layouts and routes for a Zero app, rendered by WordPress.
Pages compile once to Gutenberg block markup with Zero Blocks' serializer;
WordPress fills them per request with the visitor's own, access-checked data.
An app without `pages/` is unaffected, and Zero core never depends on this.

```sh
zero build site            # the backend and its compiled schema
zero-pages build site      # site/zero/dist/wp-content/plugins/zero-pages-<app>/
```

The authoring guide, the supported subset and its limits are in
[docs/pages.md](../../docs/pages.md); `examples/full-site` is a complete site.

## Develop

```sh
cd ../blocks
pnpm install --frozen-lockfile
pnpm build
cd ../pages
pnpm install
pnpm check                              # typecheck + unit tests (no WordPress)
pnpm test:package                       # pack, npm install, run the installed CLI
ZERO_BIN=../../target/debug/zero pnpm test:wp   # native WordPress Studio + Chromium acceptance
```

`pnpm build` emits JavaScript and declarations in `dist/`; `pnpm pack` builds
them automatically. The package requires `@spacefast/zero-blocks@0.1.0` as
a peer. Local development links the adjacent Blocks checkout; packed
consumers use the normal package dependency. No package has been published
as part of this change.

`test:wp` creates one disposable Studio site and temp directory and removes
both. It needs `npx` (for wp-studio 2.1.1) and a cached Chromium headless shell
(`ZERO_PAGES_CHROMIUM` to point at one explicitly).

## License

The TypeScript build tool (`src/`, `bin/`) is MIT. The PHP runtime (`runtime/pages/` in the
Zero repository, packed as `wp/`)
runs inside WordPress, is copied into the generated plugin, and is
GPL-2.0-or-later, like Zero's own runtime.
