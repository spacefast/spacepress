#!/usr/bin/env bash
# Prove a release binary can provision and stop WordPress after its build source is removed.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/spacepress-installed-native.XXXXXXXX")"
# Keep Studio's Unix sockets below the platform path limit, independently of the long fake HOME.
daemon="$(mktemp -d "${TMPDIR:-/tmp}/sp-pm.XXXXXXXX")"
cleanup() {
  if [[ $? == 0 ]]; then
    rm -rf "$work" "$daemon"
  else
    echo "Installed-binary failure retained for inspection: $work (Studio daemon: $daemon)" >&2
  fi
}
trap cleanup EXIT
src="$work/src" bin="$work/bin" home="$work/my home" project="$work/project"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
mkdir -p "$src" "$bin" "$home" "$project"
git -C "$repo" ls-files -z | rsync -a --from0 --files-from=- "$repo/" "$src/"
CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" CARGO_TARGET_DIR="$target" \
  cargo build -q --release --locked --manifest-path "$src/Cargo.toml"
cp "$target/release/spacepress" "$bin/spacepress"
rm -rf "$src"
cat > "$project/spacepress.config.ts" <<'CONFIG'
import { defineConfig, table, text } from 'spacepress';
export const notes = table({ title: text() });
export default defineConfig({});
CONFIG
cd "$work"
env -u SP_WP_HARNESS HOME="$home" XDG_CACHE_HOME= STUDIO_PROCESS_MANAGER_HOME="$daemon" \
  SP_WP_PLUGIN_CACHE="${SP_WP_PLUGIN_CACHE:-$repo/.sp/cache/plugins}" \
  node --input-type=module - "$bin/spacepress" "$project" <<'CHECK'
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
const [first, project] = process.argv.slice(2);
const exec = promisify(execFile);
const run = async (args) => {
  const result = await exec(first, args, { timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.stdout;
};
const server = createServer();
await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
const port = server.address().port;
await new Promise((done) => server.close(done));
let stopped = false;
let primaryError;
try {
  await run(['dev', project, '--port', String(port), '--no-watch']);
  const status = JSON.parse(await run(['dev', 'status', project]));
  assert.equal(status.isOnline, true);
  const response = await fetch(`${status.siteUrl}/wp-json/spacepress/v1`, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.name, 'project');
  assert.equal(data.runtime.wp.database.kind, 'sqlite');
  assert.deepEqual(data.runtime.pendingMigrations, []);
  const version = await run(['wp', '--site', project, 'core', 'version']);
  assert.match(version.trim(), /^7\./);
  await run(['dev', 'stop', project]);
  stopped = true;
  assert.equal(JSON.parse(await run(['dev', 'status', project])).isOnline, false);
  console.log('ok - installed binary provisions, serves, runs WP-CLI and stops native WordPress without its build checkout');
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  const errors = [];
  if (!stopped) await run(['dev', 'stop', project]).catch((error) => errors.push(error));
  await exec('npx', ['--yes', '--package', 'wp-studio@2.2.0', '--', 'studio', 'delete', '--path', `${project}/.sp/dev/wordpress`, '--no-files'], { timeout: 60000 })
    .catch((error) => errors.push(error));
  // Both HOME and the daemon belong only to this test; stop its daemon as well as its site.
  await exec('npx', ['--yes', '--package', 'wp-studio@2.2.0', '--', 'studio', 'stop', '--all'], { timeout: 60000 })
    .catch((error) => errors.push(error));
  if (errors.length) {
    for (const error of errors) console.error('Cleanup:', error.message);
    if (!primaryError) throw new AggregateError(errors, 'Installed test cleanup failed');
  }
}
CHECK
