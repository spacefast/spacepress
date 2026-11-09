// spec.md §6, "the opinionated WordPress": every hardening switch against real WordPress/MariaDB while the
// Zero app is active, then the same checks with the app deactivated, where WordPress behaves as shipped.
import assert from "node:assert/strict";
import { test } from "node:test";
import { auth, core, harness, wp } from "../env.ts";
import { loginCookie } from "../login.ts";

const site = harness.url;
const xmlrpc = (method: string, path = "/xmlrpc.php") =>
  fetch(`${site}${path}`, { method: "POST", headers: { "content-type": "text/xml" }, body: `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params></params></methodCall>` });
/** `current_user_can()` for the administrator, in a WP-CLI process that loads every active plugin. */
const adminCan = (...caps: string[]) =>
  JSON.parse(wp("eval", `wp_set_current_user(${harness.users.admin.id}); echo wp_json_encode(array_map('current_user_can', json_decode('${JSON.stringify(caps)}')));`)) as boolean[];
const evalJson = (php: string) => JSON.parse(wp("eval", php));
const post = (type: string, title: string) => Number(wp("post", "create", `--post_type=${type}`, `--post_title=${title}`, "--post_status=publish", "--comment_status=open", "--ping_status=open", "--porcelain"));
const page = (path: string, cookie?: string) => fetch(`${site}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
/** A REST comment as the editor; `?rest_route=` works with plain permalinks too. */
const comment = (id: number, endpoint = `${core}/comments`) =>
  fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...auth("editor") }, body: JSON.stringify({ post: id, content: `on ${id}` }) });

const app = harness.plugin;
const FILE_CAPS = ["edit_files", "edit_plugins", "edit_themes"];
const INSTALL_CAPS = ["install_plugins", "upload_plugins", "update_plugins", "delete_plugins", "install_themes", "upload_themes", "update_themes", "delete_themes", "update_core"];

test("the active app lists every switch it applies", async () => {
  const schema = (await (await fetch(`${harness.url}/wp-json/zero/v1/_schema`, { headers: auth("admin") })).json()) as { data: { runtime: { wp: { hardening: string[] } } } };
  assert.deepEqual(schema.data.runtime.wp.hardening, ["xmlrpc", "pings", "emoji", "fileEditors", "pluginAndThemeInstalls", "autoUpdates", "customizer", "comments", "permalinks", "timezone", "blockTheme"]);
});

test("xmlrpc: every call is refused, system methods included, and nothing advertises the endpoint", async () => {
  for (const method of ["system.listMethods", "demo.sayHello", "pingback.ping"]) {
    const response = await xmlrpc(method);
    assert.equal(response.status, 403, method);
    assert.match(await response.text(), /XML-RPC is turned off/);
  }
  const home = await page("/");
  assert.equal(home.headers.get("x-pingback"), null);
  assert.doesNotMatch(await home.text(), /EditURI|xmlrpc\.php\?rsd/);
});

// Jetpack 16.4 is active (run.sh); the site isn't connected to WordPress.com, so Jetpack offers only its
// bootstrap methods to an unsigned request, the way WordPress.com first reaches a site to connect it.
test("xmlrpc: Jetpack's connection still answers WordPress.com, on both of its endpoints, and nothing else does", async () => {
  for (const path of ["/xmlrpc.php?for=jetpack", "/?for=jetpack&jetpack=comms"]) {
    // Only Jetpack's bootstrap methods, plus the system.* callbacks the XML-RPC server class adds itself
    // (they reach only these same methods).
    const listed = await xmlrpc("system.listMethods", path);
    assert.equal(listed.status, 200, path);
    const methods = [...(await listed.text()).matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]).sort();
    assert.deepEqual(methods, ["jetpack.remoteAuthorize", "jetpack.remoteRegister", "jetpack.verifyRegistration", "system.getCapabilities", "system.listMethods", "system.multicall"], path);
    // Jetpack's own handler answers: the bootstrap method exists and rejects a request with no user.
    // (Jetpack sends its faults with the fault's HTTP status, 400 here.)
    const register = await xmlrpc("jetpack.remoteRegister", path);
    const body = await register.text();
    assert.equal(register.status, 400, `${path}: ${body}`);
    assert.doesNotMatch(body, /-32601|XML-RPC is turned off/, `${path}: ${body}`);
    assert.match(body, /Jetpack: \[local_user_missing\]/, `${path}: ${body}`);
    // Signed methods need WordPress.com's signature, which an unsigned request doesn't carry.
    assert.match(await (await xmlrpc("jetpack.testConnection", path)).text(), /-32601/, path);
    // Core's methods aren't reachable through Jetpack's door.
    assert.match(await (await xmlrpc("wp.getUsersBlogs", path)).text(), /-32601/, path);
  }
  const plain = await xmlrpc("jetpack.remoteRegister");
  assert.equal(plain.status, 403, "without ?for=jetpack, XML-RPC stays off");
  // The exception is Jetpack's connection, not the query string: without Jetpack, `?for=jetpack` is refused too.
  wp("plugin", "deactivate", "jetpack");
  try {
    const spoofed = await xmlrpc("system.listMethods", "/xmlrpc.php?for=jetpack");
    assert.equal(spoofed.status, 403);
    assert.match(await spoofed.text(), /XML-RPC is turned off/);
  } finally {
    wp("plugin", "activate", "jetpack");
  }
});

test("pings: pingbacks and trackbacks are closed, and none go out", () => {
  const id = post("post", "Pinged");
  assert.deepEqual(evalJson(`echo wp_json_encode([pings_open(${id}), get_option('default_ping_status'), get_option('default_pingback_flag'), has_action('do_pings', 'do_all_pings')]);`), [false, "closed", "0", false]);
});

test("emoji: no detection script or styles on the front end or in wp-admin", async () => {
  assert.doesNotMatch(await (await page("/")).text(), /wp-emoji|_wpemojiSettings/);
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  assert.doesNotMatch(await (await page("/wp-admin/", cookie)).text(), /wp-emoji|_wpemojiSettings/);
});

test("fileEditors and pluginAndThemeInstalls: refused to the administrator in wp-admin and REST", async () => {
  assert.deepEqual(adminCan(...FILE_CAPS, ...INSTALL_CAPS), [...FILE_CAPS, ...INSTALL_CAPS].map(() => false));
  assert.deepEqual(adminCan("activate_plugins", "switch_themes", "install_languages"), [true, true, true], "activation and translations stay");
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  // update-core.php stays for translation updates; the update_core cap above covers core, plugins and themes.
  for (const screen of ["plugin-editor.php", "theme-editor.php", "plugin-install.php", "theme-install.php"]) {
    // Core refuses each with wp_die(): 403 where it says so, its default 500 otherwise (theme-install.php).
    const response = await page(`/wp-admin/${screen}`, cookie);
    assert.ok([403, 500].includes(response.status), `${screen}: ${response.status}`);
    assert.match(await response.text(), /Sorry, you are not allowed/, screen);
  }
  const install = await fetch(`${core}/plugins`, { method: "POST", headers: { "content-type": "application/json", ...auth("admin") }, body: JSON.stringify({ slug: "hello-dolly" }) });
  assert.equal(install.status, 403);
  assert.equal(evalJson("echo wp_json_encode(wp_is_file_mod_allowed('capability_update_core'));"), false);
});

test("autoUpdates: core, plugin and theme updates never run on their own", () => {
  assert.deepEqual(evalJson(`require_once ABSPATH . 'wp-admin/includes/class-wp-automatic-updater.php';
    echo wp_json_encode([(new WP_Automatic_Updater())->is_disabled(), wp_is_auto_update_enabled_for_type('plugin'), wp_is_auto_update_enabled_for_type('theme'), apply_filters('auto_update_core', true, (object) [])]);`), [true, false, false, false]);
});

test("customizer: customize.php and its links are gone for the administrator", async () => {
  assert.deepEqual(adminCan("customize"), [false]);
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  assert.equal((await page("/wp-admin/customize.php", cookie)).status, 403);
  assert.doesNotMatch(await (await page("/", cookie)).text(), /wp-admin-bar-customize/);
});

test("comments: closed on core posts, pages and kinds without `comments`; open where the kind turns them on", async () => {
  const ids = { post: post("post", "Core post"), page: post("page", "Core page"), memo: post("zero_memos", "Memo"), note: post("zero_notes", "Note") };
  assert.deepEqual([await comment(ids.post), await comment(ids.page), await comment(ids.memo)].map((r) => r.status), [403, 403, 403]);
  assert.equal((await comment(ids.note)).status, 201);
  assert.deepEqual(evalJson("echo wp_json_encode([get_default_comment_status('post'), get_default_comment_status('zero_memos'), get_default_comment_status('zero_notes')]);"), ["closed", "closed", "open"]);
});

test("permalinks: pretty URLs route even when the stored structure is plain", async () => {
  wp("option", "update", "permalink_structure", "");
  wp("rewrite", "flush");
  const id = post("post", "Pretty route");
  const slug = wp("post", "get", String(id), "--field=post_name");
  assert.equal(wp("eval", `echo get_permalink(${id});`), `${site}/${slug}/`);
  const response = await page(`/${slug}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Pretty route/);
  assert.equal(wp("eval", "echo get_option('permalink_structure', 'unset') === '/%postname%/' ? 'filtered' : 'stored';"), "filtered");
  assert.equal(wp("db", "query", "SELECT option_value FROM wp_options WHERE option_name = 'permalink_structure'", "--skip-column-names"), "", "the stored structure stays the owner's");
});

test("timezone: the Space's timezone from ZERO_SITE_TIMEZONE; the owner's setting without it", () => {
  wp("option", "update", "timezone_string", "America/New_York");
  assert.equal(wp("eval", "echo wp_timezone_string();"), "America/New_York");
  wp("config", "set", "ZERO_SITE_TIMEZONE", "Europe/Berlin", "--type=constant");
  try {
    assert.equal(wp("eval", "echo wp_timezone_string();"), "Europe/Berlin");
    assert.equal(wp("option", "get", "timezone_string", "--skip-plugins"), "America/New_York", "the stored option stays the owner's");
  } finally {
    wp("config", "delete", "ZERO_SITE_TIMEZONE");
  }
});

test("blockTheme: Zero's minimal block theme renders when no installed theme is active", async () => {
  const stored = wp("option", "get", "stylesheet", "--skip-plugins");
  wp("option", "update", "template", "gone-theme", "--skip-plugins");
  wp("option", "update", "stylesheet", "gone-theme", "--skip-plugins");
  try {
    assert.deepEqual(evalJson("echo wp_json_encode([get_stylesheet(), wp_is_block_theme()]);"), ["zero-default", true]);
    const response = await page("/");
    assert.equal(response.status, 200);
    assert.match(await response.text(), /wp-block-site-title/);
  } finally {
    wp("option", "update", "template", stored, "--skip-plugins");
    wp("option", "update", "stylesheet", stored, "--skip-plugins");
  }
  assert.equal(evalJson("echo wp_json_encode(get_stylesheet());"), stored, "an installed theme stays the owner's");
});

// Last: everything above must be the active app's doing. With the runtime still active but no app,
// WordPress behaves as it ships.
test("without an active Zero app, WordPress keeps XML-RPC, comments, the Customizer and the rest as shipped", async () => {
  const id = post("post", "Stock post");
  // The stored structure is still the plain one the permalinks test left.
  wp("plugin", "deactivate", app);
  wp("rewrite", "flush");
  const active = JSON.parse(wp("plugin", "list", "--status=active", "--field=name", "--format=json")) as string[];
  assert.deepEqual([active.includes("zero-runtime"), active.some((n) => n.startsWith("zero-app-"))], [true, false], "the runtime alone, no app");
  const listed = await xmlrpc("system.listMethods");
  assert.equal(listed.status, 200);
  assert.match(await listed.text(), /system\.listMethods/);
  const home = await page("/");
  assert.match(await home.text(), /EditURI|xmlrpc\.php\?rsd/);
  assert.equal((await comment(id, `${site}/?rest_route=/wp/v2/comments`)).status, 201);
  assert.deepEqual(adminCan("customize", "edit_plugins", "install_plugins"), [true, true, true]);
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  assert.equal((await page("/wp-admin/customize.php", cookie)).status, 200);
  assert.match(await (await page("/", cookie)).text(), /wp-emoji|_wpemojiSettings/);
  assert.deepEqual(evalJson(`echo wp_json_encode([pings_open(${id}), get_option('permalink_structure'), get_option('zero_rewrite_rules', null)]);`), [true, "", null]);
  assert.equal((await page(`/?p=${id}`)).status, 200, "plain permalinks route again");
});
