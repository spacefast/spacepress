// Usage: node admin-login.mjs <site url>
// wp-admin and sign-in in a front-end mode (tests/app_router.rs `frontend_modes_on_wordpress`), in
// Chromium (playwright-core, pinned by tests/differential/client/package.json): the login screen
// renders, signing in lands on SpacePress Admin (the default admin), classic pages open in SpacePress Admin until
// the user turns developer mode on, then classic wp-admin's dashboard and a list screen render as wp-admin
// (not the app, not a theme), `/wp-admin/` while signed out goes to the login screen, the REST nonce
// wp-admin uses works, and signing out ends the session. Prints JSON.
import { createRequire } from "node:module";
import { chromiumPath } from "./chromium.mjs";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const executablePath = chromiumPath();
const [url] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath });
const out = {};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const gate = `${url}/__sp_profile_ready_gate.js`;
  const origin = new URL(url).origin;
  let abandoningProfile;
  const isSiteScriptOrDocument = (request) => new URL(request.url()).origin === origin && ["script", "document"].includes(request.resourceType());
  page.on("pageerror", (error) => errors.push({ url: page.url(), message: error.message, stack: error.stack }));
  page.on("requestfailed", (request) => {
    const failure = request.failure().errorText;
    // Leaving the gated profile deliberately cancels scripts still loading in that frame.
    if (failure === "net::ERR_ABORTED" && request.resourceType() === "script" &&
        (request.url() === gate || (abandoningProfile && request.frame() === abandoningProfile))) return;
    if (isSiteScriptOrDocument(request)) errors.push({ url: request.url(), failure });
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && isSiteScriptOrDocument(response.request())) {
      errors.push({ url: response.url(), status: response.status() });
    }
  });
  const frameElement = page.locator('iframe[title="Classic admin page"]');
  const classicFrame = async () => (await frameElement.elementHandle()).contentFrame();
  const waitForReady = async (frame) => {
    await frame.waitForLoadState("load");
    await frame.evaluate(() => new Promise((resolve) => {
      if (window.jQuery) window.jQuery(() => resolve());
      else resolve();
    }));
  };
  // Signed out, wp-admin sends the visitor to the login screen with the way back.
  await page.goto(`${url}/wp-admin/`);
  await waitForReady(page.mainFrame());
  out.signedOut = { at: new URL(page.url()).pathname, redirectTo: new URL(page.url()).searchParams.get("redirect_to") !== null };
  out.loginForm = await page.locator("#loginform").count();

  // Signing in as the harness's admin lands on SpacePress Admin, the default admin (at `/wp-admin/new/`;
  // `admin.php?page=spacepress-admin` where the server applies no rewrite rule).
  // wp-login.php focuses and selects its username field 200 ms after it loads; a fill that lands on
  // that moment types the password over the username. Fill until both fields hold their text.
  for (let attempt = 0; ; attempt++) {
    await page.fill("#user_login", "admin");
    await page.fill("#user_pass", "spacepress-test-admin");
    if ((await page.inputValue("#user_login")) === "admin" && (await page.inputValue("#user_pass")) === "spacepress-test-admin") break;
    if (attempt === 20) throw new Error("the WordPress sign-in form would not keep its values");
  }
  await Promise.all([page.waitForNavigation(), page.click("#wp-submit")]);
  const landed = new URL(page.url());
  out.signedIn = landed.pathname === "/wp-admin/new/" || (landed.pathname === "/wp-admin/admin.php" && landed.searchParams.get("page") === "spacepress-admin") ? "first admin" : landed.pathname + landed.search;
  // Without developer mode (the default) classic wp-admin's pages open in SpacePress Admin: its dashboard
  // is SpacePress Admin's home route, and a list screen is framed at /classic/<slug>.
  const route = () => {
    const at = new URL(page.url());
    return at.pathname.startsWith("/wp-admin/new/") ? at.pathname.slice("/wp-admin/new".length) : at.searchParams.get("p");
  };
  await page.goto(`${url}/wp-admin/index.php`);
  out.withoutDeveloperMode = { dashboard: route() };
  await page.goto(`${url}/wp-admin/edit.php?post_type=page`);
  // The slug is encoded twice in the route (lib/classic-route.php), and the frame opens it with its query.
  out.withoutDeveloperMode.pages = decodeURIComponent(decodeURIComponent(route() ?? ""));
  const framedPage = await classicFrame();
  await framedPage.locator("table.wp-list-table").waitFor();
  await waitForReady(framedPage);
  const framedUrl = new URL(framedPage.url());
  out.withoutDeveloperMode.framed = framedUrl.pathname + framedUrl.search;

  await page.goto(`${url}/wp-admin/profile.php`);
  const profile = await classicFrame();
  await profile.locator("#your-profile").waitFor();
  await waitForReady(profile);
  out.withoutDeveloperMode.profileMenuHidden = await profile.locator("#adminmenu").isHidden();
  out.withoutDeveloperMode.profileBeforeUnload = await profile.evaluate(() => {
    let ran = false;
    window.addEventListener("beforeunload", () => { ran = true; }, { once: true });
    window.dispatchEvent(new Event("beforeunload"));
    return ran;
  });

  // Hold the parser open after WordPress's profile script registers beforeunload.
  // This creates the same window for a fast navigation every time.
  const unloadProbe = `<script>
    window.addEventListener("beforeunload", () => {
      window.frameElement.dataset.beforeReadyUnload = document.readyState;
    }, { capture: true });
  </script>`;
  let releaseGate;
  const gateReleased = new Promise((resolve) => { releaseGate = resolve; });
  const slowProfile = (requestUrl) => requestUrl.pathname === "/wp-admin/profile.php" && requestUrl.searchParams.has("fast-navigation");
  await page.route(slowProfile, async (route) => {
    if (!route.request().frame().parentFrame()) return route.fallback();
    const response = await route.fetch();
    // Register the probe before the runtime guard so it can record the outgoing document's state.
    const body = (await response.text())
      .replace("<head>", `<head>${unloadProbe}`)
      .replace("</body>", `<script src="${gate}"></script></body>`);
    await route.fulfill({ response, body });
  });
  await page.route(gate, async (route) => {
    await gateReleased;
    await route.fulfill({ contentType: "text/javascript", body: "" });
  });
  try {
    const [gatedScript] = await Promise.all([
      page.waitForRequest(gate),
      page.goto(`${url}/wp-admin/profile.php?fast-navigation`, { waitUntil: "commit" }),
    ]);
    const frame = gatedScript.frame();
    await frame.waitForFunction(() => document.readyState === "loading" && typeof window.generatePassword === "function");
    abandoningProfile = frame;
    await frame.goto(`${url}/wp-admin/edit.php?post_type=page`);
    abandoningProfile = undefined;
    await page.waitForLoadState("load");
    await page.waitForURL((at) => (at.searchParams.get("p") ?? at.pathname).includes("edit.php"));
    out.fastNavigation = await frameElement.getAttribute("data-before-ready-unload");
  } finally {
    abandoningProfile = undefined;
    releaseGate();
    await page.unroute(slowProfile);
    await page.unroute(gate);
  }
  // Developer mode on (the user's own setting, saved through core's user route): classic wp-admin opens as itself.
  out.developerMode = await page.evaluate(async () => {
    const nonce = await (await fetch("/wp-admin/admin-ajax.php?action=rest-nonce", { credentials: "same-origin" })).text();
    const r = await fetch("/wp-json/wp/v2/users/me", { method: "POST", headers: { "X-WP-Nonce": nonce, "content-type": "application/json" }, body: JSON.stringify({ sp_admin_developer_mode: true }), credentials: "same-origin" });
    return (await r.json()).sp_admin_developer_mode ?? r.status;
  });
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
  await waitForReady(page.mainFrame());
  await page.goto(`${url}/wp-admin/`);
  await waitForReady(page.mainFrame());
  out.signedOutAgain = new URL(page.url()).pathname;
  out.errors = errors;
  process.stdout.write(JSON.stringify(out));
} finally {
  await browser.close();
}
