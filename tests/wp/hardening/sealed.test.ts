// Sealed mode (docs/sealed.md) on real WordPress/MariaDB: an app built with `sealed: true` and one
// declared plugin (hello-dolly). WordPress's image ships two plugins nobody declared: Akismet and the
// single-file Hello Dolly (`hello.php`). Every activation path refuses them, everything already loaded
// and not declared is reported (never deactivated or deleted), and a host can enforce the list.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { auth, harness, wp, wpTry } from "../env.ts";
import { loginCookie } from "../login.ts";

const site = harness.url;
const active = () => JSON.parse(wp("plugin", "list", "--status=active", "--field=name", "--format=json")) as string[];
const json = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
  fetch(`${site}${path}`, { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });

const LISTED = ["action-scheduler", "first-admin", `first-app-${harness.plugin.replace(/^first-app-/, "")}`, "first-identity", "first-runtime", "hello-dolly", "mcp-adapter", "secure-custom-fields", "two-factor"];

test("the build's manifest and the running app hold the same list, exactly; the site reports it is sealed", async () => {
  const listed = JSON.parse(wp("eval", "echo file_get_contents(WP_CONTENT_DIR . '/first-manifest.json') ?: '{}';") || "{}").sealed;
  // No locales, so no Polylang. First's admin is listed though this build doesn't ship it.
  assert.deepEqual(listed, LISTED);
  assert.deepEqual(JSON.parse(wp("eval", "echo wp_json_encode(First\\Wp\\Runtime::plugin()->schema->sealed());")), LISTED, "schema.php carries the same list");
  // Which plugin files count as listed: a listed directory's main file, and nothing shaped otherwise.
  const allows = (file: string) => wp("eval", `echo wp_json_encode(First\\Wp\\Sealed::allows('${file}'));`) === "true";
  assert.deepEqual(
    ["hello-dolly/hello.php", "first-runtime/first-runtime.php", "hello-dolly.php", "hello.php", "two-factor.php", "hello-dolly/sub/evil.php", "hello-dolly/../akismet/akismet.php", "Hello-Dolly/hello.php", "polylang/polylang.php", "first-admin/first-admin.php", "akismet/akismet.php"].map(allows),
    [true, true, false, false, false, false, false, false, false, true, false],
  );
  const anonymous = (await (await fetch(`${site}/__first/api/v1`)).json()).data.runtime.wp.sealed;
  assert.deepEqual(anonymous, { enforced: "report" }, "a visitor learns only that the site is sealed");
  const report = (await (await fetch(`${site}/__first/api/v1`, { headers: auth("admin") })).json()).data.runtime.wp.sealed;
  assert.deepEqual(report.plugins, [], "every active plugin is listed");
  assert.equal(report.enforced, "report");
  assert.deepEqual([report.dropins, report.networkPlugins], [[], []]);
  assert.ok(report.theme.some((t: string) => /\/patterns\/\*\.php \(\d+\)$/.test(t)), JSON.stringify(report.theme));
});

test("activating an unlisted plugin is refused on every path; a listed one activates", async () => {
  // WP-CLI: no operator exception, the list is the config.
  const cli = wpTry("plugin", "activate", "akismet");
  assert.doesNotMatch(cli, /Success/);
  assert.equal(active().includes("akismet"), false);
  wpTry("plugin", "activate", "hello");
  assert.equal(active().includes("hello"), false, "a single-file plugin too");
  // REST, as the administrator, in every request form.
  for (const path of ["/wp-json/wp/v2/plugins/akismet/akismet", "/?rest_route=/wp/v2/plugins/akismet/akismet", "/wp-json/WP/V2/Plugins/akismet/akismet/"]) {
    const res = await json(auth("admin"), "POST", path, { status: "active" });
    assert.equal(res.status, 403, `${path}: ${await res.text()}`);
  }
  const overridden = await json(auth("admin"), "GET", "/wp-json/wp/v2/plugins/akismet/akismet?_method=POST&status=active");
  assert.equal(overridden.status, 403);
  const batch = await json(auth("admin"), "POST", "/wp-json/batch/v1", { requests: [{ method: "POST", path: "/wp/v2/plugins/akismet/akismet", body: { status: "active" } }] });
  assert.ok(!(await batch.text()).includes('"status":"active"'));
  // wp-admin: no Activate link, and the activate URL itself is refused.
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  const screen = await (await fetch(`${site}/wp-admin/plugins.php`, { headers: { cookie } })).text();
  assert.doesNotMatch(screen, /action=activate&amp;plugin=akismet/);
  assert.match(screen, /Sealed: not in first.config.ts/);
  const nonce = wp("eval", "wp_set_current_user(1); echo wp_create_nonce('activate-plugin_akismet/akismet.php');");
  const refused = await fetch(`${site}/wp-admin/plugins.php?action=activate&plugin=akismet%2Fakismet.php&_wpnonce=${nonce}`, { headers: { cookie }, redirect: "manual" });
  assert.notEqual(refused.headers.get("location")?.includes("activate=true"), true);
  assert.equal(active().includes("akismet"), false);
  // The declared plugin deactivates and activates again, over REST.
  const off = await json(auth("admin"), "POST", "/wp-json/wp/v2/plugins/hello-dolly/hello", { status: "inactive" });
  assert.equal(off.status, 200, await off.text());
  assert.equal(active().includes("hello-dolly"), false);
  const listed = await json(auth("admin"), "POST", "/wp-json/wp/v2/plugins/hello-dolly/hello", { status: "active" });
  assert.equal(listed.status, 200, await listed.text());
  assert.ok(active().includes("hello-dolly"));
});

test("a plugin a sealed site never runs is refused whatever the list says, and reported when it is already active", async () => {
  const file = "vip-block-data-api/vip-block-data-api.php";
  // Even with a list that names it (written by something other than the compiler, which refuses to).
  const allows = wp("eval", `$s = new ReflectionProperty(First\\Wp\\Sealed::class, 'allowed'); $was = $s->getValue(); $s->setValue(null, First\\Wp\\Sealed::listed(['vip-block-data-api', 'vip-decoupled-bundle', 'hello-dolly'])); echo wp_json_encode([First\\Wp\\Sealed::allows('${file}'), First\\Wp\\Sealed::allows('vip-decoupled-bundle/vip-decoupled.php'), First\\Wp\\Sealed::allows('hello-dolly/hello.php')]); $s->setValue(null, $was);`);
  assert.deepEqual(JSON.parse(allows), [false, false, true]);
  // Every activation path, as for any unlisted plugin, with a message that says why.
  assert.doesNotMatch(wpTry("plugin", "activate", "vip-block-data-api"), /Success/);
  // What `activate_plugin()` answers on every path (WP-CLI prints it on stderr, wp-admin on a page).
  const refusal = wp("eval", `require_once ABSPATH . 'wp-admin/includes/plugin.php'; $r = activate_plugin('${file}'); echo is_wp_error($r) ? $r->get_error_code() . ': ' . $r->get_error_message() : 'activated';`);
  assert.match(refusal, /^first_sealed: Refused: .*a sealed site never runs vip-block-data-api\/vip-block-data-api\.php: it serves stored content around First's read rules/);
  const rest = await json(auth("admin"), "POST", "/wp-json/wp/v2/plugins/vip-block-data-api/vip-block-data-api", { status: "active" });
  assert.equal(rest.status, 403, await rest.text());
  assert.equal(active().includes("vip-block-data-api"), false);
  assert.equal((await fetch(`${site}/wp-json/vip-block-data-api/v1/posts/1/blocks`)).status, 404, "its route doesn't exist");
  // Activated around sealed mode: it runs (a plain host can't stop a plugin WordPress loads), and
  // the report and `first doctor` name it.
  wp("eval", `$a = get_option('active_plugins'); $a[] = '${file}'; update_option('active_plugins', $a);`);
  try {
    assert.equal((await fetch(`${site}/wp-json/vip-block-data-api/v1/posts/1/blocks`)).status, 200);
    const report = (await (await fetch(`${site}/__first/api/v1`, { headers: auth("admin") })).json()).data.runtime.wp.sealed;
    assert.deepEqual(report.plugins, [file]);
    // A host that enforces the list never loads it.
    const hosted = wp("eval", `require_once WP_CONTENT_DIR . '/first-loader.php'; echo wp_json_encode(First\\Loader\\Loader::allowedPlugins(['${file}', 'first-runtime/first-runtime.php'], ['vip-block-data-api', 'first-runtime']));`);
    assert.deepEqual(JSON.parse(hosted), ["first-runtime/first-runtime.php"]);
  } finally {
    wp("eval", `update_option('active_plugins', array_values(array_diff(get_option('active_plugins'), ['${file}'])));`);
  }
});

test("the plugins the app runs on can't be deactivated from wp-admin or REST, so the list can't be switched off there", async () => {
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  const screen = await (await fetch(`${site}/wp-admin/plugins.php`, { headers: { cookie } })).text();
  for (const [slug, file] of [["first-runtime", "first-runtime"], [harness.plugin, harness.plugin], ["two-factor", "two-factor"], ["secure-custom-fields", "secure-custom-fields"]]) {
    const res = await json(auth("admin"), "POST", `/wp-json/wp/v2/plugins/${slug}/${file}`, { status: "inactive" });
    assert.equal(res.status, 403, `${slug}: ${await res.text()}`);
    assert.doesNotMatch(screen, new RegExp(`action=deactivate&amp;plugin=${slug}%2F`), `no Deactivate link for ${slug}`);
    const nonce = wp("eval", `wp_set_current_user(1); echo wp_create_nonce('deactivate-plugin_${slug}/${file}.php');`);
    await fetch(`${site}/wp-admin/plugins.php?action=deactivate&plugin=${slug}%2F${file}.php&_wpnonce=${nonce}`, { headers: { cookie }, redirect: "manual" });
  }
  assert.match(screen, /Sealed: required/);
  const now = active();
  for (const slug of ["first-runtime", harness.plugin, "two-factor", "secure-custom-fields"]) assert.ok(now.includes(slug), `${slug} is still active`);
  // After those attempts the refusal still stands.
  assert.equal((await json(auth("admin"), "POST", "/wp-json/wp/v2/plugins/akismet/akismet", { status: "active" })).status, 403);
});

test("First's admin is First's own: a sealed site activates it though the build doesn't ship it, and it saves through REST", async () => {
  // Installed beside the build (sealed-run.sh), not declared, and `admin: true` isn't set.
  assert.equal(active().includes("first-admin"), false);
  const on = await json(auth("admin"), "POST", "/wp-json/wp/v2/plugins/first-admin/first-admin", { status: "active" });
  assert.equal(on.status, 200, await on.text());
  try {
    assert.ok(active().includes("first-admin"));
    const report = (await (await fetch(`${site}/__first/api/v1`, { headers: auth("admin") })).json()).data.runtime.wp.sealed;
    assert.deepEqual(report.plugins, [], "it isn't reported as unlisted");
    // Its own routes answer, and a save it makes through core's routes isn't the schema lock's to
    // refuse: a row of a First kind created and edited as the admin's editor does.
    for (const route of ["/wp-json/wp/v2/view-config?kind=postType&name=first_notes", "/wp-json/wp/v2/field-collections?kind=postType&name=first_notes", "/wp-json/wp/v2/editor"]) {
      const res = await json(auth("admin"), "GET", route);
      assert.ok(res.status < 500 && res.status !== 403, `${route}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const created = await json(auth("admin"), "POST", "/wp-json/wp/v2/first_notes", { title: "From the admin", status: "publish", meta: { mood: "calm" } });
    assert.equal(created.status, 201, await created.clone().text());
    const id = (await created.json()).id;
    const edited = await json(auth("admin"), "POST", `/wp-json/wp/v2/first_notes/${id}`, { title: "Edited in the admin", meta: { mood: "bright" } });
    const row = await edited.json();
    assert.deepEqual([edited.status, row.title.raw ?? row.title.rendered, row.meta.mood], [200, "Edited in the admin", "bright"]);
    // And the saves its screens make through First's API: a row, and a global's values.
    const viaApi = await json(auth("admin"), "PATCH", `/__first/api/v1/notes/${id}`, { mood: "steady" });
    assert.equal((await viaApi.json()).data.mood, "steady");
    const global = await json(auth("admin"), "PATCH", "/__first/api/v1/banner", { motto: "From the admin" });
    assert.equal((await global.json()).data.motto, "From the admin");
    // The admin's page is served, in the form every server serves (`/wp-admin/new/` is the same
    // page through a rewrite rule written on a later request).
    const mount = `${site}/wp-admin/admin.php?page=first-admin&p=%2F`;
    const cookie = await loginCookie(site, "admin", mount);
    const page = await fetch(mount, { headers: { cookie }, redirect: "manual" });
    assert.equal(page.status, 200, String(page.headers.get("location")));
    assert.ok((await page.text()).includes('id="first-admin-app"'));
    // It isn't one of the plugins the site can't run without: it deactivates, classic wp-admin stays.
    const off = await json(auth("admin"), "POST", "/wp-json/wp/v2/plugins/first-admin/first-admin", { status: "inactive" });
    assert.equal(off.status, 200, await off.text());
  } finally {
    wpTry("plugin", "deactivate", "first-admin");
  }
});

test("code already loaded and not listed is reported, never deactivated or removed", async () => {
  // Activate an unlisted plugin around sealed mode (the option, as a migration or another tool would).
  wp("eval", "$a = get_option('active_plugins'); $a[] = 'akismet/akismet.php'; update_option('active_plugins', $a);");
  try {
    const report = (await (await fetch(`${site}/__first/api/v1`, { headers: auth("admin") })).json()).data.runtime.wp.sealed;
    assert.deepEqual(report.plugins, ["akismet/akismet.php"]);
    assert.ok(report.muPlugins.length > 0, "the test stack's own must-use plugins are listed");
    assert.ok(report.theme.some((t: string) => t.endsWith("/functions.php")), JSON.stringify(report.theme));
    // It is still active: First stops and removes nothing.
    assert.ok(active().includes("akismet"));
    const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
    const dashboard = await (await fetch(`${site}/wp-admin/`, { headers: { cookie } })).text();
    assert.match(dashboard, /This site is sealed/);
    assert.match(dashboard, /akismet\/akismet\.php/);
    // first doctor fails on it, naming it, signed in with the administrator's application password.
    const doctor = (password: string) => {
      try {
        return execFileSync(process.env.FIRST_BIN!, ["doctor", process.env.FIRST_SEALED_APP!, "--site", site, "--json"], { encoding: "utf8", env: { ...process.env, FIRST_TOKEN: "", FIRST_APP_PASSWORD: password } });
      } catch (e: any) {
        return String(e.stdout); // doctor exits 1 when a check fails
      }
    };
    const checks = JSON.parse(doctor(`admin:${harness.users.admin.appPassword}`)).data.checks;
    const sealed = checks.find((c: any) => c.name === "sealed");
    assert.equal(sealed.ok, false, JSON.stringify(sealed));
    assert.match(sealed.detail, /akismet\/akismet\.php/);
    assert.doesNotMatch(sealed.detail, /functions\.php|first-harness/, "must-use plugins and theme PHP don't fail the check");
    const anonymous = JSON.parse(doctor("")).data.checks.find((c: any) => c.name === "sealed");
    assert.deepEqual([anonymous.ok, /sign in as an administrator/.test(anonymous.detail)], [false, true]);
  } finally {
    wp("eval", "update_option('active_plugins', array_values(array_diff(get_option('active_plugins'), ['akismet/akismet.php'])));");
  }
  // With every active plugin listed, doctor's sealed check passes, though the stack has must-use
  // plugins and a theme with PHP: those are listed for information.
  const out = (() => {
    try {
      return execFileSync(process.env.FIRST_BIN!, ["doctor", process.env.FIRST_SEALED_APP!, "--site", site, "--json"], { encoding: "utf8", env: { ...process.env, FIRST_TOKEN: "", FIRST_APP_PASSWORD: `admin:${harness.users.admin.appPassword}` } });
    } catch (e: any) {
      return String(e.stdout);
    }
  })();
  const checks = JSON.parse(out).data.checks;
  assert.equal(checks.find((c: any) => c.name === "sealed").ok, true, JSON.stringify(checks.find((c: any) => c.name === "sealed")));
  const other = checks.find((c: any) => c.name === "sealed: other code WordPress loads");
  assert.deepEqual([other.ok, /functions\.php/.test(other.detail), /first-harness/.test(other.detail)], [true, true, true]);
  const cookie = await loginCookie(site, "admin", `${site}/wp-admin/`);
  assert.doesNotMatch(await (await fetch(`${site}/wp-admin/`, { headers: { cookie } })).text(), /This site is sealed/, "no notice when every active plugin is listed");
});

test("a host enforces the list before any plugin loads", async () => {
  // tests/wp/hardening/sealed-host.php does what a host does: the loader, the build's list, a filter
  // on active_plugins before WordPress reads it. Akismet is active in the option, and never loads.
  wp("eval", `copy('${process.env.FIRST_SEALED_HOST}', WPMU_PLUGIN_DIR . '/first-sealed-host.php');`);
  wp("eval", "$a = get_option('active_plugins', [], false); $a[] = 'akismet/akismet.php'; remove_all_filters('option_active_plugins'); update_option('active_plugins', $a);");
  try {
    const report = (await (await fetch(`${site}/__first/api/v1`, { headers: auth("admin") })).json()).data.runtime.wp.sealed;
    assert.equal(report.enforced, "host");
    assert.deepEqual(report.plugins, [], "the host's filter kept it out");
    const loaded = await (await fetch(`${site}/wp-json/`)).json();
    assert.equal(loaded.namespaces.includes("akismet/v1"), false, "Akismet's code never ran");
    assert.ok(loaded.namespaces.includes("first-identity/v1"), "First's own plugins still load");
    // WordPress writes the option back when a plugin is activated or deactivated: the entry the
    // host's filter hides stays stored.
    await json(auth("admin"), "POST", "/wp-json/wp/v2/plugins/hello-dolly/hello", { status: "inactive" });
    await json(auth("admin"), "POST", "/wp-json/wp/v2/plugins/hello-dolly/hello", { status: "active" });
    const stored = wp("eval", "global $wpdb; echo $wpdb->get_var(\"SELECT option_value FROM $wpdb->options WHERE option_name = 'active_plugins'\");");
    assert.match(stored, /akismet\/akismet\.php/, "sealing hides it; it is not removed from the stored list");
    assert.match(stored, /hello-dolly\/hello\.php/);
  } finally {
    wp("eval", "unlink(WPMU_PLUGIN_DIR . '/first-sealed-host.php');");
    wp("eval", "update_option('active_plugins', array_values(array_diff(get_option('active_plugins'), ['akismet/akismet.php'])));");
  }
  // Without the host's filter Akismet would load: the control.
  wp("eval", "$a = get_option('active_plugins'); $a[] = 'akismet/akismet.php'; update_option('active_plugins', $a);");
  try {
    assert.ok((await (await fetch(`${site}/wp-json/`)).json()).namespaces.includes("akismet/v1"));
  } finally {
    wp("eval", "update_option('active_plugins', array_values(array_diff(get_option('active_plugins'), ['akismet/akismet.php'])));");
  }
});

test("network activation of an unlisted plugin is refused through the same check", () => {
  // Single-site here: WordPress's network path calls the same activate_plugin() with $network_wide.
  const result = wp("eval", "require_once ABSPATH . 'wp-admin/includes/plugin.php'; wp_set_current_user(1); $r = activate_plugin('akismet/akismet.php', '', true); echo is_wp_error($r) ? $r->get_error_code() : 'activated';");
  assert.equal(result, "first_sealed");
});
