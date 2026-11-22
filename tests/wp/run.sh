#!/usr/bin/env bash
# The WordPress lane (design §9.2): build the test app (tests/wp/app = the frozen phase-1 blog in
# tests/fixtures/blog + test hooks + lane fragments) and its typed client, boot a fresh WordPress with
# the plugin, run every tests/wp/*.test.ts, tear down. `cargo test` never depends on this. TP_WP_PORT (default 8790) picks the port;
# TP_WP_KEEP=1 leaves the stack up afterwards.
set -euo pipefail
# Locales are turned off for apps (docs/decisions/2026-11-17-locales-off.md); this lane exercises them.
export TYPEDPRESS_LOCALES=1
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cd "$repo"

if [[ ${1:-} == --s3 ]]; then
  export TP_WP_S3=1
fi
cargo build -q
first="${CARGO_TARGET_DIR:-target}/debug/typedpress"
# Retain downloads across the disposable source builds unless the caller chose a shared cache.
export TP_WP_PLUGIN_CACHE="${TP_WP_PLUGIN_CACHE:-$here/app/.tp/cache/plugins}"
# A fresh database expects one initial migration. Build fresh source each time so ignored
# migrations from an earlier fixture schema cannot change the ledger under test.
build_app="$(mktemp -d "$here/.app-build.XXXXXX")"
cleanup() {
  rm -rf -- "$build_app"
  [[ ${TP_WP_KEEP:-0} == 1 ]] || "$here/harness.sh" down
}
trap cleanup EXIT
rsync -a --exclude '/tp/_generated/' --exclude '/tp/dist/' --exclude '/tp/blog/' --exclude '/.tp/' "$here/app/" "$build_app/"
# The frozen blog the app extends lives in tests/fixtures/blog (the PHP suites' golden); the app
# imports it from tp/blog/, inside the TypedPress root. The suites' extra post hooks go in the same
# file, because hooks are declared beside the kind.
mkdir -p "$build_app/tp/blog"
cat tests/fixtures/blog/typedpress.config.ts "$here/blog-test-hooks.ts" > "$build_app/tp/blog/typedpress.config.ts"
if [[ ${TP_WP_S3:-0} == 1 ]]; then
  cp "$here/uploads.s3.ts" "$build_app/tp/uploads.ts"
fi
"$first" build "$build_app" --quiet >/dev/null
# The client integration tests import this stable path; leave existing fixture migrations alone.
mkdir -p "$here/app/tp/_generated/client"
rsync -a --delete "$build_app/tp/_generated/client/" "$here/app/tp/_generated/client/"
# Stage into a stable dir: the build replaces its output dir, which would orphan a bind mount.
mkdir -p tests/wp/.wp-content
rsync -a --delete "$build_app/tp/dist/wp-content/" tests/wp/.wp-content/

"$here/harness.sh" down
# Relative to the repo root (run.sh's working directory): harness.sh resolves it against the caller.
"$here/harness.sh" up --wp-content tests/wp/.wp-content > "$here/.harness.json"
cat "$here/.harness.json"

if [[ ${TP_WP_S3:-0} == 1 ]]; then
  node --test "$here/media.test.ts"
  exit
fi
# The React hooks test bundles a React app with the generated client and runs it in Chromium.
if [[ ${TP_WP_SKIP_BROWSER:-0} != 1 && ! -d "$here/hooks/node_modules" ]]; then
  npm ci --prefix "$here/hooks" --ignore-scripts --no-audit --no-fund --silent
fi
node --test --test-concurrency=1 "$here"/*.test.ts
"$here/admin/browser-run.sh"
# Lane A: the admin plugin on a WordPress installed below the origin root.
"$here/admin/subdir-run.sh"
# The migration lanes boot their own apps on fresh stacks; CI runs them as a separate job
# (tests/wp/migrate-run.sh). TP_WP_SKIP_MIGRATE=1 leaves them to that job.
[[ ${TP_WP_SKIP_MIGRATE:-0} == 1 ]] || "$here/migrate-run.sh"
