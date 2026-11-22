// Core /wp/v2/tp_* under TypedPress's access rules (lane R): the block editor keeps its REST routes, but
// they answer exactly what /wp-json/typedpress/v1 would. Fixtures: tests/wp/app/tp/lanes/rest.ts (vault: admin-only;
// ledger: owners read and edit their own rows; payroll: anyone reads, salary admin-only).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { api, core, harness, http, ok, run, sql, wp, first } from "./env.ts";

let vaultId: number;
let mine: number;
let theirs: number;
let payId: number;
const author = harness.users.author.id;

before(() => {
  vaultId = first("insert", "vault", JSON.stringify({ title: `Vault ${run}`, code: "1234" }))[0].id;
  [mine, theirs] = first("insert", "ledger", JSON.stringify([{ title: `Mine ${run}`, ownerId: author }, { title: `Theirs ${run}`, ownerId: author + 1000 }])).map((r: any) => r.id);
  payId = first("insert", "payroll", JSON.stringify({ title: `Pay ${run}`, salary: "90k" }))[0].id;
});

const ids = (r: { json: any }) => r.json.map((p: any) => p.id).sort((a: number, b: number) => a - b);

test("reads answer the read rule: denied, filtered, or whole", async () => {
  const anonList = await http("GET", `${core}/tp_vault`);
  assert.deepEqual([anonList.status, anonList.json.code], [401, "unauthenticated"], "an admin-only collection is refused, not listed");
  assert.equal((await http("GET", `${core}/tp_vault/${vaultId}`)).status, 401);
  assert.equal((await http("GET", `${core}/tp_vault/${vaultId}`, { as: "editor" })).status, 403);
  const admin = await http("GET", `${core}/tp_vault/${vaultId}`, { as: "admin" });
  assert.deepEqual([admin.status, admin.json.acf.tp_code], [200, "1234"]);

  // A filtering rule: the author's list holds her row only, and the other row is 404 as on /wp-json/typedpress/v1.
  const listed = await http("GET", `${core}/tp_ledger?per_page=100&search=${run}`, { as: "author" });
  assert.deepEqual([ids(listed), listed.type.startsWith("application/json")], [[mine], true]);
  assert.equal(Number((await fetch(`${core}/tp_ledger?search=${run}`, { headers: { Authorization: "Basic " + btoa(`author:${harness.users.author.appPassword}`) } })).headers.get("x-wp-total")), 1, "the total counts only her rows");
  assert.equal((await http("GET", `${core}/tp_ledger/${theirs}`, { as: "author" })).status, 404);
  assert.deepEqual(ids(await http("GET", `${core}/tp_ledger?per_page=100&search=${run}`, { as: "editor" })), [mine, theirs]);
});

test("every response drops the fields the viewer can't read", async () => {
  const anon = await http("GET", `${core}/tp_payroll/${payId}`);
  assert.equal(anon.status, 200);
  assert.deepEqual(Object.keys(anon.json.acf).filter((k) => k.startsWith("tp_salary")), [], "salary and its _source are gone");
  assert.equal(anon.json.title.rendered, `Pay ${run}`);
  const listed = (await http("GET", `${core}/tp_payroll?search=${run}`, { as: "editor" })).json[0];
  assert.equal("tp_salary" in listed.acf, false, "lists and the edit context too");
  assert.equal((await http("GET", `${core}/tp_payroll/${payId}?context=edit`, { as: "editor" })).json.acf.tp_salary, undefined);
  assert.equal((await http("GET", `${core}/tp_payroll/${payId}`, { as: "admin" })).json.acf.tp_salary, "90k");
});

test("writes need TypedPress's create/update rules, not role capabilities", async () => {
  const count = () => Number(wp("post", "list", "--post_type=tp_vault", "--post_status=any", "--format=count"));
  const before = count();
  const authorCreate = await http("POST", `${core}/tp_vault`, { as: "author", body: { title: "x", status: "publish" } });
  assert.equal(authorCreate.status, 403, JSON.stringify(authorCreate.json));
  assert.equal((await http("POST", `${core}/tp_vault/${vaultId}`, { as: "editor", body: { title: "y" } })).status, 403);
  assert.equal((await http("DELETE", `${core}/tp_vault/${vaultId}`, { as: "editor" })).status, 403);
  assert.equal(count(), before, "nothing was created");
  const adminCreate = await http("POST", `${core}/tp_vault`, { as: "admin", body: { title: `Admin ${run}`, status: "publish" } });
  assert.equal(adminCreate.status, 201, JSON.stringify(adminCreate.json));

  // An owner-filtered update rule: her row yes, another's no; a subscriber may not create at all.
  const own = await http("POST", `${core}/tp_ledger/${mine}`, { as: "author", body: { title: `Mine ${run} edited` } });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.equal((await http("POST", `${core}/tp_ledger/${theirs}`, { as: "author", body: { title: "stolen" } })).status, 403);
  assert.equal((await http("POST", `${core}/tp_ledger`, { as: "subscriber", body: { title: "s", status: "publish" } })).status, 403);
  assert.equal((await ok("GET", `/ledger/${mine}`, { as: "editor" })).title, `Mine ${run} edited`);
});

test("hidden fields need an explicit update rule, including nested fields", async () => {
  const id = first("insert", "payroll", JSON.stringify({ title: `Guarded ${run}`, salary: "secret", managerId: mine, notes: { open: "visible", sealed: "secret" }, entries: [{ open: "visible", sealed: "secret" }], policy: { gate: "locked", value: "old" }, writeOnly: "old" }))[0].id;
  const top = await http("PATCH", `${api}/payroll/${id}`, { as: "editor", body: { managerId: theirs } });
  assert.deepEqual([top.status, top.json.pointer], [403, "/managerId"]);
  const nested = await http("PATCH", `${api}/payroll/${id}`, { as: "editor", body: { notes: { sealed: "changed" } } });
  assert.deepEqual([nested.status, nested.json.pointer], [403, "/notes/sealed"]);
  const cleared = await http("PATCH", `${api}/payroll/${id}`, { as: "editor", body: { entries: [] } });
  assert.deepEqual([cleared.status, cleared.json.pointer], [403, "/entries/0"]);
  const emptyId = first("insert", "payroll", JSON.stringify({ title: `Empty ${run}` }))[0].id;
  const newNested = await http("PATCH", `${api}/payroll/${emptyId}`, { as: "editor", body: { notes: { sealed: "changed" } } });
  assert.deepEqual([newNested.status, newNested.json.pointer], [403, "/notes/sealed"]);
  const newItem = await http("PATCH", `${api}/payroll/${emptyId}`, { as: "editor", body: { entries: [{ sealed: "changed" }] } });
  assert.deepEqual([newItem.status, newItem.json.pointer], [403, "/entries/0/sealed"]);
  const newLayout = await http("PATCH", `${api}/payroll/${emptyId}`, { as: "editor", body: { sections: [{ layout: "private", sealed: "changed" }] } });
  assert.deepEqual([newLayout.status, newLayout.json.pointer], [403, "/sections/0/sealed"]);
  const coreNested = await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { acf: { tp_notes: { sealed: "changed" } } } });
  assert.deepEqual([coreNested.status, coreNested.json.data.pointer], [403, "/notes/sealed"]);
  const visible = await ok("PATCH", `/payroll/${id}`, { as: "editor", body: { notes: { open: "edited" }, writeOnly: "new" } });
  assert.deepEqual(visible.notes, { open: "edited" });
  assert.equal("writeOnly" in visible, false);
  const policy = await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { acf: { tp_policy: { value: "new" } } } });
  assert.deepEqual([policy.status, policy.json.data.pointer], [403, "/policy/value"], "the rule sees the saved sibling, even when it was omitted from the input");
  first("update", "payroll", JSON.stringify({ id: emptyId }), JSON.stringify({ notes: { open: "visible", sealed: null } }));
  const clearNull = await http("POST", `${core}/tp_payroll/${emptyId}`, { as: "editor", body: { acf: { tp_notes: null } } });
  const clearSecret = await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { acf: { tp_notes: null } } });
  assert.deepEqual([clearNull.status, clearNull.json.data.pointer, clearSecret.status, clearSecret.json.data.pointer], [403, "/notes", 403, "/notes"]);
  const coreVisible = await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { acf: { tp_notes: { open: "edited in core" } } } });
  assert.equal(coreVisible.status, 200, JSON.stringify(coreVisible.json));
  const stored = await ok("GET", `/payroll/${id}`, { as: "admin" });
  assert.deepEqual([stored.managerId, stored.notes, stored.writeOnly], [mine, { open: "edited in core", sealed: "secret" }, "new"]);

  // A second Db shares WordPress storage but owns different field policy. Both its read and write
  // must use that schema, then restore the booted app's Db even when the operation throws.
  const scoped = JSON.parse(wp("eval", `
    $app = \\TypedPress\\Wp\\Plugin::instance()->db();
    \\TypedPress\\Db::setInstance($app);
    $spec = $app->schema()->collection('payroll');
    $spec['columns']['title']['access']['read'] = ['allow' => false];
    eval('namespace TypedPressApp; function secondary_scope_rule($ctx) { return \\\\TypedPress\\\\db()->schema()->hasCollection("scope_marker"); } function secondary_scope_default() { return \\\\TypedPress\\\\db()->schema()->hasCollection("scope_marker") ? "secondary" : "booted"; }');
    $spec['access']['read'] = $spec['access']['update'] = ['fn' => 'secondary_scope_rule'];
    $settings = $app->schema()->global('settings');
    $settings['access'] = ['read' => ['fn' => 'secondary_scope_rule'], 'update' => ['fn' => 'secondary_scope_rule']];
    $schema = new \\TypedPress\\Schema(['collections' => ['payroll' => $spec, 'scope_marker' => $spec], 'globals' => [
      'settings' => $settings,
      'secondary_global' => ['fields' => ['name' => ['type' => 'text', 'default' => ['fn' => 'secondary_scope_default']]], 'access' => $settings['access'], 'wp' => ['postId' => 'tp_secondary_global', 'fieldKeyPrefix' => 'field_tp_secondary_global_']],
    ]]);
    $store = \\TypedPress\\Wp\\CompositeStore::create($schema, \\TypedPress\\Wp\\Plugin::instance()->connection());
    $db = new \\TypedPress\\Db($store, $schema, $app->media(), 'wp');
    $viewer = new \\TypedPress\\Viewer(['id' => 1, 'name' => 'Editor', 'role' => 'editor'], 'wp');
    $row = $db->findFirst('payroll', ['where' => ['id' => ${id}]], $viewer);
    try { $db->update('payroll', ['title' => 'overwritten'], ['id' => ${id}], true, $viewer); }
    catch (\\TypedPress\\HttpError $error) { $status = $error->status; }
    \\TypedPress\\Extensions::beforeRead(static function (string $collection, array &$opts): void {
      if ($collection === 'payroll' && !\\TypedPress\\db()->schema()->hasCollection('scope_marker')) throw new RuntimeException('wrong query Db');
    });
    $permissions = [$db->permits('payroll', 'read', ${id}, $viewer), $db->permittedKeys('payroll', 'update', $viewer)];
    $captured = $db->editorRow('payroll', ${id});
    $revisions = $db->revisions('payroll', ${id}, $viewer);
    $global = $db->globalGet('secondary_global', $viewer);
    $settings = $db->globalUpdate('settings', ['postsPerPage' => 12], $viewer);
    echo wp_json_encode([array_key_exists('title', $row), $status ?? null, \\TypedPress\\db() === $app, $permissions, $captured['id'], count($revisions) > 0, $global['name'], $settings['postsPerPage']]);
  `));
  assert.deepEqual(scoped, [false, 403, true, [true, null], id, true, "secondary", 12]);
  const coreScoped = JSON.parse(wp("eval", `
    wp_set_current_user(${harness.users.editor.id});
    $app = \\TypedPress\\Wp\\Plugin::instance()->db();
    $spec = $app->schema()->collection('payroll');
    unset($spec['columns']['salary']['access']);
    $schema = new \\TypedPress\\Schema(['collections' => ['payroll' => $spec]]);
    $other = new \\TypedPress\\Db($app->store(), $schema, $app->media(), 'wp');
    $result = [];
    try {
      $other->transaction(static function () use ($other, &$result) {
        $read = rest_do_request('/wp/v2/tp_payroll/${id}');
        $result[] = array_key_exists('tp_salary', $read->get_data()['acf']);
        $write = new WP_REST_Request('POST', '/wp/v2/tp_payroll/${id}');
        $write->set_param('acf', ['tp_salary' => 'overwritten']);
        try { rest_do_request($write); }
        catch (\\TypedPress\\HttpError $error) {
          $result[] = $error->status;
          $result[] = \\TypedPress\\db() === $other;
          throw $error;
        }
      });
    } catch (\\TypedPress\\HttpError) {}
    echo wp_json_encode($result);
  `));
  assert.deepEqual(coreScoped, [false, 403, true], "the plugin retains its own policy inside another Db's transaction");
  assert.equal((await ok("GET", `/payroll/${id}`, { as: "admin" })).salary, "secret");
  const deferred = JSON.parse(wp("eval", `
    $app = \\TypedPress\\Wp\\Plugin::instance()->db();
    $other = new \\TypedPress\\Db($app->store(), new \\TypedPress\\Schema(['collections' => []]), $app->media(), 'wp');
    $committed = [];
    $other->transaction(function () use ($app, &$committed) {
      $app->transaction(function () use (&$committed) {
        \\TypedPress\\Extensions::afterCommit(function () use (&$committed) {
          $committed[] = \\TypedPress\\db()->schema()->hasCollection('ledger');
        });
      });
    });
    echo wp_json_encode([$committed, \\TypedPress\\db() === $app]);
  `));
  assert.deepEqual(deferred, [[true], true], "deferred callbacks retain the registering Db across a shared transaction");

  const referenceScope = JSON.parse(wp("eval", `
    $db = \\TypedPress\\Wp\\Plugin::instance()->db();
    $viewer = new \\TypedPress\\Viewer(['id' => ${harness.users.editor.id}, 'name' => 'Editor', 'role' => 'editor'], 'wp');
    $target = $db->insert('oracle_rows', ['title' => 'Extension target', 'ownerId' => $viewer->user['id']], true)[0];
    \\TypedPress\\Extensions::beforeRead(static function (string $collection, array &$opts, ?\\TypedPress\\Viewer $viewer): void {
      if ($collection === 'oracle_rows' && ($viewer?->user['role'] ?? null) === 'editor') {
        $opts['where'] = ['AND' => [$opts['where'] ?? [], ['id' => -1]]];
      }
    });
    try { $db->insert('oracle_refs', ['title' => 'Extension reference', 'rowId' => $target['id']], false, $viewer); }
    catch (\\TypedPress\\HttpError $error) { $status = $error->status; $code = $error->errorCode; }
    echo wp_json_encode([$status ?? null, $code ?? null, $db->findMany('oracle_refs', ['where' => ['title' => 'Extension reference']])]);
  `));
  assert.deepEqual(referenceScope, [409, "reference_violation", []], "reference checks retain the viewer for query extensions and persist no hidden link");

  const constraintScope = JSON.parse(wp("eval", `
    $app = \\TypedPress\\Wp\\Plugin::instance()->db();
    $specs = array_intersect_key($app->schema()->collections(), array_flip(['oracle_rows']));
    foreach ($specs as &$spec) { $spec['access']['read'] = ['allow' => true]; }
    unset($spec);
    $db = new \\TypedPress\\Db($app->store(), new \\TypedPress\\Schema(['collections' => $specs]), $app->media(), 'wp');
    $viewer = new \\TypedPress\\Viewer(['id' => ${harness.users.editor.id}, 'name' => 'Editor', 'role' => 'editor'], 'wp');
    $code = 'extension-' . bin2hex(random_bytes(8));
    $hidden = $db->insert('oracle_rows', ['title' => $code, 'code' => $code], true)[0];
    \\TypedPress\\Extensions::beforeRead(static function (string $collection, array &$opts, ?\\TypedPress\\Viewer $viewer): void {
      if ($viewer !== null && isset($opts['where']) && $collection === 'oracle_rows') {
        $opts['where'] = ['AND' => [$opts['where'] ?? [], ['id' => -1]]];
      }
    });
    $result = [];
    foreach ([$code, $code . '-free'] as $candidate) {
      try { $db->insert('oracle_rows', ['title' => $code . '-probe', 'code' => $candidate], false, $viewer); $result[] = null; }
      catch (\\TypedPress\\HttpError $error) { $result[] = [$error->status, $error->errorCode]; }
    }
    try { $db->update('oracle_rows', ['code' => $code], ['id' => $hidden['id']], false, null, $viewer); $result[] = null; }
    catch (\\TypedPress\\HttpError $error) { $result[] = [$error->status, $error->errorCode]; }
    $result[] = count($db->findMany('oracle_rows', ['where' => ['title' => $code . '-probe']]));
    echo wp_json_encode($result);
  `));


  const transformScope = JSON.parse(wp("eval", `
    $app = \\TypedPress\\Wp\\Plugin::instance()->db();
    $specs = array_intersect_key($app->schema()->collections(), array_flip(['oracle_rows', 'oracle_refs', 'oracle_sync']));
    foreach ($specs as &$spec) { $spec['access']['read'] = ['allow' => true]; }
    unset($spec);
    $db = new \\TypedPress\\Db($app->store(), new \\TypedPress\\Schema(['collections' => $specs]), $app->media(), 'wp');
    $viewer = new \\TypedPress\\Viewer(['id' => ${harness.users.editor.id}, 'name' => 'Editor', 'role' => 'editor'], 'wp');
    $code = 'transform-' . bin2hex(random_bytes(8));
    $hidden = $db->insert('oracle_rows', ['title' => $code, 'code' => $code], true)[0];
    $visible = $db->insert('oracle_rows', ['title' => $code . '-visible', 'code' => $code . '-visible', 'publicBadge' => random_int(1000000, 9000000)], true)[0];
    \\TypedPress\\Extensions::onRead(static function (array $rows, string $collection, ?\\TypedPress\\Viewer $viewer) use ($hidden): array {
      return $collection === 'oracle_rows' && $viewer !== null
        ? array_map(static fn (array $row): array => array_diff_key($row, ['code' => true, 'publicBadge' => true]),
          array_values(array_filter($rows, static fn (array $row): bool => $row['id'] !== $hidden['id']))) : $rows;
    });
    $result = [];
    foreach ([$code . '-visible', $code . '-free'] as $candidate) {
      try { $db->insert('oracle_rows', ['title' => $code . '-probe', 'code' => $candidate], false, $viewer); $result[] = null; }
      catch (\\TypedPress\\HttpError $error) { $result[] = [$error->status, $error->errorCode]; }
    }
    foreach ([$hidden['id'], 2147483647] as $target) {
      try { $db->insert('oracle_refs', ['title' => $code . '-probe', 'rowId' => $target], false, $viewer); $result[] = null; }
      catch (\\TypedPress\\HttpError $error) { $result[] = [$error->status, $error->errorCode]; }
    }
    $result[] = $db->findMany('oracle_refs', ['where' => ['title' => $code . '-probe']]);
    $db->insert('oracle_refs', ['title' => $code . '-visible', 'rowId' => $visible['id']], false, $viewer);
    $result[] = count($db->findMany('oracle_refs', ['where' => ['title' => $code . '-visible']]));
    echo wp_json_encode($result);
  `));
  assert.deepEqual(transformScope, [[403, "forbidden"], [403, "forbidden"], [409, "reference_violation"], [409, "reference_violation"], [], 1],
    "read transforms cannot disclose hidden competitors or accept hidden reference targets; visible references still work");
  assert.deepEqual(constraintScope, [
    [403, "forbidden"], [403, "forbidden"], [403, "forbidden"], 0,
  ], "query extensions conceal unique competitors, including hidden resends");


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
    body: new URLSearchParams({ log: role, pwd: `typedpress-test-${role}`, testcookie: "1" }),
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
      action: "editpost", post_ID: String(id), post_type: "tp_gated", post_status: "publish", ...fields,
    });
    return fetch(`${harness.url}/wp-admin/post.php`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body, redirect: "manual" });
  };
  return { get, post, save };
}

test("a data-dependent create rule decides on the request's data, not before it", async () => {
  const allowed = await http("POST", `${core}/tp_gated`, { as: "author", body: { title: `Open ${run}`, status: "publish", acf: { tp_level: "open" } } });
  assert.equal(allowed.status, 201, JSON.stringify(allowed.json));
  const refused = await http("POST", `${core}/tp_gated`, { as: "author", body: { title: `Locked ${run}`, status: "publish", acf: { tp_level: "locked" } } });
  assert.deepEqual([refused.status, refused.json.code], [403, "forbidden"]);
  assert.equal(wp("post", "list", "--post_type=tp_gated", "--post_status=any", `--title=Locked ${run}`, "--format=count"), "0", "the refused create left no post");
});

test("a wp-admin form save is refused when the collection rule refuses its data, and saves nothing", async () => {
  const id = first("insert", "gated", JSON.stringify({ title: `Form ${run}`, level: "open" }))[0].id;
  const editor = await adminSession("editor");
  const refused = await editor.save(id, { post_title: `Form ${run}`, "acf[field_tp_gated_level]": "locked" });
  assert.equal(refused.status, 403);
  assert.equal(first("find", "gated", JSON.stringify({ where: { id } }))[0].level, "open", "the refused save rolled back");
  const ok = await editor.save(id, { post_title: `Form ${run} edited`, "acf[field_tp_gated_level]": "open" });
  assert.equal(ok.status, 302, "an allowed save redirects back to the editor");
  assert.equal(first("find", "gated", JSON.stringify({ where: { id } }))[0].title, `Form ${run} edited`);
});

test("nested field rules hold in wp-admin: the form hides the group, a save can't set the sub-field", async () => {
  const id = first("insert", "gated", JSON.stringify({ title: `Nested ${run}`, notes: { open: "o", sealed: "s" } }))[0].id;
  const editor = await adminSession("editor");
  const form = await (await editor.get(`post.php?post=${id}&action=edit&classic-editor`)).text();
  assert.equal(form.includes("field_tp_gated_notes_sealed"), false, "the group holding a hidden sub-field isn't rendered");
  const res = await editor.save(id, { post_title: `Nested ${run}`, "acf[field_tp_gated_notes][field_tp_gated_notes_sealed]": "forged" });
  assert.equal(res.status, 403);
  assert.deepEqual(first("find", "gated", JSON.stringify({ where: { id } }))[0].notes, { open: "o", sealed: "s" });
});

test("acf selector aliases can't smuggle a value past the field rules", async () => {
  const id = first("insert", "payroll", JSON.stringify({ title: `Alias ${run}`, salary: "1", notes: { open: "o", sealed: "s" } }))[0].id;
  const res = await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { acf: { tp_salary: "1", field_tp_payroll_salary: "999" } } });
  assert.equal(res.status, 403, JSON.stringify(res.json));
  assert.equal(first("find", "payroll", JSON.stringify({ where: { id } }))[0].salary, "1");
  const equal = await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { acf: { tp_notes: { sealed: "s" }, field_tp_payroll_notes: { open: "changed" } } } });
  const other = await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { acf: { tp_notes: { sealed: "guess" }, field_tp_payroll_notes: { open: "changed" } } } });
  assert.deepEqual([equal.status, equal.json.data.pointer, other.status, other.json.data.pointer], [403, "/notes", 403, "/notes"]);
  assert.deepEqual(first("find", "payroll", JSON.stringify({ where: { id } }))[0].notes, { open: "o", sealed: "s" });

});

test("Add New works for a user the create rule allows: the auto-draft opens and saves", async () => {
  const editor = await adminSession("author");
  const page = await editor.get("post-new.php?post_type=tp_ledger");
  assert.equal(page.status, 200);
  const draftId = Number((await page.text()).match(/name=["']post_ID["'][^>]*value=["'](\d+)/)?.[1]);
  const loaded = await http("GET", `${core}/tp_ledger/${draftId}?context=edit`, { as: "author" });
  assert.equal(loaded.status, 200, JSON.stringify(loaded.json));
  assert.equal((await http("GET", `${core}/tp_ledger/${draftId}?context=edit`, { as: "editor" })).status, 403, "the editor bootstrap is its author's, not anyone's");
  const saved = await http("POST", `${core}/tp_ledger/${draftId}`, { as: "author", body: { title: `New ${run}`, status: "publish", acf: { tp_ownerId: harness.users.author.id } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal((await ok("GET", `/ledger/${draftId}`, { as: "author" })).title, `New ${run}`);
});

test("a revision is stripped by its own snapshot, not by the live row", async () => {
  // The bonus is visible to the row's owner. Owned by someone else when revision 1 was taken, by the
  // author now: she may read today's bonus, not the one the earlier snapshot held.
  const id = first("insert", "ledger", JSON.stringify({ title: `Bonus ${run}`, ownerId: author + 1, bonus: "then" }))[0].id;
  first("update", "ledger", JSON.stringify({ id }), JSON.stringify({ ownerId: author, bonus: "now" }));
  const revs = await http("GET", `${core}/tp_ledger/${id}/revisions`, { as: "author" });
  assert.equal(revs.status, 200, JSON.stringify(revs.json));
  const bonuses = revs.json.map((r: any) => r.acf?.tp_bonus ?? "hidden").sort();
  assert.deepEqual(bonuses, ["hidden", "now"]);
  const editor = (await http("GET", `${core}/tp_ledger/${id}/revisions`, { as: "editor" })).json.map((r: any) => r.acf.tp_bonus).sort();
  assert.deepEqual(editor, ["now", "then"], "an editor reads both");
});

test("a trashed post fails closed: fields that may be hidden stay hidden", async () => {
  const id = first("insert", "payroll", JSON.stringify({ title: `Trash ${run}`, salary: "77k" }))[0].id;
  assert.equal((await http("DELETE", `${core}/tp_payroll/${id}`, { as: "editor" })).status, 200);
  const trashed = await http("GET", `${core}/tp_payroll/${id}?context=edit`, { as: "editor" });
  assert.equal(trashed.status, 200, JSON.stringify(trashed.json));
  assert.deepEqual([trashed.json.title.raw, "tp_salary" in trashed.json.acf], [`Trash ${run}`, false]);
});

test("a hidden reference leaves no link to embed, on the row and on its revisions", async () => {
  const target = first("insert", "ledger", JSON.stringify({ title: `Target ${run}`, ownerId: author }))[0].id;
  const id = first("insert", "payroll", JSON.stringify({ title: `Managed ${run}`, managerId: target }))[0].id;
  await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { title: `Managed ${run} v2` } });
  const links = async (path: string, as?: "editor" | "admin") => JSON.stringify((await http("GET", `${core}/${path}`, { as })).json);
  assert.match(await links(`tp_payroll/${id}`, "admin"), /acf:post/, "the admin sees the reference's link");
  assert.doesNotMatch(await links(`tp_payroll/${id}?_embed=1`), /acf:post|Target /);
  assert.doesNotMatch(await links(`tp_payroll/${id}/revisions?_embed=1`, "editor"), /acf:post|Target /);
});

test("search and slug can't probe a column hidden from the viewer", async () => {
  const id = first("insert", "dossier", JSON.stringify({ title: `Dossier ${run}`, body: `<p>codeword-${run}</p>` }))[0].id;
  // A search runs over the fields the reader may read (the search index, on MariaDB's FULLTEXT): a
  // word only in the hidden content finds nothing, and is answered, not refused.
  const total = async (query: string) => (await fetch(`${core}/tp_dossier?${query}`)).headers.get("x-wp-total");
  const search = await http("GET", `${core}/tp_dossier?search=codeword-${run}`);
  assert.deepEqual([search.status, search.json, await total(`search=codeword-${run}`)], [200, [], "0"], "the hidden content can't be found or counted by a visitor");
  const byContent = await http("GET", `${core}/tp_dossier?search=codeword-${run}&search_columns=post_content`);
  assert.deepEqual([byContent.status, byContent.json], [200, []], "nor when the search names the content column");
  const byTitle = await http("GET", `${core}/tp_dossier?search=Dossier%20${run}`);
  assert.deepEqual([byTitle.status, ids(byTitle), await total(`search=Dossier%20${run}`)], [200, [id], "1"], "the title is searchable for a visitor");
  assert.equal((await http("GET", `${core}/tp_dossier?slug=dossier-${run}`)).status, 403);
  const admin = await http("GET", `${core}/tp_dossier?search=codeword-${run}`, { as: "admin" });
  assert.deepEqual([admin.status, ids(admin)], [200, [id]], "the admin, who reads the content, finds the row by it");
  const item = (await http("GET", `${core}/tp_dossier?search=Dossier%20${run}&search_columns=post_title`)).json[0];
  assert.deepEqual(["content" in item, "slug" in item], [false, false], "content and slug are dropped from the item");
});

test("a field the viewer can't read refuses its unchanged value too, so no value can be probed", async () => {
  const id = first("insert", "payroll", JSON.stringify({ title: `Probe ${run}`, salary: "55k" }))[0].id;
  const right = await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { acf: { tp_salary: "55k" } } });
  const wrong = await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { acf: { tp_salary: "nope" } } });
  assert.deepEqual([right.status, wrong.status, right.json.data?.pointer], [403, 403, "/salary"]);
});

test("a data-dependent update filter must match the row as it was: no taking over another's row", async () => {
  const theirs = first("insert", "claims", JSON.stringify({ title: `Claim ${run}`, ownerId: author + 1000 }))[0].id;
  const mine = first("insert", "claims", JSON.stringify({ title: `Mine ${run}`, ownerId: author }))[0].id;
  const takeover = await http("POST", `${core}/tp_claims/${theirs}`, { as: "author", body: { acf: { tp_ownerId: author } } });
  assert.equal(takeover.status, 403, JSON.stringify(takeover.json));
  assert.equal(first("find", "claims", JSON.stringify({ where: { id: theirs } }))[0].ownerId, author + 1000);
  const own = await http("POST", `${core}/tp_claims/${mine}`, { as: "author", body: { title: `Mine ${run} edited` } });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  const invalid = await http("PATCH", `${api}/claims/${mine}`, { as: "author", body: { unexpected: {} } });
  assert.deepEqual([invalid.status, invalid.json.code, invalid.json.pointer], [422, "invalid_input", "/unexpected"]);
  assert.equal(wp("eval", `wp_set_current_user(${author}); var_export(current_user_can('edit_post', ${mine}));`), "false", "edit_post (revisions, wp-admin) stays strict");
  const jsonId = first("insert", "claims", JSON.stringify({ title: `JSON cover ${run}`, meta: {} }))[0].id;
  const editor = await adminSession("admin");
  const allowed = await editor.save(jsonId, { post_title: `JSON cover ${run} edited`, post_type: "tp_claims" });
  assert.equal(allowed.status, 302);
  assert.equal(first("find", "claims", JSON.stringify({ where: { id: jsonId } }))[0].title, `JSON cover ${run} edited`);
  const refused = await editor.save(jsonId, { post_title: "restricted", post_type: "tp_claims" });
  assert.equal(refused.status, 403, "a filter for [] cannot reuse authorization from a filter for {}");
  assert.equal(first("find", "claims", JSON.stringify({ where: { id: jsonId } }))[0].title, `JSON cover ${run} edited`);

});

test("wp-admin's Custom Fields box can't write a First column", async () => {
  const id = first("insert", "payroll", JSON.stringify({ title: `Meta ${run}`, salary: "1" }))[0].id;
  const editor = await adminSession("editor");
  const res = await editor.save(id, { post_title: `Meta ${run}`, post_type: "tp_payroll", metakeyinput: "tp_salary", metavalue: "999" });
  assert.equal(res.status, 302, "the rest of the save goes through");
  assert.equal(first("find", "payroll", JSON.stringify({ where: { id } }))[0].salary, "1", "the protected meta key was ignored");
});

test("the classic editor neither shows nor erases content hidden from the editor", async () => {
  const id = first("insert", "dossier", JSON.stringify({ title: `Native ${run}`, body: `<p>classified-${run} C:\\notes</p>` }))[0].id;
  const editor = await adminSession("editor");
  const page = await editor.get(`post.php?post=${id}&action=edit&classic-editor`);
  assert.equal(page.status, 200);
  const form = await page.text();
  assert.ok(form.includes(`Native ${run}`), "the edit screen loaded the post");
  assert.equal(form.includes(`classified-${run}`), false, "the hidden content isn't in the page");
  const saved = await editor.save(id, { post_title: `Native ${run} retitled`, post_type: "tp_dossier", content: "" });
  assert.equal(saved.status, 302);
  const row = first("find", "dossier", JSON.stringify({ where: { id } }))[0];
  assert.deepEqual([row.title, row.body], [`Native ${run} retitled`, `<p>classified-${run} C:\\notes</p>`], "the blank control left the stored content alone, byte for byte");
  // A non-blank value for the hidden content is a write: refused the same, right guess or wrong.
  const right = await editor.save(id, { post_title: `Native ${run} retitled`, post_type: "tp_dossier", content: `<p>classified-${run} C:\\notes</p>` });
  const wrong = await editor.save(id, { post_title: `Native ${run} retitled`, post_type: "tp_dossier", content: "<p>guess</p>" });
  assert.deepEqual([right.status, wrong.status], [403, 403]);
  for (const occupied of [false, true]) {
    const slug = `form-slug-probe-${occupied}-${run}`;
    const draft = await http("POST", `${core}/tp_dossier`, { as: "admin", body: { title: "Form slug probe", slug, status: "draft" } });
    assert.equal(draft.status, 201, JSON.stringify(draft.json));
    if (occupied) {
      assert.equal((await http("POST", `${core}/tp_dossier`, { as: "admin", body: { title: "Occupied form slug", slug, status: "publish" } })).status, 201);
    }
    const publish = await editor.save(draft.json.id, { post_type: "tp_dossier", post_status: "publish" });
    assert.equal(publish.status, 403);
    assert.match(await publish.text(), /You can.*set slug/);
    assert.equal(first("find", "dossier", JSON.stringify({ where: { id: draft.json.id } }))[0].status, "draft");
  }
});

test("wp-admin's list search doesn't read content hidden from the viewer", async () => {
  first("insert", "dossier", JSON.stringify({ title: `Listed ${run}`, body: `<p>listword-${run}</p>` }));
  const editor = await adminSession("editor");
  const byContent = await editor.get(`edit.php?post_type=tp_dossier&s=listword-${run}`);
  assert.equal(byContent.status, 200);
  assert.equal((await byContent.text()).includes(`Listed ${run}`), false);
  assert.ok((await (await editor.get(`edit.php?post_type=tp_dossier&s=Listed%20${run}`)).text()).includes(`Listed ${run}`), "a title search still finds it");
});

test("wp-admin's revision diffs leave out fields hidden from the viewer", async () => {
  const id = first("insert", "payroll", JSON.stringify({ title: `Diff ${run}`, salary: "1k" }))[0].id;
  first("update", "payroll", JSON.stringify({ id }), JSON.stringify({ salary: "2k", title: `Diff ${run} v2` }));
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
  assert.ok((await diffs("admin")).includes("tp_salary"), "the admin's diff compares the salary");
  const editor = await diffs("editor");
  assert.ok(editor.includes("post_title"));
  assert.deepEqual(editor.filter((f: string) => f.startsWith("tp_salary")), [], "the editor's doesn't");
});

test("restoring a hidden group is refused independently of whether its saved value matches", async () => {
  const id = first("insert", "gated", JSON.stringify({ title: `Restore ${run}`, notes: { open: "old", sealed: "secret" } }))[0].id;
  first("update", "gated", JSON.stringify({ id }), JSON.stringify({ title: `Restore ${run} v2`, notes: { open: "new", sealed: "secret" } }));
  const [revision] = JSON.parse(wp("eval", `echo wp_json_encode(array_keys(wp_get_post_revisions(${id}, ['order' => 'ASC'])));`));
  const editor = await adminSession("editor");
  const html = await (await editor.get(`revision.php?revision=${revision}`)).text();
  const match = html.match(/"restoreUrl":("[^"]*")/);
  assert.ok(match, "WordPress supplies the restore URL and its session nonce");
  const restore = JSON.parse(match[1]).replace(/^.*\/wp-admin\//, "");
  assert.equal((await editor.get(restore)).status, 403, "matching hidden value");
  first("update", "gated", JSON.stringify({ id }), JSON.stringify({ notes: { open: "new", sealed: "different" } }));
  assert.equal((await editor.get(restore)).status, 403, "different hidden value");
  assert.deepEqual(first("find", "gated", JSON.stringify({ where: { id } }))[0].notes, { open: "new", sealed: "different" });
});

test("autosaving one's own draft returns it without the fields hidden from the author of the save", async () => {
  const created = await http("POST", `${core}/tp_dossier`, { as: "admin", body: { author: harness.users.editor.id, title: `Draft ${run}`, status: "draft", content: `<p>draftword-${run}</p>` } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const autosaved = await http("POST", `${core}/tp_dossier/${created.json.id}/autosaves`, { as: "editor", body: { title: `Draft ${run} autosaved`, content: `<p>draftword-${run}</p>` } });
  assert.equal(autosaved.status, 200, JSON.stringify(autosaved.json));
  assert.equal(JSON.stringify(autosaved.json).includes(`draftword-${run}`), false);
});

test("a REST save inside an open transaction that fails after writing aborts the transaction", () => {
  const id = first("insert", "payroll", JSON.stringify({ title: `Nested ${run}` }))[0].id;
  const out = JSON.parse(wp("eval", `
    add_action('rest_api_init', static fn () => register_rest_field('tp_payroll', 'zfail', ['update_callback' => static fn () => new WP_Error('nope', 'refused late', ['status' => 400]), 'schema' => ['type' => 'string']]));
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    $request = new WP_REST_Request('POST', '/wp/v2/tp_payroll/${id}');
    $request->set_body_params(['title' => 'Half done', 'zfail' => 'x']);
    try {
      \\TypedPress\\Wp\\Plugin::instance()->db()->transaction(static fn () => rest_do_request($request));
      $caught = null;
    } catch (Throwable $e) { $caught = $e->getMessage(); }
    clean_post_cache(${id});
    echo wp_json_encode([$caught, get_post(${id})->post_title]);
  `));
  assert.deepEqual(out, ["refused late", `Nested ${run}`]);
});

test("a save interrupted before TypedPress's after hooks run commits nothing", () => {
  // A wp_after_insert_post callback before TypedPress's (priority 20) throws and its caller catches it.
  const out = wp("eval", `
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    add_action('wp_after_insert_post', static function () { throw new RuntimeException('interrupted'); }, 10);
    try { wp_insert_post(['post_type' => 'tp_payroll', 'post_title' => 'Cut ${run}', 'post_status' => 'publish'], true); } catch (Throwable $e) {}
    \\TypedPress\\Wp\\EditorSave::shutdown();
    echo (int) (new WP_Query(['post_type' => 'tp_payroll', 'title' => 'Cut ${run}', 'post_status' => 'any', 'fields' => 'ids']))->found_posts;
  `);
  assert.equal(out, "0");
});

test("protected visibility is batched and cached before core pagination", () => {
  const result: unknown = JSON.parse(wp("eval", `
    $db = \\TypedPress\\Wp\\Plugin::instance()->db();
    wp_set_current_user(0);
    $anon = new \\TypedPress\\Viewer(null);
    $ids = [];
    try {
      for ($i = 0; $i < 40; $i++) {
        $ids[] = wp_insert_post(['post_type' => 'tp_payroll', 'post_title' => 'Protected batch', 'post_status' => 'publish', 'post_password' => 'secret']);
      }
      $public = $db->insert('payroll', ['title' => 'Public batch'], true)[0]['id'];
      $ids[] = $public;
      wp_cache_flush();
      \\TypedPress\\Wp\\CoreAccess::flush();
      global $wpdb;
      $before = $wpdb->num_queries;
      $rows = $db->findMany('payroll', ['where' => ['id' => ['in' => $ids]], 'orderBy' => ['id' => 'asc'], 'limit' => 1], $anon);
      $queries = $wpdb->num_queries - $before;
      wp_cache_flush();
      \\TypedPress\\Wp\\CoreAccess::flush();
      $editor = new \\TypedPress\\Viewer(['id' => ${harness.users.editor.id}, 'name' => 'Editor', 'role' => 'editor'], 'wp');
      $failLookup = static fn ($sql) => preg_match('/^\\s*SELECT\\b/i', $sql) && str_contains($sql, $wpdb->posts)
        ? 'SELECT * FROM tp_missing_post_storage' : $sql;
      add_filter('query', $failLookup);
      $suppressed = $wpdb->suppress_errors(true);
      $refusals = [];
      try {
        foreach ([$anon, $editor] as $viewer) {
          try {
            $answer = $db->findFirst('payroll', ['where' => ['id' => $ids[0]]], $viewer);
            $refusals[] = $answer === null ? 'hidden' : 'allowed';
          } catch (\\TypedPress\\HttpError $e) {
            $refusals[] = [$e->status, $e->errorCode];
          }
        }
      } finally {
        remove_filter('query', $failLookup);
        $wpdb->suppress_errors($suppressed);
      }
      $recovered = [
        $db->findFirst('payroll', ['where' => ['id' => $ids[0]]], $anon),
        $db->findFirst('payroll', ['where' => ['id' => $ids[0]]], $editor)['id'] === $ids[0]
      ];
      $request = new WP_REST_Request('GET', '/wp/v2/tp_payroll');
      $request->set_query_params(['include' => $ids, 'per_page' => 1, 'order' => 'asc', 'orderby' => 'id']);
      $native = rest_do_request($request);
      $hidden = rest_do_request(new WP_REST_Request('GET', '/wp/v2/tp_payroll/' . $ids[0]));
      $request->set_param('password', 'secret');
      $unlocked = rest_do_request($request);
      $exactPasswords = [];
      foreach (['Secret', 'secret ', '0 '] as $password) {
        $wpdb->update($wpdb->posts, ['post_password' => $password], ['ID' => $ids[0]]);
        clean_post_cache($ids[0]);
        $answer = rest_do_request($request);
        $exactPasswords[] = array_column($answer->get_data(), 'id') === [$ids[1]];
      }
      $wpdb->update($wpdb->posts, ['post_password' => 'secret'], ['ID' => $ids[0]]);
      clean_post_cache($ids[0]);
      require_once ABSPATH . WPINC . '/class-phpass.php';
      $_COOKIE['wp-postpass_' . COOKIEHASH] = (new PasswordHash(8, true))->HashPassword('secret');
      $cookie = $db->findFirst('payroll', ['where' => ['id' => $ids[0]]], $anon);
      unset($_COOKIE['wp-postpass_' . COOKIEHASH]);
      $locked = $db->findFirst('payroll', ['where' => ['id' => $ids[0]]], $anon);
      wp_update_post(['ID' => $ids[0], 'post_password' => '']);
      $written = $db->findFirst('payroll', ['where' => ['id' => $ids[0]]], $anon);
      echo json_encode([
        array_column($rows, 'id') === [$public], $queries <= 5,
        $native->get_status(), array_column($native->get_data(), 'id') === [$public], $native->get_headers()['X-WP-Total'] ?? null,
        $hidden->get_status(), $unlocked->get_status(), $unlocked->get_data()[0]['id'] === $ids[0],
        $cookie['id'] === $ids[0], $locked, $written['id'] === $ids[0], $refusals, $recovered, $exactPasswords
      ]);
    } finally {
      foreach ($ids as $id) { wp_delete_post($id, true); }
    }
  `));
  assert.deepEqual(result, [true, true, 200, true, 1, 404, 200, true, true, null, true,
    ['hidden', [503, 'storage_unavailable']], [null, true], [true, true, true]]);
});

test("core meta and TypedPress's query args keep every denial: masks, hidden filters, drafts, read rules", async () => {
  const id = first("insert", "payroll", JSON.stringify({ title: `Masked ${run}`, salary: "70k", notes: { open: "o", sealed: "s" } }))[0].id;
  // Field masks: `meta` drops what `acf` drops.
  const anon = (await http("GET", `${core}/tp_payroll/${id}`)).json;
  assert.deepEqual(["salary" in anon.meta, "notes" in anon.meta, "title" in anon.meta], [false, false, false]);
  assert.equal((await http("GET", `${core}/tp_payroll/${id}`, { as: "admin" })).json.meta.salary, "70k");
  // A filter, sort or relation through a hidden field is the facade's 403, never a probe.
  for (const params of [{ where: JSON.stringify({ salary: "70k" }) }, { orderBy: "salary" }, { where: JSON.stringify({ notes: { isNull: false } }) }]) {
    const r = await http("GET", `${core}/tp_payroll?` + new URLSearchParams(params), { as: "editor" });
    assert.deepEqual([r.status, r.json.code], [403, "forbidden"], JSON.stringify(params));
  }
  assert.deepEqual(ids(await http("GET", `${core}/tp_payroll?` + new URLSearchParams({ where: JSON.stringify({ salary: "70k", title: `Masked ${run}` }) }), { as: "admin" })), [id]);
  // A search leaves out fields hidden from the viewer: the salary can't be found by its value.
  assert.deepEqual((await http("GET", `${core}/tp_payroll?search=70k`, { as: "editor" })).json, []);
  // The read rule still filters: `where` can't widen what the author may read.
  const listed = await http("GET", `${core}/tp_ledger?` + new URLSearchParams({ where: JSON.stringify({ id: { in: [mine, theirs] } }) }), { as: "author" });
  assert.deepEqual(ids(listed), [mine]);
  assert.equal((await http("GET", `${core}/tp_vault?` + new URLSearchParams({ where: "{}" }))).status, 401);
  // Draft visibility: an anonymous `where` on status can't reveal a draft.
  const draft = first("insert", "posts", JSON.stringify({ title: `Draft ${run}`, status: "draft" }))[0].id;
  const anonDraft = await http("GET", `${core}/tp_posts?` + new URLSearchParams({ where: JSON.stringify({ id: draft, status: "draft" }), status: "draft" }));
  assert.ok(anonDraft.status >= 400 || anonDraft.json.length === 0, JSON.stringify(anonDraft.json));
  assert.deepEqual((await http("GET", `${core}/tp_posts?` + new URLSearchParams({ where: JSON.stringify({ id: draft }) }))).json, []);
  // Meta writes are authorized like `acf` ones: a hidden field can't be written, even unchanged.
  const write = await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { meta: { salary: "70k" } } });
  assert.deepEqual([write.status, write.json.data?.pointer], [403, "/salary"]);
  // A data-dependent update rule sees each meta value as it will be saved, so the check before
  // the save and the one after agree (events: a non-editor may only reset `extra` to {}).
  const event = first("insert", "events", JSON.stringify({ title: `Rule ${run}`, extra: { k: 1 } }))[0].id;
  const reset = await http("POST", `${core}/tp_events/${event}`, { as: "author", body: { meta: { extra: {}, startsAt: "2026-01-01T10:00:00+02:00" } } });
  assert.deepEqual([reset.status, reset.json.meta?.extra, reset.json.meta?.startsAt], [200, {}, "2026-01-01T08:00:00.000Z"], JSON.stringify(reset.json));
  const refused = await http("POST", `${core}/tp_events/${event}`, { as: "author", body: { meta: { extra: { k: 2 } } } });
  assert.equal(refused.status, 403);
  // A partial group through `meta` keeps the sub-field the editor can't read, as /wp-json/typedpress/v1 and acf do.
  const partial = await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { meta: { notes: { open: "edited" } } } });
  assert.deepEqual([partial.status, "notes" in partial.json.meta], [200, false], "the group stays masked in the editor's answer");
  assert.deepEqual(first("find", "payroll", JSON.stringify({ where: { id } }))[0].notes, { open: "edited", sealed: "s" });
  const sealed = await http("POST", `${core}/tp_payroll/${id}`, { as: "editor", body: { meta: { notes: { open: "x", sealed: "forged" } } } });
  assert.deepEqual([sealed.status, sealed.json.data?.pointer], [403, "/notes/sealed"]);
  // For an admin nothing in the group is hidden: `meta` replaces it whole, as /wp-json/typedpress/v1 does.
  const viaZero = await http("PATCH", `${api}/payroll/${id}`, { as: "admin", body: { notes: { open: "by admin" } } });
  const admin = await http("POST", `${core}/tp_payroll/${id}`, { as: "admin", body: { meta: { notes: { open: "by admin" } } } });
  assert.deepEqual([admin.status, admin.json.meta?.notes], [200, viaZero.json.data.notes], JSON.stringify(viaZero.json));
  const twice = await http("POST", `${core}/tp_payroll/${id}`, { as: "admin", body: { meta: { salary: "1" }, acf: { tp_salary: "2" } } });
  assert.deepEqual([twice.status, twice.json.data?.pointer], [403, "/salary"], "one field, one selector");
});

test("a many-ref writes and reads its join table over /tp/v1 and through a core editor save", async () => {
  const [a, b, c] = ["A", "B", "C"].map((t) => first("insert", "oracle_parents", JSON.stringify({ title: `Mentor ${t} ${run}` }))[0].id);
  const created = await http("POST", `${api}/oracle_kids`, { as: "editor", body: { title: `Kid ${run}`, mentors: [b, a] } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.data.id;
  assert.deepEqual(created.json.data.mentors, [b, a], "ids in write order");
  const loaded = await http("GET", `${api}/oracle_kids?where=${encodeURIComponent(JSON.stringify({ mentors: { has: a } }))}&with=mentors`, { as: "editor" });
  assert.deepEqual(loaded.json.data.map((k: any) => [k.id, k.mentors.map((m: any) => m.title)]), [[id, [`Mentor B ${run}`, `Mentor A ${run}`]]]);
  const missing = await http("PATCH", `${api}/oracle_kids/${id}`, { as: "editor", body: { mentors: [a, 999999999] } });
  assert.deepEqual([missing.status, missing.json.code, missing.json.pointer], [409, "reference_violation", "/mentors/1"]);

  // The editor field is a post_object (multiple); saving it replaces the links, and writes no postmeta.
  const saved = await http("POST", `${core}/tp_oracle_kids/${id}`, { as: "editor", body: { acf: { tp_mentors: [c, b] } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.acf.tp_mentors.map(Number), [c, b], "the editor reads the links back");
  assert.deepEqual(first("find", "oracle_kids", JSON.stringify({ where: { id } }))[0].mentors, [c, b]);
  assert.equal(wp("eval", `echo json_encode(metadata_exists('post', ${id}, 'tp_mentors'));`), "false");
  const reverse = first("find", "oracle_parents", JSON.stringify({ where: { id: c }, with: { mentees: true } }))[0];
  assert.deepEqual(reverse.mentees.map((k: any) => k.id), [id]);

  // Trash hides the linked row from relation reads and saves the links for restore.
  const mentors = async () => (await ok("GET", `/oracle_kids/${id}?with=mentors`, { as: "editor" })).mentors.map((m: { id: number }) => m.id);
  first("delete", "oracle_parents", JSON.stringify({ id: c }));
  assert.deepEqual(await mentors(), [b]);
  await ok("POST", `/oracle_parents/${c}/restore`, { as: "editor" });
  assert.deepEqual(await mentors(), [c, b]);
  first("delete", "oracle_kids", JSON.stringify({ id }));
  const links = sql(`SELECT target_id FROM wp_tp__join_oracle_kids_mentors WHERE owner_id = ${id} ORDER BY position`);
  assert.deepEqual(links.map((link) => Number(link.target_id)), [c, b]);
});

test("a core update of a TypedPress post sets its featured image and its terms, as core's update does", async () => {
  // A taxonomy and thumbnails on a TypedPress post type, as a theme or plugin adds them.
  wp("eval", `wp_mkdir_p(WPMU_PLUGIN_DIR); file_put_contents(WPMU_PLUGIN_DIR . '/typedpress-test-jot-terms.php', base64_decode('${Buffer.from("<?php\nadd_action('init', function () { register_taxonomy('tp_test_mood', 'tp_jottings', ['show_in_rest' => true, 'rest_base' => 'moods']); add_post_type_support('tp_jottings', 'thumbnail'); }, 20);\n").toString("base64")}'));`);
  try {
    const id = first("insert", "jottings", JSON.stringify({ title: `Termed ${run}`, status: "published" }))[0].id;
    const term = Number(wp("term", "create", "tp_test_mood", `Calm ${run}`, "--porcelain"));
    const image = Number(wp("eval", "echo wp_insert_attachment(['post_mime_type' => 'image/png', 'post_title' => 'cover', 'post_status' => 'inherit'], 'cover.png');"));
    const set = await http("POST", `${core}/tp_jottings/${id}`, { as: "editor", body: { featured_media: image, moods: [term] } });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual([set.json.featured_media, set.json.moods], [image, [term]]);
    assert.equal(Number(wp("post", "meta", "get", String(id), "_thumbnail_id")), image);
    const cleared = await http("POST", `${core}/tp_jottings/${id}`, { as: "editor", body: { featured_media: 0, moods: [] } });
    assert.deepEqual([cleared.status, cleared.json.featured_media, cleared.json.moods], [200, 0, []]);
  } finally {
    wp("eval", "@unlink(WPMU_PLUGIN_DIR . '/typedpress-test-jot-terms.php');");
  }
});

test("a taxonomy's terms over /tp/v1 and core's term route, assigned by an editor save, with a URL in the sitemap", async () => {
  // Terms through the API: implicit fields, term meta, the hierarchy, the URL.
  const parent = await http("POST", `${api}/oracle_topics`, { as: "editor", body: { name: `Topic ${run}`, color: "red" } });
  assert.equal(parent.status, 201, JSON.stringify(parent.json));
  const p = parent.json.data;
  assert.deepEqual([p.slug, p.description, p.parent, p.count, p.color], [`topic-${run}`, "", null, 0, "red"]);
  const child = await http("POST", `${api}/oracle_topics`, { as: "editor", body: { name: `Child ${run}`, parent: p.id } });
  const c = child.json.data;
  assert.equal(c.url, `${harness.url}/oracle-topics/${p.slug}/${c.slug}/`);
  assert.equal((await http("POST", `${api}/oracle_topics`, { as: "author", body: { name: `Nope ${run}` } })).status, 403, "editor creates");
  const counted = await http("PATCH", `${api}/oracle_topics/${c.id}`, { as: "editor", body: { count: 3 } });
  assert.deepEqual([counted.status, counted.json.pointer], [422, "/count"], "count is read-only");

  // Core's term route answers the same rows, its writes through TypedPress's pipeline.
  const coreList = await http("GET", `${core}/tp_oracle_topics?per_page=100&search=${run}`);
  assert.deepEqual(coreList.json.map((t: any) => t.name).sort(), [`Child ${run}`, `Topic ${run}`]);
  assert.equal(coreList.json.find((t: any) => t.id === p.id).meta.color, "red");
  const coreWrite = await http("POST", `${core}/tp_oracle_topics/${c.id}`, { as: "editor", body: { meta: { color: "blue" }, description: "Kids" } });
  assert.equal(coreWrite.status, 200, JSON.stringify(coreWrite.json));
  assert.deepEqual([coreWrite.json.description, coreWrite.json.meta.color], ["Kids", "blue"]);
  assert.equal((await http("POST", `${core}/tp_oracle_topics`, { as: "author", body: { name: `Core nope ${run}` } })).status, 403);

  // Assigning: the item's field, in write order, as core's term relationships.
  const kid = await http("POST", `${api}/oracle_kids`, { as: "editor", body: { title: `Classified ${run}`, oracleTopics: [c.id, p.id] } });
  assert.equal(kid.status, 201, JSON.stringify(kid.json));
  const id = kid.json.data.id;
  assert.deepEqual(kid.json.data.oracleTopics, [c.id, p.id]);
  const found = await http("GET", `${api}/oracle_kids?where=${encodeURIComponent(JSON.stringify({ oracleTopics: { has: p.id } }))}&with=oracleTopics`, { as: "editor" });
  assert.deepEqual(found.json.data.map((k: any) => [k.id, k.oracleTopics.map((t: any) => t.name)]), [[id, [`Child ${run}`, `Topic ${run}`]]]);
  const reverse = await http("GET", `${api}/oracle_topics/${p.id}?with=oracleKids`);
  assert.deepEqual(reverse.json.data.oracleKids.map((k: any) => k.id), [id]);

  // A core editor save sets the term set with core's own taxonomy field on the post.
  const saved = await http("POST", `${core}/tp_oracle_kids/${id}`, { as: "editor", body: { tp_oracle_topics: [p.id] } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.tp_oracle_topics, [p.id]);
  assert.deepEqual(first("find", "oracle_kids", JSON.stringify({ where: { id } }))[0].oracleTopics, [p.id]);

  // The term URL renders its archive, and core's sitemap lists the taxonomy's terms.
  const page = await fetch(`${harness.url}/oracle-topics/${p.slug}/`, { redirect: "manual" });
  assert.equal(page.status, 200);
  const index = await (await fetch(`${harness.url}/wp-sitemap.xml`)).text();
  assert.match(index, /wp-sitemap-taxonomies-tp_oracle_topics-1\.xml/);
  const terms = await (await fetch(`${harness.url}/wp-sitemap-taxonomies-tp_oracle_topics-1.xml`)).text();
  assert.ok(terms.includes(`/oracle-topics/${p.slug}/`), terms);

  // Deleting the parent moves the child up and removes its links.
  assert.equal((await http("DELETE", `${api}/oracle_topics/${p.id}`, { as: "editor" })).status, 200);
  assert.equal(first("find", "oracle_topics", JSON.stringify({ where: { id: c.id } }))[0].parent, null);
  assert.deepEqual(first("find", "oracle_kids", JSON.stringify({ where: { id } }))[0].oracleTopics, []);
});
