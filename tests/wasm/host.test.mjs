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
  const config = call(exports, 'zero_migrate_config', { project: path.resolve('tests/wp/legacy'), input: 'capsule.ts' });
  assert.equal(config.status, 'candidate');
  assert.deepEqual(config.errors, []);
});

test('host capture gives npm imports an actionable stable diagnostic', () => {
  const response = call(exports, 'zero_sources', { project: '/project', packages: false, files: {
    'zero.config.ts': 'import thing from "some-npm-package"; export default thing;',
  } });
  assert.equal(response.check.diagnostics[0].code, 'zero_source_needs_local_capture');
});
