// Content sync on real WordPress (design §5.3): uid meta on posts, the /sync routes over
// /wp-json/zero/v1 with application passwords, Markdown bodies stored as Gutenberg blocks, reference
// uids, WordPress trash and restore, and a post created in the editor gaining a uid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { api, core, harness, http, ok, problem, qs, run, sql, wp, wpTry, zero } from "./env.ts";

const here = dirname(fileURLToPath(import.meta.url));
/** The binary run.sh built; honours CARGO_TARGET_DIR. */
const zeroBinary = () => `${process.env.CARGO_TARGET_DIR ?? join(here, "../../target")}/debug/zero`;

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

/** The stored guide, trusted (WP-CLI `wp zero find`). */
const row = (id: number) => zero("find", "guides", JSON.stringify({ where: { id } }))[0];

const push = (record: unknown, expect: string) => http("POST", `${api}/sync/guides`, { as: "editor", body: { record, expect } });

test("sync on WordPress", async (t) => {
  const writer = zero("insert", "writers", JSON.stringify({ name: `Writer ${run}` }))[0];
  const guideUid = uidOf(1);
  const record = {
    uid: guideUid,
    fields: { title: `Guide ${run}`, slug: `guide-${run}`, summary: null, level: "intro", writerId: writer.uid, review: null, status: "draft", publishedAt: null },
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

  await t.test("a post created in wp-admin gains a uid before any write observer sees it", async () => {
    // A post created the way wp-admin does, in one PHP process with an onWritten observer (webhooks
    // and other features use this seam) recording the uid it receives.
    const seen = JSON.parse(wp("eval", `
      $seen = 'not called';
      \\Zero\\Wp\\Plugin::instance()->app();
      \\Zero\\Extensions::onWritten(function (string $op, string $c, array $row) use (&$seen) { if ($c === 'guides') { $seen = $row['uid']; } });
      wp_set_current_user(get_user_by('login', 'editor')->ID);
      $id = wp_insert_post(['post_type' => 'zero_guides', 'post_title' => 'Admin ${run}', 'post_status' => 'publish'], true);
      echo wp_json_encode([$id, $seen, get_post_meta($id, '_zero_uid', true)]);
    `));
    const [id, observed, stored] = seen;
    assert.match(stored, /^zr_[0-9a-f]{20}$/);
    assert.equal(observed, stored, `onWritten saw the uid for post ${id}`);
    assert.equal((await pull("guides")).get(stored).record.fields.title, `Admin ${run}`);
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

  await t.test("field access applies to sync: hidden fields aren't exported, protected ones can't be pushed", async () => {
    const guarded = zero("insert", "guides", JSON.stringify({ title: `Guarded ${run}`, slug: `guarded-${run}`, internal: "admins only", review: "approved" }))[0];
    const ID = guarded.id;
    const page = await ok("GET", "/sync/guides" + qs({ after: String(ID - 1), first: "1" }), { as: "editor" });
    const item = page.records[0];
    assert.equal(item.record.uid, guarded.uid);
    assert.ok(!("internal" in item.record.fields), "a field the editor can't read is not exported");
    assert.equal(item.record.fields.review, "approved", "a readable field is exported");
    const asAdmin = (await ok("GET", "/sync/guides" + qs({ after: String(ID - 1), first: "1" }), { as: "admin" })).records[0];
    assert.equal(asAdmin.record.fields.internal, "admins only");
    assert.notEqual(asAdmin.digest, item.digest, "each viewer's digest is of the record it sees");

    // Pushing back what the editor pulled, with an edit, leaves the hidden field alone.
    const pushed = await ok("POST", "/sync/guides", { as: "editor", body: { record: { ...item.record, fields: { ...item.record.fields, summary: "edited" } }, expect: item.digest } });
    assert.equal(pushed.status, "applied");
    assert.deepEqual([row(guarded.id).summary, row(guarded.id).internal], ["edited", "admins only"]);

    // Changing a field the editor may read but not set is refused at its pointer, and nothing is written.
    const current = (await ok("GET", "/sync/guides" + qs({ after: String(ID - 1), first: "1" }), { as: "editor" })).records[0];
    await problem("POST", "/sync/guides", { as: "editor", body: { record: { ...current.record, fields: { ...current.record.fields, review: "rejected", summary: "again" } }, expect: current.digest } },
      { status: 403, code: "forbidden", pointer: "/review" });
    // Naming a field the editor can't read is refused the same way.
    await problem("POST", "/sync/guides", { as: "editor", body: { record: { ...current.record, fields: { ...current.record.fields, internal: "leaked?" } }, expect: current.digest } },
      { status: 403, code: "forbidden", pointer: "/internal" });
    assert.deepEqual([row(guarded.id).review, row(guarded.id).internal, row(guarded.id).summary], ["approved", "admins only", "edited"]);
  });

  await t.test("content behind field access survives an editor's title-only push", async () => {
    const blocks = "<!-- wp:paragraph -->\n<p>Admins only.</p>\n<!-- /wp:paragraph -->";
    for (const [collection, label] of [["briefs", "unreadable"], ["memos", "read-only"]] as const) {
      const made = zero("insert", collection, JSON.stringify({ title: `${label} ${run}`, body: blocks }))[0];
      const item = (await ok("GET", `/sync/${collection}` + qs({ after: String(made.id - 1), first: "1" }), { as: "editor" })).records[0];
      if (collection === "briefs") {
        assert.ok(!("body" in item.record), "an unreadable body is absent from the record, not null");
      } else {
        assert.equal(item.record.body, "Admins only.\n");
      }
      const pushed = await ok("POST", `/sync/${collection}`, { as: "editor", body: { record: { ...item.record, fields: { ...item.record.fields, title: `${label} renamed ${run}` } }, expect: item.digest } });
      assert.equal(pushed.status, "applied", `${label}: a title-only push applies`);
      const stored = zero("find", collection, JSON.stringify({ where: { id: made.id } }))[0];
      assert.deepEqual([stored.title, stored.body], [`${label} renamed ${run}`, blocks], `${label}: the body is untouched`);
    }
    // Restoring a trashed memo as the editor pulled it keeps its read-only body as stored.
    const memo = zero("insert", "memos", JSON.stringify({ title: `Restore ${run}`, body: blocks }))[0];
    const seen = (await ok("GET", "/sync/memos" + qs({ after: String(memo.id - 1), first: "1" }), { as: "editor" })).records[0];
    wp("eval", `wp_trash_post(${memo.id});`);
    const restored = await ok("POST", "/sync/memos", { as: "editor", body: { record: seen.record, expect: "absent" } });
    assert.equal(restored.status, "applied");
    const back = zero("find", "memos", JSON.stringify({ where: { id: memo.id } }))[0];
    assert.equal(back.body, blocks, "the restored memo's read-only body is untouched");
  });

  await t.test("unknown reference uid", async () => {
    await problem("POST", "/sync/guides", { as: "editor", body: { record: { uid: uidOf(2), fields: { title: "Orphan", writerId: uidOf(3) }, body: null }, expect: "absent" } },
      { status: 422, code: "sync_missing_reference", pointer: "/fields/writerId" });
  });
});

// The `zero sync` CLI against this WordPress (design §5.8): pull posts into Markdown files, push a local
// edit, let an editor edit in WordPress, then merge a non-conflicting edit and write a conflict file for
// a conflicting one. A wp-admin trash removes the file on the next run.
// Only `guides` is synced into this project: other lanes' fragments may add synced collections too.
test("zero sync against WordPress", async (t) => {
  const project = mkdtempSync(join(tmpdir(), "zero-wp-sync-"));
  // The sync directories come from the site's /_schema; the project is just a directory of files.
  const writer = zero("insert", "writers", JSON.stringify({ name: `CLI writer ${run}` }))[0];
  const slug = `cli-${run}`;
  const created = zero("insert", "guides", JSON.stringify({ title: `CLI ${run}`, slug, summary: "From WordPress", level: "intro", writerId: writer.id,
    body: "<!-- wp:paragraph -->\n<p>First paragraph.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Second paragraph.</p>\n<!-- /wp:paragraph -->" }))[0];
  const sync = (...args: string[]) => spawnSync(zeroBinary(), ["sync", ...args, project, "--only", "guides", "--site", harness.url, "--app-password", `editor:${harness.users.editor.appPassword}`, "--no-commit", "--json"], { encoding: "utf8" });
  const file = join(project, `content/guides/${slug}.md`);
  const row = () => zero("find", "guides", JSON.stringify({ where: { id: created.id } }))[0];

  await t.test("1. pull: WordPress posts become Markdown files", () => {
    const out = sync();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const text = readFileSync(file, "utf8");
    assert.match(text, new RegExp(`^---\\nuid: ${created.uid}\\ntitle: CLI ${run}\\nslug: ${slug}\\nsummary: From WordPress\\nlevel: intro\\nwriterId: ${writer.uid}\\nstatus: published\\n`));
    assert.ok(text.endsWith("---\nFirst paragraph.\n\nSecond paragraph.\n"), text);
    assert.equal(JSON.parse(sync().stdout).data.applied, 0, "a second run is a no-op");
  });

  await t.test("2. push: a file edit lands in WordPress as blocks", () => {
    writeFileSync(file, readFileSync(file, "utf8").replace("Second paragraph.", "Second paragraph, from the file.\n\n## A new heading"));
    const out = sync();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(row().body, /Second paragraph, from the file\.<\/p>[\s\S]*<!-- wp:heading -->\n<h2 class="wp-block-heading">A new heading<\/h2>/);
  });

  await t.test("3 + 4. an editor edits the post: other fields merge, the same field conflicts", async () => {
    // The editor changes the summary in WordPress; the file changes the level. Different fields merge.
    const saved = await http("POST", `${core}/zero_guides/${created.id}`, { as: "editor", body: { acf: { zero_summary: "Edited in WordPress" } } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    writeFileSync(file, readFileSync(file, "utf8").replace("level: intro", "level: advanced"));
    const merged = sync();
    assert.equal(merged.status, 0, merged.stdout + merged.stderr);
    assert.deepEqual([row().summary, row().level], ["Edited in WordPress", "advanced"]);
    assert.match(readFileSync(file, "utf8"), /summary: Edited in WordPress\nlevel: advanced\n/);

    // Both edit the body, in different paragraphs: the site merges the lines and both edits survive.
    const blocks = row().body.replace("First paragraph.", "First paragraph, edited in WordPress.");
    const edited = await http("POST", `${core}/zero_guides/${created.id}`, { as: "editor", body: { content: blocks } });
    assert.equal(edited.status, 200, JSON.stringify(edited.json));
    writeFileSync(file, readFileSync(file, "utf8").replace("## A new heading", "## A new heading, from the file"));
    const bodies = sync();
    assert.equal(bodies.status, 0, bodies.stdout + bodies.stderr);
    assert.match(row().body, /First paragraph, edited in WordPress\.[\s\S]*A new heading, from the file/);
    assert.match(readFileSync(file, "utf8"), /First paragraph, edited in WordPress\.[\s\S]*## A new heading, from the file/);

    // Both change the title: a conflict file, and neither side is touched.
    const titled = await http("POST", `${core}/zero_guides/${created.id}`, { as: "editor", body: { title: "Title from WordPress" } });
    assert.equal(titled.status, 200);
    writeFileSync(file, readFileSync(file, "utf8").replace(`title: CLI ${run}`, "title: Title from the file"));
    const conflicted = sync();
    assert.equal(conflicted.status, 0, conflicted.stdout + conflicted.stderr);
    assert.equal(JSON.parse(conflicted.stdout).data.conflicts.length, 1);
    const conflict = readFileSync(join(project, `.zero/conflicts/${created.uid}.md`), "utf8");
    assert.match(conflict, /# Fields: \/fields\/title\n[\s\S]*<<<<<<< files\n[\s\S]*title: Title from the file[\s\S]*\|\|\|\|\|\|\| base\n[\s\S]*=======\n[\s\S]*title: Title from WordPress[\s\S]*>>>>>>> wordpress\n/);
    assert.equal(row().title, "Title from WordPress");
    assert.match(readFileSync(file, "utf8"), /title: Title from the file/);
    assert.equal(sync("--check").status, 2, "a pending conflict is exit 2 under --check");
  });

  await t.test("resolve applies the edited conflict file to WordPress and the file", () => {
    const path = join(project, `.zero/conflicts/${created.uid}.md`);
    const conflict = readFileSync(path, "utf8");
    const header = conflict.split("\n").filter((l) => l.startsWith("#")).join("\n") + "\n";
    const theirs = conflict.split("=======\n")[1].split(">>>>>>> wordpress")[0].replace("title: Title from WordPress", "title: Agreed title");
    writeFileSync(path, header + theirs);
    const out = sync("resolve", created.uid);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.equal(row().title, "Agreed title");
    assert.match(readFileSync(file, "utf8"), /title: Agreed title/);
    assert.ok(!existsSync(path));
    assert.equal(JSON.parse(sync().stdout).data.applied, 0, "both sides agree after resolving");
  });

  await t.test("a slug renamed in the file moves the file and the post's slug", () => {
    writeFileSync(file, readFileSync(file, "utf8").replace(`slug: ${slug}`, `slug: ${slug}-moved`));
    assert.equal(sync().status, 0);
    assert.equal(row().slug, `${slug}-moved`);
    assert.ok(existsSync(join(project, `content/guides/${slug}-moved.md`)) && !existsSync(file));
  });

  await t.test("deleting the file moves the post to the WordPress trash", () => {
    rmSync(join(project, `content/guides/${slug}-moved.md`));
    assert.equal(sync().status, 0);
    assert.equal(sql(`SELECT post_status FROM wp_posts WHERE ID = ${created.id}`)[0].post_status, "trash");
  });

  await t.test("a post trashed in wp-admin deletes its file", () => {
    const other = zero("insert", "guides", JSON.stringify({ title: `Doomed ${run}`, slug: `doomed-${run}` }))[0];
    assert.equal(sync().status, 0);
    assert.ok(existsSync(join(project, `content/guides/doomed-${run}.md`)));
    // What wp-admin's "Move to Trash" calls (WP-CLI's `post delete` won't trash a non-public type).
    wp("eval", `wp_set_current_user(get_user_by('login', 'editor')->ID); echo wp_trash_post(${other.id}) ? 'ok' : 'no';`);
    assert.equal(sql(`SELECT post_status FROM wp_posts WHERE ID = ${other.id}`)[0].post_status, "trash");
    assert.equal(sync().status, 0);
    assert.ok(!existsSync(join(project, `content/guides/doomed-${run}.md`)));
  });
  rmSync(project, { recursive: true, force: true });
});
