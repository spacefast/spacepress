import test from 'node:test';
import assert from 'node:assert/strict';
import { rename, renamePath } from './rename-to-typedpress.mjs';

test('public modules and authored paths use their respective names', () => {
  assert.equal(rename('import { Page } from "first/app";', 'examples/blog/first/app/page.tsx'), 'import { Page } from "typedpress/app";');
  assert.equal(renamePath('examples/blog/first/app/page.tsx'), 'examples/blog/tp/app/page.tsx');
  assert.equal(renamePath('examples/blog/first.config.ts'), 'examples/blog/typedpress.config.ts');
});

test('CSS branding and hidden state stay consistent with markup and files', () => {
  assert.equal(rename('.first-card { color: red; }', 'runtime/First/Render/style.css'), '.typedpress-card { color: red; }');
  assert.equal(rename('".first/cache"', 'src/commands/build.rs'), '".tp/cache"');
  assert.equal(rename('<main data-first-live="notes">', 'runtime/First/Render/template.php'), '<main data-tp-live="notes">');
});

test('pagination keys and ordinary First content retain their meaning', () => {
  const parameter = '"name": "first",\n"in": "query"';
  assert.equal(rename(parameter, 'examples/blog/first/_generated/openapi.json'), parameter);
  for (const text of ['first_name', 'items.first()', 'First note', '/notes?search=First&status=published', '/services/search?q=First']) {
    assert.equal(rename(text, 'tests/compiler.rs'), text);
  }
});

test('runtime collection limits account for the shorter post-type prefix', () => {
  assert.equal(rename('private const MAX_COLLECTION_NAME = 14;', 'runtime/First/RuntimeSchema/Kinds.php'), 'private const MAX_COLLECTION_NAME = 17;');
});

test('unreleased APIs are renamed while published changelog history stays intact', () => {
  const history = '\n## [0.1.0]\nFirst used firstLoader.\n';
  assert.equal(rename('## [Unreleased]\nfirstLoader for First.\n' + history, 'packages/astro/CHANGELOG.md'), '## [Unreleased]\ntpLoader for TypedPress.\n' + history);
});

test('legacy inputs and historical decisions are preserved', () => {
  for (const path of ['tests/wp/zero-upgrade/fixture/runtime/First/Db.php', 'docs/decisions/2026-11-12-rename-zero-data-once.md']) {
    assert.equal(rename('First first_name /__first/api/v1', path), 'First first_name /__first/api/v1');
  }
});

test('the rename is idempotent across module, path, selector and generic snippets', () => {
  for (const text of ['import { Page } from "first/app";', '.first-card {}', 'First note', '/notes?search=First', '"name": "first", "in": "query"']) {
    const once = rename(text, 'tests/compiler.rs');
    assert.equal(rename(once, 'tests/compiler.rs'), once);
  }
});
