import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const cliPkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const typesPkg = JSON.parse(await readFile(new URL('../../../types/spacepress/package.json', import.meta.url), 'utf8'));

const SERVER_SUBPATHS = [
  ['./server', 'spacepress/server'],
  ['./server/db', 'spacepress/server/db'],
  ['./server/app', 'spacepress/server/app'],
  ['./server/content', 'spacepress/server/content'],
  ['./server/wp', 'spacepress/server/wp'],
];

test('spacepress package exports declare types and browser server-only stubs for every server subpath', async () => {
  for (const [subpath, moduleName] of SERVER_SUBPATHS) {
    for (const [label, pkg] of [['packages/cli', cliPkg], ['types/spacepress', typesPkg]]) {
      const entry = pkg.exports?.[subpath];
      assert.ok(entry, `${label} missing exports["${subpath}"]`);
      assert.equal(typeof entry.types, 'string', `${label} missing types for ${subpath}`);
      assert.equal(typeof entry.browser, 'string', `${label} missing browser stub for ${subpath}`);
      assert.equal(typeof entry.default, 'string', `${label} missing default stub for ${subpath}`);
    }
    const stubUrl = new URL(typesPkg.exports[subpath].browser, new URL('../../../types/spacepress/package.json', import.meta.url));
    await assert.rejects(
      () => import(`${pathToFileURL(stubUrl.pathname).href}?t=${Date.now()}`),
      (err) => err instanceof Error && err.message.includes(moduleName) && /only on the server/i.test(err.message),
      `${moduleName} browser stub must throw a server-only error`,
    );
  }
});
