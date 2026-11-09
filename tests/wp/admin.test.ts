// The optional admin plugin as `first build` ships it (design §2.2, §2.5): the test app opts in with
// `admin: true`, so the artifact carries `first-admin` and the harness activates it after the app.
// What this proves is the packaging: the plugin is active, serves its page under /first-admin/ to
// signed-in users only, and the page loads the committed build rather than an empty shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { harness, wp } from "./env.ts";

const site = harness.url;
const content = fileURLToPath(new URL("./.wp-content/", import.meta.url));

import { loginCookie } from "./login.ts";


test("the built artifact ships first-admin and the harness activated it after the app", () => {
  const manifest = JSON.parse(readFileSync(`${content}first-manifest.json`, "utf8"));
  assert.equal(manifest.plugins["first-admin"], manifest.zero, "the admin plugin is versioned with the compiler");
  const status = JSON.parse(wp("plugin", "list", "--format=json", "--fields=name,status,version"));
  const admin = status.find((p: any) => p.name === "first-admin");
  assert.deepEqual([admin?.status, admin?.version], ["active", manifest.zero]);
  // Activation registered and persisted the one rewrite rule, so pretty URLs reach the app.
  assert.equal(wp("option", "get", "first_admin_rewrite"), manifest.zero);
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

test("/first-admin/ asks anonymous visitors to sign in and serves the committed build to users", async () => {
  const anon = await fetch(`${site}/first-admin/`, { redirect: "manual" });
  assert.equal(anon.status, 302);
  assert.ok(anon.headers.get("location")!.startsWith(`${site}/wp-login.php?`), anon.headers.get("location")!);
  const deepLink = `${site}/first-admin/collections/posts?search=Draft`;
  const deep = await fetch(deepLink, { redirect: "manual" });
  assert.equal(deep.status, 302);
  assert.equal(new URL(deep.headers.get("location")!).searchParams.get("redirect_to"), deepLink);

  for (const role of ["editor", "subscriber"] as const) {
    const cookie = await loginCookie(site, role);
    assert.equal(/(?:^|; )wordpress_(?:sec_)?[a-f0-9]+=/.test(cookie), false, 'frontend does not receive admin-scoped cookies');
    const page = await fetch(`${site}/first-admin/`, { headers: { cookie } });
    assert.equal(page.status, 200, `${role} is served the page`);
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
});
