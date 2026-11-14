#!/usr/bin/env bash
# The WordPress lane (design §9.2): build the test app (tests/wp/app = the frozen phase-1 blog in
# tests/fixtures/blog + test hooks + lane fragments) and its typed client, boot a fresh WordPress with
# the plugin, run every tests/wp/*.test.ts, tear down. `cargo test` never depends on this. FIRST_WP_PORT (default 8790) picks the port;
# FIRST_WP_KEEP=1 leaves the stack up afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cd "$repo"

if [[ ${1:-} == --s3 ]]; then
  export FIRST_WP_S3=1
fi
cargo build -q
first="${CARGO_TARGET_DIR:-target}/debug/first"
# Retain downloads across the disposable source builds unless the caller chose a shared cache.
export FIRST_WP_PLUGIN_CACHE="${FIRST_WP_PLUGIN_CACHE:-$here/app/.first/cache/plugins}"
# A fresh database expects one initial migration. Build fresh source each time so ignored
# migrations from an earlier fixture schema cannot change the ledger under test.
build_app="$(mktemp -d "$here/.app-build.XXXXXX")"
cleanup() {
  rm -rf -- "$build_app"
  [[ ${FIRST_WP_KEEP:-0} == 1 ]] || "$here/harness.sh" down
}
trap cleanup EXIT
rsync -a --exclude '/first/_generated/' --exclude '/first/dist/' --exclude '/first/blog/' --exclude '/.first/' "$here/app/" "$build_app/"
# The frozen blog the app extends lives in tests/fixtures/blog (the PHP suites' golden); the app
# imports it from first/blog/, inside the First root. The suites' extra post hooks go in the same
# file, because hooks are declared beside the kind.
mkdir -p "$build_app/first/blog"
cat tests/fixtures/blog/first.config.ts "$here/blog-test-hooks.ts" > "$build_app/first/blog/first.config.ts"
if [[ ${FIRST_WP_S3:-0} == 1 ]]; then
  cp "$here/uploads.s3.ts" "$build_app/first/uploads.ts"
fi
"$first" build "$build_app" --quiet >/dev/null
# The client integration tests import this stable path; leave existing fixture migrations alone.
mkdir -p "$here/app/first/_generated/client"
rsync -a --delete "$build_app/first/_generated/client/" "$here/app/first/_generated/client/"
# Stage into a stable dir: the build replaces its output dir, which would orphan a bind mount.
mkdir -p tests/wp/.wp-content
rsync -a --delete "$build_app/first/dist/wp-content/" tests/wp/.wp-content/

"$here/harness.sh" down
# Relative to the repo root (run.sh's working directory): harness.sh resolves it against the caller.
"$here/harness.sh" up --wp-content tests/wp/.wp-content > "$here/.harness.json"
cat "$here/.harness.json"

if [[ ${FIRST_WP_S3:-0} == 1 ]]; then
  node --test "$here/media.test.ts"
  exit
fi
# The React hooks test bundles a React app with the generated client and runs it in Chromium.
if [[ ${FIRST_WP_SKIP_BROWSER:-0} != 1 && ! -d "$here/hooks/node_modules" ]]; then
  npm ci --prefix "$here/hooks" --ignore-scripts --no-audit --no-fund --silent
fi
node --test --test-concurrency=1 "$here"/*.test.ts
"$here/admin/browser-run.sh"
# Lane A: the admin plugin on a WordPress installed below the origin root.
"$here/admin/subdir-run.sh"
# The migration lanes boot their own apps on fresh stacks; CI runs them as a separate job
# (tests/wp/migrate-run.sh). FIRST_WP_SKIP_MIGRATE=1 leaves them to that job.
[[ ${FIRST_WP_SKIP_MIGRATE:-0} == 1 ]] || "$here/migrate-run.sh"
