// The first-admin plugin on a WordPress installed below the origin root (lane A, design §2.4): the
// mount, wp-admin and login URLs it derives all carry the sub-path, so a direct route resolves and
// the classic frame is pointed at the real wp-admin. The stack is ../admin/subdir-run.sh's; the
// receipt's url is http://host/blog.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auth, harness, wp } from "../env.ts";

const site = harness.url;
const origin = new URL(site).origin;
const subdir = new URL(site).pathname.replace(/\/$/, "");

import { loginCookie } from "../login.ts";


/** The JSON the page hands `init()`: routes, menu items, meta menu items, init modules, context. */
function bootPayload(html: string): { menuItems: any[]; context: Record<string, unknown> } {
  const m = html.match(/mod\.init\( (\[.*?\]), (\[.*?\]), (\[.*?\]), (\[.*?\]), (\{.*?\}) \)/s);
  assert.ok(m, "the page boots the app with its payload");
  return { menuItems: JSON.parse(m[2]), context: JSON.parse(m[5]) };
}

test("the admin is installed below the site root and derives every URL from it", async () => {
  assert.equal(subdir, "/blog", "this lane runs WordPress at /blog");
  assert.equal(wp("plugin", "get", "first-admin", "--field=status"), "active");

  // WP-CLI activated the plugin; the first web request writes its rule into this install's .htaccess.
  assert.equal((await fetch(`${site}/`)).status, 200);
  // A direct route under the mount is the plugin's, and anonymous visitors go to this site's login.
  const anon = await fetch(`${site}/wp-admin/new/media`, { redirect: "manual" });
  assert.equal(anon.status, 302);
  assert.ok(anon.headers.get("location")!.startsWith(`${site}/wp-login.php?`), `login lives under the sub-path: ${anon.headers.get("location")}`);

  // Signed in, the same URL serves the app, and the payload tells it where it is mounted and
  // where wp-admin is, both under /blog/.
  const page = await fetch(`${site}/wp-admin/new/media`, { headers: { cookie: await loginCookie(site, "editor", `${site}/wp-admin/new/media`) } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('id="first-admin-app"'));
  const { context, menuItems } = bootPayload(html);
  assert.equal(context.mount_url, `${site}/wp-admin/new/`);
  assert.equal(context.admin_url, `${site}/wp-admin/`);
  assert.equal(context.logout_url && String(context.logout_url).startsWith(`${site}/wp-login.php?action=logout`), true);
  assert.ok(Array.isArray(menuItems));

  // Lazy editor assets use WordPress's registered base URL, including the install path.
  const assetsResponse = await fetch(`${site}/wp-json/wp/v2/editor/assets`, { headers: auth('admin') });
  assert.equal(assetsResponse.status, 200);
  const assets = await assetsResponse.json();
  const script = new URL(assets.scripts['wp-block-library'].src);
  assert.ok(script.pathname.startsWith(`${subdir}/wp-`), `editor asset keeps the site prefix: ${script}`);
  assert.equal((await fetch(script)).status, 200, 'the exported editor script is served');

  // A classic menu route (`/classic/<slug>`) frames `<admin_url><slug>`: the base the page handed in reaches the real
  // wp-admin of this install, where the origin-root guess (`/wp-admin/`) would not.
  const adminUrl = String(context.admin_url);
  const framed = await fetch(new URL("options-media.php", adminUrl), { headers: { cookie: await loginCookie(site, "admin", `${site}/wp-admin/options-media.php`) }, redirect: "manual" });
  assert.equal(framed.status, 200, `the framed wp-admin page is served (got ${framed.status} -> ${framed.headers.get("location")})`);
  const guessed = await fetch(`${origin}/wp-admin/options-media.php`, { headers: { cookie: await loginCookie(site, "admin", `${site}/wp-admin/options-media.php`) }, redirect: "manual" });
  assert.notEqual(guessed.status, 200, "the origin-root guess is not this site's wp-admin");
});

test("native user filters expose private fields only to account administrators", async () => {
  const suffix = Date.now().toString(36);
  const email = `hidden-${suffix}@example.test`;
  const firstName = `Private${suffix}`;
  const id = Number(wp("user", "create", `filter-${suffix}`, email, "--role=author", `--first_name=${firstName}`, "--display_name=Public author", "--porcelain"));
  const post = wp("post", "create", `--post_author=${id}`, "--post_title=Public author filter fixture", "--post_status=publish", "--porcelain");
  const users = async (query: Record<string, string>, headers: Record<string, string>) => {
    const response = await fetch(`${site}/wp-json/wp/v2/users?${new URLSearchParams({ include: String(id), ...query })}`, { headers });
    assert.equal(response.status, 200);
    const data: unknown = await response.json();
    assert.ok(Array.isArray(data));
    return data.map(user => {
      assert.ok(user && typeof user === "object" && "id" in user && typeof user.id === "number");
      return user.id;
    });
  };
  try {
    assert.deepEqual(await users({}, auth("subscriber")), [id]);
    // Signed out, the site lists no user at all, whatever the filter (the `authors` hardening switch).
    const anonymous = await fetch(`${site}/wp-json/wp/v2/users?${new URLSearchParams({ include: String(id), email_search: email })}`);
    assert.equal(anonymous.status, 401);
    const privateQueries: Record<string, string>[] = [
        { email_search: "not-this-author@example.test" },
        { email_search_not: email },
        { name_search: "Not this author" },
        { name_search_not: firstName },
        { registered_after: "2999-01-01" },
        { registered_before: "1900-01-01" },
    ];
    for (const query of privateQueries) assert.deepEqual(await users(query, auth("subscriber")), [id], JSON.stringify(query));
    assert.deepEqual(await users({ email_search: email }, auth("admin")), [id]);
    assert.deepEqual(await users({ email_search: "not-this-author@example.test" }, auth("admin")), []);
  } finally {
    wp("post", "delete", post, "--force");
    wp("user", "delete", String(id), "--yes");
  }
});
