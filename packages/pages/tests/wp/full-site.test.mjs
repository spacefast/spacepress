// Native acceptance for optional TSX pages: a fresh WordPress 7.1 + SQLite site from `first dev`
// (WordPress Studio, no Docker), the full-site example built by `first build` and `first-pages build`,
// checked over HTTP and in a real browser. Everything it creates lives under one temp directory
// and one Studio site, both removed at the end.
//
//   FIRST_BIN=<first binary> [FIRST_PAGES_CHROMIUM=<chrome-headless-shell>] node --test tests/wp/full-site.test.mjs
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
const first = resolve(process.env.FIRST_BIN ?? join(repo, 'target/debug/first'));

async function chromiumPath() {
  if (process.env.FIRST_PAGES_CHROMIUM) return process.env.FIRST_PAGES_CHROMIUM;
  const cache = join(homedir(), '.cache/ms-playwright');
  const shells = (await readdir(cache)).filter((name) => name.startsWith('chromium_headless_shell-')).sort().reverse();
  if (shells.length === 0) throw new Error('Set FIRST_PAGES_CHROMIUM to a chrome-headless-shell executable.');
  return join(cache, shells[0], 'chrome-headless-shell-linux64/chrome-headless-shell');
}

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

const run = async (args) => (await exec(first, args, { timeout: 600000, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

test('TSX pages serve a full site from native WordPress with viewer-bound data', { timeout: 900000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'first-pages-native-'));
  const project = join(root, 'site');
  const content = join(project, 'first/dist/wp-content');
  // The pages and the backend they read; the example's first/app/ routes are tested in tests/wp/hosted-pages.
  for (const entry of ['first.config.ts', 'first/actions.ts', 'pages', 'components', 'islands', 'styles']) {
    await cp(join(example, entry), join(project, entry), { recursive: true });
  }
  const config = join(project, 'first.config.ts');
  await writeFile(config, (await readFile(config, 'utf8'))
    .replace('title: text().min(1).max(120),', 'title: text().min(1).max(120),\n  kind: text().optional(),\n  then: text().optional(),')
    .replace('body: richText().optional(),', 'body: richText().optional().access({ read: (ctx) => ctx.user?.role === "admin" || ctx.data.slug !== "masked-body" }),')
    .replace('count: integer().default(0),', 'count: integer().default(0),\n  label: text().default(""),'));
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
  const site = join(project, '.first/dev/wordpress');
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
  const wp = (...args) => run(['wp', '--site', project, ...args]);
  const built = await buildPages({ project, out: content });
  assert.deepEqual(built.diagnostics.filter((d) => d.severity === 'error'), []);
  const pagesPlugin = join(content, 'plugins/first-pages-fullsite');
  const pagesTree = async (directory) => {
    const files = {};
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      files[entry.name] = entry.isDirectory() ? await pagesTree(join(directory, entry.name)) : (await readFile(join(directory, entry.name))).toString('base64');
    }
    return files;
  };
  const pagesBefore = await pagesTree(pagesPlugin);
  await run(['build', project]);
  assert.deepEqual(await pagesTree(pagesPlugin), pagesBefore, 'backend rebuild preserves the real Pages plugin byte for byte');
  await cp(join(content, 'plugins/first-pages-fullsite'), join(site, 'wp-content/plugins/first-pages-fullsite'), { recursive: true });
  await wp('plugin', 'activate', 'first-pages-fullsite');
  await mkdir(join(site, 'wp-content/mu-plugins'), { recursive: true });
  await writeFile(join(site, 'wp-content/mu-plugins/first-pages-test-context.php'), `<?php
add_action('wp_head', static function (): void {
    $context = ['id' => get_the_ID(), 'queried' => get_queried_object_id(), 'notFound' => is_404(), 'singular' => is_singular(), 'type' => get_post_type(), 'title' => get_the_title()];
    echo '<meta name="first-pages-test-context" content="' . esc_attr(base64_encode(wp_json_encode($context))) . '">';
    echo '<meta name="first-pages-test-body" content="' . esc_attr(base64_encode(wp_json_encode(['content' => get_the_content(), 'excerpt' => get_the_excerpt()]))) . '">';
});
add_shortcode('first_pages_test_context', static fn (): string => '<p class="first-pages-test-context">' . get_the_ID() . ':' . esc_html(get_the_title()) . '</p>');
add_filter('wp_insert_post_empty_content', static function (bool $empty, array $data): bool {
    return $empty || (get_option('first_pages_test_fail_write') && ($data['post_type'] ?? '') === 'page' && ($data['post_name'] ?? '') === 'about');
}, 10, 2);
add_action('wp_after_insert_post', static function (int $id, WP_Post $post): void {
    if ($post->post_type === 'page' && $post->post_name === 'contact') {
        if (get_option('first_pages_test_interrupt') === 'exit') exit(73);
        if (get_option('first_pages_test_interrupt') === 'post') throw new RuntimeException('Interrupted after publication');
    }
}, 10, 2);
add_action('added_post_meta', static function (int $metaId, int $postId, string $key): void {
    if ($key === '_first_pages_app' && get_post($postId)->post_name === 'contact' && get_option('first_pages_test_interrupt') === 'meta') {
        throw new RuntimeException('Interrupted during ownership');
    }
}, 10, 3);
add_action('updated_option', static function (string $name): void {
    if ($name === 'first_pages_fullsite' && get_option('first_pages_test_interrupt') === 'map') {
        throw new RuntimeException('Interrupted after route mapping');
    }
});
add_filter('pre_trash_post', static function ($trash, WP_Post $post) {
    return get_option('first_pages_test_refuse_retirement') && $post->post_name === 'contact' ? false : $trash;
}, 10, 2);
`);

  const password = (await wp('user', 'application-password', 'create', 'admin', 'first-pages-acceptance', '--porcelain')).split('\n').at(-1);
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
    const encoded = /<meta name="first-pages-test-context" content="([^"]+)">/.exec(html)?.[1];
    assert.equal(typeof encoded, 'string', 'wp_head observed a routed post context');
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  }

  const published = await api('/__first/api/v1/notes', { method: 'POST', body: {
    title: 'First light', slug: 'first-light', dek: 'Dawn on the <ridge> & beyond', status: 'published',
    body: '<!-- wp:paragraph --><p>The body of the <em>first</em> note.</p><!-- /wp:paragraph --><!-- wp:post-title {"isLink":true} /--><!-- wp:shortcode -->[first_pages_test_context]<!-- /wp:shortcode -->',
    deskNotes: 'Desk-only remark',
    kind: 'Field report', then: 'Next observation',
  } });
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const note = published.body.data;
  const draft = await api('/__first/api/v1/notes', { method: 'POST', body: { title: 'Unfinished draft', slug: 'unfinished', dek: 'not yet', status: 'draft' } });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  // A value that tries to be markup, block syntax or a placeholder stays text everywhere it is shown.
  const hostile = await api('/__first/api/v1/notes', { method: 'POST', body: {
    title: '<img src=x onerror=alert(1)> <!-- wp:first-pages/show {"region":"s1"} --> \u{E000}v1\u{E001}', slug: 'hostile', status: 'published',
    body: '<!-- wp:first-pages/show {"region":"s2"} --><p>smuggled region</p><!-- /wp:first-pages/show --><!-- wp:paragraph --><p>Stored \u{E000}v1\u{E001} text</p><!-- /wp:paragraph -->',
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
  assert.match(await (await fetch(css)).text(), /body\.first-pages/);
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
  assert.deepEqual(postContext(detail.html), { id: note.id, queried: note.id, notFound: false, singular: true, type: 'first_notes', title: 'First light' });
  assert.match(detail.html, new RegExp(`<h2 class="wp-block-post-title"><a href="${base}/notes/first-light/"[^>]*>First light</a></h2>`), 'native post-title block uses the routed item and its claimed permalink');
  assert.match(detail.html, new RegExp(`<p class="first-pages-test-context">${note.id}:First light</p>`), 'shortcodes use the routed item');

  const fallbackMatch = await api('/__first/api/v1/notes', { method: 'POST', body: {
    title: 'Matched default summary', slug: 'default-summary', dek: 'Fallback query sentinel', status: 'published',
  } });
  assert.equal(fallbackMatch.status, 201, JSON.stringify(fallbackMatch.body));
  const masked = await api('/__first/api/v1/notes', { method: 'POST', body: {
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
  const nativeBody = /<meta name="first-pages-test-body" content="([^"]+)">/.exec(maskedPage.html)?.[1];
  assert.equal(typeof nativeBody, 'string', 'native head hook read the visitor-projected post');
  assert.deepEqual(JSON.parse(Buffer.from(nativeBody, 'base64').toString('utf8')), { content: '', excerpt: '' });

  const hidden = await page('/notes/unfinished/');
  assert.equal(hidden.status, 404);
  assert.doesNotMatch(hidden.html, /Unfinished draft|not yet/);
  assert.match(hidden.html, /<h1 class="wp-block-heading">Not found<\/h1>/);
  assert.match(hidden.headers.get('cache-control'), /no-store/);
  assert.deepEqual(postContext(hidden.html), { id: false, queried: 0, notFound: true, singular: false, type: false, title: '' }, '404 head hooks cannot see an unrelated fallback post');
  assert.equal((await page('/notes/does-not-exist/')).status, 404);

  // A WordPress session issued by another integration must still obey identity suspension.
  const suspendedId = Number(await wp('user', 'create', 'pages-suspended', 'pages-suspended@example.test', '--role=subscriber', '--porcelain'));
  assert.equal(Number.isInteger(suspendedId) && suspendedId > 0, true);
  await wp('first', 'identity', 'suspend', String(suspendedId));
  const suspendedCookie = await wp('eval', `echo LOGGED_IN_COOKIE . '=' . wp_generate_auth_cookie(${suspendedId}, time() + 300, 'logged_in');`);
  const denied = await page('/about/', { cookie: suspendedCookie });
  assert.equal(denied.status, 404, 'a resolved suspended account cannot view a managed route');
  assert.match(denied.html, /<h1>Page not found<\/h1>/);
  assert.doesNotMatch(denied.html, /Browse the notes|First light|About this site/, 'suspension cannot render the custom 404 as an anonymous visitor');
  assert.match(denied.headers.get('cache-control'), /no-store/);
  assert.equal((await page('/about/')).status, 200, 'the denial belongs to the suspended session');

  const escaped = await page('/notes/hostile/');
  assert.equal(escaped.status, 200);
  assert.match(escaped.html, /<h1 class="wp-block-heading">&lt;img src=x onerror=alert\(1\)&gt; &lt;!-- wp:first-pages\/show \{&quot;region&quot;:&quot;s1&quot;\} --&gt; v1<\/h1>/);
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
  const reserved = await api('/__first/api/v1/notes', { method: 'POST', body: { title: 'Featured', slug: 'featured', status: 'published' } });
  assert.deepEqual([reserved.status, reserved.body.code], [409, 'reserved_slug']);
  const core = await api('/wp-json/wp/v2/first_notes', { method: 'POST', body: { title: 'Featured via core', slug: 'featured', status: 'publish' } });
  assert.equal(core.status, 201, JSON.stringify(core.body));
  assert.notEqual(core.body.slug, 'featured');

  // 3. Signed in: drafts and staff-only fields appear for staff, as First's rules say.
  const login = await fetch(`${base}/wp-login.php`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'wordpress_test_cookie=WP+Cookie+check' },
    body: 'log=admin&pwd=first-test-admin&wp-submit=Log+In&testcookie=1',
  });
  const cookie = login.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
  const staffDraft = await page('/notes/unfinished/', { cookie });
  assert.equal(staffDraft.status, 200);
  assert.match(staffDraft.html, /<h1 class="wp-block-heading">Unfinished draft<\/h1>/);
  assert.match((await page('/notes/first-light/', { cookie })).html, /Desk-only remark/);

  // 4. Hidden, code-owned Pages: public identity, no editing surface.
  const owned = JSON.parse(await wp('option', 'get', 'first_pages_fullsite', '--format=json'));
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

  // A native Page that occupies an item URL keeps ownership over the matching collection row.
  const itemPathOwner = await api('/wp-json/wp/v2/pages', { method: 'POST', body: {
    title: 'Native trail page', slug: 'first-light', parent: owned.pages['u:notes.index'],
    status: 'publish', content: '<p>Native path stays in charge.</p>',
  } });
  assert.equal(itemPathOwner.status, 201, JSON.stringify(itemPathOwner.body));
  assert.equal(itemPathOwner.body.link, `${base}/notes/first-light/`);
  const nativeItemPath = await page('/notes/first-light/');
  assert.equal(nativeItemPath.status, 200);
  assert.match(nativeItemPath.html, /Native path stays in charge/);
  assert.doesNotMatch(nativeItemPath.html, /<h1 class="wp-block-heading">First light<\/h1>/);
  assert.equal((await api(`/wp-json/wp/v2/pages/${itemPathOwner.body.id}?force=true`, { method: 'DELETE' })).status, 200);
  assert.match((await page('/notes/first-light/')).html, /<h1 class="wp-block-heading">First light<\/h1>/, 'the item route resumes after the native Page is removed');

  // 5. A native content edit (core REST, as the editor would save) is visible publicly on the next request.
  const edited = await api(`/wp-json/wp/v2/first_notes/${note.id}`, { method: 'POST', body: { title: 'First light, revised' } });
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
  const cheers = await api('/__first/api/v1/cheers', { auth: false });
  assert.deepEqual(cheers.body.data.map((row) => [row.noteId, row.count]), [[note.id, 1]]);

  // 7. Rebuild after a code change: same Page IDs, edits to content kept, new code served.
  // An ordinary Page already owns /contact: the new route must not take it over.
  const contactId = Number(await wp('post', 'create', '--post_type=page', '--post_status=publish', '--post_title=Contact us', '--post_name=contact', '--porcelain'));
  await mkdir(join(project, 'pages/contact'));
  await writeFile(join(project, 'pages/contact/page.tsx'), 'export default function Contact() {\n  return <h1>First contact</h1>;\n}\n');
  const aboutSource = join(project, 'pages/about/page.tsx');
  await writeFile(aboutSource, (await readFile(aboutSource, 'utf8')).replace('<h1>About</h1>', '<h1>About this site</h1>'));
  const rebuilt = await buildPages({ project, out: content });
  assert.equal(rebuilt.ok, true);
  await wp('option', 'update', 'first_pages_test_fail_write', '1');
  await rm(join(site, 'wp-content/plugins/first-pages-fullsite'), { recursive: true });
  await cp(join(content, 'plugins/first-pages-fullsite'), join(site, 'wp-content/plugins/first-pages-fullsite'), { recursive: true });
  assert.equal((await page('/about/')).status, 200, 'a managed Page write failure does not abort init');
  const failedState = JSON.parse(await wp('option', 'get', 'first_pages_fullsite', '--format=json'));
  assert.equal(failedState.digest, owned.digest, 'a failed reconciliation does not commit the new digest');
  assert.deepEqual(failedState.pages, owned.pages);
  assert.deepEqual(failedState.conflicts, []);
  const contactDuringFailure = await page('/contact/');
  assert.equal(contactDuringFailure.status, 200);
  assert.match(contactDuringFailure.html, /Contact us/);
  assert.doesNotMatch(contactDuringFailure.html, /First contact/, 'a new route cannot claim native content while reconciliation is incomplete');
  assert.match(await wp('option', 'get', 'first_pages_fullsite_error'), /Cannot write the Page for \/about:/);
  assert.equal(await wp('eval', 'echo get_option("first_pages_lock_fullsite", false) === false ? "released" : "held";'), 'released');
  const nativeDuringFailure = await api('/wp-json/wp/v2/types/page', { auth: false });
  assert.equal(nativeDuringFailure.status, 200);
  assert.equal(nativeDuringFailure.body.slug, 'page', 'unrelated WordPress REST remains usable');
  const errorNotice = await wp('eval', 'wp_set_current_user(1); do_action("admin_notices");');
  assert.match(errorNotice, /First pages could not update its managed Pages/);
  assert.match(errorNotice, /Cannot write the Page for \/about:/);
  await wp('option', 'delete', 'first_pages_test_fail_write');
  assert.match((await page('/about/')).html, /<h1 class="wp-block-heading">About this site<\/h1>/);
  assert.equal(await wp('eval', 'echo get_option("first_pages_fullsite_error", false) === false ? "cleared" : "present";'), 'cleared', 'successful retry clears the persisted notice');
  const after = JSON.parse(await wp('option', 'get', 'first_pages_fullsite', '--format=json'));
  assert.deepEqual(Object.fromEntries(Object.entries(after.pages)), owned.pages);
  assert.notEqual(after.digest, owned.digest);
  assert.match(await wp('post', 'get', String(aboutId), '--field=post_content'), /About this site/);
  assert.match((await page('/notes/first-light/')).html, /First light, revised/);
  assert.equal((await page('/notes/unfinished/')).status, 404);
  const contact = await page('/contact/');
  assert.equal(contact.status, 200);
  assert.match(contact.html, /Contact us/);
  assert.doesNotMatch(contact.html, /First contact/);
  assert.deepEqual(after.conflicts, ['/contact']);
  // Force rollback after publication, halfway through ownership, and after caching the new route map.
  await wp('option', 'update', 'first_pages_test_interrupt', 'post');
  await wp('post', 'delete', String(contactId), '--force');
  await wp('--skip-plugins=first-pages-fullsite', 'option', 'update', 'first_pages_test_interrupt', 'exit');
  // `first wp` passes WP-CLI's own exit status through (#149); a PHP exit mid-publication fails the command.
  await assert.rejects(wp('eval', 'echo "unexpected completion";'), (error) => error.code !== 0 && !String(error.stdout).includes('unexpected completion'), 'an actual PHP exit interrupts publication');
  const aborted = JSON.parse(await wp('--skip-plugins=first-pages-fullsite', 'eval', `global $wpdb;
    echo wp_json_encode([
      'state' => get_option('first_pages_fullsite'),
      'posts' => $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'page' AND post_name = 'contact'"),
    ]);`));
  assert.deepEqual(aborted.state, after, 'an abruptly ended process cannot commit a partial route map');
  assert.deepEqual(aborted.posts, [], 'an abruptly ended process leaves no published orphan');
  for (const phase of ['post', 'meta', 'map']) {
    await wp('--skip-plugins=first-pages-fullsite', 'option', 'update', 'first_pages_test_interrupt', phase);
    const interrupted = await page('/contact/');
    assert.equal(interrupted.status, 404, `${phase}: the rolled-back Page is not publicly reachable`);
    assert.doesNotMatch(interrupted.html, /First contact/);
    const rollback = JSON.parse(await wp('eval', `global $wpdb;
      echo wp_json_encode([
        'state' => get_option('first_pages_fullsite'),
        'posts' => $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'page' AND post_name = 'contact'"),
        'error' => get_option('first_pages_fullsite_error'),
        'transaction' => \\First\\Wp\\Runtime::plugin()->connection()->inTransaction(),
      ]);`));
    assert.deepEqual(rollback.state, after, `${phase}: the route map and cached options roll back together`);
    assert.deepEqual(rollback.posts, [], `${phase}: no orphaned Page remains in the database`);
    assert.match(rollback.error, /Interrupted/);
    assert.equal(rollback.transaction, false);
    assert.match((await page('/about/')).html, /About this site/, `${phase}: unrelated routes remain usable`);
  }

  // A held connection lock excludes another reconciler even when no option lease exists.
  const excluded = JSON.parse(await wp('--skip-plugins=first-pages-fullsite', 'eval', `
    require WP_PLUGIN_DIR . '/first-pages-fullsite/first-pages-fullsite.php';
    $connection = \\First\\Wp\\Runtime::plugin()->connection();
    $name = 'first-pages:' . substr(hash('sha256', $connection->prefix() . ':fullsite'), 0, 40);
    $connection->locked($name, 0, static function (): void {
      delete_option('first_pages_test_interrupt');
      $priorError = get_option('first_pages_fullsite_error', false);
      \\First\\Pages\\Plugin::instance()->reconcile();
      $preservedError = get_option('first_pages_fullsite_error', false);
      delete_option('first_pages_fullsite_error');
      \\First\\Pages\\Plugin::instance()->reconcile();
      global $wpdb;
      echo wp_json_encode([
        'state' => get_option('first_pages_fullsite'),
        'posts' => $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'page' AND post_name = 'contact'"),
        'priorError' => $priorError,
        'preservedError' => $preservedError,
        'newError' => get_option('first_pages_fullsite_error', false),
      ]);
      update_option('first_pages_test_interrupt', 'map');
    });`));
  assert.deepEqual(excluded.state, after, 'a competing reconciler cannot change the route map');
  assert.deepEqual(excluded.posts, [], 'a competing reconciler cannot publish a duplicate Page');
  assert.equal(excluded.priorError, 'Interrupted after route mapping');
  assert.equal(excluded.preservedError, excluded.priorError, 'lock contention preserves an existing write failure');
  assert.equal(excluded.newError, false, 'lock contention without a prior failure creates no error notice');

  // A real filesystem failure before the callback must still produce an administrator notice.
  const unavailable = JSON.parse(await wp('--skip-plugins=first-pages-fullsite', 'eval', `
    require WP_PLUGIN_DIR . '/first-pages-fullsite/first-pages-fullsite.php';
    $connection = \\First\\Wp\\Runtime::plugin()->connection();
    $name = 'first-pages:' . substr(hash('sha256', $connection->prefix() . ':fullsite'), 0, 40);
    $file = (defined('DB_PATH') ? (string) DB_PATH : (string) (DB_DIR . '/' . DB_FILE)) . '.' . substr(hash('sha256', $name), 0, 16) . '.lock';
    if (!rename($file, $file . '.test-backup')) throw new RuntimeException('Cannot prepare lock failure');
    try {
      if (!mkdir($file)) throw new RuntimeException('Cannot block lock file');
      delete_option('first_pages_test_interrupt');
      @\\First\\Pages\\Plugin::instance()->reconcile();
      wp_set_current_user(1);
      ob_start();
      do_action('admin_notices');
      $notice = ob_get_clean();
      global $wpdb;
      echo wp_json_encode([
        'state' => get_option('first_pages_fullsite'),
        'posts' => $wpdb->get_col("SELECT ID FROM {$wpdb->posts} WHERE post_type = 'page' AND post_name = 'contact'"),
        'error' => get_option('first_pages_fullsite_error', false),
        'notice' => $notice,
      ]);
    } finally {
      if (is_dir($file) && !rmdir($file)) throw new RuntimeException('Cannot unblock lock file');
      if (!rename($file . '.test-backup', $file)) throw new RuntimeException('Cannot restore lock file');
    }`));
  assert.deepEqual(unavailable.state, after, 'lock acquisition failure preserves the previous route map');
  assert.deepEqual(unavailable.posts, [], 'lock acquisition failure publishes no orphaned Page');
  assert.match(unavailable.error, /cannot open lock file/);
  assert.match(unavailable.notice, /First pages could not update its managed Pages/);
  assert.match(unavailable.notice, /cannot open lock file/);

  const recovered = await page('/contact/');
  assert.equal(recovered.status, 200);
  assert.match(recovered.html, /First contact/, 'removing conflicting native content makes the code route available without another build');
  const recoveredState = JSON.parse(await wp('option', 'get', 'first_pages_fullsite', '--format=json'));
  assert.equal(recoveredState.digest, after.digest);
  assert.deepEqual(recoveredState.conflicts, []);
  assert.equal(postContext(recovered.html).queried, recoveredState.pages['p:2f636f6e74616374']);
  assert.equal(await wp('eval', 'echo get_option("first_pages_fullsite_error", false) === false ? "cleared" : "present";'), 'cleared');
  assert.equal(await wp('eval', `global $wpdb; echo $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'page' AND post_name = 'contact'");`), '1', 'retry publishes exactly one Page after the lock is released');
  assert.equal((await api(`/wp-json/wp/v2/pages/${recoveredState.pages['p:2f636f6e74616374']}`, { method: 'POST', body: { title: 'Try to edit recovered Page' } })).status, 403);

  // A native front page selected after activation also keeps ownership without a code rebuild.
  const nativeFrontId = Number(await wp('post', 'create', '--post_type=page', '--post_status=publish', '--post_title=Native front choice', '--post_content=Native front remains in charge.', '--post_name=native-front', '--porcelain'));
  await wp('option', 'update', 'page_on_front', String(nativeFrontId));
  const nativeFront = await page('/');
  assert.equal(nativeFront.status, 200);
  assert.match(nativeFront.html, /Native front remains in charge/);
  assert.doesNotMatch(nativeFront.html, /<h1 class="wp-block-heading">Notes from the field<\/h1>/);
  assert.equal(Number(await wp('option', 'get', 'page_on_front')), nativeFrontId);
  const frontState = JSON.parse(await wp('option', 'get', 'first_pages_fullsite', '--format=json'));
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
  assert.deepEqual(JSON.parse(await wp('option', 'get', 'first_pages_fullsite', '--format=json')).pages, recoveredState.pages);
  assert.equal(await wp('post', 'get', String(nativeFrontId), '--field=post_status'), 'publish');

  // A refused retirement retains ownership and retries until WordPress actually trashes the Page.
  const beforeRetirement = JSON.parse(await wp('option', 'get', 'first_pages_fullsite', '--format=json'));
  await rm(join(project, 'pages/contact'), { recursive: true });
  assert.equal((await buildPages({ project, out: content })).ok, true);
  await wp('option', 'update', 'first_pages_test_refuse_retirement', '1');
  await rm(join(site, 'wp-content/plugins/first-pages-fullsite'), { recursive: true });
  await cp(join(content, 'plugins/first-pages-fullsite'), join(site, 'wp-content/plugins/first-pages-fullsite'), { recursive: true });
  assert.equal((await page('/about/')).status, 200);
  assert.deepEqual(JSON.parse(await wp('option', 'get', 'first_pages_fullsite', '--format=json')), beforeRetirement, 'a refused retirement retains the previous digest and ownership map');
  const retainedId = recoveredState.pages['p:2f636f6e74616374'];
  assert.equal(await wp('post', 'get', String(retainedId), '--field=post_status'), 'publish');
  assert.equal(await wp('eval', `echo get_post_meta(${retainedId}, '_first_pages_retired', true);`), '', 'the retirement marker rolls back with the refused trash');
  assert.equal((await api(`/wp-json/wp/v2/pages/${retainedId}`, { method: 'POST', body: { title: 'Try to edit unretired Page' } })).status, 403);
  const retainedList = await api('/wp-json/wp/v2/pages?context=edit&per_page=100');
  assert.equal(retainedList.body.some((post) => post.id === retainedId), false, 'the retained Page stays hidden from editing');
  assert.match(await wp('option', 'get', 'first_pages_fullsite_error'), /Cannot retire managed Page/);
  await wp('--skip-plugins=first-pages-fullsite', 'option', 'delete', 'first_pages_test_refuse_retirement');
  assert.equal((await page('/about/')).status, 200);
  const retiredState = JSON.parse(await wp('option', 'get', 'first_pages_fullsite', '--format=json'));
  assert.equal(Object.hasOwn(retiredState.pages, 'p:2f636f6e74616374'), false);
  assert.equal(await wp('post', 'get', String(recoveredState.pages['p:2f636f6e74616374']), '--field=post_status'), 'trash');
  assert.equal(await wp('eval', 'echo get_option("first_pages_fullsite_error", false) === false ? "cleared" : "present";'), 'cleared', 'successful retirement clears the failure notice');

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
