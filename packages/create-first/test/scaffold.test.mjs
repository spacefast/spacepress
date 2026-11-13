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
