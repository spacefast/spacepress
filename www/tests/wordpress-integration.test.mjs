// Start the seeded Drive Store, then run `bun run test:wordpress` in www/.
// TP_BIN + TP_PROJECT enable an additional local-only Global Styles edit/restore check.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";

const site = (process.env.DRIVE_STORE_URL ?? "http://localhost:8932").replace(/\/$/, "");
const www = fileURLToPath(new URL("../", import.meta.url));
const project = path.resolve(process.env.TP_PROJECT ?? path.join(www, "../examples/drive-store"));
const work = mkdtempSync(path.join(tmpdir(), "typedpress-wordpress-integration-"));
let browser;
let utilityCss;

function compileUtilities() {
  const input = path.join(work, "tailwind.css");
  const output = path.join(work, "utilities.css");
  const tailwind = path.join(www, "node_modules/tailwindcss");
  writeFileSync(input, [
    `@import ${JSON.stringify(path.join(tailwind, "theme.css"))} layer(theme);`,
    `@import ${JSON.stringify(path.join(tailwind, "utilities.css"))};`,
    `@import ${JSON.stringify(path.join(project, "tp/_generated/theme.css"))};`,
    '@source inline("bg-wp-background text-wp-foreground text-wp-link font-wp-body text-wp-body leading-wp-body gap-wp-block p-wp-page max-w-wp-content");',
  ].join("\n"));
  const cli = path.join(www, "node_modules/@tailwindcss/cli/dist/index.mjs");
  execFileSync(process.execPath, [cli, "--input", input, "--output", output], { cwd: www, timeout: 60_000 });
  utilityCss = readFileSync(output, "utf8");
  if (process.env.TP_BIN) {
    const fixture = path.join(work, "app");
    const app = path.join(fixture, "tp/app");
    mkdirSync(app, { recursive: true });
    writeFileSync(path.join(fixture, "typedpress.config.ts"), 'import { defineConfig } from "typedpress"; export default defineConfig({ name: "tailwind-check" });\n');
    writeFileSync(path.join(app, "tailwind.css"), utilityCss);
    writeFileSync(path.join(app, "page.tsx"), 'import "./tailwind.css"; export default function Page() { return <div className="bg-wp-background text-wp-foreground">Theme</div>; }\n');
    execFileSync(path.resolve(process.env.TP_BIN), ["build", fixture, "--quiet"], { cwd: www, timeout: 60_000 });
    const plugins = path.join(fixture, "tp/dist/wp-content/plugins");
    const plugin = readdirSync(plugins).find((name) => name.startsWith("typedpress-app-"));
    const assets = path.join(plugins, plugin, "tp/app/assets");
    assert.ok(readdirSync(assets).some((name) => name.endsWith(".css") && readFileSync(path.join(assets, name), "utf8") === utilityCss), "the compiled plugin must ship Tailwind's CSS unchanged");
  }
  return utilityCss;
}
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
});
after(() => browser?.close());

async function open() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(site + "/", { waitUntil: "networkidle" });
  return { context, page };
}

async function styles(page) {
  await page.addStyleTag({ content: utilityCss ?? compileUtilities() });
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "bg-wp-background text-wp-foreground font-wp-body text-wp-body leading-wp-body gap-wp-block p-wp-page max-w-wp-content";
    const link = document.createElement("a");
    link.className = "text-wp-link";
    link.href = "#";
    probe.append(link);
    document.body.append(probe);
    const read = (element) => {
      const s = getComputedStyle(element);
      return { background: s.backgroundColor, color: s.color, font: s.fontFamily, size: s.fontSize, lineHeight: s.lineHeight, gap: s.gap, padding: s.paddingLeft, maxWidth: s.maxWidth };
    };
    const result = { body: read(document.body), utility: read(probe), link: getComputedStyle(link).color, warnings: /Undefined array key|Warning:|Fatal error:/.test(document.body.innerText) };
    probe.remove();
    return result;
  });
}

test("generated catalog links answer directly at their canonical URLs", async () => {
  const { context, page } = await open();
  try {
    const links = await page.locator("main a[href]").evaluateAll((nodes) => nodes.map((a) => a.href));
    assert.ok(links.some((href) => new URL(href).pathname.includes("/drives/")), "seed the catalog before running this check");
    for (const href of new Set(links)) {
      if (new URL(href).origin !== new URL(site).origin) continue;
      const response = await context.request.get(href, { maxRedirects: 0 });
      assert.equal(response.status(), 200, `${href} redirects or fails`);
      assert.equal(response.headers().location, undefined, href);
    }
  } finally { await context.close(); }
});

test("product navigation and Back preserve the document and support hover prefetch", async () => {
  const { context, page } = await open();
  try {
    await page.waitForFunction(() => globalThis[Symbol.for("tp/forms")]?.navigations !== undefined);
    const product = page.locator(".cards h2 a").first();
    const href = await product.getAttribute("href");
    assert.equal(await product.getAttribute("data-wp-on--mouseenter"), "actions.prefetch");
    await page.evaluate(() => { globalThis.__tpDocumentProbe = "kept"; });
    await product.hover();
    await product.click();
    await page.waitForURL(href);
    assert.equal(await page.evaluate(() => globalThis.__tpDocumentProbe), "kept", "product link reloaded the document");
    await page.locator(".crumbs a").first().click();
    await page.waitForURL(site + "/");
    assert.equal(await page.evaluate(() => globalThis.__tpDocumentProbe), "kept", "Back reloaded the document");
  } finally { await context.close(); }
});

test("compiled Tailwind utilities use the same active theme as the app body", async () => {
  const { context, page } = await open();
  try {
    const result = await styles(page);
    assert.equal(result.warnings, false);
    for (const key of ["background", "color", "font", "size", "lineHeight"]) {
      assert.equal(result.utility[key], result.body[key], key);
    }
  } finally { await context.close(); }
});

test("Site Editor values update app CSS and already-compiled Tailwind utilities", { skip: !process.env.TP_BIN || !process.env.TP_PROJECT }, async () => {
  if (!utilityCss) compileUtilities();
  const command = path.join(work, "styles.php");
  writeFileSync(command, `<?php
    if (wp_get_environment_type() !== 'local' || !in_array(wp_parse_url(home_url(), PHP_URL_HOST), ['localhost', '127.0.0.1'], true)) {
        throw new RuntimeException('This check only edits a local development site.');
    }
    $data = WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles(wp_get_theme(), true);
    $id = (int) $data['ID'];
    if (($args[0] ?? '') === 'read') {
        echo wp_json_encode(['content' => get_post_field('post_content', $id)]);
    } else {
        $content = base64_decode($args[1], true);
        $result = wp_update_post(['ID' => $id, 'post_content' => wp_slash($content)], true);
        if (is_wp_error($result)) throw new RuntimeException($result->get_error_message());
    }
  `);
  const wp = (...args) => execFileSync(path.resolve(process.env.TP_BIN), ["wp", "--site", project, "--user=admin", "eval-file", command, ...args], { encoding: "utf8", timeout: 60_000 });
  const original = JSON.parse(wp("read").trim().split("\n").at(-1));
  const { context, page } = await open();
  try {
    const content = JSON.parse(original.content || "{}");
    content.version = 3;
    content.isGlobalStylesUserThemeJSON = true;
    content.settings = { ...content.settings, layout: { contentSize: "44rem", wideSize: "72rem" } };
    content.styles = { ...content.styles, color: { background: "#e1ecf5", text: "#182838" }, elements: { ...content.styles?.elements, link: { color: { text: "#126644" } } }, typography: { fontFamily: "monospace", fontSize: "17px", lineHeight: "1.75" }, spacing: { blockGap: "2.5rem", padding: { left: "1.75rem", right: "1.75rem" } } };
    wp("write", Buffer.from(JSON.stringify(content)).toString("base64"));
    await page.reload({ waitUntil: "networkidle" });
    const result = await styles(page);
    assert.equal(result.warnings, false);
    assert.equal(result.body.background, "rgb(225, 236, 245)");
    assert.equal(result.body.color, "rgb(24, 40, 56)");
    assert.equal(result.body.font, "monospace");
    assert.equal(result.body.size, "17px");
    assert.equal(result.utility.gap, "40px");
    assert.equal(result.utility.padding, "28px");
    assert.equal(result.utility.maxWidth, "704px");
    assert.equal(result.link, "rgb(18, 102, 68)");
    for (const key of ["background", "color", "font", "size", "lineHeight"]) {
      assert.equal(result.utility[key], result.body[key], key);
    }
  } finally {
    try { wp("write", Buffer.from(original.content).toString("base64")); }
    finally { await context.close(); }
  }
});
