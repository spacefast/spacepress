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

test("the build's manifest lists exactly what may run, and the site reports it is sealed", async () => {
  const listed = JSON.parse(wp("eval", "echo file_get_contents(WP_CONTENT_DIR . '/first-manifest.json') ?: '{}';") || "{}").sealed;
  const anonymous = (await (await fetch(`${site}/__first/api/v1`)).json()).data.runtime.wp.sealed;
  assert.deepEqual(anonymous, { enforced: "report" }, "a visitor learns only that the site is sealed");
  const report = (await (await fetch(`${site}/__first/api/v1`, { headers: auth("admin") })).json()).data.runtime.wp.sealed;
  assert.deepEqual(report.plugins, [], "every active plugin is listed");
  assert.equal(report.enforced, "report");
  assert.ok(listed.includes("hello-dolly") && listed.includes("first-runtime") && !listed.includes("akismet"), JSON.stringify(listed));
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
  // The declared plugin activates on every path.
  wp("plugin", "deactivate", "hello-dolly");
  const listed = await json(auth("admin"), "POST", "/wp-json/wp/v2/plugins/hello-dolly/hello", { status: "active" });
  assert.equal(listed.status, 200, await listed.text());
  assert.ok(active().includes("hello-dolly"));
});

test("code already loaded and not listed is reported, never deactivated or removed", async () => {
  // Activate an unlisted plugin around sealed mode (the option, as a migration or another tool would).
  wp("eval", "$a = get_option('active_plugins'); $a[] = 'akismet/akismet.php'; update_option('active_plugins', $a);");
  try {
    const report = (await (await fetch(`${site}/__first/api/v1`, { headers: auth("admin") })).json()).data.runtime.wp.sealed;
    assert.deepEqual(report.plugins, ["akismet/akismet.php"]);
    assert.ok(report.muPlugins.length > 0, "the test stack's own mu-plugins are reported");
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
    const sealed = JSON.parse(doctor(`admin:${harness.users.admin.appPassword}`)).data.checks.find((c: any) => c.name === "sealed");
    assert.equal(sealed.ok, false, JSON.stringify(sealed));
    assert.match(sealed.detail, /akismet\/akismet\.php/);
    const anonymous = JSON.parse(doctor("")).data.checks.find((c: any) => c.name === "sealed");
    assert.match(anonymous.detail, /sign in as an administrator/);
  } finally {
    wp("eval", "update_option('active_plugins', array_values(array_diff(get_option('active_plugins'), ['akismet/akismet.php'])));");
  }
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
