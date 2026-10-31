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
async function adminSession(role: "editor" | "author" | "admin") {
  // post_type defaults to gated; callers may name another.
  const res = await fetch(`${harness.url}/wp-login.php`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: "wordpress_test_cookie=WP%20Cookie%20check" },
    body: new URLSearchParams({ log: role, pwd: `zero-test-${role}`, testcookie: "1" }),
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const get = (path: string) => fetch(`${harness.url}/wp-admin/${path}`, { headers: { cookie }, redirect: "manual" });
  const post = (path: string, fields: Record<string, string>) => fetch(`${harness.url}/wp-admin/${path}`, {
    method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields), redirect: "manual",
  });
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
  return { get, post, save };
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

test("a revision is stripped by its own snapshot, not by the live row", async () => {
  // The bonus is visible to the row's owner. Owned by someone else when revision 1 was taken, by the
  // author now: she may read today's bonus, not the one the earlier snapshot held.
  const id = zero("insert", "ledger", JSON.stringify({ title: `Bonus ${run}`, ownerId: author + 1, bonus: "then" }))[0].id;
  zero("update", "ledger", JSON.stringify({ id }), JSON.stringify({ ownerId: author, bonus: "now" }));
  const revs = await http("GET", `${core}/zero_ledger/${id}/revisions`, { as: "author" });
  assert.equal(revs.status, 200, JSON.stringify(revs.json));
  const bonuses = revs.json.map((r: any) => r.acf?.zero_bonus ?? "hidden").sort();
  assert.deepEqual(bonuses, ["hidden", "now"]);
  const editor = (await http("GET", `${core}/zero_ledger/${id}/revisions`, { as: "editor" })).json.map((r: any) => r.acf.zero_bonus).sort();
  assert.deepEqual(editor, ["now", "then"], "an editor reads both");
});

test("a trashed post fails closed: fields that may be hidden stay hidden", async () => {
  const id = zero("insert", "payroll", JSON.stringify({ title: `Trash ${run}`, salary: "77k" }))[0].id;
  assert.equal((await http("DELETE", `${core}/zero_payroll/${id}`, { as: "editor" })).status, 200);
  const trashed = await http("GET", `${core}/zero_payroll/${id}?context=edit`, { as: "editor" });
  assert.equal(trashed.status, 200, JSON.stringify(trashed.json));
  assert.deepEqual([trashed.json.title.raw, "zero_salary" in trashed.json.acf], [`Trash ${run}`, false]);
});

test("a hidden reference leaves no link to embed, on the row and on its revisions", async () => {
  const target = zero("insert", "ledger", JSON.stringify({ title: `Target ${run}`, ownerId: author }))[0].id;
  const id = zero("insert", "payroll", JSON.stringify({ title: `Managed ${run}`, managerId: target }))[0].id;
  await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { title: `Managed ${run} v2` } });
  const links = async (path: string, as?: "editor" | "admin") => JSON.stringify((await http("GET", `${core}/${path}`, { as })).json);
  assert.match(await links(`zero_payroll/${id}`, "admin"), /acf:post/, "the admin sees the reference's link");
  assert.doesNotMatch(await links(`zero_payroll/${id}?_embed=1`), /acf:post|Target /);
  assert.doesNotMatch(await links(`zero_payroll/${id}/revisions?_embed=1`, "editor"), /acf:post|Target /);
});

test("search and slug can't probe a column hidden from the viewer", async () => {
  zero("insert", "dossier", JSON.stringify({ title: `Dossier ${run}`, body: `<p>codeword-${run}</p>` }));
  const search = await http("GET", `${core}/zero_dossier?search=codeword-${run}`);
  assert.deepEqual([search.status, search.json.code], [403, "forbidden"]);
  assert.equal((await http("GET", `${core}/zero_dossier?search=Dossier%20${run}&search_columns=post_title`)).json.length, 1, "a title search is fine");
  assert.equal((await http("GET", `${core}/zero_dossier?slug=dossier-${run}`)).status, 403);
  assert.equal((await http("GET", `${core}/zero_dossier?search=codeword-${run}`, { as: "admin" })).json.length, 1);
  const item = (await http("GET", `${core}/zero_dossier?search=Dossier%20${run}&search_columns=post_title`)).json[0];
  assert.deepEqual(["content" in item, "slug" in item], [false, false], "content and slug are dropped from the item");
});

test("a field the viewer can't read refuses its unchanged value too, so no value can be probed", async () => {
  const id = zero("insert", "payroll", JSON.stringify({ title: `Probe ${run}`, salary: "55k" }))[0].id;
  const right = await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { acf: { zero_salary: "55k" } } });
  const wrong = await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { acf: { zero_salary: "nope" } } });
  assert.deepEqual([right.status, wrong.status, right.json.data?.pointer], [403, 403, "/salary"]);
});

test("a data-dependent update filter must match the row as it was: no taking over another's row", async () => {
  const theirs = zero("insert", "claims", JSON.stringify({ title: `Claim ${run}`, ownerId: author + 1000 }))[0].id;
  const mine = zero("insert", "claims", JSON.stringify({ title: `Mine ${run}`, ownerId: author }))[0].id;
  const takeover = await http("POST", `${core}/zero_claims/${theirs}`, { as: "author", body: { acf: { zero_ownerId: author } } });
  assert.equal(takeover.status, 403, JSON.stringify(takeover.json));
  assert.equal(zero("find", "claims", JSON.stringify({ where: { id: theirs } }))[0].ownerId, author + 1000);
  const own = await http("POST", `${core}/zero_claims/${mine}`, { as: "author", body: { title: `Mine ${run} edited` } });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.equal(wp("eval", `wp_set_current_user(${author}); var_export(current_user_can('edit_post', ${mine}));`), "false", "edit_post (revisions, wp-admin) stays strict");
});

test("wp-admin's Custom Fields box can't write a Zero column", async () => {
  const id = zero("insert", "payroll", JSON.stringify({ title: `Meta ${run}`, salary: "1" }))[0].id;
  const editor = await adminSession("editor");
  const res = await editor.save(id, { post_title: `Meta ${run}`, post_type: "zero_payroll", metakeyinput: "zero_salary", metavalue: "999" });
  assert.equal(res.status, 302, "the rest of the save goes through");
  assert.equal(zero("find", "payroll", JSON.stringify({ where: { id } }))[0].salary, "1", "the protected meta key was ignored");
});

test("the classic editor neither shows nor erases content hidden from the editor", async () => {
  const id = zero("insert", "dossier", JSON.stringify({ title: `Native ${run}`, body: `<p>classified-${run}</p>` }))[0].id;
  const editor = await adminSession("editor");
  const page = await editor.get(`post.php?post=${id}&action=edit&classic-editor`);
  assert.equal(page.status, 200);
  const form = await page.text();
  assert.ok(form.includes(`Native ${run}`), "the edit screen loaded the post");
  assert.equal(form.includes(`classified-${run}`), false, "the hidden content isn't in the page");
  const saved = await editor.save(id, { post_title: `Native ${run} retitled`, post_type: "zero_dossier", content: "" });
  assert.equal(saved.status, 302);
  const row = zero("find", "dossier", JSON.stringify({ where: { id } }))[0];
  assert.deepEqual([row.title, row.body], [`Native ${run} retitled`, `<p>classified-${run}</p>`], "the blank control left the stored content alone");
});

test("wp-admin's list search doesn't read content hidden from the viewer", async () => {
  zero("insert", "dossier", JSON.stringify({ title: `Listed ${run}`, body: `<p>listword-${run}</p>` }));
  const editor = await adminSession("editor");
  const byContent = await editor.get(`edit.php?post_type=zero_dossier&s=listword-${run}`);
  assert.equal(byContent.status, 200);
  assert.equal((await byContent.text()).includes(`Listed ${run}`), false);
  assert.ok((await (await editor.get(`edit.php?post_type=zero_dossier&s=Listed%20${run}`)).text()).includes(`Listed ${run}`), "a title search still finds it");
});

test("wp-admin's revision diffs leave out fields hidden from the viewer", async () => {
  const id = zero("insert", "payroll", JSON.stringify({ title: `Diff ${run}`, salary: "1k" }))[0].id;
  zero("update", "payroll", JSON.stringify({ id }), JSON.stringify({ salary: "2k", title: `Diff ${run} v2` }));
  const [older, newer] = JSON.parse(wp("eval", `echo wp_json_encode(array_keys(wp_get_post_revisions(${id}, ['order' => 'ASC'])));`));
  // The revisions screen loads its diffs through admin-ajax, the request SCF adds its field rows to.
  const diffs = async (role: "editor" | "admin") => {
    const session = await adminSession(role);
    const res = await session.post("admin-ajax.php", { action: "get-revision-diffs", post_id: String(id), "compare[]": `${older}:${newer}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true, JSON.stringify(body));
    return body.data[0].fields.map((f: any) => f.id);
  };
  assert.ok((await diffs("admin")).includes("zero_salary"), "the admin's diff compares the salary");
  const editor = await diffs("editor");
  assert.ok(editor.includes("post_title"));
  assert.deepEqual(editor.filter((f: string) => f.startsWith("zero_salary")), [], "the editor's doesn't");
});

test("autosaving one's own draft returns it without the fields hidden from the author of the save", async () => {
  const created = await http("POST", `${core}/zero_dossier`, { as: "editor", body: { title: `Draft ${run}`, status: "draft", content: `<p>draftword-${run}</p>` } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const autosaved = await http("POST", `${core}/zero_dossier/${created.json.id}/autosaves`, { as: "editor", body: { title: `Draft ${run} autosaved`, content: `<p>draftword-${run}</p>` } });
  assert.equal(autosaved.status, 200, JSON.stringify(autosaved.json));
  assert.equal(JSON.stringify(autosaved.json).includes(`draftword-${run}`), false);
});

test("a REST save inside an open transaction that fails after writing aborts the transaction", () => {
  const id = zero("insert", "payroll", JSON.stringify({ title: `Nested ${run}` }))[0].id;
  const out = JSON.parse(wp("eval", `
    add_action('rest_api_init', static fn () => register_rest_field('zero_payroll', 'zfail', ['update_callback' => static fn () => new WP_Error('nope', 'refused late', ['status' => 400]), 'schema' => ['type' => 'string']]));
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    $request = new WP_REST_Request('POST', '/wp/v2/zero_payroll/${id}');
    $request->set_body_params(['title' => 'Half done', 'zfail' => 'x']);
    try {
      \\Zero\\Wp\\Plugin::instance()->db()->transaction(static fn () => rest_do_request($request));
      $caught = null;
    } catch (Throwable $e) { $caught = $e->getMessage(); }
    clean_post_cache(${id});
    echo wp_json_encode([$caught, get_post(${id})->post_title]);
  `));
  assert.deepEqual(out, ["refused late", `Nested ${run}`]);
});

test("a save interrupted before Zero's after hooks run commits nothing", () => {
  // A wp_after_insert_post callback before Zero's (priority 20) throws and its caller catches it.
  const out = wp("eval", `
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    add_action('wp_after_insert_post', static function () { throw new RuntimeException('interrupted'); }, 10);
    try { wp_insert_post(['post_type' => 'zero_payroll', 'post_title' => 'Cut ${run}', 'post_status' => 'publish'], true); } catch (Throwable $e) {}
    \\Zero\\Wp\\EditorSave::shutdown();
    echo (int) (new WP_Query(['post_type' => 'zero_payroll', 'title' => 'Cut ${run}', 'post_status' => 'any', 'fields' => 'ids']))->found_posts;
  `);
  assert.equal(out, "0");
});
