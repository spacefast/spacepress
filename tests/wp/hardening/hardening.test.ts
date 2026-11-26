// spec.md §6, "the opinionated WordPress": every hardening switch against real WordPress/MariaDB while the
// SpacePress app is active, then the same checks with the app deactivated, where WordPress behaves as shipped.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { auth, core, harness, wp } from "../env.ts";
import { loginCookie } from "../login.ts";

const site = harness.url;
const call = (method: string, params = "") => `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${params}</params></methodCall>`;
/** `system.multicall` wrapping one parameterless call. */
const multicall = (method: string) =>
  call("system.multicall", `<param><value><array><data><value><struct><member><name>methodName</name><value><string>${method}</string></value></member><member><name>params</name><value><array><data></data></array></value></member></struct></value></data></array></value></param>`);
const xmlrpc = (method: string, path = "/xmlrpc.php", body = call(method)) =>
  fetch(`${site}${path}`, { method: "POST", headers: { "content-type": "text/xml" }, body });
const listedMethods = async (response: Response) => [...(await response.text()).matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]).sort();
const SETUP_METHODS = ["jetpack.remoteAuthorize", "jetpack.remoteRegister", "jetpack.verifyRegistration", "system.getCapabilities", "system.listMethods", "system.multicall"];
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
  const schema = (await (await fetch(`${harness.url}/wp-json/spacepress/v1`, { headers: auth("admin") })).json()) as { data: { runtime: { wp: { hardening: string[] } } } };
  assert.deepEqual(schema.data.runtime.wp.hardening, ["xmlrpc", "pings", "emoji", "adminBar", "fileEditors", "pluginAndThemeInstalls", "autoUpdates", "customizer", "comments", "authors", "schemaLock", "loginErrors", "permalinks", "timezone", "blockTheme"]);
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
    assert.deepEqual(await listedMethods(listed), SETUP_METHODS, path);
    // Jetpack's own handler answers: the bootstrap method exists and rejects a request with no user.
    // (Jetpack sends its faults with the fault's HTTP status, 400 here.)
    const register = await xmlrpc("jetpack.remoteRegister", path);
    const body = await register.text();
    assert.equal(register.status, 400, `${path}: ${body}`);
    assert.doesNotMatch(body, /-32601|XML-RPC is turned off/, `${path}: ${body}`);
    assert.match(body, /Jetpack: \[local_user_missing\]/, `${path}: ${body}`);
    // Signed methods need WordPress.com's signature, which an unsigned request doesn't carry.
    assert.match(await (await xmlrpc("jetpack.testConnection", path)).text(), /-32601/, path);
    // Core's methods aren't reachable through Jetpack's door, directly or inside a multicall.
    assert.match(await (await xmlrpc("wp.getUsersBlogs", path)).text(), /-32601/, path);
    assert.match(await (await xmlrpc("system.multicall", path, multicall("wp.getUsersBlogs"))).text(), /-32601/, path);
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

// A connected site, without WordPress.com: a throwaway blog token in Jetpack's options, and requests signed
// by Jetpack's own Jetpack_Signature, the code that verifies them. Jetpack checks the signature; SpacePress only
// keeps core's methods out.
test("xmlrpc: a Jetpack request signed with the blog token reaches Jetpack's signed methods; a forged one gets only setup", async () => {
  const blogToken = `zerotest.${randomBytes(16).toString("hex")}`;
  /** `?for=jetpack` signed the way WordPress.com signs it, with `token`'s secret. */
  const signed = (method: string, token = blogToken) => {
    const body = call(method);
    const query = {
      for: "jetpack",
      token: `${blogToken.split(".")[0]}:1:0`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      nonce: randomBytes(5).toString("hex"),
      "body-hash": createHash("sha1").update(body).digest("base64"),
    };
    const uri = `${new URL(site).pathname.replace(/\/$/, "")}/xmlrpc.php?${new URLSearchParams(query)}`;
    const { host, port } = new URL(site);
    const args = Buffer.from(JSON.stringify({ query, uri, body, token, host, port: port || "80" })).toString("base64");
    // The request as Apache sees it, signed by Jetpack. Apache takes SERVER_PORT from the Host header.
    const signature = wp("eval", `$a = json_decode(base64_decode('${args}'), true);
      $_GET = $a['query']; $_SERVER['REQUEST_METHOD'] = 'POST'; $_SERVER['HTTP_HOST'] = $a['host']; $_SERVER['REQUEST_URI'] = $a['uri']; $_SERVER['SERVER_PORT'] = $a['port'];
      echo (new Jetpack_Signature($a['token'], 0))->sign_current_request(['body' => $a['body']]);`);
    return fetch(`${new URL(site).origin}${uri}&${new URLSearchParams({ signature })}`, { method: "POST", headers: { "content-type": "text/xml" }, body });
  };
  wp("eval", `Jetpack_Options::update_options(['id' => 4242, 'blog_token' => '${blogToken}']);`);
  try {
    assert.equal(wp("eval", "echo wp_json_encode((new Automattic\\Jetpack\\Connection\\Manager())->is_connected());"), "true");
    const forged = `${blogToken.split(".")[0]}.${randomBytes(16).toString("hex")}`;
    assert.deepEqual(await listedMethods(await signed("system.listMethods", forged)), SETUP_METHODS, "a forged signature gets the setup methods");
    assert.match(await (await signed("jetpack.testConnection", forged)).text(), /-32601/);
    const connection = await signed("jetpack.testConnection");
    const answer = await connection.text();
    assert.equal(connection.status, 200, answer);
    assert.match(answer, /<string>16\.4<\/string>/, answer);
    // Signed or not, core's methods stay shut. Stock Jetpack answers the same: its signed method list
    // replaces core's, so its own `wp.getOptions` override never reaches `?for=jetpack`.
    assert.match(await (await signed("wp.getOptions")).text(), /-32601/);
  } finally {
    wp("eval", "Jetpack_Options::delete_option(['id', 'blog_token']);");
  }
});

test("pings: pingbacks and trackbacks are closed, and none go out", () => {
  const id = post("post", "Pinged");
  assert.deepEqual(evalJson(`echo wp_json_encode([pings_open(${id}), get_option('default_ping_status'), get_option('default_pingback_flag'), get_default_comment_status('post', 'pingback'), has_action('do_pings', 'do_all_pings')]);`), [false, "closed", "0", "closed", false]);
});

/** This app's schema.php without `xmlrpc: false` and `pings: false`, as a config that leaves them out builds it; restored after. */
async function withWordPressDefaults(run: () => Promise<void>) {
  const schema = wp("eval", "echo SpacePress\\Wp\\Runtime::plugin()->dir . '/sp/app/schema.php';");
  const original = wp("eval", `echo base64_encode(file_get_contents('${schema}'));`);
  wp("eval", `$s = file_get_contents('${schema}'); $d = str_replace(["    'xmlrpc' => false,\\n", "    'pings' => false,\\n"], '', $s); if (substr_count($s, '=> false,') - substr_count($d, '=> false,') !== 2) { exit(1); } file_put_contents('${schema}', $d);`);
  try {
    await run();
  } finally {
    wp("eval", `file_put_contents('${schema}', base64_decode('${original}'));`);
  }
}

test("xmlrpc and pings left out of the config: WordPress's own, the site's Discussion settings included", async () => {
  await withWordPressDefaults(async () => {
    const listing = (await (await fetch(`${site}/wp-json/spacepress/v1`, { headers: auth("admin") })).json()).data.runtime.wp.hardening;
    assert.deepEqual(listing, ["emoji", "adminBar", "fileEditors", "pluginAndThemeInstalls", "autoUpdates", "customizer", "comments", "authors", "schemaLock", "loginErrors", "permalinks", "timezone", "blockTheme"]);
    // XML-RPC answers, signed-in methods included (an unscoped application password, as WordPress allows).
    const listed = await xmlrpc("system.listMethods");
    assert.equal(listed.status, 200);
    assert.ok((await listedMethods(listed)).includes("wp.getUsersBlogs"));
    const blogs = await xmlrpc("wp.getUsersBlogs", "/xmlrpc.php", call("wp.getUsersBlogs", `<param><value><string>admin</string></value></param><param><value><string>${harness.users.admin.appPassword}</string></value></param>`));
    const answer = await blogs.text();
    assert.equal(blogs.status, 200, answer);
    assert.match(answer, /<name>isAdmin<\/name><value><boolean>1<\/boolean>/, answer);
    assert.match(await (await page("/")).text(), /EditURI|xmlrpc\.php\?rsd/);
    // A scoped agent password still signs in only where its scope is enforced: never over XML-RPC.
    const agent = JSON.parse(wp("spacepress", "identity", "agent", "add", "admin", `--name=xmlrpc-${Date.now()}`, "--write")).data;
    try {
      const scoped = await (await xmlrpc("wp.getUsersBlogs", "/xmlrpc.php", call("wp.getUsersBlogs", `<param><value><string>admin</string></value></param><param><value><string>${agent.password}</string></value></param>`))).text();
      assert.match(scoped, /<name>faultCode<\/name>/, scoped);
      assert.doesNotMatch(scoped, /isAdmin/, scoped);
    } finally {
      wp("spacepress", "identity", "agent", "revoke", "admin", agent.id);
    }
    // Pings: what the site's own Discussion settings say, here as a new WordPress ships them (open, notify).
    assert.deepEqual(evalJson("echo wp_json_encode([get_option('default_ping_status'), get_option('default_pingback_flag'), has_action('do_pings', 'do_all_pings')]);"), ["open", "1", 10]);
    const open = post("post", "Pingable");
    assert.deepEqual(evalJson(`echo wp_json_encode([pings_open(${open}), get_default_comment_status('post', 'pingback'), get_default_comment_status('post')]);`), [true, "open", "closed"], "pings follow WordPress, comments stay SpacePress's");
    const single = await page(`/?p=${open}`);
    const permalink = single.headers.get("location") ?? `/?p=${open}`;
    assert.ok((await fetch(new URL(permalink, site))).headers.get("x-pingback")?.endsWith("/xmlrpc.php"));
    // The owner changes the setting in Settings > Discussion: new posts follow it.
    wp("option", "update", "default_ping_status", "closed");
    try {
      const closed = Number(wp("post", "create", "--post_type=post", "--post_title=Unpingable", "--post_status=publish", "--porcelain"));
      assert.deepEqual(evalJson(`echo wp_json_encode([pings_open(${closed}), get_default_comment_status('post', 'pingback')]);`), [false, "closed"]);
    } finally {
      wp("option", "update", "default_ping_status", "open");
    }
  });
  // Back to this app's own `xmlrpc: false`.
  assert.equal((await xmlrpc("system.listMethods")).status, 403);
});

test("the facade's built-in settings: public fields for everyone, writes for admins, as core decides", async () => {
  const settings = `${site}/wp-json/spacepress/v1/settings`;
  const patch = (who: "editor" | "admin", body: unknown) =>
    fetch(settings, { method: "PATCH", headers: { "content-type": "application/json", ...auth(who) }, body: JSON.stringify(body) });
  const anon = await (await fetch(settings)).json();
  assert.deepEqual(Object.keys(anon.data).sort(), ["frontPage", "icon", "locale", "logo", "tagline", "timezone", "title"]);
  const tagline = `Facade tagline ${randomBytes(4).toString("hex")}`;
  assert.equal((await patch("editor", { tagline })).status, 403);
  const set = await patch("admin", { tagline });
  assert.deepEqual([set.status, (await set.json()).data.tagline], [200, tagline]);
  assert.equal((await (await fetch(settings)).json()).data.tagline, tagline);
  assert.equal((await (await patch("admin", { nope: 1 })).json()).pointer, "/nope");
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

test("adminBar: hidden on the front end for signed-in visitors; classic wp-admin keeps its toolbar", async () => {
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  const front = await (await page("/", cookie)).text();
  assert.match(front, /<body[^>]*\blogged-in\b/);
  assert.doesNotMatch(front, /wpadminbar/);
  const admin = await (await page("/wp-admin/index.php", cookie)).text();
  assert.match(admin, /wpadminbar/);
});

test("customizer: customize.php and its links are gone for the administrator", async () => {
  assert.deepEqual(adminCan("customize"), [false]);
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  assert.equal((await page("/wp-admin/customize.php", cookie)).status, 403);
  assert.doesNotMatch(await (await page("/", cookie)).text(), /wp-admin-bar-customize/);
});

test("comments: closed on core posts, pages and kinds without `comments`; open where the kind turns them on", async () => {
  const ids = { post: post("post", "Core post"), page: post("page", "Core page"), memo: post("sp_memos", "Memo"), note: post("sp_notes", "Note") };
  assert.deepEqual([await comment(ids.post), await comment(ids.page), await comment(ids.memo)].map((r) => r.status), [403, 403, 403]);
  assert.equal((await comment(ids.note)).status, 201);
  assert.deepEqual(evalJson("echo wp_json_encode([get_default_comment_status('post'), get_default_comment_status('sp_memos'), get_default_comment_status('sp_notes')]);"), ["closed", "closed", "open"]);
  // The facade's built-in `comments` kind (spec §2.1, this app declares none): core's route and rules,
  // SpacePress's field names, and the same refusal on a closed item.
  const facade = `${site}/wp-json/spacepress/v1/comments`;
  const write = (on: number) => fetch(facade, { method: "POST", headers: { "content-type": "application/json", ...auth("editor") }, body: JSON.stringify({ on, content: `facade on ${on}` }) });
  const closed = await write(ids.memo);
  assert.equal(closed.status, 403, await closed.text());
  const created = await write(ids.note);
  const row = (await created.json()).data;
  assert.deepEqual([created.status, row.on, row.author, row.type, row.status], [201, ids.note, harness.users.editor.id, "comment", "approved"]);
  const listed = (await (await fetch(`${facade}?post=${ids.note}`)).json()).data;
  assert.ok(listed.some((c: any) => c.id === row.id && /facade on/.test(c.content)), JSON.stringify(listed));
});

/** wp-login.php's form posted as a browser would, without the test cookie: [status, Location, page]. */
const signIn = async (log: string, pwd: string) => {
  const response = await fetch(`${site}/wp-login.php`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ log, pwd }) });
  return [response.status, response.headers.get("location"), await response.text()] as const;
};
const lostPassword = async (user_login: string) => {
  const response = await fetch(`${site}/wp-login.php?action=lostpassword`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ user_login }) });
  return [response.status, response.headers.get("location")] as const;
};
const GENERIC_LOGIN_ERROR = "<strong>Error:</strong> Invalid username, email address or incorrect password.";

test("loginErrors: wp-login.php answers an unknown account and a wrong password alike", async () => {
  for (const [log, pwd] of [["nobody-here", "guess"], ["nobody@example.test", "guess"], ["admin", "wrong password"], [wp("user", "get", "admin", "--field=user_email"), "wrong password"]]) {
    const [status, , body] = await signIn(log, pwd);
    assert.equal(status, 200, log);
    assert.ok(body.includes(GENERIC_LOGIN_ERROR), `${log}: ${body.match(/id="login_error"[\s\S]{0,300}/)?.[0]}`);
    assert.doesNotMatch(body, /is not registered|Unknown email address|The password you entered for/, log);
    // wp-login.php refills the username only after a wrong password: it is refilled for every account.
    assert.equal(body.match(/id="user_login"[^>]*value="([^"]*)"/)?.[1], log, `${log}: the typed username is kept`);
  }
});

test("loginErrors: lost password says \"check your email\" whether or not the account exists", async () => {
  for (const login of ["nobody-here", "nobody@example.test", "admin"]) {
    const [status, location] = await lostPassword(login);
    assert.equal(status, 302, login);
    assert.match(location ?? "", /wp-login\.php\?checkemail=confirm$/, login);
  }
  // A field left empty is the visitor's mistake, not the account's: core's error stays.
  const empty = await fetch(`${site}/wp-login.php?action=lostpassword`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ user_login: "" }) });
  assert.equal(empty.status, 200);
  assert.match(await empty.text(), /Please enter a username or email address/);
  const confirm = await (await page("/wp-login.php?checkemail=confirm")).text();
  assert.match(confirm, /If there is an account associated with the username\/email address, you will receive an email/);
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

test("timezone: the Space's timezone from SP_SITE_TIMEZONE; the owner's setting without it", () => {
  wp("option", "update", "timezone_string", "America/New_York");
  assert.equal(wp("eval", "echo wp_timezone_string();"), "America/New_York");
  wp("config", "set", "SP_SITE_TIMEZONE", "Europe/Berlin", "--type=constant");
  try {
    assert.equal(wp("eval", "echo wp_timezone_string();"), "Europe/Berlin");
    assert.equal(wp("option", "get", "timezone_string", "--skip-plugins"), "America/New_York", "the stored option stays the owner's");
  } finally {
    wp("config", "delete", "SP_SITE_TIMEZONE");
  }
});

test("blockTheme: SpacePress's minimal block theme renders when no installed theme is active", async () => {
  const stored = wp("option", "get", "stylesheet", "--skip-plugins");
  // --skip-themes: between the two writes the template and stylesheet name different themes, and
  // WordPress 7.2's default theme requires files from the template's directory when it loads.
  wp("option", "update", "template", "gone-theme", "--skip-plugins", "--skip-themes");
  wp("option", "update", "stylesheet", "gone-theme", "--skip-plugins", "--skip-themes");
  try {
    assert.deepEqual(evalJson("echo wp_json_encode([get_stylesheet(), wp_is_block_theme()]);"), ["spacepress-default", true]);
    const response = await page("/");
    assert.equal(response.status, 200);
    assert.match(await response.text(), /wp-block-site-title/);
  } finally {
    wp("option", "update", "template", stored, "--skip-plugins", "--skip-themes");
    wp("option", "update", "stylesheet", stored, "--skip-plugins", "--skip-themes");
  }
  assert.equal(evalJson("echo wp_json_encode(get_stylesheet());"), stored, "an installed theme stays the owner's");
});

// Last: everything above must be the active app's doing. With the runtime still active but no app,
// WordPress behaves as it ships.
test("without an active SpacePress app, WordPress keeps XML-RPC, comments, the Customizer and the rest as shipped", async () => {
  const id = post("post", "Stock post");
  // The stored structure is still the plain one the permalinks test left.
  wp("plugin", "deactivate", app);
  wp("rewrite", "flush");
  const active = JSON.parse(wp("plugin", "list", "--status=active", "--field=name", "--format=json")) as string[];
  assert.deepEqual([active.includes("spacepress-runtime"), active.some((n) => n.startsWith("spacepress-app-"))], [true, false], "the runtime alone, no app");
  const listed = await xmlrpc("system.listMethods");
  assert.equal(listed.status, 200);
  assert.match(await listed.text(), /system\.listMethods/);
  const home = await page("/");
  assert.match(await home.text(), /EditURI|xmlrpc\.php\?rsd/);
  assert.equal((await comment(id, `${site}/?rest_route=/wp/v2/comments`)).status, 201);
  assert.deepEqual(adminCan("customize", "edit_plugins", "install_plugins"), [true, true, true]);
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  assert.equal((await page("/wp-admin/customize.php", cookie)).status, 200);
  const homeAsAdmin = await (await page("/", cookie)).text();
  assert.match(homeAsAdmin, /wp-emoji|_wpemojiSettings/);
  assert.match(homeAsAdmin, /wpadminbar/);
  assert.deepEqual(evalJson(`echo wp_json_encode([pings_open(${id}), get_option('permalink_structure'), get_option('sp_rewrite_rules', null)]);`), [true, "", null]);
  assert.equal((await page(`/?p=${id}`)).status, 200, "plain permalinks route again");
  assert.match((await signIn("nobody-here", "guess"))[2], /is not registered on this site/, "wp-login.php's own errors again");
  assert.equal((await lostPassword("nobody-here"))[0], 200, "lost password reports the unknown account again");
});
