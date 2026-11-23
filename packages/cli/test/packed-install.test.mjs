// The packed `spacepress` tarball, installed the way npm users get it, against a local copy of a
// release: archives and checksums for every target the release workflow builds, named the way
// lib/release.mjs downloads them. The compiler inside is a stand-in script, so this needs no
// Rust build; scripts/release/acceptance.mjs runs the same install with the real compiler.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { assetName, metadata, releasePage, releaseTarget, releaseTargets } from '../lib/release.mjs';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
let supported = true;
try { releaseTarget(); } catch { supported = false; }

/** A release directory with one stand-in archive and checksum per target. */
async function release(directory) {
  await mkdir(directory);
  for (const target of releaseTargets) {
    const stage = await mkdtemp(join(tmpdir(), 'spacepress-fixture-'));
    await writeFile(join(stage, 'spacepress'), `#!/bin/sh\necho "fixture compiler ${target}: $*"\n`);
    await chmod(join(stage, 'spacepress'), 0o755);
    await writeFile(join(stage, 'LICENSE'), 'fixture\n');
    const name = assetName({ target });
    await exec('tar', ['-czf', join(directory, name), '-C', stage, 'spacepress', 'LICENSE']);
    await rm(stage, { recursive: true, force: true });
    const hash = createHash('sha256').update(await readFile(join(directory, name))).digest('hex');
    await writeFile(join(directory, `${name}.sha256`), `${hash}  ${name}\n`);
  }
}

test('the packed launcher installs the compiler from a local release and runs it', { skip: !supported && 'no prebuilt target for this platform' }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'spacepress-packed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assets = join(root, 'release');
  await release(assets);
  assert.equal((await readdir(assets)).length, releaseTargets.length * 2);

  const { stdout } = await exec('npm', ['pack', join(repo, 'packages/cli'), '--json', '--pack-destination', root], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const tarball = join(root, JSON.parse(stdout.slice(stdout.indexOf('[')))[0].filename);
  const project = join(root, 'project');
  await mkdir(project);
  await writeFile(join(project, 'package.json'), '{"name":"packed-install-test","private":true}\n');
  const env = {
    ...process.env, SP_BIN: '', SP_OFFLINE: '', SP_CACHE_DIR: join(root, 'cache'),
    npm_config_cache: join(root, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
  };
  const install = (extra) => exec('npm', ['install', tarball], { cwd: project, env: { ...env, ...extra }, maxBuffer: 16 * 1024 * 1024 });
  const launcher = join(project, 'node_modules/.bin/spacepress');

  // Not published (what an anonymous download from a private repository gets): the install fails
  // and says where it looked and how to go on.
  const server = createServer((_request, response) => { response.writeHead(404); response.end('Not Found'); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  await assert.rejects(install({ SP_RELEASE_BASE_URL: `http://127.0.0.1:${server.address().port}/` }), (error) => {
    assert.match(error.stderr, /HTTP 404/);
    assert.match(error.stderr, /not downloadable from SP_RELEASE_BASE_URL/);
    assert.match(error.stderr, /not published yet or its assets are not public/);
    assert.match(error.stderr, /SP_BIN=\/absolute\/path\/to\/spacepress/);
    return true;
  });

  // Published: postinstall downloads, verifies and caches it, and the launcher runs it.
  await install({ SP_RELEASE_BASE_URL: pathToFileURL(`${assets}/`).href });
  const target = releaseTarget();
  assert.equal((await exec(launcher, ['check', 'app'], { env })).stdout, `fixture compiler ${target}: check app\n`);
  assert.deepEqual(await readdir(join(root, 'cache', metadata.version, target)), ['receipt.json', 'spacepress']);
  // Cached: offline runs need neither the release nor the network.
  assert.equal((await exec(launcher, ['build'], { env: { ...env, SP_OFFLINE: '1', SP_RELEASE_BASE_URL: 'http://127.0.0.1:1/' } })).stdout, `fixture compiler ${target}: build\n`);
});

test('without a mirror, a missing release points at the GitHub release page', () => {
  assert.equal(releasePage('0.3.0'), 'https://github.com/spacefast/spacepress/releases/tag/v0.3.0');
  assert.equal(new Set(releaseTargets.map((target) => assetName({ version: '0.3.0', target }))).size, 7);
});
