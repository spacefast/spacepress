// A site that ran the 0.3.0 app in zero.config.ts (before the rename to First), upgraded to the same
// app built by this compiler (run.sh). The database and private files are the ones the 0.3.0
// runtime wrote; this suite activates First as a site owner would and checks that every row, file
// reference, account and signed-in session is still there and readable through First, under First's
// names, that nothing was deleted, and that a second run changes nothing.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { api, harness, http, ok, sql, wp } from "../env.ts";

const seeded: { note: number; post: number; file: number; cookie: string } = JSON.parse(
  readFileSync(process.env.FIRST_WP_HARNESS!, "utf8"),
).seeded;
const site = harness.url;

/** Every row of every table the site has, keyed by table name with `zero` read as `first`. */
function contents(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const tables = sql("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME").map((r) => r.t);
  for (const t of tables) {
    const rows = sql(`SELECT * FROM \`${t}\``).map((r) => JSON.stringify(Object.values(r)));
    out[t.replace(/^wp_zero_/, "wp_first_")] = rows.sort();
  }
  return out;
}
const count = (q: string) => Number(sql(q)[0]?.n ?? 0);

let before_: Record<string, string[]>;
before(() => {
  before_ = contents();
  // The site really is a 0.3 site: its data is under the old names and First's names are free.
  assert.ok("wp_first_notes" in before_ && sql("SHOW TABLES LIKE 'wp\\_first\\_notes'").length === 0, "the 0.3 tables are under zero_ names");
  assert.equal(count("SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'zero_posts'"), 1);
  // The site's plugins list still names the 0.3 plugins; their files are gone (this stack holds only
  // the First build), so WordPress drops them, as when a host swaps the plugin files of a live site.
  assert.match(sql("SELECT option_value AS v FROM wp_options WHERE option_name = 'active_plugins'")[0].v, /zero-runtime/);
  wp("plugin", "activate", "two-factor", "first-runtime", "first-identity", "first-app-carry");
});

test("every 0.3 table is kept under its First name with all its rows; nothing else lost a row", () => {
  const after = contents();
  for (const [table, rows] of Object.entries(before_)) {
    assert.ok(table in after, `${table} is still there`);
    if (["wp_options", "wp_postmeta", "wp_usermeta", "wp_actionscheduler_actions", "wp_actionscheduler_groups", "wp_actionscheduler_logs", "wp_first_identity_sessions", "wp_first__jobs", "wp_first__outbox"].includes(table)) {
      // Renamed keys and values, plus rows First adds on boot: compared by count and by name below.
      assert.ok(after[table].length >= rows.length, `${table} kept every row (${rows.length} → ${after[table].length})`);
    } else {
      // The rows themselves are byte-identical (post_type changes on wp_posts, so compare the rest).
      const strip = (r: string) => (table === "wp_posts" ? r.replaceAll('"zero_posts"', '"first_posts"') : r);
      for (const row of rows) assert.ok(after[table].includes(strip(row)), `${table} kept ${row.slice(0, 120)}`);
    }
  }
  assert.deepEqual(sql("SHOW TABLES LIKE 'wp\\_zero\\_%'"), [], "no table is left under a zero_ name");
});

test("table rows, posts with their revisions, the global and the file read back through First", async () => {
  const notes = await ok("GET", "/notes");
  assert.deepEqual(notes.map((n: any) => n.title).sort(), ["Kept note", "Second note"]);
  const post = await ok("GET", `/posts/${seeded.post}`, { as: "editor" });
  assert.deepEqual([post.title, post.summary, post.tags, post.deck, post.status], ["First post", "Edited by 0.3", ["news"], seeded.file, "published"]);
  assert.match(post.uid, /^zr_[0-9a-f]{20}$/);
  // Both revisions the 0.3 runtime made still hang off the post, with their First meta.
  assert.equal(count(`SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'revision' AND post_parent = ${seeded.post}`), 2);
  assert.equal(count(`SELECT COUNT(*) AS n FROM wp_postmeta m JOIN wp_posts p ON p.ID = m.post_id WHERE p.post_parent = ${seeded.post} AND m.meta_key = 'first_summary'`), 2);
  assert.equal(count("SELECT COUNT(*) AS n FROM wp_postmeta WHERE meta_key LIKE 'zero\\_%' OR meta_key LIKE '\\_zero\\_%'"), 0);
  assert.deepEqual(await ok("GET", "/globals/settings"), { siteTitle: "Carried over" });
  const file = await ok("GET", `/files/decks/${seeded.file}`, { as: "editor" });
  assert.deepEqual([file.filename, file.size], ["deck.txt", 13]);
  const bytes = await fetch(file.url).then((r) => r.text());
  assert.equal(bytes, "deck contents", "the private file moved with its directory and downloads");
  assert.equal(wp("eval", "echo is_dir(WP_CONTENT_DIR . '/uploads/zero-private') ? 'old' : 'moved';"), "moved");
});

test("an editor still edits the post in wp-admin: its post type, fields and SCF field keys are First's", async () => {
  const fields = JSON.parse(wp("eval", `echo wp_json_encode(get_fields(${seeded.post}));`));
  assert.equal(fields.first_summary ?? fields.summary, "Edited by 0.3");
  assert.equal(sql(`SELECT meta_value AS v FROM wp_postmeta WHERE post_id = ${seeded.post} AND meta_key = '_first_summary'`)[0].v, "field_first_posts_summary");
  const edited = await ok("PATCH", `/posts/${seeded.post}`, { as: "editor", body: { summary: "Edited by First" } });
  assert.equal(edited.summary, "Edited by First");
  assert.equal(count(`SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'revision' AND post_parent = ${seeded.post}`), 3, "First keeps revising it");
});

test("accounts, roles and a session signed in under 0.3 carry over", async () => {
  // Members read only themselves: the editor's member row (its 0.3 user meta) reads back as First's.
  const members = await ok("GET", "/members", { as: "editor" });
  assert.deepEqual(members.map((m: any) => [m.email, m.role, m.plan]), [["editor@example.test", "editor", "free"]]);
  assert.equal(count("SELECT COUNT(*) AS n FROM wp_usermeta WHERE meta_key LIKE 'zero\\_%'"), 0);
  assert.ok(count("SELECT COUNT(*) AS n FROM wp_usermeta WHERE meta_key = 'first_role'") >= 4);
  const roles = JSON.parse(wp("eval", "echo wp_json_encode(array_keys(wp_roles()->roles));"));
  assert.ok(roles.includes("first_guest") && !roles.includes("zero_guest"), roles.join(","));
  // The visitor's browser still holds the cookie it got from zero-identity.
  const account = await fetch(`${site}/wp-json/first-identity/v1/account`, { headers: { cookie: seeded.cookie, origin: site } });
  assert.equal(account.status, 200, await account.clone().text());
  assert.equal((await account.json()).data.account.name, "Subscriber");
  const digest = wp("eval", `echo First\\Identity\\Sessions::digest(${JSON.stringify(seeded.cookie.split("=")[1])});`);
  assert.equal(count(`SELECT COUNT(*) AS n FROM wp_first_identity_sessions WHERE secret_hash = '${digest}'`), 1, "the session is re-keyed to First's digest on use");
});

test("the job the 0.3 site queued runs under First's hooks", async () => {
  assert.deepEqual(sql("SELECT DISTINCT hook FROM wp_actionscheduler_actions WHERE status = 'pending' AND hook LIKE 'zero%'"), []);
  assert.deepEqual(sql("SELECT slug FROM wp_actionscheduler_groups WHERE slug LIKE 'zero%'"), []);
  wp("action-scheduler", "run", "--hooks=first_job");
  assert.deepEqual(sql("SELECT job, state FROM wp_first__jobs"), [{ job: "stamp", state: "done" }]);
  const note = await ok("GET", `/notes/${seeded.note}`);
  assert.equal(note.done, true);
  const cron = wp("eval", "echo wp_json_encode(array_merge(...array_map('array_keys', array_values(array_filter(_get_cron_array(), 'is_array')))));");
  assert.ok(!cron.includes("zero_identity"), cron);
  assert.ok(cron.includes("first_identity_maintenance"), cron);
});

test("the upgrade ran once and a second run changes nothing", () => {
  const done = JSON.parse(wp("eval", "echo wp_json_encode(get_option('first_zero_names'));"));
  assert.ok(done.changed.tables >= 10 && done.changed.posts === 1 && done.kept.length === 0, JSON.stringify(done));
  const snapshot = contents();
  // As if an interrupted run were retried: forget that it finished and run it again.
  wp("option", "delete", "first_zero_names");
  wp("option", "delete", "first_identity_zero_names");
  wp("eval", "global $wpdb; First\\Wp\\ZeroNames::upgrade(new First\\Wp\\Connection($wpdb)); First\\Identity\\Legacy\\ZeroNames::upgrade(new First\\Identity\\DB($wpdb));");
  const again = contents();
  for (const table of Object.keys(snapshot)) {
    if (table === "wp_options") continue; // the two completion records are written again
    assert.deepEqual(again[table], snapshot[table], `${table} unchanged by a second run`);
  }
  assert.deepEqual(JSON.parse(wp("eval", "echo wp_json_encode(get_option('first_zero_names')['changed']);")), []);
});

test("an upgrade that finds First's name taken stops and names the conflict, changing nothing", async () => {
  // A table, then an option: each conflict refuses before any rename.
  // In one WP-CLI process, after boot: a later boot would run the upgrade on its own first.
  wp("eval", "global $wpdb; $wpdb->query(\"CREATE TABLE {$wpdb->prefix}zero_conflict (id INT) ENGINE=InnoDB\"); $wpdb->query(\"CREATE TABLE {$wpdb->prefix}first_conflict (id INT) ENGINE=InnoDB\"); delete_option('first_zero_names');");
  const out = wp("eval", "global $wpdb; try { First\\Wp\\ZeroNames::upgrade(new First\\Wp\\Connection($wpdb)); echo 'ran'; } catch (Throwable $e) { echo $e->getMessage(); }");
  assert.match(out, /Cannot rename table wp_zero_conflict: wp_first_conflict already exists/);
  assert.equal(sql("SHOW TABLES LIKE 'wp\\_zero\\_conflict'").length, 1, "the old table is kept");
  // While it is unresolved, First's API refuses rather than serving tables that don't match.
  const r = await http("GET", `${api}/notes`);
  assert.equal(r.status, 503, JSON.stringify(r.json));
  wp("eval", "global $wpdb; $wpdb->query(\"DROP TABLE {$wpdb->prefix}first_conflict\");");
  await ok("GET", "/notes"); // the next request retries and finishes
  assert.equal(sql("SHOW TABLES LIKE 'wp\\_first\\_conflict'").length, 1);
});
