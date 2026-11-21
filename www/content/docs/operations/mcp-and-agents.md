---
uid: zr_4adbd715279f7cefffe5
title: MCP & AI Agents
description: Project MCP server, AGENTS.md scaffolding, WordPress Abilities API, and runtime schema versions.
order: 2
status: published
publishedAt: 2026-11-21T09:15:00.000Z
---
## Coding agent setup

Run `typedpress init` in any project to write `AGENTS.md`, `.mcp.json`, and agent skills tailored to your schema and config. Run `typedpress init --check` in CI to ensure they stay up to date.

## Stdio MCP server

`typedpress mcp` launches a local MCP server on stdio exposing:

- Embedded documentation compiled into the exact binary version you are running
- Live project schema, routes, and compiler diagnostics

## WordPress Abilities API

Every collection, global, action, and job is registered as a WordPress Ability by default (`agents: false` opts out). Annotate actions with `readonly: true` or `destructive: true` to guide agent safety checks.

To invoke abilities provided by WordPress core or installed plugins with full TypeScript types:

```bash
npx typedpress abilities pull --site https://example.com
```

Then call `abilities.call("ability/name", input)` from `"php/wordpress"` inside any action, hook, or route.
