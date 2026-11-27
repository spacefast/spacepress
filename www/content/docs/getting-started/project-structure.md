---
uid: zr_e76e7a887030c99a122b
title: Project Structure
description: Layout of a SpacePress repository, authored files vs generated artifacts.
order: 2
status: published
publishedAt: 2026-11-21T09:02:00.000Z
---
## Directory layout

<FileTree>
<File name="spacepress.config.ts" highlight />

<File name="tsconfig.json" />

<Folder name="sp">
<File name="schema.ts" />

<File name="server.ts" />

<Folder name="app">
<File name="layout.tsx" />

<File name="page.tsx" />
</Folder>

<Folder name="components" defaultOpen={false}>
</Folder>

<Folder name="wp-hooks" defaultOpen={false}>
</Folder>

<Folder name="_generated" defaultOpen={false}>
<File name="api.js" />

<File name="api.d.ts" />

<File name="db.d.ts" />

<File name="routes.d.ts" />

<File name="openapi.json" />

<Folder name="client">
</Folder>

<Folder name="types">
</Folder>

<Folder name="migrations">
</Folder>
</Folder>

<Folder name="dist" defaultOpen={false}>
</Folder>
</Folder>

<Folder name="content" defaultOpen={false}>
</Folder>

<Folder name="emails" defaultOpen={false}>
</Folder>

<Folder name="public" defaultOpen={false}>
</Folder>
</FileTree>

| Path | What it holds |
|---|---|
| `spacepress.config.ts` | `export default defineConfig({ name, dir?, ... })`. It can also define kinds itself. |
| `sp/*.ts` | App modules. Every `.ts` file under `sp/` outside the reserved folders loads, whatever its name: `schema.ts` for kinds, `server.ts` for queries, mutations and jobs is a convention, not a rule. |
| `sp/app/` | File-based TSX pages and layouts, and `route.ts` handlers. |
| `sp/components/` | Server components, `"use client"` islands, and block components for Markdown. |
| `sp/wp-hooks/` | Typed WordPress action and filter handlers. |
| `sp/_generated/` | What the compiler writes and you commit: `api`, `db.d.ts`, `routes.d.ts`, per-route `types/`, the typed `client/`, `openapi.json`, migrations, and locks. |
| `sp/dist/wp-content/` | The compiled WordPress plugins. Build output; git ignores it. |
| `content/` | Markdown and JSON content synced with WordPress. |
| `emails/` | React Email (`.tsx`) templates. |
| `public/` | Static files served from the site root. |

## Customizing the app directory (`dir`)

SpacePress defaults to `sp/` so it can sit beside an existing `index.html`, Next.js or Astro app at the repository root. Set `dir` to move the app's sources, `_generated/` and `dist/` into another relative folder:

```ts
import { defineConfig } from "spacepress";

export default defineConfig({
  name: "my-app",
  dir: "cms",
});
```

The compiler, the route scanner (`cms/app/`), `cms/wp-hooks/`, `cms/_generated/`, `cms/dist/`, `spacepress add`, `spacepress init` and `npm create spacepress@0.3.0 my-app -- --dir cms` all follow it. `content/`, `emails/` and `public/` stay at the project root.

## Per-route types (`./$types`)

`spacepress build` writes a `$types.d.ts` for every page and layout folder under `sp/_generated/types/sp/app/`. With `rootDirs` in `tsconfig.json`, a page imports its own types without repeating its route:

```json title="tsconfig.json"
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "spacepress",
    "rootDirs": [".", "./sp/_generated/types"]
  }
}
```

```tsx title="sp/app/notes/[slug]/page.tsx"
import type { PageProps } from "./$types";

export default function Note({ item, params }: PageProps) {
  return <h1>{item.title} ({params.slug})</h1>;
}
```

`./$types` exports `PageProps`, `LayoutProps` and `StaticParams`. The starter's `tsconfig.json` already sets this up.

## Import paths

The import path says where the code runs:

| Import path | Runs on | What it provides |
|---|---|---|
| `"spacepress"` | Build time (schema and config) | `defineConfig`, `definePlugin`, `collection`, `table`, `global`, `taxonomy`, `userProjection`, `wp`, `files`, field builders, `query`, `mutation`, `job`, `cron`, `env`, `store` and the other commerce builders, `adminScreen`, shared types |
| `"spacepress/server"` | Server (PHP) | `db`, `HttpError`, `once`, `mail`, `connectors` |
| `"spacepress/server/db"` | Server (PHP) | The app's kinds by export name, visitor-scoped: `import { posts } from "spacepress/server/db"` |
| `"spacepress/server/wp"` | Server (PHP) | WordPress core functions, `abilities`, `Handler<"...">`, `WP_Post` / `WP_User` / `WP_Query` |
| `"spacepress/app"` | Pages and layouts | `Link`, `Content`, `Html`, `Image`, `Live`, `Comments`, `Pagination`, `Search`, `LoginForm`, `useFormState`, `notFound`, `redirect`, and the `PageProps` / `LayoutProps` / `RouteRequest` types |
| `"spacepress/content"` | Pages and layouts | `nav`, `pager`, `headings`, `apiReference` |
| `"react"` | `"use client"` islands | `useState`, `useEffect`, `useRef`, compiled to the WordPress Interactivity API |
| `"spacepress/react"` | `"use client"` islands and external React apps | `useLive`, `useMutation`, `useMount`, `useEvent`, `sharedState`, `uploadFile` |
| `"./_generated/api"` | Anywhere | Typed references for `useLive` and `useMutation`: `api.<kind>.list()`, `api.actions.<name>` |
| `"spacepress/client"` (also `@spacepress/client`) | Browser, Node, Bun, Deno | `createClient`, `bind`, `SpacePressError`, `watch`, `registerRealtimeTransport` |

A `"use client"` file that imports `"spacepress/server"`, `"spacepress/server/*"`, `"spacepress/app"` or `"spacepress/content"`, directly or through another module, fails the build. Outside the compiler, those modules throw when imported.

Pre-split specifiers fail with a message naming the new one: `"spacepress:db"` is now `"spacepress/server/db"`, `"php/wordpress"` is `"spacepress/server/wp"`, and `db`, `HttpError`, `once`, `mail` and `connectors` moved from `"spacepress"` to `"spacepress/server"`.

## What to commit

Commit everything you write (`spacepress.config.ts`, `sp/`, `content/`, `emails/`, `public/`) and the generated files under `sp/_generated/`, in particular:

- `sp/_generated/migrations/`: one folder per migration, each with `ops.json` and `migration.sql`. It is the schema history every deploy upgrades from.
- `sp/_generated/wp-plugins.lock.json`: WordPress plugin versions and SHA-256 checksums.
- `sp/_generated/plugins.lock.json`: the capabilities granted to `use` plugin packages, including the islands they ship.
- `sp/_generated/abilities.json` and `sp/_generated/runtime-schema.json`, when you pull Abilities or runtime schema versions.

`sp/dist/` is build output; the starter's `.gitignore` leaves it out.
