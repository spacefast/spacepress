import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const pages = join(root, 'packages/pages');
const blocks = join(root, 'packages/blocks');

test('packed pages CLI builds a site from a normal npm installation', { timeout: 180_000 }, async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'zero-pages-installed-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const run = (file, args, cwd) => exec(file, args, { cwd, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const pack = async (cwd) => {
    const { stdout } = await run('pnpm', ['pack', '--pack-destination', scratch, '--json'], cwd);
    return JSON.parse(stdout).filename;
  };
  const blockArchive = await pack(blocks);
  const pageArchive = await pack(pages);
  await writeFile(join(scratch, 'package.json'), '{"private":true,"type":"module"}\n');
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', resolve(scratch, blockArchive), resolve(scratch, pageArchive)], scratch);

  const project = join(scratch, 'site');
  await cp(join(root, 'examples/full-site'), project, {
    recursive: true,
    filter: (source) => !source.split('/').includes('.zero'),
  });
  const cli = join(scratch, 'node_modules/@spacefast/zero-pages/bin/zero-pages.mjs');
  const { stdout } = await run(process.execPath, [cli, 'build', project, '--json'], scratch);
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  const manifest = JSON.parse(await readFile(join(result.plugin, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.routes.map((route) => route.pattern).sort(), ['/', '/about', '/notes', '/notes/[]', '/notes/featured']);
  const imported = await run(process.execPath, ['--input-type=module', '-e', 'import { collectionPage } from "@spacefast/zero-pages"; console.log(typeof collectionPage)'], scratch);
  assert.equal(imported.stdout.trim(), 'function');
});
