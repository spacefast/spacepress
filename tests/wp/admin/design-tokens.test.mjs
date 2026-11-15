import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../../../runtime/admin/', import.meta.url);

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
