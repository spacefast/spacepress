// The optional admin plugin as `zero build` ships it (design §2.2, §2.5): the test app opts in with
// `admin: true`, so the artifact carries `zero-admin` and the harness activates it after the app.
// What this proves is the packaging: the plugin is active, serves its page under /zero-admin/ to
// signed-in users only, and the page loads the committed build rather than an empty shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { api, core, harness, http, ok, run, wp } from "./env.ts";

const site = harness.url;
const content = fileURLToPath(new URL("./.wp-content/", import.meta.url));

/** A WordPress login cookie for a harness user, as a browser would carry it. */
async function loginCookie(role: "editor" | "subscriber"): Promise<string> {
  const res = await fetch(`${site}/wp-login.php`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: "wordpress_test_cookie=WP%20Cookie%20check" },
    body: new URLSearchParams({ log: role, pwd: `zero-test-${role}`, testcookie: "1" }),
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  assert.ok(cookie.includes("wordpress_logged_in"), `${role} signed in: ${res.status}`);
  return cookie;
}

test("the built artifact ships zero-admin and the harness activated it after the app", () => {
  const manifest = JSON.parse(readFileSync(`${content}zero-manifest.json`, "utf8"));
  assert.equal(manifest.plugins["zero-admin"], manifest.zero, "the admin plugin is versioned with the compiler");
  const status = JSON.parse(wp("plugin", "list", "--format=json", "--fields=name,status,version"));
  const admin = status.find((p: any) => p.name === "zero-admin");
  assert.deepEqual([admin?.status, admin?.version], ["active", manifest.zero]);
  // Activation registered and persisted the one rewrite rule, so pretty URLs reach the app.
  assert.equal(wp("option", "get", "zero_admin_rewrite"), manifest.zero);
});

test("/zero-admin/ asks anonymous visitors to sign in and serves the committed build to users", async () => {
  const anon = await fetch(`${site}/zero-admin/`, { redirect: "manual" });
  assert.equal(anon.status, 302);
  assert.ok(anon.headers.get("location")!.startsWith(`${site}/wp-login.php?`), anon.headers.get("location")!);

  for (const role of ["editor", "subscriber"] as const) {
    const page = await fetch(`${site}/zero-admin/`, { headers: { cookie: await loginCookie(role) } });
    assert.equal(page.status, 200, `${role} is served the page`);
    const html = await page.text();
    assert.ok(html.includes('id="zero-admin-app"'), `${role} gets the app shell`);
    // The import map names the built boot module from the plugin's own build directory: the page
    // runs the committed bundle, not the pre-build shell.
    const importMap = html.match(/<script[^>]*type="importmap"[^>]*>(.*?)<\/script>/s);
    assert.ok(importMap, `${role}: the page carries an import map`);
    const imports = JSON.parse(importMap[1]).imports as Record<string, string>;
    assert.match(imports["@zero-admin/boot"], /\/plugins\/zero-admin\/build\/packages\/boot\/index\.js(\?|$)/);
  }
});

// ---------------------------------------------------------------------------------------------
// The screens on Zero's schema (design §4, §5, §7): what the page hands the app, and the exact
// requests the collection screens make, as the viewer who makes them. The rule semantics stay
// owned by core-access.test.ts; this proves the admin asks the right question and shows the answer.


/** The boot payload's context and menu, as the signed-in role. */
async function boot(role: "editor" | "subscriber" | "admin") {
  const page = await fetch(`${site}/zero-admin/`, { headers: { cookie: await loginCookie(role) } });
  assert.equal(page.status, 200, `${role} is served the page`);
  const html = await page.text();
  const m = html.match(/mod\.init\( (\[.*?\]), (\[.*?\]), (\[.*?\]), (\[.*?\]), (\{.*?\}) \)/s);
  assert.ok(m, "the page boots the app with its payload");
  const menu = JSON.parse(m[2]) as { id: string; to: string; label: string }[];
  const context = JSON.parse(m[5]) as { schema: any; permits: { collections: Record<string, boolean>; globals: Record<string, boolean> }; viewer: { id: number | null; role: string | null } };
  return { menu, context };
}

test("the boot payload carries the full schema, the viewer's permits, and a menu of only what the viewer may read", async () => {
  const editor = await boot("editor");
  assert.equal(editor.context.viewer.role, "editor");
  assert.ok(editor.context.schema.collections.vault, "the schema itself stays public: an admin-only collection is described");
  assert.equal(editor.context.permits.collections.vault, false, "but the editor may not read it");
  assert.equal(editor.context.permits.collections.posts, true);
  assert.equal(editor.context.permits.collections.ledger, true, "a per-row read rule may allow, so it is permitted");
  assert.equal(editor.context.permits.globals.settings, true);
  const zeroEntries = editor.menu.filter((i) => i.id.startsWith("zero-")).map((i) => i.to);
  assert.ok(zeroEntries.includes("/collections/posts"));
  assert.ok(zeroEntries.includes("/collections/ledger"));
  assert.ok(!zeroEntries.includes("/collections/vault"), "no menu entry for a collection the editor can never read");
  assert.ok(zeroEntries.includes("/globals/settings"));
  assert.ok(zeroEntries.includes("/media") && zeroEntries.includes("/legacy/index.php"));
  assert.equal(zeroEntries[0], "/", "the overview comes first");
  assert.ok(!editor.menu.some((i) => i.id.startsWith("legacy-") && /edit\.php\?post_type=zero_/.test(i.to)), "the app's wp-admin lists are not repeated as legacy entries");

  const subscriber = await boot("subscriber");
  assert.equal(subscriber.context.permits.collections.vault, false);
  assert.equal(subscriber.context.permits.collections.payroll, true, "anyone may read payroll");
  assert.equal(subscriber.context.permits.collections.jobNotes, false, "an editor-only table is not listed for a subscriber");
  assert.ok(!subscriber.menu.some((i) => i.to === "/collections/jobNotes"));

  const admin = await boot("admin");
  assert.equal(admin.context.permits.collections.vault, true);
  assert.ok(admin.menu.some((i) => i.to === "/collections/vault"));
});

test("the list screen's requests: a post-backed collection through core in the edit context, a table through /zero/v1 with where/orderBy/limit", async () => {
  // Post-backed: core /wp/v2/zero_<table> with context=edit, acf present, and the hidden field absent for the editor.
  const pay = await http("POST", `${core}/zero_payroll`, { as: "admin", body: { title: `Admin pay ${run}`, status: "publish", acf: { zero_salary: "120k" } } });
  assert.equal(pay.status, 201, JSON.stringify(pay.json));
  const listed = await http("GET", `${core}/zero_payroll?context=edit&per_page=20&page=1&status=draft,future,pending,private,publish&search=${run}`, { as: "editor" });
  assert.equal(listed.status, 200);
  const row = listed.json.find((p: any) => p.id === pay.json.id);
  assert.ok(row, "the editor lists the row");
  assert.equal(row.title.raw, `Admin pay ${run}`);
  assert.equal("zero_salary" in row.acf, false, "the admin-only column is absent from what the screen renders, not null");
  assert.equal(((await http("GET", `${core}/zero_payroll/${pay.json.id}?context=edit`, { as: "admin" })).json.acf).zero_salary, "120k");

  // Table: /zero/v1/<c> with the query the schema package builds.
  const a = await ok("POST", "/field_teams", { as: "editor", body: { name: `Alpha ${run}`, budget: 10 } });
  const b = await ok("POST", "/field_teams", { as: "editor", body: { name: `Beta ${run}`, budget: 20 } });
  const where = encodeURIComponent(JSON.stringify({ AND: [{ name: { like: `%${run}%` } }, { id: { gte: b.id } }] }));
  const rows = await ok("GET", `/field_teams?limit=20&offset=0&orderBy=-name&where=${where}`, { as: "editor" });
  assert.deepEqual(rows.map((r: any) => r.id), [b.id], "filters and the title search reach the server");
  assert.equal("budget" in rows[0], false, "a hidden column is absent from a table row too");
  assert.equal((await ok("GET", `/field_teams/${a.id}`, { as: "admin" })).budget, 10);
  // A filter on a column the viewer cannot read is refused with a pointer into the where tree.
  const hidden = encodeURIComponent(JSON.stringify({ budget: { gte: 15 } }));
  const refusedFilter = await http("GET", `${api}/field_teams?where=${hidden}`, { as: "editor" });
  assert.deepEqual([refusedFilter.status, refusedFilter.json.code, refusedFilter.json.pointer], [403, "forbidden", "/where/budget"]);
});

test("the edit screen's refusals: a 403 with Zero's code and a pointer at the field, and a create refused by the collection rule", async () => {
  const pay = await http("POST", `${core}/zero_payroll`, { as: "admin", body: { title: `Pointer ${run}`, status: "publish" } });
  assert.equal(pay.status, 201);
  // The screen patches `acf.zero_salary` for an editor: the runtime refuses the field, not the row.
  const refused = await http("POST", `${core}/zero_payroll/${pay.json.id}`, { as: "editor", body: { acf: { zero_salary: "1" } } });
  assert.equal(refused.status, 403, JSON.stringify(refused.json));
  assert.equal(refused.json.code, "forbidden");
  assert.equal(refused.json.data.pointer, "/salary", "the pointer names the field the form highlights");
  // The same shape on a table: a per-field update rule over /zero/v1.
  const team = await ok("POST", "/field_teams", { as: "editor", body: { name: `Team ${run}` } });
  const staff = await ok("POST", "/field_staff", { as: "editor", body: { name: `Staff ${run}`, teamId: team.id, kind: "pro" } });
  const denied = await http("PATCH", `${api}/field_staff/${staff.id}`, { as: "editor", body: { salary: 5 } });
  assert.deepEqual([denied.status, denied.json.code, denied.json.pointer], [403, "forbidden", "/salary"]);
  // The create button is greyed for an author on an admin-only collection, and the request would be refused anyway.
  const authorCreate = await http("POST", `${core}/zero_vault`, { as: "author", body: { title: "x", status: "publish" } });
  assert.equal(authorCreate.status, 403, "core refuses the create under Zero's rule before anything is written");
  // A global the viewer may read but not update: GET succeeds, PATCH is refused with Zero's code.
  assert.equal((await http("GET", `${api}/globals/settings`, { as: "subscriber" })).status, 200);
  const g = await http("PATCH", `${api}/globals/settings`, { as: "subscriber", body: { tagline: "nope" } });
  assert.deepEqual([g.status, g.json.code], [403, "forbidden"]);
});

test("the page boots the app with every collection route registered at its path", async () => {
  const page = await fetch(`${site}/zero-admin/`, { headers: { cookie: await loginCookie("editor") } });
  const html = await page.text();
  const m = html.match(/mod\.init\( (\[.*?\]), (\[.*?\]), (\[.*?\]), (\[.*?\]), (\{.*?\}) \)/s);
  assert.ok(m, "the page boots the app with its payload");
  const routes = JSON.parse(m[1]) as { path: string; content_module?: string }[];
  const paths = routes.map((r) => r.path).sort();
  for (const path of ["/", "/collections/$collection", "/collections/$collection/-/new", "/collections/$collection/$id", "/globals/$global", "/media", "/media/$id", "/legacy/$slug"]) {
    assert.ok(paths.includes(path), `route ${path} is registered (have ${paths.join(", ")})`);
  }
  // Each registered content module resolves in the import map to a script under the shipped plugin.
  const importMap = html.match(/<script[^>]*type="importmap"[^>]*>(.*?)<\/script>/s);
  assert.ok(importMap);
  const imports = JSON.parse(importMap[1]).imports as Record<string, string>;
  for (const route of routes) {
    if (route.content_module) {
      assert.match(imports[route.content_module] ?? "", /\/plugins\/zero-admin\/build\/routes\/[a-z-]+\/content\.js/, `${route.path} content module is in the import map`);
    }
  }
});
