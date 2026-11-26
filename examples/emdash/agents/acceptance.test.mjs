import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { submitSignIn } from '../sign-in.mjs';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const binary = resolve(process.env.SP_BIN ?? join(here, '../../../target/debug/spacepress'));

async function freePort() {
  // SP_EXAMPLE_PORT pins the WordPress port (a shared machine's assigned lane); otherwise any free one.
  if (process.env.SP_EXAMPLE_PORT) return Number(process.env.SP_EXAMPLE_PORT);
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

test('native WordPress agent workflow: authenticated MCP, core Abilities, REST and editor share real state', { timeout: 600000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'spacepress-emdash-agents-'));
  const project = join(root, 'app');
  const tools = join(root, 'tools');
  const site = join(project, '.sp/dev/wordpress');
  const evidence = { binary, project, site, upstream: '1824902c0c383c052b623528799427b8a5ff75d0', steps: [] };
  console.log(`Agent acceptance evidence: ${root}`);
  await mkdir(project); await mkdir(tools);
  await cp(join(here, 'spacepress.config.ts'), join(project, 'spacepress.config.ts'));
  await cp(join(here, 'public'), join(project, 'public'), { recursive: true });
  // Enforce the public native lifecycle: no Docker or host PHP on the dev process's PATH.
  for (const name of ['node', 'npx', 'npm', 'sh', 'bash', 'uname', 'tar', 'unzip', 'chmod']) {
    for (const directory of process.env.PATH.split(delimiter)) {
      try { await symlink(await realpath(join(directory, name)), join(tools, name)); break; }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
    }
  }
  const env = { ...process.env, PATH: tools };
  const first = async (...args) => (await exec(binary, args, { env, timeout: 240000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
  const wp = (...args) => first('wp', '--site', project, ...args);
  const record = async (step, result) => {
    evidence.steps.push({ step, result });
    await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(`PASS ${step}`);
  };
  t.after(async () => {
    try {
      // A start command can fail after Studio registered the site. Recover from
      // the ownership receipt rather than relying on the command's exit status.
      let owner;
      try { owner = JSON.parse(await readFile(join(project, '.sp/dev/owner.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (owner) {
        assert.equal(owner.project, project);
        assert.equal(owner.site, site);
        await first('dev', 'stop', project);
        const status = JSON.parse(await first('dev', 'status', project));
        assert.equal(status.isOnline, false);
        await exec('npx', ['--yes', '--package', 'wp-studio@2.2.0', '--', 'studio', 'delete', '--path', site, '--no-files'], { timeout: 60000 });
        evidence.cleanup = { stopped: true, exactStudioSiteDeleted: site, online: status.isOnline };
      }
      await rm(project, { recursive: true, force: true });
      await rm(tools, { recursive: true, force: true });
      evidence.cleanup = { ...evidence.cleanup, projectRemoved: true };
    } catch (error) {
      evidence.cleanup = { ...evidence.cleanup, projectRemoved: false, error: error.message };
      throw error;
    } finally {
      await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    }
  });

  await first('dev', project, '--port', String(await freePort()), '--no-watch');
  const status = JSON.parse(await first('dev', 'status', project));
  assert.equal(status.isOnline, true);
  const base = status.siteUrl.replace(/\/$/, '');
  evidence.base = base;
  // Receipts identify this run's project and registration; credentials never enter evidence.
  const receipt = JSON.parse(await readFile(join(project, '.sp/dev/owner.json'), 'utf8'));
  assert.equal(receipt.project, project);
  assert.equal(receipt.site, site);
  evidence.receipt = { project: receipt.project, site: receipt.site, created: receipt.created };
  const authorization = {};
  for (const role of ['admin', 'editor', 'subscriber']) {
    if (role !== 'admin') await wp('user', 'create', role, `${role}@example.test`, `--role=${role}`, '--porcelain');
    const password = await wp('user', 'application-password', 'create', role, 'agents-acceptance', '--porcelain');
    authorization[role] = `Basic ${Buffer.from(`${role}:${password}`).toString('base64')}`;
  }
  const request = async (path, { method = 'GET', body, who, headers = {} } = {}) => {
    const response = await fetch(base + path, {
      method, headers: { ...(who ? { authorization: authorization[who] } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); }
    catch { throw new Error(`${method} ${path}: ${response.status}, non-JSON ${text.slice(0, 250)}`); }
    return { status: response.status, type: response.headers.get('content-type'), json, headers: response.headers };
  };
  const api = (path, options) => request('/wp-json/spacepress/v1' + path, options);
  const ok = (response) => { assert.equal(response.status, 200, JSON.stringify(response.json)); return response.json.data; };
  const ability = (name, input, who, method = 'POST') => {
    const path = `/wp-json/wp-abilities/v1/abilities/agents/${name}/run`;
    const query = new URLSearchParams();
    const put = (key, value) => {
      if (value !== null && typeof value === 'object') for (const [nested, entry] of Object.entries(value)) put(`${key}[${nested}]`, entry);
      else query.append(key, String(value));
    };
    put('input', input);
    return request(method === 'GET' ? `${path}?${query}` : path, {
      who, method, ...(method === 'GET' ? {} : { body: { input } }),
    });
  };

  const schema = ok(await api(''));
  assert.equal(schema.runtime.wp.database.kind, 'sqlite');
  assert.deepEqual(schema.runtime.pendingMigrations, []);
  const plugins = JSON.parse(await wp('plugin', 'list', '--status=active', '--format=json'));
  assert.equal(plugins.find((plugin) => plugin.name === 'mcp-adapter').version, '0.7.1');
  assert.equal(plugins.some((plugin) => plugin.name === 'secure-custom-fields'), true);
  await record('native Studio, SQLite, real MCP Adapter and SCF active', { wordpress: await wp('core', 'version'), plugins: plugins.map(({ name, version }) => ({ name, version })) });

  // Streamable HTTP: initialize, negotiated protocol/session, initialized notification, tools/list/call.
  let rpcId = 0;
  const mcpPath = '/wp-json/mcp/spacepress-agents';
  const initialize = (who) => request(mcpPath, { who, method: 'POST', headers: { accept: 'application/json, text/event-stream' }, body: {
    jsonrpc: '2.0', id: ++rpcId, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'spacepress-native-acceptance', version: '1' },
    },
  } });
  const anonymous = await initialize();
  assert.equal(anonymous.status, 401, JSON.stringify(anonymous.json));
  const clients = {};
  for (const who of ['admin', 'editor', 'subscriber']) {
    const hello = await initialize(who);
    assert.equal(hello.status, 200, JSON.stringify(hello.json));
    assert.equal(hello.json.result.serverInfo.name, 'Agents');
    const session = hello.headers.get('mcp-session-id');
    assert.equal(typeof session, 'string'); assert.notEqual(session, '');
    const headers = { accept: 'application/json, text/event-stream', 'mcp-session-id': session, 'mcp-protocol-version': hello.json.result.protocolVersion };
    const notification = await fetch(base + mcpPath, { method: 'POST', headers: { ...headers, authorization: authorization[who], 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    assert.equal(notification.ok, true);
    clients[who] = async (method, params) => {
      const response = await request(mcpPath, { who, method: 'POST', headers, body: { jsonrpc: '2.0', id: ++rpcId, method, params } });
      assert.equal(response.status, 200, JSON.stringify(response.json));
      assert.equal('result' in response.json, true, JSON.stringify(response.json));
      return response.json.result;
    };
  }
  const toolsListed = (await clients.editor('tools/list')).tools;
  const names = toolsListed.map((tool) => tool.name);
  for (const name of ['agents-articles-list', 'agents-articles-create', 'agents-publish-article', 'agents-global-settings-update', 'agents-job-review', 'agents-echo']) assert.equal(names.includes(name), true, name);
  for (const name of ['agents-private-notes-list', 'agents-global-private-settings-get', 'agents-operator-note', 'agents-job-internal-sweep']) assert.equal(names.includes(name), false, name);
  assert.equal(toolsListed.find((tool) => tool.name === 'agents-articles-list').annotations.readOnlyHint, true);
  assert.equal(toolsListed.find((tool) => tool.name === 'agents-articles-delete').annotations.destructiveHint, true);
  const call = (who, name, input) => clients[who]('tools/call', { name: `agents-${name}`, arguments: input });
  const content = (result) => { assert.equal(result.isError, false, JSON.stringify(result)); return result.structuredContent; };
  const echo = content(await call('subscriber', 'echo', { message: 'Native MCP works' }));
  assert.deepEqual(echo, { message: 'Native MCP works', length: 16 });
  assert.deepEqual(echo, ok(await api('/actions/echo', { who: 'subscriber', method: 'POST', body: { message: 'Native MCP works' } })));
  assert.deepEqual(content(await call('admin', 'echo', { message: 'admin' })), { message: 'admin', length: 5 });
  await record('authenticated MCP handshake, named tool discovery and official echo behavior', { anonymousStatus: anonymous.status, tools: names, echo });

  const descriptors = JSON.parse(await wp('spacepress', 'abilities')).data;
  for (const name of ['agents/private-notes-list', 'agents/global-private-settings-get', 'agents/operator-note']) {
    const descriptor = descriptors.find((entry) => entry.name === name);
    assert.deepEqual([descriptor.meta.show_in_rest, descriptor.meta.mcp.public], [false, false]);
  }
  assert.equal(descriptors.some((entry) => entry.name === 'agents/job-internal-sweep'), false);
  const core = await request('/wp-json/wp-abilities/v1/abilities?category=agents&per_page=100', { who: 'editor' });
  assert.equal(core.status, 200, JSON.stringify(core.json));
  assert.deepEqual(core.json.map((entry) => entry.name).sort(), descriptors.filter((entry) => entry.meta.show_in_rest).map((entry) => entry.name).sort());
  const echoAbility = await ability('echo', { message: 'core' }, 'editor', 'GET');
  assert.deepEqual([echoAbility.status, echoAbility.json], [200, { message: 'core', length: 4 }]);
  // Agent opt-out changes discoverability, not canonical API authorization or availability.
  assert.deepEqual(ok(await api('/actions/operatorNote', { who: 'admin', method: 'POST', body: { note: 'API only' } })), { note: 'API only' });
  await record('core Abilities discovery and execution; collection/action/global opt-out; jobs default off', { abilities: core.json.map((entry) => entry.name) });

  const draft = content(await call('editor', 'articles-create', { title: 'A real agent draft', status: 'draft', body: '<!-- wp:paragraph --><p>Draft body</p><!-- /wp:paragraph -->', internalNote: 'Editors only' }));
  assert.equal(draft.status, 'draft');
  assert.deepEqual(ok(await api('/articles')), []);
  assert.deepEqual(content(await call('subscriber', 'articles-list', {})).rows, []);
  assert.equal(content(await call('editor', 'articles-list', {})).rows[0].id, draft.id);
  const nativeSave = await request(`/wp-json/wp/v2/sp_articles/${draft.id}`, { who: 'editor', method: 'POST', body: {
    title: 'Saved in the native editor', content: '<!-- wp:paragraph --><p>Native WordPress body</p><!-- /wp:paragraph -->', acf: { sp_internalNote: 'Native SCF note' },
  } });
  assert.equal(nativeSave.status, 200, JSON.stringify(nativeSave.json));
  const nativeViaAgent = content(await call('editor', 'articles-get', { id: draft.id }));
  assert.equal(nativeViaAgent.title, 'Saved in the native editor');
  assert.equal(nativeViaAgent.internalNote, 'Native SCF note');
  assert.match(nativeViaAgent.body, /Native WordPress body/);
  const published = content(await call('editor', 'publish-article', { id: draft.id }));
  assert.equal(published.status, 'published');
  const publicRows = ok(await api('/articles'));
  assert.equal(publicRows[0].id, draft.id);
  assert.equal('internalNote' in publicRows[0], false);
  const subscriberRows = content(await call('subscriber', 'articles-list', {})).rows;
  assert.deepEqual(subscriberRows, publicRows);
  const coreRows = await ability('articles-list', {}, 'subscriber', 'GET');
  assert.equal(coreRows.status, 200, JSON.stringify(coreRows.json));
  assert.deepEqual(coreRows.json.rows, publicRows);
  await record('MCP create → native REST/SCF save → MCP publish → public REST; row rules and field masking', { articleId: draft.id, publicRows });

  const deniedRest = await api(`/articles/${draft.id}`, { who: 'subscriber', method: 'PATCH', body: { title: 'Forbidden' } });
  const deniedCore = await ability('articles-update', { id: draft.id, patch: { title: 'Forbidden' } }, 'subscriber');
  const deniedMcp = await call('subscriber', 'articles-update', { id: draft.id, patch: { title: 'Forbidden' } });
  assert.deepEqual([deniedRest.status, deniedRest.json.code, deniedCore.status, deniedCore.json.code, deniedMcp.isError], [403, 'forbidden', 403, 'sp_forbidden', true]);
  assert.equal(ok(await api(`/articles/${draft.id}`)).title, 'Saved in the native editor');
  const anonymousWrite = await api('/articles', { method: 'POST', body: { title: 'Forbidden' } });
  assert.deepEqual([anonymousWrite.status, anonymousWrite.json.code], [401, 'unauthenticated']);
  const badRest = await api('/actions/echo', { who: 'editor', method: 'POST', body: { message: '' } });
  const badCore = await ability('echo', { message: '' }, 'editor', 'GET');
  const badMcp = await call('editor', 'echo', { message: '' });
  assert.deepEqual([badRest.status, badRest.json.code, badRest.json.pointer], [422, 'invalid_input', '/message']);
  assert.match(badRest.type, /^application\/problem\+json/);
  assert.deepEqual([badCore.status, badCore.json.code, badCore.json.data.pointer, badMcp.isError], [422, 'sp_invalid_input', '/message', true]);
  const missing = await call('editor', 'publish-article', { id: 999999999 });
  assert.equal(missing.isError, true);
  await record('failure envelopes and denied mutations preserve real state', { rest: badRest.json, core: badCore.json, mcp: badMcp, deniedMcp, missing });

  const updatedSettings = content(await call('editor', 'global-settings-update', { heading: 'Published with real tools' }));
  assert.deepEqual(ok(await api('/settings')), updatedSettings);
  const coreSettings = await ability('global-settings-get', {}, 'subscriber', 'GET');
  assert.deepEqual([coreSettings.status, coreSettings.json], [200, updatedSettings]);
  const review = content(await call('editor', 'job-review', { articleId: draft.id }));
  assert.equal(['string', 'number'].includes(typeof review.id), true, JSON.stringify(review));
  await wp('action-scheduler', 'run', '--hooks=sp_job');
  assert.equal(ok(await api(`/articles/${draft.id}`)).reviewed, true);
  const deniedJob = await call('subscriber', 'job-review', { articleId: draft.id });
  assert.equal(deniedJob.isError, true);
  const publicPage = `/wp-content/plugins/spacepress-app-agents/public/index.html`;
  const served = await fetch(base + publicPage);
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type'), /text\/html/);
  const adminPage = await fetch(base + '/wp-admin/');
  assert.equal(adminPage.status, 200);
  assert.match(adminPage.url, /wp-login\.php/);
  await record('global mutation, durable job effect, public frontend served, full WordPress admin retained', { heading: updatedSettings.heading, jobId: review.id, publicPage, reviewed: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + publicPage);
    await page.getByRole('heading', { name: 'Saved in the native editor', exact: true }).waitFor();
    assert.equal(await page.title(), 'Published with real tools');
    assert.equal(await page.locator('article p').textContent(), 'Native WordPress body');
    assert.equal(await page.locator('.reviewed').textContent(), 'Review job completed');
    assert.equal(await page.getByText('Native SCF note').count(), 0);
    await page.screenshot({ path: join(root, 'notebook-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(root, 'notebook-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await page.goto(base + '/wp-admin/');
    await Promise.all([page.waitForURL('**/wp-admin/**'), submitSignIn(page, 'admin', 'spacepress-test-admin')]);
    // Default admin mode: a classic page opened as a page is framed in SpacePress Admin at /classic/<page>.
    for (const [file, heading] of [['plugins.php', 'Plugins'], ['options-general.php', 'General Settings']]) {
      await page.goto(base + '/wp-admin/' + file);
      // `/wp-admin/new/<route>` with pretty permalinks, `admin.php?page=spacepress-admin&p=<route>` without.
      await page.waitForURL((url) => (url.pathname.startsWith('/wp-admin/new/') ? url.pathname.slice('/wp-admin/new'.length) : url.searchParams.get('p')) === '/classic/' + file);
      await page.frameLocator('iframe').getByRole('heading', { name: heading, exact: true }).waitFor();
    }
    // Developer mode (the user's own setting): classic wp-admin opens as itself.
    await wp('user', 'meta', 'update', 'admin', 'sp_admin_developer_mode', '1');
    for (const [file, heading] of [['plugins.php', 'Plugins'], ['options-general.php', 'General Settings']]) {
      await page.goto(base + '/wp-admin/' + file);
      assert.equal(new URL(page.url()).pathname, '/wp-admin/' + file);
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    }
    await wp('user', 'meta', 'delete', 'admin', 'sp_admin_developer_mode');
    await record('browser renders published editor content and job marker on desktop/mobile; classic plugins/settings remain usable framed in SpacePress Admin and on their own in developer mode', { screenshots: ['notebook-desktop.png', 'notebook-mobile.png'], browserErrors: errors });
  } finally { await browser.close(); }
});
