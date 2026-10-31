// Core /wp/v2/zero_* under Zero's access rules (lane R): the block editor keeps its REST routes, but
// they answer exactly what /zero/v1 would. Fixtures: tests/wp/app/lanes/rest.ts (vault: admin-only;
// ledger: owners read and edit their own rows; payroll: anyone reads, salary admin-only).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { core, harness, http, ok, run, wp, zero } from "./env.ts";

let vaultId: number;
let mine: number;
let theirs: number;
let payId: number;
const author = harness.users.author.id;

before(() => {
  vaultId = zero("insert", "vault", JSON.stringify({ title: `Vault ${run}`, code: "1234" }))[0].id;
  [mine, theirs] = zero("insert", "ledger", JSON.stringify([{ title: `Mine ${run}`, ownerId: author }, { title: `Theirs ${run}`, ownerId: author + 1000 }])).map((r: any) => r.id);
  payId = zero("insert", "payroll", JSON.stringify({ title: `Pay ${run}`, salary: "90k" }))[0].id;
});

const ids = (r: { json: any }) => r.json.map((p: any) => p.id).sort((a: number, b: number) => a - b);

test("reads answer the read rule: denied, filtered, or whole", async () => {
  const anonList = await http("GET", `${core}/zero_vault`);
  assert.deepEqual([anonList.status, anonList.json.code], [401, "unauthenticated"], "an admin-only collection is refused, not listed");
  assert.equal((await http("GET", `${core}/zero_vault/${vaultId}`)).status, 401);
  assert.equal((await http("GET", `${core}/zero_vault/${vaultId}`, { as: "editor" })).status, 403);
  const admin = await http("GET", `${core}/zero_vault/${vaultId}`, { as: "admin" });
  assert.deepEqual([admin.status, admin.json.acf.zero_code], [200, "1234"]);

  // A filtering rule: the author's list holds her row only, and the other row is 404 as on /zero/v1.
  const listed = await http("GET", `${core}/zero_ledger?per_page=100&search=${run}`, { as: "author" });
  assert.deepEqual([ids(listed), listed.type.startsWith("application/json")], [[mine], true]);
  assert.equal(Number((await fetch(`${core}/zero_ledger?search=${run}`, { headers: { Authorization: "Basic " + btoa(`author:${harness.users.author.appPassword}`) } })).headers.get("x-wp-total")), 1, "the total counts only her rows");
  assert.equal((await http("GET", `${core}/zero_ledger/${theirs}`, { as: "author" })).status, 404);
  assert.deepEqual(ids(await http("GET", `${core}/zero_ledger?per_page=100&search=${run}`, { as: "editor" })), [mine, theirs]);
});

test("every response drops the fields the viewer can't read", async () => {
  const anon = await http("GET", `${core}/zero_payroll/${payId}`);
  assert.equal(anon.status, 200);
  assert.deepEqual(Object.keys(anon.json.acf).filter((k) => k.startsWith("zero_salary")), [], "salary and its _source are gone");
  assert.equal(anon.json.title.rendered, `Pay ${run}`);
  const listed = (await http("GET", `${core}/zero_payroll?search=${run}`, { as: "editor" })).json[0];
  assert.equal("zero_salary" in listed.acf, false, "lists and the edit context too");
  assert.equal((await http("GET", `${core}/zero_payroll/${payId}?context=edit`, { as: "editor" })).json.acf.zero_salary, undefined);
  assert.equal((await http("GET", `${core}/zero_payroll/${payId}`, { as: "admin" })).json.acf.zero_salary, "90k");
});

test("writes need Zero's create/update rules, not role capabilities", async () => {
  const count = () => Number(wp("post", "list", "--post_type=zero_vault", "--post_status=any", "--format=count"));
  const before = count();
  const authorCreate = await http("POST", `${core}/zero_vault`, { as: "author", body: { title: "x", status: "publish" } });
  assert.equal(authorCreate.status, 403, JSON.stringify(authorCreate.json));
  assert.equal((await http("POST", `${core}/zero_vault/${vaultId}`, { as: "editor", body: { title: "y" } })).status, 403);
  assert.equal((await http("DELETE", `${core}/zero_vault/${vaultId}`, { as: "editor" })).status, 403);
  assert.equal(count(), before, "nothing was created");
  const adminCreate = await http("POST", `${core}/zero_vault`, { as: "admin", body: { title: `Admin ${run}`, status: "publish" } });
  assert.equal(adminCreate.status, 201, JSON.stringify(adminCreate.json));

  // An owner-filtered update rule: her row yes, another's no; a subscriber may not create at all.
  const own = await http("POST", `${core}/zero_ledger/${mine}`, { as: "author", body: { title: `Mine ${run} edited` } });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.equal((await http("POST", `${core}/zero_ledger/${theirs}`, { as: "author", body: { title: "stolen" } })).status, 403);
  assert.equal((await http("POST", `${core}/zero_ledger`, { as: "subscriber", body: { title: "s", status: "publish" } })).status, 403);
  assert.equal((await ok("GET", `/ledger/${mine}`, { as: "editor" })).title, `Mine ${run} edited`);
});

// ---- wp-admin and data-dependent rules (review of #38): every save is authorized on its own data
// before it commits, whichever path made it. `gated` (lanes/rest.ts): only an admin may set level
// "locked"; `notes.sealed` is admin-only.

/** A wp-admin session for $role: cookies, as the browser holds them after signing in. */
async function adminSession(role: "editor" | "author") {
  const res = await fetch(`${harness.url}/wp-login.php`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: "wordpress_test_cookie=WP%20Cookie%20check" },
    body: new URLSearchParams({ log: role, pwd: `zero-test-${role}`, testcookie: "1" }),
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const get = (path: string) => fetch(`${harness.url}/wp-admin/${path}`, { headers: { cookie }, redirect: "manual" });
  /** Submit post.php's classic edit form for $id with these fields, as the browser posts it. */
  const save = async (id: number, fields: Record<string, string>) => {
    const html = await (await get(`post.php?post=${id}&action=edit&classic-editor`)).text();
    const hidden = (name: string) => html.match(new RegExp(`name=["']${name.replace(/[[\]]/g, "\\$&")}["'][^>]*value=["']([^"']*)`))?.[1] ?? "";
    const body = new URLSearchParams({
      _wpnonce: hidden("_wpnonce"), _acf_nonce: hidden("_acf_nonce"), _acf_post_id: String(id), _acf_screen: "post",
      action: "editpost", post_ID: String(id), post_type: "zero_gated", post_status: "publish", ...fields,
    });
    return fetch(`${harness.url}/wp-admin/post.php`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body, redirect: "manual" });
  };
  return { get, save };
}

test("a data-dependent create rule decides on the request's data, not before it", async () => {
  const allowed = await http("POST", `${core}/zero_gated`, { as: "author", body: { title: `Open ${run}`, status: "publish", acf: { zero_level: "open" } } });
  assert.equal(allowed.status, 201, JSON.stringify(allowed.json));
  const refused = await http("POST", `${core}/zero_gated`, { as: "author", body: { title: `Locked ${run}`, status: "publish", acf: { zero_level: "locked" } } });
  assert.deepEqual([refused.status, refused.json.code], [403, "forbidden"]);
  assert.equal(wp("post", "list", "--post_type=zero_gated", "--post_status=any", `--title=Locked ${run}`, "--format=count"), "0", "the refused create left no post");
});

test("a wp-admin form save is refused when the collection rule refuses its data, and saves nothing", async () => {
  const id = zero("insert", "gated", JSON.stringify({ title: `Form ${run}`, level: "open" }))[0].id;
  const editor = await adminSession("editor");
  const refused = await editor.save(id, { post_title: `Form ${run}`, "acf[field_zero_gated_level]": "locked" });
  assert.equal(refused.status, 403);
  assert.equal(zero("find", "gated", JSON.stringify({ where: { id } }))[0].level, "open", "the refused save rolled back");
  const ok = await editor.save(id, { post_title: `Form ${run} edited`, "acf[field_zero_gated_level]": "open" });
  assert.equal(ok.status, 302, "an allowed save redirects back to the editor");
  assert.equal(zero("find", "gated", JSON.stringify({ where: { id } }))[0].title, `Form ${run} edited`);
});

test("nested field rules hold in wp-admin: the form hides the group, a save can't set the sub-field", async () => {
  const id = zero("insert", "gated", JSON.stringify({ title: `Nested ${run}`, notes: { open: "o", sealed: "s" } }))[0].id;
  const editor = await adminSession("editor");
  const form = await (await editor.get(`post.php?post=${id}&action=edit&classic-editor`)).text();
  assert.equal(form.includes("field_zero_gated_notes_sealed"), false, "the group holding a hidden sub-field isn't rendered");
  const res = await editor.save(id, { post_title: `Nested ${run}`, "acf[field_zero_gated_notes][field_zero_gated_notes_sealed]": "forged" });
  assert.equal(res.status, 403);
  assert.deepEqual(zero("find", "gated", JSON.stringify({ where: { id } }))[0].notes, { open: "o", sealed: "s" });
});

test("acf selector aliases can't smuggle a value past the field rules", async () => {
  const id = zero("insert", "payroll", JSON.stringify({ title: `Alias ${run}`, salary: "1" }))[0].id;
  const res = await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { acf: { zero_salary: "1", field_zero_payroll_salary: "999" } } });
  assert.equal(res.status, 403, JSON.stringify(res.json));
  assert.equal(zero("find", "payroll", JSON.stringify({ where: { id } }))[0].salary, "1");
});

test("Add New works for a user the create rule allows: the auto-draft opens and saves", async () => {
  const editor = await adminSession("author");
  const page = await editor.get("post-new.php?post_type=zero_ledger");
  assert.equal(page.status, 200);
  const draftId = Number((await page.text()).match(/name=["']post_ID["'][^>]*value=["'](\d+)/)?.[1]);
  const loaded = await http("GET", `${core}/zero_ledger/${draftId}?context=edit`, { as: "author" });
  assert.equal(loaded.status, 200, JSON.stringify(loaded.json));
  assert.equal((await http("GET", `${core}/zero_ledger/${draftId}?context=edit`, { as: "editor" })).status, 403, "the editor bootstrap is its author's, not anyone's");
  const saved = await http("POST", `${core}/zero_ledger/${draftId}`, { as: "author", body: { title: `New ${run}`, status: "publish", acf: { zero_ownerId: harness.users.author.id } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal((await ok("GET", `/ledger/${draftId}`, { as: "author" })).title, `New ${run}`);
});

test("trash, revisions, links and queries don't reveal what the live row hides", async () => {
  const id = zero("insert", "payroll", JSON.stringify({ title: `Trash ${run}`, salary: "77k", }))[0].id;
  await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { title: `Trash ${run} v2` } });
  const [rev] = (await http("GET", `${core}/zero_payroll/${id}/revisions`, { as: "editor" })).json;
  assert.equal(rev?.acf?.zero_salary, undefined, "a revision is stripped by its own snapshot");
  assert.equal((await http("DELETE", `${core}/zero_payroll/${id}`, { as: "editor" })).status, 200);
  const trashed = await http("GET", `${core}/zero_payroll/${id}?context=edit`, { as: "editor" });
  assert.equal(trashed.json.acf?.zero_salary, undefined, "a trashed post keeps its hidden fields hidden");
  const linked = await http("GET", `${core}/zero_payroll?search=${run}&context=edit`, { as: "editor" });
  assert.equal(JSON.stringify(linked.json).includes("acf:post"), false);
  const probe = await http("GET", `${core}/zero_field_staff?slug=x`);
  assert.equal(probe.status, 200, "a column readable to everyone filters normally");
});
