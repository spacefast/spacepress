// Usage: node docs.mjs <site url>
// Reads the docs example (examples/docs) in Chromium as an anonymous visitor: the docs tree and
// the page it opens on, previous and next, the table of contents and its anchors, a component
// block, a code group's tabs (switched with no script on the page), colours in light and dark, a
// draft doc, the Markdown page, and every page's Markdown twin. Prints JSON.
import { createRequire } from "node:module";
import { chromiumPath } from "./chromium.mjs";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const executablePath = chromiumPath();
const [site] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath });
const out = { errors: [] };
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => out.errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/docs/roadmap")) out.errors.push(`${r.status()} ${r.url()}`); });
  const scripts = [];
  page.on("request", (r) => { if (r.resourceType() === "script") scripts.push(new URL(r.url()).pathname); });

  // Home, then the docs, by clicking the way a reader would.
  await page.goto(`${site}/`, { waitUntil: "networkidle" });
  out.home = await page.textContent("h1");
  // The router region went through core's directive pass: core/router's state.url is the page's
  // own URL from the server, as a block theme's page has it.
  out.serverUrl = await page.$eval("script[id='wp-script-module-data-@wordpress/interactivity']", (s) => JSON.parse(s.textContent).state?.["core/router"]?.url ?? null);
  await page.evaluate(() => { window.firstSameDocument = true; });
  await page.click("text=Read the docs");
  await page.waitForSelector("article.doc h1");
  out.intro = { path: new URL(page.url()).pathname, title: await page.title(), h1: await page.textContent("article.doc h1") };
  // A <Link> click is a region swap, not a document load: the router's state.url follows it, and
  // core's loading bar is on the page with its styles.
  out.navigation = {
    sameDocument: await page.evaluate(() => window.firstSameDocument === true),
    url: await page.evaluate(async () => (await import("@wordpress/interactivity-router")).state.url),
    loadingBar: await page.$$eval(".wp-interactivity-router-loading-bar", (bars) => bars.map((b) => [b.dataset.wpInteractive, getComputedStyle(b).position])),
  };
  out.tree = await page.$$eval(".sidebar > ul > li", (items) => items.map((li) => [li.querySelector(":scope > a").textContent, li.className, [...li.querySelectorAll(":scope > ul > li > a")].map((a) => a.textContent)]));
  out.toc = await page.$$eval(".toc a", (as) => as.map((a) => [a.textContent, a.getAttribute("href"), !!document.getElementById(a.getAttribute("href").slice(1))]));
  out.badge = await page.textContent(".doc .badge");

  // Next, twice: Introduction → Guides → Install.
  await page.click(".pager [rel=next]");
  await page.waitForFunction(() => document.querySelector("article.doc h1")?.textContent === "Guides");
  await page.click(".pager [rel=next]");
  await page.waitForFunction(() => document.querySelector("article.doc h1")?.textContent === "Install");
  out.install = {
    path: new URL(page.url()).pathname,
    prev: await page.textContent(".pager [rel=prev]"),
    next: await page.textContent(".pager [rel=next]"),
    open: await page.$eval(".sidebar li.open > a", (a) => a.textContent),
    current: await page.$eval(".sidebar li.current > a", (a) => a.textContent),
  };
  out.callout = await page.$eval(".callout", (el) => [el.className, el.querySelector(".callout-title")?.textContent, el.querySelector(".callout-body b")?.textContent]);
  // The code group: the first tab shows, a click on the second shows it instead.
  const visible = () => page.$$eval(".typedpress-code-group .typedpress-code-panel", (ps) => ps.map((p) => getComputedStyle(p).display !== "none"));
  out.tabs = await page.$$eval(".typedpress-code-group label", (ls) => ls.map((l) => l.textContent));
  out.tabsBefore = await visible();
  await page.click(".typedpress-code-group label:nth-of-type(2)");
  out.tabsAfter = await visible();
  out.title = await page.textContent(".typedpress-code-title");
  out.marked = await page.$$eval(".typedpress-code-marked", (ls) => ls.map((l) => l.textContent));
  const keyword = ".language-ts .hljs-keyword";
  out.light = await page.$eval(keyword, (el) => getComputedStyle(el).color);
  await page.emulateMedia({ colorScheme: "dark" });
  out.dark = await page.$eval(keyword, (el) => getComputedStyle(el).color);
  await page.emulateMedia({ colorScheme: "light" });

  // A deeper page opens both its sections.
  await page.goto(`${site}/docs/guides/deploy/space`, { waitUntil: "networkidle" });
  out.space = await page.$$eval(".sidebar li.open > a, .sidebar li.current > a", (as) => as.map((a) => a.textContent));

  // The draft is a 404 and in no tree; the Markdown page is a page.
  out.draft = (await page.goto(`${site}/docs/roadmap`)).status();
  out.draftInTree = (await page.goto(`${site}/docs/introduction`, { waitUntil: "networkidle" }), await page.$$eval(".sidebar a", (as) => as.some((a) => a.textContent === "Roadmap")));
  await page.goto(`${site}/about`, { waitUntil: "networkidle" });
  out.about = [await page.title(), await page.textContent(".entry-content b")];

  // Twins: Markdown for every page, none for the draft.
  const twin = async (path) => { const r = await page.request.get(`${site}${path}`); return [r.status(), r.headers()["content-type"], (await r.text()).slice(0, 2000)]; };
  out.twins = { install: await twin("/docs/guides/install.md"), about: await twin("/about.md"), draft: await twin("/docs/roadmap.md") };
  out.llms = (await (await page.request.get(`${site}/llms.txt`)).text());
  out.scripts = [...new Set(scripts)];
} finally {
  await browser.close();
}
process.stdout.write(JSON.stringify(out));
