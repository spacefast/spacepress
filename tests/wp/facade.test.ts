// /__first/api/v1 (spec §3a): a thin facade over core routes. Every request is dispatched to the core
// route and only mapped, so it answers what First's rules answer: the same rows, the same denials,
// problem documents for errors. Each check compares with First's own pipeline (`wp first find`), core
// directly, or the values themselves.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { auth, core, harness, http, ok, qs, run, sql, wp, first, type Role } from "./env.ts";

const facade = `${harness.url}/__first/api/v1`;
const f = (method: string, path: string, opts: { as?: Role; body?: unknown } = {}) => http(method, facade + path, opts);
const strip = (row: any) => { const { createdAt, updatedAt, ...rest } = row; return rest; };

let eventIds: number[] = [];
before(async () => {
  eventIds = first("insert", "events", JSON.stringify([
    { title: `Fa ${run}`, seats: 5, kinds: ["talk"], extra: { a: {} } },
    { title: `Fb ${run}`, seats: 50, kinds: ["workshop"] },
    { title: `Fc ${run}`, seats: 500, kinds: [] },
  ])).map((r: any) => r.id);
});

test("lists are First rows with { data, cursor }, the same rows First's pipeline returns", async () => {
  const where = { id: { in: eventIds } };
  const page1 = await f("GET", "/events" + qs({ where, orderBy: "-seats", limit: "2" }));
  assert.equal(page1.status, 200, JSON.stringify(page1.json));
  const firstRows = first("find", "events", JSON.stringify({ where, orderBy: { seats: "desc" } }));
  assert.deepEqual(page1.json.data.map(strip), firstRows.slice(0, 2).map(strip));
  assert.equal(typeof page1.json.cursor, "string");
  const second = await f("GET", "/events" + qs({ where, orderBy: "-seats", limit: "2", cursor: page1.json.cursor }));
  assert.deepEqual([second.json.data.map((e: any) => e.title), second.json.cursor], [[`Fa ${run}`], null]);
  assert.deepEqual(second.json.data[0].extra, { a: {} }, "a json() value keeps {}");
  const skipped = await f("GET", "/events" + qs({ where, orderBy: "-seats", limit: "1", offset: "2" }));
  assert.deepEqual([skipped.json.data.map((e: any) => e.title), skipped.json.cursor], [[`Fa ${run}`], null], "offset skips rows, as the old namespace's did");
  assert.equal((await f("GET", "/events?offset=-1")).json.pointer, "/offset");
  const bad = await f("GET", "/events?cursor=nope");
  assert.deepEqual([bad.status, bad.type.startsWith("application/problem+json"), bad.json.code, bad.json.pointer], [400, true, "invalid_query", "/cursor"]);
});

test("items, slugs, writes and deletes map onto core and back", async () => {
  const item = await f("GET", `/events/${eventIds[1]}`);
  assert.deepEqual(strip(item.json.data), strip(first("find", "events", JSON.stringify({ where: { id: eventIds[1] } }))[0]));
  const created = await f("POST", "/events", { as: "editor", body: { title: `Fd ${run}`, seats: 7, day: "2026-05-01", kinds: ["social"] } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual([created.json.data.title, created.json.data.seats, created.json.data.day, created.json.data.status], [`Fd ${run}`, 7, "2026-05-01", "published"]);
  const id = created.json.data.id;
  const patched = await f("PATCH", `/events/${id}`, { as: "editor", body: { seats: 8, status: "draft" } });
  assert.deepEqual([patched.status, patched.json.data.seats, patched.json.data.status], [200, 8, "draft"]);
  assert.equal((await f("GET", `/events/${id}`)).status, 404, "an anonymous viewer can't read the draft");
  const bad = await f("PATCH", `/events/${id}`, { as: "editor", body: { day: "2026-02-30" } });
  assert.deepEqual([bad.status, bad.json.code, bad.json.pointer], [422, "invalid_input", "/day"]);
  // A client that sends only GET and POST (WordPress's api-fetch) overrides the method, as on core.
  const overridden = await fetch(`${facade}/events/${id}`, { method: "POST", headers: { ...auth("editor"), "content-type": "application/json", "x-http-method-override": "PATCH" }, body: JSON.stringify({ seats: 9 }) });
  assert.deepEqual([overridden.status, (await overridden.json()).data.seats], [200, 9]);
  const removed = await f("DELETE", `/events/${id}`, { as: "editor" });
  assert.deepEqual([removed.status, removed.json.data.id], [200, id]);
  assert.equal((await f("GET", `/events/${id}`, { as: "editor" })).status, 404);
  const post = first("insert", "posts", JSON.stringify({ title: `Facade slug ${run}`, body: "<!-- wp:paragraph --><p>Hello <strong>md</strong></p><!-- /wp:paragraph -->" }))[0];
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
  assert.deepEqual([schema.json.data.name, schema.json.data.kinds.events.route, schema.json.data.kinds.field_teams.route], ["blog", "/wp/v2/first_events", "/wp/v2/first_field_teams"]);
  assert.deepEqual([schema.json.data.actions.refsCount.readonly, schema.json.data.actions.refsCount.output.type], [true, "object"]);
});

test("actions run through their Ability: { data }, GET for readonly, the action's own access", async () => {
  const body = `Facade action ${run}`;
  const counted = await f("GET", "/actions/refsCount?" + new URLSearchParams({ input: JSON.stringify({ body }) }));
  assert.deepEqual([counted.status, counted.json.data.count], [200, 0]);
  const viaFacade = await f("POST", "/actions/refsEcho", { as: "editor", body: { meta: { a: {} } } });
  assert.deepEqual(viaFacade.json, { data: { meta: { a: {} } } }, "{ data }, {} kept");
  const denied = await f("POST", "/actions/refsEcho", { body: {} });
  assert.deepEqual([denied.status, denied.json.code], [401, "unauthenticated"]);
  const hidden = await f("POST", "/actions/agentNote", { as: "editor", body: { note: `n ${run}` } });
  assert.deepEqual([hidden.status, hidden.json.data.note], [200, `n ${run}`], "agents: false hides an action from agents, not from the app");
  const invalid = await f("POST", "/actions/agentNote", { as: "editor", body: {} });
  assert.deepEqual([invalid.status, invalid.json.code, invalid.json.pointer], [422, "invalid_input", "/note"]);
  assert.equal((await f("GET", "/actions/agentNote")).status, 405);
  assert.equal((await f("POST", "/actions/jobsInbound", { body: {} })).status, 401, "a signed webhook without its signature is refused (jobs.test.ts covers the signature)");
});

test("the facade denies what core denies", async () => {
  // A read rule that denies, a filtering read rule, a field mask, a filter on a hidden field.
  const vault = await f("GET", "/vault");
  assert.deepEqual([vault.status, vault.json.code], [401, "unauthenticated"]);
  assert.equal((await f("GET", "/vault", { as: "editor" })).status, 403);
  const payId = first("insert", "payroll", JSON.stringify({ title: `Facade pay ${run}`, salary: "1k" }))[0].id;
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

test("the users kind: rows as First reads them, writes through First's rules, creates and permanent deletes", async () => {
  const sub = harness.users.subscriber.id;
  // A member reads their own row whole (email, role) without list_users; another's is not theirs.
  const own = await f("GET", `/members/${sub}`, { as: "subscriber" });
  const trusted = first("find", "members", JSON.stringify({ where: { id: sub } }))[0];
  // The member's own row: every field `self` may read, a group whose sub-fields are all hidden kept an object.
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.deepEqual([own.json.data.email, own.json.data.role, own.json.data.name, own.json.data.notes], [trusted.email, "subscriber", trusted.name, {}]);
  assert.equal((await f("GET", `/members/${harness.users.admin.id}`, { as: "subscriber" })).status, 404);
  assert.deepEqual((await f("GET", "/members", { as: "subscriber" })).json.data.map((m: any) => m.id), [sub], "the list holds what `self` allows");
  // A PATCH of only core user fields still runs First's update: validation, field rules, hooks.
  const name = (await ok("GET", `/members/${sub}`, { as: "subscriber" })).name;
  const long = await f("PATCH", `/members/${sub}`, { as: "subscriber", body: { name: "x".repeat(81) } });
  assert.deepEqual([long.status, long.json.code, long.json.pointer], [422, "invalid_input", "/name"]);
  const email = await f("PATCH", `/members/${sub}`, { as: "subscriber", body: { email: `taken-${run}@example.test` } });
  assert.deepEqual([email.status, email.json.pointer], [403, "/email"], "a member changes their email where it is verified");
  assert.deepEqual(sql(`SELECT display_name, user_email FROM wp_users WHERE ID = ${sub}`)[0], { display_name: name, user_email: own.json.data.email }, "nothing changed");
  const renamed = await f("PATCH", `/members/${sub}`, { as: "subscriber", body: { name: `Renamed ${run}` } });
  assert.deepEqual([renamed.status, renamed.json.data.name], [200, `Renamed ${run}`], JSON.stringify(renamed.json));
  assert.deepEqual(first("find", "member_updates", JSON.stringify({ where: { memberId: sub, name: `Renamed ${run}` } })).length, 1, "the afterUpdate hook ran");
  first("update", "members", JSON.stringify({ id: sub }), JSON.stringify({ name }));
  const role = await f("PATCH", `/members/${sub}`, { as: "subscriber", body: { role: "admin" } });
  assert.equal(role.status, 403, JSON.stringify(role.json));
  // Create reaches First's insert (not core's "missing username/password"): the create rule, First's
  // password rule, and `self` reads keeping even an admin from setting a unique email it can't see
  // (this app's members can only be created by trusted code).
  const address = `facade-${run}@example.test`;
  const body = { email: address, name: `Created ${run}`, password: "a long password 1" };
  for (const [as, input, expected] of [
    ["editor", body, [403, "forbidden"]], // core's create_users refuses an editor first
    ["admin", { ...body, password: "short" }, [422, "invalid_input"]],
    ["admin", body, [403, "forbidden"]],
  ] as const) {
    const viaFacade = await f("POST", "/members", { as, body: input });
    assert.deepEqual([viaFacade.status, viaFacade.json.code], expected, `${as} ${JSON.stringify(input)}`);
  }
  assert.equal(wp("eval", `echo email_exists('${address}') ? 'created' : 'none';`), "none", "a refused create leaves no user");
  // A permanent delete (core refuses one without force), with First's delete rule.
  const id = first("insert", "members", JSON.stringify({ email: address, name: `Created ${run}`, plan: "pro" }))[0].id;
  assert.equal((await f("DELETE", `/members/${id}`, { as: "editor" })).status, 403, "the admin-only delete rule");
  const removed = await f("DELETE", `/members/${id}`, { as: "admin" });
  assert.deepEqual([removed.status, removed.json.data?.plan], [200, "pro"], JSON.stringify(removed.json));
  assert.equal(wp("eval", `echo get_userdata(${id}) ? 'kept' : 'gone';`), "gone");
});

test("markdown answers are private to their caller, like JSON ones", async () => {
  const post = first("insert", "posts", JSON.stringify({ title: `Private md ${run}`, body: "<p>x</p>" }))[0];
  for (const url of [`${facade}/posts/${post.id}?format=md`, `${facade}/posts/${post.id}`, `${facade}/nope`]) {
    const res = await fetch(url);
    assert.equal(res.headers.get("cache-control"), "private, no-store", url);
    assert.match(res.headers.get("vary") ?? "", /Cookie/, url);
  }
});

test("WordPress's own kinds answer through their core routes, in spec §2.1 shapes", async () => {
  // Core posts and pages: written and read through /wp/v2/posts and /wp/v2/pages, as core allows.
  const created = await f("POST", "/pages", { as: "editor", body: { title: `Facade page ${run}`, content: "<p>Page body</p>", order: 3 } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual([created.json.data.title, created.json.data.status, created.json.data.order, created.json.data.parent], [`Facade page ${run}`, "published", 3, null]);
  const page = created.json.data.id;
  assert.deepEqual((await f("GET", `/pages/${page}`)).json.data.id, page);
  assert.equal((await f("GET", `/pages/slug:${created.json.data.slug}`)).json.data.id, page);
  assert.equal((await f("POST", "/pages", { body: { title: "Anonymous" } })).status, 401, "core's create_posts decides");
  const md = await fetch(`${facade}/pages/${page}?format=md`);
  assert.equal(await md.text(), await (await fetch(`${core}/pages/${page}?format=md`)).text(), "one Markdown producer for the facade and core");
  assert.equal((await f("DELETE", `/pages/${page}`, { as: "editor" })).status, 200);
  assert.equal((await f("GET", `/pages/${page}`)).status, 404, "deleted for good, not trashed");

  // Comments on a core post: core's moderation and visibility, First's field names.
  // Terms and media: lists with { data, cursor }, core's rules. (This app's own `comments` and `posts`
  // kinds shadow the built-ins; the hardening lane, which has neither, covers built-in comments.)
  const categories = await f("GET", "/categories");
  assert.deepEqual([categories.status, Array.isArray(categories.json.data), "cursor" in categories.json], [200, true, true]);
  assert.ok(categories.json.data.every((c: any) => typeof c.name === "string" && typeof c.count === "number"), JSON.stringify(categories.json.data));
  assert.equal((await f("POST", "/categories", { as: "subscriber", body: { name: `No ${run}` } })).status, 403);
  const media = await f("GET", "/media" + qs({ limit: "1" }));
  assert.equal(media.status, 200, JSON.stringify(media.json));
});

test("menus: a menu in a theme location is public; its items are a tree", async () => {
  const label = `Facade home ${run}`;
  wp("eval", `$m = wp_create_nav_menu('Facade ${run}'); $p = wp_update_nav_menu_item($m, 0, ['menu-item-title' => '${label}', 'menu-item-url' => '/', 'menu-item-status' => 'publish']); wp_update_nav_menu_item($m, 0, ['menu-item-title' => 'Child', 'menu-item-url' => '/c/', 'menu-item-parent-id' => $p, 'menu-item-status' => 'publish']); set_theme_mod('nav_menu_locations', ['primary' => $m]); if (function_exists('PLL')) { $o = get_option('polylang'); foreach (pll_languages_list() as $l) { $o['nav_menus'][get_option('stylesheet')]['primary'][$l] = $m; } update_option('polylang', $o); }`);
  // (Polylang, active on this site for the locales lane, assigns a location's menu per language.)
  const primary = await f("GET", "/menus/primary");
  assert.equal(primary.status, 200, JSON.stringify(primary.json));
  assert.deepEqual(primary.json.data, { location: "primary", items: [{ label, url: "/", item: null, children: [{ label: "Child", url: "/c/", item: null, children: [] }] }] });
  assert.equal((await f("GET", "/menus/nowhere")).status, 404);
  assert.equal((await http("GET", `${core}/menu-locations`)).status, 401, "core's own menu routes stay closed to anonymous visitors");
});

test("globals run through their Abilities on core's run route: the global's own rules, { data }", async () => {
  const before = await f("GET", "/settings");
  const ran = JSON.parse(wp("first", "run", "blog/global-settings-get", "--user=admin")).data;
  assert.deepEqual(before.json.data, ran, "the app's `settings` global answers, as its Ability does, not the built-in");
  const tagline = `Facade global ${run}`;
  assert.equal((await f("PATCH", "/settings", { as: "subscriber", body: { tagline } })).status, 403);
  const set = await f("PATCH", "/settings", { as: "admin", body: { tagline } });
  assert.deepEqual([set.status, set.json.data.tagline], [200, tagline], JSON.stringify(set.json));
  assert.equal((await http("GET", `${harness.url}/wp-json/wp-abilities/v1/abilities/blog/global-settings-get/run`, { as: "admin" })).json.tagline, tagline);
  assert.equal((await f("DELETE", "/settings", { as: "admin" })).status, 405);
});

test("rows carry First's system fields and every locale, as First's pipeline gives them", async () => {
  const tour = first("insert", "tours", JSON.stringify({ title: `Facade tour ${run}`, price: 4 }))[0];
  const viaFacade = await f("GET", `/tours/${tour.id}`, { as: "editor" });
  assert.deepEqual(viaFacade.json.data, first("find", "tours", JSON.stringify({ where: { id: tour.id }, locale: "*" }))[0]);
  const both = await f("GET", "/tours" + qs({ locale: "*", where: { id: tour.id } }), { as: "editor" });
  assert.deepEqual(both.json.data.map((t: any) => [t.id, t.locale]), [[tour.id, "en"]]);
});

test("revisions: core's revisions of the post, First's snapshots, and a restore that is an update", async () => {
  const post = first("insert", "posts", JSON.stringify({ title: `Rev ${run}`, excerpt: "one" }))[0];
  await f("PATCH", `/posts/${post.id}`, { as: "editor", body: { excerpt: "two" } });
  const list = await f("GET", `/posts/${post.id}/revisions`, { as: "editor" });
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.ok(list.json.data.length >= 2 && list.json.data.every((r: any) => typeof r.id === "number" && typeof r.at === "string"), JSON.stringify(list.json));
  const oldest = list.json.data.at(-1).id;
  const at = await f("GET", `/posts/${post.id}/revisions/${oldest}`, { as: "editor" });
  assert.deepEqual([at.json.data.title, at.json.data.excerpt], [`Rev ${run}`, "one"], "the row as that revision saved it");
  const restored = await f("POST", `/posts/${post.id}/revisions/${oldest}/restore`, { as: "editor" });
  assert.deepEqual([restored.status, restored.json.data.excerpt], [200, at.json.data.excerpt], JSON.stringify(restored.json));
  // Denials: anonymous, a subscriber without the update rule, another post's revision, a missing row.
  assert.equal((await f("GET", `/posts/${post.id}/revisions`)).status, 404, "existence never leaks (§1.6)");
  assert.equal((await f("GET", `/posts/${post.id}/revisions`, { as: "subscriber" })).status, 404);
  const other = first("insert", "posts", JSON.stringify({ title: `Other ${run}` }))[0];
  const mismatch = await f("GET", `/posts/${other.id}/revisions/${oldest}`, { as: "editor" });
  assert.deepEqual([mismatch.status, mismatch.json.code], [404, "not_found"]);
  assert.equal((await f("GET", "/posts/999999999/revisions", { as: "editor" })).status, 404);
});

test("a kind's api flags switch its operations off on the API: 405 method_not_allowed", async () => {
  const row = first("insert", "notices", JSON.stringify({ title: `Notice ${run}` }))[0];
  assert.equal((await f("GET", "/notices" + qs({ where: { id: row.id } }))).json.data[0].title, `Notice ${run}`, "list stays on");
  assert.equal((await f("GET", `/notices/${row.id}`)).status, 200, "get stays on");
  for (const [method, path, body] of [["POST", "/notices", { title: "x" }], ["PATCH", `/notices/${row.id}`, { title: "y" }], ["DELETE", `/notices/${row.id}`, undefined], ["GET", `/notices/${row.id}/revisions`, undefined]] as const) {
    const r = await f(method, path, { as: "editor", body });
    assert.deepEqual([r.status, r.json.code], [405, "method_not_allowed"], `${method} ${path}`);
  }
  assert.equal(first("find", "notices", JSON.stringify({ where: { id: row.id } }))[0].title, `Notice ${run}`, "nothing was written");
});

test("a revisions list pages like every list: { data, cursor }, nothing dropped past a page", async () => {
  const post = first("insert", "posts", JSON.stringify({ title: `Many revs ${run}`, excerpt: "0" }))[0];
  for (let i = 1; i <= 4; i++) first("update", "posts", JSON.stringify({ id: post.id }), JSON.stringify({ excerpt: String(i) }));
  const all: number[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await f("GET", `/posts/${post.id}/revisions` + qs({ limit: "2", ...(cursor ? { cursor } : {}) }), { as: "editor" });
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.ok(page.json.data.length <= 2);
    all.push(...page.json.data.map((r: any) => r.id));
    cursor = page.json.cursor;
    pages++;
  } while (cursor !== null && pages < 10);
  assert.equal(all.length, 5, "one revision per write, every one reached through the cursor");
  assert.deepEqual([...all].sort((a, b) => b - a), all, "newest first");
  const whole = await f("GET", `/posts/${post.id}/revisions`, { as: "editor" });
  assert.deepEqual([whole.json.data.length, whole.json.cursor], [5, null], "one page holds them all under the default limit");
  assert.equal((await f("GET", `/posts/${post.id}/revisions` + qs({ cursor: "nonsense" }), { as: "editor" })).status, 400);
});
