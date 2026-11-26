// One request = one transaction (§3.3): a hook that throws after wp_insert_post rolls the post, its
// meta and its revision back, and the object cache doesn't keep a ghost of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { api, core, http, problem, run, sql, wp, first } from "./env.ts";

test("a hook throwing after wp_insert_post leaves no post behind", async () => {
  const max = () => Number(sql("SELECT COALESCE(MAX(ID), 0) AS m FROM wp_posts")[0].m);
  const before = max();
  // The test app's posts.afterCreate throws for this title, after the post and its meta are written.
  await problem("POST", "/posts", { as: "editor", body: { title: "Explode", excerpt: "doomed", tags: ["news"] } }, { status: 500, code: "boom", pointer: undefined });
  assert.deepEqual(sql(`SELECT ID FROM wp_posts WHERE ID > ${before}`), []);
  assert.deepEqual(sql(`SELECT meta_id FROM wp_postmeta WHERE post_id > ${before}`), []);
  assert.deepEqual((await http("GET", api + "/posts" + "?where=" + encodeURIComponent(JSON.stringify({ title: "Explode" })), { as: "editor" })).json.data, []);
  assert.equal(wp("post", "list", "--post_type=sp_posts", "--post_status=any", "--title=Explode", "--format=count"), "0");
});

test("extension effects share WordPress transactions and commit callbacks", () => {
  const result = JSON.parse(wp("eval", `
    $app = \\SpacePress\\Wp\\Plugin::instance()->app();
    $db = $app->db;
    \\SpacePress\\Extensions::onWritten(static function (string $op, string $c, array $row) use ($db): void {
      if ($c !== 'posts' || $row['title'] !== 'Extension rollback') { return; }
      $db->insert('comments', ['postId' => $row['id'], 'name' => 'extension', 'body' => 'nested']);
      \\SpacePress\\Extensions::afterCommit(static fn () => update_option('sp_seam_commit', 'wrong', false));
      throw new \\SpacePress\\JsError('rollback extension');
    });
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    [$status] = $app->handle('POST', '/posts', [], wp_json_encode(['title' => 'Extension rollback']));
    $afterRollback = get_option('sp_seam_commit', 'absent');
    $during = null;
    $db->transaction(static function () use ($db, &$during): void {
      \\SpacePress\\Extensions::afterCommit(static fn () => update_option('sp_seam_commit', 'committed', false));
      $db->transaction(static function (): void {
        \\SpacePress\\Extensions::afterCommit(static fn () => update_option('sp_seam_nested', get_option('sp_seam_commit'), false));
      });
      $during = get_option('sp_seam_commit', 'absent');
    });
    echo wp_json_encode([
      $status, $db->findMany('posts', ['where' => ['title' => 'Extension rollback']]),
      $db->findMany('comments', ['where' => ['name' => 'extension']]),
      $afterRollback, $during, get_option('sp_seam_commit'), get_option('sp_seam_nested')
    ]);
    delete_option('sp_seam_commit'); delete_option('sp_seam_nested');
  `));
  assert.deepEqual(result, [422, [], [], "absent", "absent", "committed", "committed"]);
});

// Editor saves (§1.7: throwing rolls back every write): the same holds when the save comes from
// core /wp/v2 or wp-admin. Fixture: tests/wp/app/sp/lanes/rest.ts `fuses`, whose hooks log, then throw.
const logged = (msg: string) => sql(`SELECT COUNT(*) AS n FROM wp_sp_fuse_log WHERE msg = '${msg}'`)[0].n;
const titled = (title: string) => wp("post", "list", "--post_type=sp_fuses", "--post_status=any", `--title=${title}`, "--format=count");

test("a hook throwing on a core REST create is a 4xx with its message, and nothing persists", async () => {
  const maxId = Number(sql("SELECT COALESCE(MAX(ID), 0) AS m FROM wp_posts")[0].m);
  const res = await http("POST", `${core}/sp_fuses`, { as: "editor", body: { title: `Explode ${run}`, status: "publish", acf: { sp_note: "doomed" } } });
  assert.deepEqual([res.status, res.json.code, res.json.message], [422, "boom", "afterCreate refused this"]);
  assert.deepEqual(sql(`SELECT ID FROM wp_posts WHERE ID > ${maxId}`), [], "no post and no revision");
  assert.deepEqual(sql(`SELECT meta_id FROM wp_postmeta WHERE post_id > ${maxId}`), [], "no meta");
  assert.equal(logged(`created Explode ${run}`), "0", "the hook's own write rolled back");
});

test("a hook throwing on a core REST update leaves the post, its meta and its revisions as they were", async () => {
  const id = first("insert", "fuses", JSON.stringify({ title: `Steady ${run}`, note: "kept" }))[0].id;
  const revisions = () => sql(`SELECT COUNT(*) AS n FROM wp_posts WHERE post_parent = ${id} AND post_type = 'revision'`)[0].n;
  const before = revisions();
  const res = await http("POST", `${core}/sp_fuses/${id}`, { as: "editor", body: { title: `Explode later ${run}`, acf: { sp_note: "changed" } } });
  assert.deepEqual([res.status, res.json.code], [422, "boom"]);
  assert.deepEqual([wp("post", "get", String(id), "--field=post_title"), wp("post", "meta", "get", String(id), "sp_note"), revisions(), logged(`updated Explode later ${run}`)],
    [`Steady ${run}`, "kept", before, "0"]);
  // Within one request too: no cache keeps the rolled-back values.
  const same = JSON.parse(wp("eval", `
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    $r = new WP_REST_Request('POST', '/wp/v2/sp_fuses/${id}');
    $r->set_body_params(['title' => 'Explode cached ${run}', 'acf' => ['sp_note' => 'cached']]);
    $status = rest_do_request($r)->get_status();
    echo wp_json_encode([$status, get_post(${id})->post_title, get_post_meta(${id}, 'sp_note', true), \\SpacePress\\Wp\\Plugin::instance()->db()->findFirst('fuses', ['where' => ['id' => ${id}]])['note']]);
  `));
  assert.deepEqual(same, [422, `Steady ${run}`, "kept", "kept"]);
});

test("a hook throwing on a core delete keeps the post, and its beforeDelete write rolls back", async () => {
  const id = first("insert", "fuses", JSON.stringify({ title: `Keep ${run}` }))[0].id;
  const res = await http("DELETE", `${core}/sp_fuses/${id}?force=true`, { as: "editor" });
  assert.deepEqual([res.status, res.json.code, res.json.message], [409, "kept", "afterDelete refused this"]);
  assert.deepEqual([wp("post", "get", String(id), "--field=post_status"), logged(`deleting Keep ${run}`)], ["publish", "0"]);
});

test("a hook refusing a core REST delete inside an open transaction aborts that transaction", () => {
  const id = first("insert", "fuses", JSON.stringify({ title: `Keep nested ${run}` }))[0].id;
  const out = JSON.parse(wp("eval", `
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    $db = \\SpacePress\\Wp\\Plugin::instance()->db();
    try {
      $db->transaction(static function () use ($db) {
        $db->insert('fuse_log', ['msg' => 'outer ${run}']);
        $request = new WP_REST_Request('DELETE', '/wp/v2/sp_fuses/${id}');
        $request->set_query_params(['force' => true]);
        return rest_do_request($request);
      });
      $caught = null;
    } catch (Throwable $e) { $caught = $e->getMessage(); }
    clean_post_cache(${id});
    echo wp_json_encode([$caught, get_post_status(${id})]);
  `));
  assert.deepEqual(out, ["afterDelete refused this", "publish"]);
  assert.deepEqual([logged(`outer ${run}`), logged(`deleting Keep nested ${run}`)], ["0", "0"], "the enclosing work rolled back too");
});

test("a hook throwing on a wp-admin style save gets an error page, not a critical error, and saves nothing", () => {
  const out = JSON.parse(wp("eval", `
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    add_filter('wp_die_handler', fn () => static function ($message, $title, $args) { throw new RuntimeException(wp_json_encode([$args['response'] ?? null, (string) $message])); });
    try { wp_insert_post(['post_type' => 'sp_fuses', 'post_title' => 'Explode admin ${run}', 'post_status' => 'publish'], true); $died = null; }
    catch (RuntimeException $e) { $died = json_decode($e->getMessage(), true); }
    echo wp_json_encode([$died, (int) (new WP_Query(['post_type' => 'sp_fuses', 'title' => 'Explode admin ${run}', 'post_status' => 'any', 'fields' => 'ids']))->found_posts]);
  `));
  assert.deepEqual(out, [[422, "afterCreate refused this"], 0]);
  assert.equal(logged(`created Explode admin ${run}`), "0");
});
