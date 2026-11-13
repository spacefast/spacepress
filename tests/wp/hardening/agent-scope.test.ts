// Scoped application passwords (docs/agents.md): an agent credential limited to reads, to a set of
// abilities, and away from personal data, on every route that reaches the app: First's API, core's
// REST routes, the abilities run route, the batch endpoint and MCP. A password with no scope keeps
// working exactly as WordPress ships it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { auth, core, harness, run, sql, wp, type Role } from "../env.ts";
import { loginCookie } from "../login.ts";

const site = harness.url;
const api = `${site}/__first/api/v1`;
const abilities = `${site}/wp-json/wp-abilities/v1/abilities`;
const app = "hardening-lane";

interface Scope {
  write?: boolean;
  personal?: boolean;
  abilities?: string[] | null;
}
/** A new application password for $role through `first identity agent add`, with the flags for $scope. */
function agent(role: Role, scope: Scope = {}): { header: Record<string, string>; id: string } {
  const flags = [scope.write ? "--write" : "", scope.personal ? "--personal" : "", scope.abilities ? `--abilities=${scope.abilities.join(",")}` : ""].filter(Boolean);
  const out = JSON.parse(wp("first", "identity", "agent", "add", role, `--name=agent-${run}-${Math.random().toString(36).slice(2)}`, ...flags)).data;
  return { header: { Authorization: "Basic " + btoa(`${role}:${out.password}`) }, id: out.id };
}
async function call(header: Record<string, string>, method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(url, { method, headers: { ...header, ...extra, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}
/** A refusal for the credential's scope, in the route's own error shape. */
function scoped(answer: { status: number; json: any }, what: string) {
  assert.equal(answer.status, 403, `${what}: ${JSON.stringify(answer.json).slice(0, 300)}`);
  assert.ok(["scope", "first_scope"].includes(answer.json.code), `${what}: ${JSON.stringify(answer.json).slice(0, 300)}`);
}
const notes = () => Number(sql(`SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'first_notes'`)[0].n);

test("a password created through First's flows is read-only with no personal data, and says so", async () => {
  const { header, id } = agent("editor");
  const listed = JSON.parse(wp("first", "identity", "agent", "list", "editor")).data.find((p: any) => p.id === id);
  assert.deepEqual(listed.scope, { write: false, personal: false, abilities: null });
  const schema = await call(header, "GET", api);
  assert.deepEqual(schema.json.data.runtime.credential, { scope: { write: false, personal: false, abilities: null } });
  // The harness's own passwords predate First's flows: unscoped, as WordPress ships them.
  const unscoped = await call(auth("editor"), "GET", api);
  assert.equal(unscoped.json.data.runtime.credential, undefined);
});

test("read-only: every write is refused on every route, reads work, and nothing is written", async () => {
  const { header } = agent("editor");
  const before = notes();
  assert.equal((await call(header, "GET", `${api}/notes`)).status, 200);
  assert.equal((await call(header, "GET", `${core}/first_notes`)).status, 200);
  assert.equal((await call(header, "GET", `${abilities}/${app}/notes-list/run`)).status, 200);
  assert.equal((await call(header, "GET", `${abilities}/${app}/count-notes/run`)).status, 200, "a readonly action runs");
  scoped(await call(header, "POST", `${api}/notes`, { title: "w" }), "facade create");
  scoped(await call(header, "POST", `${api}/actions/touchNotes`, {}), "facade action that writes");
  scoped(await call(header, "PATCH", `${api}/banner`, { motto: "w" }), "facade global update");
  scoped(await call(header, "POST", `${core}/first_notes`, { title: "w" }), "core create");
  scoped(await call(header, "POST", `${core}/posts`, { title: "w" }), "core post");
  scoped(await call(header, "POST", `${abilities}/${app}/notes-create/run`, { input: { title: "w" } }), "ability create");
  scoped(await call(header, "POST", `${abilities}/${app}/touch-notes/run`, { input: {} }), "ability that writes");
  // Request forms: rest_route, letter case and trailing slash, method overrides, batch.
  scoped(await call(header, "POST", `${site}/?rest_route=/wp/v2/first_notes`, { title: "w" }), "rest_route");
  scoped(await call(header, "POST", `${site}/wp-json/WP/V2/First_Notes/`, { title: "w" }), "case and slash");
  scoped(await call(header, "GET", `${core}/first_notes?_method=POST`, undefined), "?_method=POST on a GET");
  scoped(await call(header, "POST", `${api}/notes?_method=PATCH`, { title: "w" }), "facade ?_method=PATCH");
  scoped(await call(header, "POST", `${core}/first_notes`, { title: "w" }, { "X-HTTP-Method-Override": "PUT" }), "X-HTTP-Method-Override");
  const batch = await call(header, "POST", `${site}/wp-json/batch/v1`, { requests: [{ method: "POST", path: "/wp/v2/first_notes", body: { title: "w" } }] });
  assert.ok(batch.status === 403 || batch.json.responses?.every((r: any) => r.status === 403), JSON.stringify(batch.json).slice(0, 300));
  assert.equal(notes(), before, "no note was written");
});

test("read-only over MCP: read tools run, write tools are refused", async () => {
  const { header } = agent("editor");
  const url = `${site}/wp-json/mcp/first-${app}`;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", ...header };
  const rpc = (id: number, method: string, params: unknown) => fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  const init = await rpc(0, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "scope", version: "1" } });
  headers["mcp-session-id"] = init.headers.get("mcp-session-id") ?? "";
  headers["mcp-protocol-version"] = (await init.json()).result.protocolVersion;
  const read = await (await rpc(1, "tools/call", { name: `${app}-notes-list`, arguments: {} })).json();
  assert.equal(read.result.isError, false, JSON.stringify(read).slice(0, 300));
  const before = notes();
  const write = await (await rpc(2, "tools/call", { name: `${app}-notes-create`, arguments: { title: "mcp" } })).json();
  assert.equal(write.result.isError, true, JSON.stringify(write).slice(0, 300));
  assert.match(write.result.content[0].text, /read-only/);
  assert.equal(notes(), before);
});

test("--write grants writes, still within the user's own role", async () => {
  const editor = agent("editor", { write: true });
  const created = await call(editor.header, "POST", `${api}/notes`, { title: `scoped ${run}` });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const subscriber = agent("subscriber", { write: true });
  const refused = await call(subscriber.header, "POST", `${api}/notes`, { title: "no" });
  assert.equal(refused.status, 403, "a scope never adds to what the user may do");
  assert.equal(refused.json.code, "forbidden");
});

test("abilities: a credential limited to named abilities reaches those and nothing else", async () => {
  const { header } = agent("editor", { write: true, personal: true, abilities: [`${app}/notes-list`, `${app}/contacts-list`] });
  assert.equal((await call(header, "GET", `${abilities}/${app}/notes-list/run`)).status, 200);
  scoped(await call(header, "GET", `${abilities}/${app}/memos-list/run`), "an ability not listed");
  scoped(await call(header, "POST", `${abilities}/${app}/notes-create/run`, { input: { title: "x" } }), "a write not listed");
  assert.equal((await call(header, "GET", `${abilities}/${app}/contacts-list/run`)).status, 200, "a second listed ability");
  scoped(await call(header, "GET", `${core}/first_notes`), "a core route");
  scoped(await call(header, "GET", `${api}/notes`), "the API's kinds");
  assert.equal((await call(header, "GET", api)).status, 200, "the app's schema stays readable");
});

test("personal data: emails and fields with a read rule are withheld and can't be probed", async () => {
  wp("first", "insert", "contacts", JSON.stringify({ name: `Ada ${run}`, email: `ada-${run}@example.test`, salary: 100 }));
  const plain = agent("editor");
  const rows = (await call(plain.header, "GET", `${api}/contacts`)).json.data;
  const row = rows.find((r: any) => r.name === `Ada ${run}`);
  assert.ok(row, JSON.stringify(rows));
  assert.deepEqual([row.email, row.salary], [undefined, undefined], "withheld from the row");
  for (const where of [{ email: `ada-${run}@example.test` }, { salary: 100 }, { OR: [{ salary: 100 }] }]) {
    const probe = await call(plain.header, "GET", `${api}/contacts?where=${encodeURIComponent(JSON.stringify(where))}`);
    assert.equal(probe.status, 403, `filter ${JSON.stringify(where)}: ${JSON.stringify(probe.json)}`);
  }
  assert.equal((await call(plain.header, "GET", `${api}/contacts?orderBy=-salary`)).status, 403, "sort");
  // Users: what anyone sees, even for the user's own row and in edit context.
  const me = (await call(plain.header, "GET", `${core}/users/me?context=edit`)).json;
  assert.deepEqual([me.email, me.username, me.roles], [undefined, undefined, undefined]);
  // An administrator's credential lists users, but finds none by email; by name it still does.
  const admin = agent("admin");
  assert.deepEqual((await call(admin.header, "GET", `${core}/users?search=editor@example.test`)).json, [], "no user found by email");
  assert.equal((await call(admin.header, "GET", `${core}/users?search=Editor`)).json.length, 1, "found by name");
  scoped(await call(plain.header, "GET", `${core}/comments?search=example.test`), "comment search reads commenters' emails");
  // The same credential with --personal sees them; an unscoped one too.
  const personal = agent("editor", { personal: true });
  const full = (await call(personal.header, "GET", `${api}/contacts`)).json.data.find((r: any) => r.name === `Ada ${run}`);
  assert.deepEqual([full.email, full.salary], [`ada-${run}@example.test`, 100]);
  assert.equal((await call(personal.header, "GET", `${core}/users/me?context=edit`)).json.email, "editor@example.test");
  const unscoped = (await call(auth("editor"), "GET", `${api}/contacts`)).json.data.find((r: any) => r.name === `Ada ${run}`);
  assert.equal(unscoped.salary, 100);
  // A field rule still decides first: an author's credential with --personal doesn't see the salary.
  const author = agent("author", { personal: true });
  const authorRow = (await call(author.header, "GET", `${api}/contacts`)).json.data.find((r: any) => r.name === `Ada ${run}`);
  assert.equal(authorRow.salary, undefined);
});

test("a scoped credential can't read or change application passwords, so it can't widen itself", async () => {
  const { header, id } = agent("admin", { write: true, personal: true });
  scoped(await call(header, "GET", `${core}/users/me/application-passwords`), "list");
  scoped(await call(header, "POST", `${core}/users/me/application-passwords`, { name: "minted" }), "create");
  scoped(await call(header, "POST", `${core}/users/me/application-passwords/${id}`, { first_scope: { write: true, personal: true, abilities: null } }), "re-scope itself");
  scoped(await call(header, "GET", `${core}/users/me/application-passwords/introspect?_method=DELETE`), "delete through an override");
});

test("wp-admin's Application Passwords form creates a read-only password and offers the grants", async () => {
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  const profile = await (await fetch(`${site}/wp-admin/profile.php`, { headers: { cookie } })).text();
  assert.match(profile, /read-only/);
  assert.match(profile, /id="first-scope-write"/);
  assert.match(profile, /id="first-scope-personal"/);
  // What the form's script sends: core's REST route with the session's nonce.
  const nonce = profile.match(/wpApiSettings = \{[^}]*"nonce":"([a-f0-9]+)"/)?.[1] ?? assert.fail("no REST nonce on the profile screen");
  const create = (body: unknown) => fetch(`${core}/users/me/application-passwords`, { method: "POST", headers: { cookie, "x-wp-nonce": nonce, "content-type": "application/json" }, body: JSON.stringify(body) });
  const plain = await (await create({ name: `form-${run}` })).json();
  assert.deepEqual(plain.first_scope, { write: false, personal: false, abilities: null }, "without the grants: read-only");
  const granted = await (await create({ name: `form-w-${run}`, first_scope: { write: true, personal: false, abilities: null } })).json();
  assert.deepEqual(granted.first_scope, { write: true, personal: false, abilities: null });
  const list = await (await fetch(`${site}/wp-admin/profile.php`, { headers: { cookie } })).text();
  assert.match(list, /Read-only; no personal data/);
  assert.match(list, /Unscoped: everything the user can do/, "the harness's own passwords");
});

test("existing passwords keep working exactly as before; grant and revoke act on one password", async () => {
  // Unscoped: everything the editor can do, personal data included.
  const created = await call(auth("editor"), "POST", `${api}/notes`, { title: `unscoped ${run}` });
  assert.equal(created.status, 201);
  assert.equal((await call(auth("admin"), "GET", `${core}/users/me?context=edit`)).json.email, "admin@example.test");
  assert.equal((await call(auth("admin"), "GET", `${core}/users/me/application-passwords`)).status, 200);
  // Grant writes to a read-only password, then revoke it.
  const { header, id } = agent("editor");
  scoped(await call(header, "POST", `${api}/notes`, { title: "before" }), "before the grant");
  wp("first", "identity", "agent", "grant", "editor", id, "--write");
  assert.equal((await call(header, "POST", `${api}/notes`, { title: `granted ${run}` })).status, 201);
  wp("first", "identity", "agent", "revoke", "editor", id);
  assert.equal((await call(header, "GET", `${api}/notes`)).status, 401);
});

test("a scoped password signs in only where its scope is enforced", async () => {
  const { header } = agent("editor", { write: true });
  const xmlrpc = await fetch(`${site}/xmlrpc.php`, { method: "POST", headers: { ...header, "content-type": "text/xml" }, body: '<?xml version="1.0"?><methodCall><methodName>wp.getUsersBlogs</methodName></methodCall>' });
  assert.equal(xmlrpc.status, 403, "XML-RPC is off");
  wp("plugin", "deactivate", harness.plugin);
  try {
    const refused = await call(header, "GET", `${core}/posts`);
    assert.equal(refused.status, 403, JSON.stringify(refused.json));
    assert.equal(refused.json.code, "first_scope");
    assert.equal((await call(auth("editor"), "GET", `${core}/posts?context=edit`)).status, 200, "an unscoped password keeps working");
  } finally {
    wp("plugin", "activate", harness.plugin);
  }
  assert.equal((await call(header, "GET", `${core}/posts`)).status, 200);
});
