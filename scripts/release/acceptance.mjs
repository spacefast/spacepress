// Runs only against the caller's real compiler and an exclusively owned temporary directory.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { archive } from './archive.mjs';
import { root } from './version.mjs';
import { releaseTarget } from '../../packages/cli/lib/release.mjs';
import { stopOwnedDaemon } from './studio-cleanup.mjs';

const exec = promisify(execFile);
const repo = fileURLToPath(root);
const compiler = process.env.TP_SETUP_BINARY;
const work = process.env.TP_SETUP_EVIDENCE;
if (!compiler || !work || !resolve(work).startsWith('/tmp/typedpress-framework-setup-')) throw new Error('Set TP_SETUP_BINARY to your real built compiler and TP_SETUP_EVIDENCE to a NEW /tmp/typedpress-framework-setup-* directory.');
await mkdir(work); // Exclusive ownership, never adopt a pre-existing test directory.
const release = join(work, 'release');
const cache = join(work, 'cache');
const project = join(work, 'my-app');
const tools = join(work, 'tools');
const temp = join(work, 'tmp');
const pathTools = join(work, 'path-tools');
for (const directory of [tools, temp, pathTools, join(work, 'studio-config')]) await mkdir(directory);
await writeFile(join(work, 'studio-config/shared.json'), JSON.stringify({ version: 1, analyticsOptOut: true }));
const { stdout: head } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });
await archive({ binary: compiler, target: releaseTarget(), output: release, revision: head.trim(), workingTree: true });
await symlink(process.execPath, join(pathTools, 'node'));
for (const name of ['npm', 'npx', 'sh', 'bash', 'uname', 'tar', 'gzip', 'unzip', 'chmod']) {
  for (const directory of process.env.PATH.split(delimiter)) {
    try {
      let source = await realpath(join(directory, name));
      // Version managers may wrap npm in shell scripts tied to their install path.
      if (['npm', 'npx'].includes(name) && basename(source) !== `${name}-cli.js`) {
        source = await realpath(join(dirname(source), '../lib/node_modules/npm/bin', `${name}-cli.js`));
      }
      await symlink(source, join(pathTools, name)); break;
    }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
  }
}
const env = {
  ...process.env, PATH: pathTools, TP_BIN: '', TP_CACHE_DIR: cache,
  TP_RELEASE_BASE_URL: pathToFileURL(`${release}/`).href,
  XDG_CACHE_HOME: join(work, 'xdg-cache'), TMPDIR: temp,
  npm_config_cache: process.env.TP_SETUP_NPM_CACHE || join(work, 'npm-cache'),
  DEV_CONFIG_DIR: join(work, 'studio-config'), E2E: '', NODE_ENV: 'production', STUDIO_DEBUG_TRACKS: '',
  STUDIO_PROCESS_MANAGER_HOME: join(work, 'studio-daemon'),
};
const log = [];
const run = async (file, args, options = {}) => {
  const result = await exec(file, args, { cwd: project, env, timeout: 600000, maxBuffer: 8 * 1024 * 1024, ...options });
  log.push(`$ ${file} ${args.join(' ')}\n${result.stdout}${result.stderr}`);
  process.stdout.write(`ok: ${args.includes('application-password') ? 'native WordPress application credential' : `${file} ${args.join(' ')}`}\n`);
  return result.stdout;
};
let session, siteCreated = false, primary;
const studio = (args) => run('npx', ['--yes', '--package', 'wp-studio@2.2.0', '--', 'studio', ...args], { cwd: work });
try {
  for (const unavailable of ['cargo', 'rustc', 'docker', 'php']) await assert.rejects(exec(unavailable, ['--version'], { env }), (error) => error.code === 'ENOENT');
  const pack = async (directory) => JSON.parse(await run('npm', ['pack', directory, '--json', '--pack-destination', work], { cwd: repo }))[0].filename;
  const cliPackage = join(work, await pack('./packages/cli'));
  const createPackage = join(work, await pack('./packages/create-typedpress'));
  await run('npm', ['install', '--prefix', tools, '--no-audit', '--no-fund', createPackage], { cwd: work });
  const scaffold = join(tools, 'node_modules/.bin/create-typedpress');
  assert.match(await run(scaffold, ['--help'], { cwd: work }), /npm run dev/);
  await run(scaffold, [project], { cwd: work, env: { ...env, TP_CLI_PACKAGE: cliPackage } });
  await assert.rejects(run(scaffold, [project, '--no-install']), (error) => /already exists/.test(error.stderr));
  const first = join(project, 'node_modules/.bin/typedpress');
  const offline = { ...env, TP_OFFLINE: '1', TP_RELEASE_BASE_URL: 'http://127.0.0.1:1/' };
  await run(first, ['check'], { env: offline });
  await run('npm', ['run', 'typecheck']);
  const generated = await readdir(join(project, 'tp/_generated/client'));
  assert.ok(generated.includes('index.ts') && generated.includes('types.ts'));
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  // --foreground: this script reads the watcher's output, whatever environment runs it.
  session = spawn('npm', ['run', 'dev', '--', '--foreground', '--port', String(port)], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const redacted = () => output.replace(/^Initial login:.*$/gm, 'Initial login: [redacted]');
  const ready = new Promise((done, fail) => {
    const deadline = setTimeout(() => finish(new Error(`Dev readiness timed out:\n${redacted()}`)), 600000);
    const finish = (error) => { clearTimeout(deadline); error ? fail(error) : done(); };
    for (const stream of [session.stdout, session.stderr]) stream.on('data', (chunk) => {
      output += chunk;
      if (output.includes('Watching config, ')) finish();
    });
    session.once('error', finish);
    session.once('exit', (code) => finish(new Error(`npm run dev exited ${code}:\n${redacted()}`)));
  });
  siteCreated = true;
  await ready;
  const status = JSON.parse(await run('npm', ['run', '--silent', 'status']));
  assert.equal(status.isOnline, true);
  const base = status.siteUrl.replace(/\/$/, '');
  const { createClient, TypedPressError } = await import(pathToFileURL(join(project, 'tp/_generated/client/index.ts')).href);
  const client = createClient({ fetch: (path, options) => fetch(new URL(path, base), options) });
  for (const [path, expected] of [
    ['/', /Make this site yours/],
    ['/notes/', /A first walk/],
    ['/notes/first-walk/', /Take the long way to the corner shop/],
  ]) {
    const page = await fetch(new URL(path, base), { signal: AbortSignal.timeout(20000) });
    assert.equal(page.status, 200, path);
    assert.match(await page.text(), expected);
  }
  const schema = await client.schema();
  assert.equal(schema.runtime.wp.database.kind, 'sqlite');
  assert.deepEqual(schema.runtime.pendingMigrations, []);
  await assert.rejects(
    client.notes.create({ title: 'Anonymous write' }),
    (error) => error instanceof TypedPressError && error.status === 401,
  );
  // Create a post through native WordPress and read it through the generated client.
  const password = (await run('npm', ['run', '--silent', 'wp', '--', 'user', 'application-password', 'create', 'admin', 'setup-acceptance', '--porcelain'])).trim();
  const created = await fetch(`${base}/wp-json/wp/v2/tp_notes`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}` },
    body: JSON.stringify({ title: 'From native WordPress', status: 'publish', content: 'One server, real SQLite.' }),
  });
  assert.equal(created.status, 201, await created.text());
  const notes = await client.notes.list();
  assert.deepEqual(notes.map((note) => note.title).sort(), ['A first walk', 'From native WordPress', 'What to pack']);
  // Exercise the actual supplied-compiler escape hatch independently of the cache.
  await run(first, ['check'], { env: { ...env, TP_BIN: compiler, TP_OFFLINE: '1', TP_CACHE_DIR: join(work, 'unused-cache') } });
  await run('npm', ['run', 'stop']);
  await once(session, 'exit', { signal: AbortSignal.timeout(15000) }).catch((error) => { if (session.exitCode === null) throw error; });
  assert.equal(JSON.parse(await run('npm', ['run', '--silent', 'status'])).isOnline, false);
  await writeFile(join(work, 'dev-output.txt'), redacted().replaceAll(password, '[redacted]'));
  await writeFile(join(work, 'result.json'), JSON.stringify({ passed: true, sourceHead: head.trim(), target: releaseTarget(), node: process.version, checks: ['no cargo/rustc/docker/host PHP on PATH', 'npm pack/install', 'automatic scaffold install', 'offline cached compiler', 'typecheck generated client', 'npm run dev foreground', 'WordPress renders starter pages and seeded notes', 'SQLite schema ready', 'anonymous write rejected', 'native WordPress write visible through typed client', 'TP_BIN override', 'site stopped'] }, null, 2) + '\n');
} catch (error) { primary = error; throw error; }
finally {
  const cleanup = [];
  if (siteCreated) {
    try { await run('npm', ['run', 'stop']); cleanup.push('Owned TypedPress site stopped.'); }
    catch (error) { cleanup.push(`Stop: ${error.message}`); }
    try {
      const site = join(project, '.tp/dev/wordpress');
      const listed = JSON.parse(await studio(['list', '--format=json']));
      if (listed.some((entry) => resolve(entry.path) === site)) await studio(['delete', '--path', site, '--no-files', '--format=json']);
      assert.equal(JSON.parse(await studio(['list', '--format=json'])).some((entry) => resolve(entry.path) === site), false);
      cleanup.push('Owned WordPress site absent from isolated Studio registry.');
      await rm(join(project, '.tp/dev'), { recursive: true, force: true });
      await assert.rejects(access(join(project, '.tp/dev')), (error) => error.code === 'ENOENT');
      cleanup.push('Owned WordPress files and SQLite data removed.');
    } catch (error) { cleanup.push(`Cleanup failed: ${error.message}`); if (!primary) primary = error; }
  }
  if (session && session.exitCode === null && session.signalCode === null) { session.kill('SIGTERM'); await once(session, 'exit', { signal: AbortSignal.timeout(15000) }); }
  try { cleanup.push(await stopOwnedDaemon(work)); }
  catch (error) { cleanup.push(`Daemon cleanup failed: ${error.message}`); if (!primary) primary = error; }
  await writeFile(join(work, 'commands.log'), log.join('\n').replace(/(application-password create admin setup-acceptance --porcelain\n)[\s\S]*?(?=\n\$|$)/g, '$1[redacted]\n'));
  await writeFile(join(work, 'cleanup.txt'), cleanup.join('\n') + '\n');
  if (primary) process.exitCode = 1;
}
process.stdout.write(`Setup acceptance evidence: ${work}\n`);
