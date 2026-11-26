import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { hostFs, call } from './host-fs.mjs';

const target = process.env.CARGO_TARGET_DIR ?? 'target';
const first = path.resolve(target, 'debug/spacepress');
let exports;
const module = await WebAssembly.instantiate(fs.readFileSync(path.join(target, 'wasm32-unknown-unknown/wasm/spacepress.wasm')), { host: hostFs(() => exports) });
exports = module.instance.exports;

test('host imports capture pantry byte for byte like native sources', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spacepress-wasm-sources-'));
  try {
    execFileSync(first, ['sources', 'examples/pantry', '--out', path.join(temp, 'native')]);
    const capture = call(exports, 'sp_sources', { project: path.resolve('examples/pantry') });
    for (const [key, file] of [['app', 'app.spacepress.json'], ['vendor', 'vendor.spacepress.json'], ['manifest', 'manifest.json']]) {
      assert.equal(capture[key], fs.readFileSync(path.join(temp, 'native', file), 'utf8'));
    }
    assert.deepEqual(call(exports, 'sp_check', { project: path.resolve('examples/pantry') }).check.diagnostics, []);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('host capture gives npm imports an actionable stable diagnostic', () => {
  const response = call(exports, 'sp_sources', { project: '/project', packages: false, files: {
    'spacepress.config.ts': 'import thing from "some-npm-package"; export default thing;',
  } });
  assert.equal(response.check.diagnostics[0].code, 'sp_source_needs_local_capture');
});

test('wasm capture and check refuse a ledger still at sp/migrations/', () => {
  const files = {
    'spacepress.config.ts': "import { defineConfig, table, text, mutation } from 'spacepress'; export const notes = table({ body: text().optional() }); export default defineConfig({});",
    'sp/migrations/snapshot.json': '{"version":2,"tables":{}}',
  };
  const moved = 'sp/migrations/ moved to sp/_generated/migrations/';
  const sources = call(exports, 'sp_sources', { project: '/project', packages: false, files });
  assert.equal(sources.check.diagnostics[0].message, moved);
  const check = call(exports, 'sp_check', { project: '/project', files });
  assert.deepEqual(check.check.diagnostics.map((d) => d.message), [moved]);
});

test('wasm and native capture include the same synced Markdown files', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spacepress-wasm-sync-'));
  try {
    const project = path.join(temp, 'project');
    const files = {
      'spacepress.config.ts': "import { defineConfig, collection, text, richText } from 'spacepress'; export const posts = collection({ title: text(), body: richText().optional() }, { title: 'title', content: 'body', sync: 'content/posts/*.md' }); export default defineConfig({});",
      'content/posts/hello.md': '---\ntitle: Hello\n---\nA **seed**.\n',
      'content/posts/ignored.txt': 'not synced',
    };
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(project, name)), { recursive: true });
      fs.writeFileSync(path.join(project, name), text);
    }
    execFileSync(first, ['sources', project, '--out', path.join(temp, 'native')]);
    const native = fs.readFileSync(path.join(temp, 'native/app.spacepress.json'), 'utf8');
    const disk = call(exports, 'sp_sources', { project });
    const memory = call(exports, 'sp_sources', { project: '/project', files });
    assert.equal(disk.app, native);
    assert.equal(memory.app, native);
    assert.equal(JSON.parse(disk.app).files['content/posts/hello.md'], files['content/posts/hello.md']);
    assert.equal(JSON.parse(disk.app).files['content/posts/ignored.txt'], undefined);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('wasm captures the full-site pages bundle byte for byte like native sources', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spacepress-wasm-pages-'));
  try {
    const project = path.join(temp, 'site');
    fs.cpSync(path.resolve('examples/full-site'), project, { recursive: true, filter: (source) => !source.split(path.sep).includes('.sp') });
    execFileSync(first, ['sources', project, '--out', path.join(temp, 'native')]);
    const capture = call(exports, 'sp_sources', { project });
    for (const [key, file] of [['app', 'app.spacepress.json'], ['vendor', 'vendor.spacepress.json'], ['manifest', 'manifest.json']]) {
      assert.equal(capture[key], fs.readFileSync(path.join(temp, 'native', file), 'utf8'), file);
    }
    const files = JSON.parse(capture.app).files;
    for (const name of ['sp/app/notes/[slug]/page.tsx', 'sp/app/notes/[slug]/note.module.css', 'sp/app/about/compass.svg', 'sp/components/CheerButton.tsx']) {
      assert.equal(typeof files[name], 'string', name);
    }
    const ledger = 'sp/_generated/migrations';
    const memory = Object.fromEntries(Object.entries(files).filter(([name]) => !name.startsWith(`${ledger}/`)));
    for (const entry of fs.readdirSync(path.join(project, ledger), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(entry.parentPath, entry.name);
      const name = path.relative(project, file).split(path.sep).join('/');
      memory[name] = fs.readFileSync(file, 'utf8');
    }
    assert.equal(call(exports, 'sp_sources', { project: '/site', files: memory }).app, capture.app, 'an in-memory project captures the same bytes');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('wasm and native resolve build-time namespace members and refuse the same whole values', () => {
  const source = (handler) => `import { defineConfig, mutation } from 'spacepress';
import * as ns from './sp/ns.mjs';
function tagged(s: string) { return s; }
Object.assign(tagged, { prefix: 'p' });
export const probe = mutation({}, () => ${handler});
export default defineConfig({ name: 'ns' });
`;
  const helper = 'export const shout = (value) => value.toUpperCase();\nexport const constants = { SEP: "/" };\n';
  for (const handler of ["[ns.shout('a'), ns.constants.SEP, tagged('x'), tagged.prefix]", 'Object.keys(ns)', '[tagged]']) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spacepress-wasm-namespace-'));
    try {
      fs.writeFileSync(path.join(temp, 'spacepress.config.ts'), source(handler));
      fs.mkdirSync(path.join(temp, 'sp'));
      fs.writeFileSync(path.join(temp, 'sp/ns.mjs'), helper);
      let native;
      try { native = JSON.parse(execFileSync(first, ['check', temp, '--json'], { encoding: 'utf8' })); }
      catch (error) { native = JSON.parse(error.stdout); }
      const wasm = call(exports, 'sp_check', { project: temp }).check;
      const shape = (report) => report.diagnostics.map(({ code, message, help, location }) => ({ code, message, help, line: location?.line, column: location?.column }));
      assert.deepEqual(shape(wasm), shape(native), handler);
      assert.equal(native.diagnostics.length === 0, handler.startsWith('[ns.'), handler);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
});
