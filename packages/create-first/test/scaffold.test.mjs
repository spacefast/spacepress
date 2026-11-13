import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const command = fileURLToPath(new URL('../bin/create-first.mjs', import.meta.url));

test('scaffolder explains usage and creates a portable app without touching occupied destinations', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'first-scaffold-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = (args) => exec(process.execPath, [command, ...args], { cwd: root });
  assert.match((await run(['--help'])).stdout, /npm run dev/);
  await assert.rejects(run(['example', '--unknown']), (error) => error.code === 1);
  const app = join(root, 'My -- app');
  assert.match((await run([app, '--no-install'])).stdout, /Created my-app/);
  const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'my-app');
  assert.equal(manifest.scripts.dev, 'first dev');
  assert.equal(manifest.private, true);
  await writeFile(join(app, 'keep.txt'), 'user data');
  await assert.rejects(run([app]), (error) => error.code === 1 && /nothing was overwritten/.test(error.stderr));
  assert.equal(await readFile(join(app, 'keep.txt'), 'utf8'), 'user data');
  const empty = join(root, 'empty');
  await mkdir(empty);
  await assert.rejects(run([empty, '--no-install']), (error) => /already exists/.test(error.stderr));
  assert.deepEqual(await readdir(empty), []);
  const link = join(root, 'link');
  await symlink(empty, link);
  await assert.rejects(run([link, '--no-install']), (error) => /already exists/.test(error.stderr));
  assert.deepEqual(await readdir(empty), []);
});

test('the starter is content only, and the command its README names for tables is a real one', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'first-scaffold-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'shop');
  await exec(process.execPath, [command, app, '--no-install'], { cwd: root });
  // What a new project holds: the config, a typed client, the static frontend and editor settings.
  // No first/ folder yet: tables, pages and the rest arrive through `first add`.
  const files = (await readdir(app, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(app.length + 1))
    .sort();
  assert.deepEqual(files, [
    '.editorconfig', '.gitignore', '.vscode/settings.json', 'README.md', 'client.ts', 'first.config.ts',
    'package.json', 'public/app.js', 'public/index.html', 'public/style.css', 'tsconfig.json',
  ]);
  // The app's name reaches every file that carries it.
  for (const file of files) assert.doesNotMatch(await readFile(join(app, file), 'utf8'), /__ZERO_APP_NAME__/, file);
  // The README sends the reader to `first add <module>`; the compiler's command table has that
  // command and names that module, so the pointer can't go stale without this failing.
  const readme = await readFile(join(app, 'README.md'), 'utf8');
  const pointers = [...readme.matchAll(/first add (\w+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(pointers)], ['db']);
  const table = JSON.parse(await readFile(new URL('../../../runtime/First/Cli/commands.json', import.meta.url), 'utf8'));
  const add = table.build.find((row) => row.name === 'add');
  assert.ok(add, 'the command table has `add`');
  const modules = add.summary.split('Modules: ')[1].split(/[ ,]+/);
  for (const name of pointers) assert.ok(modules.includes(name), `first add ${name} is not a module: ${add.summary}`);
  // A module's files are type-checked without an edit: the project's tsconfig covers them.
  const { include } = JSON.parse(await readFile(join(app, 'tsconfig.json'), 'utf8'));
  for (const pattern of ['first/**/*.ts', '*.client.ts']) assert.ok(include.includes(pattern), pattern);
});
