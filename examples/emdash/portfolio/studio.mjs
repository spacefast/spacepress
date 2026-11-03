import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const source = dirname(fileURLToPath(import.meta.url));
const repo = resolve(source, '../../..');
const zero = resolve(process.env.ZERO_BIN ?? join(repo, 'target/debug/zero'));
const evidence = resolve(process.env.ZERO_PORTFOLIO_EVIDENCE ?? await mkdtemp(join(tmpdir(), 'zero-portfolio-evidence-')));

async function port() {
  const listener = createServer();
  await new Promise((done) => listener.listen(0, '127.0.0.1', done));
  const address = listener.address();
  assert.equal(typeof address, 'object');
  assert.notEqual(address, null);
  const value = address.port;
  await new Promise((done) => listener.close(done));
  return value;
}

export async function startStudio() {
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), 'zero-portfolio-studio-'));
  const project = join(root, 'app');
  const site = join(project, '.zero/dev/wordpress');
  const command = async (args) => {
    const result = await execute(zero, args, { cwd: repo, timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
    return result.stdout.trim();
  };
  const wp = (...args) => command(['dev', 'wp', project, '--', ...args]);
  await mkdir(project);
  await cp(join(source, 'zero.config.ts'), join(project, 'zero.config.ts'));
  const receipt = { root, project, site, evidence, binary: zero, state: 'starting' };
  const save = () => writeFile(join(evidence, 'studio.json'), JSON.stringify(receipt, null, 2) + '\n');
  await save();
  const cleanup = async () => {
    await command(['dev', 'stop', project]);
    const status = JSON.parse(await command(['dev', 'status', project]));
    assert.equal(status.isOnline, false);
    const deleted = await execute('npx', ['--yes', '--package', 'wp-studio@2.1.1', '--', 'studio', 'delete', '--path', site, '--no-files'], { cwd: repo, timeout: 120000 });
    await writeFile(join(evidence, 'cleanup.txt'), `Stopped exact project: ${project}\nOnline: ${status.isOnline}\nDeleted exact Studio registration: ${site}\n${deleted.stdout}${deleted.stderr}`);
    receipt.state = 'deleted';
    await save();
    await rm(root, { recursive: true, force: true });
  };
  try {
    await writeFile(join(evidence, 'start.log'), await command(['dev', project, '--port', String(await port()), '--no-watch']));
    const status = JSON.parse(await command(['dev', 'status', project]));
    assert.equal(status.isOnline, true);
    const base = status.siteUrl.replace(/\/$/, '');
    Object.assign(receipt, { base, state: 'running' });
    await save();
    await cp(join(project, '.zero/dev'), join(evidence, 'dev-receipt'), { recursive: true, filter: (path) => !path.includes('/wordpress') });
    await cp(join(source, 'frontend'), join(site, 'wp-content/plugins/zero-portfolio-frontend'), { recursive: true });
    await wp('plugin', 'activate', 'zero-portfolio-frontend');
    const password = await wp('user', 'application-password', 'create', 'admin', 'zero-portfolio-acceptance', '--porcelain');
    const authorization = `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;
    const request = async (path, { method = 'GET', body, headers = {}, authenticated = true } = {}) => {
      const response = await fetch(`${base}${path}`, { method, headers: { ...(authenticated ? { authorization } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const result = await response.json();
      assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
      return result.data ?? result;
    };
    const api = (path, options) => request(`/wp-json/zero/v1${path}`, options);
    const uploads = [];
    const uploadBytes = async ({ bytes, filename, type = 'image/png', alt = '' }) => {
      const response = await fetch(`${base}/wp-json/wp/v2/media`, { method: 'POST', headers: { authorization, 'content-type': type, 'content-disposition': `attachment; filename="${filename}"` }, body: bytes, signal: AbortSignal.timeout(60000) });
      const row = await response.json();
      assert.equal(response.status, 201, JSON.stringify(row));
      if (alt) await request(`/wp-json/wp/v2/media/${row.id}`, { method: 'POST', body: { alt_text: alt } });
      const served = await fetch(row.source_url, { signal: AbortSignal.timeout(30000) });
      assert.equal(served.status, 200);
      assert.deepEqual(Buffer.from(await served.arrayBuffer()), bytes, `Uploaded bytes changed: ${filename}`);
      uploads.push({ id: row.id, filename, url: row.source_url, type, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      await writeFile(join(evidence, 'uploads.json'), JSON.stringify(uploads, null, 2) + '\n');
      return row;
    };
    const remote = new Map();
    const upload = async ({ url, filename, alt }) => {
      if (remote.has(url)) return remote.get(url);
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      assert.equal(response.status, 200, url);
      const media = await uploadBytes({ bytes: Buffer.from(await response.arrayBuffer()), filename, alt, type: response.headers.get('content-type').split(';')[0] });
      remote.set(url, media);
      return media;
    };
    return { root, project, site, evidence, base, command, wp, request, api, upload, uploadBytes, cleanup };
  } catch (error) {
    await writeFile(join(evidence, 'failure.txt'), error.stack ?? String(error));
    await cleanup().catch(async (cleanupError) => writeFile(join(evidence, 'cleanup-failure.txt'), String(cleanupError)));
    throw error;
  }
}
