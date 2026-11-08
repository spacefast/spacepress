// Core /wp/v2/zero_* under Zero's access rules (lane R): the block editor keeps its REST routes, but
// they answer exactly what /zero/v1 would. Fixtures: tests/wp/app/lanes/rest.ts (vault: admin-only;
// ledger: owners read and edit their own rows; payroll: anyone reads, salary admin-only).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { api, core, harness, http, ok, run, wp, zero } from "./env.ts";

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

test("hidden fields need an explicit update rule, including nested fields", async () => {
  const id = zero("insert", "payroll", JSON.stringify({ title: `Guarded ${run}`, salary: "secret", managerId: mine, notes: { open: "visible", sealed: "secret" }, entries: [{ open: "visible", sealed: "secret" }], policy: { gate: "locked", value: "old" }, writeOnly: "old" }))[0].id;
  const top = await http("PATCH", `${api}/payroll/${id}`, { as: "editor", body: { managerId: theirs } });
  assert.deepEqual([top.status, top.json.pointer], [403, "/managerId"]);
  const nested = await http("PATCH", `${api}/payroll/${id}`, { as: "editor", body: { notes: { sealed: "changed" } } });
  assert.deepEqual([nested.status, nested.json.pointer], [403, "/notes/sealed"]);
  const cleared = await http("PATCH", `${api}/payroll/${id}`, { as: "editor", body: { entries: [] } });
  assert.deepEqual([cleared.status, cleared.json.pointer], [403, "/entries/0"]);
  const emptyId = zero("insert", "payroll", JSON.stringify({ title: `Empty ${run}` }))[0].id;
  const newNested = await http("PATCH", `${api}/payroll/${emptyId}`, { as: "editor", body: { notes: { sealed: "changed" } } });
  assert.deepEqual([newNested.status, newNested.json.pointer], [403, "/notes/sealed"]);
  const newItem = await http("PATCH", `${api}/payroll/${emptyId}`, { as: "editor", body: { entries: [{ sealed: "changed" }] } });
  assert.deepEqual([newItem.status, newItem.json.pointer], [403, "/entries/0/sealed"]);
  const newLayout = await http("PATCH", `${api}/payroll/${emptyId}`, { as: "editor", body: { sections: [{ layout: "private", sealed: "changed" }] } });
  assert.deepEqual([newLayout.status, newLayout.json.pointer], [403, "/sections/0/sealed"]);
  const coreNested = await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { acf: { zero_notes: { sealed: "changed" } } } });
  assert.deepEqual([coreNested.status, coreNested.json.data.pointer], [403, "/notes/sealed"]);
  const visible = await ok("PATCH", `/payroll/${id}`, { as: "editor", body: { notes: { open: "edited" }, writeOnly: "new" } });
  assert.deepEqual(visible.notes, { open: "edited" });
  assert.equal("writeOnly" in visible, false);
  const policy = await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { acf: { zero_policy: { value: "new" } } } });
  assert.deepEqual([policy.status, policy.json.data.pointer], [403, "/policy/value"], "the rule sees the saved sibling, even when it was omitted from the input");
  zero("update", "payroll", JSON.stringify({ id: emptyId }), JSON.stringify({ notes: { open: "visible", sealed: null } }));
  const clearNull = await http("POST", `${core}/zero_payroll/${emptyId}`, { as: "editor", body: { acf: { zero_notes: null } } });
  const clearSecret = await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { acf: { zero_notes: null } } });
  assert.deepEqual([clearNull.status, clearNull.json.data.pointer, clearSecret.status, clearSecret.json.data.pointer], [403, "/notes", 403, "/notes"]);
  const coreVisible = await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { acf: { zero_notes: { open: "edited in core" } } } });
  assert.equal(coreVisible.status, 200, JSON.stringify(coreVisible.json));
  const stored = await ok("GET", `/payroll/${id}`, { as: "admin" });
  assert.deepEqual([stored.managerId, stored.notes, stored.writeOnly], [mine, { open: "edited in core", sealed: "secret" }, "new"]);

  // A second Db shares WordPress storage but owns different field policy. Both its read and write
  // must use that schema, then restore the booted app's Db even when the operation throws.
  const scoped = JSON.parse(wp("eval", `
    $app = \\Zero\\Wp\\Plugin::instance()->db();
    \\Zero\\Db::setInstance($app);
    $spec = $app->schema()->collection('payroll');
    $spec['columns']['title']['access']['read'] = ['allow' => false];
    eval('namespace ZeroApp; function secondary_scope_rule($ctx) { return \\\\Zero\\\\db()->schema()->hasCollection("scope_marker"); } function secondary_scope_default() { return \\\\Zero\\\\db()->schema()->hasCollection("scope_marker") ? "secondary" : "booted"; }');
    $spec['access']['read'] = $spec['access']['update'] = ['fn' => 'secondary_scope_rule'];
    $settings = $app->schema()->global('settings');
    $settings['access'] = ['read' => ['fn' => 'secondary_scope_rule'], 'update' => ['fn' => 'secondary_scope_rule']];
    $schema = new \\Zero\\Schema(['collections' => ['payroll' => $spec, 'scope_marker' => $spec], 'globals' => [
      'settings' => $settings,
      'secondary_global' => ['fields' => ['name' => ['type' => 'text', 'default' => ['fn' => 'secondary_scope_default']]], 'access' => $settings['access'], 'wp' => ['postId' => 'zero_secondary_global', 'fieldKeyPrefix' => 'field_zero_secondary_global_']],
    ]]);
    $store = \\Zero\\Wp\\CompositeStore::create($schema, \\Zero\\Wp\\Plugin::instance()->connection());
    $db = new \\Zero\\Db($store, $schema, $app->media(), 'wp');
    $viewer = new \\Zero\\Viewer(['id' => 1, 'name' => 'Editor', 'role' => 'editor'], 'wp');
    $row = $db->findFirst('payroll', ['where' => ['id' => ${id}]], $viewer);
    try { $db->update('payroll', ['title' => 'overwritten'], ['id' => ${id}], true, $viewer); }
    catch (\\Zero\\HttpError $error) { $status = $error->status; }
    \\Zero\\Extensions::beforeRead(static function (string $collection, array &$opts): void {
      if ($collection === 'payroll' && !\\Zero\\db()->schema()->hasCollection('scope_marker')) throw new RuntimeException('wrong query Db');
    });
    $permissions = [$db->permits('payroll', 'read', ${id}, $viewer), $db->permittedKeys('payroll', 'update', $viewer)];
    $captured = $db->editorRow('payroll', ${id});
    $revisions = $db->revisions('payroll', ${id}, $viewer);
    $global = $db->globalGet('secondary_global', $viewer);
    $settings = $db->globalUpdate('settings', ['postsPerPage' => 12], $viewer);
    echo wp_json_encode([array_key_exists('title', $row), $status ?? null, \\Zero\\db() === $app, $permissions, $captured['id'], count($revisions) > 0, $global['name'], $settings['postsPerPage']]);
  `));
  assert.deepEqual(scoped, [false, 403, true, [true, null], id, true, "secondary", 12]);
  const coreScoped = JSON.parse(wp("eval", `
    wp_set_current_user(${harness.users.editor.id});
    $app = \\Zero\\Wp\\Plugin::instance()->db();
    $spec = $app->schema()->collection('payroll');
    unset($spec['columns']['salary']['access']);
    $schema = new \\Zero\\Schema(['collections' => ['payroll' => $spec]]);
    $other = new \\Zero\\Db($app->store(), $schema, $app->media(), 'wp');
    $result = [];
    try {
      $other->transaction(static function () use ($other, &$result) {
        $read = rest_do_request('/wp/v2/zero_payroll/${id}');
        $result[] = array_key_exists('zero_salary', $read->get_data()['acf']);
        $write = new WP_REST_Request('POST', '/wp/v2/zero_payroll/${id}');
        $write->set_param('acf', ['zero_salary' => 'overwritten']);
        try { rest_do_request($write); }
        catch (\\Zero\\HttpError $error) {
          $result[] = $error->status;
          $result[] = \\Zero\\db() === $other;
          throw $error;
        }
      });
    } catch (\\Zero\\HttpError) {}
    echo wp_json_encode($result);
  `));
  assert.deepEqual(coreScoped, [false, 403, true], "the plugin retains its own policy inside another Db's transaction");
  assert.equal((await ok("GET", `/payroll/${id}`, { as: "admin" })).salary, "secret");
  const deferred = JSON.parse(wp("eval", `
    $app = \\Zero\\Wp\\Plugin::instance()->db();
    $other = new \\Zero\\Db($app->store(), new \\Zero\\Schema(['collections' => []]), $app->media(), 'wp');
    $committed = [];
    $other->transaction(function () use ($app, &$committed) {
      $app->transaction(function () use (&$committed) {
        \\Zero\\Extensions::afterCommit(function () use (&$committed) {
          $committed[] = \\Zero\\db()->schema()->hasCollection('ledger');
        });
      });
    });
    echo wp_json_encode([$committed, \\Zero\\db() === $app]);
  `));
  assert.deepEqual(deferred, [[true], true], "deferred callbacks retain the registering Db across a shared transaction");

  const referenceScope = JSON.parse(wp("eval", `
    $db = \\Zero\\Wp\\Plugin::instance()->db();
    $viewer = new \\Zero\\Viewer(['id' => ${harness.users.editor.id}, 'name' => 'Editor', 'role' => 'editor'], 'wp');
    $target = $db->insert('oracle_rows', ['title' => 'Extension target', 'ownerId' => $viewer->user['id']], true)[0];
    \\Zero\\Extensions::beforeRead(static function (string $collection, array &$opts, ?\\Zero\\Viewer $viewer): void {
      if ($collection === 'oracle_rows' && ($viewer?->user['role'] ?? null) === 'editor') {
        $opts['where'] = ['AND' => [$opts['where'] ?? [], ['id' => -1]]];
      }
    });
    try { $db->insert('oracle_refs', ['title' => 'Extension reference', 'rowId' => $target['id']], false, $viewer); }
    catch (\\Zero\\HttpError $error) { $status = $error->status; $code = $error->errorCode; }
    echo wp_json_encode([$status ?? null, $code ?? null, $db->findMany('oracle_refs', ['where' => ['title' => 'Extension reference']])]);
  `));
  assert.deepEqual(referenceScope, [409, "reference_violation", []], "reference checks retain the viewer for query extensions and persist no hidden link");

  const constraintScope = JSON.parse(wp("eval", `
    $app = \\Zero\\Wp\\Plugin::instance()->db();
    $specs = array_intersect_key($app->schema()->collections(), array_flip(['oracle_rows', 'key_roots', 'key_links']));
    foreach ($specs as &$spec) { $spec['access']['read'] = ['allow' => true]; }
    unset($spec);
    $db = new \\Zero\\Db($app->store(), new \\Zero\\Schema(['collections' => $specs]), $app->media(), 'wp');
    $viewer = new \\Zero\\Viewer(['id' => ${harness.users.editor.id}, 'name' => 'Editor', 'role' => 'editor'], 'wp');
    $code = 'extension-' . bin2hex(random_bytes(8));
    $hidden = $db->insert('oracle_rows', ['title' => $code, 'code' => $code], true)[0];
    $base = random_int(1000000000, 1900000000);
    $parents = $db->insert('key_roots', [['code' => $base], ['code' => $base + 1]], true);
    $db->insert('key_links', ['rootCode' => $base]);
    \\Zero\\Extensions::beforeRead(static function (string $collection, array &$opts, ?\\Zero\\Viewer $viewer): void {
      if ($viewer !== null && isset($opts['where']) && in_array($collection, ['oracle_rows', 'key_links'], true)) {
        $opts['where'] = ['AND' => [$opts['where'] ?? [], ['id' => -1]]];
      }
    });
    $result = [];
    foreach ([$code, $code . '-free'] as $candidate) {
      try { $db->insert('oracle_rows', ['title' => $code . '-probe', 'code' => $candidate], false, $viewer); $result[] = null; }
      catch (\\Zero\\HttpError $error) { $result[] = [$error->status, $error->errorCode]; }
    }
    try { $db->update('oracle_rows', ['code' => $code], ['id' => $hidden['id']], false, null, $viewer); $result[] = null; }
    catch (\\Zero\\HttpError $error) { $result[] = [$error->status, $error->errorCode]; }
    foreach ($parents as $parent) {
      try { $db->delete('key_roots', ['id' => $parent['id']], false, $viewer); $result[] = null; }
      catch (\\Zero\\HttpError $error) { $result[] = [$error->status, $error->errorCode]; }
      try { $db->update('key_roots', ['code' => $parent['code'] + 10], ['id' => $parent['id']], false, $viewer); $result[] = null; }
      catch (\\Zero\\HttpError $error) { $result[] = [$error->status, $error->errorCode]; }
    }
    $result[] = count($db->findMany('oracle_rows', ['where' => ['title' => $code . '-probe']]));
    $result[] = array_column($db->findMany('key_roots', ['where' => ['id' => ['in' => array_column($parents, 'id')]], 'orderBy' => ['id' => 'asc']]), 'code') === [$base, $base + 1];
    echo wp_json_encode($result);
  `));


  const transformScope = JSON.parse(wp("eval", `
    $app = \\Zero\\Wp\\Plugin::instance()->db();
    $specs = array_intersect_key($app->schema()->collections(), array_flip(['oracle_rows', 'oracle_refs', 'oracle_sync']));
    foreach ($specs as &$spec) { $spec['access']['read'] = ['allow' => true]; }
    unset($spec);
    $db = new \\Zero\\Db($app->store(), new \\Zero\\Schema(['collections' => $specs]), $app->media(), 'wp');
    $viewer = new \\Zero\\Viewer(['id' => ${harness.users.editor.id}, 'name' => 'Editor', 'role' => 'editor'], 'wp');
    $code = 'transform-' . bin2hex(random_bytes(8));
    $hidden = $db->insert('oracle_rows', ['title' => $code, 'code' => $code], true)[0];
    $visible = $db->insert('oracle_rows', ['title' => $code . '-visible', 'code' => $code . '-visible', 'publicBadge' => random_int(1000000, 9000000)], true)[0];
    \\Zero\\Extensions::onRead(static function (array $rows, string $collection, ?\\Zero\\Viewer $viewer) use ($hidden): array {
      return $collection === 'oracle_rows' && $viewer !== null
        ? array_map(static fn (array $row): array => array_diff_key($row, ['code' => true, 'publicBadge' => true]),
          array_values(array_filter($rows, static fn (array $row): bool => $row['id'] !== $hidden['id']))) : $rows;
    });
    $result = [];
    foreach ([$code . '-visible', $code . '-free'] as $candidate) {
      try { $db->insert('oracle_rows', ['title' => $code . '-probe', 'code' => $candidate], false, $viewer); $result[] = null; }
      catch (\\Zero\\HttpError $error) { $result[] = [$error->status, $error->errorCode]; }
    }
    foreach ([$hidden['id'], 2147483647] as $target) {
      try { $db->insert('oracle_refs', ['title' => $code . '-probe', 'rowId' => $target], false, $viewer); $result[] = null; }
      catch (\\Zero\\HttpError $error) { $result[] = [$error->status, $error->errorCode]; }
    }
    $result[] = $db->findMany('oracle_refs', ['where' => ['title' => $code . '-probe']]);
    $db->insert('oracle_refs', ['title' => $code . '-visible', 'rowId' => $visible['id']], false, $viewer);
    $result[] = count($db->findMany('oracle_refs', ['where' => ['title' => $code . '-visible']]));
    foreach ([$visible['uid'], 'zr_00000000000000000000'] as $uid) {
      try {
        $db->current(static fn () => \\Zero\\Sync\\Wire::decode('oracle_sync', ['fields' => ['publicBadgeId' => $uid]], viewer: $viewer));
        $result[] = null;
      } catch (\\Zero\\HttpError $error) { $result[] = [$error->status, $error->errorCode]; }
    }
    echo wp_json_encode($result);
  `));
  assert.deepEqual(transformScope, [[403, "forbidden"], [403, "forbidden"], [409, "reference_violation"], [409, "reference_violation"], [], 1, [409, "reference_violation"], [409, "reference_violation"]],
    "read transforms cannot disclose hidden competitors or accept hidden reference targets; visible references still work");
  assert.deepEqual(constraintScope, [
    [403, "forbidden"], [403, "forbidden"], [403, "forbidden"],
    [409, "reference_violation"], [403, "forbidden"],
    [409, "reference_violation"], [403, "forbidden"], 0, true,
  ], "query extensions conceal unique competitors and incoming references, including empty branches and hidden resends");


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
  const id = zero("insert", "payroll", JSON.stringify({ title: `Alias ${run}`, salary: "1", notes: { open: "o", sealed: "s" } }))[0].id;
  const res = await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { acf: { zero_salary: "1", field_zero_payroll_salary: "999" } } });
  assert.equal(res.status, 403, JSON.stringify(res.json));
  assert.equal(zero("find", "payroll", JSON.stringify({ where: { id } }))[0].salary, "1");
  const equal = await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { acf: { zero_notes: { sealed: "s" }, field_zero_payroll_notes: { open: "changed" } } } });
  const other = await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { acf: { zero_notes: { sealed: "guess" }, field_zero_payroll_notes: { open: "changed" } } } });
  assert.deepEqual([equal.status, equal.json.data.pointer, other.status, other.json.data.pointer], [403, "/notes", 403, "/notes"]);
  assert.deepEqual(zero("find", "payroll", JSON.stringify({ where: { id } }))[0].notes, { open: "o", sealed: "s" });

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
  assert.equal((await http("GET", `${core}/zero_dossier?search=0&search_columns=post_content`)).status, 403, `"0" is a search too`);
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
  const invalid = await http("PATCH", `${api}/claims/${mine}`, { as: "author", body: { unexpected: {} } });
  assert.deepEqual([invalid.status, invalid.json.code, invalid.json.pointer], [422, "invalid_input", "/unexpected"]);
  assert.equal(wp("eval", `wp_set_current_user(${author}); var_export(current_user_can('edit_post', ${mine}));`), "false", "edit_post (revisions, wp-admin) stays strict");
  const jsonId = zero("insert", "claims", JSON.stringify({ title: `JSON cover ${run}`, meta: {} }))[0].id;
  const editor = await adminSession("admin");
  const allowed = await editor.save(jsonId, { post_title: `JSON cover ${run} edited`, post_type: "zero_claims" });
  assert.equal(allowed.status, 302);
  assert.equal(zero("find", "claims", JSON.stringify({ where: { id: jsonId } }))[0].title, `JSON cover ${run} edited`);
  const refused = await editor.save(jsonId, { post_title: "restricted", post_type: "zero_claims" });
  assert.equal(refused.status, 403, "a filter for [] cannot reuse authorization from a filter for {}");
  assert.equal(zero("find", "claims", JSON.stringify({ where: { id: jsonId } }))[0].title, `JSON cover ${run} edited`);

});

test("wp-admin's Custom Fields box can't write a Zero column", async () => {
  const id = zero("insert", "payroll", JSON.stringify({ title: `Meta ${run}`, salary: "1" }))[0].id;
  const editor = await adminSession("editor");
  const res = await editor.save(id, { post_title: `Meta ${run}`, post_type: "zero_payroll", metakeyinput: "zero_salary", metavalue: "999" });
  assert.equal(res.status, 302, "the rest of the save goes through");
  assert.equal(zero("find", "payroll", JSON.stringify({ where: { id } }))[0].salary, "1", "the protected meta key was ignored");
});

test("the classic editor neither shows nor erases content hidden from the editor", async () => {
  const id = zero("insert", "dossier", JSON.stringify({ title: `Native ${run}`, body: `<p>classified-${run} C:\\notes</p>` }))[0].id;
  const editor = await adminSession("editor");
  const page = await editor.get(`post.php?post=${id}&action=edit&classic-editor`);
  assert.equal(page.status, 200);
  const form = await page.text();
  assert.ok(form.includes(`Native ${run}`), "the edit screen loaded the post");
  assert.equal(form.includes(`classified-${run}`), false, "the hidden content isn't in the page");
  const saved = await editor.save(id, { post_title: `Native ${run} retitled`, post_type: "zero_dossier", content: "" });
  assert.equal(saved.status, 302);
  const row = zero("find", "dossier", JSON.stringify({ where: { id } }))[0];
  assert.deepEqual([row.title, row.body], [`Native ${run} retitled`, `<p>classified-${run} C:\\notes</p>`], "the blank control left the stored content alone, byte for byte");
  // A non-blank value for the hidden content is a write: refused the same, right guess or wrong.
  const right = await editor.save(id, { post_title: `Native ${run} retitled`, post_type: "zero_dossier", content: `<p>classified-${run} C:\\notes</p>` });
  const wrong = await editor.save(id, { post_title: `Native ${run} retitled`, post_type: "zero_dossier", content: "<p>guess</p>" });
  assert.deepEqual([right.status, wrong.status], [403, 403]);
  for (const occupied of [false, true]) {
    const slug = `form-slug-probe-${occupied}-${run}`;
    const draft = await http("POST", `${core}/zero_dossier`, { as: "admin", body: { title: "Form slug probe", slug, status: "draft" } });
    assert.equal(draft.status, 201, JSON.stringify(draft.json));
    if (occupied) {
      assert.equal((await http("POST", `${core}/zero_dossier`, { as: "admin", body: { title: "Occupied form slug", slug, status: "publish" } })).status, 201);
    }
    const publish = await editor.save(draft.json.id, { post_type: "zero_dossier", post_status: "publish" });
    assert.equal(publish.status, 403);
    assert.match(await publish.text(), /You can.*set slug/);
    assert.equal(zero("find", "dossier", JSON.stringify({ where: { id: draft.json.id } }))[0].status, "draft");
  }
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

test("restoring a hidden group is refused independently of whether its saved value matches", async () => {
  const id = zero("insert", "gated", JSON.stringify({ title: `Restore ${run}`, notes: { open: "old", sealed: "secret" } }))[0].id;
  zero("update", "gated", JSON.stringify({ id }), JSON.stringify({ title: `Restore ${run} v2`, notes: { open: "new", sealed: "secret" } }));
  const [revision] = JSON.parse(wp("eval", `echo wp_json_encode(array_keys(wp_get_post_revisions(${id}, ['order' => 'ASC'])));`));
  const editor = await adminSession("editor");
  const html = await (await editor.get(`revision.php?revision=${revision}`)).text();
  const match = html.match(/"restoreUrl":("[^"]*")/);
  assert.ok(match, "WordPress supplies the restore URL and its session nonce");
  const restore = JSON.parse(match[1]).replace(/^.*\/wp-admin\//, "");
  assert.equal((await editor.get(restore)).status, 403, "matching hidden value");
  zero("update", "gated", JSON.stringify({ id }), JSON.stringify({ notes: { open: "new", sealed: "different" } }));
  assert.equal((await editor.get(restore)).status, 403, "different hidden value");
  assert.deepEqual(zero("find", "gated", JSON.stringify({ where: { id } }))[0].notes, { open: "new", sealed: "different" });
});

test("autosaving one's own draft returns it without the fields hidden from the author of the save", async () => {
  const created = await http("POST", `${core}/zero_dossier`, { as: "admin", body: { author: harness.users.editor.id, title: `Draft ${run}`, status: "draft", content: `<p>draftword-${run}</p>` } });
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

test("protected visibility is batched and cached before core pagination", () => {
  const result: unknown = JSON.parse(wp("eval", `
    $db = \\Zero\\Wp\\Plugin::instance()->db();
    wp_set_current_user(0);
    $anon = new \\Zero\\Viewer(null);
    $ids = [];
    try {
      for ($i = 0; $i < 40; $i++) {
        $ids[] = wp_insert_post(['post_type' => 'zero_payroll', 'post_title' => 'Protected batch', 'post_status' => 'publish', 'post_password' => 'secret']);
      }
      $public = $db->insert('payroll', ['title' => 'Public batch'], true)[0]['id'];
      $ids[] = $public;
      wp_cache_flush();
      \\Zero\\Wp\\CoreAccess::flush();
      global $wpdb;
      $before = $wpdb->num_queries;
      $rows = $db->findMany('payroll', ['where' => ['id' => ['in' => $ids]], 'orderBy' => ['id' => 'asc'], 'limit' => 1], $anon);
      $queries = $wpdb->num_queries - $before;
      wp_cache_flush();
      \\Zero\\Wp\\CoreAccess::flush();
      $editor = new \\Zero\\Viewer(['id' => ${harness.users.editor.id}, 'name' => 'Editor', 'role' => 'editor'], 'wp');
      $failLookup = static fn ($sql) => preg_match('/^\\s*SELECT\\b/i', $sql) && str_contains($sql, $wpdb->posts)
        ? 'SELECT * FROM zero_missing_post_storage' : $sql;
      add_filter('query', $failLookup);
      $suppressed = $wpdb->suppress_errors(true);
      $refusals = [];
      try {
        foreach ([$anon, $editor] as $viewer) {
          try {
            $answer = $db->findFirst('payroll', ['where' => ['id' => $ids[0]]], $viewer);
            $refusals[] = $answer === null ? 'hidden' : 'allowed';
          } catch (\\Zero\\HttpError $e) {
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
      $request = new WP_REST_Request('GET', '/wp/v2/zero_payroll');
      $request->set_query_params(['include' => $ids, 'per_page' => 1, 'order' => 'asc', 'orderby' => 'id']);
      $native = rest_do_request($request);
      $hidden = rest_do_request(new WP_REST_Request('GET', '/wp/v2/zero_payroll/' . $ids[0]));
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

test("core meta and Zero's query args keep every denial: masks, hidden filters, drafts, read rules", async () => {
  const id = zero("insert", "payroll", JSON.stringify({ title: `Masked ${run}`, salary: "70k", notes: { open: "o", sealed: "s" } }))[0].id;
  // Field masks: `meta` drops what `acf` drops.
  const anon = (await http("GET", `${core}/zero_payroll/${id}`)).json;
  assert.deepEqual(["salary" in anon.meta, "notes" in anon.meta, "title" in anon.meta], [false, false, false]);
  assert.equal((await http("GET", `${core}/zero_payroll/${id}`, { as: "admin" })).json.meta.salary, "70k");
  // A filter, sort or relation through a hidden field is the facade's 403, never a probe.
  for (const params of [{ where: JSON.stringify({ salary: "70k" }) }, { orderBy: "salary" }, { where: JSON.stringify({ notes: { isNull: false } }) }]) {
    const r = await http("GET", `${core}/zero_payroll?` + new URLSearchParams(params), { as: "editor" });
    assert.deepEqual([r.status, r.json.code], [403, "forbidden"], JSON.stringify(params));
  }
  assert.deepEqual(ids(await http("GET", `${core}/zero_payroll?` + new URLSearchParams({ where: JSON.stringify({ salary: "70k", title: `Masked ${run}` }) }), { as: "admin" })), [id]);
  // A search leaves out fields hidden from the viewer: the salary can't be found by its value.
  assert.deepEqual((await http("GET", `${core}/zero_payroll?search=70k`, { as: "editor" })).json, []);
  // The read rule still filters: `where` can't widen what the author may read.
  const listed = await http("GET", `${core}/zero_ledger?` + new URLSearchParams({ where: JSON.stringify({ id: { in: [mine, theirs] } }) }), { as: "author" });
  assert.deepEqual(ids(listed), [mine]);
  assert.equal((await http("GET", `${core}/zero_vault?` + new URLSearchParams({ where: "{}" }))).status, 401);
  // Draft visibility: an anonymous `where` on status can't reveal a draft.
  const draft = zero("insert", "posts", JSON.stringify({ title: `Draft ${run}`, status: "draft" }))[0].id;
  const anonDraft = await http("GET", `${core}/zero_posts?` + new URLSearchParams({ where: JSON.stringify({ id: draft, status: "draft" }), status: "draft" }));
  assert.ok(anonDraft.status >= 400 || anonDraft.json.length === 0, JSON.stringify(anonDraft.json));
  assert.deepEqual((await http("GET", `${core}/zero_posts?` + new URLSearchParams({ where: JSON.stringify({ id: draft }) }))).json, []);
  // Meta writes are authorized like `acf` ones: a hidden field can't be written, even unchanged.
  const write = await http("POST", `${core}/zero_payroll/${id}`, { as: "editor", body: { meta: { salary: "70k" } } });
  assert.deepEqual([write.status, write.json.data?.pointer], [403, "/salary"]);
  const twice = await http("POST", `${core}/zero_payroll/${id}`, { as: "admin", body: { meta: { salary: "1" }, acf: { zero_salary: "2" } } });
  assert.deepEqual([twice.status, twice.json.data?.pointer], [403, "/salary"], "one field, one selector");
});
