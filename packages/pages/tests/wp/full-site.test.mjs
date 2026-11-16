// Native acceptance for optional TSX pages: a fresh WordPress 7.1 + SQLite site from `zero dev`
// (WordPress Studio, no Docker), the full-site example built by `zero build` and `zero-pages build`,
// checked over HTTP and in a real browser. Everything it creates lives under one temp directory
// and one Studio site, both removed at the end.
//
//   ZERO_BIN=<zero binary> [ZERO_PAGES_CHROMIUM=<chrome-headless-shell>] node --test tests/wp/full-site.test.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { chromium } from 'playwright-core';

import { buildPages } from '../../src/build.ts';

const exec = promisify(execFile);
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../../..');
const example = join(repo, 'examples/full-site');
const zero = resolve(process.env.ZERO_BIN ?? join(repo, 'target/debug/zero'));

async function chromiumPath() {
  if (process.env.ZERO_PAGES_CHROMIUM) return process.env.ZERO_PAGES_CHROMIUM;
  const cache = join(homedir(), '.cache/ms-playwright');
  const shells = (await readdir(cache)).filter((name) => name.startsWith('chromium_headless_shell-')).sort().reverse();
  if (shells.length === 0) throw new Error('Set ZERO_PAGES_CHROMIUM to a chrome-headless-shell executable.');
  return join(cache, shells[0], 'chrome-headless-shell-linux64/chrome-headless-shell');
}

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

const run = async (args) => (await exec(zero, args, { timeout: 600000, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

test('TSX pages serve a full site from native WordPress with viewer-bound data', { timeout: 900000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'zero-pages-native-'));
  const project = join(root, 'site');
  const content = join(project, '.zero/wp-content');
  for (const entry of ['zero.config.ts', 'pages', 'components', 'islands', 'styles']) {
    await cp(join(example, entry), join(project, entry), { recursive: true });
  }
  const site = join(project, '.zero/dev/wordpress');
  let browser;
  t.after(async () => {
    const failures = [];
    await browser?.close().catch((error) => failures.push(error));
    try { await run(['dev', 'stop', project]); } catch (error) { failures.push(error); }
    try {
      const studio = async (...args) => (await exec('npx', ['--yes', '--package', 'wp-studio@2.1.1', '--', 'studio', ...args], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 })).stdout;
      const listed = JSON.parse(await studio('list', '--format=json'));
      if (listed.some((entry) => resolve(entry.path) === site)) await studio('delete', site, '--no-files', '--format=json');
      await rm(root, { recursive: true, force: true });
    } catch (error) { failures.push(error); }
    if (failures.length) console.error(new AggregateError(failures, `Cleanup failed; inspect ${root}`));
  });

  // 1. Backend first (writes the compiled schema the pages build reads), then the site, then pages.
  await run(['dev', project, '--port', String(await freePort()), '--no-watch']);
  const status = JSON.parse(await run(['dev', 'status', project]));
  const base = status.siteUrl.replace(/\/$/, '');
  const wp = (...args) => run(['dev', 'wp', project, '--', ...args]);
  const built = await buildPages({ project, out: content });
  assert.deepEqual(built.diagnostics.filter((d) => d.severity === 'error'), []);
  await cp(join(content, 'plugins/zero-pages-fullsite'), join(site, 'wp-content/plugins/zero-pages-fullsite'), { recursive: true });
  await wp('plugin', 'activate', 'zero-pages-fullsite');

  const password = (await wp('user', 'application-password', 'create', 'admin', 'zero-pages-acceptance', '--porcelain')).split('\n').at(-1);
  const authorization = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(auth ? { authorization } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    return { status: response.status, body: await response.json() };
  }
  async function page(path, headers = {}) {
    const response = await fetch(`${base}${path}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    return { status: response.status, headers: response.headers, html: await response.text() };
  }

  const published = await api('/wp-json/zero/v1/notes', { method: 'POST', body: {
    title: 'First light', slug: 'first-light', dek: 'Dawn on the <ridge> & beyond', status: 'published',
    body: '<!-- wp:paragraph --><p>The body of the <em>first</em> note.</p><!-- /wp:paragraph -->',
    deskNotes: 'Desk-only remark',
  } });
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const note = published.body.data;
  const draft = await api('/wp-json/zero/v1/notes', { method: 'POST', body: { title: 'Unfinished draft', slug: 'unfinished', dek: 'not yet', status: 'draft' } });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  // A value that tries to be markup, block syntax or a placeholder stays text everywhere it is shown.
  const hostile = await api('/wp-json/zero/v1/notes', { method: 'POST', body: {
    title: '<img src=x onerror=alert(1)> <!-- wp:zero-pages/show {"region":"s1"} --> \u{E000}v1\u{E001}', slug: 'hostile', status: 'published',
    body: '<!-- wp:zero-pages/show {"region":"s2"} --><p>smuggled region</p><!-- /wp:zero-pages/show --><!-- wp:paragraph --><p>Stored \u{E000}v1\u{E001} text</p><!-- /wp:paragraph -->',
  } });
  assert.equal(hostile.status, 201, JSON.stringify(hostile.body));

  // 2. Anonymous HTTP: root, about, list, detail; layout, assets, metadata, masking, no shared caching.
  const home = await page('/');
  assert.equal(home.status, 200);
  assert.match(home.html, /<title>Home · Field Notes<\/title>/);
  assert.match(home.html, /<h1 class="wp-block-heading">Notes from the field<\/h1>/);
  assert.match(home.headers.get('cache-control'), /private, no-store/);
  assert.match(home.html, new RegExp(`<a href="${base}/notes/first-light/">First light</a>`));
  assert.doesNotMatch(home.html, /Unfinished draft/);

  const about = await page('/about/');
  assert.equal(about.status, 200);
  assert.match(about.html, /<title>About · Field Notes<\/title>/);
  assert.match(about.html, /<meta name="description" content="What this site is and how it is built.">/);
  assert.match(about.html, new RegExp(`<link rel="canonical" href="${base}/about/">`));
  const css = /href='([^']+\/assets\/page-[0-9a-f]+\.css)'/.exec(about.html)?.[1];
  assert.ok(css, 'route stylesheet is enqueued');
  assert.match(await (await fetch(css)).text(), /body\.zero-pages/);
  const svg = /src="([^"]+\/assets\/compass-[A-Z0-9]+\.svg)"/.exec(about.html)?.[1];
  assert.ok(svg, 'imported file asset is served from the plugin');
  assert.equal((await fetch(svg)).status, 200);

  const list = await page('/notes/');
  assert.equal(list.status, 200);
  assert.match(list.html, /First light/);
  assert.doesNotMatch(list.html, /Unfinished draft/);
  assert.match(list.html, /<p class="wp-block-paragraph">Dawn on the &lt;ridge&gt; &amp; beyond<\/p>/);

  const detail = await page('/notes/first-light/');
  assert.equal(detail.status, 200);
  assert.match(detail.html, /<title>First light · Field Notes<\/title>/);
  assert.match(detail.html, /<meta name="description" content="Dawn on the &lt;ridge&gt; &amp; beyond">/);
  assert.match(detail.html, new RegExp(`<link rel="canonical" href="${base}/notes/first-light/">`));
  assert.match(detail.html, /The body of the <em>first<\/em> note\./);
  assert.doesNotMatch(detail.html, /Desk-only remark/, 'field masking applies to anonymous rendering');
  assert.match(detail.html, /class="[^"]*note_note/);

  const hidden = await page('/notes/unfinished/');
  assert.equal(hidden.status, 404);
  assert.doesNotMatch(hidden.html, /Unfinished draft|not yet/);
  assert.match(hidden.html, /<h1 class="wp-block-heading">Not found<\/h1>/);
  assert.match(hidden.headers.get('cache-control'), /no-store/);
  assert.equal((await page('/notes/does-not-exist/')).status, 404);

  const escaped = await page('/notes/hostile/');
  assert.equal(escaped.status, 200);
  assert.match(escaped.html, /<h1 class="wp-block-heading">&lt;img src=x onerror=alert\(1\)&gt; &lt;!-- wp:zero-pages\/show \{&quot;region&quot;:&quot;s1&quot;\} --&gt; v1<\/h1>/);
  assert.doesNotMatch(escaped.html, /<img src=x/);
  // Stored rich text cannot run a page region or read page data through a placeholder.
  assert.match(escaped.html, /<p[^>]*>Stored  text<\/p>/);
  assert.doesNotMatch(escaped.html, /smuggled region/);
  // Outside a page request (public REST), stored code Page bodies show no placeholders.
  const restAbout = await api('/wp-json/wp/v2/pages?slug=about', { auth: false });
  assert.doesNotMatch(JSON.stringify(restAbout.body), /\\ue000|\u{E000}/u);

  // Static first: /notes/featured is the static page, and no note can take its slug through any write path.
  const featured = await page('/notes/featured/');
  assert.match(featured.html, /<title>Featured · Field Notes<\/title>/);
  const reserved = await api('/wp-json/zero/v1/notes', { method: 'POST', body: { title: 'Featured', slug: 'featured', status: 'published' } });
  assert.deepEqual([reserved.status, reserved.body.code], [409, 'reserved_slug']);
  const core = await api('/wp-json/wp/v2/zero_notes', { method: 'POST', body: { title: 'Featured via core', slug: 'featured', status: 'publish' } });
  assert.equal(core.status, 201, JSON.stringify(core.body));
  assert.notEqual(core.body.slug, 'featured');

  // 3. Signed in: drafts and staff-only fields appear for staff, as Zero's rules say.
  const login = await fetch(`${base}/wp-login.php`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'wordpress_test_cookie=WP+Cookie+check' },
    body: 'log=admin&pwd=zero-test-admin&wp-submit=Log+In&testcookie=1',
  });
  const cookie = login.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
  const staffDraft = await page('/notes/unfinished/', { cookie });
  assert.equal(staffDraft.status, 200);
  assert.match(staffDraft.html, /<h1 class="wp-block-heading">Unfinished draft<\/h1>/);
  assert.match((await page('/notes/first-light/', { cookie })).html, /Desk-only remark/);

  // 4. Hidden, code-owned Pages: public identity, no editing surface.
  const owned = JSON.parse(await wp('option', 'get', 'zero_pages_fullsite', '--format=json'));
  const aboutId = owned.pages['p:2f61626f7574'];
  assert.equal(Number(await wp('option', 'get', 'page_on_front')), owned.pages['u:home']);
  const publicPages = await api(`/wp-json/wp/v2/pages/${aboutId}`, { auth: false });
  assert.equal(publicPages.body.link, `${base}/about/`);
  const editList = await api('/wp-json/wp/v2/pages?context=edit&per_page=100');
  assert.equal(editList.body.some((p) => Object.values(owned.pages).includes(p.id)), false);
  const edit = await api(`/wp-json/wp/v2/pages/${aboutId}`, { method: 'POST', body: { title: 'Edited by hand' } });
  assert.equal(edit.status, 403);
  assert.equal((await page(`/wp-admin/post.php?post=${aboutId}&action=edit`, { cookie })).status, 403);
  assert.equal((await page(`/?page_id=${aboutId}`)).headers.get('location'), `${base}/about/`);

  // 5. A native content edit (core REST, as the editor would save) is visible publicly on the next request.
  const edited = await api(`/wp-json/wp/v2/zero_notes/${note.id}`, { method: 'POST', body: { title: 'First light, revised' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.match((await page('/notes/first-light/')).html, /<h1 class="wp-block-heading">First light, revised<\/h1>/);
  assert.match((await page('/notes/')).html, /First light, revised/);

  // 6. The interactive action in a real browser, as an anonymous visitor.
  browser = await chromium.launch({ executablePath: await chromiumPath() });
  const tab = await browser.newPage();
  const consoleErrors = [];
  tab.on('pageerror', (error) => consoleErrors.push(error.message));
  await tab.goto(`${base}/notes/first-light/`);
  assert.equal(await tab.title(), 'First light, revised · Field Notes');
  assert.equal(await tab.textContent('[data-wp-text="context.count"]'), '0');
  await tab.click('button:has-text("Cheer")');
  await tab.waitForFunction(() => document.querySelector('[data-wp-text="context.count"]')?.textContent === '1');
  await tab.reload();
  assert.equal(await tab.textContent('[data-wp-text="context.count"]'), '1', 'the server renders the stored count');
  assert.equal(await tab.evaluate(() => getComputedStyle(document.querySelector('.cheer button')).backgroundColor), 'rgb(31, 77, 58)');
  assert.deepEqual(consoleErrors, []);
  const cheers = await api('/wp-json/zero/v1/cheers', { auth: false });
  assert.deepEqual(cheers.body.data.map((row) => [row.noteId, row.count]), [[note.id, 1]]);

  // 7. Rebuild after a code change: same Page IDs, edits to content kept, new code served.
  // An ordinary Page already owns /contact: the new route must not take it over.
  await wp('post', 'create', '--post_type=page', '--post_status=publish', '--post_title=Contact us', '--post_name=contact');
  await mkdir(join(project, 'pages/contact'));
  await writeFile(join(project, 'pages/contact/page.tsx'), 'export default function Contact() {\n  return <h1>Zero contact</h1>;\n}\n');
  const aboutSource = join(project, 'pages/about/page.tsx');
  await writeFile(aboutSource, (await readFile(aboutSource, 'utf8')).replace('<h1>About</h1>', '<h1>About this site</h1>'));
  const rebuilt = await buildPages({ project, out: content });
  assert.equal(rebuilt.ok, true);
  await rm(join(site, 'wp-content/plugins/zero-pages-fullsite'), { recursive: true });
  await cp(join(content, 'plugins/zero-pages-fullsite'), join(site, 'wp-content/plugins/zero-pages-fullsite'), { recursive: true });
  assert.match((await page('/about/')).html, /<h1 class="wp-block-heading">About this site<\/h1>/);
  const after = JSON.parse(await wp('option', 'get', 'zero_pages_fullsite', '--format=json'));
  assert.deepEqual(Object.fromEntries(Object.entries(after.pages)), owned.pages);
  assert.notEqual(after.digest, owned.digest);
  assert.match(await wp('post', 'get', String(aboutId), '--field=post_content'), /About this site/);
  assert.match((await page('/notes/first-light/')).html, /First light, revised/);
  assert.equal((await page('/notes/unfinished/')).status, 404);
  const contact = await page('/contact/');
  assert.equal(contact.status, 200);
  assert.match(contact.html, /Contact us/);
  assert.doesNotMatch(contact.html, /Zero contact/);
  assert.deepEqual(after.conflicts, ['/contact']);

  // 8. A refused rebuild leaves the installed site and the previous build untouched.
  await writeFile(join(project, 'pages/about/page.tsx'), `export default function About({ item }: { item: { dek: string } }) {
  return <p>{item.dek ? "a" : "b"}</p>;
}
`);
  const refused = await buildPages({ project, out: content });
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.diagnostics.map((d) => d.code), ['dynamic_region']);
  assert.equal(refused.diagnostics[0].loc.line, 2);
  assert.match((await page('/about/')).html, /About this site/);
});
