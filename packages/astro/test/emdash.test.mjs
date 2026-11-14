// @first/astro/emdash against a real First site: test/emdash-fixture built with `first build` and
// served on WordPress-on-SQLite (tests/php/wp.php serve). Each part of the `emdash` API EmDash's
// templates call is checked against what the site holds, then a real `astro build` of
// test/emdash-site, which imports only from "emdash", renders it.
//
//   node --test packages/astro/test/emdash.test.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const bin = process.env.FIRST_BIN ?? join(repo, "target/debug/first");
const work = mkdtempSync(join(tmpdir(), "first-emdash-"));
let site;
let server;
let emdash; // the `emdash` module
let ids = {};

async function api(method, path, body) {
  const headers = { accept: "application/json", authorization: `Basic ${btoa(site.users.admin.appPassword)}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(path.startsWith("/wp-json") ? `${site.url}${path}` : `${site.url}/__first/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(json)}`);
  return json.data ?? json;
}

before(async () => {
  assert.ok(existsSync(bin), `build the compiler first (cargo build --bin first), or set FIRST_BIN; ${bin} is missing`);
  const project = join(work, "app");
  cpSync(join(here, "emdash-fixture"), project, { recursive: true });
  const built = spawnSync(bin, ["build", project, "--quiet"], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  server = spawn("php", ["-d", "memory_limit=512M", join(repo, "tests/php/wp.php"), "serve", join(project, "first/dist/wp-content")], {
    env: { ...process.env, FIRST_WP_CLI: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  site = JSON.parse(await new Promise((ok, fail) => {
    createInterface({ input: server.stdout }).once("line", ok);
    server.once("exit", (code) => fail(new Error(`wp.php serve exited ${code}`)));
  }));
  const wp = (...args) => {
    const out = spawnSync("php", ["-d", "memory_limit=512M", site.wpCli.phar, `--path=${site.wpCli.path}`, `--url=${site.url}`, ...args], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    return out.stdout.trim();
  };
  wp("option", "update", "blogname", "The Journal");
  wp("option", "update", "blogdescription", "Notes from the field");
  // A primary menu location (the templates' `getMenuWithCacheHint("primary")`), as a theme registers it.
  mkdirSync(join(site.dir, "content/mu-plugins"), { recursive: true });
  writeFileSync(join(site.dir, "content/mu-plugins/menu.php"), "<?php add_action('after_setup_theme', static fn () => register_nav_menu('primary', 'Primary'));\n");
  wp("eval", "$m = wp_create_nav_menu('Main'); wp_update_nav_menu_item($m, 0, ['menu-item-title' => 'Home', 'menu-item-url' => home_url('/'), 'menu-item-type' => 'custom', 'menu-item-status' => 'publish']); set_theme_mod('nav_menu_locations', ['primary' => $m]);");

  const first = await api("POST", "/posts", {
    title: "First light", excerpt: "The garden in March.", status: "published", seoTitle: "SEO first light",
    body: "<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">Crocuses</h2>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>Up at <strong>last</strong> &amp; early.</p>\n<!-- /wp:paragraph -->",
  });
  const second = await api("POST", "/posts", { title: "Seed swap", excerpt: "Twelve packets.", status: "published", body: "<!-- wp:paragraph --><p>Beans.</p><!-- /wp:paragraph -->" });
  const draft = await api("POST", "/posts", { title: "Unfinished", status: "draft" });
  await api("POST", "/pages", { title: "About", body: "<!-- wp:paragraph --><p>Who writes this.</p><!-- /wp:paragraph -->", status: "published" });
  await api("PATCH", "/widgets", { areas: [{ name: "footer", widgets: [{ type: "content", title: "About", content: [{ _type: "block", children: [{ _type: "span", text: "A footer from wp-admin." }] }] }] }] });
  await api("POST", "/wp-json/wp/v2/comments", { post: first.id, content: "Lovely.", author_name: "Reader", author_email: "r@example.test", status: "approved" });
  await api("POST", "/wp-json/wp/v2/comments", { post: first.id, content: "Held.", author_name: "Spam", author_email: "s@example.test", status: "hold" });
  ids = { first: first.id, second: second.id, draft: draft.id };
  process.env.FIRST_URL = site.url;
  emdash = await import("../src/emdash/client.js");
});

after(() => {
  server?.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
});

test("getEmDashCollection and getEmDashEntry read published posts in the templates' shape", async () => {
  const { entries, nextCursor } = await emdash.getEmDashCollection("posts", { limit: 1 });
  assert.equal(entries.length, 1);
  assert.equal(nextCursor, "1");
  const next = await emdash.getEmDashCollection("posts", { limit: 1, cursor: nextCursor });
  assert.equal(next.nextCursor, undefined);
  const all = (await emdash.getEmDashCollection("posts")).entries.map((e) => e.id).sort();
  assert.deepEqual(all, ["first-light", "seed-swap"], "drafts stay out");

  const { entry } = await emdash.getEmDashEntry("posts", "first-light");
  assert.equal(entry.id, "first-light");
  assert.equal(entry.data.id, String(ids.first));
  assert.equal(entry.data.title, "First light");
  assert.equal(entry.data.excerpt, "The garden in March.");
  assert.equal(entry.data.seoTitle, "SEO first light");
  assert.ok(entry.data.publishedAt instanceof Date && entry.data.updatedAt instanceof Date);
  assert.deepEqual(entry.data.terms, { tag: [], category: [] }, "no taxonomies on this app: empty");
  // WordPress's rendered HTML as blocks: the heading has its style and text, each block its HTML.
  const [heading, paragraph] = entry.data.content;
  assert.equal(heading.style, "h2");
  assert.equal(heading.children[0].text, "Crocuses");
  assert.match(heading._html, /^<h2 class="wp-block-heading">Crocuses<\/h2>$/);
  assert.equal(paragraph.children[0].text, "Up at last & early.");
  assert.match(paragraph._html, /<strong>last<\/strong>/);

  assert.equal((await emdash.getEmDashEntry("posts", "unfinished")).entry, null, "a draft without a preview token is no entry");
  assert.equal((await emdash.getEmDashEntry("posts", "no-such-post")).entry, null);
  assert.equal((await emdash.getEmDashEntry("pages", "about")).entry.data.title, "About");
});

test("site settings, the menu, widgets, terms and search come from WordPress", async () => {
  const settings = await emdash.getSiteSettings();
  assert.deepEqual({ title: settings.title, tagline: settings.tagline }, { title: "The Journal", tagline: "Notes from the field" });
  const { data: menu } = await emdash.getMenuWithCacheHint("primary");
  assert.deepEqual(menu.items.map((i) => i.label), ["Home"]);
  assert.equal((await emdash.getMenuWithCacheHint("footer")).data, null);
  const areas = await emdash.getWidgetAreas();
  assert.equal(areas[0].widgets[0].content[0].children[0].text, "A footer from wp-admin.");
  assert.deepEqual((await emdash.getTaxonomyTermsWithCacheHint("tag")).data, [], "an app without the taxonomy: empty");
  const found = await emdash.search("seed", { collections: ["posts"], limit: 5 });
  assert.deepEqual(found.items.map((i) => i.slug), ["seed-swap"]);
  assert.equal(found.items[0].snippet, "<mark>Seed</mark> swap");
  assert.deepEqual((await emdash.search("unfinished", { collections: ["posts"], limit: 5 })).items, []);
});

test("comments are the approved ones, threaded by parent; open follows the post", async () => {
  const { open, items } = await emdash.getComments(String(ids.first));
  assert.equal(open, true);
  assert.deepEqual(items.map((c) => [c.author, c.parent]), [["Reader", "0"]]);
  assert.match(items[0].html, /Lovely\./);
  await api("POST", `/wp-json/wp/v2/first_posts/${ids.first}`, { comment_status: "closed" });
  assert.equal((await emdash.getComments(String(ids.first))).open, false);
});

test("a draft reads through a signed preview link, and only with it", async () => {
  await api("PATCH", `/posts/${ids.draft}/staged`, { title: "Unfinished, staged" });
  const link = await api("POST", `/posts/${ids.draft}/staged/preview`, {});
  const { requestContext } = await import("../src/emdash/context.js");
  const read = (token) => requestContext.run({ preview: token }, () => emdash.getEmDashEntry("posts", "unfinished"));
  const { entry } = await read(link.token);
  assert.equal(entry?.data.title, "Unfinished, staged");
  assert.equal((await read(link.token.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).entry, null, "a forged token reads nothing");
  assert.equal((await requestContext.run({ preview: link.token }, () => emdash.getEmDashEntry("posts", "seed-swap"))).entry.data.title, "Seed swap");
  assert.equal((await requestContext.run({ preview: link.token }, () => emdash.getComments(String(ids.draft)))).open, false);
});

test("the session is the signed-in WordPress user, from the visitor's cookie", async () => {
  assert.deepEqual(await emdash.getSession(undefined), { user: null });
  assert.deepEqual(await emdash.getSession("wordpress_logged_in_x=forged"), { user: null });
});

test("astro build of a page written against \"emdash\" renders the site", { timeout: 300_000 }, () => {
  const out = join(work, "site");
  const run = spawnSync(process.execPath, [join(here, "../node_modules/astro/bin/astro.mjs"), "build", "--root", join(here, "emdash-site")], {
    cwd: join(here, "emdash-site"),
    env: { ...process.env, FIRST_URL: site.url, ASTRO_TELEMETRY_DISABLED: "1", ASTRO_TEST_OUT: out },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const index = readFileSync(join(out, "dist/index.html"), "utf8");
  assert.match(index, /<h1>The Journal<\/h1>/);
  assert.match(index, /href="\/posts\/first-light"/);
  assert.match(index, /A footer from wp-admin\./);
  const post = readFileSync(join(out, "dist/posts/first-light/index.html"), "utf8");
  assert.match(post, /<h2 class="wp-block-heading">Crocuses<\/h2>/);
  assert.match(post, /class="headings">Crocuses</);
});
