---
name: first-connect-mcp
description: "Use when connecting an MCP client (Claude Code, Claude Desktop, Codex or another agent) to a running First site so it can use the app's data and actions: finding the endpoint, creating an application password, and writing the client configuration. Not for the development-time `first mcp` server."
compatibility: "Targets First 0.3 (WordPress 7.1+, PHP 8.2+). Requires the `first` CLI and Node.js 22+."
---

# Connect an MCP client to a site's endpoint

## When to use

- An agent should use the app: list and change records, run actions, as a WordPress user.

This is the runtime endpoint. To work on the project's source, use the `first` server in
`.mcp.json` (`first mcp`) instead; it needs no site and no password.

## Inputs required

- The site's URL (for the local dev site: `first dev status`, or the `dev_status` tool).
- The app's name: `name` in `defineConfig`, also in `AGENTS.md` and the `schema` tool.
- A WordPress user for the agent, with the role its work needs.

## Procedure

1. Work out the endpoint: `<site>/wp-json/mcp/first-<app>`, the app name in kebab-case
   (`myTracker` is `first-my-tracker`). `AGENTS.md` and the `schema` tool give it under
   `endpoints.mcp`. Keep any WordPress subdirectory before `/wp-json`.

2. Create an application password for the agent's user. On a hosted site: **Users → Profile →
   Application Passwords** in wp-admin, over HTTPS. On the local dev site:

   ```sh
   first wp user application-password create admin my-agent --porcelain
   ```

   Use a separate user with the least role that works. The agent gets that user's access and no
   more: the kinds' access rules apply to every tool call.

3. Build the header in a shell, so the password is not written to a file or to history:

   ```sh
   printf 'user:application-password: '; stty -echo; read -r FIRST_APP_PASSWORD; stty echo; echo
   export FIRST_MCP_AUTH="Basic $(printf %s "$FIRST_APP_PASSWORD" | base64 | tr -d '\n')"
   unset FIRST_APP_PASSWORD
   ```

4. Add the server to the client, reading the header from the environment: `references/clients.md`
   has the configuration for Claude Code, Claude Desktop and Codex. For Claude Code, in
   `.mcp.json`:

   ```json
   {
     "mcpServers": {
       "first-my-app": {
         "type": "http",
         "url": "https://your-site.example/wp-json/mcp/first-my-app",
         "headers": { "Authorization": "${FIRST_MCP_AUTH}" }
       }
     }
   }
   ```

   Start the client from the shell that exported `FIRST_MCP_AUTH`.

5. List the tools before calling one. Each enabled operation of a kind and each action is a tool
   named `<app>-<kind>-list`, `-get`, `-create`, `-update`, `-delete`, and `<app>-<action>`.
   Read each tool's input schema from `tools/list`; do not guess it.

## Verification

- The client lists tools whose names start with the app's name, for example `my-app-notes-list`.
- A list tool returns `{ "rows": [...] }`.

To check without a client, the endpoint is MCP over Streamable HTTP: `POST` an `initialize`
request with the `Authorization` header, `Content-Type: application/json` and
`Accept: application/json, text/event-stream`. Later requests repeat the `Mcp-Session-Id` header
the answer carried and send `MCP-Protocol-Version` with the negotiated version.

## Failure modes / debugging

- 401: the header is missing or wrong. It is `Basic` plus base64 of `user:application-password`,
  not the user's login password.
- 404 on the endpoint: the app name in the URL is wrong, or the app plugin or the MCP Adapter
  plugin is not active. `first wp plugin list --status=active` lists `first-app-<app>` and
  `mcp-adapter` on a dev site.
- A kind or action has no tool: it sets `agents: false`, or that operation is turned off in the
  kind's `api` option. The `schema` tool shows `agents` and `operations` per kind.
- A tool answers 403: the agent's user lacks the role the access rule names.

## Escalation

- Never commit a password or the header value, and never put one in `.mcp.json`, `AGENTS.md` or a
  chat transcript. Revoke a leaked application password in the user's profile.
- A production site: confirm the user and its role with the owner before connecting.

Reference: `docs/agents.md`.
