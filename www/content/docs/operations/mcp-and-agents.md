---
uid: zr_4adbd715279f7cefffe5
title: MCP & AI Agents
description: "Agent playbooks, compiler rules, 10 built-in skills, editor setup for Claude Code/Cursor/Codex, local & runtime MCP servers, and WordPress Abilities."
order: 2
status: published
publishedAt: 2026-11-21T09:15:00.000Z
---
SpacePress gives coding agents (Claude Code, Cursor, Codex, GitHub Copilot) what they need to work on a project: a build playbook to read before scaffolding, a generated `AGENTS.md`, 10 skills, and a local MCP server pinned to the compiler version.

## Machine-readable entry points

Point any coding agent or LLM directly at:

- **[/start.md](https://spacepress.dev/start.md)** — Imperative agent build playbook (inspect workspace → model data → build headful TSX slice → boot local WordPress → verify).
- **[/rules.md](https://spacepress.dev/rules.md)** — Dense TS-to-PHP compiler rules, exact import boundaries, access rules, and safe migration conventions.
- **[/llms.txt](https://spacepress.dev/llms.txt)** & **[/llms-full.txt](https://spacepress.dev/llms-full.txt)** — Complete documentation index and full plain-text corpus.
- **[/.well-known/ai-catalog.json](https://spacepress.dev/.well-known/ai-catalog.json)** & **[/.well-known/agent-skills/index.json](https://spacepress.dev/.well-known/agent-skills/index.json)** — Auto-discovery catalog and SHA-256-indexed Agent Skills manifest.

## Project setup (`spacepress init`)

`npm create spacepress@0.3.0 my-app` runs `spacepress init` automatically. Re-run it after changing `spacepress.config.ts` or `sp/`:

```bash
npx spacepress init
npx spacepress init --check   # fails CI if AGENTS.md or skills are stale
```

`spacepress init` maintains three things without overwriting your custom notes:

1. **Generated `AGENTS.md`:** Writes your app's kinds, fields, access rules, queries, mutations, jobs, routes, endpoints, the command table and the compiler's rules between the `spacepress:begin` and `spacepress:end` marker comments. Text outside the markers is yours and is never touched.
1. **Project `.mcp.json`:** Registers the local `spacepress` stdio MCP server (`npx --no-install spacepress mcp`).
1. **The 10 built-in Agent Skills:** Installs every skill in the table below into both `.agents/skills/` (Codex and the shared convention) and `.claude/skills/` (Claude Code). If you delete one of those two folders, a rerun leaves it deleted.

## Editor setup

- **Claude Code:** Reads `.mcp.json` and `.claude/skills/` automatically. If your repository has its own `CLAUDE.md`, add `@AGENTS.md` to it so Claude Code loads both.
- **Cursor:** Reads `AGENTS.md` and `.agents/skills/`. To add the MCP server, register `npx --no-install spacepress mcp` as a stdio server in Cursor's MCP settings (`.cursor/mcp.json`).
- **Codex / VS Code / Copilot:** Automatically pick up `AGENTS.md` and `.agents/skills/`; point your MCP client at `npx --no-install spacepress mcp`.

## Built-in Agent Skills

| Skill                       | When an agent uses it                                                                                                      |
|-----------------------------|----------------------------------------------------------------------------------------------------------------------------|
| `spacepress-add-kind`       | Adding or updating `collection()` / `table()` kinds, fields, `ref()`, access rules, or physical storage names                    |
| `spacepress-add-page`       | Building headful `sp/app/**/page.tsx`, `layout.tsx`, dynamic segments, or custom `route.ts` endpoints                      |
| `spacepress-write-action`   | Adding typed `query()` and `mutation()` server functions and retryable Action Scheduler `job()` queues                     |
| `spacepress-dev-site`       | Starting, inspecting, querying, or resetting the local WordPress + SQLite dev site                                         |
| `spacepress-fix-diagnostic` | Reading `spacepress check --json` diagnostics and fixing TS-to-PHP compiler errors or lint warnings                        |
| `spacepress-woocommerce`    | Scaffolding and configuring `store()`, `product()`, shipping zones, orders, and optimistic cart hooks                      |
| `spacepress-markdown-sync`  | Configuring `sync: "content/**/*.md"`, UIDs, `spacepress sync`, conflict resolution, and GitHub sync                       |
| `spacepress-security-audit` | Auditing `.access()` rules, field-level leaks, `spacepress/server/db` vs `db`, route guards, and Abilities flags                  |
| `spacepress-deploy`         | Safe preflight (`check`, `push --dry-run`), explicit production consent, WP Cloud static-asset notes, and `doctor --links` |
| `spacepress-connect-mcp`    | Connecting an agent to a running site's authenticated WordPress MCP endpoint                                               |

## Two MCP servers: dev-time vs runtime

SpacePress ships two distinct MCP servers for different jobs:

### 1. Local dev-time MCP (`spacepress mcp`)

Runs on stdio against your source repository — no live WordPress site or credentials required. Exposes read-only tools by default:

- `schema` — compiled kinds, fields, access rules, relations, queries and mutations, jobs, pages and routes, file buckets, roles, and Abilities
- `check` — runs `spacepress check --json` without writing files
- `docs_search` & `docs_read` — searches and reads documentation embedded inside the exact compiler binary version
- `commands` — full build & site command table
- `dev_status` — local dev server URL, watch state, and last build error
- `query` — reads records from the local dev site (`--allow-remote-read` opts into reading named remote sites)

Pass `--allow-writes` to additionally expose `run_action`, `insert`, and `update` strictly scoped to the project's local dev site.

### 2. Runtime WordPress MCP (`/wp-json/mcp/spacepress-<app>`)

Every running SpacePress site with the MCP Adapter plugin (installed with the platform plugins) serves the app's own MCP server, `spacepress-<app>`, at `/wp-json/mcp/spacepress-<app>`. Each ability with `agents` on is one tool: kind operations, globals, queries and mutations, and jobs with `agents: true`. Agents sign in as a WordPress user with an application password or scoped agent credentials (`spacepress identity agent add <user> --name=<name>`).

## WordPress Abilities API

Every collection, table, global, query and mutation is registered as a WordPress Ability, `<app>/<kebab-name>`. `agents: false` keeps it registered (for PHP, `wp spacepress run` and the app's own typed client) but hides it from REST discovery and MCP. Taxonomies and jobs are off unless you set `agents: true`. Queries are annotated read-only; set `destructive: true` on a mutation that deletes or overwrites data so agents confirm first.

The typed client runs its calls through these Abilities too, at `/wp-json/wp-abilities/v1/abilities/<app>/<name>/run`; see [Typed Clients](/docs/integrations/astro-and-clients#how-calls-reach-wordpress).

To invoke abilities provided by WordPress core or installed plugins with full TypeScript types:

```bash
npx spacepress abilities pull --site https://example.com
```

This locks their names and schemas into `sp/_generated/abilities.json`. Then call `abilities.call("ability/name", input)` from `"spacepress/server/wp"` in a query, mutation, job, hook or route, typed by that file.

## Guidance evals

Compiler-backed guidance evals live in `evals/guidance/` (`node evals/guidance/run.mjs`) to verify reference prompts and negative compiler checks against `spacepress check --json`.
