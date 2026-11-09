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
const compiler = process.env.FIRST_SETUP_BINARY;
const work = process.env.FIRST_SETUP_EVIDENCE;
if (!compiler || !work || !resolve(work).startsWith('/tmp/first-framework-setup-')) throw new Error('Set FIRST_SETUP_BINARY to your real built compiler and FIRST_SETUP_EVIDENCE to a NEW /tmp/first-framework-setup-* directory.');
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
  ...process.env, PATH: pathTools, FIRST_BIN: '', FIRST_CACHE_DIR: cache,
  FIRST_RELEASE_BASE_URL: pathToFileURL(`${release}/`).href,
  XDG_CACHE_HOME: join(work, 'xdg-cache'), TMPDIR: temp,
  npm_config_cache: process.env.FIRST_SETUP_NPM_CACHE || join(work, 'npm-cache'),
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
const studio = (args) => run('npx', ['--yes', '--package', 'wp-studio@2.1.1', '--', 'studio', ...args], { cwd: work });
try {
  for (const unavailable of ['cargo', 'rustc', 'docker', 'php']) await assert.rejects(exec(unavailable, ['--version'], { env }), (error) => error.code === 'ENOENT');
  const pack = async (directory) => JSON.parse(await run('npm', ['pack', directory, '--json', '--pack-destination', work], { cwd: repo }))[0].filename;
  const cliPackage = join(work, await pack('./packages/cli'));
  const createPackage = join(work, await pack('./packages/create-first'));
  await run('npm', ['install', '--prefix', tools, '--no-audit', '--no-fund', createPackage], { cwd: work });
  const scaffold = join(tools, 'node_modules/.bin/create-first');
  assert.match(await run(scaffold, ['--help'], { cwd: work }), /npm run dev/);
  await run(scaffold, [project], { cwd: work, env: { ...env, FIRST_CLI_PACKAGE: cliPackage } });
  await assert.rejects(run(scaffold, [project, '--no-install']), (error) => /already exists/.test(error.stderr));
  const first = join(project, 'node_modules/.bin/first');
  const offline = { ...env, FIRST_OFFLINE: '1', FIRST_RELEASE_BASE_URL: 'http://127.0.0.1:1/' };
  await run(first, ['check'], { env: offline });
  await run('npm', ['run', 'typecheck']);
  const generated = await readdir(join(project, 'first/_generated/client'));
  assert.ok(generated.includes('index.ts') && generated.includes('types.ts'));
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  session = spawn('npm', ['run', 'dev', '--', '--port', String(port)], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((done, fail) => {
    const deadline = setTimeout(() => finish(new Error(`Dev readiness timed out:\n${output}`)), 600000);
    const finish = (error) => { clearTimeout(deadline); error ? fail(error) : done(); };
    for (const stream of [session.stdout, session.stderr]) stream.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
      if (output.includes('Watching config, TypeScript and public files.')) finish();
    });
    session.once('error', finish);
    session.once('exit', (code) => finish(new Error(`npm run dev exited ${code}:\n${output}`)));
  });
  siteCreated = true;
  await ready;
  const status = JSON.parse(await run('npm', ['run', '--silent', 'status']));
  assert.equal(status.isOnline, true);
  const base = status.siteUrl.replace(/\/$/, '');
  const frontend = `${base}/wp-content/plugins/first-app-my-app/public/`;
  const response = await fetch(`${frontend}index.html`, { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Make something/);
  for (const asset of ['app.js', 'style.css']) assert.equal((await fetch(`${frontend}${asset}`)).status, 200);
  const schemaResponse = await fetch(`${base}/wp-json/first/v1/_schema`);
  assert.equal(schemaResponse.status, 200);
  const { data: schema } = await schemaResponse.json();
  assert.equal(schema.runtime.wp.database.kind, 'sqlite');
  assert.deepEqual(schema.runtime.pendingMigrations, []);
  assert.equal((await fetch(`${base}/wp-json/first/v1/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Anonymous write', body: '' }) })).status, 401);
  // The native WordPress REST seam creates the content read by the public app.
  const password = (await run('npm', ['run', '--silent', 'wp', '--', 'user', 'application-password', 'create', 'admin', 'setup-acceptance', '--porcelain'])).trim();
  const created = await fetch(`${base}/wp-json/wp/v2/first_notes`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}` },
    body: JSON.stringify({ title: 'From native WordPress', status: 'publish', acf: { first_body: 'One server, real SQLite.' } }),
  });
  assert.equal(created.status, 201, await created.text());
  const { data: notes } = await (await fetch(`${base}/wp-json/first/v1/notes`)).json();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, 'From native WordPress');
  assert.equal(notes[0].body, 'One server, real SQLite.');
  const { createClient } = await import(pathToFileURL(join(project, 'first/_generated/client/index.ts')).href);
  assert.equal((await createClient({ url: `${base}/wp-json/first/v1` }).notes.list())[0].title, 'From native WordPress');
  // Exercise the actual supplied-compiler escape hatch independently of the cache.
  await run(first, ['check'], { env: { ...env, FIRST_BIN: compiler, FIRST_OFFLINE: '1', FIRST_CACHE_DIR: join(work, 'unused-cache') } });
  await run('npm', ['run', 'stop']);
  await once(session, 'exit', { signal: AbortSignal.timeout(15000) }).catch((error) => { if (session.exitCode === null) throw error; });
  assert.equal(JSON.parse(await run('npm', ['run', '--silent', 'status'])).isOnline, false);
  await writeFile(join(work, 'dev-output.txt'), output.replaceAll(password, '[redacted]'));
  await writeFile(join(work, 'result.json'), JSON.stringify({ passed: true, sourceHead: head.trim(), target: releaseTarget(), node: process.version, checks: ['no cargo/rustc/docker/host PHP on PATH', 'npm pack/install', 'automatic scaffold install', 'offline cached compiler', 'typecheck generated client', 'npm run dev foreground', 'WordPress serves public assets', 'SQLite schema ready', 'anonymous write rejected', 'native WordPress write visible through typed client', 'FIRST_BIN override', 'site stopped'] }, null, 2) + '\n');
} catch (error) { primary = error; throw error; }
finally {
  const cleanup = [];
  if (siteCreated) {
    try { await run('npm', ['run', 'stop']); cleanup.push('Owned First site stopped.'); }
    catch (error) { cleanup.push(`Stop: ${error.message}`); }
    try {
      const site = join(project, '.first/dev/wordpress');
      const listed = JSON.parse(await studio(['list', '--format=json']));
      if (listed.some((entry) => resolve(entry.path) === site)) await studio(['delete', '--path', site, '--no-files', '--format=json']);
      assert.equal(JSON.parse(await studio(['list', '--format=json'])).some((entry) => resolve(entry.path) === site), false);
      cleanup.push('Owned WordPress site absent from isolated Studio registry.');
      await rm(join(project, '.first/dev'), { recursive: true, force: true });
      await assert.rejects(access(join(project, '.first/dev')), (error) => error.code === 'ENOENT');
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
