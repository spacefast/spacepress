import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const example = fileURLToPath(new URL('.', import.meta.url));
export const zero = resolve(process.env.ZERO_BIN ?? new URL('../../../target/debug/zero', import.meta.url).pathname);
export const command = async (args) => (await exec(zero, args, { timeout: 600000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
export async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local port allocated');
  await new Promise((done) => server.close(done));
  return address.port;
}
export async function project() {
  const root = await mkdtemp(join(tmpdir(), 'zero-official-plugins-'));
  const directory = join(root, 'plugin-workshop');
  await mkdir(directory);
  await cp(join(example, 'zero.config.ts'), join(directory, 'zero.config.ts'));
  return { root, directory };
}
export async function install(directory) {
  const status = JSON.parse(await command(['dev', 'status', directory]));
  const site = join(directory, '.zero/dev/wordpress');
  const plugin = join(site, 'wp-content/plugins/zero-official-plugins');
  await cp(join(example, 'wordpress/zero-official-plugins'), plugin, { recursive: true, errorOnExist: true, force: false });
  await cp(join(example, 'LICENSE.upstream'), join(plugin, 'LICENSE.upstream'));
  const wp = (...args) => command(['wp', '--site', directory, ...args]);
  await wp('plugin', 'activate', 'zero-official-plugins');
  return { site, base: status.siteUrl.replace(/\/$/, ''), wp };
}
export async function dispose(directory) {
  const site = join(directory, '.zero/dev/wordpress');
  await command(['dev', 'stop', directory]);
  const status = JSON.parse(await command(['dev', 'status', directory]));
  if (status.isOnline !== false) throw new Error('Owned Studio site did not stop');
  const deleted = await exec('npx', ['--yes', '--package', 'wp-studio@2.1.1', '--', 'studio', 'delete', '--path', site, '--no-files'], { timeout: 120000 });
  return { stopped: true, deletedStudioPath: site, studioOutput: deleted.stdout.trim() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const owned = await project();
  await command(['dev', owned.directory, '--port', String(await freePort()), '--no-watch']);
  const installed = await install(owned.directory);
  const { seed } = await import('./seed.mjs');
  await seed(installed);
  const { base } = installed;
  await writeFile(join(owned.root, 'README.txt'), `Owned disposable project: ${owned.directory}\nOpen: ${base}/?zero-plugins=1\nStop: ${zero} dev stop ${owned.directory}\nDelete registration: npx --yes --package wp-studio@2.1.1 -- studio delete --path ${owned.directory}/.zero/dev/wordpress --no-files\n`);
  console.log(`Project: ${owned.directory}\nPublication: ${base}/?zero-plugins=1\nNative admin: ${base}/wp-admin/\n${await readFile(join(owned.root, 'README.txt'), 'utf8')}`);
}
