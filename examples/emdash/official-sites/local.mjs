import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup as cleanupBackend, command, wp } from '../starter/local.mjs';
import { seed } from './seed.mjs';
const execute = promisify(execFile);
export const root = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(root, '../../..');
export async function freePort() {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP address allocated.');
  await new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
  return address.port;
}
export async function makeProject(mode) {
  if (!['blank','starter','blog'].includes(mode)) throw new Error('Unknown official source template.');
  const project = await mkdtemp(join(tmpdir(), `first-official-${mode}-`));
  await cp(join(root, ...(mode === 'blank' ? ['blank','first.config.ts'] : ['first.config.ts'])), join(project, 'first.config.ts'));
  if (mode !== 'blank') await cp(join(root, 'first'), join(project, 'first'), { recursive: true });
  await writeFile(join(project, 'official-owner.json'), JSON.stringify({ project, mode, kind: 'first-official-source' }));
  return project;
}
export async function start(project, mode, { onProcess = () => {} } = {}) {
  const owned = JSON.parse(await readFile(join(project, 'official-owner.json'), 'utf8'));
  if (owned.project !== await realpath(project) || owned.mode !== mode || owned.kind !== 'first-official-source') throw new Error('Not an owned official-source project.');
  // The frontend's port is chosen first, so the app is built with it as its `frontend`: WordPress's
  // links and preview links point at the Astro site.
  // Held by a listener of ours until Astro starts, so nothing else takes it while WordPress seeds.
  const holder = createServer();
  await new Promise((done, fail) => { holder.once('error', fail); holder.listen(0, '127.0.0.1', done); });
  const port = holder.address().port;
  const frontend = `http://127.0.0.1:${port}`;
  let backend, entries = [], media = [];
  try {
    const config = join(project, 'first.config.ts');
    const source = (await readFile(config, 'utf8')).replace(/^ {2}frontend: .*\n/m, '');
    await writeFile(config, source.replace('defineConfig({', `defineConfig({\n  frontend: "${frontend}",`));
    await command(['dev', project, '--port', String(await freePort()), '--no-watch']);
    const owner = JSON.parse(await readFile(join(project, '.first/dev/owner.json'), 'utf8'));
    const site = join(project, '.first/dev/wordpress');
    if (owner.project !== project || owner.site !== site) throw new Error('Native Studio ownership mismatch.');
    const status = JSON.parse(await command(['dev','status',project]));
    if (!status.isOnline || typeof status.siteUrl !== 'string') throw new Error('Native Studio did not report online.');
    backend = status.siteUrl.replace(/\/$/, '');
    if (mode !== 'blank') {
      // The templates' menu location: the one piece of WordPress setup First can't declare yet.
      await mkdir(join(site, 'wp-content/mu-plugins'), { recursive: true });
      await cp(join(root, 'menus.php'), join(site, 'wp-content/mu-plugins/first-official-menus.php'));
      const password = await wp(project, 'user', 'application-password', 'create', 'admin', 'official-seed', '--porcelain');
      const seeded = await seed({ backend, authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`, mode,
        seedFile: join(root, mode, 'seed/seed.json'), wp: (...args) => wp(project, ...args) });
      entries = seeded.entries;
      media = seeded.media;
      await wp(project, 'user', 'application-password', 'delete', 'admin', '--all');
    }
  } catch (error) {
    holder.close();
    throw error;
  }
  const { openSync, closeSync } = await import('node:fs');
  const out = openSync(join(project, 'frontend.log'), 'a');
  await new Promise((done) => holder.close(done));
  const child = spawn(process.execPath, [join(root, mode, 'dist/server/entry.mjs')], { cwd: join(root, mode),
    env: { ...process.env, FIRST_URL: backend, HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', out, out] });
  onProcess(child);
  await new Promise((done, fail) => { child.once('spawn', done); child.once('error', fail); });
  closeSync(out);
  const procStat = await readFile(`/proc/${child.pid}/stat`, 'utf8');
  const startedAtTicks = procStat.slice(procStat.lastIndexOf(')') + 2).split(' ')[19];
  const receipt = { project, site, mode, backend, frontend, pid: child.pid, startedAtTicks, entries, media };
  await writeFile(join(project, 'official-site.json'), JSON.stringify(receipt, null, 2));
  const end = Date.now() + 45000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Astro exited: ${await readFile(join(project, 'frontend.log'),'utf8')}`);
    try {
      const response = await fetch(frontend, { signal: AbortSignal.timeout(2000) });
      if (response.ok) break;
      if (Date.now() >= end) throw new Error(`Astro HTTP ${response.status}: ${await response.text()}`);
    } catch (error) { if (Date.now() >= end) throw error; }
    await new Promise(done => setTimeout(done, 150));
  }
  return receipt;
}
export async function cleanup(project) {
  const owned = JSON.parse(await readFile(join(project, 'official-owner.json'), 'utf8'));
  if (owned.project !== await realpath(project) || owned.kind !== 'first-official-source') throw new Error('Refusing cleanup of another project.');
  let receipt;
  try { receipt = JSON.parse(await readFile(join(project, 'official-site.json'), 'utf8')); }
  catch(error) { if (error.code !== 'ENOENT') throw error; }
  if (receipt?.pid) {
    // A PID is reused by the OS; confirm its actual command before sending a signal.
    const cmdline = await readFile(`/proc/${receipt.pid}/cmdline`, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    const procStat = await readFile(`/proc/${receipt.pid}/stat`, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    const ticks = procStat ? procStat.slice(procStat.lastIndexOf(')') + 2).split(' ')[19] : undefined;
    if (cmdline.includes(join(root, owned.mode, 'dist/server/entry.mjs')) && ticks === receipt.startedAtTicks) {
      process.kill(receipt.pid, 'SIGTERM');
    } else if (cmdline) throw new Error('Frontend PID now belongs to another process.');
  }
  try { await readFile(join(project, '.first/dev/owner.json')); }
  catch(error) { if (error.code !== 'ENOENT') throw error; await rm(project, {recursive:true}); return { project, startupAbortedBeforeNativeOwnership: true }; }
  const native = await cleanupBackend(project);
  if (receipt) {
    try {
      await fetch(receipt.frontend, { signal: AbortSignal.timeout(2000) });
      throw new Error('Owned Astro frontend is still answering after cleanup.');
    } catch(error) { if (error.message === 'Owned Astro frontend is still answering after cleanup.') throw error; }
  }
  return { ...native, frontendStopped: true };
}
export async function launch() {
  const [mode, action, project] = process.argv.slice(2);
  if (!['blank','starter','blog'].includes(mode)) throw new Error('Usage: node run.mjs <blank|starter|blog> [cleanup <owned-project>]');
  if (action === 'cleanup' && project) { console.log(JSON.stringify(await cleanup(await realpath(project)),null,2)); return; }
  if (action) throw new Error('Unknown action.');
  const owned = await makeProject(mode);
  try {
    const receipt = await start(owned, mode, { onProcess(child) { child.unref(); } });
    console.log(JSON.stringify({ ...receipt, admin: `${receipt.backend}/wp-admin/`, initialLogin: 'admin / first-test-admin (disposable native site only)', cleanup: `node examples/emdash/official-sites/run.mjs ${mode} cleanup ${owned}` },null,2));
  } catch(error) { await cleanup(owned); throw error; }
}
export { command, wp };
