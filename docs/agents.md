# Use your First app from an agent

First has two MCP servers, for two different jobs:

| | Development time | Runtime |
|---|---|---|
| What it is | `first mcp`, in the `first` binary | the site's endpoint, `/wp-json/mcp/first-<app>` |
| Who uses it | a coding agent working on the project's source | any agent using the app's data and actions |
| Transport | stdio | Streamable HTTP |
| What it answers | the project's schema, compiler diagnostics, First's documentation, the command table, the dev site | one tool per collection operation and action |
| Access | the local files, and the local dev site | a WordPress user's access rules |

## Develop a project with a coding agent: `first mcp`

`first mcp [dir]` serves the project in `dir` (default: the current directory)
to a coding agent on stdin and stdout. Register it with the agent you use. For
Claude Code, in the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "first": { "command": "npx", "args": ["--no-install", "first", "mcp"] }
  }
}
```

For Codex: `codex mcp add first -- npx --no-install first mcp`. `--no-install`
runs the `first` the project already has from `@spacefast/first-cli` and never
downloads a package by that name. With a compiler built from source, use its
path in place of `npx --no-install first`.

| Tool | What it returns |
|---|---|
| `schema` | The project's kinds with their fields, access rules, relations and hooks; globals, actions, jobs, pages and HTTP routes, file buckets, roles, the Abilities the site registers, and the endpoints. `kind` narrows it to one kind. |
| `check` | The `first-diagnostics` envelope `first check --json` prints ([compiler diagnostics](compiler-diagnostics.md)). It writes nothing. |
| `docs_search`, `docs_read` | First's documentation as built into this binary: the guides in `docs/` (not the design proposals or the pages for hosts and maintainers) and the docs site's pages. A long page or section read whole answers with its opening and its sections; pass `section` to read one. |
| `commands` | The command table `first help` prints. |
| `dev_status` | Whether the project has a local dev site, whether it runs, and its URL. |
| `query` | A kind's records from the local dev site, through `first find`: `kind`, `where`, `orderBy`, `limit` (20 by default, at most 500), `offset`, `columns`, `with`. Like every request to the site, it first publishes scheduled posts that are due. |

`schema`, `check`, `docs_search` and `docs_read` compile or read from the
binary and need no site. `schema` and `check` read the files as they are at each
call, so an edit shows up without restarting the server. The same documentation
pages are also the server's resources, as `first-docs:///<path>`.

`query` and the write tools run as the trusted command line, like `first find`:
no access rules, drafts included. They are for a developer's own dev site:

- Without a flag, `query` reads this project's dev site and refuses any `site`.
  `first mcp --allow-remote-read` lets it read another site, named as `--site`
  names one: a project directory, a deployment workspace or a WP-CLI `@alias`.
- The write tools are not listed without `--allow-writes`. With it, `run_action`,
  `insert` and `update` run `first action`, `first insert` and `first update` on
  this project's dev site. They take no `site`, so they never reach another one.
- There is no delete tool.

A tool that runs a command (the compiler for `schema` and `check`, `first find`
and the other site commands) stops it after 120 seconds, or the number of
seconds in `FIRST_MCP_TIMEOUT`, and stops it when the client cancels the request.

The server speaks MCP revision 2026-07-28 (no handshake; `server/discover`) and,
for clients that open with `initialize`, 2025-11-25 and 2025-06-18.

## Use the running app: the site's MCP endpoint

Connect an agent to the same data and actions your frontend uses. First registers
them with WordPress's core Abilities API. The required MCP Adapter plugin exposes
them through an app-specific Streamable HTTP server.

### Find the endpoint and tools

For `defineConfig({ name: "subscriptions", ... })`, connect to:

```text
https://your-site.example/wp-json/mcp/first-subscriptions
```

Keep any WordPress subdirectory before `/wp-json`. The app name and resource
names become kebab-case. A config named `myTracker` uses `first-my-tracker`.

The runtime registers each enabled collection or table operation, and each
action, as an ability. The adapter replaces the slash in an ability name with a
hyphen in its MCP tool name:

| Config operation | Core ability | MCP tool |
|---|---|---|
| `subscriptions.list(...)` | `subscriptions/subscriptions-list` | `subscriptions-subscriptions-list` |
| `subscriptions.get(id)` | `subscriptions/subscriptions-get` | `subscriptions-subscriptions-get` |
| `subscriptions.create(data)` | `subscriptions/subscriptions-create` | `subscriptions-subscriptions-create` |
| `subscriptions.update(id, patch)` | `subscriptions/subscriptions-update` | `subscriptions-subscriptions-update` |
| `subscriptions.delete(id)` | `subscriptions/subscriptions-delete` | `subscriptions-subscriptions-delete` |
| `actions.monthlyBurn({})` | `subscriptions/monthly-burn` | `subscriptions-monthly-burn` |
| `actions.renewingSoon({ days: 3 })` | `subscriptions/renewing-soon` | `subscriptions-renewing-soon` |
| `actions.logCharge({ subscriptionId: 1 })` | `subscriptions/log-charge` | `subscriptions-log-charge` |
| `actions.cancel({ subscriptionId: 1 })` | `subscriptions/cancel` | `subscriptions-cancel` |

`charges` and `categories` have the same operation suffixes. List tools accept
filters, ordering, pagination, and declared relation loads. Update takes
`{ "id": 1, "patch": { "notes": "Review before renewal" } }`. List results
wrap rows in `{ "rows": [...] }`; action results have the handler's shape.
Always inspect `tools/list` for the actual input schema before calling a tool.

`api: { delete: false }` removes that operation. `agents: false` keeps the
underlying ability registered for PHP and WP-CLI, while hiding it from public
ability REST discovery and the app's MCP server. Globals also expose get and
update abilities. Jobs are exposed only when explicitly opted in with
`agents: true`; the subscriptions reminder is not an agent tool.

The app server lists named tools directly. The adapter's separate default
server has discovery and execution meta-tools; it is not the app endpoint above.

The owning code is
[`Register.php`](../runtime/First/Wp/Abilities/Register.php), which calls
`wp_register_ability()` and the adapter's `create_server()`, and
[`Invoke.php`](../runtime/First/Wp/Abilities/Invoke.php), which routes execution
through the app pipeline. Input schemas come from
[`JsonSchema.php`](../runtime/First/Wp/Abilities/JsonSchema.php).
Abilities use the same access rules, field permissions, hooks, and transactions
as REST. An application password authenticates a WordPress user; it does not
bypass that user's access. In the subscriptions app, owner filters also apply
to MCP reads and writes. Trusted action handlers explicitly filter by owner.

### Create an application password

An agent signs in with a WordPress application password. Create one for the
agent alone, scoped to what it needs:

```sh
first identity agent add editor --name=claims-agent
```

The password is printed once. A new agent credential is **read-only and has no
access to personal data**. Grant more explicitly, one flag at a time:

| Flag | Grants |
|---|---|
| `--write` | creates, updates, deletes and abilities that aren't `readonly` |
| `--personal` | email fields, fields with a read rule, and a user's own account details |
| `--abilities=blog/posts-list,blog/*` | only these abilities; no other route but the app's schema |

```sh
first identity agent list editor                         # every application password of editor, with its scope
first identity agent grant editor <id> --write           # replace the scope of one password
first identity agent revoke editor <id>
```

The same choices are on **Users → Profile → Application Passwords**: a password
created there is read-only with no personal data unless its *Allow writes* or
*Allow personal data* box is ticked, and the list shows each password's scope.

A scope only narrows. The user's role, each kind's access rules and its field
rules still decide first, so a subscriber's credential with `--write` writes
what a subscriber may. It is enforced wherever the app can be reached: the
abilities run route, the MCP server, `/__first/api/v1`, core's `/wp/v2` routes,
`/batch/v1` sub-requests, `?rest_route=` and method overrides. A scoped
credential can't read or change application passwords, so it can't widen
itself or mint another. `GET /__first/api/v1` reports the scope of the
credential asking, under `runtime.credential`.

A refusal is a 403 with the code `scope` (`first_scope` on core routes; a tool
error over MCP) and says which grant is missing. Without `personal`, emails and
restricted fields are left out of every row, user and comment, and a filter,
sort or search on one is a 403 rather than a quiet probe.

Application passwords made before First's flows, and any created by other
clients through WordPress's own API, have no scope and work exactly as
WordPress ships them. A scoped password signs in only where its scope is
enforced: with no First app active it is refused, never widened.

For a disposable local Studio site:

```sh
./target/debug/first --site examples/pantry identity agent add admin --name=agent-guide
```

The local site must be running. For another app, replace `examples/pantry` with
its project directory. Use `username:application-password` for HTTP Basic auth.
An application password is different from the WordPress login password and the
first-identity browser access token.

Build the Authorization header locally, without putting the password in shell
history:

```sh
read -r -s -p 'WordPress username:application-password: ' FIRST_APP_PASSWORD
printf '\n'
export FIRST_MCP_AUTH="Basic $(printf %s "$FIRST_APP_PASSWORD" | base64 | tr -d '\n')"
unset FIRST_APP_PASSWORD
```

This snippet uses Bash. Launch the agent from that shell to inherit
`FIRST_MCP_AUTH`. Keep credentials out of repository configuration and transcripts.

### Connect Claude Code

Put this in your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "first-subscriptions": {
      "type": "http",
      "url": "https://your-site.example/wp-json/mcp/first-subscriptions",
      "headers": {
        "Authorization": "${FIRST_MCP_AUTH}"
      }
    }
  }
}
```

Start Claude Code from the shell where you exported `FIRST_MCP_AUTH`. Open `/mcp`
to inspect the connection and available tools. Claude Code documents HTTP
servers, headers, and environment expansion in its
[MCP reference](https://code.claude.com/docs/en/mcp).

### Connect Claude Desktop

For a local stdio connection, install Node.js and add this entry to
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS.
On Windows, the file is `%APPDATA%\Claude\claude_desktop_config.json`.
Merge the entry into any existing `mcpServers` object.

```json
{
  "mcpServers": {
    "first-subscriptions": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-wordpress-remote@0.5.5"],
      "env": {
        "WP_API_URL": "https://your-site.example/wp-json/mcp/first-subscriptions",
        "WP_API_USERNAME": "YOUR_WORDPRESS_LOGIN",
        "WP_API_PASSWORD": "YOUR_APPLICATION_PASSWORD",
        "OAUTH_ENABLED": "false"
      }
    }
  }
}
```

Replace the uppercase values in this local file. Do not commit it. The
[WordPress remote proxy](https://www.npmjs.com/package/@automattic/mcp-wordpress-remote)
forwards stdio to the site's HTTP endpoint with Basic authentication. The
[MCP local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
describes Claude Desktop's configuration file and server loading.
Reload Claude Desktop after saving the configuration.

### Connect Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.first-subscriptions]
url = "https://your-site.example/wp-json/mcp/first-subscriptions"
env_http_headers = { Authorization = "FIRST_MCP_AUTH" }
```

Launch Codex from the shell where you exported `FIRST_MCP_AUTH`. This sends the
complete Basic header. `bearer_token_env_var` is for Bearer tokens and does not
encode an application password. See the official
[Codex MCP documentation](https://developers.openai.com/codex/mcp).

## Read pages as Markdown

While a First app is active, every public URL WordPress renders also has a
Markdown version at the same address plus `.md`:

| HTML URL | Markdown URL |
|---|---|
| `/hello-world/` | `/hello-world.md` |
| `/` | `/index.md` |
| `/category/news/?page=2` | `/category/news.md?page=2` |

- **Single posts and pages** show the title, then the stored content. Blocks
  Markdown can write come out as Markdown. Any other block comes out as the
  text, links and images of its rendered HTML. Raw HTML never comes through.
- **Archives, the blog index and search results** list each entry with a link
  to its own `.md` URL, plus links to the previous and next pages.
- **Only public content gets a Markdown URL.** Drafts, previews, private posts,
  feeds and First collections get a 404. A password-protected post shows only
  its title, even to a visitor who entered the password.
- **The `.md` URL is its own URL, the same for every visitor.** It is rendered
  as a signed-out visitor, even for a signed-in request. Page caches store it
  apart from the HTML.

Each HTML page links its Markdown version, so agents can find it:

```text
Link: <https://your-site.example/hello-world.md>; rel="alternate"; type="text/markdown"
<link rel="alternate" type="text/markdown" href="https://your-site.example/hello-world.md" />
```

On Spacefast, `Accept: text/markdown` on the HTML URL returns the same
Markdown. That response is never cached. Elsewhere, request the `.md` URL.

`/llms.txt` lists the site, then the newest 100 entries of each public post
type, and each public taxonomy's terms. Every entry links to its Markdown URL.

HTML pages, Markdown pages, `/llms.txt` and `robots.txt` send a
[Content-Signal](https://contentsignals.org/) of
`search=yes, ai-input=yes, ai-train=no`. To change it, filter
`first_content_signal` in a plugin; return `''` to send none:

```php
add_filter('first_content_signal', fn () => 'search=yes, ai-input=no, ai-train=no');
```

### Verify with a real site

The repository includes a protocol probe that initializes an MCP session, lists
tool names, and calls a list tool. It prints response bodies without credentials:

```sh
./target/debug/first dev examples/pantry --no-watch --port 8794
# Create an application password with the command above, then enter it privately.
read -r -s -p 'WordPress username:application-password: ' FIRST_APP_PASSWORD
printf '\n'
export FIRST_APP_PASSWORD
FIRST_SITE=http://localhost:8794 FIRST_APP=pantry \
  node examples/subscriptions/scripts/mcp-proof.mjs
unset FIRST_APP_PASSWORD
```

Pantry is used here because the subscriptions example currently encounters the
compiler diagnostic recorded in its [README](../examples/subscriptions/README.md).
That diagnostic prevents building or starting the subscriptions backend. The
proof below concerns the shipped MCP integration, not a running subscriptions app.
Client configuration keys above were checked against each client's linked
reference. Those interactive client applications were not launched in this proof.

Observed on a local WordPress Studio site rebuilt from main `ef0a42e3`, using
the MCP Adapter bundled by `first build`:

```jsonl
{"endpoint":"http://localhost:8794/wp-json/mcp/first-pantry"}
{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2025-11-25","capabilities":{"prompts":{"listChanged":false},"resources":{"subscribe":false,"listChanged":false},"tools":{"listChanged":false}},"serverInfo":{"name":"Pantry","version":"0.3.0"},"instructions":"First app pantry"}}
{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"pantry-locations-list"},{"name":"pantry-locations-get"},{"name":"pantry-locations-create"},{"name":"pantry-locations-update"},{"name":"pantry-locations-delete"},{"name":"pantry-items-list"},{"name":"pantry-items-get"},{"name":"pantry-items-create"},{"name":"pantry-items-update"},{"name":"pantry-items-delete"},{"name":"pantry-shopping-list-list"},{"name":"pantry-shopping-list-get"},{"name":"pantry-shopping-list-create"},{"name":"pantry-shopping-list-update"},{"name":"pantry-shopping-list-delete"},{"name":"pantry-consume"},{"name":"pantry-expiring-soon"},{"name":"pantry-media-list"},{"name":"pantry-media-get"},{"name":"pantry-media-delete"}]}}
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"rows\":[]}"}],"isError":false,"structuredContent":{"rows":[]}}}
```

The probe reduces `tools/list` to tool names for readability. The initialize
and call responses above are otherwise unmodified JSON-RPC responses.
