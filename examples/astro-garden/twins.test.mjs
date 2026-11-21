// examples/garden and examples/astro-garden render the same site: one as a TypedPress app (tp/app/,
// PHP in WordPress), one as an Astro site reading that TypedPress app with @typedpress/astro. This builds the
// TypedPress app, seeds its plants from content/plants/ as a publish does, serves it on
// WordPress-on-SQLite, builds the Astro site against it, and reads both in Chromium: the same
// list, the same plant pages, the same text. Then an editor's change shows on both, the Astro
// side after a rebuild that pulls only the changed plant.
//
// Needs the `typedpress` binary (TP_BIN, default target/debug/typedpress), PHP 8.2+ with pdo_sqlite, Node
// 22.23.4+ (Astro 7.4), `npm ci` here and in tests/differential/client, and Chromium's headless
// shell (npx --prefix tests/differential/client playwright-core install chromium-headless-shell).
// Set CHROMIUM to use a different installed browser executable.
//
//   node --test examples/astro-garden/twins.test.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const bin = process.env.TP_BIN ?? join(repo, "target/debug/typedpress");
const { chromium } = createRequire(join(repo, "tests/differential/client/package.json"))("playwright-core");

const work = mkdtempSync(join(tmpdir(), "typedpress-garden-"));
let site; // the TypedPress app: { url, users }
let server;
let astro; // a static server for the Astro build: { url, close }
let browser;

function first(...args) {
  const out = spawnSync(bin, args, { encoding: "utf8" });
  assert.equal(out.status, 0, `first ${args.join(" ")}: ${out.stdout}${out.stderr}`);
}

function buildAstro() {
  const out = spawnSync(process.execPath, [join(here, "node_modules/astro/bin/astro.mjs"), "build", "--root", here], {
    cwd: here,
    env: { ...process.env, TP_URL: site.url, ASTRO_TELEMETRY_DISABLED: "1", ASTRO_OUT_DIR: join(work, "astro/dist") },
    encoding: "utf8",
  });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  return out.stdout + out.stderr;
}

/** `astro preview` stays in the background; a plain static server stops with the test. */
async function serveStatic(root) {
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };
  const http = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    for (const file of [join(root, path), join(root, path, "index.html")]) {
      if (!file.startsWith(root)) break;
      try {
        const body = await readFile(file);
        return res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
      } catch {
        // next candidate
      }
    }
    res.writeHead(404).end("not found");
  });
  await new Promise((r) => http.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${http.address().port}`, close: () => http.close() };
}

before(async () => {
  assert.ok(existsSync(bin), `build the compiler first (cargo build --bin typedpress), or set TP_BIN; ${bin} is missing`);
  const project = join(work, "garden");
  cpSync(join(repo, "examples/garden"), project, { recursive: true });
  first("build", project, "--quiet");
  // What a publish does: capture the sources, compile them with the synced content as seed records.
  first("sources", project, "--out", join(work, "sources"));
  first("compile-sources", join(work, "sources"), join(work, "compiled"), project);

  server = spawn("php", ["-d", "memory_limit=512M", join(repo, "tests/php/wp.php"), "serve", join(project, "tp/dist/wp-content")], {
    env: { ...process.env, TP_WP_THEMES: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  site = JSON.parse(await new Promise((ok, fail) => {
    createInterface({ input: server.stdout }).once("line", ok);
    server.once("exit", (code) => fail(new Error(`wp.php serve exited ${code}`)));
  }));
  // Seed the plants as the publish's seed step does, through the site's own WP-CLI-free seam.
  const seed = spawnSync("php", ["-d", "memory_limit=512M", "-r", "require $argv[1]; wpLoad($argv[2]); \\TypedPress\\Sync\\Seed::run(\\TypedPress\\Wp\\Runtime::plugin(), $argv[3]);",
    join(repo, "tests/php/wp.php"), site.dir, join(work, "compiled/seed")], { encoding: "utf8" });
  assert.equal(seed.status, 0, seed.stdout + seed.stderr);
  // Give this fixture a non-default Site Editor color, so inheritance cannot pass by coincidence.
  const theme = spawnSync("php", ["-d", "memory_limit=512M", "-r", `
    require $argv[1]; wpLoad($argv[2]); wp_set_current_user(1);
    $data = WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles(wp_get_theme(), true);
    $content = ['version' => 3, 'isGlobalStylesUserThemeJSON' => true,
      'styles' => ['elements' => ['link' => ['color' => ['text' => '#126644']]]]];
    $result = wp_update_post(['ID' => (int) $data['ID'], 'post_content' => wp_slash(wp_json_encode($content))], true);
    if (is_wp_error($result)) throw new RuntimeException($result->get_error_message());
  `, join(repo, "tests/php/wp.php"), site.dir], { encoding: "utf8" });
  assert.equal(theme.status, 0, theme.stdout + theme.stderr);

  buildAstro();
  astro = await serveStatic(join(work, "astro/dist"));
  let executablePath = process.env.CHROMIUM;
  if (!executablePath) {
    const cache = join(homedir(), ".cache/ms-playwright");
    const shell = readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse()[0];
    executablePath = join(cache, shell, "chrome-headless-shell-linux64/chrome-headless-shell");
  }
  browser = await chromium.launch({ executablePath });
});

after(async () => {
  await browser?.close();
  astro?.close();
  server?.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
});

/** What a reader sees of the site, read by clicking through it as one would. */
async function read(base) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  try {
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    const home = {
      title: await page.title(),
      h1: await page.textContent("main h1"),
      plants: await page.$$eval(".plants li", (lis) => lis.map((li) => [li.querySelector("a").textContent, li.querySelector(".family").textContent, li.querySelector("p")?.textContent ?? null])),
    };
    await page.click("text=Lavender");
    await page.waitForSelector("article.plant h1");
    const lavender = {
      path: new URL(page.url()).pathname.replace(/\/$/, ""),
      title: await page.title(),
      h1: await page.textContent("article.plant h1"),
      meta: await page.textContent(".meta"),
      bold: await page.textContent("article.plant b"),
      h2: await page.textContent("article.plant h2"),
    };
    const styles = await page.$eval(".masthead a", (a) => {
      const accent = getComputedStyle(a).color;
      if (!getComputedStyle(a).getPropertyValue("--tp--color--link").trim()) return { accent, themeLink: null };
      const probe = document.createElement("span");
      probe.style.color = "var(--tp--color--link)";
      a.parentElement.append(probe);
      const themeLink = getComputedStyle(probe).color;
      probe.remove();
      return { accent, themeLink };
    });
    // After a full load: TypedPress's region navigation swaps the title, not the other head tags.
    await page.goto(`${base}/plants/lavender`, { waitUntil: "networkidle" });
    lavender.description = await page.$eval("meta[name=description]", (m) => m.content);
    await page.click("text=← All plants");
    await page.waitForSelector(".plants");
    await page.goto(`${base}/plants/sweet-pea`, { waitUntil: "networkidle" });
    const sweetPea = { h1: await page.textContent("article.plant h1"), meta: await page.textContent(".meta") };
    return { home, lavender, sweetPea, errors, styles };
  } finally {
    await page.close();
  }
}

test("the TypedPress app and the Astro site render the same content with their own styles", async () => {
  const { styles: nativeStyles, ...native } = await read(site.url);
  const { styles: astroStyles, ...onAstro } = await read(astro.url);
  assert.notEqual(nativeStyles.themeLink, null, "the native app must receive WordPress theme colors");
  assert.equal(nativeStyles.themeLink, "rgb(18, 102, 68)", "the active theme exposes the Site Editor value");
  assert.equal(nativeStyles.accent, nativeStyles.themeLink, "the native app inherits its active WordPress theme");
  assert.equal(astroStyles.accent, "rgb(47, 125, 50)", "Astro keeps its stylesheet's palette");
  assert.deepEqual(native.errors, []);
  assert.deepEqual(onAstro.errors, []);
  assert.deepEqual(native.home, {
    title: "Plants · Garden",
    h1: "Plants",
    plants: [
      ["Lavender", "Lamiaceae", "A dry-garden shrub with scented flower spikes."],
      ["Rosemary", "Lamiaceae", "An evergreen herb for a sunny wall."],
      ["Sweet pea", "Fabaceae", "A climbing annual grown for its scent."],
    ],
  });
  assert.deepEqual(native.lavender, {
    path: "/plants/lavender",
    title: "Lavender · Garden",
    h1: "Lavender",
    meta: "Lamiaceae · up to 60 cm",
    bold: "after flowering",
    h2: "Planting",
    description: "A dry-garden shrub with scented flower spikes.",
  });
  assert.deepEqual(native.sweetPea, { h1: "Sweet pea", meta: "Fabaceae" });
  assert.deepEqual(onAstro, native, "the Astro twin reads the same");
});

test("an editor's change shows on the TypedPress app at once, and on the Astro site after a rebuild that pulls only that plant", async () => {
  const auth = { authorization: `Basic ${btoa(site.users.admin.appPassword)}`, "content-type": "application/json" };
  const [plant] = (await (await fetch(`${site.url}/__tp/api/v1/plants?where=${encodeURIComponent('{"slug":"rosemary"}')}`)).json()).data;
  const patched = await fetch(`${site.url}/__tp/api/v1/plants/${plant.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ summary: "Edited in wp-admin." }) });
  assert.equal(patched.status, 200);
  const summary = async (base) => {
    const page = await browser.newPage();
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    const text = await page.$eval(".plants li:nth-child(2) p", (p) => p.textContent);
    await page.close();
    return text;
  };
  assert.equal(await summary(site.url), "Edited in wp-admin.");
  assert.equal(await summary(astro.url), "An evergreen herb for a sunny wall.", "a static build shows what it was built from");
  const log = buildAstro();
  assert.match(log, /plants: 1 changed, 0 removed, 3 entries, 0 of 1 pages not modified/);
  assert.equal(await summary(astro.url), "Edited in wp-admin.");
});
