// The migrated journal (after/) on WordPress-on-SQLite, read in Chromium: the pages the Astro site
// had (home, blog, a post, about), the collection seeded from its Markdown files, and the island,
// which hydrates and counts clicks. Needs the `typedpress` binary (TP_BIN, default target/debug/typedpress),
// PHP 8.2+ with pdo_sqlite, and `npm ci` plus Chromium's headless shell in tests/differential/client.
//
//   node --test examples/migrate-astro/migrated.test.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const bin = process.env.TP_BIN ?? join(repo, "target/debug/typedpress");
const { chromium } = createRequire(join(repo, "tests/differential/client/package.json"))("playwright-core");
const work = mkdtempSync(join(tmpdir(), "typedpress-journal-"));
let server;
let url;
let browser;

const first = (...args) => {
  const out = spawnSync(bin, args, { encoding: "utf8" });
  assert.equal(out.status, 0, `first ${args.join(" ")}: ${out.stdout}${out.stderr}`);
};

before(async () => {
  assert.ok(existsSync(bin), `build the compiler first (cargo build --bin typedpress), or set TP_BIN; ${bin} is missing`);
  const project = join(work, "journal");
  cpSync(join(here, "after"), project, { recursive: true });
  first("build", project, "--quiet");
  first("sources", project, "--out", join(work, "sources"));
  first("compile-sources", join(work, "sources"), join(work, "compiled"), project);
  server = spawn("php", ["-d", "memory_limit=512M", join(repo, "tests/php/serve_built.php"), join(project, "tp/dist/wp-content"), join(work, "compiled/seed")], {
    env: { ...process.env, TP_WP_THEMES: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  url = JSON.parse(await new Promise((ok, fail) => {
    createInterface({ input: server.stdout }).once("line", ok);
    server.once("exit", (code) => fail(new Error(`serve_built.php exited ${code}`)));
  })).url;
  const cache = join(homedir(), ".cache/ms-playwright");
  const shell = readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse()[0];
  browser = await chromium.launch({ executablePath: join(cache, shell, "chrome-headless-shell-linux64/chrome-headless-shell") });
});

after(async () => {
  await browser?.close();
  server?.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
});

test("the migrated journal serves the Astro site's pages, and its island counts clicks", async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/images/")) errors.push(`${r.status()} ${r.url()}`); });

  await page.goto(`${url}/`, { waitUntil: "networkidle" });
  assert.equal(await page.title(), "Home · Journal");
  assert.deepEqual(await page.$$eval("main li a", (as) => as.map((a) => a.textContent)), ["Seed swap", "First light"]);
  assert.equal(await page.textContent("footer"), "Written in the open.");

  await page.click("header >> text=Blog");
  await page.waitForFunction(() => document.querySelector("main h1")?.textContent === "Blog");
  assert.deepEqual(await page.$$eval("main time", (ts) => ts.map((t) => t.textContent)), ["2026-04-11", "2026-03-02"]);

  await page.goto(`${url}/blog/first-light`, { waitUntil: "networkidle" });
  assert.equal(await page.title(), "First light · Journal");
  assert.equal(await page.textContent("article b, article strong"), "crocuses");
  // The hero image moved to public/, which the host serves as files (this harness serves WordPress only).
  assert.equal(await page.$eval("article img", (img) => img.getAttribute("src")), "/images/first-light.svg");
  assert.equal(await page.textContent("article button"), "♥ 0");
  await page.click("article button");
  await page.click("article button");
  await page.waitForFunction(() => document.querySelector("article button")?.textContent === "♥ 2");

  await page.goto(`${url}/about`, { waitUntil: "networkidle" });
  assert.match(await page.title(), /^About/);
  assert.match(await page.textContent("body"), /written by one person/);
  assert.deepEqual(errors, []);
  await page.close();
});
