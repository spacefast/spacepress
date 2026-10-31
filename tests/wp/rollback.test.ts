// One request = one transaction (§3.3): a hook that throws after wp_insert_post rolls the post, its
// meta and its revision back, and the object cache doesn't keep a ghost of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { api, core, http, problem, run, sql, wp, zero } from "./env.ts";

test("a hook throwing after wp_insert_post leaves no post behind", async () => {
  const max = () => Number(sql("SELECT COALESCE(MAX(ID), 0) AS m FROM wp_posts")[0].m);
  const before = max();
  // The test app's posts.afterCreate throws for this title, after the post and its meta are written.
  await problem("POST", "/posts", { as: "editor", body: { title: "Explode", excerpt: "doomed", tags: ["news"] } }, { status: 500, code: "boom", pointer: undefined });
  assert.deepEqual(sql(`SELECT ID FROM wp_posts WHERE ID > ${before}`), []);
  assert.deepEqual(sql(`SELECT meta_id FROM wp_postmeta WHERE post_id > ${before}`), []);
  assert.deepEqual((await http("GET", api + "/posts" + "?where=" + encodeURIComponent(JSON.stringify({ title: "Explode" })), { as: "editor" })).json.data, []);
  assert.equal(wp("post", "list", "--post_type=zero_posts", "--post_status=any", "--title=Explode", "--format=count"), "0");
});

test("extension effects share WordPress transactions and commit callbacks", () => {
  const result = JSON.parse(wp("eval", `
    $app = \\Zero\\Wp\\Plugin::instance()->app();
    $db = $app->db;
    \\Zero\\Extensions::onWritten(static function (string $op, string $c, array $row) use ($db): void {
      if ($c !== 'posts' || $row['title'] !== 'Extension rollback') { return; }
      $db->insert('comments', ['postId' => $row['id'], 'name' => 'extension', 'body' => 'nested']);
      \\Zero\\Extensions::afterCommit(static fn () => update_option('zero_seam_commit', 'wrong', false));
      throw new \\Zero\\JsError('rollback extension');
    });
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    [$status] = $app->handle('POST', '/posts', [], wp_json_encode(['title' => 'Extension rollback']));
    $afterRollback = get_option('zero_seam_commit', 'absent');
    $during = null;
    $db->transaction(static function () use ($db, &$during): void {
      \\Zero\\Extensions::afterCommit(static fn () => update_option('zero_seam_commit', 'committed', false));
      $db->transaction(static function (): void {
        \\Zero\\Extensions::afterCommit(static fn () => update_option('zero_seam_nested', get_option('zero_seam_commit'), false));
      });
      $during = get_option('zero_seam_commit', 'absent');
    });
    echo wp_json_encode([
      $status, $db->findMany('posts', ['where' => ['title' => 'Extension rollback']]),
      $db->findMany('comments', ['where' => ['name' => 'extension']]),
      $afterRollback, $during, get_option('zero_seam_commit'), get_option('zero_seam_nested')
    ]);
    delete_option('zero_seam_commit'); delete_option('zero_seam_nested');
  `));
  assert.deepEqual(result, [422, [], [], "absent", "absent", "committed", "committed"]);
});

// Editor saves (§1.7: throwing rolls back every write): the same holds when the save comes from
// core /wp/v2 or wp-admin. Fixture: tests/wp/app/lanes/rest.ts `fuses`, whose hooks log, then throw.
const logged = (msg: string) => sql(`SELECT COUNT(*) AS n FROM wp_zero_fuse_log WHERE msg = '${msg}'`)[0].n;
const titled = (title: string) => wp("post", "list", "--post_type=zero_fuses", "--post_status=any", `--title=${title}`, "--format=count");

test("a hook throwing on a core REST create is a 4xx with its message, and nothing persists", async () => {
  const res = await http("POST", `${core}/zero_fuses`, { as: "editor", body: { title: `Explode ${run}`, status: "publish" } });
  assert.deepEqual([res.status, res.json.code, res.json.message], [422, "boom", "afterCreate refused this"]);
  assert.deepEqual([titled(`Explode ${run}`), logged(`created Explode ${run}`)], ["0", "0"], "the post, its meta and the hook's own write rolled back");
});

test("a hook throwing on a core REST update leaves the post as it was", async () => {
  const id = zero("insert", "fuses", JSON.stringify({ title: `Steady ${run}` }))[0].id;
  const res = await http("POST", `${core}/zero_fuses/${id}`, { as: "editor", body: { title: `Explode later ${run}` } });
  assert.deepEqual([res.status, res.json.code], [422, "boom"]);
  assert.deepEqual([wp("post", "get", String(id), "--field=post_title"), logged(`updated Explode later ${run}`)], [`Steady ${run}`, "0"]);
});

test("a hook throwing on a core delete keeps the post, and its beforeDelete write rolls back", async () => {
  const id = zero("insert", "fuses", JSON.stringify({ title: `Keep ${run}` }))[0].id;
  const res = await http("DELETE", `${core}/zero_fuses/${id}?force=true`, { as: "editor" });
  assert.deepEqual([res.status, res.json.code, res.json.message], [409, "kept", "afterDelete refused this"]);
  assert.deepEqual([wp("post", "get", String(id), "--field=post_status"), logged(`deleting Keep ${run}`)], ["publish", "0"]);
});

test("a hook throwing on a wp-admin style save gets an error page, not a critical error, and saves nothing", () => {
  const out = JSON.parse(wp("eval", `
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    add_filter('wp_die_handler', fn () => static function ($message, $title, $args) { throw new RuntimeException(wp_json_encode([$args['response'] ?? null, (string) $message])); });
    try { wp_insert_post(['post_type' => 'zero_fuses', 'post_title' => 'Explode admin ${run}', 'post_status' => 'publish'], true); $died = null; }
    catch (RuntimeException $e) { $died = json_decode($e->getMessage(), true); }
    echo wp_json_encode([$died, (int) (new WP_Query(['post_type' => 'zero_fuses', 'title' => 'Explode admin ${run}', 'post_status' => 'any', 'fields' => 'ids']))->found_posts]);
  `));
  assert.deepEqual(out, [[422, "afterCreate refused this"], 0]);
  assert.equal(logged(`created Explode admin ${run}`), "0");
});
