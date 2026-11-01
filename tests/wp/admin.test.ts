// The optional admin plugin as `zero build` ships it (design §2.2, §2.5): the test app opts in with
// `admin: true`, so the artifact carries `zero-admin` and the harness activates it after the app.
// What this proves is the packaging: the plugin is active, serves its page under /zero-admin/ to
// signed-in users only, and the page loads the committed build rather than an empty shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { harness, wp } from "./env.ts";

const site = harness.url;
const content = fileURLToPath(new URL("./.wp-content/", import.meta.url));

/** A WordPress login cookie for a harness user, as a browser would carry it. */
async function loginCookie(role: "editor" | "subscriber"): Promise<string> {
  const res = await fetch(`${site}/wp-login.php`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: "wordpress_test_cookie=WP%20Cookie%20check" },
    body: new URLSearchParams({ log: role, pwd: `zero-test-${role}`, testcookie: "1" }),
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  assert.ok(cookie.includes("wordpress_logged_in"), `${role} signed in: ${res.status}`);
  return cookie;
}

test("the built artifact ships zero-admin and the harness activated it after the app", () => {
  const manifest = JSON.parse(readFileSync(`${content}zero-manifest.json`, "utf8"));
  assert.equal(manifest.plugins["zero-admin"], manifest.zero, "the admin plugin is versioned with the compiler");
  const status = JSON.parse(wp("plugin", "list", "--format=json", "--fields=name,status,version"));
  const admin = status.find((p: any) => p.name === "zero-admin");
  assert.deepEqual([admin?.status, admin?.version], ["active", manifest.zero]);
  // Activation registered and persisted the one rewrite rule, so pretty URLs reach the app.
  assert.equal(wp("option", "get", "zero_admin_rewrite"), manifest.zero);
});

test("/zero-admin/ asks anonymous visitors to sign in and serves the committed build to users", async () => {
  const anon = await fetch(`${site}/zero-admin/`, { redirect: "manual" });
  assert.equal(anon.status, 302);
  assert.ok(anon.headers.get("location")!.startsWith(`${site}/wp-login.php?`), anon.headers.get("location")!);

  for (const role of ["editor", "subscriber"] as const) {
    const page = await fetch(`${site}/zero-admin/`, { headers: { cookie: await loginCookie(role) } });
    assert.equal(page.status, 200, `${role} is served the page`);
    const html = await page.text();
    assert.ok(html.includes('id="zero-admin-app"'), `${role} gets the app shell`);
    // The import map names the built boot module from the plugin's own build directory: the page
    // runs the committed bundle, not the pre-build shell.
    const importMap = html.match(/<script[^>]*type="importmap"[^>]*>(.*?)<\/script>/s);
    assert.ok(importMap, `${role}: the page carries an import map`);
    const imports = JSON.parse(importMap[1]).imports as Record<string, string>;
    assert.match(imports["@zero-admin/boot"], /\/plugins\/zero-admin\/build\/packages\/boot\/index\.js(\?|$)/);
  }
});
