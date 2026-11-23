# `create-spacepress`

Scaffold a ready-to-run **SpacePress** (`spacepress.dev`) project with TypeScript schemas, sample Markdown content, server-rendered TSX pages, a progressive form action, and coding-agent setup — running on local WordPress with zero Docker or Rust setup.

## Requirements

- **Node.js 22+** and npm

## Usage

```bash
npm create spacepress@0.3.0 my-app
cd my-app
npm run dev
```

Pass `-- --no-install` to create the directory without running `npm install`:

```bash
npm create spacepress@0.3.0 my-app -- --no-install
```

Existing destination directories are never overwritten.

## What Gets Created

- `spacepress.config.ts` — defines a synced `notes` WordPress collection (`/notes/:slug`) and a `site` global
- `sp/actions.ts` — a sample server action (`greet`) compiled to PHP
- `sp/app/` — root `layout.tsx`, `page.tsx` with `<form action={greet}>` and `useFormState()`, dynamic `notes/[slug]/page.tsx`, `account/`, `not-found.tsx`, and `site.css`
- `content/notes/` — sample Markdown notes synced into WordPress
- `AGENTS.md`, `.mcp.json`, and skills — generated automatically by `spacepress init` for AI coding agents
- `package.json` scripts: `dev`, `build`, `check`, `typecheck`, `stop`, `status`, and `wp`

## License

MIT
