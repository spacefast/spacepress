// Feature 5 (design §7.1) against real WordPress: every Zero operation is a core Ability, listed by
// core's /wp-abilities/v1 with schema.php-derived JSON Schemas, executed with the same answers REST
// gives each user, hidden from REST and MCP by `agents: false`, and reachable as named tools on the
// app's own MCP Adapter server through plain JSON-RPC over HTTP.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { api, auth, harness, http, ok, run, wp, wpTry, zero, type Role } from "./env.ts";

type Who = Role | "anonymous";
const here = dirname(fileURLToPath(import.meta.url));
const abilities = `${harness.url}/wp-json/wp-abilities/v1`;
const as = (who: Who) => (who === "anonymous" ? {} : { as: who });

/** Core's run endpoint: readonly abilities take GET with `input` as bracketed query params, others POST JSON. */
async function runAbility(name: string, input: unknown, who: Who, method: "GET" | "POST" | "DELETE" = "POST") {
  if (method === "POST") return http("POST", `${abilities}/abilities/${name}/run`, { ...as(who), body: { input } });
  const params = new URLSearchParams();
  const put = (prefix: string, v: unknown) => {
    if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) put(`${prefix}[${k}]`, x);
    else params.append(prefix, String(v));
  };
  if (input !== undefined) put("input", input);
  return http(method, `${abilities}/abilities/${name}/run?${params}`, as(who));
}

/** The 2xx/4xx outcome a caller sees: Zero's problem code over REST, the ability's WP_Error code. */
const outcome = (r: { status: number; json: any }) => ({ status: r.status, code: r.status < 300 ? null : String(r.json.code).replace(/^zero_/, "") });

let postId = 0;
before(() => {
  // A post the author doesn't own (authors.userId is someone else), so author update is filtered out.
  const [row] = zero("insert", "posts", JSON.stringify({ title: `Ability post ${run}`, status: "published" }));
  postId = row.id;
});

test("wp zero abilities lists every operation of the app with schemas from schema.php (golden)", () => {
  const listed = zero("abilities");
  const fixture = join(here, "fixtures/abilities.json");
  const text = JSON.stringify(listed, null, 2) + "\n";
  if (process.env.ZERO_UPDATE_FIXTURES === "1") writeFileSync(fixture, text);
  assert.equal(text, readFileSync(fixture, "utf8"), "tests/wp/fixtures/abilities.json is stale; rerun with ZERO_UPDATE_FIXTURES=1");
});

test("core /wp-abilities/v1 lists the blog abilities with their JSON Schemas and annotations", async () => {
  const r = await http("GET", `${abilities}/abilities?category=blog&per_page=100`, { as: "subscriber" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const byName = Object.fromEntries(r.json.map((a: any) => [a.name, a]));
  const golden = JSON.parse(readFileSync(join(here, "fixtures/abilities.json"), "utf8"));
  assert.deepEqual(Object.keys(byName).sort(), golden.filter((a: any) => a.meta.show_in_rest).map((a: any) => a.name).sort());

  const list = byName["blog/posts-list"];
  assert.equal(list.category, "blog");
  assert.deepEqual(list.meta.annotations, { readonly: true, destructive: null, idempotent: true });
  assert.deepEqual(list.input_schema.properties.where.properties.title.properties.like, { type: "string" });
  assert.deepEqual(list.output_schema.properties.rows.items.properties.tags, { type: "array", items: { type: "string", enum: ["news", "guide", "release"] }, uniqueItems: true });
  const create = byName["blog/posts-create"];
  assert.deepEqual(create.input_schema.required, ["title"]);
  assert.deepEqual(create.input_schema.properties.title, { type: "string", minLength: 1, maxLength: 120 });
  assert.equal(byName["blog/posts-delete"].meta.annotations.destructive, true);
  assert.deepEqual(byName["blog/approve-comment"].input_schema.required, ["id"]);
});

test("executing an ability answers each user exactly as REST does", async () => {
  // [ability, input, run method, the REST request it stands for]
  const cases: [string, unknown, "GET" | "POST" | "DELETE", string, string, unknown][] = [
    ["blog/posts-update", { id: postId, patch: { excerpt: `by agent ${run}` } }, "POST", "PATCH", `/posts/${postId}`, { excerpt: `by agent ${run}` }],
    ["blog/signups-list", { limit: 1 }, "GET", "GET", "/signups?limit=1", undefined],
    ["blog/global-settings-update", { tagline: `agents ${run}` }, "POST", "PATCH", "/globals/settings", { tagline: `agents ${run}` }],
    ["blog/approve-comment", { id: 999999999 }, "POST", "POST", "/actions/approveComment", { id: 999999999 }],
  ];
  const seen: Record<string, Record<Who, { status: number; code: string | null }>> = {};
  for (const [name, input, method, restMethod, restPath, restBody] of cases) {
    for (const who of ["anonymous", "subscriber", "author", "editor"] as Who[]) {
      const viaAbility = outcome(await runAbility(name, input, who, method));
      const viaRest = outcome(await http(restMethod, api + restPath, { ...as(who), body: restBody }));
      assert.deepEqual(viaAbility, viaRest, `${name} as ${who}`);
      (seen[name] ??= {} as any)[who] = viaAbility;
    }
  }
  // The cases cover allow, deny and filter answers, not just agreement.
  assert.deepEqual(seen["blog/posts-update"], {
    anonymous: { status: 404, code: "not_found" }, subscriber: { status: 404, code: "not_found" },
    author: { status: 404, code: "not_found" }, editor: { status: 200, code: null },
  });
  assert.deepEqual(seen["blog/signups-list"].anonymous, { status: 401, code: "unauthenticated" });
  assert.deepEqual(seen["blog/signups-list"].author, { status: 403, code: "forbidden" });
  assert.deepEqual(seen["blog/global-settings-update"].editor, { status: 200, code: null });
  assert.deepEqual(seen["blog/approve-comment"].editor, { status: 404, code: "not_found" });

  // Effects land in the app: the editor's ability writes are what /zero/v1 now reads.
  assert.equal((await ok("GET", `/posts/${postId}`, { as: "editor" })).excerpt, `by agent ${run}`);
  assert.equal((await ok("GET", "/globals/settings")).tagline, `agents ${run}`);
});

test("an ability create runs the pipeline and is visible in /zero/v1; bad input is REST's 422 problem", async () => {
  const r = await runAbility("blog/posts-create", { title: `Audit agent ${run}` }, "author");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.slug, `audit-agent-${run}`);
  const viaRest = await ok("GET", `/posts/${r.json.id}?with=comments`, { as: "editor" });
  assert.deepEqual(viaRest.comments.map((c: any) => c.body), ["by Author"]);
  // Zero validates, so the agent sees the same code and pointer REST returns, unknown keys included.
  for (const input of [{ title: "x".repeat(121) }, { title: "ok", nope: 1 }, { title: 5 }]) {
    const viaAbility = await runAbility("blog/posts-create", input, "author");
    const viaRest = await http("POST", `${api}/posts`, { as: "author", body: input });
    assert.equal(viaRest.status, 422);
    assert.deepEqual([viaAbility.status, viaAbility.json.code, viaAbility.json.data?.pointer], [422, "zero_invalid_input", viaRest.json.pointer]);
  }
});

test("agents: false hides an ability from core REST and MCP while wp zero run still executes it", async () => {
  const listed = zero("abilities");
  assert.deepEqual(listed.filter((a: any) => !a.meta.show_in_rest).map((a: any) => a.name), ["blog/agent-note"]);
  assert.equal((await http("GET", `${abilities}/abilities/blog/agent-note`, { as: "admin" })).status, 404);
  assert.equal((await runAbility("blog/agent-note", { note: "x" }, "admin")).status, 404);

  const ran = JSON.parse(wp("zero", "run", "blog/agent-note", `--input=${JSON.stringify({ note: `hidden ${run}` })}`, "--user=editor")).data;
  assert.deepEqual(ran, { note: `hidden ${run}`, seen: 0 });
  const denied = JSON.parse(wpTry("zero", "run", "blog/agent-note", `--input=${JSON.stringify({ note: "no" })}`, "--user=subscriber"));
  assert.deepEqual([denied.error.status, denied.error.code], [403, "forbidden"]);

  const mcp = await McpClient.connect("editor");
  const tools: string[] = (await mcp.call("tools/list")).tools.map((t: any) => t.name);
  assert.ok(tools.includes("blog-posts-list") && !tools.includes("blog-agent-note"), tools.join(","));
});

test("an MCP client lists the app's tools and calls one over plain JSON-RPC on HTTP", async () => {
  const editor = await McpClient.connect("editor");
  assert.equal(editor.server.serverInfo.name, "Blog");
  const tools = (await editor.call("tools/list")).tools;
  const list = tools.find((t: any) => t.name === "blog-posts-list");
  assert.ok(list, tools.map((t: any) => t.name).join(","));
  assert.equal(list.annotations.readOnlyHint, true);
  const rows = await editor.call("tools/call", { name: "blog-posts-list", arguments: { where: { id: postId } } });
  assert.equal(rows.isError, false, JSON.stringify(rows));
  assert.deepEqual(rows.structuredContent.rows.map((r: any) => r.id), [postId]);

  // A write forbidden to the subscriber over REST is forbidden over MCP too.
  const subscriber = await McpClient.connect("subscriber");
  const denied = await subscriber.call("tools/call", { name: "blog-posts-delete", arguments: { id: postId } });
  assert.equal(denied.isError, true, JSON.stringify(denied));
  assert.equal((await ok("GET", `/posts/${postId}`, { as: "editor" })).id, postId);
});

/** Streamable HTTP, protocol 2025-11-25: initialize → session id → requests on that session. */
class McpClient {
  private id = 0;
  private headers: Record<string, string>;
  readonly server: any;
  private constructor(headers: Record<string, string>, server: any) {
    this.headers = headers;
    this.server = server;
  }
  static readonly url = `${harness.url}/wp-json/mcp/zero-blog`;

  static async connect(who: Role): Promise<McpClient> {
    const headers = { ...auth(who), "content-type": "application/json", accept: "application/json, text/event-stream" };
    const res = await fetch(McpClient.url, { method: "POST", headers, body: JSON.stringify({
      jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "zero-tests", version: "1" } },
    }) });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    const session = res.headers.get("mcp-session-id");
    assert.ok(session, "initialize returns an Mcp-Session-Id");
    const client = new McpClient({ ...headers, "mcp-session-id": session, "mcp-protocol-version": body.result.protocolVersion }, body.result);
    await fetch(McpClient.url, { method: "POST", headers: client.headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    return client;
  }

  async call(method: string, params?: unknown): Promise<any> {
    const res = await fetch(McpClient.url, { method: "POST", headers: this.headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }) });
    const body = await res.json();
    assert.ok("result" in body, `${method}: ${JSON.stringify(body)}`);
    return body.result;
  }
}
