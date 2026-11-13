# Use your First app from an agent

Connect an agent to the same data and actions your frontend uses. First registers
them with WordPress's core Abilities API. The required MCP Adapter plugin exposes
them through an app-specific Streamable HTTP server.

## Find the endpoint and tools

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

A `collection()` also has one tool per step of its [staged version](staged.md):
`<kind>-stage`, `<kind>-staged-get`, `<kind>-staged-compare`,
`<kind>-staged-promote`, `<kind>-staged-discard` and `<kind>-staged-preview`.
An agent can stage a change to a published item, read the comparison, and
leave the promote to a person, or to a credential that is allowed that tool.
`table()` kinds, such as the ones in this app, have none.

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

## Create an application password

On a hosted WordPress site, use HTTPS. Sign in to WordPress, open **Users →
Profile → Application Passwords**, and create a password for your agent. Use a
separate account with the role and data access the agent needs.

For a disposable local Studio site, create one with WP-CLI:

```sh
./target/debug/first wp --site examples/pantry user application-password create admin agent-guide --porcelain
```

The local site must be running. For another app, replace `examples/pantry` with
its project directory. Use `username:application-password` for HTTP Basic auth.
An application password is different from the WordPress login password and the
first-identity browser access token. Revoke it from the same profile page when
it is no longer needed.

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

## Connect Claude Code

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

## Connect Claude Desktop

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

## Connect Codex

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

## Verify with a real site

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
