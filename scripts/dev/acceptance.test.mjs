import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { get } from 'node:http';

const exec = promisify(execFile);
const zero = resolve(process.env.ZERO_BIN ?? 'target/debug/zero');
const command = async (args, env = process.env) => (await exec(zero, args, { env, timeout: 600000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const config = (version, extra = '', admin = true) => `
import { defineConfig, table, collection, text, boolean, integer, json, richText, action, job, jobs, db } from 'zero';
const items = table({ name: text().notNull(), processed: boolean().notNull().default(false), ${extra} });
const stories = collection({ title: text().notNull().max(160), body: richText(), details: json() }, { title: 'title', content: 'body', access: { read: 'anyone', create: 'editor', update: 'editor', delete: 'editor' } });
export default defineConfig({
  admin: ${admin}, tables: { items }, collections: { stories },
  hooks: { items: { afterCreate: async (item) => { await jobs.stamp.enqueue({ itemId: item.id }); } } },
  jobs: { stamp: job({ input: { itemId: integer().notNull() }, handler: async ({ itemId }) => {
    await db.update(items).set({ processed: true }).where({ id: itemId });
  } }) },
  actions: { version: action({ input: {}, handler() { return '${version}'; } }) }
});
`;

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

function foreground(args, env) {
  const child = spawn(zero, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const root = await mkdtemp(join(tmpdir(), 'zero-studio-acceptance-'));
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
  const env = { ...process.env, PATH: tools };
  await writeFile(join(project, 'zero.config.ts'), config('first'));
  await writeFile(join(project, 'public/index.html'), '<h1>Native Zero dev</h1>');
  let session;
  const site = join(project, '.zero/dev/wordpress');
  t.after(async () => {
    const failures = [];
    const studio = async (...args) => (await exec('npx', ['--yes', '--package', 'wp-studio@2.1.1', '--', 'studio', ...args], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 })).stdout;
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
  await command(['dev', project, '--port', String(await freePort()), '--no-watch'], env);
  const status = JSON.parse(await command(['dev', 'status', project], env));
  assert.equal(status.isOnline, true);
  const base = status.siteUrl.replace(/\/$/, '');
  const wp = (...args) => command(['wp', '--site', project, ...args], env);
  const password = await wp('user', 'application-password', 'create', 'admin', 'zero-acceptance', '--porcelain');
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
        const probe = get(`${base}/wp-json/zero/v1/_schema`, { agent: false, signal: AbortSignal.timeout(3000) }, (response) => {
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
  const api = (path, options) => request(`/wp-json/zero/v1${path}`, options);
  const schema = await api('/_schema');
  assert.equal(schema.runtime.wp.database.kind, 'sqlite');
  assert.equal(schema.runtime.identity, true);
  assert.deepEqual(schema.runtime.pendingMigrations, []);
  const item = await api('/items', { method: 'POST', body: { name: 'Chickpeas' } });
  await wp('action-scheduler', 'run', '--hooks=zero_job');
  const rows = await api('/items');
  assert.equal(rows.find((row) => row.id === item.id).processed, true);
  const story = await api('/stories', { method: 'POST', body: { title: 'Pantry story', body: '<!-- wp:paragraph --><p>Original</p><!-- /wp:paragraph -->', details: { count: 1 } } });
  await request(`/wp-json/wp/v2/zero_stories/${story.id}`, { method: 'POST', body: { title: 'Edited in WordPress', acf: { zero_details: '{"count":2}' } } });
  const stories = await api('/stories');
  assert.equal(stories.find((row) => row.id === story.id).title, 'Edited in WordPress');
  assert.deepEqual(stories.find((row) => row.id === story.id).details, { count: 2 });
  const identity = await request('/wp-json/zero-identity/v1/sign-in/password', { method: 'POST', body: { login: 'admin', password: 'zero-test-admin' }, headers: { origin: base } });
  assert.equal(identity.kind, 'signed_in');
  // Create real image bytes with Studio's own PHP, then upload through native WordPress REST.
  const image = Buffer.from(await wp('eval', '$i=imagecreatetruecolor(12,8); ob_start(); imagepng($i); echo base64_encode(ob_get_clean());'), 'base64');
  const uploadResponse = await fetch(`${base}/wp-json/wp/v2/media`, { method: 'POST', headers: {
    authorization, 'content-type': 'image/png', 'content-disposition': 'attachment; filename="zero-local.png"',
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
  session = foreground(['dev', project], env);
  let cursor = await session.wait('Watching config');
  assert.equal(JSON.parse(await command(['dev', 'status', project], env)).siteUrl, status.siteUrl);
  assert.equal((await api('/items')).find((row) => row.id === item.id).name, 'Chickpeas');
  await writeFile(join(project, 'zero.config.ts'), 'export default { broken: ;');
  cursor = await session.wait('Fix the error and save to retry.', cursor);
  assert.equal(await api('/actions/version', { method: 'POST', body: {} }), 'first');
  const failurePlugin = join(site, 'wp-content/mu-plugins/acceptance-migrate-failure.php');
  await mkdir(join(site, 'wp-content/mu-plugins'), { recursive: true });
  await writeFile(failurePlugin, `<?php
if (defined('WP_CLI') && WP_CLI) {
  WP_CLI::error('Acceptance configuration interruption');
}`);
  await writeFile(join(project, 'zero.config.ts'), config('second', 'shelf: text(),'));
  cursor = await session.wait('Acceptance configuration interruption', cursor);
  cursor = await session.wait('Fix the error and save to retry.', cursor);
  const interrupted = JSON.parse(await readFile(join(project, '.zero/dev/owner.json'), 'utf8'));
  assert.notDeepEqual(interrupted.pending.migrations, interrupted.migrations);
  const interruptedExit = once(session.child, 'exit');
  await command(['dev', 'stop', project], env);
  assert.deepEqual(await interruptedExit, [0, null]);
  await rm(failurePlugin);
  session = foreground(['dev', project], env);
  cursor = await session.wait('Watching config');
  const recovered = JSON.parse(await readFile(join(project, '.zero/dev/owner.json'), 'utf8'));
  assert.equal(recovered.pending, undefined);
  assert.deepEqual(recovered.migrations, interrupted.pending.migrations);
  assert.equal(await api('/actions/version', { method: 'POST', body: {} }), 'second');
  await api(`/items/${item.id}`, { method: 'PATCH', body: { shelf: 'A2' } });
  assert.equal((await api('/items')).find((row) => row.id === item.id).shelf, 'A2');
  await writeFile(join(project, 'zero.config.ts'), config('would-drop-shelf'));
  cursor = await session.wait('Local data was preserved.', cursor);
  assert.equal((await api('/items')).find((row) => row.id === item.id).shelf, 'A2');
  // Restoring the config must not replay a hidden DROP migration from the rejected save.
  await writeFile(join(project, 'zero.config.ts'), config('third', 'shelf: text(),', false));
  cursor = await session.wait('Updated. Refresh', cursor);
  assert.equal((await api('/items')).find((row) => row.id === item.id).shelf, 'A2');
  const plugins = JSON.parse(await wp('plugin', 'list', '--status=active', '--format=json'));
  assert.equal(plugins.some((plugin) => plugin.name === 'acceptance-extra'), true);
  assert.equal(plugins.some((plugin) => plugin.name === 'zero-admin'), false);
  const pluginPage = await fetch(`${base}/wp-content/plugins/zero-app-app/public/index.html`);
  assert.equal(await pluginPage.text(), '<h1>Native Zero dev</h1>');
  await writeFile(join(project, 'public/index.html'), '<h1>Updated public file</h1>');
  await session.wait('Updated. Refresh', cursor);
  assert.equal(await (await fetch(`${base}/wp-content/plugins/zero-app-app/public/index.html`)).text(), '<h1>Updated public file</h1>');
  const exit = once(session.child, 'exit');
  await command(['dev', 'stop', project], env);
  assert.deepEqual(await exit, [0, null]);
  assert.equal(JSON.parse(await command(['dev', 'status', project], env)).isOnline, false);
  await writeFile(join(project, 'zero.config.ts'), config('deliberate', '', false));
  await command(['dev', project, '--no-watch', '--allow-destructive'], env);
  assert.equal(await api('/actions/version', { method: 'POST', body: {} }), 'deliberate');
  assert.equal((await api('/items')).find((row) => row.id === item.id).name, 'Chickpeas');
  assert.equal(await readFile(join(extra, 'acceptance-extra.php'), 'utf8'), '<?php /* Plugin Name: Acceptance extra */');
  console.log('Studio acceptance: native editor + SCF, identity, uploads, queued job, schema/public watching, invalid-build recovery, data/plugin persistence; no host PHP or Docker on PATH.');
});
