// Usage: node admin-login.mjs <site url>
// wp-admin and sign-in in a front-end mode (tests/app_router.rs `frontend_modes_on_wordpress`), in
// Chromium (playwright-core, pinned by tests/differential/client/package.json): the login screen
// renders, signing in lands on First Admin (the default admin), classic wp-admin's dashboard and a
// list screen render as wp-admin (not the app, not a theme), `/wp-admin/` while signed out goes to the login screen, the REST nonce
// wp-admin uses works, and signing out ends the session. Prints JSON.
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const cache = join(homedir(), ".cache/ms-playwright");
const shell = readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse()[0];
const executablePath = process.env.FIRST_CHROMIUM ?? join(cache, shell, "chrome-headless-shell-linux64/chrome-headless-shell");
const [url] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath });
const out = { errors: [] };
const path = (u) => { const x = new URL(u); return x.pathname + x.search; };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => out.errors.push(String(e)));
  page.on("response", (r) => {
    if (r.status() >= 500 || (r.status() >= 400 && r.url().includes("/wp-admin/") && !r.url().endsWith("favicon.ico"))) out.errors.push(`${r.status()} ${path(r.url())}`);
  });

  // Signed out, wp-admin sends the visitor to the login screen with the way back.
  await page.goto(`${url}/wp-admin/`);
  out.signedOut = { at: new URL(page.url()).pathname, redirectTo: new URL(page.url()).searchParams.get("redirect_to") !== null };
  out.loginForm = await page.locator("#loginform").count();

  // Signing in as the harness's admin lands on First Admin, the default admin (at `/wp-admin/new/`;
  // `admin.php?page=first-admin` where the server applies no rewrite rule).
  await page.fill("#user_login", "admin");
  await page.fill("#user_pass", "first-test-admin");
  await Promise.all([page.waitForNavigation(), page.click("#wp-submit")]);
  const landed = new URL(page.url());
  out.signedIn = landed.pathname === "/wp-admin/new/" || (landed.pathname === "/wp-admin/admin.php" && landed.searchParams.get("page") === "first-admin") ? "first admin" : landed.pathname + landed.search;
  // Classic wp-admin stays beside it: its dashboard renders as wp-admin.
  await page.goto(`${url}/wp-admin/index.php`);
  out.classic = {
    at: new URL(page.url()).pathname,
    adminBar: await page.locator("#wpadminbar").count(),
    menu: await page.locator("#adminmenu").count(),
    dashboard: await page.locator("body.index-php").count(),
  };

  // A list screen renders, and the REST nonce wp-admin was given works for the signed-in user.
  await page.goto(`${url}/wp-admin/edit.php?post_type=page`);
  out.pages = { title: (await page.locator("h1.wp-heading-inline").textContent())?.trim() ?? null, table: await page.locator("table.wp-list-table").count() };
  // Core's own nonce refresh (what wp-admin's heartbeat and api-fetch use), then a REST call with it.
  out.rest = await page.evaluate(async () => {
    const nonce = await (await fetch("/wp-admin/admin-ajax.php?action=rest-nonce", { credentials: "same-origin" })).text();
    const r = await fetch("/wp-json/wp/v2/users/me?context=edit", { headers: { "X-WP-Nonce": nonce }, credentials: "same-origin" });
    return { status: r.status, role: (await r.json()).roles?.[0] ?? null };
  });

  // Signing out ends the session: wp-admin is the login screen again.
  const logout = await page.locator("#wp-admin-bar-logout a").getAttribute("href");
  await page.goto(logout);
  await page.goto(`${url}/wp-admin/`);
  out.signedOutAgain = new URL(page.url()).pathname;
  process.stdout.write(JSON.stringify(out));
} finally {
  await browser.close();
}
