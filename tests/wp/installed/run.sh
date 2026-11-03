#!/usr/bin/env bash
# Prove a release binary can provision and stop WordPress after its build source is removed.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/zero-installed-native.XXXXXXXX")"
cleanup() {
  if [[ $? == 0 ]]; then
    rm -rf "$work"
  else
    echo "Installed-binary failure retained for inspection: $work" >&2
  fi
}
trap cleanup EXIT
src="$work/src" bin="$work/bin" home="$work/my home" project="$work/project"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
mkdir -p "$src/scripts" "$bin" "$home" "$project"
rsync -a --exclude node_modules --exclude target \
  "$repo"/{build.rs,Cargo.toml,Cargo.lock,rust-toolchain,src,runtime} "$src/"
rsync -a "$repo/scripts/dev" "$src/scripts/"
CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" CARGO_TARGET_DIR="$target" \
  cargo build -q --release --locked --manifest-path "$src/Cargo.toml"
cp "$target/release/zero" "$bin/zero"
rm -rf "$src"
cat > "$project/zero.config.ts" <<'CONFIG'
import { defineConfig, table, text } from 'zero';
export default defineConfig({ tables: { notes: table({ title: text().notNull() }) } });
CONFIG
cd "$work"
env -u ZERO_WP_HARNESS HOME="$home" XDG_CACHE_HOME= \
  ZERO_WP_PLUGIN_CACHE="${ZERO_WP_PLUGIN_CACHE:-$repo/.zero/cache/plugins}" \
  node --input-type=module - "$bin/zero" "$project" <<'CHECK'
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
const [zero, project] = process.argv.slice(2);
const exec = promisify(execFile);
const run = async (args) => {
  const result = await exec(zero, args, { timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.stdout;
};
const server = createServer();
await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
const port = server.address().port;
await new Promise((done) => server.close(done));
try {
  await run(['dev', project, '--port', String(port), '--no-watch']);
  const status = JSON.parse(await run(['dev', 'status', project]));
  assert.equal(status.isOnline, true);
  const response = await fetch(`${status.siteUrl}/wp-json/zero/v1/_schema`, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.name, 'project');
  assert.equal(data.runtime.wp.database.kind, 'sqlite');
  assert.deepEqual(data.runtime.pendingMigrations, []);
  const version = await run(['dev', 'wp', project, '--', 'core', 'version']);
  assert.match(version.trim(), /^7\./);
  await run(['dev', 'stop', project]);
  assert.equal(JSON.parse(await run(['dev', 'status', project])).isOnline, false);
  console.log('ok - installed binary provisions, serves, runs WP-CLI and stops native WordPress without its build checkout');
} finally {
  await run(['dev', 'stop', project]);
  await exec('npx', ['--yes', 'wp-studio@2.1.1', 'delete', '--path', `${project}/.zero/dev/wordpress`, '--no-files'], { timeout: 60000 });
}
CHECK
