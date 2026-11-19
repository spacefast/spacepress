import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { watch } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { get } from 'node:http';

const exec = promisify(execFile);
const first = resolve(process.env.TP_BIN ?? 'target/debug/typedpress');
const command = async (args, env = process.env) => (await exec(first, args, { env, timeout: 600000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const config = (version, extra = '', admin = true) => `
import { defineConfig, table, collection, text, boolean, integer, json, richText, action, job, jobs, db } from 'typedpress';
export const items = table({ name: text(), processed: boolean().default(false), ${extra} })
  .on({ afterCreate: async (item) => { await jobs.stamp.enqueue({ itemId: item.id }); } });
export const stories = collection({ title: text().max(160), body: richText().optional(), details: json().optional() }, { title: 'title', content: 'body', access: { read: 'anyone', create: 'editor', update: 'editor', delete: 'editor' } });
export const stamp = job({ input: { itemId: integer() }, handler: async ({ itemId }) => {
  await db.update(items).set({ processed: true }).where({ id: itemId });
} });
export const version = action({ input: {}, handler() { return '${version}'; } });
export default defineConfig({ admin: ${admin} });
`;

// `typedpress mcp` over stdio: one request per tool call, then end of input, which stops the server.
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

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
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
  const root = await mkdtemp(join(tmpdir(), 'typedpress-studio-acceptance-'));
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
  // Whatever runs this suite, `typedpress dev` sees no agent and no CI unless a step below says so.
  const { CI: _ci, CLAUDECODE: _claude, CODEX_SANDBOX: _codex, AI_AGENT: _ai, AGENT: _agent, ...inherited } = process.env;
  const env = { ...inherited, PATH: tools };
  await writeFile(join(project, 'typedpress.config.ts'), config('first'));
  await writeFile(join(project, 'public/index.html'), '<h1>Native TypedPress dev</h1>');
  let session;
  const site = join(project, '.tp/dev/wordpress');
  t.after(async () => {
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
  const firstStart = await command(['dev', project, '--port', String(await freePort()), '--no-watch'], env);
  const status = JSON.parse(await command(['dev', 'status', project], env));
  assert.equal(status.isOnline, true);
  const base = status.siteUrl.replace(/\/$/, '');
  // The summary links TypedPress Admin where it is mounted. Studio's server reads no .htaccess, so the
  // address answers with the form every server serves, wp-admin's own page for TypedPress Admin.
  assert.match(firstStart, new RegExp(`TypedPress Admin: ${base}/wp-admin/new/\n`));
  const adminLink = await fetch(`${base}/wp-admin/new/`, { redirect: 'manual' });
  assert.equal(adminLink.status, 302);
  assert.equal(adminLink.headers.get('location'), `${base}/wp-admin/admin.php?page=typedpress-admin&p=%2F`);
  // A coding agent's view of the same site: its state and URL, a read, and (only when the server
  // was started with --allow-writes) a write and an action, all through the site commands.
  const [devStatus, refusedInsert] = await mcp([project], env, [
    ['dev_status', {}],
    ['insert', { kind: 'items', rows: [{ name: 'Not written' }] }],
  ]);
  // Started with --no-watch: the site runs, and no process is rebuilding it.
  const expected = {
    state: 'running', url: base, port: Number(new URL(base).port), admin: `${base}/wp-admin/`, site: await realpath(site),
    watching: false, pid: null, log: null, wordpress: status.wpVersion, php: status.phpVersion,
  };
  assert.deepEqual(devStatus.structuredContent, expected);
  // `typedpress dev status --json` is the same report, from the state file `typedpress dev` wrote.
  assert.deepEqual(JSON.parse(await command(['dev', 'status', project, '--json'], env)), expected);
  assert.equal(JSON.parse(await readFile(join(project, '.tp/dev/state.json'), 'utf8')).url, base);
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
  const password = await wp('user', 'application-password', 'create', 'admin', 'typedpress-acceptance', '--porcelain');
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
        const probe = get(`${base}/wp-json/typedpress/v1`, { agent: false, signal: AbortSignal.timeout(3000) }, (response) => {
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
  const api = (path, options) => request(`/wp-json/typedpress/v1${path}`, options);
  const schema = await api('');
  assert.equal(schema.runtime.wp.database.kind, 'sqlite');
  assert.equal(schema.runtime.identity, true);
  assert.deepEqual(schema.runtime.pendingMigrations, []);
  const item = await api('/items', { method: 'POST', body: { name: 'Chickpeas' } });
  await wp('action-scheduler', 'run', '--hooks=tp_job');
  const rows = await api('/items');
  assert.equal(rows.find((row) => row.id === item.id).processed, true);
  const story = await api('/stories', { method: 'POST', body: { title: 'Pantry story', body: '<!-- wp:paragraph --><p>Original</p><!-- /wp:paragraph -->', details: { count: 1 } } });
  await request(`/wp-json/wp/v2/tp_stories/${story.id}`, { method: 'POST', body: { title: 'Edited in WordPress', acf: { tp_details: '{"count":2}' } } });
  const stories = await api('/stories');
  assert.equal(stories.find((row) => row.id === story.id).title, 'Edited in WordPress');
  assert.deepEqual(stories.find((row) => row.id === story.id).details, { count: 2 });
  const identity = await request('/wp-json/typedpress-identity/v1/sign-in/password', { method: 'POST', body: { login: 'admin', password: 'typedpress-test-admin' }, headers: { origin: base } });
  assert.equal(identity.kind, 'signed_in');
  // Create real image bytes with Studio's own PHP, then upload through native WordPress REST.
  const image = Buffer.from(await wp('eval', '$i=imagecreatetruecolor(12,8); ob_start(); imagepng($i); echo base64_encode(ob_get_clean());'), 'base64');
  const uploadResponse = await fetch(`${base}/wp-json/wp/v2/media`, { method: 'POST', headers: {
    authorization, 'content-type': 'image/png', 'content-disposition': 'attachment; filename="typedpress-local.png"',
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
  session = foreground(['dev', project], env);
  let cursor = await session.wait('Watching config');
  assert.equal(JSON.parse(await command(['dev', 'status', project], env)).siteUrl, status.siteUrl);
  assert.equal((await api('/items')).find((row) => row.id === item.id).name, 'Chickpeas');
  await writeFile(join(project, 'typedpress.config.ts'), 'export default { broken: ;');
  cursor = await session.wait('Fix the error and save to retry.', cursor);
  assert.equal(await api('/actions/version', { method: 'POST', body: {} }), 'first');
  const failurePlugin = join(site, 'wp-content/mu-plugins/acceptance-migrate-failure.php');
  await mkdir(join(site, 'wp-content/mu-plugins'), { recursive: true });
  await writeFile(failurePlugin, `<?php
if (defined('WP_CLI') && WP_CLI) {
  WP_CLI::error('Acceptance configuration interruption');
}`);
  await writeFile(join(project, 'typedpress.config.ts'), config('second', 'shelf: text().optional(),'));
  cursor = await session.wait('Acceptance configuration interruption', cursor);
  cursor = await session.wait('Fix the error and save to retry.', cursor);
  const interrupted = JSON.parse(await readFile(join(project, '.tp/dev/owner.json'), 'utf8'));
  assert.notDeepEqual(interrupted.pending.migrations, interrupted.migrations);
  const interruptedExit = once(session.child, 'exit');
  await command(['dev', 'stop', project], env);
  assert.deepEqual(await interruptedExit, [0, null]);
  await rm(failurePlugin);
  // --foreground keeps the command attached even where it would go to the background by itself.
  session = foreground(['dev', project, '--foreground'], { ...env, CLAUDECODE: '1' });
  cursor = await session.wait('Watching config');
  const recovered = JSON.parse(await readFile(join(project, '.tp/dev/owner.json'), 'utf8'));
  assert.equal(recovered.pending, undefined);
  assert.deepEqual(recovered.migrations, interrupted.pending.migrations);
  assert.equal(await api('/actions/version', { method: 'POST', body: {} }), 'second');
  await api(`/items/${item.id}`, { method: 'PATCH', body: { shelf: 'A2' } });
  assert.equal((await api('/items')).find((row) => row.id === item.id).shelf, 'A2');
  await writeFile(join(project, 'typedpress.config.ts'), config('would-drop-shelf'));
  cursor = await session.wait('Local data was preserved.', cursor);
  assert.equal((await api('/items')).find((row) => row.id === item.id).shelf, 'A2');
  // Restoring the config must not replay a hidden DROP migration from the rejected save.
  await writeFile(join(project, 'typedpress.config.ts'), config('third', 'shelf: text().optional(),', false));
  cursor = await session.wait('Updated. Refresh', cursor);
  assert.equal((await api('/items')).find((row) => row.id === item.id).shelf, 'A2');
  const plugins = JSON.parse(await wp('plugin', 'list', '--status=active', '--format=json'));
  assert.equal(plugins.some((plugin) => plugin.name === 'acceptance-extra'), true);
  assert.equal(plugins.some((plugin) => plugin.name === 'typedpress-admin'), false);
  const pluginPage = await fetch(`${base}/wp-content/plugins/typedpress-app-app/public/index.html`);
  assert.equal(await pluginPage.text(), '<h1>Native TypedPress dev</h1>');
  await writeFile(join(project, 'public/index.html'), '<h1>Updated public file</h1>');
  await session.wait('Updated. Refresh', cursor);
  assert.equal(await (await fetch(`${base}/wp-content/plugins/typedpress-app-app/public/index.html`)).text(), '<h1>Updated public file</h1>');
  const exit = once(session.child, 'exit');
  await command(['dev', 'stop', project], env);
  assert.deepEqual(await exit, [0, null]);
  assert.equal(JSON.parse(await command(['dev', 'status', project], env)).isOnline, false);
  // --detach: the command returns once the site is up, and a background process keeps rebuilding.
  const started = await command(['dev', project, '--detach'], env);
  assert.match(started, new RegExp(`Website:   ${base}/`));
  const background = JSON.parse(await command(['dev', 'status', project, '--json'], env));
  const log = join(await realpath(project), '.tp/dev/dev.log');
  assert.deepEqual(background, { ...expected, watching: true, pid: background.pid, log });
  assert.ok(Number.isSafeInteger(background.pid) && background.pid !== process.pid);
  assert.match(started, new RegExp(`Running in the background \\(pid ${background.pid}\\)`));
  process.kill(background.pid, 0); // it exists
  const waitForLog = (text) => new Promise((done, fail) => {
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${text} in ${log}`)), 180000);
    const watcher = watch(join(project, '.tp/dev'), () => void check());
    const finish = (error) => { clearTimeout(timeout); watcher.close(); error ? fail(error) : done(); };
    const check = () => readFile(log, 'utf8').then((content) => { if (content.includes(text)) finish(); }, () => {});
    void check();
  });
  // A second start, attached or not, is refused and leaves the running session's log alone.
  await assert.rejects(command(['dev', project, '--detach'], env), /Another typedpress dev command owns this project/);
  assert.match(await readFile(log, 'utf8'), /Website:/);
  await writeFile(join(project, 'typedpress.config.ts'), config('background', 'shelf: text().optional(),', false));
  await waitForLog('Updated. Refresh');
  assert.equal(await api('/actions/version', { method: 'POST', body: {} }), 'background');
  // An agent's shell (no terminal, CLAUDECODE set) gets the same without the flag; here the
  // session above still owns the project, so the background start is what is refused.
  await assert.rejects(command(['dev', project], { ...env, CLAUDECODE: '1' }), /running in the background, because CLAUDECODE is set[^]*Another typedpress dev command owns this project/);
  await command(['dev', 'stop', project], env);
  // `dev stop` returns when the watcher has released the project; the process itself ends just after.
  await new Promise((done, fail) => {
    const deadline = setTimeout(() => finish(new Error(`The background typedpress dev (pid ${background.pid}) is still running after dev stop`)), 60000);
    const finish = (error) => { clearTimeout(deadline); clearInterval(probe); error ? fail(error) : done(); };
    const gone = () => { try { process.kill(background.pid, 0); } catch (error) { if (error.code === 'ESRCH') finish(); } };
    const probe = setInterval(gone, 100); gone();
  });
  // The stopped watcher is no longer on record, so a later process with its number is not taken for it.
  const recorded = JSON.parse(await readFile(join(project, '.tp/dev/state.json'), 'utf8'));
  assert.deepEqual([recorded.pid, recorded.log, recorded.url], [null, null, base]);
  assert.deepEqual(JSON.parse(await command(['dev', 'status', project, '--json'], env)), { ...expected, state: 'stopped' });
  await writeFile(join(project, 'typedpress.config.ts'), config('deliberate', '', false));
  await command(['dev', project, '--no-watch', '--allow-destructive'], env);
  assert.equal(await api('/actions/version', { method: 'POST', body: {} }), 'deliberate');
  assert.equal((await api('/items')).find((row) => row.id === item.id).name, 'Chickpeas');
  assert.equal(await readFile(join(extra, 'acceptance-extra.php'), 'utf8'), '<?php /* Plugin Name: Acceptance extra */');
  console.log('Studio acceptance: native editor + SCF, identity, uploads, queued job, schema/public watching, invalid-build recovery, data/plugin persistence; no host PHP or Docker on PATH.');
});
