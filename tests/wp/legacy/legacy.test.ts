// Migrating an ORIGINAL Zero (0.8) site to the new app (lane M), against real WordPress: run.sh
// seeded the site through the original kernel (or replayed the rows it wrote), with the app that
// `first migrate config --from zero` made from capsule.ts active. Everything is read back through
// /wp-json/first/v1, the API the migrated app serves.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { api, http, ok, sql, wp, wpTry } from "../env.ts";

const here = dirname(fileURLToPath(import.meta.url));
const site = JSON.parse(readFileSync(process.env.ZERO_LEGACY_SITE!, "utf8"));
const ids: Record<string, any> = site.ids;
const release = join(here, "content-model.php");
const migrate = (...flags: string[]) => {
  // `first migrate-legacy - < release` forwards exactly this: the release on stdin to the site's WP-CLI.
  const r = spawnSync(`${here}/../harness.sh`, ["wp", "zero", "migrate-legacy", "-", ...flags], { input: readFileSync(release), encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim() === "" ? null : JSON.parse(r.stdout) };
};
// Everything the migration may touch: posts with their meta, term relationships and term counts.
const snapshot = () => ({
  posts: sql("SELECT p.ID, p.post_type, p.post_status, p.post_author, p.post_date_gmt, p.post_parent, m.meta_key, m.meta_value FROM wp_posts p LEFT JOIN wp_postmeta m ON m.post_id = p.ID ORDER BY p.ID, m.meta_key, m.meta_value"),
  terms: sql("SELECT object_id, term_taxonomy_id FROM wp_term_relationships ORDER BY object_id, term_taxonomy_id"),
  counts: sql("SELECT term_taxonomy_id, taxonomy, count FROM wp_term_taxonomy ORDER BY term_taxonomy_id"),
});
const q = (o: object) => "?" + new URLSearchParams(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));

let before_: ReturnType<typeof snapshot>;
before(() => {
  before_ = snapshot();
});

// The original Space kept upload bytes in its private storage root. Until they're copied into
// wp-content/uploads (docs/migrating-from-zero.md), the migration refuses: WordPress couldn't serve them.
test("media whose files are still in the original Space's storage refuse the run", () => {
  const r = migrate("--dry-run");
  assert.deepEqual([r.code, r.out.error.code, r.out.error.pointer], [1, "invalid_input", `/records/${ids.apollo}/cover`]);
  wp("eval", `$src = ${JSON.stringify(site.storage)}; $dst = wp_upload_dir()['basedir'];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS)) as $f) {
      $to = $dst . substr($f->getPathname(), strlen($src)); wp_mkdir_p(dirname($to)); copy($f->getPathname(), $to);
    }`);
  before_ = snapshot();
});

test("a post's content is checked against the new app's content column", () => {
  // The new tasks collection reads post_content as `brief`, whose rule wants 20+ characters: a dry
  // run with that schema refuses the original posts, whose content is shorter.
  const r = JSON.parse(wp("eval", `
    $plugin = \\First\\Wp\\Runtime::plugin();
    $raw = require $plugin->dir . '/first/app/schema.php';
    $raw['collections']['tasks']['content'] = 'brief';
    $raw['collections']['tasks']['columns']['brief'] = ['type' => 'richText', 'rules' => ['min' => 20]];
    $GLOBALS['wpdb']->update($GLOBALS['wpdb']->posts, ['post_content' => 'Too short'], ['ID' => ${ids.parent}]);
    $plugin->app();
    try {
      (new \\First\\Wp\\Legacy\\Migrate($plugin->connection(), new \\First\\Schema($raw)))->run(require '/tmp/first-legacy-release.php', true);
      echo 'null';
    } catch (\\First\\HttpError $e) { echo json_encode([$e->errorCode, $e->pointer]); }
    finally { $GLOBALS['wpdb']->update($GLOBALS['wpdb']->posts, ['post_content' => ''], ['ID' => ${ids.parent}]); }
  `));
  assert.deepEqual(r, ["invalid_input", `/records/${ids.parent}/brief`]);
});

test("an unknown flag is refused before anything runs", () => {
  // A typo like --dryrun must not fall through to a real migration.
  const r = JSON.parse(wpTry("zero", "migrate-legacy", "/tmp/first-legacy-release.php", "--dryrun"));
  assert.deepEqual([r.error.code, r.error.detail.includes("--dryrun")], ["invalid_command", true]);
  assert.deepEqual(snapshot(), before_);
});

test("a dry run reports every record and changes nothing", () => {
  const r = migrate("--dry-run");
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.data, {
    dryRun: true,
    collections: {
      projects: { records: [ids.apollo, ids.gemini, ids.scheduled], revisions: 2 },
      tasks: { records: [ids.parent, ids.child], revisions: 1 },
    },
    skipped: [{ id: ids.trashed, status: "trash" }],
    review: [],
  });
  assert.deepEqual(snapshot(), before_);
  // Authored release ids can differ from storage keys. Exercise a real write inside
  // a rolled-back transaction, retaining the same record/revision/reference owner.
  const mixed = JSON.parse(wp("eval", `
    $plugin = \\First\\Wp\\Runtime::plugin();
    $plugin->app();
    $raw = require $plugin->dir . '/first/app/schema.php';
    $release = require '/tmp/first-legacy-release.php';
    $names = ['projects' => 'stockProjects', 'tasks' => 'stockTasks'];
    $storage = ['projects' => 'stock_projects', 'tasks' => 'stock_tasks'];
    foreach ($release['postTypes'] as &$resource) {
      $resource['id'] = $names[$resource['id']] ?? $resource['id'];
      foreach ($resource['fields'] as &$field) {
        if (isset($field['definition']['collection'])) {
          $field['definition']['collection'] = $names[$field['definition']['collection']];
        }
      }
      unset($field);
    }
    unset($resource);
    $collections = [];
    foreach ($raw['collections'] as $name => $spec) {
      $spec['key'] = $names[$name];
      $spec['wp']['postType'] = 'first_' . $storage[$name];
      foreach ($spec['columns'] as &$column) {
        if (isset($column['references'])) {
          $column['references']['collection'] = $storage[$column['references']['collection']];
        }
      }
      unset($column);
      $collections[$storage[$name]] = $spec;
    }
    $raw['collections'] = $collections;
    $db = $plugin->connection();
    $w = $db->wpdb();
    $db->begin();
    try {
      foreach ($names as $old => $name) {
        $db->run("UPDATE \`{$w->termmeta}\` SET meta_value = ? WHERE meta_key = ? AND meta_value = ?", [$name, '_zero_resource_id', $old]);
      }
      $migrate = new \\First\\Wp\\Legacy\\Migrate($db, new \\First\\Schema($raw));
      $dry = $migrate->run($release, true);
      $written = $migrate->run($release, false);
      echo json_encode([
        'dry' => $dry['collections'], 'written' => $written['collections'],
        'postType' => $db->run("SELECT post_type FROM \`{$w->posts}\` WHERE ID = ?", [${ids.apollo}])[0]['post_type'],
        'reference' => get_post_meta(${ids.parent}, 'first_projectId', true),
      ]);
    } finally { $db->rollback(); }
  `));
  const expected = {
    stockProjects: r.out.data.collections.projects,
    stockTasks: r.out.data.collections.tasks,
  };
  assert.deepEqual(mixed, { dry: expected, written: expected, postType: "first_stock_projects", reference: String(ids.apollo) });
  assert.deepEqual(snapshot(), before_);
});

test("a database failure after writes have begun rolls every write back", () => {
  // The last task's meta write fails inside MariaDB, after the projects were already rewritten.
  // (Sent through $wpdb: the mariadb client would split the body at its `;`.)
  wp("eval", `$GLOBALS['wpdb']->query("CREATE TRIGGER first_legacy_fail BEFORE INSERT ON wp_postmeta FOR EACH ROW IF NEW.post_id = ${ids.child} AND NEW.meta_key = 'first_projectId' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected'; END IF") || exit(1);`);
  try {
    const r = migrate();
    assert.equal(r.code, 1);
    assert.deepEqual(snapshot(), before_);
  } finally {
    sql("DROP TRIGGER first_legacy_fail");
  }
});

test("a failed term recount, the last write, rolls the whole migration back", () => {
  wp("eval", `$GLOBALS['wpdb']->query("CREATE TRIGGER first_legacy_fail_count BEFORE UPDATE ON wp_term_taxonomy FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected'") || exit(1);`);
  try {
    assert.equal(migrate().code, 1);
    assert.deepEqual(snapshot(), before_);
  } finally {
    sql("DROP TRIGGER first_legacy_fail_count");
  }
});

test("the migration keeps every record, field, status, date and author, read through /first/v1", async () => {
  const r = migrate();
  assert.equal(r.code, 0, JSON.stringify(r.out));
  const published = (id: number) => site.posts.find((p: any) => Number(p.ID) === id).post_date_gmt.replace(" ", "T") + ".000Z";
  const projects = await ok("GET", "/projects" + q({ orderBy: "id" }), { as: "admin" });
  assert.deepEqual(projects, [
    { id: ids.apollo, title: "Apollo 11", budget: 25, active: true, kickoff: "2026-03-01T10:00:00.000Z", reviewedAt: "2026-03-01T10:00:00.000Z", stage: "live", tags: ["red", "blue"], cover: ids.media[0], gallery: ids.media, status: "published", publishedAt: published(ids.apollo) },
    // Saved through the SCF form (wp-admin's path), as a draft.
    { id: ids.gemini, title: "Gemini", budget: 7, active: false, kickoff: null, reviewedAt: "2026-03-01T10:00:00.000Z", stage: "idea", tags: [], cover: null, gallery: null, status: "draft", publishedAt: null },
    { id: ids.scheduled, title: "Artemis", budget: null, active: null, kickoff: null, reviewedAt: "2026-03-01T10:00:00.000Z", stage: null, tags: null, cover: null, gallery: null, status: "scheduled", publishedAt: "2031-01-01T09:00:00.000Z" },
  ]);
  // Anonymous readers see only the published record, as in the original app (publicRead).
  assert.deepEqual((await ok("GET", "/projects")).map((p: any) => p.id), [ids.apollo]);
  // Authors and post dates are the rows' own: the editor still owns the tasks it wrote.
  const authors = sql(`SELECT ID, post_author, post_type FROM wp_posts WHERE ID IN (${ids.parent}, ${ids.child}, ${ids.apollo}) ORDER BY ID`);
  assert.deepEqual(authors.map((a) => [Number(a.ID), a.post_type, a.post_author]), [
    [ids.apollo, "first_projects", "1"], [ids.parent, "first_tasks", "2"], [ids.child, "first_tasks", "2"],
  ]);
  // The trashed post stays a trashed native post.
  assert.deepEqual(sql(`SELECT post_type, post_status FROM wp_posts WHERE ID = ${ids.trashed}`), [{ post_type: "post", post_status: "trash" }]);
  // Only the collection term is removed: the default category the original posts carried stays,
  // counted the way WordPress counts it (published native posts; the migrated ones no longer are).
  const terms = sql(`SELECT tr.object_id, tt.taxonomy FROM wp_term_relationships tr JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id WHERE tr.object_id = ${ids.apollo}`);
  assert.deepEqual(terms.map((t) => t.taxonomy), ["category"]);
  const publishedNative = sql("SELECT COUNT(*) AS n FROM wp_term_relationships tr JOIN wp_posts p ON p.ID = tr.object_id WHERE tr.term_taxonomy_id = 1 AND p.post_type = 'post' AND p.post_status = 'publish'")[0].n;
  assert.deepEqual(sql("SELECT count FROM wp_term_taxonomy WHERE taxonomy = 'category' AND term_id = 1"), [{ count: publishedNative }]);
  assert.equal(publishedNative, "1"); // WordPress's own sample post; Apollo and Plan launch no longer count.
  // Collection term counts follow WordPress: published posts still attached (only the trashed one is left).
  assert.deepEqual(sql("SELECT tt.count FROM wp_term_taxonomy tt WHERE tt.taxonomy = 'zero_collection' ORDER BY tt.term_taxonomy_id").map((r) => r.count), ["0", "0"]);
});

test("references resolve with `with`, media resolve to attachments", async () => {
  const tasks = await ok("GET", "/tasks" + q({ orderBy: "id", with: { project: true, parent: true } }), { as: "admin" });
  assert.deepEqual(tasks.map((t: any) => [t.id, t.title, t.notes, t.project.title, t.parent?.title ?? null, t.status]), [
    [ids.parent, "Plan launch", "Line one\nLine two", "Apollo 11", null, "published"],
    [ids.child, "Book the launch pad", null, "Apollo 11", "Plan launch", "draft"],
  ]);
  const apollo = await ok("GET", `/projects/${ids.apollo}` + q({ with: { cover: true } }), { as: "admin" });
  assert.equal(apollo.cover.id, ids.media[0]);
  assert.equal(apollo.cover.filename, "cover.png");
  // WordPress serves the original upload's bytes at the cover's URL.
  const bytes = Buffer.from(await (await fetch(apollo.cover.url)).arrayBuffer());
  assert.deepEqual(bytes, Buffer.from(site.files[String(ids.media[0])], "base64"));
});

test("revisions stay listable and readable, and a restore keeps the fields", async () => {
  const listed = await ok("GET", `/tasks/${ids.child}/revisions`, { as: "editor" });
  const revision = site.posts.find((p: any) => p.post_type === "revision" && Number(p.post_parent) === ids.child);
  assert.deepEqual(listed.map((r: any) => [r.id, r.user?.name ?? null]), [[Number(revision.ID), "Editor"]]);
  const row = await ok("GET", `/tasks/${ids.child}/revisions/${revision.ID}`, { as: "editor" });
  assert.deepEqual([row.title, row.projectId, row.parentId], ["Book the launch pad", ids.apollo, ids.parent]);
  // The original app's revisions carried only title/content; restoring one keeps the fields.
  await ok("PATCH", `/tasks/${ids.child}`, { as: "editor", body: { title: "Renamed" } });
  const restored = await ok("POST", `/tasks/${ids.child}/revisions/${revision.ID}/restore`, { as: "editor" });
  assert.deepEqual([restored.title, restored.projectId, restored.parentId], ["Book the launch pad", ids.apollo, ids.parent]);
});

test("the migrated records are ordinary rows of the new app", async () => {
  const updated = await ok("PATCH", `/projects/${ids.gemini}`, { as: "editor", body: { budget: 8, tags: ["green"] } });
  assert.deepEqual([updated.budget, updated.tags, updated.stage], [8, ["green"], "idea"]);
  // The required reference refuses deleting its target (Zero has no dangling ids).
  const r = await http("DELETE", `${api}/projects/${ids.apollo}`, { as: "editor" });
  assert.equal(r.json.code, "reference_violation");
});

test("a generically counted taxonomy keeps counting every relationship", () => {
  // No callback, but a non-post object type: WordPress counts it generically (every relationship).
  const result = JSON.parse(wp("eval", `
    register_taxonomy('first_legacy_generic', ['post', 'user']);
    $term = wp_insert_term('Everything', 'first_legacy_generic')['term_taxonomy_id'];
    $post = wp_insert_post(['post_title' => 'Skylab', 'post_status' => 'publish', 'post_type' => 'post']);
    $GLOBALS['wpdb']->insert($GLOBALS['wpdb']->term_relationships, ['object_id' => $post, 'term_taxonomy_id' => $term]);
    $collection = $GLOBALS['wpdb']->get_var("SELECT tt.term_taxonomy_id FROM {$GLOBALS['wpdb']->term_taxonomy} tt JOIN {$GLOBALS['wpdb']->termmeta} m ON m.term_id = tt.term_id AND m.meta_key = '_zero_resource_id' AND m.meta_value = 'projects'");
    $GLOBALS['wpdb']->insert($GLOBALS['wpdb']->term_relationships, ['object_id' => $post, 'term_taxonomy_id' => $collection]);
    $plugin = \\First\\Wp\\Runtime::plugin();
    $plugin->app();
    $plugin->connection()->transaction(fn () => (new \\First\\Wp\\Legacy\\Migrate($plugin->connection(), $plugin->schema))->run(require '/tmp/first-legacy-release.php', false));
    echo json_encode((int) $GLOBALS['wpdb']->get_var("SELECT count FROM {$GLOBALS['wpdb']->term_taxonomy} WHERE term_taxonomy_id = $term"));
  `));
  // The migrated post still holds the term; generic counting doesn't care that it is now a first_projects post.
  assert.equal(result, 1);
});

test("a term shared by migrated posts and attachments keeps WordPress's attachment count", () => {
  // A taxonomy on posts and attachments, as media-tagging plugins register: an inherit attachment
  // counts while its parent is published, so migrating that parent changes the count.
  const result = JSON.parse(wp("eval", `
    register_taxonomy('first_legacy_shared', ['post', 'attachment']);
    $term = wp_insert_term('Shared', 'first_legacy_shared')['term_taxonomy_id'];
    $tr = static fn (int $id) => $GLOBALS['wpdb']->insert($GLOBALS['wpdb']->term_relationships, ['object_id' => $id, 'term_taxonomy_id' => $term]);
    $parent = wp_insert_post(['post_title' => 'Mir', 'post_status' => 'publish', 'post_type' => 'post']);
    $image = wp_insert_post(['post_title' => 'shot', 'post_status' => 'inherit', 'post_type' => 'attachment', 'post_parent' => $parent, 'post_mime_type' => 'image/png']);
    $tr($parent); $tr($image);
    $collection = $GLOBALS['wpdb']->get_var("SELECT tt.term_taxonomy_id FROM {$GLOBALS['wpdb']->term_taxonomy} tt JOIN {$GLOBALS['wpdb']->termmeta} m ON m.term_id = tt.term_id AND m.meta_key = '_zero_resource_id' AND m.meta_value = 'projects'");
    $GLOBALS['wpdb']->insert($GLOBALS['wpdb']->term_relationships, ['object_id' => $parent, 'term_taxonomy_id' => $collection]);
    wp_update_term_count_now([$term], 'first_legacy_shared');
    $before = (int) $GLOBALS['wpdb']->get_var("SELECT count FROM {$GLOBALS['wpdb']->term_taxonomy} WHERE term_taxonomy_id = $term");
    \\First\\Wp\\Runtime::plugin()->app();
    $plugin = \\First\\Wp\\Runtime::plugin();
    $plugin->connection()->transaction(fn () => (new \\First\\Wp\\Legacy\\Migrate($plugin->connection(), $plugin->schema))->run(require '/tmp/first-legacy-release.php', false));
    $after = (int) $GLOBALS['wpdb']->get_var("SELECT count FROM {$GLOBALS['wpdb']->term_taxonomy} WHERE term_taxonomy_id = $term");
    wp_update_term_count_now([$term], 'first_legacy_shared');
    $wordpress = (int) $GLOBALS['wpdb']->get_var("SELECT count FROM {$GLOBALS['wpdb']->term_taxonomy} WHERE term_taxonomy_id = $term");
    echo json_encode([$before, $after, $wordpress]);
  `));
  // Parent and image counted before; afterwards only the image (its parent is published), as WordPress counts it.
  assert.deepEqual(result, [2, 1, 1]);
});

test("a second run changes nothing", () => {
  const after = snapshot();
  const r = migrate();
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.data.collections, { projects: { records: [], revisions: 0 }, tasks: { records: [], revisions: 0 } });
  assert.deepEqual(snapshot(), after);
});

test("a taxonomy with its own count callback refuses only when this run's posts carry it", () => {
  const term = sql("SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt JOIN wp_termmeta m ON m.term_id = tt.term_id AND m.meta_key = '_zero_resource_id' AND m.meta_value = 'projects'")[0].term_taxonomy_id;
  const run = (attachToPending: boolean) => JSON.parse(wp("eval", `
    register_taxonomy('first_legacy_custom', ['post'], ['update_count_callback' => static fn () => null]);
    $custom = wp_insert_term('Custom ' . wp_generate_password(6, false), 'first_legacy_custom')['term_taxonomy_id'];
    $trashed = wp_insert_post(['post_title' => 'Old', 'post_status' => 'trash', 'post_type' => 'post']);
    $pending = wp_insert_post(['post_title' => 'Tiangong ' . wp_generate_password(6, false), 'post_status' => 'publish', 'post_type' => 'post']);
    foreach ([[$trashed, ${term}], [$trashed, $custom], [$pending, ${term}]] as [$o, $t]) $GLOBALS['wpdb']->insert($GLOBALS['wpdb']->term_relationships, ['object_id' => $o, 'term_taxonomy_id' => $t]);
    if (${attachToPending ? "true" : "false"}) $GLOBALS['wpdb']->insert($GLOBALS['wpdb']->term_relationships, ['object_id' => $pending, 'term_taxonomy_id' => $custom]);
    $plugin = \\First\\Wp\\Runtime::plugin();
    $plugin->app();
    try { $r = (new \\First\\Wp\\Legacy\\Migrate($plugin->connection(), $plugin->schema))->run(require '/tmp/first-legacy-release.php', true); $out = $r['collections']['projects']['records']; }
    catch (\\First\\HttpError $e) { $out = $e->errorCode; }
    wp_delete_post($trashed, true); wp_delete_post($pending, true);
    echo json_encode($out);
  `));
  // Only a skipped trashed post carries the custom taxonomy: the run goes ahead.
  assert.equal(run(false).length, 1);
  // A post this run migrates carries it: refused before anything is written.
  assert.equal(run(true), "legacy_unmappable");
});

test("a title repeating an existing project's refuses the run, whatever the ids' order", () => {
  // The app made project titles unique. A project created in the new app after the migration has a
  // higher id than the legacy post that now repeats its title.
  const term = sql("SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt JOIN wp_termmeta m ON m.term_id = tt.term_id AND m.meta_key = '_zero_resource_id' AND m.meta_value = 'projects'")[0].term_taxonomy_id;
  const legacy = Number(wp("post", "create", "--post_type=post", "--post_status=publish", "--post_title=Mercury", "--porcelain"));
  sql(`INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (${legacy}, ${term})`);
  const existing = Number(wp("post", "create", "--post_type=first_projects", "--post_status=publish", "--post_title=Mercury", "--porcelain"));
  assert.ok(existing > legacy);
  const r = migrate();
  assert.deepEqual([r.code, r.out.error.code, r.out.error.pointer], [1, "unique_violation", `/records/${legacy}/title`]);
  for (const id of [legacy, existing]) wp("post", "delete", String(id), "--force");
});

test("an attachment whose file sits outside the uploads directory refuses the run", () => {
  // An absolute _wp_attached_file into the original Space's private root: the file exists, but
  // WordPress would hand out a URL nothing serves.
  const term = sql("SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt JOIN wp_termmeta m ON m.term_id = tt.term_id AND m.meta_key = '_zero_resource_id' AND m.meta_value = 'projects'")[0].term_taxonomy_id;
  const privatePath = `${site.storage}/2026/10/cover.png`;
  const image = Number(wp("post", "create", "--post_type=attachment", "--post_status=inherit", "--post_mime_type=image/png", "--post_title=private", "--porcelain"));
  wp("post", "meta", "add", String(image), "_wp_attached_file", privatePath);
  const legacy = Number(wp("post", "create", "--post_type=post", "--post_status=publish", "--post_title=Salyut", "--porcelain"));
  sql(`INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (${legacy}, ${term})`);
  wp("post", "meta", "add", String(legacy), "_zero_projects_cover", String(image));
  const r = migrate();
  assert.deepEqual([r.code, r.out.error.code, r.out.error.pointer], [1, "invalid_input", `/records/${legacy}/cover`]);
  for (const id of [legacy, image]) wp("post", "delete", String(id), "--force");
});

test("a cover that isn't an image refuses the run, as a Zero write would", () => {
  const term = sql("SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt JOIN wp_termmeta m ON m.term_id = tt.term_id AND m.meta_key = '_zero_resource_id' AND m.meta_value = 'projects'")[0].term_taxonomy_id;
  const pdf = Number(wp("post", "create", "--post_type=attachment", "--post_status=inherit", "--post_mime_type=application/pdf", "--post_title=brief", "--porcelain"));
  const legacy = Number(wp("post", "create", "--post_type=post", "--post_status=publish", "--post_title=Soyuz", "--porcelain"));
  sql(`INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (${legacy}, ${term})`);
  wp("post", "meta", "add", String(legacy), "_zero_projects_cover", String(pdf));
  const r = migrate();
  assert.deepEqual([r.code, r.out.error.code, r.out.error.pointer], [1, "invalid_input", `/records/${legacy}/cover`]);
  for (const id of [legacy, pdf]) wp("post", "delete", String(id), "--force");
});

test("a reference to a trashed row of the new collection refuses the run", () => {
  // Trashed posts aren't rows of the new app (WpPostStore skips them), so they can't be targets.
  const trashedTask = Number(wp("post", "create", "--post_type=first_tasks", "--post_status=trash", "--post_title=Gone", "--porcelain"));
  const term = sql("SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt JOIN wp_termmeta m ON m.term_id = tt.term_id AND m.meta_key = '_zero_resource_id' AND m.meta_value = 'tasks'")[0].term_taxonomy_id;
  const legacy = Number(wp("post", "create", "--post_type=post", "--post_status=publish", "--post_title=Points at trash", "--porcelain"));
  sql(`INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (${legacy}, ${term})`);
  wp("post", "meta", "add", String(legacy), "_zero_tasks_project", String(ids.apollo));
  wp("post", "meta", "add", String(legacy), "_zero_tasks_parent", String(trashedTask));
  const r = migrate();
  assert.deepEqual([r.code, r.out.error.code, r.out.error.pointer], [1, "reference_violation", `/records/${legacy}/parent`]);
  wp("post", "delete", String(legacy), "--force");
});

test("the new app's compiled validators run on migrated values, seeing the whole row", () => {
  const term = sql("SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt JOIN wp_termmeta m ON m.term_id = tt.term_id AND m.meta_key = '_zero_resource_id' AND m.meta_value = 'tasks'")[0].term_taxonomy_id;
  const legacy = (status: string) => {
    const id = Number(wp("post", "create", "--post_type=post", `--post_status=${status}`, "--post_title=Loud", "--porcelain"));
    sql(`INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (${id}, ${term})`);
    wp("post", "meta", "add", String(id), "_zero_tasks_project", String(ids.apollo));
    wp("post", "meta", "add", String(id), "_zero_tasks_notes", "STOP");
    return id;
  };
  // The validator reads ctx.data.status: a shouting draft passes, a shouting published task doesn't.
  const draft = legacy("draft");
  assert.equal(migrate("--dry-run").code, 0);
  const published = legacy("publish");
  const r = migrate("--dry-run");
  assert.deepEqual([r.code, r.out.error.code, r.out.error.pointer, r.out.error.detail], [1, "invalid_input", `/records/${published}/notes`, "Don't shout"]);
  for (const id of [draft, published]) wp("post", "delete", String(id), "--force");
});

test("a value the new app can't hold refuses the whole run, naming the record and field", () => {
  // A legacy post whose reference points at a post that isn't a project.
  const term = sql("SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt JOIN wp_termmeta m ON m.term_id = tt.term_id AND m.meta_key = '_zero_resource_id' AND m.meta_value = 'tasks'")[0].term_taxonomy_id;
  const bad = Number(wp("post", "create", "--post_type=post", "--post_status=publish", "--post_title=Orphan", "--porcelain"));
  const good = Number(wp("post", "create", "--post_type=post", "--post_status=publish", "--post_title=Fine", "--porcelain"));
  sql(`INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (${bad}, ${term}), (${good}, ${term})`);
  wp("post", "meta", "add", String(good), "_zero_tasks_project", String(ids.apollo));
  wp("post", "meta", "add", String(bad), "_zero_tasks_project", String(ids.trashed));
  const before = snapshot();
  const r = migrate();
  assert.equal(r.code, 1);
  assert.deepEqual([r.out.error.code, r.out.error.pointer], ["reference_violation", `/records/${bad}/project`]);
  // One transaction: the valid record wasn't moved either.
  assert.deepEqual(snapshot(), before);
  for (const id of [bad, good]) wp("post", "delete", String(id), "--force");
});

test("collections of several original Spaces refuse the run until one is named", () => {
  // A second Space's term for another collection: each collection exists in one Space only.
  // (The zero_collection taxonomy is the original kernel's; with it gone, write its rows directly.)
  sql("INSERT INTO wp_terms (name, slug) VALUES ('Other projects', 'sf-other-projects')");
  const termId = Number(sql("SELECT term_id FROM wp_terms WHERE slug = 'sf-other-projects'")[0].term_id);
  sql(`INSERT INTO wp_term_taxonomy (term_id, taxonomy, description, count) VALUES (${termId}, 'zero_collection', '', 0)`);
  sql(`INSERT INTO wp_termmeta (term_id, meta_key, meta_value) VALUES (${termId}, '_zero_resource_id', 'projects'), (${termId}, '_spacefast_space_id', 'other-space')`);
  // A count only that Space's own app knows about; migrating legacy-space must leave it alone.
  sql(`UPDATE wp_term_taxonomy SET count = 7 WHERE term_id = ${termId}`);
  try {
    const r = migrate("--dry-run");
    assert.deepEqual([r.code, r.out.error.code, r.out.error.pointer], [1, "legacy_unmappable", ""]);
    assert.equal(migrate("--dry-run", "--space=legacy-space").code, 0);
    // A pending legacy-space project, so this run recounts its own collection term.
    const projects = sql("SELECT tt.term_taxonomy_id FROM wp_term_taxonomy tt JOIN wp_termmeta m ON m.term_id = tt.term_id AND m.meta_key = '_zero_resource_id' AND m.meta_value = 'projects' JOIN wp_termmeta s ON s.term_id = tt.term_id AND s.meta_key = '_spacefast_space_id' AND s.meta_value = 'legacy-space'")[0].term_taxonomy_id;
    const pending = Number(wp("post", "create", "--post_type=post", "--post_status=publish", "--post_title=Vostok", "--porcelain"));
    sql(`INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (${pending}, ${projects})`);
    const scoped = migrate("--space=legacy-space");
    assert.deepEqual([scoped.code, scoped.out.data.collections.projects.records], [0, [pending]]);
    assert.deepEqual(sql(`SELECT count FROM wp_term_taxonomy WHERE term_id = ${termId}`), [{ count: "7" }]);
  } finally {
    sql(`DELETE FROM wp_termmeta WHERE term_id = ${termId}`);
    sql(`DELETE FROM wp_term_taxonomy WHERE term_id = ${termId}`);
    sql(`DELETE FROM wp_terms WHERE term_id = ${termId}`);
  }
});
