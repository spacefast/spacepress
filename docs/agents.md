# Use your Zero app from an agent

Connect an agent to the same data and actions your frontend uses. Zero registers
them with WordPress's core Abilities API. The required MCP Adapter plugin exposes
them through an app-specific Streamable HTTP server.

## Find the endpoint and tools

For `defineConfig({ name: "subscriptions", ... })`, connect to:

```text
https://your-site.example/wp-json/mcp/zero-subscriptions
```

Keep any WordPress subdirectory before `/wp-json`. The app name and resource
names become kebab-case. A config named `myTracker` uses `zero-my-tracker`.

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
[`Register.php`](../runtime/Zero/Wp/Abilities/Register.php), which calls
`wp_register_ability()` and the adapter's `create_server()`, and
[`Invoke.php`](../runtime/Zero/Wp/Abilities/Invoke.php), which routes execution
through the app pipeline. Input schemas come from
[`JsonSchema.php`](../runtime/Zero/Wp/Abilities/JsonSchema.php).
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
./target/debug/zero wp --site examples/pantry user application-password create admin agent-guide --porcelain
```

The local site must be running. For another app, replace `examples/pantry` with
its project directory. Use `username:application-password` for HTTP Basic auth.
An application password is different from the WordPress login password and the
zero-identity browser access token. Revoke it from the same profile page when
it is no longer needed.

Build the Authorization header locally, without putting the password in shell
history:

```sh
read -r -s -p 'WordPress username:application-password: ' ZERO_APP_PASSWORD
printf '\n'
export ZERO_MCP_AUTH="Basic $(printf %s "$ZERO_APP_PASSWORD" | base64 | tr -d '\n')"
unset ZERO_APP_PASSWORD
```

This snippet uses Bash. Launch the agent from that shell to inherit
`ZERO_MCP_AUTH`. Keep credentials out of repository configuration and transcripts.

## Connect Claude Code

Put this in your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "zero-subscriptions": {
      "type": "http",
      "url": "https://your-site.example/wp-json/mcp/zero-subscriptions",
      "headers": {
        "Authorization": "${ZERO_MCP_AUTH}"
      }
    }
  }
}
```

Start Claude Code from the shell where you exported `ZERO_MCP_AUTH`. Open `/mcp`
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
    "zero-subscriptions": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-wordpress-remote@0.5.5"],
      "env": {
        "WP_API_URL": "https://your-site.example/wp-json/mcp/zero-subscriptions",
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
[mcp_servers.zero-subscriptions]
url = "https://your-site.example/wp-json/mcp/zero-subscriptions"
env_http_headers = { Authorization = "ZERO_MCP_AUTH" }
```

Launch Codex from the shell where you exported `ZERO_MCP_AUTH`. This sends the
complete Basic header. `bearer_token_env_var` is for Bearer tokens and does not
encode an application password. See the official
[Codex MCP documentation](https://developers.openai.com/codex/mcp).

## Verify with a real site

The repository includes a protocol probe that initializes an MCP session, lists
tool names, and calls a list tool. It prints response bodies without credentials:

```sh
./target/debug/zero dev examples/pantry --no-watch --port 8794
# Create an application password with the command above, then enter it privately.
read -r -s -p 'WordPress username:application-password: ' ZERO_APP_PASSWORD
printf '\n'
export ZERO_APP_PASSWORD
ZERO_SITE=http://localhost:8794 ZERO_APP=pantry \
  node examples/subscriptions/scripts/mcp-proof.mjs
unset ZERO_APP_PASSWORD
```

Pantry is used here because the subscriptions example currently encounters the
compiler diagnostic recorded in its [README](../examples/subscriptions/README.md).
That diagnostic prevents building or starting the subscriptions backend. The
proof below concerns the shipped MCP integration, not a running subscriptions app.
Client configuration keys above were checked against each client's linked
reference. Those interactive client applications were not launched in this proof.

Observed on a local WordPress Studio site rebuilt from main `ef0a42e3`, using
the MCP Adapter bundled by `zero build`:

```jsonl
{"endpoint":"http://localhost:8794/wp-json/mcp/zero-pantry"}
{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2025-11-25","capabilities":{"prompts":{"listChanged":false},"resources":{"subscribe":false,"listChanged":false},"tools":{"listChanged":false}},"serverInfo":{"name":"Pantry","version":"0.3.0"},"instructions":"Zero app pantry"}}
{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"pantry-locations-list"},{"name":"pantry-locations-get"},{"name":"pantry-locations-create"},{"name":"pantry-locations-update"},{"name":"pantry-locations-delete"},{"name":"pantry-items-list"},{"name":"pantry-items-get"},{"name":"pantry-items-create"},{"name":"pantry-items-update"},{"name":"pantry-items-delete"},{"name":"pantry-shopping-list-list"},{"name":"pantry-shopping-list-get"},{"name":"pantry-shopping-list-create"},{"name":"pantry-shopping-list-update"},{"name":"pantry-shopping-list-delete"},{"name":"pantry-consume"},{"name":"pantry-expiring-soon"},{"name":"pantry-media-list"},{"name":"pantry-media-get"},{"name":"pantry-media-delete"}]}}
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"rows\":[]}"}],"isError":false,"structuredContent":{"rows":[]}}}
```

The probe reduces `tools/list` to tool names for readability. The initialize
and call responses above are otherwise unmodified JSON-RPC responses.
