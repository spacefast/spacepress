# Use the notebook with an agent

Connect to `/wp-json/mcp/first-agents` using the agent user's WordPress application
password. This is First's MCP Adapter server, not EmDash's OAuth endpoint. Complete
`initialize`, retain `Mcp-Session-Id` and the negotiated protocol version, then
send `notifications/initialized`. Always call `tools/list` before constructing a
tool call: the installed config owns names, schemas and permissions.

This example exposes these tools (alongside the standard media read/delete tools):

| Task | Tool | Arguments |
| --- | --- | --- |
| Verify connectivity | `agents-echo` | `{ "message": "Hello" }` (1–200 characters) |
| Browse visible articles | `agents-articles-list` | `{ "limit": 10 }` |
| Read one article | `agents-articles-get` | `{ "id": 123 }` |
| Create a draft | `agents-articles-create` | `{ "title": "A draft", "status": "draft", "body": "<p>Text</p>" }` |
| Edit a draft | `agents-articles-update` | `{ "id": 123, "patch": { "title": "New title" } }` |
| Publish after user review | `agents-publish-article` | `{ "id": 123 }` |
| Delete an article | `agents-articles-delete` | `{ "id": 123 }` |
| Read notebook settings | `agents-global-settings-get` | `{}` |
| Update notebook settings | `agents-global-settings-update` | `{ "heading": "My notebook" }` |
| Queue the review marker | `agents-job-review` | `{ "articleId": 123 }` |

Pass `status: "draft"` explicitly when creating content. Draft first, show the proposed content, and obtain the user's publishing intent
before calling `agents-publish-article`. The `review` job marks an article as
reviewed; it does not generate prose, invoke AI, or certify editorial quality.
For deterministic local execution, run the real queue after enqueueing:

```sh
target/debug/first wp --site /absolute/path/to/notebook action-scheduler run --hooks=first_job
```

Editors and administrators can edit all articles. Subscribers can echo and read
published articles only. Anonymous visitors can read published articles and
public settings through REST but cannot initialize MCP. `internalNote` is masked
from public/subscriber reads, including MCP. The private notes table, private
settings and operator action opt out of agent discovery; they keep their own
admin-only canonical REST access. Jobs default to hidden; only `review` opts in.

Use this copyable command to complete an authenticated handshake and call echo.
`FIRST_AGENT_CREDENTIAL` is `username:application-password`, supplied from your
secret store. Do not paste it into tracked files or terminal history.

```sh
FIRST_AGENT_URL=http://localhost:8789 node --input-type=module <<'JS'
const url = process.env.FIRST_AGENT_URL + '/wp-json/mcp/first-agents';
if (!process.env.FIRST_AGENT_CREDENTIAL) throw new Error('Set FIRST_AGENT_CREDENTIAL from your secret store');
const headers = {
  authorization: 'Basic ' + Buffer.from(process.env.FIRST_AGENT_CREDENTIAL).toString('base64'),
  'content-type': 'application/json', accept: 'application/json, text/event-stream',
};
let id = 0;
async function rpc(method, params, notification = false) {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({
    jsonrpc: '2.0', ...(notification ? {} : { id: ++id }), method, params,
  }) });
  if (!response.ok) throw new Error(await response.text());
  if (notification) return;
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  if (method === 'initialize') {
    headers['mcp-session-id'] = response.headers.get('mcp-session-id');
    headers['mcp-protocol-version'] = body.result.protocolVersion;
  }
  return body.result;
}
await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'notebook', version: '1' } });
await rpc('notifications/initialized', {}, true);
console.log(await rpc('tools/list'));
console.log(await rpc('tools/call', { name: 'agents-echo', arguments: { message: 'Hello' } }));
JS
```

Canonical API successes use `{ data }`; failures are RFC 9457 problems. Core
Abilities use `/wp-json/wp-abilities/v1/abilities/agents/<ability>/run`, with
`{ "input": { ... } }` for writes, and WordPress error envelopes with `first_`
codes. MCP tool execution failures return `isError: true` and text content; do
not interpret HTTP 200 alone as success. Successful results use
`structuredContent`. A job enqueue result is a queue ID, not proof it ran.
