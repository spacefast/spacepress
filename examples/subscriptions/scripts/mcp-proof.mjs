// Run against any built SpacePress app: SP_SITE, SP_APP, SP_APP_PASSWORD=user:password.
// It prints only public protocol responses, never request headers or credentials.
import assert from "node:assert/strict";

const site = process.env.SP_SITE ?? "http://localhost:8794";
const app = process.env.SP_APP ?? "subscriptions";
const credentials = process.env.SP_APP_PASSWORD;
assert.ok(credentials, "Set SP_APP_PASSWORD to username:application-password");
const url = `${site.replace(/\/$/, "")}/wp-json/mcp/spacepress-${app}`;
const headers = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
};
let id = 0;
async function rpc(method, params, notification = false) {
  const request = { jsonrpc: "2.0", ...(notification ? {} : { id: id++ }), method, ...(params === undefined ? {} : { params }) };
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(request) });
  const text = await response.text();
  assert.ok(response.ok, `${method}: HTTP ${response.status} ${text}`);
  if (notification) return;
  const body = JSON.parse(text);
  assert.ok(body.result, `${method}: ${text}`);
  if (method === "initialize") {
    headers["Mcp-Session-Id"] = response.headers.get("mcp-session-id");
    assert.ok(headers["Mcp-Session-Id"], "Initialize did not return a session ID");
    headers["Mcp-Protocol-Version"] = body.result.protocolVersion;
  }
  return body;
}
console.log(JSON.stringify({ endpoint: url }));
console.log(JSON.stringify(await rpc("initialize", {
  protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "spacepress-agent-guide", version: "1.0" },
})));
await rpc("notifications/initialized", undefined, true);
const tools = await rpc("tools/list", {});
console.log(JSON.stringify({ jsonrpc: tools.jsonrpc, id: tools.id, result: { tools: tools.result.tools.map(({ name }) => ({ name })) } }));
const name = process.env.SP_TOOL ?? `${app}-${app === "pantry" ? "locations" : "subscriptions"}-list`;
assert.ok(tools.result.tools.some((tool) => tool.name === name), `Tool ${name} was not listed`);
const result = await rpc("tools/call", { name, arguments: JSON.parse(process.env.SP_TOOL_INPUT ?? '{"limit":1}') });
assert.equal(result.result.isError, false, JSON.stringify(result));
console.log(JSON.stringify(result));
