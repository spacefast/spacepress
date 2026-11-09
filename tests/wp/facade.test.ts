// /__zero/api/v1 (spec §3a): a thin facade over core routes. Every request is dispatched to the core
// route and only mapped, so it answers what Zero's rules answer: the same rows, the same denials,
// problem documents for errors. Each check compares with /wp-json/zero/v1 or core directly.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { api, auth, core, harness, http, ok, qs, run, sql, wp, zero, type Role } from "./env.ts";

const facade = `${harness.url}/__zero/api/v1`;
const f = (method: string, path: string, opts: { as?: Role; body?: unknown } = {}) => http(method, facade + path, opts);
const strip = (row: any) => { const { createdAt, updatedAt, ...rest } = row; return rest; };

let eventIds: number[] = [];
before(async () => {
  eventIds = zero("insert", "events", JSON.stringify([
    { title: `Fa ${run}`, seats: 5, kinds: ["talk"], extra: { a: {} } },
    { title: `Fb ${run}`, seats: 50, kinds: ["workshop"] },
    { title: `Fc ${run}`, seats: 500, kinds: [] },
  ])).map((r: any) => r.id);
});

test("lists are Zero rows with { data, cursor }, the same rows /zero/v1 returns", async () => {
  const where = { id: { in: eventIds } };
  const first = await f("GET", "/events" + qs({ where, orderBy: "-seats", limit: "2" }));
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const zeroRows = await ok("GET", "/events" + qs({ where, orderBy: "-seats" }));
  assert.deepEqual(first.json.data.map(strip), zeroRows.slice(0, 2).map(strip));
  assert.equal(typeof first.json.cursor, "string");
  const second = await f("GET", "/events" + qs({ where, orderBy: "-seats", limit: "2", cursor: first.json.cursor }));
  assert.deepEqual([second.json.data.map((e: any) => e.title), second.json.cursor], [[`Fa ${run}`], null]);
  assert.deepEqual(second.json.data[0].extra, { a: {} }, "a json() value keeps {}");
  const bad = await f("GET", "/events?cursor=nope");
  assert.deepEqual([bad.status, bad.type.startsWith("application/problem+json"), bad.json.code, bad.json.pointer], [400, true, "invalid_query", "/cursor"]);
});

test("items, slugs, writes and deletes map onto core and back", async () => {
  const item = await f("GET", `/events/${eventIds[1]}`);
  assert.deepEqual(strip(item.json.data), strip(await ok("GET", `/events/${eventIds[1]}`)));
  const created = await f("POST", "/events", { as: "editor", body: { title: `Fd ${run}`, seats: 7, day: "2026-05-01", kinds: ["social"] } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual([created.json.data.title, created.json.data.seats, created.json.data.day, created.json.data.status], [`Fd ${run}`, 7, "2026-05-01", "published"]);
  const id = created.json.data.id;
  const patched = await f("PATCH", `/events/${id}`, { as: "editor", body: { seats: 8, status: "draft" } });
  assert.deepEqual([patched.status, patched.json.data.seats, patched.json.data.status], [200, 8, "draft"]);
  assert.equal((await f("GET", `/events/${id}`)).status, 404, "an anonymous viewer can't read the draft");
  const bad = await f("PATCH", `/events/${id}`, { as: "editor", body: { day: "2026-02-30" } });
  assert.deepEqual([bad.status, bad.json.code, bad.json.pointer], [422, "invalid_input", "/day"]);
  const removed = await f("DELETE", `/events/${id}`, { as: "editor" });
  assert.deepEqual([removed.status, removed.json.data.id], [200, id]);
  assert.equal((await http("GET", `${api}/events/${id}`, { as: "editor" })).status, 404);
  const post = zero("insert", "posts", JSON.stringify({ title: `Facade slug ${run}`, body: "<!-- wp:paragraph --><p>Hello <strong>md</strong></p><!-- /wp:paragraph -->" }))[0];
  const bySlug = await f("GET", `/posts/slug:${post.slug}`);
  assert.equal(bySlug.json.data.id, post.id);
  const md = await fetch(`${facade}/posts/${post.id}?format=md`);
  assert.match(md.headers.get("content-type") ?? "", /^text\/markdown/);
  assert.match(await md.text(), new RegExp(`^# Facade slug ${run}\\n\\nHello \\*\\*md\\*\\*`));
});

test("tables, me and the schema", async () => {
  const team = await f("POST", "/field_teams", { as: "editor", body: { name: `Facade team ${run}`, budget: 3 } });
  assert.deepEqual([team.status, "budget" in team.json.data], [201, false]);
  assert.equal((await f("GET", `/field_teams/${team.json.data.id}`, { as: "admin" })).json.data.budget, 3);
  const me = await f("GET", "/me", { as: "subscriber" });
  assert.deepEqual([me.status, me.json.data.id, me.json.data.plan], [200, harness.users.subscriber.id, "free"]);
  assert.deepEqual((await f("GET", "/me")).json, { data: null });
  const schema = await f("GET", "");
  assert.equal(schema.status, 200);
  assert.deepEqual([schema.json.data.name, schema.json.data.kinds.events.route, schema.json.data.kinds.field_teams.route], ["blog", "/wp/v2/zero_events", "/wp/v2/zero_field_teams"]);
  assert.deepEqual([schema.json.data.actions.refsCount.readonly, schema.json.data.actions.refsCount.output.type], [true, "object"]);
});

test("actions run through their Ability: { data }, GET for readonly, the action's own access", async () => {
  const body = `Facade action ${run}`;
  const counted = await f("GET", "/actions/refsCount?" + new URLSearchParams({ input: JSON.stringify({ body }) }));
  assert.deepEqual([counted.status, counted.json.data.count], [200, 0]);
  const same = await http("POST", `${api}/actions/refsEcho`, { as: "editor", body: { meta: { a: {} } } });
  const viaFacade = await f("POST", "/actions/refsEcho", { as: "editor", body: { meta: { a: {} } } });
  assert.deepEqual(viaFacade.json, same.json, "the same { data } as /zero/v1, {} kept");
  const denied = await f("POST", "/actions/refsEcho", { body: {} });
  assert.deepEqual([denied.status, denied.json.code], [401, "unauthenticated"]);
  const hidden = await f("POST", "/actions/agentNote", { as: "editor", body: { note: `n ${run}` } });
  assert.deepEqual([hidden.status, hidden.json.data.note], [200, `n ${run}`], "agents: false hides an action from agents, not from the app");
  const invalid = await f("POST", "/actions/agentNote", { as: "editor", body: {} });
  assert.deepEqual([invalid.status, invalid.json.code, invalid.json.pointer], [422, "invalid_input", "/note"]);
  assert.equal((await f("GET", "/actions/agentNote")).status, 405);
  assert.equal((await f("POST", "/actions/jobsInbound", { body: {} })).status, 404, "a signed webhook isn't an action");
});

test("the facade denies what core and /zero/v1 deny", async () => {
  // A read rule that denies, a filtering read rule, a field mask, a filter on a hidden field.
  const vault = await f("GET", "/vault");
  assert.deepEqual([vault.status, vault.json.code], [401, "unauthenticated"]);
  assert.equal((await f("GET", "/vault", { as: "editor" })).status, 403);
  const payId = zero("insert", "payroll", JSON.stringify({ title: `Facade pay ${run}`, salary: "1k" }))[0].id;
  const pay = await f("GET", `/payroll/${payId}`, { as: "editor" });
  assert.deepEqual([pay.status, "salary" in pay.json.data], [200, false]);
  const probe = await f("GET", "/payroll" + qs({ where: { salary: "1k" } }), { as: "editor" });
  assert.deepEqual([probe.status, probe.json.code], [403, "forbidden"]);
  const write = await f("PATCH", `/payroll/${payId}`, { as: "editor", body: { salary: "2k" } });
  assert.deepEqual([write.status, write.json.pointer], [403, "/salary"]);
  // Application passwords and the cookie rules are core's: a cookie without a nonce is anonymous.
  assert.equal((await fetch(`${facade}/vault`, { headers: auth("admin") })).status, 200);
  // 0.8's paths are never the facade's.
  for (const path of ["/__zero/config", "/__zero/run", "/__zero/auth/session", "/__zero/realtime/events"]) {
    const res = await fetch(harness.url + path);
    assert.notEqual(res.headers.get("content-type"), "application/problem+json", path);
  }
});

test("the users kind: rows as Zero reads them, writes through Zero's rules, creates and permanent deletes", async () => {
  const sub = harness.users.subscriber.id;
  // A member reads their own row whole (email, role) without list_users; another's is not theirs.
  const own = await f("GET", `/members/${sub}`, { as: "subscriber" });
  const viaZero = await http("GET", `${api}/members/${sub}`, { as: "subscriber" });
  // The one encoder of core routes keeps a group whose sub-fields are all hidden an object ({}), where
  // /zero/v1's encoder gives [] for it; every other value is the same.
  assert.deepEqual([own.status, own.json.data], [200, { ...viaZero.json.data, notes: {} }], JSON.stringify(own.json));
  assert.deepEqual(viaZero.json.data.notes, []);
  assert.deepEqual([own.json.data.email, own.json.data.role], [viaZero.json.data.email, "subscriber"]);
  assert.equal((await f("GET", `/members/${harness.users.admin.id}`, { as: "subscriber" })).status, 404);
  assert.deepEqual((await f("GET", "/members", { as: "subscriber" })).json.data.map((m: any) => m.id), [sub], "the list holds what `self` allows");
  // A PATCH of only core user fields still runs Zero's update: validation, field rules, hooks.
  const name = (await ok("GET", `/members/${sub}`, { as: "subscriber" })).name;
  const long = await f("PATCH", `/members/${sub}`, { as: "subscriber", body: { name: "x".repeat(81) } });
  assert.deepEqual([long.status, long.json.code, long.json.pointer], [422, "invalid_input", "/name"]);
  const email = await f("PATCH", `/members/${sub}`, { as: "subscriber", body: { email: `taken-${run}@example.test` } });
  assert.deepEqual([email.status, email.json.pointer], [403, "/email"], "a member changes their email where it is verified");
  assert.deepEqual(sql(`SELECT display_name, user_email FROM wp_users WHERE ID = ${sub}`)[0], { display_name: name, user_email: own.json.data.email }, "nothing changed");
  const renamed = await f("PATCH", `/members/${sub}`, { as: "subscriber", body: { name: `Renamed ${run}` } });
  assert.deepEqual([renamed.status, renamed.json.data.name], [200, `Renamed ${run}`], JSON.stringify(renamed.json));
  assert.deepEqual(zero("find", "member_updates", JSON.stringify({ where: { memberId: sub, name: `Renamed ${run}` } })).length, 1, "the afterUpdate hook ran");
  zero("update", "members", JSON.stringify({ id: sub }), JSON.stringify({ name }));
  const role = await f("PATCH", `/members/${sub}`, { as: "subscriber", body: { role: "admin" } });
  assert.equal(role.status, 403, JSON.stringify(role.json));
  // Create reaches Zero's insert (not core's "missing username/password"): the same answers as /zero/v1
  // for the create rule, Zero's password rule, and `self` reads keeping even an admin from setting a
  // unique email it can't see (this app's members can only be created by trusted code).
  const address = `facade-${run}@example.test`;
  const body = { email: address, name: `Created ${run}`, password: "a long password 1" };
  for (const [as, input] of [["editor", body], ["admin", { ...body, password: "short" }], ["admin", body]] as const) {
    const viaFacade = await f("POST", "/members", { as, body: input });
    const direct = await http("POST", `${api}/members`, { as, body: input });
    // An editor lacks core's create_users, so core refuses first: the same status and code, no pointer.
    const answer = (r: any) => [r.status, r.json.code, as === "editor" ? undefined : r.json.pointer];
    assert.deepEqual(answer(viaFacade), answer(direct), `${as} ${JSON.stringify(input)}`);
    assert.ok(viaFacade.status >= 400, "the test app's create rules refuse these");
  }
  assert.equal(wp("eval", `echo email_exists('${address}') ? 'created' : 'none';`), "none", "a refused create leaves no user");
  // A permanent delete (core refuses one without force), with Zero's delete rule.
  const id = zero("insert", "members", JSON.stringify({ email: address, name: `Created ${run}`, plan: "pro" }))[0].id;
  assert.equal((await f("DELETE", `/members/${id}`, { as: "editor" })).status, 403, "the admin-only delete rule");
  const removed = await f("DELETE", `/members/${id}`, { as: "admin" });
  assert.deepEqual([removed.status, removed.json.data?.plan], [200, "pro"], JSON.stringify(removed.json));
  assert.equal(wp("eval", `echo get_userdata(${id}) ? 'kept' : 'gone';`), "gone");
});

test("markdown answers are private to their caller, like JSON ones", async () => {
  const post = zero("insert", "posts", JSON.stringify({ title: `Private md ${run}`, body: "<p>x</p>" }))[0];
  for (const url of [`${facade}/posts/${post.id}?format=md`, `${facade}/posts/${post.id}`, `${facade}/nope`]) {
    const res = await fetch(url);
    assert.equal(res.headers.get("cache-control"), "private, no-store", url);
    assert.match(res.headers.get("vary") ?? "", /Cookie/, url);
  }
});
