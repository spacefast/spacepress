// Visitor journeys against the freshly installed site created by scripts/test-fresh.mjs.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";

const base = new URL(process.env.SITE_URL).origin;
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.SP_CHROMIUM }); });
after(() => browser?.close());

async function open(t, path, options = {}) {
  const context = await browser.newContext(options);
  t.after(() => context.close());
  // The layout's optional fonts should not make this suite depend on an external service.
  await context.route("https://fonts-api.wp.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  const response = await page.goto(base + path);
  assert.equal(response.status(), 200, path);
  return page;
}

const sandbox = "sp-sandbox[default-tab='migration.sql']";

test("handbook shows its contents and highlights the inline examples", async (t) => {
  const page = await open(t, "/handbook/");
  const chapters = await page.getByRole("complementary", { name: "Handbook contents" }).locator("a").evaluateAll((links) => links.map((link) => link.hash.slice(1)));
  assert.ok(chapters.includes("data-modeling") && chapters.includes("deploy-cli"));
  for (const chapter of chapters) assert.equal(await page.locator(`[id="${chapter}"]`).count(), 1, chapter);
  await page.locator("sp-code.sp-drawn").first().waitFor();
  await page.locator(sandbox).scrollIntoViewIfNeeded();
  await page.locator(`${sandbox}[data-ready]`).waitFor();
  const sql = await page.locator(sandbox).evaluate((element) => element.outputs[element.selectedOutput]);
  assert.match(sql, /ALTER TABLE/);
  assert.doesNotMatch(sql, /CREATE TABLE/);
});

test("handbook renders readable source without JavaScript", async (t) => {
  const page = await open(t, "/handbook/", { javaScriptEnabled: false });
  assert.match(await page.locator("h1").textContent(), /SpacePress Handbook/);
  assert.match(await page.locator("sp-code").first().textContent(), /spacepress/);
});

test("home and synced reference fit a narrow viewport", async (t) => {
  for (const path of ["/", "/docs/core/pages-and-islands/"]) {
    const page = await open(t, path, { viewport: { width: 390, height: 800 } });
    assert.ok(await page.locator("h1").isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path);
  }
});

test("reference navigation opens synced Markdown and its code examples", async (t) => {
  const page = await open(t, "/docs/");
  await page.getByRole("link", { name: /Pages, Layouts & Interactive Islands/ }).click();
  await page.waitForURL("**/docs/core/pages-and-islands/");
  assert.equal(await page.locator("h1").textContent(), "Pages, Layouts & Interactive Islands");
  assert.ok(await page.getByRole("navigation", { name: "Reference", exact: true }).locator("a").count() > 1);
  assert.ok(await page.getByRole("complementary", { name: "On this page" }).locator("a").count() > 0);
  const code = page.locator(".sp-docs-article pre code").filter({ hasText: "wp.posts.extend" }).first();
  await code.waitFor({ state: "attached" });
  assert.match(await code.textContent(), /import \{ wp \} from "spacepress"/);
});

async function tasks(t) {
  const page = await open(t, "/play/?example=tasks");
  const play = page.locator("sp-play[data-ready]");
  const pane = play.locator(".sp-pane").first();
  await pane.getByRole("textbox").waitFor();
  await play.evaluate((element) => {
    const lines = element.files["sp/schema.ts"].split("\n");
    const line = lines.findIndex((text) => text.includes("done: boolean()"));
    element.editor.focus({ lineNumber: line + 1, character: lines[line].length });
  });
  await pane.locator('[role="textbox"]:focus').waitFor();
  return page;
}

test("playground generates a migration and reopens a shared edit", async (t) => {
  const page = await tasks(t);
  const added = "priority: integer().default(0),";
  await page.keyboard.insertText(`\n  ${added}`);
  await page.waitForFunction(() => Object.values(document.querySelector("sp-play").outputs).some((text) => text.includes("ADD COLUMN `priority`")));
  const paths = await page.locator("sp-play").evaluate((element) => Object.keys(element.outputs).filter((path) => path.endsWith("/migration.sql")).sort());
  assert.equal(paths.length, 2, "the initial and incremental SQL migrations are both present");
  assert.match(paths[1], /\/\d{14}_[a-z0-9]+_.*\/migration\.sql$/);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const link = page.locator(".sp-shared a");
  await link.waitFor();
  const url = new URL(await link.getAttribute("href"), base);
  assert.match(url.search, /^\?s=[0-9a-f]{10}$/);
  const other = await open(t, url.pathname + url.search);
  await other.locator("sp-play[data-ready]").waitFor();
  assert.ok(await other.locator("sp-play").evaluate((element, text) => element.files["sp/schema.ts"].includes(text), added));
});

test("playground announces a syntax error with its source location", async (t) => {
  const page = await tasks(t);
  await page.keyboard.insertText(" ((");
  await page.getByRole("status").filter({ hasText: /\d+ problems?\. Showing output from the last passing build/ }).waitFor();
  await page.locator(".sp-inline-diag.is-error").first().waitFor();
  const location = await page.locator("sp-play").evaluate((element) => element.lastDiagnostics[0].location);
  assert.equal(location.file, "sp/schema.ts");
  assert.ok(location.line > 0 && location.column > 0);
});

test("seeded examples match the JSON API and open in the playground", async (t) => {
  const page = await open(t, "/examples/");
  const cards = page.locator("article.sp-card");
  const response = await fetch(`${base}/api/examples.json`, { redirect: "manual" });
  assert.equal(response.status, 200);
  const { examples } = await response.json();
  assert.deepEqual(examples.map(({ name }) => name), ["website", "reading-list", "pantry", "blog", "full-site"]);
  assert.deepEqual(await cards.locator("h3").allTextContents(), examples.map(({ title }) => title));
  assert.equal(await cards.first().getByRole("link", { name: /Source/ }).getAttribute("href"), examples[0].githubUrl);
  await cards.first().getByRole("link", { name: /Open in Playground/ }).click();
  await page.locator("sp-play[data-ready]").waitFor();
  assert.equal(await page.getByLabel("Example", { exact: true }).inputValue(), "website");
  assert.match(await page.locator("sp-play .sp-status").textContent(), /^Built in \d+ ms: \d+ files/);
});

test("Run in WordPress points to ZIPs reachable across origins", async (t) => {
  const page = await open(t, "/play/?example=tasks");
  await page.route("https://playground.wordpress.net/**", (route) => route.fulfill({ contentType: "text/html", body: "" }));
  await page.getByRole("button", { name: "Run in WordPress", exact: true }).click();
  const frame = page.getByTitle("WordPress running your SpacePress app");
  const url = new URL(await frame.getAttribute("src"));
  assert.equal(url.origin, "https://playground.wordpress.net");
  const { steps } = JSON.parse(decodeURIComponent(url.hash.slice(1)));
  const zips = steps.filter(({ pluginData }) => pluginData?.url?.includes("/playground-plugins/")).map(({ pluginData }) => pluginData.url);
  assert.deepEqual(zips.sort(), ["admin", "identity", "runtime"].map((slug) => `${base}/playground-plugins/spacepress-${slug}.zip`));
  const index = await fetch(`${base}/playground-plugins/`);
  assert.equal(index.status, 200);
  assert.deepEqual((await index.json()).plugins.map((path) => new URL(path, base).href).sort(), zips);

  const crossOrigin = await page.context().newPage();
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end("<!doctype html><title>Cross-origin ZIP test</title>");
  });
  await new Promise((done, fail) => server.once("error", fail).listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  await crossOrigin.goto(`http://127.0.0.1:${server.address().port}/`);
  const errors = [];
  crossOrigin.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  crossOrigin.on("requestfailed", (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  for (const zip of zips) {
    const response = await fetch(zip, { method: "HEAD", headers: { Origin: url.origin } });
    assert.equal(response.status, 200, zip);
    assert.ok(["*", url.origin].includes(response.headers.get("access-control-allow-origin")), zip);
    const result = await crossOrigin.evaluate(async (file) => {
      const r = await fetch(file, { credentials: "omit" });
      return [r.status, ...new Uint8Array(await r.arrayBuffer(), 0, 4)];
    }, zip).catch((error) => { throw new Error(errors.join("\n") || error.message, { cause: error }); });
    assert.deepEqual(result, [200, 0x50, 0x4b, 0x03, 0x04], zip);
  }
});

test("blog navigation shows a synced WordPress post and its comments", async (t) => {
  const page = await open(t, "/");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Blog" }).click();
  await page.waitForURL("**/blog/");
  const post = page.locator("article h2 a").first();
  const title = await post.textContent();
  await post.click();
  await page.waitForURL(/\/blog\/[\w-]+\/$/);
  assert.equal(await page.locator("article h1").textContent(), title);
  assert.ok(await page.getByRole("heading", { name: "Comments", exact: true }).isVisible());
  const { data } = await (await fetch(`${base}/wp-json/spacepress/v1/posts`)).json();
  const listed = data.find(({ slug }) => page.url().endsWith(`/${slug}/`));
  assert.ok(listed);
  const core = await (await fetch(`${base}/wp-json/wp/v2/posts/${listed.id}`)).json();
  assert.equal(core.slug, listed.slug);
});

test("visitors cannot list shared edits or start the star refresh", async () => {
  const shares = await fetch(`${base}/wp-json/spacepress/v1/shares`);
  assert.ok([401, 403].includes(shares.status), `shares answered ${shares.status}`);
  const stars = await fetch(`${base}/wp-json/spacepress/v1/actions/refreshStarsNow`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.ok([401, 403].includes(stars.status), `refreshStarsNow answered ${stars.status}`);
});
