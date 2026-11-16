// A site that ran the 0.3.0 app in zero.config.ts (before the rename to TypedPress), upgraded to the same
// app built by this compiler (run.sh). The database and private files are the ones the 0.3.0
// runtime wrote; this suite activates TypedPress as a site owner would and checks that every row, file
// reference, account and signed-in session is still there and readable through TypedPress, under TypedPress's
// names, that nothing was deleted, and that a second run changes nothing.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { api, harness, http, ok, sql, wp } from "../env.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const seeded: { note: number; post: number; file: number; cookie: string } = JSON.parse(
  readFileSync(process.env.TP_WP_HARNESS!, "utf8"),
).seeded;
const site = harness.url;

/**
 * Every row of every table the site has, keyed by table name with `zero` read as `typedpress`. With
 * `columns` (a table's columns as an earlier call saw them), only those columns are read: a column
 * TypedPress added since (the migration ledger's `sql`) is not a change to the rows that were there.
 */
function contents(columns?: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const tables = sql("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME").map((r) => r.t);
  for (const t of tables) {
    const name = t.replace(/^wp_zero_/, "wp_tp_");
    const only = columns?.[name];
    const rows = sql(`SELECT ${only ? only.map((c) => `\`${c}\``).join(", ") : "*"} FROM \`${t}\``).map((r) => JSON.stringify(Object.values(r)));
    out[name] = rows.sort();
  }
  return out;
}

/** Each table's columns, in order, keyed as contents() keys them. */
function columns(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of sql("SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION")) {
    (out[r.t.replace(/^wp_zero_/, "wp_tp_")] ??= []).push(r.c);
  }
  return out;
}
const count = (q: string) => Number(sql(q)[0]?.n ?? 0);

let before_: Record<string, string[]>;
let columns_: Record<string, string[]>;
before(() => {
  before_ = contents();
  columns_ = columns();
  // The site really is a 0.3 site: its data is under the old names and TypedPress's names are free.
  assert.ok("wp_tp_notes" in before_ && sql("SHOW TABLES LIKE 'wp\\_tp\\_notes'").length === 0, "the 0.3 tables are under zero_ names");
  assert.equal(count("SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'zero_posts'"), 1);
  // The site's plugins list still names the 0.3 plugins; their files are gone (this stack holds only
  // the TypedPress build), so WordPress drops them, as when a host swaps the plugin files of a live site.
  assert.match(sql("SELECT option_value AS v FROM wp_options WHERE option_name = 'active_plugins'")[0].v, /zero-runtime/);
  wp("plugin", "activate", "two-factor", "typedpress-runtime", "typedpress-identity", "typedpress-app-carry");
});

test("every 0.3 table is kept under its TypedPress name with all its rows; nothing else lost a row", () => {
  const after = contents(columns_);
  for (const [table, rows] of Object.entries(before_)) {
    assert.ok(table in after, `${table} is still there`);
    if (["wp_options", "wp_postmeta", "wp_usermeta", "wp_actionscheduler_actions", "wp_actionscheduler_groups", "wp_actionscheduler_logs", "wp_tp_identity_sessions", "wp_tp__jobs", "wp_tp__outbox"].includes(table)) {
      // Renamed keys and values, plus rows TypedPress adds on boot: compared by count and by name below.
      assert.ok(after[table].length >= rows.length, `${table} kept every row (${rows.length} → ${after[table].length})`);
    } else {
      // The rows themselves are byte-identical (post_type changes on wp_posts, so compare the rest).
      const strip = (r: string) => (table === "wp_posts" ? r.replaceAll('"zero_posts"', '"tp_posts"') : r);
      for (const row of rows) assert.ok(after[table].includes(strip(row)), `${table} kept ${row.slice(0, 120)}`);
    }
  }
  assert.deepEqual(sql("SHOW TABLES LIKE 'wp\\_zero\\_%'"), [], "no table is left under a zero_ name");
});

test("table rows, posts with their revisions, the global and the file read back through TypedPress", async () => {
  const notes = await ok("GET", "/notes");
  assert.deepEqual(notes.map((n: any) => n.title).sort(), ["Kept note", "Second note"]);
  const post = await ok("GET", `/posts/${seeded.post}`, { as: "editor" });
  assert.deepEqual([post.title, post.summary, post.tags, post.deck, post.status], ["First post", "Edited by 0.3", ["news"], seeded.file, "published"]);
  assert.match(post.uid, /^zr_[0-9a-f]{20}$/);
  // Both revisions the 0.3 runtime made still hang off the post, with their TypedPress meta.
  assert.equal(count(`SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'revision' AND post_parent = ${seeded.post}`), 2);
  assert.equal(count(`SELECT COUNT(*) AS n FROM wp_postmeta m JOIN wp_posts p ON p.ID = m.post_id WHERE p.post_parent = ${seeded.post} AND m.meta_key = 'tp_summary'`), 2);
  assert.equal(count("SELECT COUNT(*) AS n FROM wp_postmeta WHERE meta_key LIKE 'zero\\_%' OR meta_key LIKE '\\_zero\\_%'"), 0);
  assert.deepEqual(await ok("GET", "/settings"), { siteTitle: "Carried over" });
  const file = await ok("GET", `/files/decks/${seeded.file}`, { as: "editor" });
  assert.deepEqual([file.filename, file.size], ["deck.txt", 13]);
  const bytes = await fetch(file.url).then((r) => r.text());
  assert.equal(bytes, "deck contents", "the private file moved with its directory and downloads");
  assert.equal(wp("eval", "echo is_dir(WP_CONTENT_DIR . '/uploads/zero-private') ? 'old' : 'moved';"), "moved");
});

test("the deleted /wp-json/tp/v1 and the 0.3 client file are not served; an old tab's action is not run", async () => {
  const gone = await fetch(`${site}/wp-json/tp/v1/notes`);
  assert.deepEqual([gone.status, (await gone.json()).code], [404, "rest_no_route"]);
  assert.equal((await fetch(`${site}/__zero/client.js`)).status, 404);
  const before = (await ok("GET", "/notes")).length;
  const action = await fetch(`${site}/wp-json/zero/v1/actions/add`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "From an open tab" }) });
  assert.equal(action.status, 404);
  assert.equal((await ok("GET", "/notes")).length, before, "the action didn't run");
});

test("an editor still edits the post in wp-admin: its post type, fields and SCF field keys are TypedPress's", async () => {
  const fields = JSON.parse(wp("eval", `echo wp_json_encode(get_fields(${seeded.post}));`));
  assert.equal(fields.tp_summary ?? fields.summary, "Edited by 0.3");
  assert.equal(sql(`SELECT meta_value AS v FROM wp_postmeta WHERE post_id = ${seeded.post} AND meta_key = '_tp_summary'`)[0].v, "field_tp_posts_summary");
  const edited = await ok("PATCH", `/posts/${seeded.post}`, { as: "editor", body: { summary: "Edited by TypedPress" } });
  assert.equal(edited.summary, "Edited by TypedPress");
  assert.equal(count(`SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'revision' AND post_parent = ${seeded.post}`), 3, "TypedPress keeps revising it");
});

test("accounts, roles and a session signed in under 0.3 carry over", async () => {
  // Members read only themselves: the editor's member row (its 0.3 user meta) reads back as TypedPress's.
  const members = await ok("GET", "/members", { as: "editor" });
  assert.deepEqual(members.map((m: any) => [m.email, m.role, m.plan]), [["editor@example.test", "editor", "free"]]);
  assert.equal(count("SELECT COUNT(*) AS n FROM wp_usermeta WHERE meta_key LIKE 'zero\\_%'"), 0);
  assert.ok(count("SELECT COUNT(*) AS n FROM wp_usermeta WHERE meta_key = 'tp_role'") >= 4);
  const roles = JSON.parse(wp("eval", "echo wp_json_encode(array_keys(wp_roles()->roles));"));
  assert.ok(roles.includes("tp_guest") && !roles.includes("zero_guest"), roles.join(","));
  // The visitor's browser still holds the cookie it got from zero-identity.
  const account = await fetch(`${site}/wp-json/typedpress-identity/v1/account`, { headers: { cookie: seeded.cookie, origin: site } });
  assert.equal(account.status, 200, await account.clone().text());
  assert.equal((await account.json()).data.account.name, "Subscriber");
  const digest = wp("eval", `echo TypedPress\\Identity\\Sessions::digest(${JSON.stringify(seeded.cookie.split("=")[1])});`);
  assert.equal(count(`SELECT COUNT(*) AS n FROM wp_tp_identity_sessions WHERE secret_hash = '${digest}'`), 1, "the session is re-keyed to TypedPress's digest on use");
});

test("the job the 0.3 site queued runs under TypedPress's hooks", async () => {
  assert.deepEqual(sql("SELECT DISTINCT hook FROM wp_actionscheduler_actions WHERE status = 'pending' AND hook LIKE 'zero%'"), []);
  assert.deepEqual(sql("SELECT slug FROM wp_actionscheduler_groups WHERE slug LIKE 'zero%'"), []);
  wp("action-scheduler", "run", "--hooks=tp_job");
  assert.deepEqual(sql("SELECT job, state FROM wp_tp__jobs WHERE job = 'stamp'"), [{ job: "stamp", state: "done" }]);
  // The rows that came over from 0.3 were never indexed: the upgrade queues one search rebuild per
  // kind that has rows, and after it the old rows are searchable.
  assert.deepEqual(sql("SELECT DISTINCT job, state FROM wp_tp__jobs WHERE job <> 'stamp'"), [{ job: "typedpress.search.reindex", state: "done" }]);
  assert.deepEqual((await ok("GET", "/notes?search=kept")).map((n: any) => n.title), ["Kept note"]);
  const note = await ok("GET", `/notes/${seeded.note}`);
  assert.equal(note.done, true);
  const cron = wp("eval", "echo wp_json_encode(array_merge(...array_map('array_keys', array_values(array_filter(_get_cron_array(), 'is_array')))));");
  assert.ok(!cron.includes("zero_identity"), cron);
  assert.ok(cron.includes("tp_identity_maintenance"), cron);
});

test("on a site no 0.3 runtime ran on, the upgrade touches nothing", () => {
  // Another plugin's `zero_` names on a site with no 0.3 marker are not TypedPress's.
  wp("eval", "global $wpdb; $wpdb->query(\"CREATE TABLE {$wpdb->prefix}zero_other (id INT) ENGINE=InnoDB\"); add_option('zero_other_setting', 'kept');");
  // The typedpress run, during activation, recorded what it moved.
  const done = JSON.parse(wp("eval", "echo wp_json_encode(get_option('tp_zero_names'));"));
  assert.ok(done.changed.tables >= 10 && done.changed.posts === 1 && done.kept.length === 0, JSON.stringify(done));
  const markers = sql("SELECT option_name AS n FROM wp_options WHERE option_name IN ('zero_runtime_tables', 'zero_runtime_site_id', 'zero_identity_schema_version')");
  assert.deepEqual(markers, [], "the 0.3 markers were renamed by the first run");
  wp("option", "delete", "tp_zero_names");
  wp("eval", "global $wpdb; TypedPress\\Wp\\ZeroNames::upgrade(new TypedPress\\Wp\\Connection($wpdb));");
  assert.equal(sql("SHOW TABLES LIKE 'wp\\_zero\\_other'").length, 1);
  assert.equal(wp("option", "get", "zero_other_setting"), "kept");
  wp("eval", "global $wpdb; $wpdb->query(\"DROP TABLE {$wpdb->prefix}zero_other\"); delete_option('zero_other_setting');");
});

test("the upgrade ran once and a second run changes nothing", () => {
  const snapshot = contents();
  // As if a run were retried after it finished its work but before recording it: everything has
  // moved, so there is nothing left for it to find.
  wp("option", "delete", "tp_zero_names");
  wp("option", "delete", "tp_identity_zero_names");
  wp("eval", "global $wpdb; TypedPress\\Wp\\ZeroNames::upgrade(new TypedPress\\Wp\\Connection($wpdb)); TypedPress\\Identity\\Legacy\\ZeroNames::upgrade(new TypedPress\\Identity\\DB($wpdb));");
  const again = contents();
  for (const table of Object.keys(snapshot)) {
    if (table === "wp_options") continue; // the two completion records are written again
    assert.deepEqual(again[table], snapshot[table], `${table} unchanged by a second run`);
  }
  assert.deepEqual(JSON.parse(wp("eval", "echo wp_json_encode(get_option('tp_zero_names')['changed']);")), []);
});

test("an upgrade that finds TypedPress's name taken stops and names the conflict, changing nothing", async () => {
  // A table, then an option: each conflict refuses before any rename.
  // In one WP-CLI process, after boot: a later boot would run the upgrade on its own first.
  // A table a 0.3 runtime left (its marker, the tables-version option, with it) whose First name is taken.
  wp("eval", "global $wpdb; $wpdb->query(\"CREATE TABLE {$wpdb->prefix}zero_conflict (id INT) ENGINE=InnoDB\"); $wpdb->query(\"CREATE TABLE {$wpdb->prefix}tp_conflict (id INT) ENGINE=InnoDB\"); add_option('zero_runtime_tables', '0.3+test'); delete_option('tp_zero_names');");
  const out = wp("eval", "global $wpdb; try { TypedPress\\Wp\\ZeroNames::upgrade(new TypedPress\\Wp\\Connection($wpdb)); echo 'ran'; } catch (Throwable $e) { echo $e->getMessage(); }");
  assert.match(out, /Cannot rename table wp_zero_conflict: wp_tp_conflict already exists/);
  assert.equal(sql("SHOW TABLES LIKE 'wp\\_zero\\_conflict'").length, 1, "the old table is kept");
  // While it is unresolved, TypedPress's API refuses rather than serving tables that don't match.
  const r = await http("GET", `${api}/notes`);
  assert.equal(r.status, 503, JSON.stringify(r.json));
  wp("eval", "global $wpdb; $wpdb->query(\"DROP TABLE {$wpdb->prefix}tp_conflict\");");
  // The next request retries and finishes. Its tables-version option can't move either while
  // TypedPress's own exists: that conflict is named too, and resolved the same way.
  const retry = await http("GET", `${api}/notes`);
  assert.equal(retry.status, 503);
  assert.match(wp("eval", "global $wpdb; try { TypedPress\\Wp\\ZeroNames::upgrade(new TypedPress\\Wp\\Connection($wpdb)); echo 'ran'; } catch (Throwable $e) { echo $e->getMessage(); }"), /Cannot rename option zero_runtime_tables: tp_runtime_tables already exists/);
  wp("option", "delete", "zero_runtime_tables");
  wp("eval", "add_option('zero_runtime_site_id', 'marker');");
  await ok("GET", "/notes");
  assert.equal(sql("SHOW TABLES LIKE 'wp\\_tp\\_conflict'").length, 1);
  assert.equal(sql("SHOW TABLES LIKE 'wp\\_zero\\_conflict'").length, 0);
});

test("after the upgrade, the site serves TypedPress's API and a tab still running the 0.3 client gets a clear error", async () => {
  // The recompiled site answers on TypedPress's API; the 0.3 REST prefix is gone.
  assert.deepEqual((await ok("GET", "/notes")).map((n: any) => n.title).sort(), ["Kept note", "Second note"]);
  const old = await fetch(`${site}/wp-json/zero/v1/notes`);
  assert.equal(old.status, 404, "nothing serves /wp-json/zero/v1 after the upgrade");
  assert.equal((await old.json()).code, "rest_no_route");
  // The client the 0.3 build generated, as an open tab still runs it: every call fails with a
  // ZeroError carrying WordPress's 404, never a wrong answer or a silent empty list.
  const here = dirname(fileURLToPath(import.meta.url));
  const { createClient } = await import(join(here, "fixture/client/client.js"));
  const client = createClient({ url: `${site}/wp-json/zero/v1` });
  await assert.rejects(client.notes.list(), (e: any) => e.name === "ZeroError" && e.status === 404 && e.code === "rest_no_route");
  await assert.rejects(client.actions.later({ id: seeded.note }), (e: any) => e.name === "ZeroError" && e.status === 404);
  // The client the recompiled build serves is TypedPress's, on /__tp/api/v1.
  const built = String(process.env.TP_ZERO_UPGRADE_CLIENT ?? "");
  assert.ok(built !== "", "run.sh passes the recompiled client");
  const fresh = await import(built);
  const rows = await fresh.createClient({ url: `${site}/__tp/api/v1` }).notes.list();
  assert.deepEqual(rows.map((n: any) => n.title).sort(), ["Kept note", "Second note"]);
});
