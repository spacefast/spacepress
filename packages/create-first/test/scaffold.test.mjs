import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const command = fileURLToPath(new URL('../bin/create-first.mjs', import.meta.url));

test('scaffolder explains usage and creates a portable app without touching occupied destinations', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'first-scaffold-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // No compiler in reach: FIRST_BIN is the only one a --no-install scaffold can use.
  const { FIRST_BIN: _, ...env } = process.env;
  const run = (args) => exec(process.execPath, [command, ...args], { cwd: root, env });
  assert.match((await run(['--help'])).stdout, /npm run dev/);
  await assert.rejects(run(['example', '--unknown']), (error) => error.code === 1);
  const app = join(root, 'My -- app');
  const created = (await run([app, '--no-install'])).stdout;
  assert.match(created, /Created my-app/);
  // Without a compiler the agent files are one command away, and the output says which.
  assert.match(created, /npm install\n  npx first init /);
  assert.deepEqual((await readdir(app)).filter((name) => /AGENTS|mcp|agents|claude/i.test(name)), []);
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

test('a new project holds the starter files and no first/ folder; the module its README names exists', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'first-scaffold-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'shop');
  // No compiler in reach, so nothing but the template is written.
  const { FIRST_BIN: _, ...env } = process.env;
  await exec(process.execPath, [command, app, '--no-install'], { cwd: root, env });
  // What a new project holds: the config, a typed client, the static frontend and editor settings.
  // No first/ folder yet: `first add db` creates it. (That the config declares no table() is proven
  // by running `first check` on a scaffold, in tests/cli.rs.)
  const files = (await readdir(app, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(app, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
  assert.deepEqual(files, [
    '.editorconfig', '.gitignore', '.vscode/settings.json', 'README.md', 'client.ts', 'first.config.ts',
    'package.json', 'public/app.js', 'public/index.html', 'public/style.css', 'tsconfig.json',
  ]);
  // The app's name reaches every file that carries it.
  for (const file of files) assert.doesNotMatch(await readFile(join(app, file), 'utf8'), /__ZERO_APP_NAME__/, file);
  // Every `first add <module>` command the README shows is a module in the compiler's command table.
  const readme = await readFile(join(app, 'README.md'), 'utf8');
  const shown = [...readme.matchAll(/^npx first add ([\w-]+)$|`(?:npx )?first add ([\w-]+)`/gm)].map((match) => match[1] ?? match[2]);
  assert.deepEqual([...new Set(shown)], ['db']);
  const table = JSON.parse(await readFile(new URL('../../../runtime/First/Cli/commands.json', import.meta.url), 'utf8'));
  const add = table.build.find((row) => row.name === 'add');
  assert.ok(add, 'the command table has `add`');
  const modules = add.summary.split('Modules: ')[1].split(/[ ,]+/);
  for (const name of shown) assert.ok(modules.includes(name), `first add ${name} is not a module: ${add.summary}`);
});
