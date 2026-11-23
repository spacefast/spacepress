import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const command = fileURLToPath(new URL('../bin/create-spacepress.mjs', import.meta.url));

test('scaffolder explains usage and creates a portable app without touching occupied destinations', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'spacepress-scaffold-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // No compiler in reach: SP_BIN is the only one a --no-install scaffold can use.
  const { SP_BIN: _, ...env } = process.env;
  const run = (args) => exec(process.execPath, [command, ...args], { cwd: root, env });
  assert.match((await run(['--help'])).stdout, /npm run dev/);
  await assert.rejects(run(['example', '--unknown']), (error) => error.code === 1);
  const app = join(root, 'My -- app');
  const created = (await run([app, '--no-install'])).stdout;
  assert.match(created, /Created my-app/);
  assert.match(created, /Open the Website URL[\s\S]+sp\/app\/page\.tsx/);
  // Without a compiler the agent files are one command away, and the output says which.
  assert.match(created, /npm install\n  npx spacepress init /);
  assert.deepEqual((await readdir(app)).filter((name) => /AGENTS|mcp|agents|claude/i.test(name)), []);
  const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'my-app');
  assert.equal(manifest.scripts.dev, 'spacepress dev');
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

test('a new project includes the starter sources and the README names an existing module', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'spacepress-scaffold-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'shop');
  // No compiler in reach, so nothing but the template is written.
  const { SP_BIN: _, ...env } = process.env;
  await exec(process.execPath, [command, app, '--no-install'], { cwd: root, env });
  const files = (await readdir(app, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(app, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
  assert.deepEqual(files, [
    '.editorconfig', '.gitignore', '.vscode/settings.json', 'README.md',
    'content/notes/first-walk.md', 'content/notes/what-to-pack.md', 'package.json', 'sp/actions.ts',
    'sp/app/account/page.tsx', 'sp/app/layout.tsx', 'sp/app/not-found.tsx',
    'sp/app/notes/[slug]/page.tsx', 'sp/app/notes/page.tsx', 'sp/app/page.tsx', 'sp/app/site.css',
    'tsconfig.json', 'spacepress.config.ts',
  ]);
  // The app's name reaches every file that carries it.
  for (const file of files) assert.doesNotMatch(await readFile(join(app, file), 'utf8'), /__SP_APP_NAME__/, file);
  // Every `spacepress add <module>` command the README shows is a module in the compiler's command table.
  const readme = await readFile(join(app, 'README.md'), 'utf8');
  const shown = [...readme.matchAll(/^npx spacepress add ([\w-]+)$|`(?:npx )?spacepress add ([\w-]+)`/gm)].map((match) => match[1] ?? match[2]);
  assert.deepEqual([...new Set(shown)], ['shop', 'db', 'api-reference']);
  const table = JSON.parse(await readFile(new URL('../../../runtime/SpacePress/Cli/commands.json', import.meta.url), 'utf8'));
  const add = table.build.find((row) => row.name === 'add');
  assert.ok(add, 'the command table has `add`');
  const modules = add.summary.split('Modules: ')[1].split(/[ ,]+/);
  for (const name of shown) assert.ok(modules.includes(name), `spacepress add ${name} is not a module: ${add.summary}`);
});

test('the scaffold builds and renders every page on WordPress', { skip: !process.env.SP_BIN && 'Set SP_BIN to the built compiler to run WordPress' }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'spacepress-starter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'field-notes');
  const compiler = resolve(process.env.SP_BIN);
  await exec(process.execPath, [command, app, '--no-install'], { env: { ...process.env, SP_BIN: compiler } });
  await exec(compiler, ['build', app]);
  const phpTest = fileURLToPath(new URL('./starter.php', import.meta.url));
  const { stdout } = await exec(process.env.PHP || 'php', [phpTest, join(app, 'sp/dist/wp-content')], {
    env: { ...process.env, SP_WP_THEMES: '1' },
  }).catch((error) => {
    if (error.stdout) t.diagnostic(error.stdout.trim());
    throw error;
  });
  t.diagnostic(stdout.trim());
});
