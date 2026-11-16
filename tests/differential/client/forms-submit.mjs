// Usage: node forms-submit.mjs <site url>
// The JavaScript submit of `<form action={name}>` in Chromium (tests/app_router.rs
// `forms_submit_in_place_in_the_browser`), on tests/fixtures/forms: a submit swaps the page in place
// (a window marker and the document's navigation entry survive), the result or the error shows, the
// page is fetched once with its flash, the URL bar ends on the page without `?_flash`, the form is
// busy while the post is in flight, and a network failure falls back to the browser's own submit.
// Prints JSON.
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright-core");

// Playwright's cache is ~/.cache/ms-playwright on Linux and ~/Library/Caches/ms-playwright on macOS.
function chromiumPath() {
  if (process.env.FIRST_CHROMIUM) return process.env.FIRST_CHROMIUM;
  for (const cache of [join(homedir(), ".cache/ms-playwright"), join(homedir(), "Library/Caches/ms-playwright")]) {
    if (!existsSync(cache)) continue;
    for (const shell of readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse()) {
      for (const dir of ["chrome-headless-shell-linux64", "chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64"]) {
        const bin = join(cache, shell, dir, "chrome-headless-shell");
        if (existsSync(bin)) return bin;
      }
    }
  }
  throw new Error("no chromium-headless-shell: run npx --prefix tests/differential/client playwright-core install chromium-headless-shell");
}

const [url] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: chromiumPath() });
const out = { errors: [] };
const path = (href) => { const u = new URL(href); return u.pathname + u.search; };
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => out.errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") out.errors.push(m.text()); });
  const pageRequests = [];
  page.on("request", (r) => { if (r.resourceType() === "document" || r.url().includes("_flash=")) pageRequests.push(`${r.method()} ${path(r.url())}`); });

  await page.goto(`${url}/?ref=nav`, { waitUntil: "networkidle" });
  out.directive = await page.$eval("form.subscribe", (f) => [f.getAttribute("data-wp-interactive"), f.getAttribute("data-wp-on--submit")]);
  // A tall page scrolled down to the form (the padding is outside the router region, so the swap
  // leaves it): the swap doesn't jump to the top.
  await page.evaluate(() => { window.firstMarker = "same document"; document.body.style.padding = "2000px 0"; window.scrollTo(0, 1900); });
  const historyBefore = await page.evaluate(() => history.length);

  // A submit that succeeds. The post is held for a moment, to see the form while it is pending.
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route("**/__first/api/v1/actions/subscribe", async (route) => { await held; await route.continue(); });
  await page.fill("form.subscribe [name=email]", "ada@example.test");
  await page.fill("form.subscribe [name=seats]", "3");
  await page.check("form.subscribe [name=weekly]");
  pageRequests.length = 0;
  await page.click("form.subscribe button");
  await page.waitForFunction(() => document.querySelector("form.subscribe")?.getAttribute("aria-busy") === "true");
  out.pending = await page.$eval("form.subscribe", (f) => ({ busy: f.getAttribute("aria-busy"), disabled: f.querySelector("button").disabled }));
  const scrolled = await page.evaluate(() => window.scrollY);
  release();
  await page.waitForSelector(".done", { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector("form.subscribe").hasAttribute("aria-busy"));
  await page.unroute("**/__first/api/v1/actions/subscribe");
  out.success = {
    done: await page.textContent(".done"),
    marker: await page.evaluate(() => window.firstMarker ?? null),
    navigations: await page.evaluate(() => performance.getEntriesByType("navigation").length),
    url: path(page.url()),
    historyAdded: (await page.evaluate(() => history.length)) - historyBefore,
    requests: [...pageRequests],
    afterPending: await page.$eval("form.subscribe", (f) => ({ busy: f.getAttribute("aria-busy"), disabled: f.querySelector("button").disabled })),
    // Where it was, give or take the paragraph the result added above the form.
    scrollKept: scrolled >= 1900 && Math.abs((await page.evaluate(() => window.scrollY)) - scrolled) < 100,
    focus: await page.evaluate(() => (document.activeElement?.closest("form.subscribe") && document.activeElement.tagName) || document.activeElement?.tagName),
  };

  // A submit the action refuses (422): the error and the typed values, in place.
  await page.fill("form.subscribe [name=email]", "grace@example.test");
  await page.fill("form.subscribe [name=seats]", "9");
  pageRequests.length = 0;
  await page.click("form.subscribe button");
  await page.waitForSelector(".error", { timeout: 15000 });
  out.refused = {
    error: await page.textContent(".error"),
    code: await page.getAttribute(".error", "data-code"),
    done: await page.$(".done").then((el) => el !== null),
    email: await page.inputValue("form.subscribe [name=email]"),
    marker: await page.evaluate(() => window.firstMarker ?? null),
    url: path(page.url()),
    requests: [...pageRequests],
  };

  // The network fails: the browser's own submit runs (the aborted fetch logs a console error, which
  // is this step's own doing, so errors stop being collected here), and the page comes back with the result.
  out.errors = [...out.errors];
  page.removeAllListeners("console");
  await page.route("**/__first/api/v1/actions/subscribe", async (route) => {
    if (route.request().resourceType() === "fetch") return route.abort("failed");
    return route.continue();
  });
  await page.fill("form.subscribe [name=email]", "lin@example.test");
  await page.fill("form.subscribe [name=seats]", "2");
  await Promise.all([page.waitForNavigation({ timeout: 15000 }), page.click("form.subscribe button")]);
  await page.waitForSelector(".done", { timeout: 15000 });
  out.offline = {
    done: await page.textContent(".done"),
    marker: await page.evaluate(() => window.firstMarker ?? null),
    flashInUrl: page.url().includes("_flash="),
  };
  await page.close();
} catch (e) {
  out.errors.push(String(e.stack ?? e));
} finally {
  await browser.close();
}
console.log(JSON.stringify(out));
