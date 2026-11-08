// The system suite's second site: an ORIGINAL Zero (0.8) site moved onto the new Zero the way
// docs/migrating-from-zero.md tells an owner to. run.sh boots a fresh WordPress for it after the
// publication journey (one Zero app per site) and replays the content the original kernel wrote
// (tests/wp/legacy/site.json). Here the owner converts the capsule with `zero migrate config`, opens
// access (step 2), builds and installs the plugins (step 3), copies the uploads (step 3½), dry-runs
// and runs `wp zero migrate-legacy` (steps 4 and 5), then reads everything through the generated client.
// tests/wp/legacy holds the migration's edge cases; this file proves the documented path end to end.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repo, work, zero } from "./project.ts";

const legacy = join(repo, "tests/wp/legacy");
const site = JSON.parse(readFileSync(join(legacy, "site.json"), "utf8"));
const ids: { media: number[]; apollo: number; gemini: number; scheduled: number; parent: number; child: number; trashed: number } = site.ids;
const receipt: { url: string; users: Record<"admin" | "editor", { appPassword: string }> } = JSON.parse(readFileSync(join(repo, "tests/system/.harness-legacy.json"), "utf8"));
const wpContent = join(repo, "tests/system/.wp-content-legacy");
const harness = join(repo, "tests/wp/harness.sh");
const project = join(work, "legacy-app");
const api = `${receipt.url}/wp-json/zero/v1`;
const wp = (...args: string[]) => execFileSync(harness, ["wp", ...args], { encoding: "utf8" }).trim();
const migrate = (...flags: string[]) => {
  const r = spawnSync(harness, ["wp", "zero", "migrate-legacy", "-", ...flags], { input: readFileSync(join(legacy, "content-model.php")), encoding: "utf8" });
  return { code: r.status, out: JSON.parse(r.stdout) };
};

// The generated client of the app `zero migrate config` made, loaded as a frontend imports it.
type Row = Record<string, any> & { id: number };
interface Collection { list(q?: object): Promise<Row[]>; get(id: number, q?: object): Promise<Row>; update(id: number, patch: object): Promise<Row> }
let client: (role: "anonymous" | "editor") => { projects: Collection; tasks: Collection };

before(async () => {
  rmSync(project, { recursive: true, force: true });
  // Step 1: the capsule becomes a zero.config.ts.
  zero("migrate", "config", "--from", "zero", join(legacy, "capsule.ts"), "--out", join(project, "zero.config.ts"));
  // Step 2: the importer denies every write; the owner opens them to editors.
  const config = join(project, "zero.config.ts");
  writeFileSync(config, readFileSync(config, "utf8").replaceAll(`"create":false,"update":false,"delete":false`, `"create":"editor","update":"editor","delete":"editor"`));
  // Step 3: build, upload the plugins, activate dependencies, then the runtime, then the app.
  zero("build", project, "--quiet");
  const built = join(project, ".zero/wp-content/plugins");
  for (const name of readdirSync(built).filter((n) => !n.endsWith(".zip"))) cpSync(join(built, name), join(wpContent, "plugins", name), { recursive: true });
  wp("plugin", "activate", "secure-custom-fields", "action-scheduler", "mcp-adapter", "zero-runtime", "zero-identity", "zero-app-legacy");
  const mod = await import(pathToFileURL(join(project, "zero/client/index.ts")).href);
  const basic = (role: "editor") => ({ Authorization: "Basic " + btoa(`${role}:${receipt.users[role].appPassword}`) });
  client = (role) => mod.createClient({ url: api, headers: role === "anonymous" ? {} : basic(role) });
});

test("an original Zero site moves onto the new app in place, the documented way", async () => {
  const anon = client("anonymous");
  const editor = client("editor");
  // Before: the posts are still the original app's, so the new collections are empty.
  assert.deepEqual(await editor.projects.list(), []);

  // Step 3½: the original Space kept its uploads in private storage; until they're copied, the run refuses.
  const early = migrate("--dry-run");
  assert.deepEqual([early.code, early.out.error.code, early.out.error.pointer], [1, "invalid_input", `/records/${ids.apollo}/cover`]);
  wp("eval", `$src = ${JSON.stringify(site.storage)}; $dst = wp_upload_dir()['basedir'];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS)) as $f) {
      $to = $dst . substr($f->getPathname(), strlen($src)); wp_mkdir_p(dirname($to)); copy($f->getPathname(), $to);
    }`);

  // Step 4: the dry run reports every record and writes nothing.
  const dry = migrate("--dry-run");
  assert.equal(dry.code, 0, JSON.stringify(dry.out));
  assert.deepEqual(dry.out.data.collections, {
    projects: { records: [ids.apollo, ids.gemini, ids.scheduled], revisions: 2 },
    tasks: { records: [ids.parent, ids.child], revisions: 1 },
  });
  assert.deepEqual(await editor.projects.list(), []);

  // Step 5: the run. Every record keeps its id, fields, status, dates and references.
  const done = migrate();
  assert.equal(done.code, 0, JSON.stringify(done.out));
  assert.deepEqual((await editor.projects.list({ orderBy: { id: "asc" } })).map((p) => [p.id, p.title, p.status]), [
    [ids.apollo, "Apollo 11", "published"], [ids.gemini, "Gemini", "draft"], [ids.scheduled, "Artemis", "scheduled"],
  ]);
  const apollo = await anon.projects.get(ids.apollo, { with: { cover: true } });
  assert.deepEqual([apollo.budget, apollo.active, apollo.stage, apollo.tags, apollo.gallery], [25, true, "live", ["red", "blue"], ids.media]);
  const served = await fetch(new URL(apollo.cover.url, receipt.url));
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), Buffer.from(site.files[String(ids.media[0])], "base64"), "WordPress serves the original upload");
  assert.deepEqual((await anon.projects.list()).map((p) => p.id), [ids.apollo], "readers see what the original app published, and only that");
  const tasks = await editor.tasks.list({ orderBy: { id: "asc" }, with: { project: true, parent: true } });
  assert.deepEqual(tasks.map((t) => [t.id, t.project.id, t.parent?.id ?? null]), [[ids.parent, ids.apollo, null], [ids.child, ids.apollo, ids.parent]]);

  // The migrated records are the new app's own: editors change them through its API.
  assert.equal((await editor.projects.update(ids.gemini, { budget: 8 })).budget, 8);
  // Running it again finds nothing left to move.
  assert.deepEqual(migrate().out.data.collections, { projects: { records: [], revisions: 0 }, tasks: { records: [], revisions: 0 } });
});
