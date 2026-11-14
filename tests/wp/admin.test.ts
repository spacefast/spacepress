// First Admin as `first build` ships it to every app (docs/admin.md): the artifact carries
// `first-admin` and the harness activates it after the app. What this proves: the plugin is active,
// serves its page at the upstream mount /wp-admin/new/ to signed-in users only, loads the committed
// build rather than an empty shell, lands users there after login, keeps classic wp-admin, and
// redirects the earlier /first-admin/ address.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { auth, harness, wp } from "./env.ts";

const site = harness.url;
const content = fileURLToPath(new URL("./.wp-content/", import.meta.url));

import { loginCookie } from "./login.ts";


test("the built artifact ships first-admin and the harness activated it after the app", () => {
  const manifest = JSON.parse(readFileSync(`${content}first-manifest.json`, "utf8"));
  assert.equal(manifest.plugins["first-admin"], manifest.first, "the admin plugin is versioned with the compiler");
  const status = JSON.parse(wp("plugin", "list", "--format=json", "--fields=name,status,version"));
  const admin = status.find((p: any) => p.name === "first-admin");
  assert.deepEqual([admin?.status, admin?.version], ["active", manifest.first]);
  // Plugins may enqueue an admin asset before REST has registered its handle.
  const assets = JSON.parse(wp("eval", `
    wp_set_current_user(${harness.users.admin.id});
    wp_deregister_script('wp-color-picker');
    wp_deregister_style('wp-color-picker');
    wp_register_script('wp-color-picker', '/wp-admin/js/color-picker.min.js', ['iris'], 'plugin-kept', true);
    wp_add_inline_script('wp-color-picker', 'window.firstPickerConfig = true;', 'before');
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
  assert.match(assets.data.inline_scripts.before['wp-color-picker'], /window.firstPickerConfig = true/);
});

test("/wp-admin/new/ asks anonymous visitors to sign in and serves the committed build to users", async () => {
  // WP-CLI activated the plugin; the first web request writes the rule into .htaccess.
  assert.equal((await fetch(`${site}/`)).status, 200);
  assert.equal(wp("option", "get", "first_admin_rewrite"), JSON.parse(readFileSync(`${content}first-manifest.json`, "utf8")).first);
  assert.match(wp("eval", "echo file_get_contents(ABSPATH . '.htaccess');"), /^RewriteRule \^wp-admin\/new\(\/\.\*\)\?\$ \/?wp-admin\/admin\.php\?page=first-admin \[L\]$/m);
  const anon = await fetch(`${site}/wp-admin/new/`, { redirect: "manual" });
  assert.equal(anon.status, 302);
  assert.ok(anon.headers.get("location")!.startsWith(`${site}/wp-login.php?`), anon.headers.get("location")!);
  const deepLink = `${site}/wp-admin/new/collections/posts?search=Draft`;
  const deep = await fetch(deepLink, { redirect: "manual" });
  assert.equal(deep.status, 302);
  assert.equal(new URL(deep.headers.get("location")!).searchParams.get("redirect_to"), deepLink);

  for (const role of ["editor", "subscriber"] as const) {
    const cookie = await loginCookie(site, role, `${site}/wp-admin/new/`);
    for (const url of [`${site}/wp-admin/new/`, `${site}/wp-admin/new/collections/posts`, `${site}/wp-admin/admin.php?page=first-admin&p=%2Fcollections%2Fposts`]) {
      const page = await fetch(url, { headers: { cookie }, redirect: "manual" });
      assert.equal(page.status, 200, `${role} is served ${url}`);
      assert.match(page.headers.get('cache-control') ?? '', /no-cache|no-store/);
      const html = await page.text();
      assert.ok(html.includes('id="first-admin-app"'), `${role} gets the app shell`);
      // The import map names the built boot module from the plugin's own build directory: the page
      // runs the committed bundle, not the pre-build shell.
      const importMap = html.match(/<script[^>]*type="importmap"[^>]*>(.*?)<\/script>/s);
      assert.ok(importMap, `${role}: the page carries an import map`);
      const imports = JSON.parse(importMap[1]).imports as Record<string, string>;
      assert.match(imports["@first-admin/boot"], /\/plugins\/first-admin\/build\/packages\/boot\/index\.js(\?|$)/);
    }
    // wp-admin's menu entry without a route goes to the mount.
    const menu = await fetch(`${site}/wp-admin/admin.php?page=first-admin`, { headers: { cookie }, redirect: "manual" });
    assert.equal(menu.status, 302);
    assert.equal(menu.headers.get("location"), `${site}/wp-admin/new/`);
    // Classic wp-admin is unchanged. (Polylang sends the first wp-admin load after its activation
    // to its setup wizard; this asks for a page, so take that one-time redirect out of the way.)
    wp("transient", "delete", "pll_activation_redirect");
    const classic = await fetch(`${site}/wp-admin/profile.php`, { headers: { cookie }, redirect: "manual" });
    assert.equal(classic.status, 200, `${role} keeps classic wp-admin`);
    assert.match(await classic.text(), /id="adminmenu"/);
  }
});

test("signing in lands on First Admin unless the visitor asked for another page", async () => {
  const signIn = (redirect?: string) => fetch(`${site}/wp-login.php`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: "wordpress_test_cookie=WP%20Cookie%20check" },
    body: new URLSearchParams({ log: "editor", pwd: "first-test-editor", testcookie: "1", ...(redirect === undefined ? {} : { redirect_to: redirect }) }),
  });
  for (const redirect of [undefined, `${site}/wp-admin/`]) {
    const response = await signIn(redirect);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${site}/wp-admin/new/`, `redirect_to ${redirect ?? "absent"}`);
  }
  for (const redirect of [`${site}/wp-admin/edit.php`, `${site}/`]) {
    assert.equal((await signIn(redirect)).headers.get("location"), redirect, "an asked-for page is kept");
  }
});

test("the earlier /first-admin/ address redirects to the same route at /wp-admin/new/", async () => {
  for (const [from, to] of [
    ["/first-admin", "/wp-admin/new/"],
    ["/first-admin/", "/wp-admin/new/"],
    ["/first-admin/collections/posts?search=Draft", "/wp-admin/new/collections/posts?search=Draft"],
  ]) {
    const response = await fetch(`${site}${from}`, { redirect: "manual" });
    assert.equal(response.status, 301, from);
    assert.equal(response.headers.get("location"), `${site}${to}`, from);
  }
});

test("a declared screen: its declaration is served to users who may open it, with each action's method", async () => {
  const anon = await fetch(`${site}/wp-json/first-admin/v1/screens/test-comments`);
  assert.equal(anon.status, 401);
  assert.equal((await fetch(`${site}/wp-json/first-admin/v1/screens/nope`, { headers: auth("admin") })).status, 404);
  const response = await fetch(`${site}/wp-json/first-admin/v1/screens/test-comments`, { headers: auth("subscriber") });
  assert.equal(response.status, 200);
  const screen = await response.json();
  assert.equal(screen.title, "Comment review");
  assert.deepEqual(screen.view.fields.map((f: { id: string }) => f.id), ["name", "body", "approved"]);
  // The method comes from the ability's annotations: an update runs over POST.
  assert.deepEqual(screen.actions.map((a: { id: string; method: string }) => [a.id, a.method]), [["approve", "POST"]]);
  assert.deepEqual(screen.data, ["Approving a comment publishes it."]);
  // WordPress 7.2 keeps fields and actions per entity in its own registries: when the running
  // WordPress has them, the screen's are registered there (entity firstAdminScreen/<id>) and read
  // back from there; on 7.1 the declaration is the registry. Either way the screen is the same.
  const core = JSON.parse(wp("eval", "echo wp_json_encode(['fields' => function_exists('wp_register_entity_fields'), 'actions' => function_exists('wp_register_entity_actions')]);"));
  assert.deepEqual(screen.registry, { fields: core.fields ? "core" : "first-admin", actions: core.actions ? "core" : "first-admin" });
  if (core.fields) {
    const registered = await (await fetch(`${site}/wp-json/wp/v2/entity-fields?kind=firstAdminScreen&name=test-comments`, { headers: auth("editor") })).json();
    assert.deepEqual(registered.fields.map((f: { id: string; origin: { registeredBy: string } }) => [f.id, f.origin.registeredBy]), [["name", "first-admin"], ["body", "first-admin"], ["approved", "first-admin"]]);
  }
  if (core.actions) {
    const registered = await (await fetch(`${site}/wp-json/wp/v2/entity-actions?kind=firstAdminScreen&name=test-comments`, { headers: auth("editor") })).json();
    assert.deepEqual(registered.actions.map((a: { id: string; ability: string }) => [a.id, a.ability]), [["approve", "blog/comments-update"]]);
  }
  // Each table kind is a screen too, with delete bound to the kind's delete ability; the method is
  // whatever that ability's annotations make core's run route require.
  const table = await (await fetch(`${site}/wp-json/first-admin/v1/screens/table-comments`, { headers: auth("admin") })).json();
  assert.equal(table.view.ability, "blog/comments-list");
  const annotations = JSON.parse(wp("eval", "echo wp_json_encode(wp_get_ability('blog/comments-delete')->get_meta_item('annotations'));"));
  const method = annotations.destructive && annotations.idempotent ? "DELETE" : "POST";
  assert.deepEqual(table.actions.map((a: { ability: string; method: string }) => [a.ability, a.method]), [["blog/comments-delete", method]]);
  // Classic wp-admin registered a page for each, under the declared parent.
  const pages = JSON.parse(wp("eval", `
    wp_set_current_user(${harness.users.admin.id});
    require_once ABSPATH . 'wp-admin/includes/admin.php';
    set_current_screen('dashboard');
    global $menu, $submenu, $_wp_submenu_nopriv;
    $menu = []; $submenu = [];
    do_action('admin_menu', '');
    echo wp_json_encode(['comments' => array_column($submenu['edit-comments.php'] ?? [], 2), 'app' => array_column($submenu['first-blog'] ?? [], 2)]);
  `));
  assert.ok(pages.comments.includes("first-screen-test-comments"), JSON.stringify(pages));
  assert.ok(pages.app.includes("first-screen-table-comments"), JSON.stringify(pages));
});
