# Client configuration for a site's MCP endpoint

The endpoint is `<site>/wp-json/mcp/typedpress-<app>`. Every client below sends the same
`Authorization` header, read from the environment.

## Create a scoped credential

On the site, as a user with the least role that works:

```sh
typedpress identity agent add editor --name=my-agent            # read-only, no personal data
typedpress identity agent add editor --name=my-agent --write    # may also create, update and delete
typedpress identity agent list editor
typedpress identity agent revoke editor <id>
```

The password is printed once. On a hosted site the same choices are on **Users → Profile →
Application Passwords**, over HTTPS. `--site <dir | @alias>` names another site. Use
`username:application-password` for HTTP Basic auth.

Build the Authorization header locally, without putting the password in shell
history:

```sh
printf 'WordPress username:application-password: '; stty -echo; read -r TP_APP_PASSWORD; stty echo; echo
export TP_MCP_AUTH="Basic $(printf %s "$TP_APP_PASSWORD" | base64 | tr -d '\n')"
unset TP_APP_PASSWORD
```

This works in bash, zsh and sh. Launch the agent from that shell to inherit
`TP_MCP_AUTH`. Keep credentials out of repository configuration and transcripts.

## Claude Code

Put this in your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "typedpress-my-app": {
      "type": "http",
      "url": "https://your-site.example/wp-json/mcp/typedpress-my-app",
      "headers": {
        "Authorization": "${TP_MCP_AUTH}"
      }
    }
  }
}
```

Start Claude Code from the shell where you exported `TP_MCP_AUTH`. Open `/mcp`
to inspect the connection and available tools. Claude Code documents HTTP
servers, headers, and environment expansion in its
[MCP reference](https://code.claude.com/docs/en/mcp).

## Claude Desktop

For a local stdio connection, install Node.js and add this entry to
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS.
On Windows, the file is `%APPDATA%\Claude\claude_desktop_config.json`.
Merge the entry into any existing `mcpServers` object.

```json
{
  "mcpServers": {
    "typedpress-my-app": {
      "command": "npx",
      "args": ["-y", "@automattic/mcp-wordpress-remote@0.5.5"],
      "env": {
        "WP_API_URL": "https://your-site.example/wp-json/mcp/typedpress-my-app",
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

## Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.typedpress-my-app]
url = "https://your-site.example/wp-json/mcp/typedpress-my-app"
env_http_headers = { Authorization = "TP_MCP_AUTH" }
```

Launch Codex from the shell where you exported `TP_MCP_AUTH`. This sends the
complete Basic header. `bearer_token_env_var` is for Bearer tokens and does not
encode an application password. See the official
[Codex MCP documentation](https://developers.openai.com/codex/mcp).
