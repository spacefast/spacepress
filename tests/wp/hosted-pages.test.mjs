// Run by tests/wp/hosted-pages-run.sh against a WordPress/MariaDB site that holds only the output of
// `zero compile-sources` for examples/full-site: pages, the island, the action and the custom routes.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { appendFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const app = process.env.ZERO_HOSTED_APP;
const harness = process.env.ZERO_HOSTED_HARNESS;
const exec = promisify(execFile);
const site = JSON.parse(readFileSync(join(app, 'harness.json'), 'utf8'));
const base = site.url.replace(/\/$/, '');
const editor = `Basic ${Buffer.from(`editor:${site.users.editor.appPassword}`).toString('base64')}`;
// playwright-core is pinned by packages/pages; nothing else in this lane needs npm.
const { chromium } = createRequire(new URL('../../packages/pages/package.json', import.meta.url))('playwright-core');

function chromiumPath() {
  if (process.env.ZERO_PAGES_CHROMIUM) return process.env.ZERO_PAGES_CHROMIUM;
  const cache = join(homedir(), '.cache/ms-playwright');
  const shell = readdirSync(cache).filter((name) => name.startsWith('chromium_headless_shell-')).sort().reverse()[0];
  if (shell === undefined) throw new Error('Set ZERO_PAGES_CHROMIUM to a chrome-headless-shell executable.');
  return join(cache, shell, 'chrome-headless-shell-linux64/chrome-headless-shell');
}

async function http(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, { method, body, headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  return { status: response.status, headers: response.headers, text: await response.text() };
}
const api = async (path, init = {}) => {
  const response = await http(path, { ...init, headers: { authorization: editor, 'content-type': 'application/json', ...init.headers } });
  return { status: response.status, body: JSON.parse(response.text) };
};
const wp = async (...args) => (await exec(harness, ['wp', ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();

test('the host-compiled full site serves pages, hydrates its island, runs its action and answers its routes', { timeout: 300000 }, async () => {
  const compiled = JSON.parse(readFileSync(join(app, 'compiled/manifest.json'), 'utf8'));
  assert.equal(compiled.pages, 'zero-pages-fullsite', 'the hosted compile emitted the pages plugin');
  assert.match(await wp('plugin', 'list', '--status=active', '--field=name'), /zero-pages-fullsite/);

  const note = await api('/wp-json/zero/v1/notes', { method: 'POST', body: JSON.stringify({
    title: 'Hosted light', slug: 'hosted-light', dek: 'Served from compile-sources', status: 'published',
    body: '<!-- wp:paragraph --><p>Rendered by <em>WordPress</em>.</p><!-- /wp:paragraph -->', deskNotes: 'Staff only',
  }) });
  assert.equal(note.status, 201, JSON.stringify(note.body));
  const draft = await api('/wp-json/zero/v1/notes', { method: 'POST', body: JSON.stringify({ title: 'Hidden draft', slug: 'hidden-draft', status: 'draft' }) });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));

  // 1. HTML pages: home, a static page with an asset, the listing, an item route and the claimed 404.
  const home = await http('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<title>Home · Field Notes<\/title>/);
  assert.match(home.text, /<h1 class="wp-block-heading">Notes from the field<\/h1>/);
  assert.match(home.text, new RegExp(`<a href="${base}/notes/hosted-light/">Hosted light</a>`));
  assert.doesNotMatch(home.text, /Hidden draft/);
  assert.match(home.headers.get('cache-control'), /private, no-store/);
  const about = await http('/about/');
  assert.equal(about.status, 200);
  const svg = /src="([^"]+\/assets\/compass-[A-Z0-9]+\.svg)"/.exec(about.text)?.[1];
  assert.ok(svg, 'the imported asset is served from the hosted plugin');
  assert.equal((await fetch(svg)).status, 200);
  const css = /href='([^']+\/assets\/page-[0-9a-f]+\.css)'/.exec(about.text)?.[1];
  assert.ok(css && (await (await fetch(css)).text()).includes('body.zero-pages'), 'route stylesheet');
  assert.match((await http('/notes/')).text, /Hosted light/);
  const detail = await http('/notes/hosted-light/');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /<title>Hosted light · Field Notes<\/title>/);
  assert.match(detail.text, /Rendered by <em>WordPress<\/em>\./);
  assert.doesNotMatch(detail.text, /Staff only/, 'field access applies to anonymous rendering');
  const missing = await http('/notes/hidden-draft/');
  assert.equal(missing.status, 404);
  assert.match(missing.text, /<h1 class="wp-block-heading">Not found<\/h1>/);
  assert.doesNotMatch(missing.text, /Hidden draft/);

  // 2. The island hydrates in Chromium and its button calls the compiled `cheer` action.
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  try {
    const tab = await browser.newPage();
    const errors = [];
    tab.on('pageerror', (error) => errors.push(error.message));
    const actionCalls = [];
    tab.on('request', (request) => { if (request.url().includes('/wp-json/zero/v1/actions/cheer')) actionCalls.push(request.method()); });
    await tab.goto(`${base}/notes/hosted-light/`);
    assert.equal(await tab.textContent('[data-wp-text="context.count"]'), '0');
    await tab.click('button:has-text("Cheer")');
    await tab.waitForFunction(() => document.querySelector('[data-wp-text="context.count"]')?.textContent === '1');
    await tab.click('button:has-text("Cheer")');
    await tab.waitForFunction(() => document.querySelector('[data-wp-text="context.count"]')?.textContent === '2');
    assert.deepEqual(actionCalls, ['POST', 'POST'], 'the hydrated island posted to the action');
    await tab.reload();
    assert.equal(await tab.textContent('[data-wp-text="context.count"]'), '2', 'the server renders the stored count');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
  const cheers = await api('/wp-json/zero/v1/cheers');
  assert.deepEqual(cheers.body.data.map((row) => [row.noteId, row.count]), [[note.body.data.id, 2]]);

  // 3. The action over plain HTTP, as any client calls it.
  const action = await http('/wp-json/zero/v1/actions/cheer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ noteId: note.body.data.id }) });
  assert.equal(action.status, 200, action.text);
  assert.deepEqual(JSON.parse(action.text), { data: { count: 3 } });

  // 4. GET /api/feed.json: a custom route outside /wp-json with its own content type.
  const feed = await http('/api/feed.json?limit=5');
  assert.equal(feed.status, 200, feed.text);
  assert.equal(feed.headers.get('content-type'), 'application/feed+json');
  const parsed = JSON.parse(feed.text);
  assert.equal(parsed.version, 'https://jsonfeed.org/version/1.1');
  assert.deepEqual(parsed.items, [{ id: String(note.body.data.id), title: 'Hosted light', summary: 'Served from compile-sources' }], 'drafts stay out of the feed');
  assert.equal((await http('/api/feed.json/')).status, 200, 'a trailing slash matches');
  const head = await http('/api/feed.json', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '', 'HEAD answers without a body');
  const wrongMethod = await http('/api/feed.json', { method: 'DELETE' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(JSON.parse(wrongMethod.text).code, 'method_not_allowed');

  // 5. POST /webhooks/stripe: an HMAC-signed route with a non-JSON response that writes in its transaction.
  const event = JSON.stringify({ noteId: note.body.data.id });
  const signature = createHmac('sha256', 'hosted-pages-secret').update(event).digest('hex');
  const hook = await http('/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-fullsite-signature': signature }, body: event });
  assert.equal(hook.status, 202, hook.text);
  assert.equal(hook.text, `accepted ${signature.slice(0, 8)}`);
  assert.equal(hook.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal((await api('/wp-json/zero/v1/cheers')).body.data[0].count, 4, 'the signed route wrote');
  const forged = await http('/webhooks/stripe', { method: 'POST', headers: { 'x-fullsite-signature': 'f'.repeat(64) }, body: event });
  assert.equal(forged.status, 401);
  assert.equal(JSON.parse(forged.text).code, 'invalid_signature');
  assert.equal((await api('/wp-json/zero/v1/cheers')).body.data[0].count, 4, 'a forged delivery wrote nothing');

  // Percent-encoded unreserved characters name the same path.
  assert.equal((await http('/%61pi/feed%2Ejson')).status, 200);
  // `undefined` optional fields take the documented defaults.
  const defaults = await http('/api/probe/defaults');
  assert.deepEqual([defaults.status, defaults.text, defaults.headers.get('x-probe'), defaults.headers.get('content-type')], [200, '', 'yes', 'text/plain; charset=utf-8']);
  // once() inside a route is bound to the request body: a different body under the same key is a 409.
  assert.equal((await http('/api/probe/once', { method: 'POST', body: 'first' })).text, 'first');
  assert.equal((await http('/api/probe/once', { method: 'POST', body: 'first' })).text, 'first', 'the same body replays');
  const mismatch = await http('/api/probe/once', { method: 'POST', body: 'second' });
  assert.equal(mismatch.status, 409, mismatch.text);
  assert.equal(JSON.parse(mismatch.text).code, 'idempotency_mismatch');

  // The most specific route wins whatever the declaration order: literal segments beat `:params`
  // segment by segment from the left. `/api/:id` and `/api/:kind/:id` are declared first.
  const body = async (path) => (await http(path)).text;
  assert.equal(feed.headers.get('content-type'), 'application/feed+json', 'the literal feed beats /api/:id declared before it');
  assert.equal(await body('/api/other'), 'param other');
  assert.equal(await body('/api/probe/feed.json'), 'probe literal', '/api/probe/feed.json beats /api/probe/:id and /api/:kind/:id');
  assert.equal(await body('/api/probe/42'), 'probe param 42', '/api/probe/:id beats /api/:kind/:id');
  assert.equal(await body('/api/notes/42'), 'params notes 42');

  // The query string as URLSearchParams parses it, not as PHP's $_GET does.
  const query = JSON.parse(await body('/api/probe-query?a.b=1&x[]=1&x[]=2&k=1&k=2'));
  assert.deepEqual(query, {
    dotted: '1', underscored: null, brackets: ['1', '2'], first: '1', every: ['1', '2'], has: true, missing: null,
    entries: [['a.b', '1'], ['x[]', '1'], ['x[]', '2'], ['k', '1'], ['k', '2']],
  });
  // A server that sends no QUERY_STRING: the query still comes from the request URI.
  const fallback = await http('/api/probe-query?k=from-uri', { headers: { 'x-zero-no-query-string': '1' } });
  assert.equal(fallback.status, 200, fallback.text);
  assert.equal(JSON.parse(fallback.text).first, 'from-uri');
  const encoded = JSON.parse(await body('/api/probe-query?a%2Eb=%31&k=one+two&k=3'));
  assert.deepEqual([encoded.dotted, encoded.first, encoded.every], ['1', 'one two', ['one two', '3']]);

  // `*path` takes one or more decoded segments; literals and :params at the same position win.
  assert.equal(await body('/files/a'), 'rest a');
  assert.equal(await body('/files/a/b/c.txt'), 'rest a/b/c.txt');
  assert.equal(await body('/files/a%20b/%C3%A9.txt'), 'rest a b/é.txt', 'segments are decoded');
  assert.equal(await body('/files/readme.txt'), 'readme', 'a literal beats *path');
  assert.equal(await body('/files/photos/latest'), 'latest photos', '/files/:bucket/latest beats *path');
  assert.equal(await body('/files/photos/latest/old'), 'rest photos/latest/old');
  assert.equal((await http('/files')).status, 404, '*path needs at least one segment');
  assert.equal((await http('/files/a/..%2F..%2Fwp-config.php')).status, 404, 'an encoded slash or dot segment never matches');

  // Unclaimed paths still belong to WordPress.
  assert.equal((await http('/unclaimed/other.json')).status, 404);
  assert.equal((await http('/api/a/b/c')).status, 404, 'no route has three segments under /api');
  assert.equal((await http('/wp-json/zero/v1/notes')).status, 200);
});

test('a route sees the caller WordPress REST would: Bearer always, cookie on GET or with a nonce, never an application password', { timeout: 120000 }, async () => {
  const id = site.users.editor.id;
  const who = async (method, headers = {}) => (await http('/api/probe-who', { method, headers })).text;
  // Application passwords are refused as a route credential on every method.
  assert.equal(await who('GET', { authorization: editor }), 'anonymous');
  assert.equal(await who('POST', { authorization: editor }), 'anonymous');
  // A WordPress login cookie: GET authenticates; an unsafe method needs the REST nonce.
  const login = await wp('user', 'get', String(id), '--field=user_login');
  const password = 'hosted-route-cookie-pass';
  await wp('user', 'update', String(id), `--user_pass=${password}`);
  const form = await fetch(`${base}/wp-login.php`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'wordpress_test_cookie=WP%20Cookie%20check' },
    body: new URLSearchParams({ log: login, pwd: password, testcookie: '1' }) });
  const cookie = form.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const nonce = await (await fetch(`${base}/wp-admin/admin-ajax.php?action=rest-nonce`, { headers: { cookie } })).text();
  assert.equal(await who('GET', { cookie }), `user ${id}`);
  assert.equal(await who('POST', { cookie }), 'anonymous', 'no nonce: a cross-site form runs anonymously');
  assert.equal(await who('POST', { cookie, 'x-wp-nonce': nonce }), `user ${id}`);
  // A zero-identity Bearer token is the caller's chosen credential on every method, with no nonce.
  if (site.identity !== null) {
    const token = await wp('eval', `echo (new \\Zero\\Identity\\OAuth(\\Zero\\Identity\\Plugin::$db, \\Zero\\Identity\\Plugin::$accounts))->issueForUser(${id}, ${JSON.stringify(site.identity.clientId)})['access_token'];`);
    assert.equal(await who('GET', { authorization: `Bearer ${token}` }), `user ${id}`);
    assert.equal(await who('POST', { authorization: `Bearer ${token}` }), `user ${id}`);
    assert.equal((await http('/api/probe-who', { method: 'POST', headers: { authorization: 'Bearer a.b.c' } })).status, 401, 'a bad token is refused, not anonymous');
  }
});

test('while storage is behind, a claimed route path answers 503 instead of falling through to WordPress', { timeout: 120000 }, async () => {
  const appDir = join(app, 'content/plugins/zero-app-fullsite/zero/app/');
  const schema = readFileSync(appDir + 'schema.php');
  writeFileSync(appDir + 'migrations/9997_route_probe.sql', 'INSERT INTO `{prefix}missing_route_probe` (`n`) VALUES (1);\n');
  appendFileSync(appDir + 'schema.php', '\n// route upgrade probe\n');
  try {
    const deadline = Date.now() + 30000;
    let feed;
    while ((feed = await http('/api/feed.json')).status !== 503) {
      assert.ok(Date.now() < deadline, `the upgrade never refused the route (${feed.status})`);
    }
    assert.equal(feed.headers.get('retry-after'), '5');
    assert.equal(JSON.parse(feed.text).code, 'unavailable');
    assert.equal((await http('/webhooks/stripe', { method: 'POST', body: '{}' })).status, 503, 'a webhook sender is told to retry');
    assert.equal((await http('/api/probe/42')).status, 503, 'parameter routes too');
    assert.equal((await http('/unclaimed/other.json')).status, 404, 'paths no route claims still belong to WordPress');
  } finally {
    rmSync(appDir + 'migrations/9997_route_probe.sql');
    writeFileSync(appDir + 'schema.php', schema);
  }
  const deadline = Date.now() + 30000;
  while ((await http('/api/feed.json')).status !== 200) assert.ok(Date.now() < deadline, 'routes came back after the upgrade cleared');
});
