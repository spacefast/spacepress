import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL(".", import.meta.url));
const first = process.env.TP_BIN ?? fileURLToPath(new URL("../../target/debug/typedpress", import.meta.url));
const site = process.env.TP_SITE ?? "http://localhost:8896";
const wp = (...args) => execFileSync(first, ["wp", "--site", project, ...args], { encoding: "utf8" }).trim();
const password = (user) => wp("user", "application-password", "create", user, "home-maintenance-verification", "--porcelain").split("\n").at(-1);
const primary = "Basic " + Buffer.from("admin:" + password("admin")).toString("base64");
let otherId;
try { otherId = wp("user", "get", "maintenance-neighbor", "--field=ID"); }
catch { otherId = wp("user", "create", "maintenance-neighbor", "neighbor@example.test", "--role=administrator", "--porcelain"); }
const secondary = "Basic " + Buffer.from("maintenance-neighbor:" + password("maintenance-neighbor")).toString("base64");

async function request(path, { method = "GET", body, auth = primary, status = 200, headers = {} } = {}) {
  const response = await fetch(site + "/__tp/api/v1/" + path, {
    method, headers: { ...(auth ? { authorization: auth } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  console.log(JSON.stringify({ method, path, status: response.status, response: value }));
  return value.data;
}

const create = (path, body, options = {}) => request(path, { method: "POST", body, status: 201, ...options });
const call = (name, body, options = {}) => request("actions/" + name, { method: "POST", body, ...options });
const day = new Date().toISOString().slice(0, 10);
const year = Number(day.slice(0, 4));
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const system = await create("systems", { name: "Hallway heat pump", room: "Hallway", kind: "hvac", make: "Example", model: "Air 200", installedOn: "2024-06-15" });
const scratch = await create("systems", { name: "CRUD check", room: "Utility room", kind: "appliance" });
await request("systems/" + scratch.id, { method: "PATCH", body: { name: "CRUD updated" } });
await request("systems/" + scratch.id);
await request("systems/" + scratch.id, { method: "DELETE", status: 409 });
const task = await create("tasks", { systemId: system.id, title: "Wash heat pump filters", everyDays: 30, nextDueOn: yesterday, instructions: "<p>Switch off the unit. Rinse filters and dry before replacing.</p>" });
wp("action-scheduler", "run", "--hooks=tp_job", "--force");
const stamped = await request("tasks/" + task.id);
assert.ok(stamped.overdueAt, "Action Scheduler must stamp the overdue task");
const due = await call("dueNext", { days: 30 });
assert.ok(due.tasks.some((row) => row.id === task.id));
const marked = await call("markDone", { taskId: task.id, notes: "Cleaned both filters", costCents: 1599 }, { headers: { "Idempotency-Key": "maintenance-" + task.id } });
assert.equal(marked.task.lastDoneOn, day);
assert.equal(marked.task.overdueAt, null);
assert.equal(marked.task.nextDueOn, new Date(new Date(day + "T00:00:00Z").getTime() + 30 * 86400000).toISOString().slice(0, 10));
const replay = await call("markDone", { taskId: task.id, notes: "Cleaned both filters", costCents: 1599 }, { headers: { "Idempotency-Key": "maintenance-" + task.id } });
assert.equal(replay.log.id, marked.log.id);
await call("markDone", { taskId: task.id });
await create("done_logs", { taskId: task.id, doneOn: `${year - 1}-12-31`, costCents: 5000 });
const scratchLog = await create("done_logs", { taskId: task.id, notes: "CRUD check" });
await request("done_logs/" + scratchLog.id, { method: "PATCH", body: { notes: "CRUD updated" } });
await request("done_logs/" + scratchLog.id);
await request("done_logs/" + scratchLog.id, { method: "DELETE" });
await request("done_logs/" + scratchLog.id, { status: 404 });
const costs = await call("yearCost", { year });
assert.equal(costs.systems.find((row) => row.systemId === system.id).costCents, 1599);
const hidden = await request("systems", { auth: secondary });
assert.ok(!hidden.some((row) => row.id === system.id));
await request("systems/" + system.id, { auth: secondary, status: 404 });
await call("markDone", { taskId: task.id }, { auth: secondary, status: 404 });
await create("tasks", { systemId: system.id, title: "Forbidden foreign system", nextDueOn: day }, { auth: secondary, status: 404 });
await request("systems/" + system.id, { method: "PATCH", body: { ownerId: Number(otherId) }, status: 403 });
await call("dueNext", { days: 1 }, { auth: null, status: 401 });
await call("markDone", { taskId: task.id, costCents: -1 }, { status: 422 });
await create("tasks", { systemId: system.id, title: "Check smoke alarm", everyDays: 180, nextDueOn: day, instructions: "<p>Press the test button and replace the battery if needed.</p>" });

async function upload(path, bytes, type, name) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type }), name);
  const response = await fetch(site + "/__tp/api/v1/" + path, { method: "POST", headers: { authorization: primary }, body: form });
  const value = await response.json();
  if (path === "files/manuals" && response.status === 503 && value.code === "files_unavailable") {
    console.log(JSON.stringify({ method: "POST", path, status: response.status, response: value }));
    return null;
  }
  assert.equal(response.status, 201, JSON.stringify(value));
  console.log(JSON.stringify({ method: "POST", path, status: response.status, id: value.data.id }));
  return value.data;
}
const manual = await upload("files/manuals", "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF", "application/pdf", "heat-pump-manual.pdf");
if (manual) {
  await request("systems/" + system.id, { method: "PATCH", body: { manual: manual.id } });
  const manualResponse = await fetch(site + "/__tp/api/v1/files/manuals/" + manual.id, { headers: { authorization: primary } });
  assert.equal(manualResponse.status, 200);
  const readable = (await manualResponse.json()).data;
  assert.equal((await fetch(readable.url)).status, 200);
  console.log("Manual owner metadata and signed download: HTTP 200");
  await request("files/manuals/" + manual.id, { auth: secondary, status: 403 });
  await request("files/manuals/" + manual.id, { auth: null, status: 401 });
}
const photo = await upload("media", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"), "image/png", "clean-filter.png");
await request("done_logs/" + marked.log.id, { method: "PATCH", body: { photo: photo.id } });
const mcpUrl = site + "/wp-json/mcp/typedpress-home-maintenance";
let mcpHeaders = { authorization: primary, "content-type": "application/json", accept: "application/json, text/event-stream" };
const initialize = await fetch(mcpUrl, {
  method: "POST", headers: mcpHeaders,
  body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: {
    protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "home-maintenance-verification", version: "1" },
  } }),
});
const initialized = await initialize.json();
assert.equal(initialize.status, 200, JSON.stringify(initialized));
assert.ok(initialize.headers.get("mcp-session-id"));
mcpHeaders = { ...mcpHeaders, "mcp-session-id": initialize.headers.get("mcp-session-id"), "mcp-protocol-version": initialized.result.protocolVersion };
await fetch(mcpUrl, { method: "POST", headers: mcpHeaders, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
const mcp = await fetch(mcpUrl, { method: "POST", headers: mcpHeaders,
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
});
const discovered = await mcp.json();
assert.equal(mcp.status, 200, JSON.stringify(discovered));
const tools = discovered.result.tools.map((tool) => tool.name);
for (const name of ["home-maintenance-due-next", "home-maintenance-mark-done", "home-maintenance-year-cost", "home-maintenance-systems-list"]) assert.ok(tools.includes(name), name);
console.log(JSON.stringify({ method: "tools/list", path: "/wp-json/mcp/typedpress-home-maintenance", tools }));
const agentCall = await fetch(mcpUrl, { method: "POST", headers: mcpHeaders,
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "home-maintenance-due-next", arguments: { days: 30 } } }),
});
const agentResult = await agentCall.json();
assert.equal(agentResult.result.isError, false, JSON.stringify(agentResult));
console.log("MCP home-maintenance-due-next: HTTP 200, isError false");
console.log("Verified collection CRUD, every action, idempotency, UTC scheduling, year filters, Action Scheduler stamping, owner isolation including another administrator, photo media, and MCP discovery.");
console.log(manual ? "Private manual owner read and signed download verified." : "Private manual upload is blocked by Studio's files_unavailable protection; owner download remains unverified.");
