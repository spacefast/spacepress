// The zero-admin plugin on a WordPress installed below the origin root (lane A, design §2.4): the
// mount, wp-admin and login URLs it derives all carry the sub-path, so a direct route resolves and
// the legacy frame is pointed at the real wp-admin. The stack is ../admin/subdir-run.sh's; the
// receipt's url is http://host/blog.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, wp } from "../env.ts";

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
  assert.equal(wp("plugin", "get", "zero-admin", "--field=status"), "active");

  // A direct route under the mount is the plugin's, and anonymous visitors go to this site's login.
  const anon = await fetch(`${site}/zero-admin/media`, { redirect: "manual" });
  assert.equal(anon.status, 302);
  assert.ok(anon.headers.get("location")!.startsWith(`${site}/wp-login.php?`), `login lives under the sub-path: ${anon.headers.get("location")}`);

  // Signed in, the same URL serves the app, and the payload tells it where it is mounted and
  // where wp-admin is, both under /blog/.
  const page = await fetch(`${site}/zero-admin/media`, { headers: { cookie: await loginCookie(site, "editor", `${site}/zero-admin/media`) } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('id="zero-admin-app"'));
  const { context, menuItems } = bootPayload(html);
  assert.equal(context.mount_url, `${site}/zero-admin/`);
  assert.equal(context.admin_url, `${site}/wp-admin/`);
  assert.equal(context.logout_url && String(context.logout_url).startsWith(`${site}/wp-login.php?action=logout`), true);
  assert.ok(Array.isArray(menuItems));

  // A legacy menu route frames `<admin_url><slug>`: the base the page handed in reaches the real
  // wp-admin of this install, where the origin-root guess (`/wp-admin/`) would not.
  const adminUrl = String(context.admin_url);
  const framed = await fetch(new URL("options-media.php", adminUrl), { headers: { cookie: await loginCookie(site, "admin", `${site}/wp-admin/options-media.php`) }, redirect: "manual" });
  assert.equal(framed.status, 200, `the framed wp-admin page is served (got ${framed.status} -> ${framed.headers.get("location")})`);
  const guessed = await fetch(`${origin}/wp-admin/options-media.php`, { headers: { cookie: await loginCookie(site, "admin", `${site}/wp-admin/options-media.php`) }, redirect: "manual" });
  assert.notEqual(guessed.status, 200, "the origin-root guess is not this site's wp-admin");
});
