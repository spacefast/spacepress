import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(here, '../../..');
export const first = resolve(process.env.FIRST_BIN ?? join(repository, 'target/debug/first'));
export async function command(args) {
  return (await execute(first, args, { cwd: repository, timeout: 600000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
}
export const wp = (project, ...args) => command(['wp', '--site', project, ...args]);
async function freePort() {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port was allocated.');
  await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
  return address.port;
}
export async function makeProject(mode) {
  if (!['blank', 'starter', 'blog'].includes(mode)) throw new Error('Unknown example.');
  const project = await mkdtemp(join(tmpdir(), `first-emdash-${mode}-`));
  await cp(join(here, '..', mode, 'first.config.ts'), join(project, 'first.config.ts'));
  return project;
}
export async function install(project, mode) {
  const owner = JSON.parse(await readFile(join(project, '.first/dev/owner.json'), 'utf8'));
  const expectedSite = join(project, '.first/dev/wordpress');
  if (owner.project !== await realpath(project) || owner.site !== expectedSite) throw new Error('First project ownership does not match.');
  const theme = join(expectedSite, 'wp-content/themes/first-publication');
  await mkdir(theme, { recursive: true });
  await cp(join(here, 'theme'), theme, { recursive: true });
  await wp(project, 'eval-file', join(here, 'configure.php'), mode, expectedSite);
  return expectedSite;
}
export async function start(project, mode) {
  await command(['dev', project, '--port', String(await freePort()), '--no-watch']);
  await install(project, mode);
  const status = JSON.parse(await command(['dev', 'status', project]));
  if (status.isOnline !== true || typeof status.siteUrl !== 'string') throw new Error('Studio did not report an online WordPress site.');
  return { project, site: join(project, '.first/dev/wordpress'), base: status.siteUrl.replace(/\/$/, ''), mode };
}
export async function cleanup(project) {
  const owner = JSON.parse(await readFile(join(project, '.first/dev/owner.json'), 'utf8'));
  const site = join(project, '.first/dev/wordpress');
  if (owner.project !== project || owner.site !== site) throw new Error('Refusing to clean another project.');
  await command(['dev', 'stop', project]);
  const status = JSON.parse(await command(['dev', 'status', project]));
  if (status.isOnline !== false) throw new Error('Owned site is still online.');
  await execute('npx', ['--yes', '--package', 'wp-studio@2.2.0', '--', 'studio', 'delete', '--path', site, '--no-files'], { cwd: repository, timeout: 120000 });
  await rm(project, { recursive: true });
  return { project, site, stopped: true, registrationDeleted: true, filesDeleted: true };
}
export async function launch(mode) {
  const [action, directory] = process.argv.slice(2);
  if (action === 'cleanup') {
    if (!directory) throw new Error('Usage: run.mjs cleanup <exact-project-path>');
    console.log(JSON.stringify(await cleanup(await realpath(directory)), null, 2));
    return;
  }
  if (action) throw new Error('Run without arguments to create a disposable example, or use cleanup <project>.');
  const project = await makeProject(mode);
  try {
    const receipt = await start(project, mode);
    await writeFile(join(project, 'example.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ ...receipt, admin: `${receipt.base}/wp-admin/`,
      initialLocalLogin: 'admin / first-test-admin (disposable project only)',
      cleanup: `node ${join(here, '..', mode, 'run.mjs')} cleanup ${project}` }, null, 2));
  } catch (error) {
    let owner;
    try { owner = await readFile(join(project, '.first/dev/owner.json')); }
    catch (readError) { if (readError.code !== 'ENOENT') throw readError; }
    if (!owner) {
      // Studio creation starts only after First has written its ownership marker.
      await rm(project, { recursive: true });
      console.error(`Startup failed before site ownership; removed unused project ${project}.`);
    } else {
      console.error(`Failed example retained at ${project}. Cleanup: node ${join(here, '..', mode, 'run.mjs')} cleanup ${project}`);
    }
    throw error;
  }
}
