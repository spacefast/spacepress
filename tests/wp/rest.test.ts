// WordPress lane of the shared blog scenario (design §9.1): the same function the standalone lane
// runs, driven by the generated typed client over /wp-json/zero/v1 with application passwords.
// Promotion is WordPress's own: `future` post + its cron event, run through WP-CLI.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../examples/blog/zero/client/index.ts";
import { blogScenario, type ScenarioRole } from "../e2e/blog-scenario.ts";
import { api, auth, harness, ok, run, sql, wp, zero } from "./env.ts";

before(() => {
  // The scenario's author owns an `authors` row (authors are admin-only over the API; the CLI is trusted).
  const userId = harness.users.author.id;
  if (zero("find", "authors", JSON.stringify({ where: { userId } })).length === 0) {
    zero("insert", "authors", JSON.stringify({ name: "Author", email: `author-${userId}@example.test`, userId }));
  }
});

test("blog scenario over /wp-json/zero/v1", async (t) => {
  await blogScenario(
    {
      target: "wp",
      client: (role: ScenarioRole) =>
        createClient({ url: api, headers: role === "anonymous" ? {} : auth(role) }),
      async promoteDue(at: string) {
        // The clock can't move, so pull each due post's date into the past, let WP cron publish it
        // (`publish_future_post` only publishes once post_date_gmt has passed), then put the date back.
        const due = at.slice(0, 19).replace("T", " ");
        const ids = sql(`SELECT ID FROM wp_posts WHERE post_type = 'zero_posts' AND post_status = 'future' AND post_date_gmt <= '${due}'`).map((r) => Number(r.ID));
        for (const id of ids) {
          sql(`UPDATE wp_posts SET post_date_gmt = '2000-01-01 00:00:00', post_date = '2000-01-01 00:00:00' WHERE ID = ${id}`);
          wp("cron", "event", "schedule", "publish_future_post", "now", `--0=${id}`);
        }
        wp("cron", "event", "run", "--due-now");
        for (const id of ids) {
          sql(`UPDATE wp_posts SET post_date_gmt = '${due}', post_date = '${due}' WHERE ID = ${id}`);
        }
        wp("cache", "flush");
      },
    },
    t,
  );
});

// §6.3: WP cron's publish_future_post is promotion, not an edit: no hooks (the test app's posts hooks
// comment on "Audit" posts), no generated values, no revision. Native posts keep core's behaviour.
test("WP cron promotion runs no Zero hooks, fills nothing and writes no revision", async () => {
  const at = new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
  const post = await ok("POST", "/posts", { as: "editor", body: { title: `Audit promoted ${run}`, status: "scheduled", publishedAt: at } });
  const native = Number(wp("post", "create", "--post_type=post", "--post_title=Native promoted", "--post_status=future", `--post_date_gmt=${at.slice(0, 19).replace("T", " ")}`, "--porcelain"));
  sql(`UPDATE wp_postmeta SET meta_value = '2001-01-01 00:00:00' WHERE post_id = ${post.id} AND meta_key = 'zero_updatedAt'`);
  wp("cache", "flush");
  const trace = async () => ({
    row: await ok("GET", `/posts/${post.id}?with=comments`, { as: "editor" }).then((r) => ({ updatedAt: r.updatedAt, comments: r.comments.map((c: any) => c.name) })),
    revisions: (await ok("GET", `/posts/${post.id}/revisions`, { as: "editor" })).length,
  });
  const before = await trace();
  const nativeRevisions = () => Number(wp("eval", `echo count(wp_get_post_revisions(${native}));`));
  const nativeBefore = nativeRevisions();
  for (const id of [post.id, native]) {
    sql(`UPDATE wp_posts SET post_date_gmt = '2000-01-01 00:00:00', post_date = '2000-01-01 00:00:00' WHERE ID = ${id}`);
    wp("cron", "event", "schedule", "publish_future_post", "now", `--0=${id}`);
  }
  wp("cron", "event", "run", "--due-now");
  wp("cache", "flush");
  assert.equal((await ok("GET", `/posts/${post.id}`, { as: "editor" })).status, "published");
  assert.deepEqual(await trace(), { ...before, row: { updatedAt: "2001-01-01T00:00:00.000Z", comments: ["afterCreate"] } });
  assert.equal(wp("post", "get", String(native), "--field=post_status"), "publish");
  assert.equal(nativeRevisions(), nativeBefore + 1, "core revises the native post as usual");
  wp("post", "delete", String(native), "--force");
});

// §6.1 on WordPress: Zero keeps its explicit "published" (core would make a future date `future`), and
// only for its own write: a post a save hook writes meanwhile is scheduled by core as usual.
test("Zero's explicit status applies to its own write, not to posts written from its save hooks", () => {
  const [zeroStatus, nested] = JSON.parse(wp("eval", `
    $at = gmdate('Y-m-d H:i:s', time() + 7200);
    $nested = null;
    $hook = static function () use ($at, &$nested): void {
      if ($nested === null) {
        $nested = -1;
        $nested = wp_insert_post(['post_type' => 'post', 'post_title' => 'Native nested', 'post_status' => 'publish', 'post_date_gmt' => $at, 'post_date' => get_date_from_gmt($at)]);
      }
    };
    add_action('save_post_zero_posts', $hook);
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    [, , $out] = \\Zero\\Wp\\Plugin::instance()->app()->handle('POST', '/posts', [], wp_json_encode(['title' => 'Explicit status', 'status' => 'published', 'publishedAt' => str_replace(' ', 'T', $at) . '.000Z']));
    remove_action('save_post_zero_posts', $hook);
    $status = json_decode($out, true)['data']['status'];
    $native = get_post_status($nested);
    wp_delete_post($nested, true);
    echo wp_json_encode([$status, $native]);
  `));
  assert.deepEqual([zeroStatus, nested], ["published", "future"]);
});
