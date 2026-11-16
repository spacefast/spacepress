// Reads the running site in Chromium, as a visitor: the guide, the docs, the playground, and
// sharing an edit. Start the site first (README.md), then:
//
//   SITE_URL=http://localhost:8960 node --test tests/site.test.mjs
//
// CHROMIUM names the browser binary when Playwright's own download is not installed.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";

const base = (process.env.SITE_URL ?? "http://localhost:8960").replace(/\/$/, "");
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--no-sandbox"] }); });
after(() => browser?.close());

async function open(path, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  const response = await page.goto(base + path, { waitUntil: "load" });
  return { page, errors, status: response.status(), close: () => context.close() };
}
const built = (page) => page.waitForSelector("tp-play[data-ready]", { timeout: 60_000 });
const noSidewaysScroll = async (page) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "the page scrolls sideways");

test("the guide: every section, drawn code, and a hero that builds", async () => {
  const { page, errors, status, close } = await open("/");
  assert.equal(status, 200);
  await built(page);
  await page.waitForSelector("html[data-drawn]", { timeout: 30_000 });
  assert.equal(await page.locator("main.guide h2[id]").count(), 30);
  assert.equal(await page.locator("ul.toc li").count(), 30);
  assert.equal(await page.locator("tp-code:not(.tp-drawn)").evaluateAll((nodes) => nodes.filter((n) => !n.closest("tp-example")).length), 0, "a code block was not drawn");
  assert.ok(await page.locator("tp-diff.tp-drawn").count() >= 5);
  assert.ok(await page.locator("tp-example.tp-drawn").count() >= 3);
  assert.match(await page.locator("tp-play .tp-status").first().textContent(), /^Built in \d+ ms: \d+ files/);
  assert.deepEqual(errors, []);
  await close();
});

test("the guide without JavaScript still shows its code as text", async () => {
  const { page, status, close } = await open("/", { javaScriptEnabled: false });
  assert.equal(status, 200);
  assert.match(await page.locator("tp-code").first().textContent(), /npm create typedpress/);
  assert.equal(await page.locator("main.guide h2[id]").count(), 30);
  await close();
});

test("the guide and a doc fit a phone", async () => {
  for (const path of ["/", "/docs/guides/pages"]) {
    const { page, close } = await open(path, { viewport: { width: 390, height: 800 } });
    if (path === "/") await page.waitForSelector("html[data-drawn]", { timeout: 30_000 });
    await noSidewaysScroll(page);
    await close();
  }
});

test("docs: /docs opens the first doc, with navigation, contents and highlighted code", async () => {
  const { page, errors, status, close } = await open("/docs");
  assert.equal(status, 200);
  assert.equal(new URL(page.url()).pathname, "/docs/introduction");
  assert.equal(await page.locator("h1").textContent(), "Introduction");
  assert.ok(await page.locator(".sidebar a").count() >= 10);
  assert.ok(await page.locator(".onpage a").count() >= 1);
  assert.ok(await page.locator(".typedpress-code-block .hljs-keyword").count() >= 1, "the code fence is not highlighted");
  await page.locator(".sidebar a", { hasText: "Pages" }).click();
  await page.waitForURL(/\/docs\/guides\/pages$/);
  assert.equal(await page.locator("h1").textContent(), "Pages");
  assert.deepEqual(errors, []);
  await close();
});

test("playground: an edit builds a migration, and a shared edit opens for someone else", async () => {
  const { page, errors, close } = await open("/play?example=tasks");
  await built(page);
  await page.waitForTimeout(1000);
  await page.locator("tp-play .tp-pane").first().locator("diffs-container [data-line]", { hasText: "done: boolean()" }).first().click();
  await page.waitForTimeout(400);
  await page.keyboard.press("End");
  await page.keyboard.type("\n  priority: integer().default(0),", { delay: 15 });
  await page.waitForFunction(() => /differ from the previous build/.test(document.querySelector(".tp-status")?.textContent ?? ""), null, { timeout: 15_000 });
  assert.match(await page.evaluate(() => document.querySelector("tp-play").outputs["tp/_generated/migrations/0002_update.sql"]), /ADD COLUMN `priority`/);
  await page.getByRole("button", { name: "Share" }).click();
  await page.waitForSelector(".tp-shared a", { timeout: 15_000 });
  const link = await page.locator(".tp-shared a").getAttribute("href");
  assert.match(link, /\/play\?s=[0-9a-f]{10}$/);
  assert.deepEqual(errors, []);
  await close();

  const other = await open(new URL(link).pathname + new URL(link).search);
  await built(other.page);
  assert.equal(await other.page.evaluate(() => document.querySelector("tp-play").files["tp/schema.ts"].includes("priority: integer().default(0)")), true);
  await other.close();
});

test("playground: a syntax error is announced with its place", async () => {
  const { page, close } = await open("/play?example=tasks");
  await built(page);
  await page.waitForTimeout(1000);
  await page.locator("tp-play .tp-pane").first().locator("diffs-container [data-line]", { hasText: "done: boolean()" }).first().click();
  await page.waitForTimeout(400);
  await page.keyboard.press("End");
  await page.keyboard.type(" ((", { delay: 15 });
  await page.waitForSelector(".tp-problems li", { timeout: 15_000 });
  assert.equal(await page.locator(".tp-problems").getAttribute("role"), "alert");
  assert.match(await page.locator(".tp-problems li").first().textContent(), /^tp\/schema\.ts:\d+:\d+ /);
  await close();
});

test("examples: each links to its code and opens in the playground, and the list is served as JSON", async () => {
  const { page, errors, status, close } = await open("/examples");
  assert.equal(status, 200);
  const cards = page.locator(".cards li");
  assert.ok(await cards.count() >= 3);
  assert.match(await cards.first().getByRole("link", { name: "Code on GitHub" }).getAttribute("href"), /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/tree\/main\//);
  const data = await (await fetch(`${base}/api/examples.json`)).json();
  assert.equal(data.length, await cards.count());
  for (const row of data) assert.ok(row.stars === null || Number.isInteger(row.stars), `stars of ${row.name}`);
  await cards.first().getByRole("link", { name: "Open in the playground" }).click();
  await built(page);
  assert.equal(await page.locator("tp-play select").inputValue(), "website");
  assert.match(await page.locator("tp-play .tp-status").textContent(), /^Built in \d+ ms: \d+ files/);
  assert.deepEqual(errors, []);
  await close();
});

test("blog: the menu links to it, and a post renders in the site's layout", async () => {
  const { page, errors, status, close } = await open("/");
  assert.equal(status, 200);
  await page.locator("header.top nav a", { hasText: "Blog" }).click();
  await page.waitForURL(/\/blog$/);
  const first = page.locator(".postlist li a").first();
  const title = await first.textContent();
  await first.click();
  await page.waitForURL(/\/blog\/[\w-]+$/);
  assert.equal(await page.locator("article h1").textContent(), title);
  assert.equal(await page.locator("header.top .brand").count(), 1, "the post is not inside the site's layout");
  // WordPress's own comments end the post; a signed-out visitor is asked to sign in to write one.
  assert.equal(await page.locator("article + section.comments").count(), 1, "no comments after the post");
  assert.deepEqual(errors, []);
  await close();
});

test("home: the newest posts are listed at the end of the guide", async () => {
  const { page, errors, status, close } = await open("/");
  assert.equal(status, 200);
  const latest = page.locator("section.latest li a");
  assert.ok(await latest.count() >= 1 && await latest.count() <= 3, "From the blog lists one to three posts");
  // The same newest post the blog's front page starts with.
  const newest = new URL(await latest.first().getAttribute("href"), base).pathname;
  await page.goto(`${base}/blog`);
  assert.equal(new URL(await page.locator(".postlist li a").first().getAttribute("href"), base).pathname, newest);
  assert.deepEqual(errors, []);
  await close();
});

test("the star job can only be started by an admin", async () => {
  const response = await fetch(`${base}/__tp/api/v1/actions/refreshStarsNow`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.ok([401, 403].includes(response.status), `POST refreshStarsNow answered ${response.status}`);
});

test("saved edits cannot be listed by a visitor", async () => {
  const response = await fetch(`${base}/__tp/api/v1/shares`);
  assert.ok([401, 403].includes(response.status), `GET /shares answered ${response.status}`);
});
