// Generated/source freshness guard. Behavior is covered by the real WordPress journeys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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
