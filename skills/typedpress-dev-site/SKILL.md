---
name: typedpress-dev-site
description: "Use when running a TypedPress project locally or inspecting its local WordPress site: starting and stopping `typedpress dev`, finding the site's URL and login, reading records with `typedpress find`, running an action or a job by hand, or running WP-CLI on the site."
compatibility: "Targets TypedPress 0.3 (WordPress 7.1+, PHP 8.2+). Requires the `typedpress` CLI and Node.js 22+."
---

# Run and inspect the dev site

## When to use

- You need the project running to see a change, or to check what the site actually stores.

## Inputs required

- The project directory. Node.js 22+ and npm must be installed; Docker and PHP are not needed.

## Procedure

1. Check the state first. With the `typedpress` MCP server, call `dev_status`. Otherwise:

   ```sh
   typedpress dev status --json
   ```

   `state` is `none` (no site yet), `stopped` or `running`; `url` and `port` say where it is, and
   `watching` whether a `typedpress dev` process is rebuilding it on save. `error` is null, or the
   watching process's last build when it failed (`message` and the compiler's `diagnostics`): the
   site then serves the last build that succeeded, so fix the source before reading the site.

2. Start the site.
   - `typedpress dev --detach` builds, starts WordPress and returns once the site is up. It keeps
     rebuilding on every save in the background and logs to `.tp/dev/dev.log`. Use this from
     an agent. It exits 1 and prints the error when the first build fails; WordPress is running
     and the next save that builds clears it. Plain `typedpress dev` does the same when an agent runs it without a terminal.
   - `typedpress dev` in a terminal stays in the foreground until Ctrl+C.
   - `typedpress dev --no-watch` builds, starts WordPress and returns, with nothing watching. Run it
     again after edits to rebuild.
   - `--port <n>` picks the port for a new site. An existing site keeps its port.

3. Read the start-up output: the site URL, `/wp-admin/`, and the local login
   `admin` / `typedpress-test-admin` (local development only).

4. Inspect the site. These run inside WordPress on the dev site, as the trusted command line:
   - `typedpress find <storage name> '{"where":{"done":false},"limit":5}'`: read records. A kind's
     storage name is the snake_case form of its export name (`shoppingList` is `shopping_list`); the
     `schema` tool lists it as `path`. The `query` tool of
     the `typedpress` MCP server does the same.
   - `typedpress action <name> '<json>'`: run an action.
   - `typedpress jobs list`: queued and finished jobs. `typedpress wp action-scheduler run --hooks=tp_job`
     runs the queued ones now.
   - `typedpress abilities`: the Abilities the app registers.
   - `typedpress wp <args>`: any WP-CLI command, for example `typedpress wp plugin list`.

5. Read the HTTP API as a visitor would: `GET <siteUrl>/wp-json/typedpress/v1` describes the app, and
   `GET <siteUrl>/wp-json/typedpress/v1/<storage name>` lists what an anonymous visitor may read.

6. Stop it with `typedpress dev stop`. The database, uploads and plugins are kept in
   `.tp/dev/wordpress` for the next start.

## Verification

- `typedpress dev status --json` reports `"state":"running"`.
- `typedpress find <storage name>` answers `{"data":[…]}`.

## Failure modes / debugging

- "Port … is occupied": pass another `--port`.
- "Another typedpress dev command owns this project": a `typedpress dev` is already running for it. Use it,
  or `typedpress dev stop` first.
- "Local data was preserved": a save would drop or narrow stored data. If that is intended, stop,
  then start once with `typedpress dev --allow-destructive`.
- A site command prints `{"error":…}` with status 503: a migration is pending or refused. Run
  `typedpress migrate` and read its answer.
- An edit does not show: the site runs the last successful build. Read `.tp/dev/dev.log` (or
  the `typedpress dev` terminal) for a diagnostic, or run `typedpress check`.

## Escalation

- `--site` points a site command at another site. Never add it to a write (`insert`, `update`,
  `delete`, `action`) unless the owner named that site.
- Never delete `.tp/dev/` to "reset" without asking: it holds the local database and uploads.

Reference: `docs-site/docs/getting-started.mdx`, `docs-site/docs/reference/cli.mdx`.
