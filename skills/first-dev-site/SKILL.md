---
name: first-dev-site
description: "Use when running a First project locally or inspecting its local WordPress site: starting and stopping `first dev`, finding the site's URL and login, reading records with `first find`, running an action or a job by hand, or running WP-CLI on the site."
compatibility: "Targets First 0.3 (WordPress 7.2-beta5+, PHP 8.2+). Requires the `first` CLI and Node.js 22+."
---

# Run and inspect the dev site

## When to use

- You need the project running to see a change, or to check what the site actually stores.

## Inputs required

- The project directory. Node.js 22+ and npm must be installed; Docker and PHP are not needed.

## Procedure

1. Check the state first. With the `first` MCP server, call `dev_status`. Otherwise:

   ```sh
   first dev status --json
   ```

   `state` is `none` (no site yet), `stopped` or `running`; `url` and `port` say where it is, and
   `watching` whether a `first dev` process is rebuilding it on save.

2. Start the site.
   - `first dev --detach` builds, starts WordPress and returns once the site is up. It keeps
     rebuilding on every save in the background and logs to `.first/dev/dev.log`. Use this from
     an agent. Plain `first dev` does the same when an agent runs it without a terminal.
   - `first dev` in a terminal stays in the foreground until Ctrl+C.
   - `first dev --no-watch` builds, starts WordPress and returns, with nothing watching. Run it
     again after edits to rebuild.
   - `--port <n>` picks the port for a new site. An existing site keeps its port.

3. Read the start-up output: the site URL, `/wp-admin/`, and the local login
   `admin` / `first-test-admin` (local development only).

4. Inspect the site. These run inside WordPress on the dev site, as the trusted command line:
   - `first find <storage name> '{"where":{"done":false},"limit":5}'`: read records. A kind's
     storage name is the snake_case form of its export name (`shoppingList` is `shopping_list`); the
     `schema` tool lists it as `path`. The `query` tool of
     the `first` MCP server does the same.
   - `first action <name> '<json>'`: run an action.
   - `first jobs list`: queued and finished jobs. `first wp action-scheduler run --hooks=first_job`
     runs the queued ones now.
   - `first abilities`: the Abilities the app registers.
   - `first wp <args>`: any WP-CLI command, for example `first wp plugin list`.

5. Read the HTTP API as a visitor would: `GET <siteUrl>/__first/api/v1` describes the app, and
   `GET <siteUrl>/__first/api/v1/<storage name>` lists what an anonymous visitor may read.

6. Stop it with `first dev stop`. The database, uploads and plugins are kept in
   `.first/dev/wordpress` for the next start.

## Verification

- `first dev status --json` reports `"state":"running"`.
- `first find <storage name>` answers `{"data":[…]}`.

## Failure modes / debugging

- "Port … is occupied": pass another `--port`.
- "Another first dev command owns this project": a `first dev` is already running for it. Use it,
  or `first dev stop` first.
- "Local data was preserved": a save would drop or narrow stored data. If that is intended, stop,
  then start once with `first dev --allow-destructive`.
- A site command prints `{"error":…}` with status 503: a migration is pending or refused. Run
  `first migrate` and read its answer.
- An edit does not show: the site runs the last successful build. Read `.first/dev/dev.log` (or
  the `first dev` terminal) for a diagnostic, or run `first check`.

## Escalation

- `--site` points a site command at another site. Never add it to a write (`insert`, `update`,
  `delete`, `action`) unless the owner named that site.
- Never delete `.first/dev/` to "reset" without asking: it holds the local database and uploads.

Reference: `docs-site/docs/getting-started.mdx`, `docs-site/docs/reference/cli.mdx`.
