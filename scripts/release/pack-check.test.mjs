import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PACKAGES, check } from './pack-check.mjs';

const manifest = (name, extra = {}) => JSON.stringify({
  name, license: PACKAGES[name].license, homepage: 'https://example.test',
  repository: { type: 'git', url: 'https://github.com/spacefast/zero.git', directory: PACKAGES[name].directory },
  publishConfig: { access: 'public' }, ...extra,
});
const pack = (name, files) => ({ name, files: files.map((path) => ({ path })) });

test('a package with its required files and nothing else passes', async () => {
  const name = '@typedpress/astro';
  const contents = { 'package.json': manifest(name) };
  const problems = await check(name, pack(name, PACKAGES[name].required), async (path) => contents[path] ?? 'export {};\n');
  assert.deepEqual(problems, []);
});

test('missing licenses, tests, fixtures, environment files, secrets and wrong metadata fail', async () => {
  const name = '@typedpress/blocks';
  const files = [...PACKAGES[name].required.filter((path) => path !== 'LICENSE-GPL' && !path.endsWith('/')), 'vendor/licenses/@wordpress/blocks/15.24.0/LICENSE.md',
    'tests/unit/a.test.ts', 'fixtures/site.sql', '.env', 'vendor/wp-entry.mjs', 'dist/key.js', 'dist/host.js'];
  const contents = {
    'package.json': manifest(name, { license: 'MIT', publishConfig: undefined }),
    'dist/key.js': '-----BEGIN PRIVATE KEY-----\n',
    'dist/host.js': 'fetch("https://box.example.ts.net/")',
  };
  const problems = await check(name, pack(name, files), async (path) => contents[path] ?? '');
  for (const expected of [
    'missing LICENSE-GPL', 'tests/unit/a.test.ts is tests or fixtures', 'fixtures/site.sql is tests or fixtures', '.env is an environment file',
    'vendor/wp-entry.mjs is a build-only bundle entry', 'license is MIT, expected MIT AND GPL-2.0-or-later',
    'a scoped package needs publishConfig.access "public"', 'dist/key.js contains a private key', 'dist/host.js contains a private host name or local user path',
  ]) assert.ok(problems.includes(expected), `${expected}\n${problems.join('\n')}`);
});
