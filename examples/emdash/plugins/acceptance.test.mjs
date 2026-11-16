import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { command, dispose, freePort, install, project } from './studio.mjs';

test('official plugin counterparts persist in real native Studio WordPress and coexist with its admin', { timeout: 900000 }, async (t) => {
  const owned = await project();
  const evidence = `${owned.root}-evidence`;
  await mkdir(evidence);
  const received = [];
  let failNext = true;
  const receiver = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    received.push({ url: request.url, headers: request.headers, body });
    response.writeHead(failNext ? 503 : 204); failNext = false; response.end();
  });
  await new Promise((done) => receiver.listen(0, '127.0.0.1', done));
  const address = receiver.address();
  assert.equal(typeof address, 'object');
  const webhookUrl = `http://127.0.0.1:${address.port}/webhook`;
  let installed;
  const proofs = [];
  t.after(async () => {
    const cleanup = await dispose(owned.directory);
    await writeFile(join(evidence, 'cleanup.json'), JSON.stringify(cleanup, null, 2));
    await rm(owned.root, { recursive: true, force: true });
    await new Promise((done) => receiver.close(done));
    console.log(`Plugin evidence: ${evidence}; exact owned Studio registration removed and project deleted.`);
  });
  await command(['dev', owned.directory, '--port', String(await freePort()), '--no-watch']);
  installed = await install(owned.directory);
  const { base, wp, site } = installed;
  await cp(join(owned.directory, '.tp/dev'), join(evidence, 'receipt'), { recursive: true, filter: (source) => !source.includes('/wordpress') });
  await wp('config', 'set', 'TP_PLUGINS_LOCAL_WEBHOOK', webhookUrl);
  const password = await wp('user', 'application-password', 'create', 'admin', 'official-plugin-acceptance', '--porcelain');
  const authorization = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
  async function request(path, { method = 'GET', body, auth = authorization, status = 200, headers = {} } = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: {
      ...(auth ? { authorization: auth } : {}), ...(body === undefined || body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...headers,
    }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    const text = await response.text(); let value;
    try { value = JSON.parse(text); } catch { throw new Error(`${path} returned ${response.status}: ${text.slice(0, 1500)}`); }
    assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 1800)}`);
    return value.data ?? value;
  }
  const api = (path, options) => request(`/wp-json/typedpress-plugins/v1${path}`, options);
  const first = (path, options) => request(`/__tp/api/v1${path}`, options);
  assert.equal((await first('')).runtime.wp.database.kind, 'sqlite');
  const status = await api('/status', { auth: null });
  assert.equal(status.sandbox.available, false);
  await api('/settings', { auth: null, status: 401 });
  await api('/settings', { method: 'POST', body: { webhookUrl: 'http://169.254.169.254/latest', enabled: true }, status: 422 });
  await api('/settings', { method: 'POST', body: { webhookUrl, enabled: true, secretToken: 'disposable-plugin-webhook-token', displayName: 'The live plugin workshop' } });
  assert.equal('secretToken' in await api('/settings'), false);
  const fields = { profile: { name: 'Ada', featured: true }, ingredients: [{ name: 'Flour', quantity: 2 }], grid: [{ monday: 'Edit', tuesday: 'Publish' }], tags: ['native', 'free form'], palette: '#336699', embeds: [{ _type: 'youtube', id: 'dQw4w9WgXcQ' }, { _type: 'vimeo', id: '76979871' }] };
  const entry = await first('/entries', { method: 'POST', status: 201, body: { title: '  A lexical saffron story  ', body: '<!-- wp:paragraph --><p>Built with real plugins.</p><!-- /wp:paragraph -->', status: 'published', ...fields } });
  assert.equal(entry.title, 'A lexical saffron story');
  await request(`/wp-json/wp/v2/tp_entries/${entry.id}`, { method: 'POST', body: { title: 'Native saffron edit', status: 'publish', acf: { first_profile: { name: 'Grace', featured: false }, tp_ingredients: [{ name: 'Rice', quantity: 3 }], tp_grid: [{ monday: 'Draft', tuesday: 'Review' }], tp_tags: '["native","updated"]', tp_palette: '#bb5522' } } });
  const saved = await first(`/entries/${entry.id}`);
  assert.equal(saved.title, 'Native saffron edit');
  assert.deepEqual(saved.profile, { name: 'Grace', featured: false });
  assert.deepEqual(saved.ingredients, [{ name: 'Rice', quantity: 3 }]);
  assert.deepEqual(saved.grid, [{ monday: 'Draft', tuesday: 'Review' }]);
  assert.deepEqual(saved.tags, ['native', 'updated']);
  assert.equal(saved.palette, '#bb5522');
  proofs.push('TypedPress write + native WP REST/SCF structured save + all four field data shapes + color');
  const history = await api('/events');
  const update = history.find((row) => row.event === 'content.updated' && row.data.resourceId === entry.id);
  assert.equal(update.data.before.title, 'A lexical saffron story');
  assert.equal(update.data.after.title, 'Native saffron edit');
  assert.equal(update.data.after.fields.tp_palette, '#bb5522');
  assert.equal(update.actor, 1);
  const publication = await (await fetch(`${base}/?typedpress-plugins=1`)).text();
  assert.match(publication, /Native saffron edit/);
  assert.match(publication, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(publication, /player\.vimeo\.com\/video\/76979871/);
  assert.match(publication, /wp-admin\/plugins\.php/);
  assert.equal(publication.includes('--accent:#bb5522'), true);
  await writeFile(join(evidence, 'publication.html'), publication);
  const record = await first('/records', { method: 'POST', status: 201, body: { externalId: 'plugin-test-1', score: 2, payload: { nested: { enabled: true }, list: [1, 2] } } });
  assert.equal((await first('/actions/advance', { method: 'POST', body: { id: record.id } })).state, 'processing');
  await api('/api/kv/demo', { method: 'POST', body: { value: { nested: ['persisted', 2] } } });
  assert.deepEqual((await api('/api/kv/demo')).value, { nested: ['persisted', 2] });
  await api('/api/kv/demo', { method: 'DELETE' });
  assert.equal((await api('/api/kv/demo')).value, null);
  const diagnostic = await api('/api/diagnostics', { method: 'POST', body: {} });
  assert.equal((await wp('term', 'get', 'zpl_topic', String(diagnostic.termId), '--field=term_id')), String(diagnostic.termId));
  proofs.push('API storage JSON/unique table/action + options CRUD + real taxonomy and scheduled diagnostic');
  // Core Abilities and the real MCP Adapter share this compiled action.
  const abilities = await request('/wp-json/wp-abilities/v1/abilities?per_page=100');
  const echo = abilities.find((ability) => ability.name.includes('echo'));
  assert.equal(echo.name, 'official-plugins/echo');
  assert.deepEqual(await request('/wp-json/wp-abilities/v1/abilities/official-plugins/echo/run', { method: 'POST', body: { input: { message: 'Plugin MCP alive' } } }), { message: 'Plugin MCP alive', length: 16 });
  await request('/wp-json/wp-abilities/v1/abilities/official-plugins/echo/run', { method: 'POST', auth: null, status: 401, body: { input: { message: 'Forbidden' } } });
  async function mcp(payload, session) {
    const response = await fetch(`${base}/wp-json/mcp/typedpress-official-plugins`, { method: 'POST', headers: { authorization, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    const data = text.startsWith('data:') || text.includes('\ndata:') ? JSON.parse(text.split('\n').find((line) => line.startsWith('data:')).slice(5)) : JSON.parse(text);
    return { value: data, session: response.headers.get('mcp-session-id') };
  }
  const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'typedpress-official-plugin-acceptance', version: '1' } } });
  const tools = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, init.session);
  const tool = tools.value.result.tools.find((item) => item.name.includes('echo'));
  assert.equal(typeof tool.name, 'string');
  const called = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: tool.name, arguments: { message: 'Plugin MCP alive' } } }, init.session);
  assert.equal(called.value.result.isError ?? false, false);
  assert.match(JSON.stringify(called.value.result), /Plugin MCP alive/);
  proofs.push('actual Abilities REST and MCP initialize/list/call, with anonymous denial');
  const form = await api('/forms', { method: 'POST', body: { name: 'Workshop contact', pages: [
    { title: 'About you', fields: [{ name: 'name', type: 'text', label: 'Name', required: true }, { name: 'email', type: 'email', label: 'Email', required: true }, { name: 'topic', type: 'select', label: 'Topic', options: [{ label: 'Other', value: 'other' }, { label: 'Hello', value: 'hello' }] }] },
    { title: 'Your message', fields: [{ name: 'message', type: 'textarea', label: 'Message', required: true, condition: { field: 'topic', op: 'eq', value: 'other' } }, { name: 'attachment', type: 'file', label: 'Image', validation: { maxFileSize: 100000 } }, { name: 'website_url', type: 'url', label: 'Website' }, { name: 'alternate_email', type: 'email', label: 'Alternate email' }, { name: 'date', type: 'date', label: 'Date' }, { name: 'count', type: 'number', label: 'Count' }] },
  ], settings: { confirmationMessage: 'Your workshop note is saved.', webhookUrl: 'https://private.example.invalid/secret', notifyEmails: ['private@example.invalid'] } } });
  const definition = await api(`/forms/${form.id}/definition`, { auth: null });
  assert.equal('webhookUrl' in definition.settings, false);
  assert.equal('notifyEmails' in definition.settings, false);
  await api(`/forms/${form.id}/submit`, { method: 'POST', auth: null, body: { data: { name: 'Reader', email: 'broken', topic: 'hello' } }, status: 422 });
  await api(`/forms/${form.id}/submit`, { method: 'POST', auth: null, body: { data: { name: 'Reader', email: 'reader@example.test', topic: 'other' } }, status: 422 });
  await api(`/forms/${form.id}/submit`, { method: 'POST', auth: null, body: { website: 'spam', data: { name: 'Spam', email: 'reader@example.test', topic: 'hello' } }, status: 422 });
  const image = Buffer.from(await wp('eval', '$i=imagecreatetruecolor(12,8); ob_start(); imagepng($i); echo base64_encode(ob_get_clean());'), 'base64');
  const multipart = new FormData(); multipart.set('data', JSON.stringify({ name: 'Reader', email: 'reader@example.test', topic: 'hello', message: 'Hidden must not persist' })); multipart.set('attachment', new Blob([image], { type: 'image/png' }), 'reader-note.png');
  const submission = await api(`/forms/${form.id}/submit`, { method: 'POST', auth: null, body: multipart });
  assert.equal(submission.message, 'Your workshop note is saved.');
  await api('/submissions', { auth: null, status: 401 });
  const inbox = (await api('/submissions')).find((row) => row.id === submission.id);
  assert.deepEqual(inbox.data, { name: 'Reader', email: 'reader@example.test', topic: 'hello' }, 'conditionally hidden values are omitted');
  assert.equal(inbox.files[0].contentType, 'image/png');
  const attachment = await request(`/wp-json/wp/v2/media/${inbox.files[0].mediaId}`);
  assert.deepEqual(Buffer.from(await (await fetch(attachment.source_url)).arrayBuffer()), image);
  await api(`/submissions/${submission.id}`, { method: 'PATCH', body: { status: 'read', starred: true, notes: 'Follow up' } });
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.goto(`${base}/?typedpress-plugins=1`, { waitUntil: 'domcontentloaded' });
    const publicForm = page.locator(`.public-form[data-form-id="${form.id}"]`);
    const about = publicForm.getByRole('group', { name: 'About you', exact: true });
    const message = publicForm.getByLabel('Message', { exact: true });
    const next = publicForm.getByRole('button', { name: 'Next', exact: true });
    const send = publicForm.getByRole('button', { name: 'Send message', exact: true });
    await expect(publicForm.getByRole('heading', { name: 'Workshop contact' })).toBeVisible();
    await next.click();
    await expect(about).toBeVisible();
    await expect(publicForm.getByLabel('Name', { exact: true })).toBeFocused();
    await publicForm.getByLabel('Name', { exact: true }).fill('Browser reader');
    await publicForm.getByLabel('Email', { exact: true }).fill('browser-reader@example.test');
    await publicForm.getByRole('combobox', { name: /^Topic/ }).selectOption('other');
    await next.click();
    await expect(message).toBeVisible();
    await send.click();
    await expect(message).toBeFocused();
    await publicForm.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(publicForm.getByLabel('Name', { exact: true })).toHaveValue('Browser reader');
    await publicForm.getByRole('combobox', { name: /^Topic/ }).selectOption('hello');
    await next.click();
    await expect(message).toBeHidden();
    for (const label of ['Website', 'Alternate email', 'Date', 'Count']) {
      await expect(publicForm.getByLabel(label, { exact: true })).toHaveValue('');
    }
    await page.screenshot({ path: join(evidence, 'public-form-desktop.png'), fullPage: true });
    const submitted = page.waitForResponse((response) => response.url() === `${base}/wp-json/typedpress-plugins/v1/forms/${form.id}/submit` && response.request().method() === 'POST');
    await send.click();
    const response = await submitted;
    assert.equal(response.status(), 200, await response.text());
    const browserSubmission = await response.json();
    await expect(publicForm.getByText('Your workshop note is saved.', { exact: true })).toBeVisible();
    await expect(about).toBeVisible();
    const browserInbox = (await api('/submissions')).find((row) => row.id === browserSubmission.id);
    assert.deepEqual(browserInbox.data, { name: 'Browser reader', email: 'browser-reader@example.test', topic: 'hello' }, 'actual browser submission omits hidden and blank optional typed fields');
    assert.deepEqual(browserInbox.files, []);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(evidence, 'public-form-mobile.png'), fullPage: true });
    assert.deepEqual(browserErrors, []);
  } catch (error) {
    if (page) await page.screenshot({ path: join(evidence, 'public-form-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
  await api(`/forms/${form.id}`, { method: 'PATCH', body: { status: 'paused' } });
  await api(`/forms/${form.id}/definition`, { auth: null, status: 409 });
  proofs.push('multi-page form definition, conditional required validation, honeypot, actual public multipart media, private persisted inbox, review and pause; Chromium navigation, conditional input visibility, optional blank typed fields and persisted browser submission');
  assert.equal((await api('/search?q=saffron', { auth: null })).results.some((item) => item.id === entry.id), true);
  assert.equal((await api(`/atproto/documents/${entry.id}`, { auth: null }))['$type'], 'site.standard.document');
  await request(`/wp-json/wp/v2/tp_entries/${entry.id}`, { method: 'POST', body: { password: 'disposable-story-password' } });
  await request(`/wp-json/wp/v2/tp_entries/${entry.id}`, { auth: null, status: 404 });
  const locked = await (await fetch(`${base}/?typedpress-plugin-entry=${entry.id}`)).text();
  assert.match(locked, /post-password-form/);
  assert.doesNotMatch(locked, /Built with real plugins|Grace|youtube-nocookie/);
  assert.doesNotMatch(await (await fetch(`${base}/?typedpress-plugins=1`)).text(), /Native saffron edit/);
  assert.equal((await api('/search?q=saffron', { auth: null })).results.length, 0);
  await api(`/atproto/documents/${entry.id}`, { auth: null, status: 404 });
  await request(`/wp-json/wp/v2/tp_entries/${entry.id}`, { method: 'POST', body: { password: '' } });

  await api('/ai-moderation/analyze', { method: 'POST', body: { text: 'hello' }, status: 424 });
  await api('/ai-search/semantic', { method: 'POST', body: { q: 'saffron' }, status: 424 });
  await api('/atproto/sync', { method: 'POST', body: { id: entry.id }, status: 424 });
  await api('/sandbox/probe', { method: 'POST', body: {}, status: 501 });
  await wp('user', 'create', 'plugin-reader', 'plugin-reader@example.test', '--role=subscriber', '--user_pass=disposable-reader-password');
  const readerPassword = await wp('user', 'application-password', 'create', 'plugin-reader', 'plugin-reader-acceptance', '--porcelain');
  const readerAuth = `Basic ${Buffer.from(`plugin-reader:${readerPassword}`).toString('base64')}`;
  await api('/settings', { auth: readerAuth, status: 403 });
  await api('/submissions', { auth: readerAuth, status: 403 });
  await first('/actions/echo', { method: 'POST', auth: readerAuth, body: { message: 'Denied' }, status: 403 });
  await request(`/wp-json/wp/v2/tp_entries/${entry.id}`, { method: 'POST', body: { comment_status: 'open' } });
  const comment = await request('/wp-json/wp/v2/comments', { method: 'POST', auth: readerAuth, status: 201, body: { post: entry.id, content: 'A local review' } });
  const commentId = String(comment.id);
  assert.equal(await wp('comment', 'get', commentId, '--field=comment_approved'), '0');
  assert.equal(JSON.parse(await wp('comment', 'meta', 'get', commentId, 'zpl_moderation', '--format=json')).decision, 'hold');
  const extra = join(site, 'wp-content/plugins/coexistence-proof'); await mkdir(extra);
  await writeFile(join(extra, 'coexistence-proof.php'), '<?php /* Plugin Name: Coexistence proof */ add_filter("the_title", function($title) { return $title; });');
  await wp('plugin', 'activate', 'coexistence-proof');
  await wp('action-scheduler', 'run', '--hooks=tp_plugins_deliver,tp_plugins_diagnostic');
  // Run retry through the real Action Scheduler action runner, irrespective of its future due time.
  const pending = JSON.parse(await wp('eval', 'echo wp_json_encode(as_get_scheduled_actions(["hook"=>"tp_plugins_deliver","status"=>"pending"], "ids"));'));
  for (const id of pending) await wp('action-scheduler', 'action', 'run', String(id));
  const deliveries = await api('/deliveries');
  assert.equal(deliveries.every((row) => row.status === 'success'), true, JSON.stringify(deliveries));
  assert.equal(deliveries.some((row) => row.attempts === 2), true);
  assert.equal(received.length >= 4, true);
  for (const delivery of received) {
    assert.equal(delivery.url, '/webhook');
    assert.equal(delivery.headers.authorization, 'Bearer disposable-plugin-webhook-token');
    assert.equal(delivery.headers['x-typedpress-signature'], createHmac('sha256', 'disposable-plugin-webhook-token').update(delivery.body).digest('hex'));
  }
  assert.equal((await api('/events')).some((row) => row.event === 'diagnostics.cron'), true);
  await wp('plugin', 'deactivate', 'typedpress-official-plugins');
  await wp('plugin', 'activate', 'typedpress-official-plugins');
  assert.equal((await api('/events')).some((row) => row.event === 'lifecycle.deactivate'), true);
  await command(['dev', 'stop', owned.directory]);
  // Unchanged bounded fields must preserve data without destructive approval.
  await cp(join(owned.directory, 'tp/_generated/migrations/snapshot.json'), join(evidence, 'snapshot-before-restart.json'));
  await command(['dev', owned.directory, '--no-watch']);
  assert.equal((await first(`/entries/${entry.id}`)).title, 'Native saffron edit');
  assert.deepEqual((await first(`/records/${record.id}`)).payload, { nested: { enabled: true }, list: [1, 2] });
  assert.equal((await api('/submissions')).find((row) => row.id === submission.id).notes, 'Follow up');
  const plugins = JSON.parse(await wp('plugin', 'list', '--status=active', '--format=json'));
  for (const name of ['typedpress-official-plugins', 'coexistence-proof', 'secure-custom-fields', 'mcp-adapter']) assert.equal(plugins.some((plugin) => plugin.name === name), true, name);
  const session = JSON.parse(await wp('eval', 'echo wp_json_encode([LOGGED_IN_COOKIE=>wp_generate_auth_cookie(1,time()+3600,"logged_in"),AUTH_COOKIE=>wp_generate_auth_cookie(1,time()+3600,"auth")]);'));
  const cookie = Object.entries(session).map(([name, value]) => `${name}=${value}`).join('; ');
  for (const path of ['/wp-admin/plugins.php', '/wp-admin/options-general.php', '/wp-admin/admin.php?page=typedpress-plugin-lab']) {
    const response = await fetch(`${base}${path}`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(response.status, 200, `${path}: ${response.headers.get('location')}`);
    const html = await response.text();
    assert.equal(html.includes('wpadminbar'), true, path);
    await writeFile(join(evidence, path.includes('plugins.php') ? 'native-plugins.html' : path.includes('options-general') ? 'native-settings.html' : 'workshop-admin.html'), html);
  }
  await first(`/entries/${entry.id}`, { method: 'DELETE' });
  assert.equal((await api('/events')).some((row) => row.event === 'content.deleted' && row.data.resourceId === entry.id), true);
  const retained = await first('/entries', { method: 'POST', status: 201, body: { title: 'Content survives companion plugin uninstall', status: 'published' } });
  await wp('plugin', 'deactivate', 'typedpress-official-plugins');
  await wp('plugin', 'uninstall', 'typedpress-official-plugins');
  assert.equal((await first(`/entries/${retained.id}`)).title, 'Content survives companion plugin uninstall');
  const remaining = JSON.parse(await wp('eval', 'global $wpdb; echo wp_json_encode(["installed"=>get_option("tp_plugins_installed",null),"records"=>(int)$wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type IN (\'zpl_event\',\'zpl_delivery\',\'zpl_form\',\'zpl_submit\')")]);'));
  assert.deepEqual(remaining, { installed: null, records: 0 });
  assert.equal(JSON.parse(await wp('plugin', 'list', '--status=active', '--format=json')).some((plugin) => plugin.name === 'coexistence-proof'), true);
  proofs.push('signed local HTTP delivery with real 503/retry + Action Scheduler effects, plugin lifecycle through uninstall, persisted data/coexistence after an unchanged bounded-field rebuild');
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ base, proofs, qualification: 'local-subset-passed', knownRuntimeIssues: [], providers: status.providers, isolation: status.sandbox, deliveries, received: received.map((item) => ({ event: item.headers['x-emdash-event'], payload: JSON.parse(item.body) })), plugins }, null, 2));
  console.log(`PASS: ${proofs.join('; ')}. External providers and Worker isolation are explicitly unavailable.`);
});
