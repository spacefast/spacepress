// TypedPress Admin as `typedpress build` ships it to every app (docs/admin.md): the artifact carries
// `typedpress-admin` and the harness activates it after the app. What this proves: the plugin is active,
// serves its page at the upstream mount /wp-admin/new/ to signed-in users only, loads the committed
// build rather than an empty shell, lands users there after login, frames classic wp-admin pages
// unless the user turned developer mode on, and redirects the earlier /typedpress-admin/ and /legacy/
// addresses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { auth, harness, wp } from "./env.ts";

const site = harness.url;
const content = fileURLToPath(new URL("./.wp-content/", import.meta.url));

import { loginCookie } from "./login.ts";


test("the built artifact ships typedpress-admin and the harness activated it after the app", () => {
  const manifest = JSON.parse(readFileSync(`${content}typedpress-manifest.json`, "utf8"));
  assert.equal(manifest.plugins["typedpress-admin"], manifest.typedpress, "the admin plugin is versioned with the compiler");
  const status = JSON.parse(wp("plugin", "list", "--format=json", "--fields=name,status,version"));
  const admin = status.find((p: any) => p.name === "typedpress-admin");
  assert.deepEqual([admin?.status, admin?.version], ["active", manifest.typedpress]);
  // Plugins may enqueue an admin asset before REST has registered its handle.
  const assets = JSON.parse(wp("eval", `
    wp_set_current_user(${harness.users.admin.id});
    wp_deregister_script('wp-color-picker');
    wp_deregister_style('wp-color-picker');
    wp_register_script('wp-color-picker', '/wp-admin/js/color-picker.min.js', ['iris'], 'plugin-kept', true);
    wp_add_inline_script('wp-color-picker', 'window.tpPickerConfig = true;', 'before');
    wp_register_style('wp-color-picker', '/wp-admin/css/color-picker.min.css', ['wp-components'], 'style-kept');
    wp_enqueue_script('wp-color-picker');
    wp_deregister_script('iris');
    wp_deregister_script('xfn');
    wp_enqueue_script('xfn');
    wp_enqueue_style('wp-color-picker');
    $request = new WP_REST_Request('GET', '/wp/v2/editor/assets');
    $request->set_param('standalone', true);
    $response = rest_do_request($request);
    echo wp_json_encode(['status' => $response->get_status(), 'data' => $response->get_data()]);
  `));
  assert.equal(assets.status, 200);
  assert.match(assets.data.scripts['wp-color-picker'].src, /color-picker/);
  assert.match(assets.data.scripts.iris.src, /iris/);
  assert.match(assets.data.scripts.xfn.src, /xfn/);
  assert.match(assets.data.styles['wp-color-picker'].src, /color-picker/);
  assert.equal(assets.data.scripts['wp-color-picker'].version, 'plugin-kept');
  assert.equal(assets.data.styles['wp-color-picker'].version, 'style-kept');
  assert.match(assets.data.inline_scripts.before['wp-color-picker'], /window.tpPickerConfig = true/);
});

test("/wp-admin/new/ asks anonymous visitors to sign in and serves the committed build to users", async () => {
  // WP-CLI activated the plugin; the first web request writes the rule into .htaccess.
  assert.equal((await fetch(`${site}/`)).status, 200);
  assert.equal(wp("option", "get", "tp_admin_rewrite"), JSON.parse(readFileSync(`${content}typedpress-manifest.json`, "utf8")).typedpress);
  assert.match(wp("eval", "echo file_get_contents(ABSPATH . '.htaccess');"), /^RewriteRule \^wp-admin\/new\(\/\.\*\)\?\$ \/?wp-admin\/admin\.php\?page=typedpress-admin \[L\]$/m);
  const anon = await fetch(`${site}/wp-admin/new/`, { redirect: "manual" });
  assert.equal(anon.status, 302);
  assert.ok(anon.headers.get("location")!.startsWith(`${site}/wp-login.php?`), anon.headers.get("location")!);
  const deepLink = `${site}/wp-admin/new/collections/posts?search=Draft`;
  const deep = await fetch(deepLink, { redirect: "manual" });
  assert.equal(deep.status, 302);
  assert.equal(new URL(deep.headers.get("location")!).searchParams.get("redirect_to"), deepLink);

  for (const role of ["editor", "subscriber"] as const) {
    const cookie = await loginCookie(site, role, `${site}/wp-admin/new/`);
    for (const url of [`${site}/wp-admin/new/`, `${site}/wp-admin/new/collections/posts`, `${site}/wp-admin/admin.php?page=typedpress-admin&p=%2Fcollections%2Fposts`]) {
      const page = await fetch(url, { headers: { cookie }, redirect: "manual" });
      assert.equal(page.status, 200, `${role} is served ${url}`);
      assert.match(page.headers.get('cache-control') ?? '', /no-cache|no-store/);
      const html = await page.text();
      assert.ok(html.includes('id="typedpress-admin-app"'), `${role} gets the app shell`);
      // The import map names the built boot module from the plugin's own build directory: the page
      // runs the committed bundle, not the pre-build shell.
      const importMap = html.match(/<script[^>]*type="importmap"[^>]*>(.*?)<\/script>/s);
      assert.ok(importMap, `${role}: the page carries an import map`);
      const imports = JSON.parse(importMap[1]).imports as Record<string, string>;
      assert.match(imports["@typedpress-admin/boot"], /\/plugins\/typedpress-admin\/build\/packages\/boot\/index\.js(\?|$)/);
    }
    // wp-admin's menu entry without a route goes to the mount.
    const menu = await fetch(`${site}/wp-admin/admin.php?page=typedpress-admin`, { headers: { cookie }, redirect: "manual" });
    assert.equal(menu.status, 302);
    assert.equal(menu.headers.get("location"), `${site}/wp-admin/new/`);
    // Classic wp-admin is unchanged. (Polylang sends the first wp-admin load after its activation
    // to its setup wizard; this asks for a page, so take that one-time redirect out of the way.)
    wp("transient", "delete", "pll_activation_redirect");
    // Classic wp-admin still serves its pages (to the frame, to scripts); a browser opening one as a
    // page without developer mode is sent to it framed in TypedPress Admin (the test below).
    const classic = await fetch(`${site}/wp-admin/profile.php`, { headers: { cookie }, redirect: "manual" });
    assert.equal(classic.status, 200, `${role} keeps classic wp-admin`);
    assert.match(await classic.text(), /id="adminmenu"/);
  }
});

test("signing in lands on TypedPress Admin unless the visitor asked for another page", async () => {
  const signIn = (redirect?: string) => fetch(`${site}/wp-login.php`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: "wordpress_test_cookie=WP%20Cookie%20check" },
    body: new URLSearchParams({ log: "subscriber", pwd: "typedpress-test-subscriber", testcookie: "1", ...(redirect === undefined ? {} : { redirect_to: redirect }) }),
  });
  // WordPress's login form posts its default, `/wp-admin/`, as redirect_to even when nothing was
  // asked for: both that and no redirect_to land on TypedPress Admin (for a subscriber too, whom core
  // would send to profile.php).
  const form = await (await fetch(`${site}/wp-login.php`)).text();
  assert.match(form, new RegExp(`name="redirect_to" value="${site}/wp-admin/"`));
  for (const redirect of [undefined, `${site}/wp-admin/`]) {
    const response = await signIn(redirect);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${site}/wp-admin/new/`, `redirect_to ${redirect ?? "absent"}`);
  }
  for (const redirect of [`${site}/wp-admin/edit.php`, `${site}/`]) {
    assert.equal((await signIn(redirect)).headers.get("location"), redirect, "an asked-for page is kept");
  }
});

test("on a server that ignores .htaccess, /wp-admin/new/ redirects to the query form and keeps the query", async () => {
  // Take the rule out of .htaccess as such a server would leave it; WordPress then serves the path.
  const saved = wp("eval", "echo base64_encode(file_get_contents(ABSPATH . '.htaccess'));");
  wp("eval", "file_put_contents(ABSPATH . '.htaccess', preg_replace('/^RewriteRule \\^wp-admin\\/new.*$\\n?/m', '', file_get_contents(ABSPATH . '.htaccess')));");
  try {
    assert.doesNotMatch(wp("eval", "echo file_get_contents(ABSPATH . '.htaccess');"), /wp-admin\/new/);
    const response = await fetch(`${site}/wp-admin/new/collections/posts?search=Draft&page=2`, { redirect: "manual" });
    assert.equal(response.status, 302);
    const to = new URL(response.headers.get("location")!);
    assert.equal(to.pathname, new URL(`${site}/wp-admin/admin.php`).pathname);
    // The route's query rides inside `p` (the router parses `p` as a path with its query): beside
    // it, the route's `page` would replace wp-admin's `page=typedpress-admin`.
    assert.deepEqual([to.searchParams.getAll("page"), to.searchParams.get("p")], [["typedpress-admin"], "/collections/posts?search=Draft&page=2"]);
    const cookie = await loginCookie(site, "editor", `${site}/wp-admin/`);
    const served = await fetch(to, { headers: { cookie }, redirect: "manual" });
    assert.equal(served.status, 200, "the query form is TypedPress Admin's page");
    assert.ok((await served.text()).includes('id="typedpress-admin-app"'));
  } finally {
    wp("eval", `file_put_contents(ABSPATH . '.htaccess', base64_decode('${saved}'));`);
  }
});

test("activating TypedPress Admin from the Plugins screen writes the rule without QSA", async () => {
  // A web request, like the Plugins screen: plugins_loaded has run, so only the activation hook runs.
  wp("plugin", "deactivate", "typedpress-admin");
  try {
    const cookie = await loginCookie(site, "admin", `${site}/wp-admin/plugins.php`);
    const screen = await (await fetch(`${site}/wp-admin/plugins.php`, { headers: { cookie } })).text();
    const activate = screen.match(/href="([^"]*action=activate[^"]*plugin=typedpress-admin%2Ftypedpress-admin\.php[^"]*)"/);
    assert.ok(activate, "the Plugins screen offers to activate TypedPress Admin");
    const response = await fetch(new URL(activate[1].replaceAll("&amp;", "&"), `${site}/wp-admin/`), { headers: { cookie }, redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(wp("plugin", "get", "typedpress-admin", "--field=status"), "active");
    assert.match(wp("eval", "echo file_get_contents(ABSPATH . '.htaccess');"), /^RewriteRule \^wp-admin\/new\(\/\.\*\)\?\$ \/?wp-admin\/admin\.php\?page=typedpress-admin \[L\]$/m);
    // A paginated deep link keeps TypedPress Admin's page argument out of its own `page`.
    const deep = await fetch(`${site}/wp-admin/new/collections/posts?page=2`, { headers: { cookie: await loginCookie(site, "editor", `${site}/wp-admin/new/`) }, redirect: "manual" });
    assert.equal(deep.status, 200);
    assert.ok((await deep.text()).includes('id="typedpress-admin-app"'));
  } finally {
    if (wp("plugin", "get", "typedpress-admin", "--field=status") !== "active") wp("plugin", "activate", "typedpress-admin");
  }
});

test("the earlier /typedpress-admin/ address redirects to the same route at /wp-admin/new/", async () => {
  for (const [from, to] of [
    ["/typedpress-admin", "/wp-admin/new/"],
    ["/typedpress-admin/", "/wp-admin/new/"],
    ["/typedpress-admin/collections/posts?search=Draft", "/wp-admin/new/collections/posts?search=Draft"],
  ]) {
    const response = await fetch(`${site}${from}`, { redirect: "manual" });
    assert.equal(response.status, 301, from);
    assert.equal(response.headers.get("location"), `${site}${to}`, from);
  }
});

test("a declared screen: its declaration is served to users who may open it, with each action's method", async () => {
  const anon = await fetch(`${site}/wp-json/typedpress-admin/v1/screens/test-comments`);
  assert.equal(anon.status, 401);
  assert.equal((await fetch(`${site}/wp-json/typedpress-admin/v1/screens/nope`, { headers: auth("admin") })).status, 404);
  const response = await fetch(`${site}/wp-json/typedpress-admin/v1/screens/test-comments`, { headers: auth("subscriber") });
  assert.equal(response.status, 200);
  const screen = await response.json();
  assert.equal(screen.title, "Comment review");
  assert.deepEqual(screen.view.fields.map((f: { id: string }) => f.id), ["name", "body", "approved"]);
  // The method comes from the ability's annotations: an update runs over POST.
  assert.deepEqual(screen.actions.map((a: { id: string; method: string }) => [a.id, a.method]), [["approve", "POST"]]);
  assert.deepEqual(screen.data, ["Approving a comment publishes it."]);
  // WordPress 7.2 keeps fields and actions per entity in its own registries: when the running
  // WordPress has them, the screen's are registered there (entity tpAdminScreen/<id>) and read
  // back from there; on 7.1 the declaration is the registry. Either way the screen is the same.
  const core = JSON.parse(wp("eval", "echo wp_json_encode(['fields' => function_exists('wp_register_entity_fields'), 'actions' => function_exists('wp_register_entity_actions')]);"));
  assert.deepEqual(screen.registry, { fields: core.fields ? "core" : "typedpress-admin", actions: core.actions ? "core" : "typedpress-admin" });
  if (core.fields) {
    const registered = await (await fetch(`${site}/wp-json/wp/v2/entity-fields?kind=tpAdminScreen&name=test-comments`, { headers: auth("editor") })).json();
    assert.deepEqual(registered.fields.map((f: { id: string; origin: { registeredBy: string } }) => [f.id, f.origin.registeredBy]), [["name", "typedpress-admin"], ["body", "typedpress-admin"], ["approved", "typedpress-admin"]]);
  }
  if (core.actions) {
    const registered = await (await fetch(`${site}/wp-json/wp/v2/entity-actions?kind=tpAdminScreen&name=test-comments`, { headers: auth("editor") })).json();
    assert.deepEqual(registered.actions.map((a: { id: string; ability: string }) => [a.id, a.ability]), [["approve", "blog/comments-update"]]);
  }
  // Each table kind is a screen too, with delete bound to the kind's delete ability; the method is
  // whatever that ability's annotations make core's run route require.
  const table = await (await fetch(`${site}/wp-json/typedpress-admin/v1/screens/table-comments`, { headers: auth("admin") })).json();
  assert.equal(table.view.ability, "blog/comments-list");
  assert.deepEqual(table.actions.map((a: { ability: string }) => a.ability), ["blog/comments-delete"]);
  // Core's run route takes the declared method: with any other one it answers 405 before running.
  const [del] = table.actions as { method: string }[];
  const probe = await fetch(`${site}/wp-json/wp-abilities/v1/abilities/blog/comments-delete/run${del.method === "POST" ? "" : "?input[id]=0"}`, {
    method: del.method, headers: { ...auth("admin"), "content-type": "application/json" }, body: del.method === "POST" ? JSON.stringify({ input: { id: 0 } }) : undefined,
  });
  assert.notEqual(probe.status, 405, `${del.method}: ${await probe.text()}`);
  // Classic wp-admin registered a page for each, under the declared parent.
  const pages = JSON.parse(wp("eval", `
    wp_set_current_user(${harness.users.admin.id});
    require_once ABSPATH . 'wp-admin/includes/admin.php';
    set_current_screen('dashboard');
    global $menu, $submenu, $_wp_submenu_nopriv;
    $menu = []; $submenu = [];
    do_action('admin_menu', '');
    echo wp_json_encode(['comments' => array_column($submenu['edit-comments.php'] ?? [], 2), 'app' => array_column($submenu['typedpress-blog'] ?? [], 2)]);
  `));
  assert.ok(pages.comments.includes("typedpress-screen-test-comments"), JSON.stringify(pages));
  assert.ok(pages.app.includes("typedpress-screen-table-comments"), JSON.stringify(pages));
});

test("a screen declared with adminScreen() in TypeScript is registered and served like a PHP one", async () => {
  // tests/wp/app/tp/lanes/abilities.ts: `export const refsReview = adminScreen({ access: "editor", ... })`.
  assert.equal((await fetch(`${site}/wp-json/typedpress-admin/v1/screens/refs-review`)).status, 401);
  assert.equal((await fetch(`${site}/wp-json/typedpress-admin/v1/screens/refs-review`, { headers: auth("subscriber") })).status, 403);
  const response = await fetch(`${site}/wp-json/typedpress-admin/v1/screens/refs-review`, { headers: auth("editor") });
  assert.equal(response.status, 200);
  const screen = await response.json();
  assert.equal(screen.title, "Comment bodies");
  assert.equal(screen.view.ability, "blog/refs-rows");
  assert.equal(screen.view.items, "rows");
  assert.deepEqual(screen.view.fields.map((f: { id: string }) => f.id), ["id", "body"]);
  assert.deepEqual(screen.view.layout, { type: "table", titleField: "body", fields: ["id"] });
  // The action is the Ability the runtime registered for `refsPurge`, destructive and idempotent: DELETE.
  assert.deepEqual(
    screen.actions.map((a: Record<string, unknown>) => [a.id, a.ability, a.input, a.destructive, a.method]),
    [["purge", "blog/refs-purge", { body: "{item.body}" }, true, "DELETE"]],
  );
  assert.deepEqual(screen.data, ["Purging deletes every comment with the same body."]);
  // The list ability runs through core's run route over GET, as the screen calls it.
  const rows = await fetch(`${site}/wp-json/wp-abilities/v1/abilities/blog/refs-rows/run`, { headers: auth("editor") });
  assert.equal(rows.status, 200, await rows.clone().text());
  assert.ok(Array.isArray((await rows.json()).rows));
  // wp-admin lists it under Tools for editors.
  const pages = JSON.parse(wp("eval", `
    wp_set_current_user(${harness.users.editor.id});
    require_once ABSPATH . 'wp-admin/includes/admin.php';
    set_current_screen('dashboard');
    global $menu, $submenu;
    $menu = []; $submenu = [];
    do_action('admin_menu', '');
    echo wp_json_encode(array_column($submenu['tools.php'] ?? [], 2));
  `));
  assert.ok(pages.includes("typedpress-screen-refs-review"), JSON.stringify(pages));
});

// The schema lock (config-api.md, "Schema lock") refuses edits to what TypedPress generates. TypedPress's admin
// is TypedPress's own: what it reads from its REST controllers and what its screens save are content and
// settings, never the schema, so none of it is refused.
test("with the schema lock on, the admin's controllers answer and its saves go through", async () => {
  const lock = (await (await fetch(`${site}/__tp/api/v1`, { headers: auth("admin") })).json()).data.runtime.wp.hardening;
  assert.ok(lock.includes("schemaLock"));
  const json = (method: string, path: string, body?: unknown) =>
    fetch(`${site}${path}`, { method, headers: { ...auth("admin"), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  // The admin's own controllers.
  for (const path of ["/wp-json/typedpress-admin/v1/view-config?kind=postType&name=tp_posts", "/wp-json/wp/v2/field-collections?kind=postType&name=tp_posts", "/wp-json/wp/v2/editor/settings", "/wp-json/wp/v2/plugins"]) {
    const res = await json("GET", path);
    assert.equal(res.status, 200, `${path}: ${(await res.text()).slice(0, 200)}`);
  }
  // A collection row saved as the admin's editor saves it: core's route for the kind, fields in `meta`.
  const created = await json("POST", "/wp-json/wp/v2/tp_posts", { title: "From the admin", status: "draft", meta: { tags: ["news"] } });
  assert.equal(created.status, 201, await created.clone().text());
  const id = (await created.json()).id;
  const edited = await json("POST", `/wp-json/wp/v2/tp_posts/${id}`, { title: "Edited in the admin", meta: { tags: ["guide"] } });
  assert.equal(edited.status, 200, await edited.clone().text());
  assert.deepEqual((await edited.json()).meta.tags, ["guide"]);
  // A global, and core's settings, as the admin's settings screens save them.
  const global = await json("PATCH", "/__tp/api/v1/settings", { siteTitle: "Admin saved" });
  assert.equal(global.status, 200, await global.clone().text());
  const tagline = `Admin ${Date.now().toString(36)}`;
  const settings = await json("POST", "/wp-json/wp/v2/settings", { description: tagline });
  assert.equal((await settings.json()).description, tagline);
  // Deactivating and reactivating a plugin from the admin's plugins screen.
  const off = await json("POST", "/wp-json/wp/v2/plugins/two-factor/two-factor", { status: "inactive" });
  const on = await json("POST", "/wp-json/wp/v2/plugins/two-factor/two-factor", { status: "active" });
  assert.deepEqual([off.status, on.status], [200, 200]);
  await json("DELETE", `/wp-json/wp/v2/tp_posts/${id}?force=true`);
});

test("WordPress's /wp/v2/view-config is core's, and core's filter reaches TypedPress Admin's view config", async () => {
  // Core's route answers in core's shape (it was shadowed by TypedPress Admin's controller before).
  const core = await (await fetch(`${site}/wp-json/wp/v2/view-config?kind=root&name=user`, { headers: auth("admin") })).json();
  assert.deepEqual(Object.keys(core).sort(), ["default_layouts", "default_view", "form", "kind", "name", "version", "view_list"]);
  assert.equal(core.default_view.perPage, 37, "the harness plugin's patch through core's filter");
  // TypedPress Admin reads its own route, which runs the same filter over its configuration.
  const first = await (await fetch(`${site}/wp-json/typedpress-admin/v1/view-config?kind=root&name=user`, { headers: auth("admin") })).json();
  assert.equal(first.default_view.perPage, 37);
  assert.ok(first.tabs.some((t: { slug: string; label: string }) => t.slug === "harness" && t.label === "Harness tab"), JSON.stringify(first.tabs));
  // TypedPress Admin's own entries are still there.
  assert.ok(first.tabs.some((t: { slug: string }) => t.slug === "administrator"));
  assert.ok(Array.isArray(first.edit_form?.fields), "the user edit form survives the round trip");
});

test("a screen's capability gates its declaration, its classic page and its sidebar entry, for every role below it", async () => {
  wp("option", "delete", "tp_harness_admin_only_data");
  for (const role of ["editor", "subscriber"] as const) {
    const declaration = await fetch(`${site}/wp-json/typedpress-admin/v1/screens/test-admin-only`, { headers: auth(role) });
    assert.equal(declaration.status, 403, `${role}: the declaration`);
    const cookie = await loginCookie(site, role, `${site}/wp-admin/`);
    wp("transient", "delete", "pll_activation_redirect");
    const classic = await fetch(`${site}/wp-admin/tools.php?page=typedpress-screen-test-admin-only`, { headers: { cookie }, redirect: "manual" });
    assert.notEqual(classic.status, 200, `${role}: the classic page`);
    assert.doesNotMatch(await classic.text(), /Administrators only/);
    const page = await (await fetch(`${site}/wp-admin/new/`, { headers: { cookie } })).text();
    assert.doesNotMatch(page, /screen-test-admin-only/, `${role}: no sidebar entry`);
  }
  // Its `data` ran for nobody so far: it is evaluated only for users the capability lets in.
  assert.equal(wp("eval", "echo (int) get_option('tp_harness_admin_only_data', 0);"), "0");
  const admin = await (await fetch(`${site}/wp-json/typedpress-admin/v1/screens/test-admin-only`, { headers: auth("admin") })).json();
  assert.deepEqual(admin.data, ["Administrators only."]);
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/new/`);
  assert.match(await (await fetch(`${site}/wp-admin/new/`, { headers: { cookie } })).text(), /screen-test-admin-only/, "the administrator's sidebar has it");
});

test("table screens are named after the kind in kebab case, as its abilities are", async () => {
  const kinds = JSON.parse(wp("eval", "echo wp_json_encode(array_keys(array_filter(\\TypedPress\\Wp\\Runtime::plugin()->schema->collections(), fn ($c) => !isset($c['wp']['postType']) && empty($c['auth']) && ($c['api']['list'] ?? true) !== false && ($c['agents'] ?? true) !== false)));"));
  const camel = kinds.find((k: string) => /[A-Z_]/.test(k));
  assert.ok(camel, `the test app has a table kind that isn't one lowercase word: ${kinds}`);
  const kebab = camel.replace(/_/g, "-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const screen = await fetch(`${site}/wp-json/typedpress-admin/v1/screens/table-${kebab}`, { headers: auth("admin") });
  assert.equal(screen.status, 200, `table-${kebab}`);
  assert.equal((await screen.json()).view.ability, `blog/${kebab}-list`);
});

test("the app's own wp-admin menu entry opens its collections in TypedPress Admin; its table screens stay under it", async () => {
  const cookie = await loginCookie(site, "editor", `${site}/wp-admin/`);
  wp("transient", "delete", "pll_activation_redirect");
  const top = await fetch(`${site}/wp-admin/admin.php?page=typedpress-blog`, { headers: { cookie }, redirect: "manual" });
  assert.equal(top.status, 302, "the top-level entry is not an empty page");
  assert.equal(top.headers.get("location"), `${site}/wp-admin/new/collections`);
  const table = await fetch(`${site}/wp-admin/admin.php?page=typedpress-screen-table-comments`, { headers: { cookie }, redirect: "manual" });
  assert.equal(table.status, 200, "a table screen under the entry still renders");
  assert.match(await table.text(), /id="typedpress-admin-screen" data-screen-id="table-comments"/);
});

/** The JSON the page hands `init()`: the sidebar's menu items. */
async function sidebar(cookie: string): Promise<{ id: string; to: string; label: string; parent?: string }[]> {
  const html = await (await fetch(`${site}/wp-admin/new/`, { headers: { cookie } })).text();
  const m = html.match(/mod\.init\( (\[.*?\]), (\[.*?\]), (\[.*?\]), (\[.*?\]), (\{.*?\}) \)/s);
  assert.ok(m, "the page boots the app with its payload");
  return JSON.parse(m[2]);
}

test("without developer mode, a classic page opened as a page is framed in TypedPress Admin; the frame, scripts and editing are served as before", async () => {
  const admin = harness.users.admin.id;
  const mode = (on: boolean) => wp("eval", on ? `update_user_meta(${admin}, 'tp_admin_developer_mode', '1');` : `delete_user_meta(${admin}, 'tp_admin_developer_mode');`);
  mode(false);
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  wp("transient", "delete", "pll_activation_redirect");
  const open = (path: string, dest: string | null, method = "GET") =>
    fetch(`${site}/wp-admin/${path}`, { method, headers: { cookie, ...(dest ? { "sec-fetch-dest": dest } : {}) }, redirect: "manual" });
  for (const [path, to] of [
    ["", "/wp-admin/new/"],
    ["index.php", "/wp-admin/new/"],
    ["options-permalink.php", "/wp-admin/new/classic/options-permalink.php"],
    ["edit-comments.php?comment_status=moderated", "/wp-admin/new/classic/edit-comments.php%253Fcomment_status%253Dmoderated"],
    ["tools.php?page=typedpress-screen-test-admin-only", "/wp-admin/new/classic/tools.php%253Fpage%253Dtypedpress-screen-test-admin-only"],
  ]) {
    const response = await open(path, "document");
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("location"), `${site}${to}`, path);
  }
  // The frame's own request, a request that names no destination, and the pages that edit or upload are served.
  for (const [path, dest] of [["options-permalink.php", "iframe"], ["options-permalink.php", null], ["post-new.php", "document"], ["media-new.php", "document"], ["admin.php?page=typedpress-admin&p=%2F", "document"]] as const) {
    const response = await open(path, dest);
    assert.equal(response.status, 200, `${path} (${dest ?? "no Sec-Fetch-Dest"}): ${response.headers.get("location")}`);
  }
  assert.notEqual((await open("admin-ajax.php?action=heartbeat", "document", "POST")).status, 302, "admin-ajax.php is never redirected");
  // On, classic wp-admin opens as it is.
  mode(true);
  try {
    const response = await open("options-permalink.php", "document");
    assert.equal(response.status, 200);
    assert.match(await response.text(), /id="adminmenu"/);
  } finally {
    mode(false);
  }
});

test("developer mode is a user setting on core's user route, and decides whether the sidebar has Classic admin", async () => {
  const me = () => fetch(`${site}/wp-json/wp/v2/users/me?context=edit`, { headers: auth("editor") }).then((r) => r.json());
  assert.equal((await me()).tp_admin_developer_mode, false, "off by default");
  const cookie = await loginCookie(site, "editor", `${site}/wp-admin/new/`);
  assert.equal((await sidebar(cookie)).some((i) => i.id === "classic"), false, "no Classic admin without developer mode");
  const set = (on: boolean) => fetch(`${site}/wp-json/wp/v2/users/me`, { method: "POST", headers: { ...auth("editor"), "content-type": "application/json" }, body: JSON.stringify({ tp_admin_developer_mode: on }) });
  try {
    assert.equal((await set(true)).status, 200);
    assert.equal((await me()).tp_admin_developer_mode, true);
    const classic = (await sidebar(cookie)).find((i) => i.id === "classic");
    assert.equal(classic?.to, `${site}/wp-admin/`);
  } finally {
    assert.equal((await set(false)).status, 200);
  }
  assert.equal((await me()).tp_admin_developer_mode, false);
  // Another user's setting is theirs: an editor may not turn it on for the administrator.
  const other = await fetch(`${site}/wp-json/wp/v2/users/${harness.users.admin.id}`, { method: "POST", headers: { ...auth("editor"), "content-type": "application/json" }, body: JSON.stringify({ tp_admin_developer_mode: true }) });
  assert.notEqual(other.status, 200);
  assert.equal(wp("eval", `echo get_user_meta(${harness.users.admin.id}, 'tp_admin_developer_mode', true);`), "");
});

test("the classic route's earlier address /legacy/<slug> redirects to /classic/<slug>", async () => {
  const cookie = await loginCookie(site, "editor", `${site}/wp-admin/new/`);
  const pretty = await fetch(`${site}/wp-admin/new/legacy/options-media.php`, { headers: { cookie }, redirect: "manual" });
  assert.equal(pretty.status, 301);
  assert.equal(pretty.headers.get("location"), `${site}/wp-admin/new/classic/options-media.php`);
  const query = await fetch(`${site}/wp-admin/admin.php?page=typedpress-admin&p=${encodeURIComponent("/legacy/options-media.php")}`, { headers: { cookie }, redirect: "manual" });
  assert.equal(query.status, 301);
  assert.equal(new URL(query.headers.get("location")!).searchParams.get("p"), "/classic/options-media.php");
  // A bookmark with a query (a plugin page) keeps it, in the encoding the classic route reads.
  const plugin = await fetch(`${site}/wp-admin/new/legacy/admin.php%3Fpage%3Dtypedpress-identity%26tab%3Dclients`, { headers: { cookie }, redirect: "manual" });
  assert.equal(plugin.status, 301);
  assert.equal(plugin.headers.get("location"), `${site}/wp-admin/new/classic/admin.php%253Fpage%253Dtypedpress-identity%2526tab%253Dclients`);
  const pluginQuery = await fetch(`${site}/wp-admin/admin.php?page=typedpress-admin&p=${encodeURIComponent("/legacy/admin.php%3Fpage%3Dtypedpress-identity")}`, { headers: { cookie }, redirect: "manual" });
  assert.equal(pluginQuery.status, 301);
  assert.equal(new URL(pluginQuery.headers.get("location")!).searchParams.get("p"), "/classic/admin.php%253Fpage%253Dtypedpress-identity");
});

test("the sidebar reaches classic-only screens through /classic/ and leaves out what the app turned off", async () => {
  const items = await sidebar(await loginCookie(site, "admin", `${site}/wp-admin/new/`));
  const to = (id: string) => items.find((i) => i.id === id)?.to;
  // Settings pages TypedPress Admin has no screen for, and Tools, framed.
  for (const page of ["options-writing.php", "options-discussion.php", "options-media.php", "options-permalink.php", "options-privacy.php"]) {
    assert.equal(to(`settings-${page.replace(/[^a-z0-9_-]/g, "")}`), `/classic/${page}`, page);
  }
  assert.equal(items.some((i) => i.parent === "settings" && i.to === "/classic/options-general.php"), false, "General has its own screen");
  assert.equal(to("tools-site-healthphp"), "/classic/site-health.php");
  // The hardening switches refuse installs, file editors and the Customizer: none of them is offered.
  for (const item of items) {
    assert.doesNotMatch(item.to, /plugin-install\.php|theme-install\.php|theme-editor\.php|plugin-editor\.php|customize\.php|\/plugins\/install/, `${item.id} -> ${item.to}`);
  }
  // Comments: offered while the app takes them or the site has some, else left out.
  const relevant = JSON.parse(wp("eval", "echo wp_json_encode(tp_admin_comments_relevant());"));
  assert.equal(items.some((i) => i.id === "comments"), relevant);
});
