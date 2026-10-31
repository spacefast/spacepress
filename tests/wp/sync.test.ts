// Content sync on real WordPress (design §5.3): uid meta on posts, the /sync routes over
// /wp-json/zero/v1 with application passwords, Markdown bodies stored as Gutenberg blocks, reference
// uids, WordPress trash and restore, and a post created in the editor gaining a uid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { api, core, http, ok, problem, qs, run, sql, wp, wpTry, zero } from "./env.ts";

const canon = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const keys = Object.keys(v).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`;
};
const digest = (record: unknown) => "sha256:" + createHash("sha256").update(canon(record)).digest("hex");
const uidOf = (n: number) => "zr_" + createHash("sha256").update(run + ":" + n).digest("hex").slice(0, 20);

async function pull(collection: string): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  let after = 0;
  for (;;) {
    const page = await ok("GET", `/sync/${collection}` + qs({ after: String(after), first: "50" }), { as: "editor" });
    for (const item of page.records) out.set(item.uid ?? item.record.uid, item);
    if (page.next === null) return out;
    after = page.next;
  }
}

const push = (record: unknown, expect: string) => http("POST", `${api}/sync/guides`, { as: "editor", body: { record, expect } });

test("sync on WordPress", async (t) => {
  const writer = zero("insert", "writers", JSON.stringify({ name: `Writer ${run}` }))[0];
  const guideUid = uidOf(1);
  const record = {
    uid: guideUid,
    fields: { title: `Guide ${run}`, slug: `guide-${run}`, summary: null, level: "intro", writerId: writer.uid, status: "draft", publishedAt: null },
    body: `# Getting started\n\nInstall **Zero** and run [the CLI](https://example.test/cli).\n\n- build\n- sync\n`,
  };

  await t.test("site id and uids", async () => {
    const schema = await ok("GET", "/_schema");
    assert.match(schema.site.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal((await ok("GET", "/_schema")).site.id, schema.site.id);
    assert.match(writer.uid, /^zr_[0-9a-f]{20}$/);
    const meta = sql(`SELECT meta_value FROM wp_postmeta WHERE post_id = ${writer.id} AND meta_key = '_zero_uid'`);
    assert.deepEqual(meta, [{ meta_value: writer.uid }], "the uid lives in _zero_uid meta, not an SCF field");
    await problem("PATCH", `/writers/${writer.id}`, { as: "admin", body: { uid: uidOf(99) } }, { status: 422, code: "invalid_input", pointer: "/uid" });
    const hooked = zero("insert", "guides", JSON.stringify({ title: `Hooked ${run}`, slug: `hooked-${run}` }))[0];
    await problem("PATCH", `/guides/${hooked.id}`, { as: "editor", body: { title: "steal uid" } }, { status: 422, code: "invalid_input", pointer: "/uid" });
    assert.deepEqual(sql(`SELECT p.post_title, m.meta_value FROM wp_posts p JOIN wp_postmeta m ON m.post_id = p.ID AND m.meta_key = '_zero_uid' WHERE p.ID = ${hooked.id}`),
      [{ post_title: `Hooked ${run}`, meta_value: hooked.uid }], "a hook's uid rewrite rolls back the post and its uid");
  });

  let created: any;
  await t.test("push creates a draft post with blocks and a resolved reference", async () => {
    const r = await push(record, "absent");
    assert.equal(r.status, 201, JSON.stringify(r.json));
    created = r.json.data;
    assert.deepEqual([created.status, created.uid, created.digest], ["applied", guideUid, digest(record)]);
    const [post] = sql(`SELECT p.ID, p.post_status, p.post_content, m.meta_value AS writer FROM wp_posts p
      JOIN wp_postmeta m ON m.post_id = p.ID AND m.meta_key = 'zero_writerId'
      JOIN wp_postmeta u ON u.post_id = p.ID AND u.meta_key = '_zero_uid' AND u.meta_value = '${guideUid}'`);
    assert.equal(post.post_status, "draft");
    assert.equal(post.writer, String(writer.id));
    assert.match(post.post_content, /^<!-- wp:heading \{"level":1\} -->\\n<h1 class="wp-block-heading">Getting started<\/h1>/);
  });

  await t.test("pull returns every status as the pushed record", async () => {
    const item = (await pull("guides")).get(guideUid);
    assert.deepEqual(item, { record, digest: created.digest, trashed: false });
    await problem("GET", "/sync/guides", { as: "author" }, { status: 403, code: "forbidden", pointer: undefined });
  });

  await t.test("an editor's change in WordPress is pulled as Markdown and makes a stale push conflict", async () => {
    const [{ ID }] = sql(`SELECT post_id AS ID FROM wp_postmeta WHERE meta_key = '_zero_uid' AND meta_value = '${guideUid}'`);
    const blocks = `<!-- wp:heading -->\n<h2 class="wp-block-heading">Edited in WordPress</h2>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>By an <strong>editor</strong>.</p>\n<!-- /wp:paragraph -->`;
    const saved = await http("POST", `${core}/zero_guides/${ID}`, { as: "editor", body: { content: blocks, title: `Guide ${run} (edited)` } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const item = (await pull("guides")).get(guideUid);
    assert.equal(item.record.body, "## Edited in WordPress\n\nBy an **editor**.\n");
    assert.equal(item.record.fields.title, `Guide ${run} (edited)`);
    const stale = await push({ ...record, fields: { ...record.fields, summary: "local" } }, created.digest);
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, "sync_stale");
    assert.deepEqual(stale.json.current, { record: item.record, digest: item.digest });
    created = item;
  });

  await t.test("blocks Markdown can't carry are refused by name, never dropped", async () => {
    const [{ ID }] = sql(`SELECT post_id AS ID FROM wp_postmeta WHERE meta_key = '_zero_uid' AND meta_value = '${guideUid}'`);
    const table = `<!-- wp:table -->\n<figure class="wp-block-table"><table><tbody><tr><td>a</td></tr></tbody></table></figure>\n<!-- /wp:table -->`;
    await http("POST", `${core}/zero_guides/${ID}`, { as: "editor", body: { content: table } });
    const item = (await pull("guides")).get(guideUid);
    assert.equal(item.refused, "not_representable");
    assert.match(item.message, /core\/table/);
    await problem("POST", "/sync/guides", { as: "editor", body: { record, expect: created.digest } }, { status: 409, code: "sync_stale", pointer: undefined });
    await http("POST", `${core}/zero_guides/${ID}`, { as: "editor", body: { content: "<!-- wp:paragraph -->\n<p>Plain again.</p>\n<!-- /wp:paragraph -->" } });
    created = (await pull("guides")).get(guideUid);
    assert.equal(created.record.body, "Plain again.\n");
  });

  await t.test("a post created in wp-admin gains a uid", async () => {
    const id = Number(wp("post", "create", "--post_type=zero_guides", `--post_title=Admin ${run}`, "--post_status=publish", "--user=editor", "--porcelain"));
    const [meta] = sql(`SELECT meta_value FROM wp_postmeta WHERE post_id = ${id} AND meta_key = '_zero_uid'`);
    assert.match(meta.meta_value, /^zr_[0-9a-f]{20}$/);
    assert.equal((await pull("guides")).get(meta.meta_value).record.fields.title, `Admin ${run}`);
  });

  await t.test("trash moves the post to the WordPress trash; pushing it again restores it", async () => {
    await problem("POST", "/sync/guides/trash", { as: "editor", body: { uid: guideUid, expect: "sha256:" + "0".repeat(64) } }, { status: 409, code: "sync_stale", pointer: undefined });
    const trashed = await ok("POST", "/sync/guides/trash", { as: "editor", body: { uid: guideUid, expect: created.digest } });
    assert.equal(trashed.status, "applied");
    const [post] = sql(`SELECT p.post_status FROM wp_posts p JOIN wp_postmeta u ON u.post_id = p.ID AND u.meta_key = '_zero_uid' AND u.meta_value = '${guideUid}'`);
    assert.equal(post.post_status, "trash");
    assert.deepEqual((await pull("guides")).get(guideUid), { uid: guideUid, record: null, digest: null, trashed: true });

    const restored = await push(record, "absent");
    assert.equal(restored.status, 200, JSON.stringify(restored.json));
    assert.equal(restored.json.data.status, "applied");
    const [back] = sql(`SELECT p.post_status FROM wp_posts p JOIN wp_postmeta u ON u.post_id = p.ID AND u.meta_key = '_zero_uid' AND u.meta_value = '${guideUid}'`);
    assert.equal(back.post_status, "draft", "restored in place, as the pushed draft");
    assert.equal(sql(`SELECT COUNT(*) AS n FROM wp_postmeta WHERE meta_key = '_zero_uid' AND meta_value = '${guideUid}'`)[0].n, "1");
    assert.deepEqual((await pull("guides")).get(guideUid).record, record);
  });

  await t.test("trash runs the delete lifecycle: a beforeDelete veto keeps the post", async () => {
    const kept = { uid: uidOf(4), fields: { ...record.fields, title: `Kept ${run}`, slug: `kept-${run}`, summary: "keep" }, body: null };
    const { digest: keptDigest } = (await push(kept, "absent")).json.data;
    await problem("POST", "/sync/guides/trash", { as: "editor", body: { uid: kept.uid, expect: keptDigest } }, { status: 409, code: "kept", pointer: undefined });
    const [post] = sql(`SELECT p.post_status FROM wp_posts p JOIN wp_postmeta u ON u.post_id = p.ID AND u.meta_key = '_zero_uid' AND u.meta_value = '${kept.uid}'`);
    assert.equal(post.post_status, "draft");
  });

  await t.test("a failure after the post is trashed rolls the trash back", async () => {
    const regret = { uid: uidOf(6), fields: { ...record.fields, title: `Regret ${run}`, slug: `regret-${run}`, summary: "regret" }, body: null };
    const { digest: regretDigest } = (await push(regret, "absent")).json.data;
    await problem("POST", "/sync/guides/trash", { as: "editor", body: { uid: regret.uid, expect: regretDigest } }, { status: 409, code: "regretted", pointer: undefined });
    const [post] = sql(`SELECT p.post_status FROM wp_posts p JOIN wp_postmeta u ON u.post_id = p.ID AND u.meta_key = '_zero_uid' AND u.meta_value = '${regret.uid}'`);
    assert.equal(post.post_status, "draft");
    assert.deepEqual((await pull("guides")).get(regret.uid), { record: regret, digest: regretDigest, trashed: false }, "the cached read is the restored post too");
  });

  await t.test("a trashed post keeps its uid: nobody else can take it", async () => {
    const parked = { uid: uidOf(5), fields: { ...record.fields, title: `Parked ${run}`, slug: `parked-${run}` }, body: null };
    const { digest: parkedDigest } = (await push(parked, "absent")).json.data;
    await ok("POST", "/sync/guides/trash", { as: "editor", body: { uid: parked.uid, expect: parkedDigest } });
    await problem("POST", "/guides", { as: "editor", body: { title: `Thief ${run}`, uid: parked.uid } }, { status: 409, code: "unique_violation", pointer: "/uid" });

  });

  await t.test("concurrent writers: a change committed after this request's snapshot is stale, and a uid is never replaced", () => {
    // Two connections, interleaved deterministically: the request reads (its REPEATABLE READ snapshot),
    // then another connection commits, then the request writes.
    const result = JSON.parse(wp("eval", `
      $app = \\Zero\\Wp\\Plugin::instance()->app();
      $db = $app->db;
      $other = new mysqli(DB_HOST, DB_USER, DB_PASSWORD, DB_NAME);
      $id = $db->insert('guides', ['title' => 'Race ${run}', 'slug' => 'race-${run}'], true)[0]['id'];
      $uid = $db->findFirst('guides', ['where' => ['id' => $id]])['uid'];
      $item = fn () => \\Zero\\Sync\\Wire::encode('guides', [$db->findFirst('guides', ['where' => ['id' => $id]])])[0];
      $seen = $item();
      $record = $seen['record'];
      $record['fields']['summary'] = 'ours';
      wp_set_current_user(get_user_by('login', 'editor')->ID);
      $viewer = new \\Zero\\Viewer(\\Zero\\Wp\\WpAuth::current(), 'wp');
      $status = $db->transaction(function () use ($app, $db, $other, $id, $record, $seen, $viewer) {
        $db->findFirst('guides', ['where' => ['id' => $id]]);
        $other->query("UPDATE {$GLOBALS['wpdb']->posts} SET post_title = 'Theirs' WHERE ID = $id");
        $response = $app->dispatch('POST', '/sync/guides', [], wp_json_encode(['record' => $record, 'expect' => $seen['digest']]), $viewer);
        return [$response->status, array_key_exists('current', json_decode($response->body, true))];
      });
      clean_post_cache($id);
      $title = $db->findFirst('guides', ['where' => ['id' => $id]])['title'];

      // A stale expect answered while another connection's commit is newer than the snapshot: no outdated current.
      $mismatch = $db->transaction(function () use ($app, $db, $other, $id, $record, $viewer) {
        $db->findFirst('guides', ['where' => ['id' => $id]]);
        $other->query("UPDATE {$GLOBALS['wpdb']->posts} SET post_title = 'Again' WHERE ID = $id");
        $response = $app->dispatch('POST', '/sync/guides', [], wp_json_encode(['record' => $record, 'expect' => 'sha256:' . str_repeat('0', 64)]), $viewer);
        return [$response->status, array_key_exists('current', json_decode($response->body, true))];
      });
      // A trashed post restored by a push whose snapshot is outdated stays in the trash.
      $db->transaction(fn () => \\Zero\\Sync\\Trash::trash('guides', $db->schema()->collection('guides'), $db->editorRow('guides', $id)));
      $restore = $db->transaction(function () use ($app, $db, $other, $id, $record, $viewer) {
        $db->findFirst('guides', ['where' => ['id' => $id]]);
        $other->query("INSERT INTO {$GLOBALS['wpdb']->postmeta} (post_id, meta_key, meta_value) VALUES ($id, 'zero_summary', 'later')");
        return $app->dispatch('POST', '/sync/guides', [], wp_json_encode(['record' => $record, 'expect' => 'absent']), $viewer)->status;
      });
      clean_post_cache($id);
      $statusAfter = get_post_status($id);
      // An author may create but not update guides: the restore is refused before WordPress untrashes
      // anything (its actions run outside the transaction's reach).
      $untrashed = 0;
      add_action('untrash_post', function () use (&$untrashed) { $untrashed++; });
      $author = new \\Zero\\Viewer(\\Zero\\Wp\\WpAuth::map(get_user_by('login', 'author')), 'wp');
      try {
        $db->transaction(fn () => $app->dispatch('POST', '/sync/guides', [], wp_json_encode(['record' => $record, 'expect' => 'absent']), $author));
        $refused = 'allowed';
      } catch (\\Zero\\HttpError $e) {
        $refused = $e->status;
      }
      $untrashedByPush = $untrashed;
      wp_untrash_post($id);

      delete_post_meta($id, '_zero_uid');
      $stale = $db->findMany('guides', ['where' => ['id' => $id]]);
      $assigned = 'zr_' . str_repeat('e', 20);
      $other->query("INSERT INTO {$GLOBALS['wpdb']->postmeta} (post_id, meta_key, meta_value) VALUES ($id, '_zero_uid', '$assigned')");
      $kept = $db->transaction(fn () => \\Zero\\Sync\\Module::ensureUids('guides', $stale)[0]['uid']);
      echo wp_json_encode([...$status, $title, ...$mismatch, $restore, $statusAfter, $refused, $untrashedByPush, $kept, get_post_meta($id, '_zero_uid')]);
    `));
    assert.deepEqual(result, [409, false, "Theirs", 409, false, 409, "trash", 403, 0, "zr_" + "e".repeat(20), ["zr_" + "e".repeat(20)]],
      "stale without an outdated current (also for a mismatched expect), their title kept, the stale restore left in the trash, an unauthorized restore refused before WordPress untrashes, their uid kept");
  });

  await t.test("conversion and merge run on the server", async () => {
    const md = (await ok("POST", "/sync/guides/convert", { as: "editor", body: { direction: "toMarkdown", text: "<!-- wp:paragraph -->\n<p>Hi <b>there</b></p>\n<!-- /wp:paragraph -->" } })).text;
    assert.equal(md, "Hi **there**\n");
    // WordPress's block registry decides what is static: core/archives renders on the server even with saved fallback HTML.
    const group = "<!-- wp:group -->\n<div class=\"wp-block-group\"><!-- wp:paragraph -->\n<p>In</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->";
    assert.equal((await ok("POST", "/sync/guides/convert", { as: "editor", body: { direction: "toHtml", text: group } })).text, "<div class=\"wp-block-group\">\n<p>In</p>\n</div>");
    const dynamic = await problem("POST", "/sync/guides/convert", { as: "editor", body: { direction: "toHtml", text: "<!-- wp:archives -->\n<ul class=\"wp-block-archives\"><li>Fallback</li></ul>\n<!-- /wp:archives -->" } },
      { status: 422, code: "not_representable", pointer: undefined });
    assert.match(dynamic.detail, /core\/archives/);
    assert.deepEqual(await ok("POST", "/sync/guides/merge", { as: "editor", body: { base: "a\n\nb\n", ours: "A\n\nb\n", theirs: "a\n\nB\n" } }), { merged: "A\n\nB\n", conflicts: [] });
  });

  await t.test("sync operations are WordPress Abilities that run through the same routes", async () => {
    const names = zero("abilities").map((a: any) => a.name).filter((n: string) => n.startsWith("blog/guides-sync-")).sort();
    assert.deepEqual(names, ["blog/guides-sync-apply", "blog/guides-sync-read", "blog/guides-sync-trash"]);
    const [{ ID }] = sql(`SELECT post_id AS ID FROM wp_postmeta WHERE meta_key = '_zero_uid' AND meta_value = '${guideUid}'`);
    const read = JSON.parse(wp("zero", "run", "blog/guides-sync-read", `--input=${JSON.stringify({ after: Number(ID) - 1, first: 1 })}`, "--user=editor")).data;
    assert.deepEqual(read.records, [(await pull("guides")).get(guideUid)]);
    const denied = JSON.parse(wpTry("zero", "run", "blog/guides-sync-read", "--input={}", "--user=author"));
    assert.ok("error" in denied, JSON.stringify(denied));
  });

  await t.test("unknown reference uid", async () => {
    await problem("POST", "/sync/guides", { as: "editor", body: { record: { uid: uidOf(2), fields: { title: "Orphan", writerId: uidOf(3) }, body: null }, expect: "absent" } },
      { status: 422, code: "sync_missing_reference", pointer: "/fields/writerId" });
  });
});
