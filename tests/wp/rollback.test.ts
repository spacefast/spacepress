// One request = one transaction (§3.3): a hook that throws after wp_insert_post rolls the post, its
// meta and its revision back, and the object cache doesn't keep a ghost of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { api, http, problem, sql, wp } from "./env.ts";

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
