# `typedpress` (SpacePress CLI)

The official npm launcher for the **SpacePress** (`spacepress.dev`) compiler and local WordPress development environment — no Rust toolchain or Docker required.

> **Pre-release naming note:** SpacePress's CLI package and binary currently ship under the pre-release name `typedpress`.

## Requirements

- **Node.js 22+** (`engines.node >= 22`)

## Installation

Install as a dev dependency in your SpacePress project (or scaffold a new project with `npm create typedpress@0.3.0 my-app`):

```bash
npm install -D typedpress
```

During `postinstall`, the package downloads the prebuilt native Rust binary for your OS and CPU architecture. To point the launcher at a locally compiled binary instead, set `TP_BIN=/absolute/path/to/typedpress`.

## Common Commands

```bash
# Start local WordPress + SQLite dev server with watch rebuilds
npx typedpress dev

# Validate TypeScript schemas, hooks, actions, pages, and locks
npx typedpress check

# Compile WordPress plugins to tp/dist/wp-content/plugins/
npx typedpress build

# Export a static site when output: "static" is configured
npx typedpress export

# Two-way sync between content/ Markdown/JSON and WordPress
npx typedpress sync

# Add optional starter modules (shop, db, api-reference)
npx typedpress add shop

# Generate AGENTS.md, .mcp.json, and agent skills
npx typedpress init

# Serve the project MCP server on stdio
npx typedpress mcp

# Package typedpress.zip or push directly to a remote WordPress site
npx typedpress plugin
npx typedpress login https://example.com
npx typedpress push

# Run any WP-CLI command against local dev or a remote --site target
npx typedpress wp plugin list
```

Run `npx typedpress --help` or `npx typedpress help <command>` for complete options.

## Documentation & License

- Documentation: [spacepress.dev/docs](https://spacepress.dev/docs) · [Interactive Guide](https://spacepress.dev/guide)
- License: MIT (the downloaded compiler archive also embeds the GPL-2.0-or-later WordPress PHP runtime plugins; see [`LICENSING.md`](../../LICENSING.md)).
