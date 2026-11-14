// Usage: node editor-blocks.mjs <site url>
// Components in Markdown in the block editor (tests/app_router.rs
// `component_blocks_edit_in_the_block_editor`), in Chromium (playwright-core, pinned by
// tests/differential/client/package.json): signs in as the harness's admin, opens a new Page,
// inserts the fixture's `Badge` (no children: core's `autoRegister`) and `Callout` (children: inner
// blocks), reads what the canvas and the sidebar show, saves, and prints JSON.
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
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on("pageerror", (e) => out.errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") out.errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("favicon.ico")) out.errors.push(`${r.status()} ${r.url()}`); });

  await page.goto(`${url}/wp-login.php`);
  await page.fill("#user_login", "admin");
  await page.fill("#user_pass", "first-test-admin");
  await Promise.all([page.waitForNavigation(), page.click("#wp-submit")]);
  await page.goto(`${url}/wp-admin/post-new.php?post_type=page`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.wp?.data?.select("core/editor")?.getCurrentPostId?.() && window.wp.blocks.getBlockTypes().length > 0, null, { timeout: 60000 });
  // The welcome guide covers the editor on a first visit.
  await page.evaluate(() => window.wp.data.dispatch("core/preferences").set("core/edit-post", "welcomeGuide", false));

  // What the editor knows of each block: registered, with which attributes marked for core's fields.
  out.types = await page.evaluate(() => Object.fromEntries(["docskind/badge", "docskind/callout"].map((name) => {
    const type = window.wp.blocks.getBlockType(name);
    return [name, type === undefined ? null : Object.keys(type.attributes).filter((key) => type.attributes[key].autoGenerateControl).sort()];
  })));

  // A Badge with props: the canvas shows the component as the server renders it.
  const badge = await page.evaluate(() => {
    const block = window.wp.blocks.createBlock("docskind/badge", { label: "New", count: 3 });
    window.wp.data.dispatch("core/block-editor").insertBlocks(block);
    return block.clientId;
  });
  const canvas = () => page.frameLocator("iframe[name='editor-canvas']");
  // Core's preview puts the component's root element in place of the block's wrapper: the block is
  // the `<span class="badge">`, and its text is the server's render.
  const preview = () => canvas().locator(`[data-block='${badge}']`);
  const shown = async () => preview().evaluate((n) => `<${n.tagName.toLowerCase()} class="${[...n.classList].filter((c) => !/^(block-editor|wp-block|is-)/.test(c)).join(" ")}">${n.innerHTML.replace(/ inert="true"/g, "")}</${n.tagName.toLowerCase()}>`);
  await canvas().locator(`[data-block='${badge}'].badge`).waitFor({ timeout: 30000 });
  out.badgePreview = await shown();
  // Selected, its props are fields in the sidebar, and changing one re-renders the preview.
  await page.evaluate((id) => window.wp.data.dispatch("core/block-editor").selectBlock(id), badge);
  await page.evaluate(() => window.wp.data.dispatch("core/edit-post").openGeneralSidebar("edit-post/block"));
  const sidebar = page.locator(".block-editor-block-inspector");
  await sidebar.getByLabel("label", { exact: true }).waitFor({ timeout: 30000 });
  out.badgeFields = await Promise.all(["label", "count"].map((name) => sidebar.getByLabel(name, { exact: true }).count()));
  await sidebar.getByLabel("label", { exact: true }).fill("Fresh");
  await canvas().locator(`[data-block='${badge}'].badge`, { hasText: "Fresh" }).waitFor({ timeout: 30000 });
  out.badgeEdited = await shown();

  // A Callout holds inner blocks, edited in place; its props are fields in the sidebar too.
  const callout = await page.evaluate(() => {
    const { createBlock } = window.wp.blocks;
    const block = createBlock("docskind/callout", { type: "warning" }, [createBlock("core/paragraph", { content: "Mind the gap." })]);
    window.wp.data.dispatch("core/block-editor").insertBlocks(block);
    window.wp.data.dispatch("core/block-editor").selectBlock(block.clientId);
    return block.clientId;
  });
  await canvas().locator(`[data-block='${callout}'] [data-type='core/paragraph']`).waitFor({ timeout: 30000 });
  out.calloutInner = await canvas().locator(`[data-block='${callout}'] [data-type='core/paragraph']`).innerText();
  await sidebar.getByLabel("type", { exact: true }).waitFor({ timeout: 30000 });
  out.calloutFields = await Promise.all(["type", "title"].map((name) => sidebar.getByLabel(name, { exact: true }).count()));

  // Saved, the post holds both blocks as stored blocks.
  await page.evaluate(() => {
    window.wp.data.dispatch("core/editor").editPost({ title: "Blocks in the editor", status: "publish" });
    return window.wp.data.dispatch("core/editor").savePost();
  });
  await page.waitForFunction(() => !window.wp.data.select("core/editor").isSavingPost() && !window.wp.data.select("core/editor").isEditedPostDirty(), null, { timeout: 30000 });
  out.saved = await page.evaluate(() => window.wp.data.select("core/editor").getCurrentPostAttribute("content"));
  const link = await page.evaluate(() => window.wp.data.select("core/editor").getCurrentPostAttribute("link"));
  // The page as a visitor sees it: each block rendered by its component.
  const visitor = await browser.newPage();
  await visitor.goto(link);
  out.rendered = await visitor.evaluate(() => [...document.querySelectorAll("span.badge, aside.callout")].map((n) => n.outerHTML.replace(/\s+/g, " ")));
} catch (e) {
  out.errors.push(String(e.stack ?? e));
} finally {
  await browser.close();
}
console.log(JSON.stringify(out));
