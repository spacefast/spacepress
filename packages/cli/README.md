# `spacepress` (SpacePress CLI)

The official npm launcher for the **SpacePress** (`spacepress.dev`) compiler and local WordPress development environment — no Rust toolchain or Docker required.

## Requirements

- **Node.js 22+** (`engines.node >= 22`)

## Installation

Install as a dev dependency in your SpacePress project (or scaffold a new project with `npm create spacepress@0.3.0 my-app`):

```bash
npm install -D spacepress
```

During `postinstall`, the package downloads the prebuilt native Rust binary for your OS and CPU architecture. To point the launcher at a locally compiled binary instead, set `SP_BIN=/absolute/path/to/spacepress`.

## Common Commands

```bash
# Start local WordPress + SQLite dev server with watch rebuilds
npx spacepress dev

# Validate TypeScript schemas, hooks, actions, pages, and locks
npx spacepress check

# Compile WordPress plugins to sp/dist/wp-content/plugins/
npx spacepress build

# Export a static site when output: "static" is configured
npx spacepress export

# Two-way sync between content/ Markdown/JSON and WordPress
npx spacepress sync

# Add optional starter modules (shop, db, api-reference)
npx spacepress add shop

# Generate AGENTS.md, .mcp.json, and agent skills
npx spacepress init

# Serve the project MCP server on stdio
npx spacepress mcp

# Package spacepress.zip or push directly to a remote WordPress site
npx spacepress plugin
npx spacepress login https://example.com
npx spacepress push

# Run any WP-CLI command against local dev or a remote --site target
npx spacepress wp plugin list
```

Run `npx spacepress --help` or `npx spacepress help <command>` for complete options.

## Documentation & License

- Documentation: [spacepress.dev/docs](https://spacepress.dev/docs) · [Interactive Guide](https://spacepress.dev/guide)
- License: MIT (the downloaded compiler archive also embeds the GPL-2.0-or-later WordPress PHP runtime plugins; see [`LICENSING.md`](../../LICENSING.md)).
