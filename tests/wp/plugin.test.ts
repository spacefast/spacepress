// Plugin activation (§4.1, §4.2, §4.5, §4.9, §5.1): what activating the built plugin leaves in a real
// WordPress, read back through WP-CLI and SQL.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { api, auth as authHeader, harness, http, run, sql, wp, wpTry } from "./env.ts";

/** The runtime's system-tables marker: `<series>+<fingerprint of registered tables>`. */
const tablesVersion = () => wp("eval", "echo \\Zero\\Wp\\Runtime::tablesVersion();");

// The binary run.sh built; honours CARGO_TARGET_DIR so parallel worktrees can share none.
function zeroBinary(): string {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const target = process.env.CARGO_TARGET_DIR ?? `${root}/target`;
  return `${target}/debug/zero`;
}

test("activation registers the post types, field groups and options page, and creates InnoDB tables", () => {
  assert.equal(wp("plugin", "get", harness.plugin, "--field=status"), "active");

  const types = JSON.parse(wp("post-type", "list", "--format=json", "--fields=name,public,show_in_rest,rest_base"));
  assert.deepEqual(
    // Lane fragments (tests/wp/app/lanes) add their own collections; this test owns the shared app's.
    types.filter((t: any) => ["zero_authors", "zero_posts", "zero_events"].includes(t.name)).map((t: any) => [t.name, t.public, t.show_in_rest, t.rest_base]),
    [["zero_authors", false, true, "zero_authors"], ["zero_posts", false, true, "zero_posts"], ["zero_events", false, true, "zero_events"]],
  );

  const scf = JSON.parse(wp("eval", `echo wp_json_encode([
    'groups' => array_map(fn ($g) => [$g['key'], $g['location'][0][0]['value'], array_column(acf_get_fields($g['key']), 'name', 'key')], acf_get_field_groups()),
    'pages' => array_map(fn ($p) => [$p['menu_slug'], $p['post_id'], $p['parent_slug']], array_values(acf_get_options_pages() ?: [])),
  ]);`));
  const posts = scf.groups.find((g: any) => g[0] === "group_zero_posts");
  assert.equal(posts[1], "zero_posts");
  // Title, content and slug are core post columns, not fields; the rest are `zero_<col>` meta.
  assert.deepEqual(Object.values(posts[2]), ["zero_excerpt", "zero_cover", "zero_tags", "zero_authorId", "zero_seo", "zero_gallery", "zero_sections", "zero_createdAt", "zero_updatedAt"]);
  assert.equal(posts[2].field_zero_posts_excerpt, "zero_excerpt");
  assert.deepEqual(scf.groups.find((g: any) => g[0] === "group_zero_global_settings").slice(0, 2), ["group_zero_global_settings", "zero-global-settings"]);
  assert.deepEqual(scf.pages, [["zero-global-settings", "zero_global_settings", "zero-blog"]]);

  const tables = sql("SELECT TABLE_NAME AS t, ENGINE AS e FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'wp\\_zero%' AND TABLE_NAME NOT LIKE 'wp\\_zero\\_identity\\_%'");
  assert.deepEqual(tables.map((r) => [r.t, r.e]).sort(), [["wp_zero__files", "InnoDB"], ["wp_zero__jobs", "InnoDB"], ["wp_zero__migrations", "InnoDB"], ["wp_zero__outbox", "InnoDB"], ["wp_zero__receipts", "InnoDB"], ["wp_zero__revisions", "InnoDB"], ["wp_zero_comments", "InnoDB"], ["wp_zero_field_teams", "InnoDB"], ["wp_zero_guestbook", "InnoDB"], ["wp_zero_hookNotes", "InnoDB"], ["wp_zero_jobNotes", "InnoDB"], ["wp_zero_phrases", "InnoDB"], ["wp_zero_reviews", "InnoDB"], ["wp_zero_signups", "InnoDB"], ["wp_zero_tour_log", "InnoDB"]]);
  assert.deepEqual(sql("SELECT app, id FROM wp_zero__migrations").map((r) => [r.app, r.id]), [["blog", "0001_init"]]);

  const registry: unknown = JSON.parse(wp("eval", `
    $plugin = \\Zero\\Wp\\Runtime::plugin();
    $description = $plugin->schema->describe();
    echo wp_json_encode([
      get_option('zero_runtime_tables') === \\Zero\\Wp\\Runtime::tablesVersion() ? '0.2' : get_option('zero_runtime_tables'),
      $description['runtime']['series'],
      $description['runtime']['wp']['actionScheduler'],
      $description['runtime']['wp']['mcpAdapter'],
      $description['runtime']['wp']['incompatibleTables'],
      $description['runtime']['pendingMigrations'],
      \\Zero\\Wp\\Runtime::app($plugin->dir, $plugin->dir . '/other-app.php'),
      \\Zero\\Wp\\Runtime::plugin() === $plugin,
    ]);
  `));
  assert.deepEqual(registry, ["0.2", "0.2", "4.2.0", "0.7.1", [], [], null, true]);
  const incompatible: unknown = JSON.parse(wp("eval", `
    $dir = sys_get_temp_dir() . '/zero-series-' . bin2hex(random_bytes(6));
    mkdir($dir . '/zero/app', 0777, true);
    $file = $dir . '/zero/app/schema.php';
    try {
      file_put_contents($file, '<?php return ' . var_export(['version'=>3, 'runtime'=>'0.1'], true) . ';');
      $result = \\Zero\\Wp\\Runtime::app($dir, $dir . '/app.php');
      ob_start(); do_action('admin_notices'); $notice = ob_get_clean();
      echo wp_json_encode([$result, \\Zero\\Wp\\Runtime::plugin(), str_contains($notice, 'built for runtime 0.1'), str_contains($notice, 'zero 0.2.x')]);
    } finally {
      unlink($file); rmdir($dir . '/zero/app'); rmdir($dir . '/zero'); rmdir($dir);
    }
  `, "--skip-plugins=zero-app-blog"));
  assert.deepEqual(incompatible, [null, null, true, true]);
  const diagnosis: unknown = JSON.parse(execFileSync(zeroBinary(), [
    "doctor", fileURLToPath(new URL("app", import.meta.url)), "--wp", "--site", `${harness.url}/?rest_route=/zero/v1`, "--json",
  ], { encoding: "utf8" }));
  assert.partialDeepStrictEqual(diagnosis, { data: { ok: true } });
});

test("one WP-CLI call activates Action Scheduler, the runtime and the app together", () => {
  // `wp plugin activate a b c` (and `--all`) loads each newly activated plugin after plugins_loaded
  // has fired, so Action Scheduler never registers its version before the runtime's platform check.
  const chain = ["action-scheduler", "zero-runtime", "zero-identity", harness.plugin];
  wp("plugin", "deactivate", ...[...chain].reverse());
  wp("plugin", "activate", ...chain);
  const active = JSON.parse(wp("plugin", "list", "--status=active", "--field=name", "--format=json"));
  assert.deepEqual(chain.filter((slug) => !active.includes(slug)), []);
  assert.equal(wp("option", "get", "zero_runtime_tables"), tablesVersion());
});

/**
 * A file-copy update of the app: write `migration` as a new migration and change schema.php, in the staged
 * copy run.sh mounts as wp-content/plugins. Returns the restore step.
 */
function copyUpdate(migration: string) {
  const app = fileURLToPath(new URL(`.wp-content/plugins/${harness.plugin}/zero/app/`, import.meta.url));
  const schema = readFileSync(app + "schema.php");
  writeFileSync(app + "migrations/9999_upgrade_probe.sql", migration);
  appendFileSync(app + "schema.php", "\n// upgraded\n");
  return {
    rewrite: (next: string) => writeFileSync(app + "migrations/9999_upgrade_probe.sql", next),
    async restore() {
      rmSync(app + "migrations/9999_upgrade_probe.sql");
      writeFileSync(app + "schema.php", schema);
      sql("DROP TABLE IF EXISTS wp_upgrade_probe");
      sql("DELETE FROM wp_zero__migrations WHERE id LIKE '9999\\_upgrade\\_probe%'");
      assert.equal((await fetch(`${api}/posts?limit=1`)).status, 200, "the restored build serves again");
    },
  };
}

/** Blocks until `ok()` holds or a deadline passes; each turn yields to the event loop (no sleeps). */
async function until(what: string, ok: () => boolean) {
  const deadline = Date.now() + 30_000;
  while (!ok()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await new Promise((r) => setImmediate(r));
  }
}

test("an app updated by copying files in migrates on the first request, once, while requests queue on the lock", async () => {
  // Another WordPress process holds the app's migration lock (the runtime's own Migrator::locked).
  const holder = spawn(fileURLToPath(new URL("harness.sh", import.meta.url)), ["wp", "eval", `
    \\Zero\\Wp\\Migrator::locked(\\Zero\\Wp\\Runtime::plugin()->connection(), 'zero_blog_schema', static function (): void {
      fwrite(STDOUT, "held\\n"); fflush(STDOUT); fgets(STDIN);
    });`], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  holder.stdout.on("data", (c) => (out += c));
  const exited = new Promise((resolve) => holder.on("close", resolve));
  // The holder boots WordPress first: copied in before that, the update would be applied by its own init.
  await until("the holder", () => out.includes("held"));
  const update = copyUpdate("CREATE TABLE `{prefix}upgrade_probe` (`n` INT NOT NULL) ENGINE=InnoDB;\n--> statement-breakpoint\nINSERT INTO `{prefix}upgrade_probe` (`n`) VALUES (1);\n");
  try {
    // No activation and no wp-admin visit: anonymous API requests only. Until PHP's opcache
    // revalidates schema.php (a couple of seconds) a request still sees the old build and is served
    // straight away; keep one request in flight at a time until four are queued on the lock.
    const waiting = () => Number(sql("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE INFO LIKE 'SELECT GET_LOCK%'")[0].n);
    const queued: Promise<number>[] = [];
    let inFlight = 0;
    await until("four requests waiting on the migration lock", () => {
      const blocked = waiting();
      if (blocked >= 4) return true;
      if (inFlight <= blocked) {
        inFlight++;
        queued.push(fetch(`${api}/posts?limit=1`).then((r) => { inFlight--; return r.status; }));
      }
      return false;
    });
    assert.deepEqual(sql("SELECT id FROM wp_zero__migrations WHERE id LIKE '9999%'"), [], "nothing ran while the lock was held");
    holder.stdin.end("go\n");
    await exited;
    assert.deepEqual(new Set(await Promise.all(queued)), new Set([200]), "every request was served, before or after the upgrade");
    assert.deepEqual(sql("SELECT id FROM wp_zero__migrations WHERE id LIKE '9999%'").map((r) => r.id), ["9999_upgrade_probe"]);
    assert.deepEqual(sql("SELECT n FROM wp_upgrade_probe"), [{ n: "1" }], "applied exactly once");
  } finally {
    holder.kill();
    await update.restore();
  }
});

// A half-applied app update (statement 1 commits as MySQL DDL, statement 2 fails). Each test below
// checks one door into Zero while storage is behind; the last one fixes the file and resumes.
describe("while an app update has failed half way", () => {
  let update: ReturnType<typeof copyUpdate>;
  let parent = 0, revision = 0, trashed = 0, owner = 0, owned = 0, due = 0;
  const trashMeta = () => sql(`SELECT p.post_status AS status, m.meta_key AS k, m.meta_value AS v FROM wp_posts p LEFT JOIN wp_postmeta m ON m.post_id = p.ID AND m.meta_key LIKE '\\_wp\\_trash\\_meta\\_%' WHERE p.ID = ${trashed} ORDER BY m.meta_key`);
  let trashBefore: Record<string, string>[] = [];
  /** WordPress's own write functions as the admin, with SCF's `_acf_changed` flag a wp-admin save carries. */
  const direct = (php: string) => wp("eval", `$_POST['_acf_changed'] = '1'; $r = ${php}; echo $r instanceof WP_Error ? $r->get_error_code() : ($r ? 'written' : 'refused');`, "--user=admin");

  before(async () => {
    parent = Number(wp("eval", "$id = wp_insert_post(['post_type' => 'zero_posts', 'post_status' => 'publish', 'post_title' => 'Before upgrade']); wp_update_post(['ID' => $id, 'post_title' => 'Before upgrade v2']); echo $id;"));
    revision = Number(sql(`SELECT ID FROM wp_posts WHERE post_type = 'revision' AND post_parent = ${parent} LIMIT 1`)[0].ID);
    trashed = Number(wp("eval", "$id = wp_insert_post(['post_type' => 'zero_posts', 'post_status' => 'publish', 'post_title' => 'Trashed before upgrade']); wp_trash_post($id); echo $id;"));
    trashBefore = trashMeta();
    owner = Number(wp("user", "create", `owner-${run}`, `owner-${run}@example.test`, "--role=author", "--porcelain"));
    owned = Number(wp("eval", `echo wp_insert_post(['post_type' => 'zero_posts', 'post_status' => 'draft', 'post_title' => 'Owned', 'post_author' => ${owner}]);`));
    // Scheduled far ahead now; pulled into the past once storage is behind, so its cron event is due.
    due = Number(wp("eval", "echo wp_insert_post(['post_type' => 'zero_posts', 'post_status' => 'future', 'post_title' => 'Due during upgrade', 'post_date_gmt' => '2099-01-01 00:00:00', 'post_date' => '2099-01-01 00:00:00']);"));
    update = copyUpdate("CREATE TABLE `{prefix}upgrade_probe` (`n` INT NOT NULL) ENGINE=InnoDB;\n--> statement-breakpoint\nINSERT INTO `{prefix}missing_table` (`n`) VALUES (1);\n");
    const refused = await fetch(`${api}/posts?limit=1`);
    assert.deepEqual([refused.status, (await refused.json()).code], [503, "unavailable"], "the update failed");
    assert.deepEqual(sql("SELECT id FROM wp_zero__migrations WHERE id LIKE '9999%'").map((r) => r.id), ["9999_upgrade_probe:1"], "statement 1 is recorded");
  });
  after(async () => {
    await update.restore();
    wp("post", "delete", String(parent), String(trashed), String(owned), String(due), "--force");
    wp("user", "delete", String(owner), "--yes");
  });

  test("Zero's API answers 503 while the rest of WordPress serves", async () => {
    const refused = await fetch(`${api}/posts?limit=1`);
    assert.deepEqual([refused.status, refused.headers.get("retry-after"), (await refused.json()).code], [503, "5", "unavailable"]);
    assert.equal((await fetch(`${harness.url}/wp-json/wp/v2/types`)).status, 200);
  });

  test("the trusted CLI refuses every command but migrate, with the reason", () => {
    for (const args of [["find", "posts"], ["migrate-legacy", "--dry-run"]]) {
      const out = JSON.parse(wpTry("zero", ...args));
      assert.deepEqual([out.error.status, out.error.code], [503, "unavailable"], args.join(" "));
      assert.match(out.error.detail, /Migration 9999_upgrade_probe failed at statement 2/);
    }
  });

  test("abilities say storage is upgrading, without the database error, before any access check", async () => {
    // A list (its access check is deferred to the call) and a delete a subscriber may not do (checked
    // up front): both give the unavailable answer, not "forbidden". Core reports any permission
    // callback's error as HTTP 403 (it keeps Zero's code and message, and the 503 in its data).
    const list = await http("GET", `${harness.url}/wp-json/wp-abilities/v1/abilities/blog/posts-list/run`, { as: "subscriber" });
    const del = await http("POST", `${harness.url}/wp-json/wp-abilities/v1/abilities/blog/posts-delete/run`, { as: "subscriber", body: { input: { id: parent } } });
    for (const r of [list, del]) {
      assert.deepEqual([r.json.code, r.json.message, r.json.additional_data?.[0]?.status ?? r.json.data?.status], ["zero_unavailable", "Storage is being upgraded; try again shortly", 503]);
    }
  });

  test("core REST writes to a Zero post type are refused, matched case-insensitively", async () => {
    const created = await http("POST", `${harness.url}/wp-json/wp/v2/zero_posts`, { as: "editor", body: { title: "During upgrade", status: "publish" } });
    const autosave = await http("POST", `${harness.url}/wp-json/wp/v2/ZERO_POSTS/${parent}/autosaves`, { as: "editor", body: { title: "Autosave during upgrade" } });
    assert.deepEqual([[created.status, created.json.code], [autosave.status, autosave.json.code]], [[503, "zero_unavailable"], [503, "zero_unavailable"]]);
    assert.equal(sql("SELECT COUNT(*) AS n FROM wp_posts WHERE post_title IN ('During upgrade', 'Autosave during upgrade')")[0].n, "0");
  });

  test("wp_insert_post, revisions and autosaves of Zero posts are refused by Zero's guard", () => {
    assert.deepEqual([
      direct("wp_insert_post(['post_type' => 'zero_posts', 'post_title' => 'Direct during upgrade'], true)"),
      direct(`wp_save_post_revision(${parent})`),
      direct(`wp_create_post_autosave(['post_ID' => ${parent}, 'post_title' => 'Autosave B', 'post_content' => 'changed', 'post_type' => 'zero_posts'])`),
    ], ["empty_content", "empty_content", "empty_content"]);
    assert.equal(sql("SELECT COUNT(*) AS n FROM wp_posts WHERE post_title IN ('Direct during upgrade', 'Autosave B')")[0].n, "0");
  });

  test("a Zero post can't change type to leave its collection", () => {
    assert.equal(direct(`wp_update_post(['ID' => ${parent}, 'post_type' => 'post'], true)`), "empty_content");
    assert.equal(sql(`SELECT post_type FROM wp_posts WHERE ID = ${parent}`)[0].post_type, "zero_posts");
  });

  test("a revision can't be re-parented out of its Zero post", () => {
    assert.equal(direct(`wp_update_post(['ID' => ${revision}, 'post_parent' => 0], true)`), "empty_content");
    assert.equal(sql(`SELECT post_parent FROM wp_posts WHERE ID = ${revision}`)[0].post_parent, String(parent));
  });

  test("Zero posts and their revisions can't be deleted", () => {
    assert.deepEqual([direct(`wp_delete_post_revision(${revision})`), direct(`wp_delete_post(${parent}, true)`)], ["refused", "refused"]);
    assert.equal(sql(`SELECT COUNT(*) AS n FROM wp_posts WHERE ID IN (${parent}, ${revision})`)[0].n, "2");
  });

  test("a trashed Zero post can't be restored, and keeps its trash metadata", () => {
    assert.deepEqual(trashBefore.map((r) => [r.status, r.k]), [["trash", "_wp_trash_meta_status"], ["trash", "_wp_trash_meta_time"]]);
    assert.equal(direct(`wp_untrash_post(${trashed})`), "refused");
    assert.deepEqual(trashMeta(), trashBefore, "status and both metadata values are unchanged");
  });

  test("a user who owns Zero posts can't be deleted, so neither they nor their posts go", () => {
    wpTry("eval", `require_once ABSPATH . 'wp-admin/includes/user.php'; wp_delete_user(${owner});`, "--user=admin");
    assert.equal(sql(`SELECT COUNT(*) AS n FROM wp_users WHERE ID = ${owner}`)[0].n, "1", "the user survives");
    assert.equal(sql(`SELECT post_author FROM wp_posts WHERE ID = ${owned}`)[0].post_author, String(owner), "and so do their posts");
  });

  test("a scheduled Zero post that falls due waits for storage instead of publishing", () => {
    // As WP cron does it: the post's own event is due and gets consumed when it runs.
    sql(`UPDATE wp_posts SET post_date_gmt = '2000-01-01 00:00:00', post_date = '2000-01-01 00:00:00' WHERE ID = ${due}`);
    wp("eval", `wp_clear_scheduled_hook('publish_future_post', [${due}]); wp_schedule_single_event(time() - 1, 'publish_future_post', [${due}]);`);
    const before = Date.now();
    wp("cron", "event", "run", "--due-now");
    assert.equal(sql(`SELECT post_status FROM wp_posts WHERE ID = ${due}`)[0].post_status, "future", "still scheduled");
    const queued = JSON.parse(wp("cron", "event", "list", "--hook=publish_future_post", "--fields=args,next_run_gmt", "--format=json"))
      .filter((e: { args: number[] }) => Number(e.args[0]) === due)
      .map((e: { next_run_gmt: string }) => Date.parse(e.next_run_gmt.replace(" ", "T") + "Z") - before);
    assert.equal(queued.length, 1, "exactly one retry is queued");
    assert.ok(queued[0] > 30_000 && queued[0] < 120_000, `the retry is about a minute out (${queued[0]} ms)`);
  });


  test("a queued job's delivery that falls due is deferred, not run against the old schema", () => {
    // A job queued before the failure (its row and delivery inserted the way the outbox leaves them).
    const id = `defer-${run}`;
    sql(`INSERT INTO wp_zero__jobs (id, job, input, \`key\`, dedupe, state, attempts, runAt, createdAt) VALUES ('${id}', 'stamp', '{"noteId":0,"fail":false}', NULL, NULL, 'pending', 0, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z')`);
    wp("eval", `as_schedule_single_action(time() - 1, 'zero_job', ['id' => '${id}'], 'zero-blog');`);
    const deliveries = () => sql(`SELECT status FROM wp_actionscheduler_actions WHERE hook = 'zero_job' AND args = '{"id":"${id}"}' ORDER BY action_id`).map((r) => r.status);
    try {
      wp("action-scheduler", "run", "--hooks=zero_job");
      assert.deepEqual(sql(`SELECT state, attempts FROM wp_zero__jobs WHERE id = '${id}'`), [{ state: "pending", attempts: "0" }], "not run");
      assert.deepEqual(deliveries(), ["complete", "pending"], "a later delivery waits for storage");
    } finally {
      sql(`DELETE FROM wp_zero__jobs WHERE id = '${id}'`);
      wp("eval", `as_unschedule_all_actions('zero_job', ['id' => '${id}'], 'zero-blog');`);
    }
  });

  test("job maintenance skips while storage is behind, leaving jobs and the outbox as they are", () => {
    const id = `stuck-${run}`;
    sql(`INSERT INTO wp_zero__jobs (id, job, input, state, attempts, runAt, lockedAt, createdAt) VALUES ('${id}', 'stamp', '{}', 'running', 1, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z')`);
    try {
      wp("eval", "do_action('zero_jobs_maintain');");
      assert.deepEqual(sql(`SELECT state FROM wp_zero__jobs WHERE id = '${id}'`).map((r) => r.state), ["running"], "a stale running job is not requeued yet");
    } finally {
      sql(`DELETE FROM wp_zero__jobs WHERE id = '${id}'`);
    }
  });

  test("the database error is shown to administrators only", () => {
    const notice = (user: string) => wp("eval", "do_action('admin_notices');", `--user=${user}`);
    assert.match(notice("admin"), /Migration 9999_upgrade_probe failed at statement 2/);
    assert.doesNotMatch(notice("subscriber"), /Migration/);
  });

  test("`wp zero migrate --mark-applied` only accepts the next pending statement", () => {
    const wrong = JSON.parse(wpTry("zero", "migrate", "--mark-applied=9999_upgrade_probe:1"));
    assert.match(wrong.error.detail, /next pending statement of 9999_upgrade_probe is 2 of 2/);
    assert.deepEqual(sql("SELECT id FROM wp_zero__migrations WHERE id LIKE '9999%'").map((r) => r.id), ["9999_upgrade_probe:1"]);
  });

  test("once fixed, the next request resumes after the committed statement", async () => {
    // Statement 1 is not replayed (it would fail: the table exists).
    update.rewrite("CREATE TABLE `{prefix}upgrade_probe` (`n` INT NOT NULL) ENGINE=InnoDB;\n--> statement-breakpoint\nINSERT INTO `{prefix}upgrade_probe` (`n`) VALUES (2);\n");
    assert.equal((await fetch(`${api}/posts?limit=1`)).status, 200);
    assert.deepEqual(sql("SELECT id FROM wp_zero__migrations WHERE id LIKE '9999%'").map((r) => r.id), ["9999_upgrade_probe"]);
    assert.deepEqual(sql("SELECT n FROM wp_upgrade_probe"), [{ n: "2" }]);
  });
});

test("`wp zero migrate --mark-applied` waits for the migration lock, marks, and finishes the file", async () => {
  // A pending migration whose statement 1 already took effect, with the schema hash left current so
  // WordPress's own init doesn't migrate: only the marking command touches the ledger here.
  const app = fileURLToPath(new URL(`.wp-content/plugins/${harness.plugin}/zero/app/`, import.meta.url));
  const file = app + "migrations/9999_upgrade_probe.sql";
  writeFileSync(file, "CREATE TABLE `{prefix}upgrade_probe` (`n` INT NOT NULL) ENGINE=InnoDB;\n--> statement-breakpoint\nINSERT INTO `{prefix}upgrade_probe` (`n`) VALUES (3);\n");
  sql("CREATE TABLE wp_upgrade_probe (`n` INT NOT NULL) ENGINE=InnoDB");
  const harnessSh = fileURLToPath(new URL("harness.sh", import.meta.url));
  const holder = spawn(harnessSh, ["wp", "eval", `
    \\Zero\\Wp\\Migrator::locked(\\Zero\\Wp\\Runtime::plugin()->connection(), 'zero_blog_schema', static function (): void {
      fwrite(STDOUT, "held\\n"); fflush(STDOUT); fgets(STDIN);
    });`], { stdio: ["pipe", "pipe", "pipe"] });
  let held = "";
  holder.stdout.on("data", (c) => (held += c));
  const holderDone = new Promise((resolve) => holder.on("close", resolve));
  try {
    await until("the holder", () => held.includes("held"));
    let cli = "";
    const marking = spawn(harnessSh, ["wp", "zero", "migrate", "--mark-applied=9999_upgrade_probe:1"], { stdio: ["ignore", "pipe", "pipe"] });
    marking.stdout.on("data", (c) => (cli += c));
    const markingDone = new Promise((resolve) => marking.on("close", resolve));
    const waiting = () => Number(sql("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE INFO LIKE 'SELECT GET_LOCK%'")[0].n);
    await until("the marking command waiting on the migration lock", () => waiting() >= 1);
    assert.deepEqual(sql("SELECT id FROM wp_zero__migrations WHERE id LIKE '9999%'"), [], "nothing marked while the lock is held");
    holder.stdin.end("go\n");
    await holderDone;
    await markingDone;
    assert.deepEqual(JSON.parse(cli).data.applied, ["9999_upgrade_probe"], "marked statement 1, ran statement 2, finished the file");
    assert.deepEqual(sql("SELECT n FROM wp_upgrade_probe"), [{ n: "3" }]);
  } finally {
    holder.kill();
    rmSync(file, { force: true });
    sql("DROP TABLE IF EXISTS wp_upgrade_probe");
    sql("DELETE FROM wp_zero__migrations WHERE id LIKE '9999%'");
  }
});

/** Runs a PHP fixture from tests/wp/fixtures inside WordPress (`wp eval`) and parses its JSON output. */
const evalFixture = (name: string) =>
  JSON.parse(wp("eval", readFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)), "utf8").replace(/^<\?php\s*/, "")));

test("a statement that committed without its marker keeps failing until the operator marks it", () => {
  // Nothing guesses that an existing object is the right one: `wp zero migrate --mark-applied` is the
  // explicit way past it, and only for the next pending statement.
  assert.deepEqual(evalFixture("migration-resume.php"), {
    retry: "still failing", markWrongStep: "refused", markOtherFile: "refused", markPathAlias: "refused",
    mark: "ok", resume: "ok", columns: ["id", "n"], ledger: ["9999_resume"],
  });
});

test("a second app on the site runs its own 0001_init: the ledger is per app", () => {
  // The blog's ledger already holds `0001_init`; another app's `0001_init` is a different file.
  assert.deepEqual(evalFixture("second-app-ledger.php"), [["0001_init"], ["0001_init"], true]);
  assert.deepEqual(sql("SELECT app, id FROM wp_zero__migrations").map((r) => [r.app, r.id]), [["blog", "0001_init"]], "the blog's ledger is untouched");
});

test("an old unkeyed ledger goes to its one recorded app without replaying anything, or is refused", () => {
  // A drop-then-re-add history with data in the re-added column: a replay would destroy it.
  assert.deepEqual(evalFixture("legacy-ledger.php"), {
    converted: { applied: [], ledger: ["legacy/0001_init", "legacy/0002_update", "legacy/0003_update"], data: "kept" },
    refused: { unclear: true, keyed: false, data: "kept" },
  });
  assert.deepEqual(sql("SELECT app, id FROM wp_zero__migrations").map((r) => [r.app, r.id]), [["blog", "0001_init"]], "the blog's ledger is restored");
});

test("a runtime-only update converts the blog's old ledger on its next request, without replaying", async () => {
  // The blog's build is unchanged (its schema hash stands); only the ledger is the old, unkeyed shape.
  const saved = sql("SELECT app, id, applied_at FROM wp_zero__migrations");
  sql("DROP TABLE wp_zero__migrations");
  sql("CREATE TABLE wp_zero__migrations (`id` VARCHAR(191) NOT NULL, `applied_at` CHAR(24) NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB");
  sql("INSERT INTO wp_zero__migrations (id, applied_at) VALUES ('0001_init', '2026-01-01T00:00:00.000Z')");
  const comments = sql("SELECT COUNT(*) AS n FROM wp_zero_comments")[0].n;
  try {
    assert.equal((await fetch(`${api}/comments?limit=1`)).status, 200);
    assert.deepEqual(sql("SELECT app, id FROM wp_zero__migrations").map((r) => [r.app, r.id]), [["blog", "0001_init"]], "the old rows are the blog's");
    assert.equal(sql("SELECT COUNT(*) AS n FROM wp_zero_comments")[0].n, comments, "nothing was replayed or dropped");
  } finally {
    // Whatever happened above, put back the canonical keyed ledger and the blog's rows.
    sql("DROP TABLE IF EXISTS wp_zero__migrations");
    sql("CREATE TABLE wp_zero__migrations (`app` VARCHAR(191) NOT NULL, `id` VARCHAR(191) NOT NULL, `applied_at` CHAR(24) NOT NULL, PRIMARY KEY (`app`, `id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    for (const r of saved) sql(`INSERT INTO wp_zero__migrations (app, id, applied_at) VALUES ('${r.app}', '${r.id}', '${r.applied_at}')`);
  }
});

test("two apps' uninstallers run in one request, remove only derived capabilities, and keep queued work", () => {
  // `wp plugin uninstall a b` includes both files in one process; create_<type> is never derived.
  assert.deepEqual(evalFixture("two-uninstallers.php"), {
    ran: ["alpha", "beta"],
    left: ["create_zero_alpha"],
    // Queued work is the app's content: its deliveries stay for a reinstall to run.
    actions: { alpha: "pending", beta: "pending", other: "pending" },
  });
});

test("a job falling due while the app is deactivated keeps its delivery and runs once the app is back", async () => {
  // jobNotes' afterCreate enqueues `stamp`; deactivate the app before Action Scheduler runs it.
  const note = await (await fetch(`${api}/jobNotes`, { method: "POST", headers: { ...authHeader("editor"), "content-type": "application/json" }, body: JSON.stringify({ title: `away ${run}` }) })).json();
  const [job] = sql(`SELECT id FROM wp_zero__jobs WHERE job = 'stamp' AND JSON_VALUE(input, '$.noteId') = ${note.data.id}`);
  const deliveries = () => sql(`SELECT a.status AS s, g.slug AS g FROM wp_actionscheduler_actions a JOIN wp_actionscheduler_groups g USING (group_id) WHERE a.hook = 'zero_job' AND a.args = '{"id":"${job.id}"}' ORDER BY a.action_id`).map((r) => `${r.g}:${r.s}`);
  wp("plugin", "deactivate", harness.plugin);
  try {
    wp("action-scheduler", "run", "--hooks=zero_job");
    assert.deepEqual(sql(`SELECT state FROM wp_zero__jobs WHERE id = '${job.id}'`).map((r) => r.state), ["pending"], "nothing ran it");
    assert.deepEqual(deliveries(), ["zero-blog:complete", "zero-blog:pending"], "a fresh delivery waits in the app's own group");
  } finally {
    wp("plugin", "activate", harness.plugin);
  }
  sql(`UPDATE wp_actionscheduler_actions SET scheduled_date_gmt = UTC_TIMESTAMP(), scheduled_date_local = NOW() WHERE hook = 'zero_job' AND status = 'pending' AND args = '{"id":"${job.id}"}'`);
  wp("action-scheduler", "run", "--hooks=zero_job");
  assert.deepEqual(sql(`SELECT state, attempts FROM wp_zero__jobs WHERE id = '${job.id}'`), [{ state: "done", attempts: "1" }], "the app ran it exactly once");
});

test("a cancelled job's delivery isn't kept while the app is away", async () => {
  const note = await (await fetch(`${api}/jobNotes`, { method: "POST", headers: { ...authHeader("editor"), "content-type": "application/json" }, body: JSON.stringify({ title: `cancelled ${run}` }) })).json();
  const [job] = sql(`SELECT id FROM wp_zero__jobs WHERE job = 'stamp' AND JSON_VALUE(input, '$.noteId') = ${note.data.id}`);
  wp("zero", "jobs", "cancel", job.id);
  wp("plugin", "deactivate", harness.plugin);
  try {
    wp("action-scheduler", "run", "--hooks=zero_job");
    const statuses = sql(`SELECT status FROM wp_actionscheduler_actions WHERE hook = 'zero_job' AND args = '{"id":"${job.id}"}' ORDER BY action_id`).map((r) => r.status);
    assert.deepEqual(statuses, ["complete"], "no replacement delivery for a dead job");
  } finally {
    wp("plugin", "activate", harness.plugin);
  }
});

test("if the job's state can't be read while the app is away, the action fails instead of completing", async () => {
  const note = await (await fetch(`${api}/jobNotes`, { method: "POST", headers: { ...authHeader("editor"), "content-type": "application/json" }, body: JSON.stringify({ title: `unreadable ${run}` }) })).json();
  const [job] = sql(`SELECT id FROM wp_zero__jobs WHERE job = 'stamp' AND JSON_VALUE(input, '$.noteId') = ${note.data.id}`);
  wp("plugin", "deactivate", harness.plugin);
  sql("RENAME TABLE wp_zero__jobs TO wp_zero__jobs_away");
  try {
    wp("action-scheduler", "run", "--hooks=zero_job");
    const statuses = sql(`SELECT status FROM wp_actionscheduler_actions WHERE hook = 'zero_job' AND args = '{"id":"${job.id}"}' ORDER BY action_id`).map((r) => r.status);
    assert.deepEqual(statuses, ["failed"], "a failed read is a failed action, never a quiet completion");
  } finally {
    sql("RENAME TABLE wp_zero__jobs_away TO wp_zero__jobs");
    wp("plugin", "activate", harness.plugin);
    wp("zero", "jobs", "cancel", job.id);
  }
});

test("if the delivery can't be kept while the app is away, the action fails visibly instead of completing", async () => {
  const note = await (await fetch(`${api}/jobNotes`, { method: "POST", headers: { ...authHeader("editor"), "content-type": "application/json" }, body: JSON.stringify({ title: `refused ${run}` }) })).json();
  const [job] = sql(`SELECT id FROM wp_zero__jobs WHERE job = 'stamp' AND JSON_VALUE(input, '$.noteId') = ${note.data.id}`);
  const statuses = () => sql(`SELECT status FROM wp_actionscheduler_actions WHERE hook = 'zero_job' AND args = '{"id":"${job.id}"}' ORDER BY action_id`).map((r) => r.status);
  wp("plugin", "deactivate", harness.plugin);
  try {
    // Action Scheduler refuses the replacement (its pre_as_schedule_single_action filter returns 0),
    // via a must-use plugin for just this run.
    const mu = "zero-test-refuse-schedule";
    wp("eval", `wp_mkdir_p(WPMU_PLUGIN_DIR); file_put_contents(WPMU_PLUGIN_DIR . '/${mu}.php', "<?php add_filter('pre_as_schedule_single_action', fn () => 0);");`);
    try {
      wp("action-scheduler", "run", "--hooks=zero_job");
    } finally {
      wp("eval", `@unlink(WPMU_PLUGIN_DIR . '/${mu}.php');`);
    }
    assert.deepEqual(statuses(), ["failed"], "recorded as failed, not complete");
    assert.deepEqual(sql(`SELECT state FROM wp_zero__jobs WHERE id = '${job.id}'`).map((r) => r.state), ["pending"]);
  } finally {
    wp("plugin", "activate", harness.plugin);
    wp("zero", "jobs", "cancel", job.id);
  }
});

test("a runtime update whose system tables fail refuses Zero until they apply", async (t) => {
  // A feature's system table that can't be created yet (its DDL references a missing table).
  const plugins = fileURLToPath(new URL(".wp-content/plugins/zero-runtime/zero/", import.meta.url));
  const probe = plugins + "Wp/zz-probe.php";
  writeFileSync(probe, `<?php \\Zero\\SystemTables::register('probe', [], [
    'CREATE TABLE IF NOT EXISTS {prefix}zero__probe (id BIGINT PRIMARY KEY, other BIGINT, FOREIGN KEY (other) REFERENCES {prefix}zero__probe_missing (id)) ENGINE=InnoDB',
  ]);`);
  const mu = "/var/www/html/wp-content/mu-plugins/zero-probe.php";
  wp("eval", `wp_mkdir_p(WP_CONTENT_DIR . '/mu-plugins'); file_put_contents('${mu}', "<?php add_action('zero_runtime_loaded', static fn () => require WP_PLUGIN_DIR . '/zero-runtime/zero/Wp/zz-probe.php');");`);
  t.after(() => {
    wp("eval", `@unlink('${mu}');`);
    rmSync(probe, { force: true });
    sql("DROP TABLE IF EXISTS wp_zero__probe, wp_zero__probe_missing");
  });
  // An older runtime series recorded: the next request applies the system tables, and fails.
  wp("option", "update", "zero_runtime_tables", "0.1");
  const refused = await fetch(`${api}/posts?limit=1`);
  assert.deepEqual([refused.status, (await refused.json()).code], [503, "unavailable"]);
  assert.equal(wp("option", "get", "zero_runtime_tables"), "0.1", "the version is only recorded once every table applies");
  assert.deepEqual(JSON.parse(wpTry("zero", "find", "posts")).error.status, 503);
  // The cause goes away; the next request completes the runtime upgrade and Zero serves again.
  sql("CREATE TABLE wp_zero__probe_missing (id BIGINT PRIMARY KEY) ENGINE=InnoDB");
  assert.equal((await fetch(`${api}/posts?limit=1`)).status, 200);
  assert.equal(wp("option", "get", "zero_runtime_tables"), tablesVersion());
});

test("collection capabilities come from the access rules, not from roles", () => {
  // posts: create "author", update editor-or-own, delete "editor"; vault (lane R fixture): admin only.
  const can = JSON.parse(wp("eval", `echo wp_json_encode(array_map(fn ($u) => [
    user_can($u, 'create_zero_posts'), user_can($u, 'edit_zero_posts'), user_can($u, 'delete_others_zero_posts'),
    user_can($u, 'create_zero_vault'), user_can($u, 'edit_zero_vault'),
  ], ['admin' => get_user_by('login', 'admin'), 'editor' => get_user_by('login', 'editor'), 'author' => get_user_by('login', 'author'), 'subscriber' => get_user_by('login', 'subscriber')]));`));
  assert.deepEqual(can, {
    admin: [true, true, true, true, true],
    editor: [true, true, true, false, false],
    author: [true, true, false, false, false],
    subscriber: [false, true, false, false, false],
  });
  const roleCaps = JSON.parse(wp("eval", `echo wp_json_encode(array_values(array_filter(array_keys(get_role('author')->capabilities), fn ($c) => str_ends_with($c, 'zero_posts'))));`));
  assert.deepEqual(roleCaps, [], "no role carries a Zero capability");
});

test("runtime registrations extend system tables and every generated SCF field", () => {
  const result = JSON.parse(wp("eval", `
    $plugin = \\Zero\\Wp\\Plugin::instance();
    \\Zero\\SystemTables::register('seam', [], [
      'CREATE TABLE IF NOT EXISTS {prefix}zero__seam (id bigint PRIMARY KEY, value text NOT NULL) ENGINE=InnoDB'
    ]);
    $store = $plugin->app()->store;
    \\Zero\\SystemTables::apply($store);
    $plugin->connection()->run('INSERT INTO wp_zero__seam (id, value) VALUES (?, ?)', [1, 'preserved']);
    \\Zero\\SystemTables::apply($store);
    \\Zero\\Wp\\Scf::fieldFilter(static function (array $field, array $def, string $col, array $spec): array {
      $siblings = $spec['columns'] ?? $spec['fields'];
      $field['instructions'] = $col . ':' . $def['type'] . ':' . (isset($siblings[$col]) ? 'sibling' : 'missing');
      return $field;
    });
    acf_get_local_store('groups')->reset();
    acf_get_local_store('fields')->reset();
    \\Zero\\Wp\\Scf::register($plugin->schema);
    echo wp_json_encode([
      $plugin->connection()->run('SELECT value FROM wp_zero__seam'),
      array_map(static fn ($key) => acf_get_local_field($key)['instructions'], [
        'field_zero_posts_excerpt', 'field_zero_posts_seo_metaTitle',
        'field_zero_posts_gallery_image', 'field_zero_posts_sections_hero_heading',
        'field_zero_global_settings_siteTitle', 'field_zero_global_settings_social_href'
      ])
    ]);
    $plugin->connection()->run('DROP TABLE wp_zero__seam');
  `));
  assert.deepEqual(result, [[{ value: "preserved" }], [
    "excerpt:text:sibling", "metaTitle:text:sibling", "image:media:sibling",
    "heading:text:sibling", "siteTitle:text:sibling", "href:url:sibling",
  ]]);

  const flags: unknown = JSON.parse(wp("zero", "seam-flags", "work", "--once", "--state=pending", "--exec=" + `
    WP_CLI::add_hook('after_wp_load', static function (): void {
      \\Zero\\Extensions::cli('seam-flags', static fn (array $args, array $flags): array => [$args, $flags]);
    });
  `));
  assert.deepEqual(flags, { data: [["work"], { once: true, state: "pending" }] });

  const stream: unknown = JSON.parse(wp("eval", `
    $app = \\Zero\\Wp\\Plugin::instance()->app();
    \\Zero\\Extensions::route('download-proof', static function (): \\Zero\\Response {
      \\Zero\\Extensions::afterCommit(static fn () => update_option('zero_stream_committed', 'committed', false));
      return \\Zero\\Response::raw(static function (): void {
        echo "file\\0bytes:" . get_option('zero_stream_committed', 'uncommitted');
      }, 200, ['Content-Type' => 'application/octet-stream', 'Content-Disposition' => 'attachment; filename="proof.bin"']);
    });
    $request = new WP_REST_Request('GET', '/zero/v1/download-proof');
    $request['path'] = 'download-proof';
    $response = \\Zero\\Wp\\Rest::dispatch($app, $request);
    ob_start();
    $served = \\Zero\\Wp\\Rest::serve(false, $response);
    $body = ob_get_clean();
    echo wp_json_encode([$response->get_status(), $response->get_headers()['Content-Type'], $response->get_headers()['Content-Disposition'], $served, $body]);
    delete_option('zero_stream_committed');
  `));
  assert.deepEqual(stream, [200, "application/octet-stream", 'attachment; filename="proof.bin"', true, "file\0bytes:committed"]);
});
