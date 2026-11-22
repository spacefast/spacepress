# SpacePress

**The full-stack TypeScript framework that compiles directly to WordPress.**

Write collections, relational SQL tables, declarative access rules, transactional hooks, server actions, background jobs, HTTP routes, and React-style TSX pages in TypeScript. SpacePress's Rust & OXC compiler compiles your project directly into native PHP, numbered SQL migrations, OpenAPI 3.1, a typed client, and standard WordPress plugins — with **zero Node.js in production**.

Website: [spacepress.dev](https://spacepress.dev) · Repository: [github.com/spacefast/spacepress](https://github.com/spacefast/spacepress)

> **Pre-release naming note:** SpacePress is the product, brand, and website (`spacepress.dev`). While preparing for 1.0, the CLI binary, npm packages (`typedpress`, `create-typedpress`, `@typedpress/astro`, `@typedpress/blocks`), config file (`typedpress.config.ts`), app folder (`tp/`), and module imports (`"typedpress"`, `"typedpress:db"`) use the pre-release identifier `typedpress`.

---

## Quick Start

Requires **Node.js 22+**. No Rust toolchain or Docker required.

```bash
npm create typedpress@0.3.0 my-app
cd my-app
npm run dev
```

`typedpress dev` compiles your TypeScript, boots a local WordPress + SQLite server, activates the generated plugins, and rebuilds on save. Open the printed URL for your site and `/wp-admin/new/` for SpacePress Admin.

---

## What a SpacePress App Looks Like

Define WordPress collections, custom SQL tables, access rules, hooks, server actions, and background jobs in plain TypeScript:

```ts
// typedpress.config.ts
import {
  wp, table, text, integer, boolean,
  ref, mutation, job, HttpError, defineConfig,
} from "typedpress";
import { tasks } from "typedpress:db";

// Native WordPress posts extended with typed fields, URL routing, comments & Markdown sync
export const posts = wp.posts.extend({
  subtitle: text().max(200).optional(),
}, {
  url: "/blog/:slug",
  sync: "content/posts/*.md",
  comments: { moderation: "first-time", threaded: 2 },
});

// Stored in its own SQL table with forward-only migrations, soft deletes & revisions
export const tasks = table({
  title: text().min(1).max(120),
  done: boolean().default(false),
  postId: ref(posts).optional().onDelete("cascade"),
}, {
  access: { read: "anyone", create: "authenticated", update: "authenticated", delete: "editor" },
}).on({
  async afterCreate(row) {
    await notifyTask.enqueue({ taskId: row.id }, { key: `task-${row.id}` });
  },
});

export const notifyTask = job({ retries: 3 }, async ({ taskId }: { taskId: number }) => {
  await tasks.system.get(taskId);
});

export const completeTask = mutation({ access: "authenticated" }, async ({ id }: { id: number }) => {
  const row = await tasks.update(id, { done: true });
  if (!row) throw new HttpError(404, "not_found", "Task not found");
  return row;
});

export default defineConfig({ name: "my-app", seed: true });
```

Render server-side TSX pages in `tp/app/` (compiled directly to PHP) with `"use client"` interactive islands compiled to the WordPress Interactivity API:

```tsx
// tp/app/page.tsx
import { posts } from "typedpress:db";
import { Link } from "typedpress/app";

export const metadata = { title: "Home" };

export default async function Home() {
  const latest = await posts.list({ orderBy: { publishedAt: "desc" }, limit: 10 });
  return (
    <main>
      <h1>Latest Posts</h1>
      <ul>
        {latest.map((post) => (
          <li key={post.id}><Link href={`/blog/${post.slug}`}>{post.title}</Link></li>
        ))}
      </ul>
    </main>
  );
}
```

---

## Core Capabilities

- **Dual Storage Engine:** Combine `collection()` (WordPress posts, Gutenberg, drafts, revisions, staged versions, comments, hierarchical URLs) with `table()` (custom SQL tables, compound indexes, forward-only migrations, stable physical names), `global()`, `taxonomy()`, `userProjection()`, and `wp.posts.extend()`.
- **Zero-Node Native PHP Compiler:** Rust + OXC parses TypeScript/TSX and emits deterministic `schema.php`, `functions.php`, forward-only SQL migrations, `db.d.ts`, `routes.d.ts`, `openapi.json`, and a typed client.
- **File-Based TSX Pages & `"use client"` Islands:** Server-rendered pages, layouts, custom `route.ts` HTTP endpoints, progressive zero-JS `<form action={...}>`, and `"use client"` Interactivity API components (`useState`, `useLive`, `sharedState`). Export static HTML with `output: "static"`.
- **Declarative Access & Identity:** Ordered role ladder (`guest < subscriber < author < editor < admin`), row-level filter rules compiled into SQL/PHP, field-level `.access()` masks, and `typedpress-identity` (passkeys, TOTP, JWT, application tokens).
- **Server Actions, Jobs & Private Files:** Validated RPC actions (`/wp-json/typedpress/v1/actions/<name>`), Action Scheduler background jobs with retries/dedupe keys, HMAC-signed webhooks, and local/S3 `files()` buckets with signed URLs.
- **Native WooCommerce & React Email:** Declarative `store()`, `product()`, `order()`, `typedpress add shop`, optimistic cart hooks (`createCartHooks`), plus `emails/*.tsx` templates rendered with `mail.render()` and queued transactionally with `mail.send()`.
- **Two-Way Markdown & Git Sync:** Bind collections to `content/**/*.md` with stable UIDs, schema-validated YAML front matter, 3-way merges (`typedpress sync`), and GitHub dispatch workflows.
- **Modern Admin, Gutenberg & Plugins:** Ships `typedpress-admin` at `/wp-admin/new/`, declarative `adminScreen()` DataViews/DataForms, `@typedpress/blocks` for Gutenberg in TSX, locked third-party plugins (`wp-plugins.lock.json`, `sealed: true`), and capability-locked `definePlugin()` packages.
- **MCP Server & WordPress Abilities:** Run `typedpress init` and `typedpress mcp` for AI coding agents, and expose or invoke typed WordPress Abilities (`abilities.call()`).

---

## Importing an existing project

Install the standalone importer with `cargo install --path migrate`. See the [import guide](migrate/README.md) for supported source projects and commands.

## Architecture

`typedpress build` transforms your repository into deployable WordPress plugins under `tp/dist/wp-content/plugins/`:

- `typedpress-runtime` — core PHP runtime, query engine, access enforcer, REST router, sync & job adapters
- `typedpress-identity` — authentication, sessions, passkeys, TOTP, JWT, and application tokens
- `typedpress-admin` — modern React admin UI at `/wp-admin/new/` (optional; disable with `admin: false`)
- `typedpress-app-<name>` — your compiled `schema.php`, `functions.php`, migrations, routes, CSS/JS assets, and OpenAPI spec

---

## CLI Overview

| Command | Description |
|---|---|
| `typedpress dev` / `dev stop` / `dev status` | Local WordPress + SQLite dev server with watch rebuilds |
| `typedpress check [--json] [--frozen] [--fix]` | Validate schemas, handlers, pages, and locks without emitting files (`--fix` applies lint auto-fixes) |
| `typedpress build` | Emit WordPress plugins (`tp/dist/wp-content/`), migrations, types, OpenAPI & client |
| `typedpress export` | Export `tp/app/` to static HTML in `tp/dist/static/` (`output: "static"`) |
| `typedpress add <shop\|db\|api-reference>` | Scaffold optional modules as source files you own |
| `typedpress sync` | Two-way sync between local `content/` Markdown/JSON and WordPress |
| `typedpress init [--github] [--check]` | Generate `AGENTS.md`, `.mcp.json`, skills, and optional GitHub sync workflow |
| `typedpress mcp` | Start the stdio MCP server with embedded version-matched docs |
| `typedpress plugin` | Package `typedpress.zip` for upload in `wp-admin` |
| `typedpress login <url>` / `push` | Authenticate via Application Passwords and deploy to a live WordPress site |
| `typedpress doctor [--links]` | Verify build/site health and crawl internal links and anchors |
| `typedpress wp` / `migrate` / `jobs` / `staged` / `identity` | WP-CLI site management against local dev or `--site` targets |

---

## Packages in This Monorepo

| Package | Path | Description |
|---|---|---|
| `typedpress` | [`packages/cli`](packages/cli/README.md) | npm launcher that installs and runs the native Rust compiler binary |
| `create-typedpress` | [`packages/create-typedpress`](packages/create-typedpress/README.md) | Project scaffolder (`npm create typedpress@0.3.0 my-app`) |
| `@typedpress/astro` | [`packages/astro`](packages/astro/README.md) | Astro 7+ build-time/live content loaders, cache tags & signed webhooks |
| `@typedpress/blocks` | [`packages/blocks`](packages/blocks/README.md) | Author Gutenberg content and WordPress block themes in TSX |
| `@typedpress/frontend` | [`packages/frontend`](packages/frontend/README.md) | First-party Tailwind and browser asset build tooling |
| `spacepress.dev` | [`www`](www/README.md) | Official SpacePress website and documentation, built and served as a SpacePress app |

---

## Documentation

All documentation lives in the SpacePress website at [`www/content/docs/`](www/content/docs/) (published live at [spacepress.dev/docs](https://spacepress.dev/docs) and embedded into `typedpress mcp`):

- **Getting Started:** [Installation & Setup](www/content/docs/getting-started/installation.md) · [Project Structure](www/content/docs/getting-started/project-structure.md)
- **Core:** [Schema & Storage](www/content/docs/core/schema-and-storage.md) · [Queries & Access](www/content/docs/core/queries-and-access.md) · [Pages & Islands](www/content/docs/core/pages-and-islands.md) · [Actions, Jobs & Routes](www/content/docs/core/actions-jobs-routes.md)
- **Integrations:** [Astro & Clients](www/content/docs/integrations/astro-and-clients.md) · [Markdown Sync](www/content/docs/integrations/markdown-sync.md) · [React Email](www/content/docs/integrations/react-email.md) · [WooCommerce](www/content/docs/integrations/woocommerce.md)
- **Operations:** [CLI & Deploy](www/content/docs/operations/cli-and-deploy.md) · [Deploy to Pressable](www/content/docs/operations/deploy-pressable.md) · [Deploy to WordPress.com](www/content/docs/operations/deploy-wordpress-com.md) · [Deploy to Spacefast](www/content/docs/operations/deploy-spacefast.md) · [Self-Hosted](www/content/docs/operations/deploy-self-hosted.md) · [MCP & Agents](www/content/docs/operations/mcp-and-agents.md)

---

## Building From Source

Requires Rust (see `rust-toolchain`) and Node.js 22+:

```bash
# Build the native CLI binary (embeds runtime/, skills/, and www/content/docs/ via build.rs)
cargo build --release

# Run the compiled binary
./target/release/typedpress --help

# Build the browser WebAssembly compiler (src/wasm.rs)
cargo build --lib --no-default-features --profile wasm --target wasm32-unknown-unknown
```

---

## Licensing

SpacePress is licensed by component (see [`LICENSING.md`](LICENSING.md) for the full path-by-path breakdown):

- **MIT** ([`LICENSE`](LICENSE)): Rust compiler & CLI (`src/`, `crates/`), typed client (`runtime/client/`), type definitions (`types/`), npm packages, examples, documentation, and website.
- **GPL-2.0-or-later** ([`licenses/GPL-2.0-or-later.txt`](licenses/GPL-2.0-or-later.txt)): PHP runtime and WordPress plugins (`runtime/TypedPress/`, `runtime/identity/`, `runtime/admin/`, `runtime/wp-plugin/`, and generated WordPress plugins).
