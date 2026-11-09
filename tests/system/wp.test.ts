// The WordPress half of the system suite. tests/system/run.sh builds examples/site with
// `zero build` and boots a fresh WordPress with users and nothing else; this file installs
// the artifact the way a site owner would (copy wp-content/plugins in, activate with WP-CLI), checks
// the install, runs the shared journey through the generated client against core /wp/v2 (the
// editor) and /wp-json/zero/v1 (the app), then walks the plugin lifecycle: upgrade, deactivate,
// reactivate, uninstall.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "../../examples/site/zero/_generated/client/index.ts";
import { siteJourney, type EditorPost, type Role } from "./journey.ts";
import { clientOf, copySite, doctor, failing, receiver, repo, sync, upgrade, work, zero } from "./project.ts";

interface Receipt {
  url: string;
  users: Record<Exclude<Role, "anonymous">, { id: number; appPassword: string }>;
}
/** The frontend the site owner registers with zero-identity (wp.test.ts registers it on install). */
const frontend = { clientId: "app_site", redirectUri: "" };
const receipt: Receipt = JSON.parse(readFileSync(join(repo, "tests/system/.harness.json"), "utf8"));
const wpContent = join(repo, "tests/system/.wp-content");
const api = `${receipt.url}/wp-json/zero/v1`;
const core = `${receipt.url}/wp-json/wp/v2`;
const harness = join(repo, "tests/wp/harness.sh");
const project = join(work, "wp-site");
const artifact = join(work, "wp-artifact");

/** The order a site owner activates in: each plugin after every plugin its header requires. */
const ORDER = ["secure-custom-fields", "action-scheduler", "mcp-adapter", "two-factor", "polylang", "zero-runtime", "zero-identity", "zero-app-site"];

const wp = (...args: string[]) => execFileSync(harness, ["wp", ...args], { encoding: "utf8" }).trim();
const wpFails = (...args: string[]) => {
  try {
    execFileSync(harness, ["wp", ...args], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    return String((e as { stderr: string }).stderr);
  }
  assert.fail(`wp ${args.join(" ")} succeeded`);
};
const sql = (query: string) => execFileSync(harness, ["sql", query], { encoding: "utf8" }).trim().split("\n").slice(1);
const active = () => JSON.parse(wp("plugin", "list", "--status=active", "--field=name", "--format=json")) as string[];
const basic = (role: Exclude<Role, "anonymous">) => ({ Authorization: "Basic " + btoa(`${role}:${receipt.users[role].appPassword}`) });
const headers = (role: Role) => (role === "anonymous" ? {} : basic(role));
const client = (role: Role): Client => createClient({ url: api, headers: headers(role) });

/** The HTTP status of the ZeroError `fn` throws. */
async function assertRejects(fn: () => Promise<unknown>, status: number) {
  await assert.rejects(fn, (e: { status?: number }) => e.status === status);
}

/** Copies the built plugins into the site's wp-content/plugins, replacing what a previous build put there. */
function install(from: string): void {
  for (const name of readdirSync(join(from, "plugins"))) {
    if (name.endsWith(".zip")) continue;
    rmSync(join(wpContent, "plugins", name), { recursive: true, force: true });
    cpSync(join(from, "plugins", name), join(wpContent, "plugins", name), { recursive: true });
  }
}

/** A core /wp/v2 call as the block editor makes it; returns the JSON body. */
async function wpRest(role: Exclude<Role, "anonymous">, method: string, path: string, body?: unknown, raw?: { bytes: Uint8Array; type: string; filename: string }) {
  const h: Record<string, string> = basic(role);
  let payload: BodyInit | undefined;
  if (raw) {
    h["content-type"] = raw.type;
    h["content-disposition"] = `attachment; filename="${raw.filename}"`;
    payload = raw.bytes;
  } else if (body !== undefined) {
    h["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(core + path, { method, headers: h, body: payload });
  const json = await res.json();
  assert.ok(res.status < 300, `${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/** The post screen's SCF fields for a Zero post: `zero_<column>`, blocks rows keyed by acf_fc_layout. */
function acf(p: EditorPost) {
  return {
    zero_dek: p.dek, zero_cover: p.cover, zero_manuscript: p.manuscript, zero_topics: p.topics, zero_featured: p.featured, zero_authorId: p.authorId,
    zero_seo: p.seo, zero_related: p.related,
    zero_sections: (p.sections ?? []).map(({ layout, ...fields }) => ({ acf_fc_layout: layout, ...fields })),
  };
}

/**
 * A reader signs in as the site's frontend would: the client's signIn() sends the browser to the
 * zero-identity screens, the reader signs in with their password and approves, and the issuer sends
 * the browser back, where the client's handleCallback() finishes. The browser here is the page's
 * sessionStorage and location (only while signing in), and fetch with the identity session cookie
 * for the screens.
 */
async function browserSignIn(email: string, password: string): Promise<Client> {
  const store = new Map<string, string>();
  let at = frontend.redirectUri;
  const page = {
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    location: { get search() { return new URL(at).search; }, get href() { return at; }, assign: (url: string) => { at = url; } },
  };
  const globals = globalThis as unknown as Record<string, unknown>;
  Object.assign(globals, page);
  try {
    // Tokens in memory: they outlive this simulated page. (sessionStorage holds the PKCE state across the redirect.)
    const reader = createClient({ url: api, auth: { clientId: frontend.clientId, redirectUri: frontend.redirectUri } });
    void reader.auth.signIn();
    const deadline = Date.now() + 10_000;
    while (!at.includes("/identity/authorize")) {
      assert.ok(Date.now() < deadline, "signIn() never left the page");
      await new Promise((r) => setImmediate(r));
    }
    const authorize = new URL(at);
    const origin = receipt.url;
    const signedIn = await fetch(`${origin}/wp-json/zero-identity/v1/sign-in/password`, {
      method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ login: email, password }),
    });
    assert.equal(signedIn.status, 200, await signedIn.clone().text());
    const cookie = signedIn.headers.getSetCookie().find((c) => c.startsWith("zi_session="))!.split(";")[0];
    const consentPage = await fetch(authorize, { headers: { cookie }, redirect: "manual" });
    const csrf = /name="csrf" value="([0-9a-f]{64})"/.exec(await consentPage.text())?.[1];
    assert.ok(csrf, "the consent screen carries its CSRF token");
    const approved = await fetch(`${origin}/identity/authorize`, {
      method: "POST", redirect: "manual",
      headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...Object.fromEntries(authorize.searchParams), csrf }),
    });
    at = approved.headers.get("location")!;
    assert.ok(at.startsWith(frontend.redirectUri), `the issuer sent the browser back to the frontend, not ${at}`);
    await reader.auth.handleCallback();
    return reader;
  } finally {
    for (const k of Object.keys(page)) delete globals[k];
  }
}

let authorId = 0;
after(() => hook.close());
const hookSecret = `whsec_${Date.now().toString(36)}`;
const hook = await receiver(hookSecret);

before(() => {
  copySite(project);
  rmSync(artifact, { recursive: true, force: true });
  zero("build", project, "--out", artifact, "--quiet");
});

test("installing the artifact: activation order, platform requirements, doctor", () => {
  assert.deepEqual(readdirSync(join(artifact, "plugins")).filter((n) => !n.endsWith(".zip")).sort(), [...ORDER].sort());
  install(artifact);
  // Requires Plugins refuses to activate a plugin before its dependencies, so order matters.
  assert.match(wpFails("plugin", "activate", "zero-app-site"), /requires 6 plugins.*Action Scheduler, MCP Adapter, Polylang, Secure Custom Fields, Two Factor, Zero Runtime/s);
  assert.match(wpFails("plugin", "activate", "zero-runtime"), /requires 4 plugins.*Action Scheduler, MCP Adapter, Secure Custom Fields, Two Factor/s);
  assert.deepEqual(active(), []);
  // This site sits behind a published port its own container can't reach, so the owner routes the
  // private-files probe to the web server's in-network name, with the filter that exists for hosts.
  wp("eval", `wp_mkdir_p(WPMU_PLUGIN_DIR); file_put_contents(WPMU_PLUGIN_DIR . '/probe-route.php', base64_decode('${Buffer.from("<?php\nadd_filter('zero_private_probe_url', fn ($u) => str_replace(home_url(), 'http://wordpress', $u));\n").toString("base64")}'));`);
  wp("plugin", "activate", ...ORDER);
  assert.deepEqual(active().sort(), [...ORDER].sort());

  // The runtime created the shared system tables; the app ran its first migration.
  assert.equal(wp("option", "get", "zero_runtime_tables"), wp("eval", "echo \\Zero\\Wp\\Runtime::tablesVersion();"));
  assert.deepEqual(sql("SELECT id FROM wp_zero__migrations"), ["0001_init"]);
  // Feature lanes add shared runtime tables of their own; the app's are these.
  const tables = sql("SHOW TABLES LIKE 'wp\\_zero\\_%'");
  for (const table of ["wp_zero__migrations", "wp_zero__revisions", "wp_zero_comments", "wp_zero_subscribers"]) {
    assert.ok(tables.includes(table), `${table} missing from ${tables}`);
  }

  // The editor screen: SCF shows seo.metaTitle only while seo.noindex is off (the config's showIf).
  const logic = JSON.parse(wp("eval", "echo wp_json_encode(acf_get_field('field_zero_posts_seo_metaTitle')['conditional_logic']);"));
  assert.deepEqual(logic, [[{ field: "field_zero_posts_seo_noindex", operator: "==", value: "0" }]]);

  // doctor reads the artifact and the live site, against the same platform policy activation used.
  const diagnosis = doctor(project, "--out", artifact, "--site", receipt.url);
  assert.deepEqual(failing(diagnosis), [], JSON.stringify(diagnosis.checks));
  const found = (name: string) => diagnosis.checks.find((c) => c.name === name)?.detail.split(";")[0];
  assert.deepEqual(
    ["wordpress", "secure-custom-fields", "action-scheduler", "mcp-adapter"].map(found),
    [wp("core", "version"), "6.9.7", "4.2.0", "0.7.1"],
    "doctor reports the site's real versions",
  );
  // Akismet isn't required: without it the site still passes, and one line says spam checks are off.
  assert.deepEqual(diagnosis.checks.find((c) => c.name === "spam checks"), {
    name: "spam checks", ok: true, detail: "off: Akismet is not active (set it up through Jetpack); comments are not spam-checked",
  });

  // Without a required plugin the app refuses to boot and names the unmet row; doctor fails.
  wp("plugin", "deactivate", "secure-custom-fields");
  try {
    assert.equal(doctor(project, "--out", artifact, "--site", receipt.url).ok, false);
    assert.match(wp("eval", "do_action('admin_notices');"), /secure-custom-fields 6\.9\.7\+ is required \(found inactive\)/);
  } finally {
    wp("plugin", "activate", "secure-custom-fields");
  }
  assert.deepEqual(failing(doctor(project, "--out", artifact, "--site", receipt.url)), []);

  // The site owner points the comment webhook at the moderation tool (env() reads wp-config constants).
  wp("config", "set", "SITE_HOOK_URL", `http://host.docker.internal:${hook.port}/hook`, "--type=constant");
  wp("config", "set", "SITE_HOOK_SECRET", hookSecret, "--type=constant");

  // The site's frontend signs readers in through zero-identity's screens: register it once.
  frontend.redirectUri = `${receipt.url}/signed-in`;
  wp("zero", "identity", "app", "add", "--name=The Zero Review", `--redirect=${frontend.redirectUri}`, `--origin=${receipt.url}`, `--id=${frontend.clientId}`);

  // The journey's author writes as an authors row the admin creates over the API.
  const userId = receipt.users.author.id;
  [{ id: authorId }] = JSON.parse(wp("zero", "insert", "authors", JSON.stringify({ name: "Ada Author", userId }))).data;
});

test("the site journey on WordPress", async (t) => {
  await siteJourney(
    {
      origin: receipt.url,
      client,
      get authorId() {
        return authorId;
      },
      editor: {
        async upload(bytes, type, filename, alt) {
          const media = await wpRest("editor", "POST", "/media", undefined, { bytes, type, filename });
          await wpRest("editor", "POST", `/media/${media.id}`, { alt_text: alt });
          return media.id;
        },
        async saveDraft(p) {
          const saved = await wpRest("editor", "POST", "/zero_posts", { title: p.title, content: p.body, status: "draft", acf: acf(p) });
          return saved.id;
        },
        async publish(id) {
          await wpRest("editor", "POST", `/zero_posts/${id}`, { status: "publish" });
        },
      },
      async runJobs() {
        wp("action-scheduler", "run", "--hooks=zero_job");
      },
      sync: (dir) => sync(dir, receipt.url, `editor:${receipt.users.editor.appPassword}`),
      async runRetries() {
        // A retry is a pending Action Scheduler action dated at the job's backoff: run each one now.
        for (const id of sql("SELECT action_id FROM wp_actionscheduler_actions WHERE hook = 'zero_job' AND status = 'pending'")) {
          wp("action-scheduler", "action", "run", id);
        }
      },
      deliveries: hook.deliveries,
      async promoteDue(at) {
        // WordPress's own path: a `future` post with its `publish_future_post` cron event. The clock
        // can't move, so the post's date is pulled into the past for the run and restored after (§9.1).
        const due = at.slice(0, 19).replace("T", " ");
        const [id] = sql(`SELECT ID FROM wp_posts WHERE post_type = 'zero_posts' AND post_status = 'future' AND post_date_gmt = '${due}'`);
        assert.ok(id, "the scheduled post is a WordPress `future` post");
        const events = JSON.parse(wp("cron", "event", "list", "--hook=publish_future_post", "--fields=args", "--format=json"));
        assert.ok(events.some((e: { args: number[] }) => String(e.args[0]) === id), "scheduling queued WordPress's cron event");
        sql(`UPDATE wp_posts SET post_date_gmt = '2000-01-01 00:00:00', post_date = '2000-01-01 00:00:00' WHERE ID = ${id}`);
        wp("cron", "event", "run", "publish_future_post");
        sql(`UPDATE wp_posts SET post_date_gmt = '${due}', post_date = '${due}' WHERE ID = ${id}`);
        wp("cache", "flush");
        assert.equal(sql(`SELECT post_status FROM wp_posts WHERE ID = ${id}`)[0], "publish");
      },
      signIn: browserSignIn,
      async upgrade() {
        upgrade(project);
        zero("build", project, "--out", artifact, "--quiet");
        install(artifact);
        // The new plugin is on disk and nobody opens wp-admin: the next public API request migrates.
        // PHP's opcache revalidates files every couple of seconds, so poll that request.
        assert.deepEqual(sql("SELECT id FROM wp_zero__migrations"), ["0001_init"]);
        const deadline = Date.now() + 30_000;
        while (sql("SELECT id FROM wp_zero__migrations").length < 2) {
          assert.ok(Date.now() < deadline, "the upgrade's migration never ran");
          assert.equal((await fetch(`${api}/comments?limit=1`)).status, 200, "the site serves throughout the upgrade");
        }
        assert.deepEqual(sql("SELECT id FROM wp_zero__migrations"), ["0001_init", "0002_update"]);
        assert.deepEqual(failing(doctor(project, "--out", artifact, "--site", receipt.url)), []);
        return clientOf(project, (make, role) => make({ url: api, headers: headers(role) }));
      },
    },
    t,
  );
});

test("an agent works the site over MCP with each user's REST permissions", async () => {
  const mcp = async (role: Exclude<Role, "anonymous">) => {
    const url = `${receipt.url}/wp-json/mcp/zero-site`;
    let headers: Record<string, string> = { ...basic(role), "content-type": "application/json", accept: "application/json, text/event-stream" };
    let id = 0;
    const call = async (method: string, params?: unknown) => {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }) });
      const body = await res.json();
      assert.ok("result" in body, `${method}: ${JSON.stringify(body)}`);
      return { body: body.result, session: res.headers.get("mcp-session-id") };
    };
    const init = await call("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "zero-system", version: "1" } });
    assert.ok(init.session, "initialize returns an Mcp-Session-Id");
    headers = { ...headers, "mcp-session-id": init.session, "mcp-protocol-version": init.body.protocolVersion };
    await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    return async (method: string, params?: unknown) => (await call(method, params)).body;
  };

  const editor = await mcp("editor");
  const tools: string[] = (await editor("tools/list")).tools.map((t: { name: string }) => t.name);
  for (const tool of ["site-posts-create", "site-posts-list", "site-moderate-comment", "site-remove-post"]) assert.ok(tools.includes(tool), tools.join(","));
  // The agent drafts a post as the editor; it shows up in the app's API like any other draft.
  const drafted = await editor("tools/call", { name: "site-posts-create", arguments: { title: "Agent draft", status: "draft", topics: ["tech"] } });
  assert.equal(drafted.isError, false, JSON.stringify(drafted));
  const { id } = drafted.structuredContent;
  assert.deepEqual(await client("editor").posts.get(id), drafted.structuredContent);
  await assertRejects(() => client("anonymous").posts.get(id), 404);
  // A subscriber's agent gets the subscriber's answer: no draft, no writes.
  const subscriber = await mcp("subscriber");
  const listed = await subscriber("tools/call", { name: "site-posts-list", arguments: { where: { id } } });
  assert.deepEqual([listed.isError, listed.structuredContent.rows], [false, []]);
  // The tool refuses for the same reason REST does, and the post survives; the editor's agent can delete it.
  const denied = await subscriber("tools/call", { name: "site-remove-post", arguments: { id } });
  const rest = await client("subscriber").actions.removePost({ id }).catch((e: { status: number; code: string; detail: string }) => e);
  assert.equal(denied.isError, true, JSON.stringify(denied));
  assert.deepEqual([rest.status, rest.code], [403, "forbidden"]);
  assert.ok(JSON.stringify(denied.content).includes(rest.detail), `${JSON.stringify(denied.content)} lacks "${rest.detail}"`);
  assert.equal((await client("editor").posts.get(id)).id, id);
  const deleted = await editor("tools/call", { name: "site-remove-post", arguments: { id } });
  assert.deepEqual([deleted.isError, deleted.structuredContent.id], [false, id]);
  await assertRejects(() => client("editor").posts.get(id), 404);
});

test("deactivate and reactivate keep every row; uninstall leaves content in place", async () => {
  const anon = client("anonymous");
  const editor = client("editor");
  const admin = client("admin");
  const snapshot = async () => {
    // Every locale's rows: a translation is content too.
    const posts = await editor.posts.list({ locale: "*", orderBy: { id: "asc" }, limit: 200 });
    const media = await anon.media.list({ limit: 200 });
    return {
      posts,
      // Full revision rows, SCF fields included, not just the summaries.
      revisions: await Promise.all(posts.map(async (p) =>
        Promise.all((await editor.posts.revisions.list(p.id)).map(async (r) => [r, await editor.posts.revisions.get(p.id, r.id)])))),
      authors: await admin.authors.list({ orderBy: { id: "asc" }, limit: 200 }),
      comments: await editor.comments.list({ orderBy: { id: "asc" }, limit: 200 }),
      subscribers: await admin.subscribers.list({ orderBy: { id: "asc" }, limit: 200 }),
      announcements: await editor.announcements.list({ orderBy: { id: "asc" }, limit: 200 }),
      // Members are WordPress users; nobody but each member reads them over the API, so read them as the site owner.
      members: JSON.parse(wp("zero", "find", "members", JSON.stringify({ orderBy: { id: "asc" } }))).data,
      settings: await anon.globals.settings.get(),
      media,
      // Every original and generated size, by the bytes served.
      files: await Promise.all(media.flatMap((m) => [m.url, ...Object.values(m.sizes ?? {}).map((s) => s.url)]).map(async (url) => {
        const res = await fetch(new URL(url, receipt.url));
        return [url, res.status, createHash("sha256").update(new Uint8Array(await res.arrayBuffer())).digest("hex")];
      })),
      // Private manuscripts referenced by posts: their rows (minus the time-limited link) and bytes.
      manuscripts: await Promise.all([...new Set(posts.map((p) => p.manuscript).filter((id): id is number => id !== null))].map(async (id) => {
        const { url, ...row } = await editor.files.manuscripts.get(id);
        const res = await fetch(new URL(url, receipt.url));
        return [row, res.status, createHash("sha256").update(new Uint8Array(await res.arrayBuffer())).digest("hex")];
      })),
    };
  };
  const before = await snapshot();
  for (const kind of ["posts", "authors", "comments", "subscribers", "announcements", "members", "media", "manuscripts"] as const) assert.ok(before[kind].length > 0, `no ${kind} to preserve`);
  assert.ok(before.posts.some((p) => p.locale === "de"), "no translation to preserve");
  assert.ok(before.revisions.some((r) => r.length > 0), "no revisions to preserve");
  assert.ok([...before.files, ...before.manuscripts].every((entry) => entry.includes(200)), "every file was served before");

  wp("plugin", "deactivate", "zero-app-site", "zero-identity", "zero-runtime");
  assert.equal((await fetch(`${api}/posts`)).status, 404, "the app's routes go away with the plugin");
  wp("plugin", "activate", "zero-runtime", "zero-identity", "zero-app-site");
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(sql("SELECT CONCAT(app, '/', id) FROM wp_zero__migrations"), ["site/0001_init", "site/0002_update"], "reactivation re-applies nothing");

  // Uninstall (delete in wp-admin): options, capabilities and scheduled actions go, content stays.
  const caps = () => JSON.parse(wp("eval", "echo wp_json_encode(array_map(fn ($r) => array_values(array_filter(array_keys($r->capabilities), fn ($c) => str_contains($c, 'zero_') || $c === 'unrelated_cap')), wp_roles()->role_objects));"));
  // Something else grants this app's capability to a role of its own, plus its own capabilities,
  // including one for a post type whose name merely ends like the app's.
  wp("role", "create", "desk", "Desk");
  wp("cap", "add", "desk", "edit_zero_posts", "unrelated_cap", "edit_acme_zero_posts");
  // Capabilities of the app's post types come from its access rules (map_meta_cap), not from roles:
  // activation grants none, and the editor's edit rights are the posts rules' answer.
  assert.deepEqual(caps().editor, [], "activation grants no role a capability");
  const can = () => wp("eval", "echo wp_json_encode([user_can(get_user_by('login', 'editor'), 'edit_others_zero_posts'), user_can(get_user_by('login', 'subscriber'), 'edit_others_zero_posts')]);");
  assert.equal(can(), "[true,false]", "posts' update rule lets editors edit any post, not subscribers");
  // Pending work in the app's and the runtime's groups, and in a group that isn't Zero's.
  const seeded = JSON.parse(wp("eval", "echo wp_json_encode([as_schedule_single_action(time() + 3600, 'not_zero', [], 'someone-else')]);"));
  const [maintain] = sql("SELECT a.action_id FROM wp_actionscheduler_actions a JOIN wp_actionscheduler_groups g USING (group_id) WHERE g.slug = 'zero' AND a.hook = 'zero_jobs_maintain' AND a.status = 'pending'");
  const status = (id: string | number) => sql(`SELECT status FROM wp_actionscheduler_actions WHERE action_id = ${id}`)[0];
  const pending = () => sql("SELECT CONCAT(g.slug, ':', a.hook) FROM wp_actionscheduler_actions a JOIN wp_actionscheduler_groups g USING (group_id) WHERE a.status = 'pending' AND (g.slug LIKE 'zero%' OR g.slug = 'someone-else') ORDER BY 1");
  assert.ok(pending().includes("zero:zero_jobs_maintain"), pending().join(","));
  // A job queued and not yet run: publishing a post enqueues notifyReaders under key publish-<id>.
  const pendingPost = await editor.posts.create({ title: "Queued at uninstall", status: "draft" });
  await editor.posts.update(pendingPost.id, { status: "published" });
  const [queued] = sql(`SELECT id FROM wp_zero__jobs WHERE job = 'notifyReaders' AND \`key\` = 'publish-${pendingPost.id}' AND state = 'pending'`);
  assert.ok(queued, "the publish queued a job");
  const options = "('zero_site_schema', 'zero_runtime_tables', 'zero_runtime_secret', 'zero_runtime_private_ok', 'zero_runtime_private_checked')";
  assert.equal(sql(`SELECT COUNT(*) FROM wp_options WHERE option_name IN ${options}`)[0], "5");
  const posts = sql("SELECT COUNT(*) FROM wp_posts WHERE post_type = 'zero_posts'")[0];
  // The owner deactivates everything, Action Scheduler included, then deletes Zero's plugins.
  wp("plugin", "deactivate", "zero-app-site", "zero-identity", "zero-runtime", "mcp-adapter", "action-scheduler");
  wp("plugin", "uninstall", "zero-app-site", "zero-identity", "zero-runtime");
  // The harness's own must-use helpers aren't Zero's plugins; only regular plugins can be deleted.
  assert.deepEqual(JSON.parse(wp("plugin", "list", "--status=active,inactive", "--field=name", "--format=json")).filter((n: string) => n.startsWith("zero-")), []);
  const left = caps();
  assert.deepEqual(Object.values(left).flat().filter((c) => !["unrelated_cap", "edit_acme_zero_posts"].includes(c)), [], "no role keeps a capability for the app's post types, whoever granted it");
  assert.deepEqual(left.desk.sort(), ["edit_acme_zero_posts", "unrelated_cap"], "capabilities that aren't the app's stay");
  // The runtime's own maintenance action is canceled (Action Scheduler inactive, so in its tables);
  // the app's queued delivery is its content and stays; a stranger's action is untouched.
  assert.deepEqual([status(maintain), status(seeded[0])], ["canceled", "pending"]);
  assert.ok(pending().includes("zero-site:zero_job"), "the queued job's delivery is kept for a reinstall");
  assert.equal(sql(`SELECT COUNT(*) FROM wp_options WHERE option_name IN ${options}`)[0], "0");
  assert.deepEqual(sql(`SELECT state FROM wp_zero__jobs WHERE id = '${queued}'`), ["pending"], "queued work is kept");
  assert.equal(sql("SELECT COUNT(*) FROM wp_posts WHERE post_type = 'zero_posts'")[0], posts);
  assert.equal(sql("SELECT COUNT(*) FROM wp_zero_comments")[0], String(before.comments.length));
  assert.ok(Number(sql("SELECT COUNT(*) FROM wp_options WHERE option_name LIKE 'zero\\_global\\_settings\\_%'")[0]) > 0, "globals are content");
  wp("role", "delete", "desk");
  wp("plugin", "activate", "action-scheduler", "mcp-adapter");
  wp("eval", "as_unschedule_all_actions('not_zero');");

  // Installing the same build again picks the content straight back up. The runtime minted a new
  // signing secret on reinstall, so links signed before are dead; the snapshot fetches fresh ones.
  install(artifact);
  wp("plugin", "activate", "zero-runtime", "zero-identity", "zero-app-site");
  const after = await snapshot();
  const queuedIndex = after.posts.findIndex((p) => p.id === pendingPost.id);
  assert.ok(queuedIndex >= 0, "the post published just before uninstall is still there");
  after.posts.splice(queuedIndex, 1);
  after.revisions.splice(queuedIndex, 1);
  assert.deepEqual(after, before);
  assert.deepEqual([caps().editor, can()], [[], "[true,false]"], "the reinstalled app's rules decide again, still with no role caps");
  // The reinstalled app runs the work queued before the uninstall.
  wp("action-scheduler", "run", "--hooks=zero_job");
  assert.deepEqual(sql(`SELECT state FROM wp_zero__jobs WHERE id = '${queued}'`), ["done"]);
});
