// Generated/source freshness guard. Behavior is covered by the real WordPress journeys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../../../runtime/admin/', import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('the upstream inventory accounts for every retained source and active adapter', async () => {
  const inventory = JSON.parse(await readFile(new URL('upstream-inventory.json', root), 'utf8'));
  const sources = inventory.files.map(file => file.source);
  assert.equal(new Set(sources).size, sources.length, 'each upstream input has one owner');
  assert.equal(sha256(inventory.files.map(file => `${file.sha256}  ${file.source}\n`).join('')), inventory.sourceDigest);
  for (const file of inventory.files) {
    assert.equal(sha256(await readFile(new URL(file.path, root))), file.adaptedSha256, `${file.path}: refresh the adapter inventory`);
    assert.equal(sha256(await readFile(new URL(file.retainedSourcePath, root))), file.normalizedSha256, `${file.source}: retain the complete normalized upstream input`);
  }
});

async function sources(dir, extensions) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) files.push(...await sources(path, extensions));
    else if (extensions.some(extension => entry.name.endsWith(extension))) files.push(path);
  }
  return files;
}

test('admin styles only consume design tokens provided by the shipped theme', async () => {
  const built = await sources(new URL('build/', root), ['.js']);
  const source = (await Promise.all(['packages', 'routes', 'fields', 'dashboard-widgets'].map(
    dir => sources(new URL(`apps/${dir}/`, root), ['.css', '.scss', '.ts', '.tsx'])
  ))).flat();
  const texts = await Promise.all([...built, ...source].map(async path => {
    const text = (await readFile(path, 'utf8')).replaceAll('\\n', '\n');
    return [path.pathname, path.pathname.endsWith('.js') ? text : text.replace(/\/\*[\s\S]*?\*\//g, '')];
  }));
  const definitions = new Set(texts.flatMap(([, text]) =>
    [...text.matchAll(/(--wpds-[\w-]+)\s*:/g)].map(match => match[1])
  ));
  assert.ok(definitions.has('--wpds-color-background-surface-neutral'), 'theme tokens are bundled');
  const missing = texts.flatMap(([path, text]) =>
    [...new Set([...text.matchAll(/var\(\s*(--wpds-[\w-]+)/g)].map(match => match[1]))]
      .filter(token => !definitions.has(token)).map(token => `${path}: ${token}`)
  );
  assert.deepEqual(missing, [], 'undefined design tokens silently discard CSS declarations');
});
