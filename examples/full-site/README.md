# Field Notes

A complete Zero site with TSX routes and layouts, Gutenberg rich text,
viewer-bound listings and detail pages, CSS modules, metadata and a
WordPress Interactivity API action. Native WordPress remains the content
editor. The Pages package is optional and does not change backend-only apps.

From a repository checkout with Node 22.18+, Corepack and the Zero binary:

```sh
cd packages/blocks
pnpm install --frozen-lockfile
pnpm build
cd ../pages
pnpm install --frozen-lockfile
pnpm build
cd ../..
zero dev examples/full-site --port 8872 --no-watch
node packages/pages/bin/zero-pages.mjs build examples/full-site
cp -R examples/full-site/.zero/wp-content/plugins/zero-pages-fullsite \
  examples/full-site/.zero/dev/wordpress/wp-content/plugins/
zero dev wp examples/full-site -- plugin activate zero-pages-fullsite
```

Open the URL printed by `zero dev`, then `/wp-admin/` to create published
Notes. The listing at `/notes/` and the corresponding `/notes/<slug>/` page
read the saved content on every request. The Cheer button calls the compiled
Zero action and persists its count. Drafts and desk notes are visible only
to the roles allowed by the config.

After editing TSX or CSS, build Pages again and replace the installed
`zero-pages-fullsite` directory with that output. After changing the backend
config, rebuild the backend first, then Pages. The example does not watch
frontend sources or automatically install the optional plugin.

Stop WordPress with `zero dev stop examples/full-site`. Content persists in
the example's ignored `.zero/dev/` directory.

For a disposable end-to-end run that seeds content, edits it through native
REST, exercises the browser action and removes its site:

```sh
cd packages/pages
pnpm exec playwright-core install --with-deps chromium-headless-shell
ZERO_BIN=/absolute/path/to/zero pnpm test:wp
```

The [Pages guide](../../docs/pages.md) documents the supported TSX subset and
the features that remain unimplemented.
