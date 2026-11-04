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
  const config = join(project, 'zero.config.ts');
  await writeFile(config, (await readFile(config, 'utf8'))
    .replace('title: text().notNull().min(1).max(120),', 'title: text().notNull().min(1).max(120),\n  kind: text(),\n  then: text(),')
    .replace('body: richText(),', 'body: richText().access({ read: (ctx) => ctx.user?.role === "admin" || ctx.data.slug !== "masked-body" }),')
    .replace('count: integer().notNull().default(0),', 'count: integer().notNull().default(0),\n  label: text().notNull().default(""),'));
  const detailSource = join(project, 'pages/notes/[slug]/page.tsx');
  await writeFile(detailSource, (await readFile(detailSource, 'utf8'))
    .replace('return { cheers };', 'const fallbackNote = content.query.notes.findFirst({ where: { dek: orElse(item.dek, "Fallback query sentinel") } });\n  return { cheers, fallbackNote, then: item.then };')
    .replace('NotePage({ item, cheers }: Props)', 'NotePage({ item, cheers, fallbackNote, then }: Props)')
    .replace('<RichText value={item.body} />', `<Show when={orElse(item.dek, "fallback")}><p className="fallback-truthy">Truthy fallback</p></Show>
      <Show when={orElse(item.dek, "fallback")} is="fallback"><p className="fallback-equals">Default summary</p></Show>
      <Show when={orElse(cheers.label, "fallback")}><p className="fallback-empty">No applause label yet</p></Show>
      <p className="fallback-query">{fallbackNote.title}</p>
      <p className="schema-probes">{item.kind} | {then}</p>
      <RichText value={item.body} />`));
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
      const remaining = JSON.parse(await studio('list', '--format=json'));
      assert.equal(remaining.some((entry) => resolve(entry.path) === site), false, 'owned Studio registration is removed');
      await rm(root, { recursive: true, force: true });
    } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, `Cleanup failed; inspect ${root}`);
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
  await mkdir(join(site, 'wp-content/mu-plugins'), { recursive: true });
  await writeFile(join(site, 'wp-content/mu-plugins/zero-pages-test-context.php'), `<?php
add_action('wp_head', static function (): void {
    $context = ['id' => get_the_ID(), 'queried' => get_queried_object_id(), 'notFound' => is_404(), 'singular' => is_singular(), 'type' => get_post_type(), 'title' => get_the_title()];
    echo '<meta name="zero-pages-test-context" content="' . esc_attr(base64_encode(wp_json_encode($context))) . '">';
    echo '<meta name="zero-pages-test-body" content="' . esc_attr(base64_encode(wp_json_encode(['content' => get_the_content(), 'excerpt' => get_the_excerpt()]))) . '">';
});
add_shortcode('zero_pages_test_context', static fn (): string => '<p class="zero-pages-test-context">' . get_the_ID() . ':' . esc_html(get_the_title()) . '</p>');
add_filter('wp_insert_post_empty_content', static function (bool $empty, array $data): bool {
    return $empty || (get_option('zero_pages_test_fail_write') && ($data['post_type'] ?? '') === 'page' && ($data['post_name'] ?? '') === 'about');
}, 10, 2);
`);

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
  function postContext(html) {
    const encoded = /<meta name="zero-pages-test-context" content="([^"]+)">/.exec(html)?.[1];
    assert.equal(typeof encoded, 'string', 'wp_head observed a routed post context');
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  }

  const published = await api('/wp-json/zero/v1/notes', { method: 'POST', body: {
    title: 'First light', slug: 'first-light', dek: 'Dawn on the <ridge> & beyond', status: 'published',
    body: '<!-- wp:paragraph --><p>The body of the <em>first</em> note.</p><!-- /wp:paragraph --><!-- wp:post-title {"isLink":true} /--><!-- wp:shortcode -->[zero_pages_test_context]<!-- /wp:shortcode -->',
    deskNotes: 'Desk-only remark',
    kind: 'Field report', then: 'Next observation',
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
  assert.match(detail.html, /class="[^"]*schema-probes[^"]*">Field report \| Next observation<\/p>/, 'schema fields remain data, including a loader prop named then');
  assert.match(detail.html, /<title>First light · Field Notes<\/title>/);
  assert.match(detail.html, /<meta name="description" content="Dawn on the &lt;ridge&gt; &amp; beyond">/);
  assert.match(detail.html, new RegExp(`<link rel="canonical" href="${base}/notes/first-light/">`));
  assert.match(detail.html, /The body of the <em>first<\/em> note\./);
  assert.doesNotMatch(detail.html, /Desk-only remark/, 'field masking applies to anonymous rendering');
  assert.match(detail.html, /class="[^"]*note_note/);
  assert.match(detail.html, /class="[^"]*fallback-truthy[^"]*">Truthy fallback<\/p>/);
  assert.doesNotMatch(detail.html, /class="[^"]*fallback-equals[^"]*"/);
  assert.match(detail.html, /class="[^"]*fallback-query[^"]*">First light<\/p>/, 'query options keep a nonempty field instead of its fallback');
  assert.deepEqual(postContext(detail.html), { id: note.id, queried: note.id, notFound: false, singular: true, type: 'zero_notes', title: 'First light' });
  assert.match(detail.html, new RegExp(`<h2 class="wp-block-post-title"><a href="${base}/notes/first-light/"[^>]*>First light</a></h2>`), 'native post-title block uses the routed item and its claimed permalink');
  assert.match(detail.html, new RegExp(`<p class="zero-pages-test-context">${note.id}:First light</p>`), 'shortcodes use the routed item');

  const fallbackMatch = await api('/wp-json/zero/v1/notes', { method: 'POST', body: {
    title: 'Matched default summary', slug: 'default-summary', dek: 'Fallback query sentinel', status: 'published',
  } });
  assert.equal(fallbackMatch.status, 201, JSON.stringify(fallbackMatch.body));
  const masked = await api('/wp-json/zero/v1/notes', { method: 'POST', body: {
    title: 'Masked body', slug: 'masked-body', status: 'published',
    body: '<!-- wp:paragraph --><p>Private body must stay hidden.</p><!-- /wp:paragraph -->',
  } });
  assert.equal(masked.status, 201, JSON.stringify(masked.body));
  const maskedPage = await page('/notes/masked-body/');
  assert.equal(maskedPage.status, 200);
  assert.doesNotMatch(maskedPage.html, /Private body must stay hidden/);
  assert.match(maskedPage.html, /class="[^"]*fallback-truthy[^"]*">Truthy fallback<\/p>/);
  assert.match(maskedPage.html, /class="[^"]*fallback-equals[^"]*">Default summary<\/p>/, 'Show uses the fallback for a null field');
  assert.match(maskedPage.html, /class="[^"]*fallback-query[^"]*">Matched default summary<\/p>/, 'query options bind the fallback for a null field');
  const nativeBody = /<meta name="zero-pages-test-body" content="([^"]+)">/.exec(maskedPage.html)?.[1];
  assert.equal(typeof nativeBody, 'string', 'native head hook read the visitor-projected post');
  assert.deepEqual(JSON.parse(Buffer.from(nativeBody, 'base64').toString('utf8')), { content: '', excerpt: '' });

  const hidden = await page('/notes/unfinished/');
  assert.equal(hidden.status, 404);
  assert.doesNotMatch(hidden.html, /Unfinished draft|not yet/);
  assert.match(hidden.html, /<h1 class="wp-block-heading">Not found<\/h1>/);
  assert.match(hidden.headers.get('cache-control'), /no-store/);
  assert.deepEqual(postContext(hidden.html), { id: false, queried: 0, notFound: true, singular: false, type: false, title: '' }, '404 head hooks cannot see an unrelated fallback post');
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
  assert.deepEqual(postContext(featured.html), { id: owned.pages['u:notes.featured'], queried: owned.pages['u:notes.featured'], notFound: false, singular: true, type: 'page', title: 'Featured' });
  assert.deepEqual(postContext(about.html), { id: aboutId, queried: aboutId, notFound: false, singular: true, type: 'page', title: 'About' });
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
  assert.equal(await tab.textContent('.fallback-empty'), 'No applause label yet', 'missing row uses the fallback in Show');
  await tab.click('button:has-text("Cheer")');
  await tab.waitForFunction(() => document.querySelector('[data-wp-text="context.count"]')?.textContent === '1');
  await tab.reload();
  assert.equal(await tab.textContent('[data-wp-text="context.count"]'), '1', 'the server renders the stored count');
  assert.equal(await tab.locator('.fallback-empty').count(), 0, 'an empty stored string remains false instead of using the fallback');
  assert.equal(await tab.evaluate(() => getComputedStyle(document.querySelector('.cheer button')).backgroundColor), 'rgb(31, 77, 58)');
  assert.deepEqual(consoleErrors, []);
  const cheers = await api('/wp-json/zero/v1/cheers', { auth: false });
  assert.deepEqual(cheers.body.data.map((row) => [row.noteId, row.count]), [[note.id, 1]]);

  // 7. Rebuild after a code change: same Page IDs, edits to content kept, new code served.
  // An ordinary Page already owns /contact: the new route must not take it over.
  const contactId = Number(await wp('post', 'create', '--post_type=page', '--post_status=publish', '--post_title=Contact us', '--post_name=contact', '--porcelain'));
  await mkdir(join(project, 'pages/contact'));
  await writeFile(join(project, 'pages/contact/page.tsx'), 'export default function Contact() {\n  return <h1>Zero contact</h1>;\n}\n');
  const aboutSource = join(project, 'pages/about/page.tsx');
  await writeFile(aboutSource, (await readFile(aboutSource, 'utf8')).replace('<h1>About</h1>', '<h1>About this site</h1>'));
  const rebuilt = await buildPages({ project, out: content });
  assert.equal(rebuilt.ok, true);
  await wp('option', 'update', 'zero_pages_test_fail_write', '1');
  await rm(join(site, 'wp-content/plugins/zero-pages-fullsite'), { recursive: true });
  await cp(join(content, 'plugins/zero-pages-fullsite'), join(site, 'wp-content/plugins/zero-pages-fullsite'), { recursive: true });
  assert.equal((await page('/about/')).status, 200, 'a managed Page write failure does not abort init');
  const failedState = JSON.parse(await wp('option', 'get', 'zero_pages_fullsite', '--format=json'));
  assert.equal(failedState.digest, owned.digest, 'a failed reconciliation does not commit the new digest');
  assert.deepEqual(failedState.pages, owned.pages);
  assert.deepEqual(failedState.conflicts, []);
  const contactDuringFailure = await page('/contact/');
  assert.equal(contactDuringFailure.status, 200);
  assert.match(contactDuringFailure.html, /Contact us/);
  assert.doesNotMatch(contactDuringFailure.html, /Zero contact/, 'a new route cannot claim native content while reconciliation is incomplete');
  assert.match(await wp('option', 'get', 'zero_pages_fullsite_error'), /Cannot write the Page for \/about:/);
  assert.equal(await wp('eval', 'echo get_option("zero_pages_lock_fullsite", false) === false ? "released" : "held";'), 'released');
  const nativeDuringFailure = await api('/wp-json/wp/v2/types/page', { auth: false });
  assert.equal(nativeDuringFailure.status, 200);
  assert.equal(nativeDuringFailure.body.slug, 'page', 'unrelated WordPress REST remains usable');
  const errorNotice = await wp('eval', 'wp_set_current_user(1); do_action("admin_notices");');
  assert.match(errorNotice, /Zero pages could not update its managed Pages/);
  assert.match(errorNotice, /Cannot write the Page for \/about:/);
  await wp('option', 'delete', 'zero_pages_test_fail_write');
  assert.match((await page('/about/')).html, /<h1 class="wp-block-heading">About this site<\/h1>/);
  assert.equal(await wp('eval', 'echo get_option("zero_pages_fullsite_error", false) === false ? "cleared" : "present";'), 'cleared', 'successful retry clears the persisted notice');
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
  await wp('post', 'delete', String(contactId), '--force');
  const recovered = await page('/contact/');
  assert.equal(recovered.status, 200);
  assert.match(recovered.html, /Zero contact/, 'removing conflicting native content makes the code route available without another build');
  const recoveredState = JSON.parse(await wp('option', 'get', 'zero_pages_fullsite', '--format=json'));
  assert.equal(recoveredState.digest, after.digest);
  assert.deepEqual(recoveredState.conflicts, []);
  assert.equal(postContext(recovered.html).queried, recoveredState.pages['p:2f636f6e74616374']);

  // A native front page selected after activation also keeps ownership without a code rebuild.
  const nativeFrontId = Number(await wp('post', 'create', '--post_type=page', '--post_status=publish', '--post_title=Native front choice', '--post_content=Native front remains in charge.', '--post_name=native-front', '--porcelain'));
  await wp('option', 'update', 'page_on_front', String(nativeFrontId));
  const nativeFront = await page('/');
  assert.equal(nativeFront.status, 200);
  assert.match(nativeFront.html, /Native front remains in charge/);
  assert.doesNotMatch(nativeFront.html, /<h1 class="wp-block-heading">Notes from the field<\/h1>/);
  assert.equal(Number(await wp('option', 'get', 'page_on_front')), nativeFrontId);
  const frontState = JSON.parse(await wp('option', 'get', 'zero_pages_fullsite', '--format=json'));
  assert.equal(frontState.digest, recoveredState.digest);
  assert.deepEqual(frontState.conflicts, ['/']);
  const homeId = owned.pages['u:home'];
  assert.equal(frontState.pages['u:home'], homeId);
  assert.equal(await wp('post', 'get', String(homeId), '--field=post_status'), 'publish', 'a temporary conflict does not retire the managed Page');
  assert.match((await page(`/?page_id=${homeId}`)).headers.get('location'), new RegExp(`${base}/$`), 'an alternate URI redirects without serving the conflicted code page');
  await wp('option', 'update', 'page_on_front', '0');
  const restoredHome = await page('/');
  assert.equal(restoredHome.status, 200);
  assert.match(restoredHome.html, /<h1 class="wp-block-heading">Notes from the field<\/h1>/);
  assert.equal(postContext(restoredHome.html).queried, homeId, 'clearing the conflict reuses the original Page identity');
  assert.equal(Number(await wp('option', 'get', 'page_on_front')), homeId);
  assert.deepEqual(JSON.parse(await wp('option', 'get', 'zero_pages_fullsite', '--format=json')).pages, recoveredState.pages);
  assert.equal(await wp('post', 'get', String(nativeFrontId), '--field=post_status'), 'publish');

  // Removing the route itself still retires its managed Page.
  await rm(join(project, 'pages/contact'), { recursive: true });
  assert.equal((await buildPages({ project, out: content })).ok, true);
  await rm(join(site, 'wp-content/plugins/zero-pages-fullsite'), { recursive: true });
  await cp(join(content, 'plugins/zero-pages-fullsite'), join(site, 'wp-content/plugins/zero-pages-fullsite'), { recursive: true });
  assert.equal((await page('/about/')).status, 200);
  const retiredState = JSON.parse(await wp('option', 'get', 'zero_pages_fullsite', '--format=json'));
  assert.equal(Object.hasOwn(retiredState.pages, 'p:2f636f6e74616374'), false);
  assert.equal(await wp('post', 'get', String(recoveredState.pages['p:2f636f6e74616374']), '--field=post_status'), 'trash');

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
