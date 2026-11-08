import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { hostFs, call } from './host-fs.mjs';

const target = process.env.CARGO_TARGET_DIR ?? 'target';
const zero = path.resolve(target, 'debug/zero');
let exports;
const module = await WebAssembly.instantiate(fs.readFileSync(path.join(target, 'wasm32-unknown-unknown/wasm/zero.wasm')), { host: hostFs(() => exports) });
exports = module.instance.exports;

test('host imports capture pantry byte for byte like native sources', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-wasm-sources-'));
  try {
    execFileSync(zero, ['sources', 'examples/pantry', '--out', path.join(temp, 'native')]);
    const capture = call(exports, 'zero_sources', { project: path.resolve('examples/pantry') });
    for (const [key, file] of [['app', 'app.zero.json'], ['vendor', 'vendor.zero.json'], ['manifest', 'manifest.json']]) {
      assert.equal(capture[key], fs.readFileSync(path.join(temp, 'native', file), 'utf8'));
    }
    assert.deepEqual(call(exports, 'zero_check', { project: path.resolve('examples/pantry') }).check.diagnostics, []);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('wasm migrates real source and returns a compilable file map without writes', () => {
  const project = path.resolve('tests/fixtures/app-migrate/board');
  const candidate = call(exports, 'zero_migrate_app', { project, space: 'spc_migrate_test' });
  assert.deepEqual(candidate.report.errors, []);
  assert.equal(candidate.report.status, 'candidate');
  assert.ok(candidate.files['zero/migrations/snapshot.json']);
  assert.deepEqual(call(exports, 'zero_check', { project: '/candidate', files: candidate.files }).check.diagnostics, []);
  // A new Space has no 0.8 tables: `fresh: true` creates them instead of adopting; a schema with
  // neither `fresh` nor `space` is refused with the choice.
  const unset = call(exports, 'zero_migrate_app', { project });
  assert.deepEqual(unset.report.errors.map((e) => e.code), ['Z08_SPACE_REQUIRED']);
  for (const request of [{ project, space: 'spc_new', fresh: true }, { project, fresh: true }]) {
    const fresh = call(exports, 'zero_migrate_app', request);
    assert.deepEqual(fresh.report.errors, [], JSON.stringify(request));
    assert.equal(fresh.report.tables, 'fresh');
    assert.ok(fresh.files['zero/migrations/0001_init.sql'].includes('CREATE TABLE'));
    assert.ok(!fresh.files['server/index.ts'].includes('existingTable'));
    assert.equal(JSON.parse(fresh.files['zero/migrations/snapshot.json']).tables.tasks.existingTable, undefined);
    assert.deepEqual(call(exports, 'zero_check', { project: '/candidate', files: fresh.files }).check.diagnostics, []);
  }
  const config = call(exports, 'zero_migrate_config', { project: path.resolve('tests/wp/legacy'), input: 'capsule.ts' });
  assert.equal(config.status, 'candidate');
  assert.deepEqual(config.errors, []);
});

test('wasm refuses a 0.8 client app with a coded diagnostic instead of a partial public/', () => {
  const candidate = call(exports, 'zero_migrate_app', { project: path.resolve('tests/fixtures/app-migrate/client-app'), space: 'spc_migrate_test', users: true });
  assert.equal(candidate.report.status, 'refused');
  assert.deepEqual(candidate.files, {});
  assert.deepEqual(candidate.report.errors.map((e) => [e.code, e.file, e.line, e.column]), [['Z08_CLIENT_NATIVE', 'client/index.tsx', 1, 1]]);
});

test('host capture gives npm imports an actionable stable diagnostic', () => {
  const response = call(exports, 'zero_sources', { project: '/project', packages: false, files: {
    'zero.config.ts': 'import thing from "some-npm-package"; export default thing;',
  } });
  assert.equal(response.check.diagnostics[0].code, 'zero_source_needs_local_capture');
});

test('wasm and native capture include the same synced Markdown files', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-wasm-sync-'));
  try {
    const project = path.join(temp, 'project');
    const files = {
      'zero.config.ts': "import { defineConfig, collection, id, text, richText } from 'zero'; const posts = collection({ id: id(), title: text().notNull(), body: richText() }, { title: 'title', content: 'body', sync: 'content/posts/*.md' }); export default defineConfig({ collections: { posts } });",
      'content/posts/hello.md': '---\ntitle: Hello\n---\nA **seed**.\n',
      'content/posts/ignored.txt': 'not synced',
    };
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(project, name)), { recursive: true });
      fs.writeFileSync(path.join(project, name), text);
    }
    execFileSync(zero, ['sources', project, '--out', path.join(temp, 'native')]);
    const native = fs.readFileSync(path.join(temp, 'native/app.zero.json'), 'utf8');
    const disk = call(exports, 'zero_sources', { project });
    const memory = call(exports, 'zero_sources', { project: '/project', files });
    assert.equal(disk.app, native);
    assert.equal(memory.app, native);
    assert.equal(JSON.parse(disk.app).files['content/posts/hello.md'], files['content/posts/hello.md']);
    assert.equal(JSON.parse(disk.app).files['content/posts/ignored.txt'], undefined);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('wasm captures the full-site pages bundle byte for byte like native sources', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-wasm-pages-'));
  try {
    const project = path.join(temp, 'site');
    fs.cpSync(path.resolve('examples/full-site'), project, { recursive: true, filter: (source) => !source.split(path.sep).includes('.zero') });
    execFileSync(zero, ['sources', project, '--out', path.join(temp, 'native')]);
    const capture = call(exports, 'zero_sources', { project });
    for (const [key, file] of [['app', 'app.zero.json'], ['vendor', 'vendor.zero.json'], ['manifest', 'manifest.json']]) {
      assert.equal(capture[key], fs.readFileSync(path.join(temp, 'native', file), 'utf8'), file);
    }
    const files = JSON.parse(capture.app).files;
    for (const name of ['zero/pages.json', 'pages/notes/[slug]/page.tsx', 'islands/cheer.client.ts', 'pages/about/compass.svg']) {
      assert.equal(typeof files[name], 'string', name);
    }
    const memory = Object.fromEntries(Object.entries(files).filter(([name]) => !name.startsWith('zero/migrations/')));
    for (const name of fs.readdirSync(path.join(project, 'zero/migrations'))) memory[`zero/migrations/${name}`] = fs.readFileSync(path.join(project, 'zero/migrations', name), 'utf8');
    assert.equal(call(exports, 'zero_sources', { project: '/site', files: memory }).app, capture.app, 'an in-memory project captures the same bytes');
    fs.writeFileSync(path.join(project, 'pages/page.tsx'), fs.readFileSync(path.join(project, 'pages/page.tsx'), 'utf8') + '\n');
    assert.equal(call(exports, 'zero_sources', { project }).check.diagnostics[0].code, 'zero_source_needs_local_capture');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('wasm and native resolve build-time namespace members and refuse the same whole values', () => {
  const source = (handler) => `import { action, defineConfig } from 'zero';
import * as ns from './ns.mjs';
function tagged(s: string) { return s; }
Object.assign(tagged, { prefix: 'p' });
export default defineConfig({ name: 'ns', actions: { probe: action({ input: {}, handler: () => ${handler} }) } });
`;
  const helper = 'export const shout = (value) => value.toUpperCase();\nexport const constants = { SEP: "/" };\n';
  for (const handler of ["[ns.shout('a'), ns.constants.SEP, tagged('x'), tagged.prefix]", 'Object.keys(ns)', '[tagged]']) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-wasm-namespace-'));
    try {
      fs.writeFileSync(path.join(temp, 'zero.config.ts'), source(handler));
      fs.writeFileSync(path.join(temp, 'ns.mjs'), helper);
      let native;
      try { native = JSON.parse(execFileSync(zero, ['check', temp, '--json'], { encoding: 'utf8' })); }
      catch (error) { native = JSON.parse(error.stdout); }
      const wasm = call(exports, 'zero_check', { project: temp }).check;
      const shape = (report) => report.diagnostics.map(({ code, message, help, location }) => ({ code, message, help, line: location?.line, column: location?.column }));
      assert.deepEqual(shape(wasm), shape(native), handler);
      assert.equal(native.diagnostics.length === 0, handler.startsWith('[ns.'), handler);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
});
