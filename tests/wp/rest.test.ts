// WordPress lane of the blog scenario (design §9.1): the shared function in tests/e2e/blog-scenario.ts
// runs, driven by the generated typed client over /wp-json/first/v1 with application passwords.
// Promotion is WordPress's own: `future` post + its cron event, run through WP-CLI.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "./app/first/_generated/client/index.ts";
import { blogScenario, type ScenarioRole } from "../e2e/blog-scenario.ts";
import { api, auth, harness, ok, run, sql, wp, first } from "./env.ts";

before(() => {
  // The scenario's author owns an `authors` row (authors are admin-only over the API; the CLI is trusted).
  const userId = harness.users.author.id;
  if (first("find", "authors", JSON.stringify({ where: { userId } })).length === 0) {
    first("insert", "authors", JSON.stringify({ name: "Author", email: `author-${userId}@example.test`, userId }));
  }
});

test("blog scenario over /wp-json/first/v1", async (t) => {
  await blogScenario(
    {
      client: (role: ScenarioRole) =>
        createClient({ url: api, headers: role === "anonymous" ? {} : auth(role) }),
      async promoteDue(at: string) {
        // The clock can't move, so pull each due post's date into the past, let WP cron publish it
        // (`publish_future_post` only publishes once post_date_gmt has passed), then put the date back.
        const due = at.slice(0, 19).replace("T", " ");
        const ids = sql(`SELECT ID FROM wp_posts WHERE post_type = 'first_posts' AND post_status = 'future' AND post_date_gmt <= '${due}'`).map((r) => Number(r.ID));
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
test("WP cron promotion runs no First hooks, fills nothing and writes no revision", async () => {
  const at = new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
  const post = await ok("POST", "/posts", { as: "editor", body: { title: `Audit promoted ${run}`, status: "scheduled", publishedAt: at } });
  const native = Number(wp("post", "create", "--post_type=post", "--post_title=Native promoted", "--post_status=future", `--post_date_gmt=${at.slice(0, 19).replace("T", " ")}`, "--porcelain"));
  sql(`UPDATE wp_postmeta SET meta_value = '2001-01-01 00:00:00' WHERE post_id = ${post.id} AND meta_key = 'first_updatedAt'`);
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
  const noticeLog = () => wp("eval", "$f = WP_CONTENT_DIR . '/first-test-realtime.jsonl'; echo is_file($f) ? file_get_contents($f) : '';");
  const noticesBefore = noticeLog().split("\n").filter(Boolean).length;
  wp("cron", "event", "run", "--due-now");
  wp("cache", "flush");
  assert.equal((await ok("GET", `/posts/${post.id}`, { as: "editor" })).status, "published");
  // Promotion runs no hooks, but watchers still hear that the row changed.
  const promoted = noticeLog().split("\n").filter(Boolean).slice(noticesBefore).map((l) => JSON.parse(l).changes).flat();
  assert.deepEqual(promoted.filter((c: { collection: string }) => c.collection === "posts"), [{ collection: "posts", ops: ["update"], ids: [post.id] }]);
  assert.deepEqual(await trace(), { ...before, row: { updatedAt: "2001-01-01T00:00:00.000Z", comments: ["afterCreate"] } });
  assert.equal(wp("post", "get", String(native), "--field=post_status"), "publish");
  assert.equal(nativeRevisions(), nativeBefore + 1, "core revises the native post as usual");
  wp("post", "delete", String(native), "--force");
});

// §6.1 on WordPress: First keeps its explicit "published" (core would make a future date `future`), and
// only for its own write: a post a save hook writes meanwhile is scheduled by core as usual.
test("First's explicit status applies to its own write, not to posts written from its save hooks", () => {
  const [firstStatus, nested] = JSON.parse(wp("eval", `
    $at = gmdate('Y-m-d H:i:s', time() + 7200);
    $nested = null;
    $hook = static function () use ($at, &$nested): void {
      if ($nested === null) {
        $nested = -1;
        $nested = wp_insert_post(['post_type' => 'post', 'post_title' => 'Native nested', 'post_status' => 'publish', 'post_date_gmt' => $at, 'post_date' => get_date_from_gmt($at)]);
      }
    };
    add_action('save_post_first_posts', $hook);
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    [, , $out] = \\First\\Wp\\Plugin::instance()->app()->handle('POST', '/posts', [], wp_json_encode(['title' => 'Explicit status', 'status' => 'published', 'publishedAt' => str_replace(' ', 'T', $at) . '.000Z']));
    remove_action('save_post_first_posts', $hook);
    $status = json_decode($out, true)['data']['status'];
    $native = get_post_status($nested);
    wp_delete_post($nested, true);
    echo wp_json_encode([$status, $native]);
  `));
  assert.deepEqual([firstStatus, nested], ["published", "future"]);
});

// WordPress sends its CORS headers from `rest_pre_serve_request` (`rest_send_cors_headers`, priority 10).
// First serves its own body from the same filter and must run after it: a body echoed first leaves a
// cross-origin caller without `Access-Control-Allow-Origin`, `Allow-Credentials` and `Vary: Origin`,
// so the browser discards the response.
test("a cross-origin First response carries WordPress's CORS headers", async () => {
  const origin = JSON.parse(wp("eval", "echo wp_json_encode(get_allowed_http_origins());"))[0] as string;
  for (const [method, path, init] of [
    ["GET", "", {}],
    ["GET", "/posts", {}],
    ["POST", "/posts", { headers: { ...auth("editor"), "content-type": "application/json" }, body: JSON.stringify({ title: `CORS ${run}` }) }],
  ] as const) {
    const res = await fetch(`${api}${path}`, { ...init, method, headers: { ...(init as RequestInit).headers, origin } });
    const body = await res.json();
    assert.ok(res.status < 300, `${method} ${path} → ${res.status} ${JSON.stringify(body)}`);
    assert.ok("data" in body, `${method} ${path}: First's own body is served`);
    assert.equal(res.headers.get("access-control-allow-origin"), origin, `${method} ${path}`);
    assert.equal(res.headers.get("access-control-allow-credentials"), "true", `${method} ${path}`);
    assert.match(res.headers.get("vary") ?? "", /Origin/, `${method} ${path}`);
  }
});
