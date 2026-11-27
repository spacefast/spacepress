---
uid: zr_7920cac7a56f3e471e53
title: Installation & Setup
description: Requirements, creating a new app, and starting the local WordPress development environment.
order: 1
status: published
publishedAt: 2026-11-21T09:01:00.000Z
---
## Requirements

- **Node.js 22 or newer** and npm.
- No Docker and no Rust toolchain. The `spacepress` npm package downloads a prebuilt compiler binary when it installs.

## Create and run an app

<Steps>
<Step title="Scaffold the project">
```bash
npm create spacepress@0.3.0 my-app
cd my-app
```

Add `-- --dir cms` to put the app's sources in `cms/` instead of `sp/`, or `-- --no-install` to skip `npm install`.
</Step>

<Step title="Start local WordPress">
```bash
npm run dev
```

`spacepress dev` compiles the project, starts a local WordPress site on SQLite, activates the compiled plugins, and rebuilds when a file changes.
</Step>

<Step title="Open the site">
Open the site URL it prints to see your TSX pages. `/wp-admin/new/` is SpacePress Admin; `/wp-admin/` is classic wp-admin.
</Step>

<Step title="Stop it">
`npm run stop` (`spacepress dev stop`) stops the site and keeps its data. `npm run status` reports it.
</Step>
</Steps>

## What the starter contains

<FileTree>
<File name="spacepress.config.ts" />

<Folder name="sp">
<File name="actions.ts" />

<Folder name="app">
<File name="layout.tsx" />

<File name="page.tsx" highlight />

<File name="site.css" />

<File name="not-found.tsx" />

<Folder name="notes">
<File name="page.tsx" />

<Folder name="[slug]">
<File name="page.tsx" />
</Folder>
</Folder>

<Folder name="account">
<File name="page.tsx" />
</Folder>
</Folder>
</Folder>

<Folder name="content">
<Folder name="notes">
<File name="first-walk.md" />

<File name="what-to-pack.md" />
</Folder>
</Folder>

<File name="AGENTS.md" />

<File name=".mcp.json" />
</FileTree>

- `spacepress.config.ts` defines a synced `notes` collection and a `site` global.
- `sp/actions.ts` exports the `greet` mutation; the home page posts a `<form action={greet}>` to it, which works without JavaScript.
- `sp/app/notes/[slug]/page.tsx` renders one note. `sp/app/account/page.tsx` is guarded: only signed-in visitors see it.
- `content/notes/` holds sample Markdown that `spacepress sync` keeps in step with WordPress.
- `AGENTS.md`, `.mcp.json` and the agent skills come from `spacepress init`; see [MCP & AI Agents](/docs/operations/mcp-and-agents).

## Add modules

`spacepress add` copies a module into the project as files you own. It never overwrites a file.

```bash
npx spacepress add shop           # WooCommerce products, native checkout, cart and storefront pages
npx spacepress add db             # SQL tables beside your WordPress content
npx spacepress add api-reference  # pages at /api that document the HTTP API from its OpenAPI document
```
