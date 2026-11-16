// Feature 5 (design §7.1) against real WordPress: every TypedPress operation is a core Ability, listed by
// core's /wp-abilities/v1 with schema.php-derived JSON Schemas, executed with the same answers REST
// gives each user, hidden from REST and MCP by `agents: false`, and reachable as named tools on the
// app's own MCP Adapter server through plain JSON-RPC over HTTP.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { api, auth, harness, http, ok, run, wp, wpTry, first, type Role } from "./env.ts";

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

/** The 2xx/4xx outcome a caller sees: TypedPress's problem code over REST, the ability's WP_Error code. */
const outcome = (r: { status: number; json: any }) => ({ status: r.status, code: r.status < 300 ? null : String(r.json.code).replace(/^tp_/, "") });

let postId = 0;
let eventId = 0;
before(() => {
  // A post the author doesn't own (authors.userId is someone else), so author update is filtered out.
  const [row] = first("insert", "posts", JSON.stringify({ title: `Ability post ${run}`, status: "published" }));
  postId = row.id;
  eventId = first("insert", "events", JSON.stringify({ title: `Ability event ${run}`, extra: { k: 1 } }))[0].id;
});

// The golden pins this lane's slice of the shared WP test app (the blog's entities plus
// lanes/abilities.ts), so other lanes' fragments add abilities without invalidating it.
const pinned = {
  collection: ["authors", "posts", "comments", "signups", "events", "media"],
  action: ["approveComment", "publishedCount", "agentNote"],
  global: ["settings"],
};
const isPinned = (a: any) => Object.entries(pinned).some(([kind, names]) => names.includes(a.meta.typedpress[kind]));

test("wp typedpress abilities lists every operation of the app with schemas from schema.php (golden)", () => {
  const listed = first("abilities").filter(isPinned);
  const fixture = join(here, "fixtures/abilities.json");
  const text = JSON.stringify(listed, null, 2) + "\n";
  if (process.env.TP_UPDATE_FIXTURES === "1") writeFileSync(fixture, text);
  const byName = (rows: { name: string }[]) => Object.fromEntries(rows.map(row => [row.name, row]));
  assert.deepEqual(byName(listed), byName(JSON.parse(readFileSync(fixture, "utf8"))), "tests/wp/fixtures/abilities.json is stale; rerun with TP_UPDATE_FIXTURES=1");
});

test("abilities convert empty input, JSON inputs and function-valued results at the wire", async () => {
  const empty = await runAbility("blog/refs-empty", {}, "editor");
  assert.deepEqual([empty.status, empty.json], [200, {}]);
  const wire = await runAbility("blog/refs-wire", {}, "editor");
  assert.deepEqual([wire.status, wire.json], [200, { a: [null, null] }]);
  const structuredInput = { meta: {}, info: {} };
  const structured = await runAbility("blog/refs-echo", structuredInput, "editor");
  const direct = await http("POST", api + "/actions/refsEcho", { as: "editor", body: structuredInput });
  assert.deepEqual([structured.status, structured.json], [200, direct.json.data]);
  assert.equal(direct.status, 200, JSON.stringify(direct.json));
  const groupId = first("insert", "gated", JSON.stringify({ title: `Ability group ${run}`, notes: { open: "old", sealed: "old" } }))[0].id;
  const groupPatch = await runAbility("blog/gated-update", { id: groupId, patch: { notes: {} } }, "admin");
  assert.deepEqual([groupPatch.status, groupPatch.json.notes], [200, { open: null, sealed: null }]);
  for (const items of [{}, { oops: { tag: "kept" } }]) {
    const invalid = { meta: {}, items };
    const viaAbility = await runAbility("blog/refs-echo", invalid, "editor");
    const viaRest = await http("POST", api + "/actions/refsEcho", { as: "editor", body: invalid });
    assert.deepEqual(outcome(viaAbility), { status: 422, code: "invalid_input" });
    assert.deepEqual(outcome(viaAbility), outcome(viaRest));
  }
  for (const meta of [{}, { "1": 1, "0": 2 }, { "\u0000": 1 }]) {
    const echo = await runAbility("blog/refs-echo", { meta }, "editor");
    assert.deepEqual([echo.status, echo.json], [200, { meta }]);
    assert.deepEqual(JSON.parse(wp("typedpress", "run", "blog/refs-echo", `--input=${JSON.stringify({ meta })}`, "--user=editor")).data, { meta });
    const row = await runAbility("blog/events-create", { title: `Wire ${run}`, extra: meta }, "editor");
    assert.deepEqual([row.status, row.json.extra], [200, meta]);
  }
});

test("core /wp-abilities/v1 lists the blog abilities with their JSON Schemas and annotations", async () => {
  // Every page: lanes keep adding collections to the shared test app, past one page of 100.
  const listed: any[] = [];
  for (let page = 1; ; page++) {
    const r = await http("GET", `${abilities}/abilities?category=blog&per_page=100&page=${page}`, { as: "subscriber" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    listed.push(...r.json);
    if (r.json.length < 100) break;
  }
  const byName = Object.fromEntries(listed.map((a: any) => [a.name, a]));
  const golden = JSON.parse(readFileSync(join(here, "fixtures/abilities.json"), "utf8"));
  // A subscriber's update rule covers no blog row, so the staged-version abilities aren't offered to
  // them (docs/staged.md); every other ability the golden shows in REST is.
  const staged = (a: any) => /^(stage|staged-)/.test(a.meta.typedpress.op);
  assert.deepEqual(Object.keys(byName).filter((n) => golden.some((a: any) => a.name === n)).sort(),
    golden.filter((a: any) => a.meta.show_in_rest && !staged(a)).map((a: any) => a.name).sort());

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
  // [ability, input, run method, REST method, REST path, REST body, the ability's effect when it succeeds]
  type Case = [string, unknown, "GET" | "POST" | "DELETE", string, string, unknown, (() => Promise<void>)?];
  const cases: Case[] = [
    ["blog/posts-update", { id: postId, patch: { excerpt: `by agent ${run}` } }, "POST", "PATCH", `/posts/${postId}`, { excerpt: `by rest ${run}` },
      async () => assert.equal((await ok("GET", `/posts/${postId}`, { as: "editor" })).excerpt, `by agent ${run}`)],
    ["blog/signups-list", { limit: 1 }, "GET", "GET", "/signups?limit=1", undefined],
    ["blog/global-settings-update", { tagline: `agents ${run}` }, "POST", "PATCH", "/settings", { tagline: `rest ${run}` },
      async () => assert.equal((await ok("GET", "/settings")).tagline, `agents ${run}`)],
    ["blog/approve-comment", { id: 999999999 }, "POST", "POST", "/actions/approveComment", { id: 999999999 }],
    // Non-editors may only reset a json() value to {}: the ability's check sees `{}` as REST does, and
    // the run stores `{}`, not `[]`.
    ["blog/events-update", { id: eventId, patch: { extra: {} } }, "POST", "PATCH", `/events/${eventId}`, { extra: {} },
      async () => assert.deepEqual((await ok("GET", `/events/${eventId}`)).extra, {})],
  ];
  const seen: Record<string, Record<Who, { status: number; code: string | null }>> = {};
  for (const [name, input, method, restMethod, restPath, restBody, effect] of cases) {
    for (const who of ["anonymous", "subscriber", "author", "editor"] as Who[]) {
      const viaAbility = outcome(await runAbility(name, input, who, method));
      // The ability's write is checked before REST writes, so REST can't stand in for it.
      if (viaAbility.status < 300) await effect?.();
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
  assert.deepEqual(seen["blog/events-update"].author, { status: 200, code: null });
});

test("list input typed by core over GET reaches TypedPress typed inside AND/OR/NOT", async () => {
  // GET input is a query string; core types it from the schema, one group level included.
  const where = { AND: [{ id: postId }], NOT: { id: { in: [0] } }, OR: [{ id: postId }] };
  const viaAbility = await runAbility("blog/posts-list", { where }, "editor", "GET");
  assert.equal(viaAbility.status, 200, JSON.stringify(viaAbility.json));
  assert.deepEqual(viaAbility.json.rows.map((r: any) => r.id), [postId]);
  const media = await runAbility("blog/media-list", { where: { id: { gt: 0 } }, orderBy: "-id", limit: 1 }, "editor", "GET");
  assert.equal(media.status, 200, JSON.stringify(media.json));
});

test("GET filters core can't type are refused; as JSON strings they match REST at any depth", async () => {
  // Bracketed, `false` in these places would arrive as the truthy string "false" and invert.
  const shapes = (op: string) => [
    ["where", { id: postId, AND: [{ AND: [{ cover: { [op]: false } }] }] }],
    ["where", { id: postId, AND: [{ authorId: { userId: { [op]: false } } }] }],
    ["with", { comments: { where: { body: { [op]: false } } } }],
  ] as const;
  // A query string core can't type as a whole stays all strings, the typed parts included.
  const half = await runAbility("blog/posts-list", { where: { cover: { isNull: false } }, limit: "many" }, "editor", "GET");
  assert.deepEqual([half.status, half.json.code, half.json.data?.pointer], [400, "tp_invalid_query", "/limit"]);
  const sorted = await runAbility("blog/posts-list", { where: { id: postId, cover: { isNull: true } }, orderBy: "-id" }, "editor", "GET");
  assert.deepEqual([sorted.status, sorted.json.rows?.map((r: any) => r.id)], [200, [postId]]);
  for (const op of ["isNull", "isNotNull"]) {
    for (const [key, value] of shapes(op)) {
      const input = { where: { id: postId }, [key]: value };
      const refused = await runAbility("blog/posts-list", input, "editor", "GET");
      assert.deepEqual([refused.status, refused.json.code, refused.json.data?.pointer], [400, "tp_invalid_query", `/${key}`], JSON.stringify(input));
      const asJson = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, JSON.stringify(v)]));
      const viaAbility = await runAbility("blog/posts-list", asJson, "editor", "GET");
      const viaRest = await ok("GET", `/posts?${new URLSearchParams(asJson)}`, { as: "editor" });
      assert.equal(viaAbility.status, 200, JSON.stringify(viaAbility.json));
      assert.deepEqual(viaAbility.json.rows, viaRest, JSON.stringify(input));
    }
  }
});

test("an ability create runs the pipeline and is visible through the API", async () => {
  const r = await runAbility("blog/posts-create", { title: `Audit agent ${run}` }, "author");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.slug, `audit-agent-${run}`);
  const viaRest = await ok("GET", `/posts/${r.json.id}?with=comments`, { as: "editor" });
  assert.deepEqual(viaRest.comments.map((c: any) => c.body), ["by Author"]);
});

test("invalid ability input is REST's 422 problem, untouched by core's coercion", async () => {
  // TypedPress validates, so the agent sees REST's code and pointer: unknown keys, wrong types and
  // numeric/boolean strings that core would otherwise coerce before TypedPress saw them.
  for (const input of [{ title: "x".repeat(121) }, { title: "ok", nope: 1 }, { title: 5 }, { title: "ok", authorId: "5" }, { title: "ok", seo: { noindex: "true" } }]) {
    const viaAbility = await runAbility("blog/posts-create", input, "author");
    const viaRest = await http("POST", `${api}/posts`, { as: "author", body: input });
    assert.equal(viaRest.status, 422, JSON.stringify(input));
    assert.deepEqual([viaAbility.status, viaAbility.json.code, viaAbility.json.data?.pointer], [422, "tp_invalid_input", viaRest.json.pointer], JSON.stringify(input));
  }
});

test("ability-only input keys are validated: the update patch and list sort directions", async () => {
  const noPatch = await runAbility("blog/posts-update", { id: postId, patch: '{"title":"x"}' }, "editor");
  assert.deepEqual([noPatch.status, noPatch.json.data?.pointer], [422, "/patch"]);
  const badOrder = await runAbility("blog/posts-list", { orderBy: { title: "sideways" } }, "editor", "GET");
  assert.deepEqual([badOrder.status, badOrder.json.data?.pointer], [400, "/orderBy/title"]);
});

test("agents: false hides an ability from core REST and MCP while wp typedpress run still executes it", async () => {
  const note = first("abilities").find((a: any) => a.name === "blog/agent-note");
  assert.deepEqual([note.meta.show_in_rest, note.meta.mcp.public], [false, false]);
  assert.equal((await http("GET", `${abilities}/abilities/blog/agent-note`, { as: "admin" })).status, 404);
  assert.equal((await runAbility("blog/agent-note", { note: "x" }, "admin")).status, 404);

  const ran = JSON.parse(wp("typedpress", "run", "blog/agent-note", `--input=${JSON.stringify({ note: `hidden ${run}` })}`, "--user=editor")).data;
  assert.deepEqual(ran, { note: `hidden ${run}`, seen: 0 });
  const denied = JSON.parse(wpTry("typedpress", "run", "blog/agent-note", `--input=${JSON.stringify({ note: "no" })}`, "--user=subscriber"));
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
});

test("an MCP write forbidden to a subscriber over REST is forbidden as a tool call", async () => {
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
  static readonly url = `${harness.url}/wp-json/mcp/typedpress-blog`;

  static async connect(who: Role): Promise<McpClient> {
    const headers = { ...auth(who), "content-type": "application/json", accept: "application/json, text/event-stream" };
    const res = await fetch(McpClient.url, { method: "POST", headers, body: JSON.stringify({
      jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "typedpress-tests", version: "1" } },
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

// Actions as Abilities (spec §3a): annotations from the action's options, the output schema from the
// handler's TypeScript return type, run through core's own /run route.
test("an action's options annotate its Ability, and its return type is the output schema", async () => {
  const byName: Record<string, any> = {};
  for (const name of ["blog/refs-count", "blog/refs-purge", "blog/approve-comment"]) {
    byName[name] = (await http("GET", `${abilities}/abilities/${name}`, { as: "admin" })).json;
  }
  const count = byName["blog/refs-count"];
  // Core lists all three annotations, null when unset.
  assert.deepEqual(count.meta.annotations, { readonly: true, destructive: null, idempotent: true });
  // A computed number may be NaN or Infinity, which the wire carries as null.
  assert.deepEqual(count.output_schema, {
    type: "object",
    properties: { body: { type: "string" }, count: { type: ["number", "null"] }, ids: { type: "array", items: { type: ["number", "null"] } } },
    required: ["body", "count", "ids"],
  });
  assert.deepEqual(byName["blog/refs-purge"].meta.annotations, { readonly: null, destructive: true, idempotent: true });
  assert.deepEqual(byName["blog/refs-purge"].output_schema, { type: ["number", "null"] });
  assert.deepEqual(byName["blog/approve-comment"].meta.annotations, { readonly: null, destructive: null, idempotent: null });
});

test("core's run route serves actions by their annotations: GET for readonly, DELETE for destructive", async () => {
  const body = `Purge me ${run}`;
  const post = await ok("POST", "/posts", { as: "editor", body: { title: `Abilities ${run}` } });
  const comment = await ok("POST", "/comments", { as: "editor", body: { postId: post.id, name: "A", body } });
  // A readonly action runs anonymously over GET (its own permission callback; `anyone`).
  const counted = await runAbility("blog/refs-count", { body }, "anonymous", "GET");
  assert.deepEqual([counted.status, counted.json], [200, { body, count: 1, ids: [comment.id] }]);
  const posted = await runAbility("blog/refs-count", { body }, "anonymous", "POST");
  assert.equal(posted.status, 405, "core refuses a readonly ability over POST");
  // Destructive + idempotent: DELETE, with the action's own access rule.
  assert.equal((await runAbility("blog/refs-purge", { body }, "subscriber", "DELETE")).status, 403);
  const purged = await runAbility("blog/refs-purge", { body }, "editor", "DELETE");
  assert.deepEqual([purged.status, purged.json], [200, 1]);
  assert.deepEqual((await runAbility("blog/refs-count", { body }, "anonymous", "GET")).json.count, 0);
  // Non-finite results are null on the wire and pass core's output validation; a literal beyond
  // 2^53 is the same number in the published enum as on the wire.
  const ratio = await runAbility("blog/refs-ratio", { n: 0 }, "anonymous", "GET");
  assert.deepEqual([ratio.status, ratio.json], [200, { ratio: null, big: 1e20, huge: 1 }], JSON.stringify(ratio.json));
  const inf = await runAbility("blog/refs-ratio", { n: 20 }, "anonymous", "GET");
  assert.deepEqual([inf.status, inf.json.ratio, inf.json.huge], [200, 1, null], JSON.stringify(inf.json));
  const schema = (await http("GET", `${abilities}/abilities/blog/refs-ratio`, { as: "admin" })).json.output_schema;
  assert.deepEqual(schema.properties.big, { type: "number", enum: [1e20] });
  // Errors are core's WP_Error JSON with TypedPress's code, status and pointer.
  const bad = await runAbility("blog/refs-count", {}, "anonymous", "GET");
  assert.deepEqual([bad.status, bad.json.code, bad.json.data?.pointer], [422, "tp_invalid_input", "/body"]);
});
