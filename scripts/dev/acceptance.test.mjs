import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { watch } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { get } from 'node:http';
import { connect, createServer } from 'node:net';
import { chromiumPath } from '../../tests/differential/client/chromium.mjs';

const require = createRequire(new URL('../../tests/differential/client/package.json', import.meta.url));
const { chromium } = require('playwright-core');

const exec = promisify(execFile);
const first = resolve(process.env.SP_BIN ?? 'target/debug/spacepress');
const command = async (args, env = process.env) => (await exec(first, args, { env, timeout: 600000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const config = (version, extra = '', admin = true) => `
import { defineConfig, table, collection, text, boolean, json, richText, job, db, mutation } from 'spacepress';
export const items = table({ name: text(), processed: boolean().default(false), ${extra} })
  .on({ afterCreate: async (item) => { await stamp.enqueue({ itemId: item.id }); } });
export const stories = collection({ title: text().max(160), body: richText().optional(), details: json().optional() }, { title: 'title', content: 'body', access: { read: 'anyone', create: 'editor', update: 'editor', delete: 'editor' } });
export const stamp = job({}, async ({ itemId }: { itemId: number }) => {
  await db.update(items).set({ processed: true }).where({ id: itemId });
});
export const version = mutation({}, () => { return '${version}'; });
export default defineConfig({ admin: ${admin} });
`;

// `spacepress mcp` over stdio: one request per tool call, then end of input, which stops the server.
async function mcp(flags, env, calls) {
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
  const running = exec(first, ['mcp', ...flags], { env, timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
  running.child.stdin.end(calls.map(([name, args], id) => JSON.stringify({
    jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, _meta: meta },
  })).join('\n') + '\n');
  const answers = (await running).stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(answers.map((answer) => answer.id), calls.map((_, id) => id));
  return answers.map((answer) => answer.result);
}

function foreground(args, env) {
  const child = spawn(first, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const events = new EventEmitter();
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { output += data; events.emit('output'); });
  child.on('exit', () => events.emit('output'));
  const wait = (text, from = 0) => new Promise((done, fail) => {
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${text}:\n${output}`)), 180000);
    const finish = (error, cursor) => { clearTimeout(timeout); events.off('output', check); error ? fail(error) : done(cursor); };
    const check = () => {
      const match = output.indexOf(text, from);
      if (match !== -1) finish(undefined, match + text.length);
      else if (child.exitCode !== null) finish(new Error(`Dev exited early:\n${output}`));
    };
    events.on('output', check); check();
  });
  return { child, wait, output: () => output };
}

test('Docker-free dev supports editing, jobs, identity, uploads, rebuild recovery and persistent restarts', { timeout: 600000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'spacepress-studio-acceptance-'));
  const project = join(root, 'app');
  const tools = join(root, 'tools');
  await mkdir(project); await mkdir(tools); await mkdir(join(project, 'public'));
  // The complete dev process gets no docker or host php executable on PATH.
  for (const name of ['node', 'npx', 'npm', 'sh', 'bash', 'uname', 'tar', 'unzip', 'chmod']) {
    for (const directory of process.env.PATH.split(delimiter)) {
      try { await symlink(await realpath(join(directory, name)), join(tools, name)); break; }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
    }
  }
  // Whatever runs this suite, `spacepress dev` sees no agent and no CI unless a step below says so.
  const { CI: _ci, CLAUDECODE: _claude, CODEX_SANDBOX: _codex, AI_AGENT: _ai, AGENT: _agent, ...inherited } = process.env;
  const env = { ...inherited, PATH: tools };
  await writeFile(join(project, 'spacepress.config.ts'), config('first'));
  await writeFile(join(project, 'public/index.html'), '<h1>Native SpacePress dev</h1>');
  const pageFile = join(project, 'sp/app/page.tsx');
  const pageSource = (title) => `export default function Page() { return <h1>${title}</h1>; }\n`;
  await mkdir(join(project, 'sp/app'), { recursive: true });
  await writeFile(pageFile, pageSource('Original dev page'));
  const dbTypes = join(project, 'sp/_generated/db.d.ts');
  let session;
  let browser;
  const site = join(project, '.sp/dev/wordpress');
  t.after(async () => {
    await browser?.close();
    const failures = [];
    const studio = async (...args) => (await exec('npx', ['--yes', '--package', 'wp-studio@2.2.0', '--', 'studio', ...args], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 })).stdout;
    const sites = async () => JSON.parse(await studio('list', '--format=json'));
    try { await command(['dev', 'stop', project], env); }
    catch (error) { failures.push(error); }
    if (session && session.child.exitCode === null) {
      try { await once(session.child, 'exit', { signal: AbortSignal.timeout(10000) }); }
      catch (error) { failures.push(error); }
    }
    try {
      if ((await sites()).some((entry) => resolve(entry.path) === site)) {
        await studio('delete', site, '--no-files', '--format=json');
      }
      assert.equal((await sites()).some((entry) => resolve(entry.path) === site), false, 'Disposable site remains registered in Studio');
      if (session) assert.ok(session.child.exitCode !== null || session.child.signalCode !== null, 'Dev process remains running');
      await rm(root, { recursive: true, force: true });
    } catch (error) { failures.push(error); }
    if (failures.length) {
      const error = new AggregateError(failures, `Native acceptance cleanup failed; inspect ${root}`);
      console.error(error);
      if (!t.error) throw error;
    }
  });
  const firstStart = await command(['dev', project, '--port', process.env.SP_DEV_TEST_PORT ?? '8813', '--no-watch'], env);
  const status = JSON.parse(await command(['dev', 'status', project], env));
  assert.equal(status.isOnline, true);
  const base = status.siteUrl.replace(/\/$/, '');
  const originalTypes = await readFile(dbTypes, 'utf8');
  assert.match(originalTypes, /processed/);
  assert.doesNotMatch(await (await fetch(base)).text(), /spacepress-dev\/live-client/);
  // The summary links SpacePress Admin where it is mounted. Studio's server reads no .htaccess, so the
  // address answers with the form every server serves, wp-admin's own page for SpacePress Admin.
  assert.match(firstStart, new RegExp(`SpacePress Admin: ${base}/wp-admin/new/\n`));
  const adminLink = await fetch(`${base}/wp-admin/new/`, { redirect: 'manual' });
  assert.equal(adminLink.status, 302);
  assert.equal(adminLink.headers.get('location'), `${base}/wp-admin/admin.php?page=spacepress-admin&p=%2F`);
  // A coding agent's view of the same site: its state and URL, a read, and (only when the server
  // was started with --allow-writes) a write and an action, all through the site commands.
  const [devStatus, refusedInsert] = await mcp([project], env, [
    ['dev_status', {}],
    ['insert', { kind: 'items', rows: [{ name: 'Not written' }] }],
  ]);
  // Started with --no-watch: the site runs, and no process is rebuilding it.
  const expected = {
    state: 'running', url: base, port: Number(new URL(base).port), admin: `${base}/wp-admin/`, site: await realpath(site),
    watching: false, pid: null, log: null, error: null, wordpress: status.wpVersion, php: status.phpVersion,
  };
  assert.deepEqual(devStatus.structuredContent, expected);
  // `spacepress dev status --json` is the same report, from the state file `spacepress dev` wrote.
  assert.deepEqual(JSON.parse(await command(['dev', 'status', project, '--json'], env)), expected);
  assert.equal(JSON.parse(await readFile(join(project, '.sp/dev/state.json'), 'utf8')).url, base);
  assert.equal(refusedInsert.isError, true);
  const [inserted, read, updated, ran, all] = await mcp([project, '--allow-writes'], env, [
    ['insert', { kind: 'items', rows: [{ name: 'From an agent' }] }],
    ['query', { kind: 'items', where: { name: 'From an agent' }, columns: { name: true } }],
    ['update', { kind: 'items', where: { name: 'From an agent' }, set: { name: 'Renamed by an agent' } }],
    ['run_action', { name: 'version', input: {} }],
    ['query', { kind: 'items' }],
  ]);
  assert.equal(inserted.isError, false, JSON.stringify(inserted));
  assert.deepEqual(read.structuredContent, { data: [{ name: 'From an agent' }] });
  assert.equal(updated.isError, false, JSON.stringify(updated));
  assert.deepEqual(ran.structuredContent, { data: 'first' });
  // The refused insert wrote nothing: the one row is the allowed server's.
  assert.deepEqual(all.structuredContent.data.map((row) => row.name), ['Renamed by an agent']);
  const wp = (...args) => command(['wp', '--site', project, ...args], env);
  const password = await wp('user', 'application-password', 'create', 'admin', 'spacepress-acceptance', '--porcelain');
  const authorization = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        method, headers: { authorization, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      console.error('Native request failed:', method, path, error.cause ?? error);
      // Diagnose a fresh read-only connection without replaying the failed operation.
      const health = await new Promise((done) => {
        const probe = get(`${base}/wp-json/spacepress/v1`, { agent: false, signal: AbortSignal.timeout(3000) }, (response) => {
          response.resume();
          response.on('end', () => done({ status: response.statusCode }));
          response.on('error', (failure) => done({ error: failure.message, code: failure.code }));
        });
        probe.on('error', (failure) => done({ error: failure.message, code: failure.code }));
      });
      console.error('Fresh HTTP health:', health);
      if (session) {
        console.error('Dev process:', { pid: session.child.pid, exitCode: session.child.exitCode, signalCode: session.child.signalCode });
        console.error('Dev session output:\n' + session.output());
      }
      console.error('Studio status:', await command(['dev', 'status', project], env).catch((failure) => failure.message));
      throw error;
    }
    const result = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
    return result.data ?? result;
  }
  const api = (path, options) => request(`/wp-json/spacepress/v1${path}`, options);
  const schema = await api('');
  assert.equal(schema.runtime.wp.database.kind, 'sqlite');
  assert.equal(schema.runtime.identity, true);
  assert.deepEqual(schema.runtime.pendingMigrations, []);
  const item = await api('/items', { method: 'POST', body: { name: 'Chickpeas' } });
  await wp('action-scheduler', 'run', '--hooks=sp_job');
  const rows = await api('/items');
  assert.equal(rows.find((row) => row.id === item.id).processed, true);
  const story = await api('/stories', { method: 'POST', body: { title: 'Pantry story', body: '<!-- wp:paragraph --><p>Original</p><!-- /wp:paragraph -->', details: { count: 1 } } });
  await request(`/wp-json/wp/v2/sp_stories/${story.id}`, { method: 'POST', body: { title: 'Edited in WordPress', acf: { sp_details: '{"count":2}' } } });
  const stories = await api('/stories');
  assert.equal(stories.find((row) => row.id === story.id).title, 'Edited in WordPress');
  assert.deepEqual(stories.find((row) => row.id === story.id).details, { count: 2 });
  const identity = await request('/wp-json/spacepress-identity/v1/sign-in/password', { method: 'POST', body: { login: 'admin', password: 'spacepress-test-admin' }, headers: { origin: base } });
  assert.equal(identity.kind, 'signed_in');
  // Create real image bytes with Studio's own PHP, then upload through native WordPress REST.
  const image = Buffer.from(await wp('eval', '$i=imagecreatetruecolor(12,8); ob_start(); imagepng($i); echo base64_encode(ob_get_clean());'), 'base64');
  const uploadResponse = await fetch(`${base}/wp-json/wp/v2/media`, { method: 'POST', headers: {
    authorization, 'content-type': 'image/png', 'content-disposition': 'attachment; filename="spacepress-local.png"',
  }, body: image, signal: AbortSignal.timeout(20000) });
  const upload = await uploadResponse.json();
  assert.equal(uploadResponse.status, 201, JSON.stringify(upload));
  const servedImage = await fetch(upload.source_url);
  assert.deepEqual(Buffer.from(await servedImage.arrayBuffer()), image);
  const extra = join(site, 'wp-content/plugins/acceptance-extra');
  await mkdir(extra);
  await writeFile(join(extra, 'acceptance-extra.php'), '<?php /* Plugin Name: Acceptance extra */');
  await wp('plugin', 'activate', 'acceptance-extra');
  await command(['dev', 'stop', project], env);
  assert.equal(JSON.parse(await command(['dev', 'status', project], env)).isOnline, false);
  assert.equal((await mcp([project], env, [['dev_status', {}]]))[0].structuredContent.state, 'stopped');
  assert.deepEqual(JSON.parse(await command(['dev', 'status', project, '--json'], env)), { ...expected, state: 'stopped' });
  // A browser on another machine: the site is opened at an address Studio does not listen on, here
  // a relay on another port of another loopback name. Every page must work from that address alone.
  const relay = createServer((client) => {
    const upstream = connect(Number(new URL(base).port), 'localhost');
    for (const socket of [client, upstream]) socket.on('error', () => { client.destroy(); upstream.destroy(); });
    client.pipe(upstream).pipe(client);
  });
  relay.listen(0, '127.0.0.1');
  await once(relay, 'listening');
  t.after(() => { relay.close(); relay.closeAllConnections?.(); });
  const announced = `http://127.0.0.1:${relay.address().port}`;
  session = foreground(['dev', project, '--url', announced], env);
  let cursor = await session.wait('Watching config');
  assert.match(session.output(), new RegExp(`Website:   ${announced}/\n`));
  const liveFile = join(site, 'wp-content/mu-plugins/spacepress-dev/live.json');
  let followed;
  assert.equal(JSON.parse(await command(['dev', 'status', project], env)).siteUrl, status.siteUrl);
  assert.equal((await api('/items')).find((row) => row.id === item.id).name, 'Chickpeas');
  await t.test('open pages reload after a page edit and recover from a compile error, from the announced address alone', async () => {
    browser = await chromium.launch({ executablePath: chromiumPath() });
    const context = await browser.newContext();
    context.setDefaultTimeout(90000);
    const client = 'script[src*="spacepress-dev/live-client.js"]';
    // Two tabs on the home page, and one on the file public/index.html (the summary's "App:" link).
    const tabs = await Promise.all([context.newPage(), context.newPage()]);
    const publicFile = await context.newPage();
    const requests = [];
    for (const page of [...tabs, publicFile]) page.on('request', (request) => requests.push(request.url()));
    await Promise.all(tabs.map((page) => page.goto(announced)));
    await Promise.all(tabs.map((page) => page.getByRole('heading', { name: 'Original dev page' }).waitFor()));
    await publicFile.goto(`${announced}/index.html`);
    await publicFile.getByRole('heading', { name: 'Native SpacePress dev' }).waitFor();
    await publicFile.locator(client).waitFor({ state: 'attached' });
    // The file itself is served as written: the client is added to the answer, not to the project.
    assert.equal(await readFile(join(project, 'public/index.html'), 'utf8'), '<h1>Native SpacePress dev</h1>');
    await publicFile.evaluate(() => { window.spDevLoaded = 'before the edit'; });

    // The login page, wp-admin and SpacePress Admin carry the client too.
    const admin = await context.newPage();
    await admin.goto(`${announced}/wp-login.php`);
    await admin.locator(client).waitFor({ state: 'attached' });
    await admin.locator('#user_login').fill('admin');
    await admin.locator('#user_pass').fill('spacepress-test-admin');
    await Promise.all([admin.waitForURL(/\/wp-admin\//), admin.locator('#wp-submit').click()]);
    await admin.goto(`${announced}/wp-admin/index.php`);
    await admin.locator(client).waitFor({ state: 'attached' });
    await admin.goto(`${announced}/wp-admin/new/`);
    await admin.locator('#spacepress-admin-app').waitFor({ state: 'attached' });
    await admin.locator(client).waitFor({ state: 'attached' });
    await admin.evaluate(() => { window.spDevLoaded = 'before the edit'; });

    // A page rendered to be kept (spacepress export, a prerender) has no client in it.
    assert.match(await (await fetch(base)).text(), /spacepress-dev\/live-client\.js\?build=/);
    assert.doesNotMatch(await (await fetch(base, { headers: { 'x-spacepress-export': '1' } })).text(), /spacepress-dev/);
    assert.doesNotMatch(await (await fetch(base, { headers: { 'x-spacepress-prerender': `1.${'a'.repeat(64)}` } })).text(), /spacepress-dev/);

    const saved = performance.now();
    await writeFile(pageFile, pageSource('Updated dev page'));
    await Promise.all(tabs.map((page) => page.getByRole('heading', { name: 'Updated dev page' }).waitFor()));
    console.log(`Save to reloaded page: ${Math.round(performance.now() - saved)} ms`);
    cursor = await session.wait('Updated.', cursor);
    // Every open document reloaded, whatever kind of page it is.
    for (const page of [publicFile, admin]) await page.waitForFunction(() => window.spDevLoaded === undefined);
    await publicFile.getByRole('heading', { name: 'Native SpacePress dev' }).waitFor();

    const generated = join(project, 'sp/_generated');
    const files = async () => {
      const entries = await readdir(generated, { recursive: true, withFileTypes: true });
      const paths = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort();
      return Promise.all(paths.map(async (path) => [path, await readFile(path)]));
    };
    const lastGood = await files();
    await writeFile(pageFile, 'export default function Page() { return ; const broken = ; }\n');
    cursor = await session.wait('error[F1001]', cursor);
    cursor = await session.wait('Fix the error and save to retry.', cursor);
    for (const page of [...tabs, publicFile]) {
      const overlay = page.locator('spacepress-dev-error');
      const code = overlay.getByRole('link', { name: 'error[F1001]' });
      await code.waitFor();
      assert.equal(await code.getAttribute('href'), 'https://spacepress.dev/docs/reference/language-support#:~:text=F1001');
      assert.match(await overlay.locator('code').innerText(), /sp\/app\/page\.tsx:1:\d+/);
      assert.match(await overlay.locator('pre').textContent(), /\S/);
    }
    assert.deepEqual(await files(), lastGood);
    // The running site says what is wrong with it, to `dev status --json` and to an agent.
    const failing = JSON.parse(await command(['dev', 'status', project, '--json'], env));
    assert.equal(failing.state, 'running');
    assert.equal(failing.error.diagnostics[0].code, 'F1001');
    assert.equal(failing.error.message, failing.error.diagnostics[0].message);
    assert.deepEqual((await mcp([project], env, [['dev_status', {}]]))[0].structuredContent.error, failing.error);
    // Dismissed, the error stays away while it is the same error; the other tab keeps its own.
    await tabs[0].locator('spacepress-dev-error').getByRole('button', { name: 'Dismiss' }).click();
    await tabs[0].locator('spacepress-dev-error').waitFor({ state: 'detached' });
    await new Promise((done) => setTimeout(done, 1500));
    assert.equal(await tabs[0].locator('spacepress-dev-error').count(), 0);
    assert.equal(await tabs[1].locator('spacepress-dev-error').count(), 1);

    await writeFile(pageFile, pageSource('Recovered dev page'));
    cursor = await session.wait('Updated.', cursor);
    await Promise.all(tabs.map(async (page) => {
      await page.getByRole('heading', { name: 'Recovered dev page' }).waitFor();
      await page.locator('spacepress-dev-error').waitFor({ state: 'detached' });
    }));
    await publicFile.locator('spacepress-dev-error').waitFor({ state: 'detached' });
    assert.equal(JSON.parse(await command(['dev', 'status', project, '--json'], env)).error, null);
    // Nothing these pages asked of this machine went anywhere but the announced address: no reload
    // channel on another port or name, which a browser on another machine could not reach.
    // (WordPress's own admin bar asks gravatar.com for the signed-in user's picture.)
    assert.ok(requests.some((url) => url.startsWith(`${announced}/wp-content/mu-plugins/spacepress-dev/live.json`)));
    const local = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
    assert.deepEqual(requests.filter((url) => /^https?:/.test(url) && local(url) && !url.startsWith(`${announced}/`)), []);
    // One tab stays open across the restart below.
    followed = tabs[0];
    await followed.evaluate(() => { window.spDevLoaded = 'before the restart'; });
    await Promise.all([tabs[1], publicFile, admin].map((page) => page.close()));
  });
  await writeFile(join(project, 'spacepress.config.ts'), 'export default { broken: ;');
  cursor = await session.wait('Fix the error and save to retry.', cursor);
  assert.equal(await api('/actions/version', { method: 'POST', body: {} }), 'first');
  const failurePlugin = join(site, 'wp-content/mu-plugins/acceptance-migrate-failure.php');
  await mkdir(join(site, 'wp-content/mu-plugins'), { recursive: true });
  await writeFile(failurePlugin, `<?php
if (defined('WP_CLI') && WP_CLI) {
  WP_CLI::error('Acceptance configuration interruption');
}`);
  await writeFile(join(project, 'spacepress.config.ts'), config('second', 'shelf: text().optional(),'));
  cursor = await session.wait('Acceptance configuration interruption', cursor);
  cursor = await session.wait('Fix the error and save to retry.', cursor);
  const interrupted = JSON.parse(await readFile(join(project, '.sp/dev/owner.json'), 'utf8'));
  assert.notDeepEqual(interrupted.pending.migrations, interrupted.migrations);
  assert.doesNotMatch(originalTypes, /shelf/);
  assert.match(await readFile(dbTypes, 'utf8'), /shelf/);
  const interruptedExit = once(session.child, 'exit');
  await command(['dev', 'stop', project], env);
  assert.deepEqual(await interruptedExit, [0, null]);
  // A stopped session leaves no reload signal: pages rendered without it carry no client.
  assert.equal(await readFile(liveFile, 'utf8'), 'null\n');
  await rm(failurePlugin);
  // --foreground keeps the command attached even where it would go to the background by itself.
  session = foreground(['dev', project, '--foreground'], { ...env, CLAUDECODE: '1' });
  cursor = await session.wait('Watching config');
  // The tab left open follows the new session: it stops asking the stopped one and reloads.
  // (The browser subtest above leaves it; when that failed, the steps after this still run.)
  if (followed) {
    await followed.waitForFunction(() => window.spDevLoaded === undefined);
    await followed.close();
  }
  const recovered = JSON.parse(await readFile(join(project, '.sp/dev/owner.json'), 'utf8'));
  assert.equal(recovered.pending, undefined);
  assert.deepEqual(recovered.migrations, interrupted.pending.migrations);
  assert.equal(await api('/actions/version', { method: 'POST', body: {} }), 'second');
  await api(`/items/${item.id}`, { method: 'PATCH', body: { shelf: 'A2' } });
  assert.equal((await api('/items')).find((row) => row.id === item.id).shelf, 'A2');
  await writeFile(join(project, 'spacepress.config.ts'), config('would-drop-shelf'));
  cursor = await session.wait('Local data was preserved.', cursor);
  assert.equal((await api('/items')).find((row) => row.id === item.id).shelf, 'A2');
  // Restoring the config must not replay a hidden DROP migration from the rejected save.
  await writeFile(join(project, 'spacepress.config.ts'), config('third', 'shelf: text().optional(),', false));
  cursor = await session.wait('Updated.', cursor);
  assert.equal((await api('/items')).find((row) => row.id === item.id).shelf, 'A2');
  const plugins = JSON.parse(await wp('plugin', 'list', '--status=active', '--format=json'));
  assert.equal(plugins.some((plugin) => plugin.name === 'acceptance-extra'), true);
  assert.equal(plugins.some((plugin) => plugin.name === 'spacepress-admin'), false);
  const pluginPage = await fetch(`${base}/wp-content/plugins/spacepress-app-app/public/index.html`);
  assert.equal(await pluginPage.text(), '<h1>Native SpacePress dev</h1>');
  await writeFile(join(project, 'public/index.html'), '<h1>Updated public file</h1>');
  await session.wait('Updated.', cursor);
  assert.equal(await (await fetch(`${base}/wp-content/plugins/spacepress-app-app/public/index.html`)).text(), '<h1>Updated public file</h1>');
  const exit = once(session.child, 'exit');
  await command(['dev', 'stop', project], env);
  assert.deepEqual(await exit, [0, null]);
  assert.equal(JSON.parse(await command(['dev', 'status', project], env)).isOnline, false);
  // --detach: the command returns once the site is up, and a background process keeps rebuilding.
  const started = await command(['dev', project, '--detach'], env);
  assert.match(started, new RegExp(`Website:   ${base}/`));
  const background = JSON.parse(await command(['dev', 'status', project, '--json'], env));
  const log = join(await realpath(project), '.sp/dev/dev.log');
  assert.deepEqual(background, { ...expected, watching: true, pid: background.pid, log });
  assert.ok(Number.isSafeInteger(background.pid) && background.pid !== process.pid);
  assert.match(started, new RegExp(`Running in the background \\(pid ${background.pid}\\)`));
  process.kill(background.pid, 0); // it exists
  const waitForLog = (text) => new Promise((done, fail) => {
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${text} in ${log}`)), 180000);
    const watcher = watch(join(project, '.sp/dev'), () => void check());
    const finish = (error) => { clearTimeout(timeout); watcher.close(); error ? fail(error) : done(); };
    const check = () => readFile(log, 'utf8').then((content) => { if (content.includes(text)) finish(); }, () => {});
    void check();
  });
  // A second start, attached or not, is refused and leaves the running session's log alone.
  await assert.rejects(command(['dev', project, '--detach'], env), /Another spacepress dev command owns this project/);
  assert.match(await readFile(log, 'utf8'), /Website:/);
  await writeFile(join(project, 'spacepress.config.ts'), config('background', 'shelf: text().optional(),', false));
  await waitForLog('Updated.');
  assert.equal(await api('/actions/version', { method: 'POST', body: {} }), 'background');
  // An agent's shell (no terminal, CLAUDECODE set) gets the same without the flag; here the
  // session above still owns the project, so the background start is what is refused.
  await assert.rejects(command(['dev', project], { ...env, CLAUDECODE: '1' }), /running in the background, because CLAUDECODE is set[^]*Another spacepress dev command owns this project/);
  await command(['dev', 'stop', project], env);
  // `dev stop` returns when the watcher has released the project; the process itself ends just after.
  await new Promise((done, fail) => {
    const deadline = setTimeout(() => finish(new Error(`The background spacepress dev (pid ${background.pid}) is still running after dev stop`)), 60000);
    const finish = (error) => { clearTimeout(deadline); clearInterval(probe); error ? fail(error) : done(); };
    const gone = () => { try { process.kill(background.pid, 0); } catch (error) { if (error.code === 'ESRCH') finish(); } };
    const probe = setInterval(gone, 100); gone();
  });
  // The stopped watcher is no longer on record, so a later process with its number is not taken for it.
  const recorded = JSON.parse(await readFile(join(project, '.sp/dev/state.json'), 'utf8'));
  assert.deepEqual([recorded.pid, recorded.log, recorded.url], [null, null, base]);
  assert.deepEqual(JSON.parse(await command(['dev', 'status', project, '--json'], env)), { ...expected, state: 'stopped' });
  // --detach with a first build that fails: WordPress still starts and the process keeps watching,
  // but the command exits 1 with the error, and the status carries it until a build succeeds.
  await writeFile(pageFile, 'export default function Page() { return ; const broken = ; }\n');
  const refused = await command(['dev', project, '--detach'], env).then(() => null, (error) => error);
  assert.equal(refused?.code, 1, 'spacepress dev --detach exits 1 when the first build fails');
  assert.match(refused.stdout, new RegExp(`Website:   ${base}/`));
  assert.match(refused.stderr, /the first build failed, so the site does not serve this source yet:[^]*error\[F1001\]/);
  const broken = JSON.parse(await command(['dev', 'status', project, '--json'], env));
  assert.deepEqual([broken.state, broken.watching, broken.error.diagnostics[0].code], ['running', true, 'F1001']);
  assert.match(refused.stderr, new RegExp(`WordPress is running in the background \\(pid ${broken.pid}\\)`));
  assert.deepEqual((await mcp([project], env, [['dev_status', {}]]))[0].structuredContent.error, broken.error);
  // The site still serves the last build, and saving a fix rebuilds it.
  assert.equal(await api('/actions/version', { method: 'POST', body: {} }), 'background');
  await writeFile(pageFile, pageSource('Fixed in the background'));
  await waitForLog('Updated.');
  assert.match(await (await fetch(base)).text(), /Fixed in the background/);
  assert.equal(JSON.parse(await command(['dev', 'status', project, '--json'], env)).error, null);
  await command(['dev', 'stop', project], env);
  assert.deepEqual(JSON.parse(await command(['dev', 'status', project, '--json'], env)), { ...expected, state: 'stopped' });
  await writeFile(join(project, 'spacepress.config.ts'), config('deliberate', '', false));
  await command(['dev', project, '--no-watch', '--allow-destructive'], env);
  assert.equal(await api('/actions/version', { method: 'POST', body: {} }), 'deliberate');
  assert.equal((await api('/items')).find((row) => row.id === item.id).name, 'Chickpeas');
  assert.equal(await readFile(join(extra, 'acceptance-extra.php'), 'utf8'), '<?php /* Plugin Name: Acceptance extra */');
  await t.test('production build excludes the dev client and its WordPress hook', async () => {
    const production = join(root, 'production');
    await command(['build', project, '--out', production], env);
    const entries = await readdir(production, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      assert.doesNotMatch(entry.name, /spacepress-dev|live-client/);
      if (entry.isFile() && /\.(?:js|php)$/.test(entry.name)) {
        assert.doesNotMatch(await readFile(join(entry.parentPath, entry.name), 'utf8'), /spacepress-dev-error|spacepress-dev\/live-client/);
      }
    }
  });
  console.log('Studio acceptance: native editor + SCF, identity, uploads, queued job, schema/public watching, invalid-build recovery, data/plugin persistence; no host PHP or Docker on PATH.');
});
