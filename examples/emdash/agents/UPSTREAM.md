# Pinned upstream behavior

All links refer to EmDash revision
`1824902c0c383c052b623528799427b8a5ff75d0`. Adapted echo behavior and documentation
retain the [upstream MIT notice](LICENSE.emdash).

| Official source | Behavior inspected | Native SpacePress adaptation |
| --- | --- | --- |
| [MCP smoke plugin](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/mcp-smoke/src/sandbox-entry.ts) | Private `content:read` echo route; 1–200 character message; `{ message, length }`; named MCP tool with input/output schemas | `echo` action, authenticated `agents-echo`, validation and actual HTTP handshake/tool execution |
| [Plugin descriptor](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/packages/plugins/mcp-smoke/src/index.ts) | Sandboxed plugin identity and entrypoint | Trusted SpacePress config compiled into a WordPress plugin; no sandbox claim |
| [AI tools tutorial](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/guides/ai-tools.mdx) | Authenticated site MCP, content drafting/editing/publishing and settings | Real article and global mutations, native editor interop, public effects; guide names only tools installed by this config |
| [MCP reference](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/reference/mcp-server.mdx) | Discover schemas first; role checks independent of credentials; JSON-RPC initialize/list/call | Core WordPress Abilities plus MCP Adapter 0.7.1, application passwords, negotiated sessions and per-tool authorization |
| [Agent skills tutorial](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/docs/src/content/docs/agent-skills.mdx) and [site skill](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/skills/building-emdash-site/SKILL.md) | Versioned, project-local instructions for schema, queries, frontend and CLI | Copyable SpacePress config, lifecycle command, frontend and agent guide in one runnable example |
| [Plugin skill](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/skills/creating-plugins/SKILL.md) and [MCP route example](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/skills/creating-plugins/references/api-routes.md) | Explicit MCP exposure and permissions; test production HTTP rather than direct invocation | SpacePress `agents: false` for opt-out, jobs default off, real core discovery/execution, REST parity, failure envelopes and real MCP HTTP calls |

This example qualifies the agent/MCP slice. It does not claim EmDash's complete
tool inventory, OAuth scopes/consent, stateless transport, Worker isolation,
Cloudflare services, PostgreSQL, or AI-provider parity. MCP Adapter uses its own
session protocol and WordPress users/application passwords; SpacePress's config is a
trusted plugin. The public notebook renders saved text safely and uses native
WordPress block content rather than EmDash Portable Text. The review queue is
Action Scheduler. No AI response is simulated.
