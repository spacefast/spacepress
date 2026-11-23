---
uid: zr_4adbd715279f7cefffe5
title: MCP & AI Agents
description: "Agent playbooks, compiler rules, 12 built-in skills, editor setup for Claude Code/Cursor/Codex, local & runtime MCP servers, and WordPress Abilities."
order: 2
status: published
publishedAt: 2026-11-21T09:15:00.000Z
---
SpacePress treats coding agents (Claude Code, Cursor, Codex, GitHub Copilot) as first-class citizens — from a single-file build playbook before you even scaffold, to compiled `AGENTS.md`, 12 procedural skills, and a version-pinned local MCP server.

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

1. **Compiled `AGENTS.md`:** Writes your app's live kinds, fields, access matrix, actions, jobs, routes, endpoints, command table, and anti-hallucination compiler rules between `<!-- spacepress:begin -->` and `<!-- spacepress:end -->` markers.
1. **Project `.mcp.json`:** Registers the local `spacepress` stdio MCP server (`npx --no-install spacepress mcp`).
1. **12 built-in Agent Skills:** Installs every `SKILL.md` into both `.agents/skills/` (Codex and the shared standard) and `.claude/skills/` (Claude Code).

## Editor setup

- **Claude Code:** Reads `.mcp.json` and `.claude/skills/` automatically. If your repository has its own `CLAUDE.md`, add `@AGENTS.md` to it so Claude Code loads both.
- **Cursor:** Reads `AGENTS.md`, `.agents/skills/`, and `.mcp.json` automatically — or [install the local SpacePress MCP server in Cursor]().
- **Codex / VS Code / Copilot:** Automatically pick up `AGENTS.md` and `.agents/skills/`; point your MCP client at `npx --no-install spacepress mcp`.

## Built-in Agent Skills

| Skill                       | When an agent uses it                                                                                                      |
|-----------------------------|----------------------------------------------------------------------------------------------------------------------------|
| `spacepress-add-kind`       | Adding or updating `collection()` / `table()` kinds, fields, `ref()`, access rules, or physical storage names                    |
| `spacepress-add-page`       | Building headful `sp/app/**/page.tsx`, `layout.tsx`, dynamic segments, or custom `route.ts` endpoints                      |
| `spacepress-write-action`   | Adding typed `query()` and `mutation()` RPC endpoints and retryable Action Scheduler `job()` queues                                        |
| `spacepress-dev-site`       | Starting, inspecting, querying, or resetting the local WordPress + SQLite dev site                                         |
| `spacepress-fix-diagnostic` | Reading `spacepress check --json` diagnostics and fixing TS-to-PHP compiler errors or lint warnings                        |
| `spacepress-woocommerce`    | Scaffolding and configuring `store()`, `product()`, shipping zones, orders, and optimistic cart hooks                      |
| `spacepress-markdown-sync`  | Configuring `sync: "content/**/*.md"`, UIDs, `spacepress sync`, conflict resolution, and GitHub sync                       |
| `spacepress-security-audit` | Auditing `.access()` rules, field-level leaks, `spacepress:db` vs `db`, route guards, and Abilities flags                  |
| `spacepress-deploy`         | Safe preflight (`check`, `push --dry-run`), explicit production consent, WP Cloud static-asset notes, and `doctor --links` |
| `spacepress-connect-mcp`    | Connecting an agent to a running site's authenticated WordPress MCP endpoint                                               |

## Two MCP servers: dev-time vs runtime

SpacePress ships two distinct MCP servers for different jobs:

### 1. Local dev-time MCP (`spacepress mcp`)

Runs on stdio against your source repository — no live WordPress site or credentials required. Exposes read-only tools by default:

- `schema` — compiled kinds, fields, access rules, relations, actions, jobs, routes, roles, and Abilities
- `check` — runs `spacepress check --json` without writing files
- `docs_search` & `docs_read` — searches and reads documentation embedded inside the exact compiler binary version
- `commands` — full build & site command table
- `dev_status` — local dev server URL, watch state, and last build error
- `query` — reads records from the local dev site (`--allow-remote-read` opts into reading named remote sites)

Pass `--allow-writes` to additionally expose `run_action`, `insert`, and `update` strictly scoped to the project's local dev site.

### 2. Runtime WordPress MCP (`/wp-json/mcp/spacepress-<app>`)

Every running SpacePress site exposes an authenticated WordPress MCP endpoint with one tool per collection operation and exported server function, authenticated as a WordPress user via Application Passwords or scoped agent credentials (`spacepress identity agent add`).

## WordPress Abilities API

Every collection, global, action, and job is registered as a WordPress Ability by default (`agents: false` opts out). Queries are marked read-only. Set `destructive: true` on mutations that perform destructive work.

To invoke abilities provided by WordPress core or installed plugins with full TypeScript types:

```bash
npx spacepress abilities pull --site https://example.com
```

Then call `abilities.call("ability/name", input)` from `"php/wordpress"` inside any action, hook, or route.

## Guidance evals

Compiler-backed guidance evals live in `evals/guidance/` (`node evals/guidance/run.mjs`) to verify reference prompts and negative compiler checks against `spacepress check --json`.
