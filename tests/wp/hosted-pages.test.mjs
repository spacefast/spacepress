// Run by tests/wp/hosted-pages-run.sh against a WordPress/MariaDB site that holds only the output of
// `zero compile-sources` for examples/full-site: pages, the island, the action and the custom routes.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
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

  // Unclaimed paths still belong to WordPress.
  assert.equal((await http('/api/other.json')).status, 404);
  assert.equal((await http('/wp-json/zero/v1/notes')).status, 200);
});
