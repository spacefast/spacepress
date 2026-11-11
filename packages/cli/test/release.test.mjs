import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { assetName, compiler, metadata, releaseTarget } from '../lib/release.mjs';

const exec = promisify(execFile);
const launcher = fileURLToPath(new URL('../bin/first.mjs', import.meta.url));

test('launcher help/version work offline and explicit compiler paths fail without executable fallback', async () => {
  const env = { ...process.env, FIRST_BIN: '/no-such-first-compiler', FIRST_OFFLINE: '1' };
  assert.match((await exec(process.execPath, [launcher, '--help'], { env })).stdout, /Site \(wp first <command>.*\n(.*\n)*  jobs +inspect and drive background jobs/);
  assert.equal((await exec(process.execPath, [launcher, '--version'], { env })).stdout, `first ${metadata.version} (npm launcher)\n`);
  await assert.rejects(exec(process.execPath, [launcher, 'check'], { env }), (error) => error.code === 1 && /Cannot use FIRST_BIN/.test(error.stderr));
  await assert.rejects(compiler({ env: { FIRST_BIN: 'first' } }), /absolute path/);
  assert.throws(() => releaseTarget({ platform: 'win32', arch: 'x64' }), /No prebuilt First compiler/);
  assert.throws(() => assetName({ version: '../bad', target: releaseTarget() }), /Invalid First release version/);
});

test('installer rejects offline, unavailable and corrupt releases without installing a payload', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'first-setup-errors-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { FIRST_CACHE_DIR: join(root, 'cache'), FIRST_OFFLINE: '1' };
  await assert.rejects(compiler({ env }), /not cached and downloads are disabled/);
  const server = createServer((_request, response) => { response.writeHead(404); response.end('not released'); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())));
  const base = `http://127.0.0.1:${server.address().port}/`;
  await assert.rejects(compiler({ env: { ...env, FIRST_OFFLINE: '0', FIRST_RELEASE_BASE_URL: base } }), /HTTP 404/);
  const release = join(root, 'release');
  await mkdir(release);
  const name = assetName({ target: releaseTarget() });
  await writeFile(join(release, name), 'corrupt archive');
  await writeFile(join(release, `${name}.sha256`), `${'0'.repeat(64)}  ${name}\n`);
  const local = { ...env, FIRST_OFFLINE: '0', FIRST_RELEASE_BASE_URL: pathToFileURL(`${release}/`).href };
  await assert.rejects(compiler({ env: local }), /SHA-256 checksum mismatch/);
  const hash = createHash('sha256').update('corrupt archive').digest('hex');
  await writeFile(join(release, `${name}.sha256`), `${hash}  ${name}\n`);
  await assert.rejects(compiler({ env: local }), /Cannot install First/);
  assert.deepEqual(await readdir(join(root, 'cache', metadata.version)), []);
  const incomplete = join(root, 'cache', metadata.version, releaseTarget());
  await mkdir(incomplete);
  await assert.rejects(compiler({ env }), /Cannot use cached First/);
});
