import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { hostFs, call } from './host-fs.mjs';

const target = process.env.CARGO_TARGET_DIR ?? 'target';
const first = path.resolve(target, 'debug/first');
let exports;
const module = await WebAssembly.instantiate(fs.readFileSync(path.join(target, 'wasm32-unknown-unknown/wasm/first.wasm')), { host: hostFs(() => exports) });
exports = module.instance.exports;

test('host imports capture pantry byte for byte like native sources', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'first-wasm-sources-'));
  try {
    execFileSync(first, ['sources', 'examples/pantry', '--out', path.join(temp, 'native')]);
    const capture = call(exports, 'first_sources', { project: path.resolve('examples/pantry') });
    for (const [key, file] of [['app', 'app.first.json'], ['vendor', 'vendor.first.json'], ['manifest', 'manifest.json']]) {
      assert.equal(capture[key], fs.readFileSync(path.join(temp, 'native', file), 'utf8'));
    }
    assert.deepEqual(call(exports, 'first_check', { project: path.resolve('examples/pantry') }).check.diagnostics, []);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('wasm migrates real source and returns a compilable file map without writes', () => {
  const project = path.resolve('tests/fixtures/app-migrate/board');
  const candidate = call(exports, 'first_migrate_app', { project, space: 'spc_migrate_test' });
  assert.deepEqual(candidate.report.errors, []);
  assert.equal(candidate.report.status, 'candidate');
  assert.ok(candidate.files['first/_generated/migrations/snapshot.json']);
  assert.deepEqual(call(exports, 'first_check', { project: '/candidate', files: candidate.files }).check.diagnostics, []);
  // A new Space has no 0.8 tables: `fresh: true` creates them instead of adopting; a schema with
  // neither `fresh` nor `space` is refused with the choice.
  const unset = call(exports, 'first_migrate_app', { project });
  assert.deepEqual(unset.report.errors.map((e) => e.code), ['Z08_SPACE_REQUIRED']);
  for (const request of [{ project, space: 'spc_new', fresh: true }, { project, fresh: true }]) {
    const fresh = call(exports, 'first_migrate_app', request);
    assert.deepEqual(fresh.report.errors, [], JSON.stringify(request));
    assert.equal(fresh.report.tables, 'fresh');
    assert.ok(fresh.files['first/_generated/migrations/0001_init.sql'].includes('CREATE TABLE'));
    assert.ok(!fresh.files['first/server/index.ts'].includes('existingTable'));
    assert.equal(JSON.parse(fresh.files['first/_generated/migrations/snapshot.json']).tables.tasks.existingTable, undefined);
    assert.deepEqual(call(exports, 'first_check', { project: '/candidate', files: fresh.files }).check.diagnostics, []);
  }
  const config = call(exports, 'first_migrate_config', { project: path.resolve('tests/wp/legacy'), input: 'capsule.ts' });
  assert.equal(config.status, 'candidate');
  assert.deepEqual(config.errors, []);
});

test('wasm converts a 0.8 client app to the same public/ files as the native CLI', () => {
  // The publish path converts in wasm, so a client app without pages must not depend on the native CLI.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'first-wasm-client-'));
  try {
    const project = path.resolve('tests/fixtures/app-migrate/client-app');
    const out = path.join(temp, 'native');
    const styles = path.resolve('tests/fixtures/app-migrate/client-app-styles/zero.css');
    execFileSync(first, ['migrate', 'app', '--from', 'zero-0.8', project, '--out', out, '--space', 'spc_migrate_test', '--users', '--zero-css', styles]);
    const candidate = call(exports, 'first_migrate_app', { project, space: 'spc_migrate_test', users: true, zeroCss: fs.readFileSync(styles, 'utf8') });
    assert.deepEqual(candidate.report.errors, []);
    assert.equal(candidate.report.status, 'candidate');
    const client = Object.keys(candidate.files).filter((name) => name.startsWith('public/')).sort();
    assert.ok(['public/app/client/index.js', 'public/index.html', 'public/zero.css'].every((f) => client.includes(f)), client.join(' '));
    for (const name of client) assert.equal(candidate.files[name], fs.readFileSync(path.join(out, name), 'utf8'), name);
    assert.equal(candidate.files['first.config.ts'], fs.readFileSync(path.join(out, 'first.config.ts'), 'utf8'));
    assert.deepEqual(call(exports, 'first_check', { project: '/candidate', files: candidate.files }).check.diagnostics, []);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('host capture gives npm imports an actionable stable diagnostic', () => {
  const response = call(exports, 'first_sources', { project: '/project', packages: false, files: {
    'first.config.ts': 'import thing from "some-npm-package"; export default thing;',
  } });
  assert.equal(response.check.diagnostics[0].code, 'first_source_needs_local_capture');
});

test('wasm capture and check refuse a ledger still at first/migrations/', () => {
  const files = {
    'first.config.ts': "import { defineConfig, table, text } from 'first'; export const notes = table({ body: text().optional() }); export default defineConfig({});",
    'first/migrations/snapshot.json': '{"version":2,"tables":{}}',
  };
  const moved = 'first/migrations/ moved to first/_generated/migrations/';
  const sources = call(exports, 'first_sources', { project: '/project', packages: false, files });
  assert.equal(sources.check.diagnostics[0].message, moved);
  const check = call(exports, 'first_check', { project: '/project', files });
  assert.deepEqual(check.check.diagnostics.map((d) => d.message), [moved]);
});

test('wasm and native capture include the same synced Markdown files', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'first-wasm-sync-'));
  try {
    const project = path.join(temp, 'project');
    const files = {
      'first.config.ts': "import { defineConfig, collection, text, richText } from 'first'; export const posts = collection({ title: text(), body: richText().optional() }, { title: 'title', content: 'body', sync: 'content/posts/*.md' }); export default defineConfig({});",
      'content/posts/hello.md': '---\ntitle: Hello\n---\nA **seed**.\n',
      'content/posts/ignored.txt': 'not synced',
    };
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(project, name)), { recursive: true });
      fs.writeFileSync(path.join(project, name), text);
    }
    execFileSync(first, ['sources', project, '--out', path.join(temp, 'native')]);
    const native = fs.readFileSync(path.join(temp, 'native/app.first.json'), 'utf8');
    const disk = call(exports, 'first_sources', { project });
    const memory = call(exports, 'first_sources', { project: '/project', files });
    assert.equal(disk.app, native);
    assert.equal(memory.app, native);
    assert.equal(JSON.parse(disk.app).files['content/posts/hello.md'], files['content/posts/hello.md']);
    assert.equal(JSON.parse(disk.app).files['content/posts/ignored.txt'], undefined);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('wasm captures the full-site pages bundle byte for byte like native sources', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'first-wasm-pages-'));
  try {
    const project = path.join(temp, 'site');
    fs.cpSync(path.resolve('examples/full-site'), project, { recursive: true, filter: (source) => !source.split(path.sep).includes('.first') });
    execFileSync(first, ['sources', project, '--out', path.join(temp, 'native')]);
    const capture = call(exports, 'first_sources', { project });
    for (const [key, file] of [['app', 'app.first.json'], ['vendor', 'vendor.first.json'], ['manifest', 'manifest.json']]) {
      assert.equal(capture[key], fs.readFileSync(path.join(temp, 'native', file), 'utf8'), file);
    }
    const files = JSON.parse(capture.app).files;
    for (const name of ['first/app/notes/[slug]/page.tsx', 'first/app/notes/[slug]/note.module.css', 'first/app/about/compass.svg', 'first/components/CheerButton.tsx']) {
      assert.equal(typeof files[name], 'string', name);
    }
    const memory = Object.fromEntries(Object.entries(files).filter(([name]) => !name.startsWith('first/_generated/migrations/')));
    for (const name of fs.readdirSync(path.join(project, 'first/_generated/migrations'))) memory[`first/_generated/migrations/${name}`] = fs.readFileSync(path.join(project, 'first/_generated/migrations', name), 'utf8');
    assert.equal(call(exports, 'first_sources', { project: '/site', files: memory }).app, capture.app, 'an in-memory project captures the same bytes');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('wasm and native resolve build-time namespace members and refuse the same whole values', () => {
  const source = (handler) => `import { action, defineConfig } from 'first';
import * as ns from './first/ns.mjs';
function tagged(s: string) { return s; }
Object.assign(tagged, { prefix: 'p' });
export const probe = action({ input: {}, handler: () => ${handler} });
export default defineConfig({ name: 'ns' });
`;
  const helper = 'export const shout = (value) => value.toUpperCase();\nexport const constants = { SEP: "/" };\n';
  for (const handler of ["[ns.shout('a'), ns.constants.SEP, tagged('x'), tagged.prefix]", 'Object.keys(ns)', '[tagged]']) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'first-wasm-namespace-'));
    try {
      fs.writeFileSync(path.join(temp, 'first.config.ts'), source(handler));
      fs.mkdirSync(path.join(temp, 'first'));
      fs.writeFileSync(path.join(temp, 'first/ns.mjs'), helper);
      let native;
      try { native = JSON.parse(execFileSync(first, ['check', temp, '--json'], { encoding: 'utf8' })); }
      catch (error) { native = JSON.parse(error.stdout); }
      const wasm = call(exports, 'first_check', { project: temp }).check;
      const shape = (report) => report.diagnostics.map(({ code, message, help, location }) => ({ code, message, help, line: location?.line, column: location?.column }));
      assert.deepEqual(shape(wasm), shape(native), handler);
      assert.equal(native.diagnostics.length === 0, handler.startsWith('[ns.'), handler);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
});
