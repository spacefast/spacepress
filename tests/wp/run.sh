#!/usr/bin/env bash
# The WordPress lane (design §9.2): build the test app (tests/wp/app = the frozen phase-1 blog in
# tests/fixtures/blog + test hooks + lane fragments) and its typed client, boot a fresh WordPress with
# the plugin, run every tests/wp/*.test.ts, tear down. `cargo test` never depends on this. ZERO_WP_PORT (default 8790) picks the port;
# ZERO_WP_KEEP=1 leaves the stack up afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cd "$repo"

cargo build -q
zero="${CARGO_TARGET_DIR:-target}/debug/zero"
# Retain downloads across the disposable source builds unless the caller chose a shared cache.
export ZERO_WP_PLUGIN_CACHE="${ZERO_WP_PLUGIN_CACHE:-$here/app/.zero/cache/plugins}"
# A fresh database expects one initial migration. Build fresh source each time so ignored
# migrations from an earlier fixture schema cannot change the ledger under test. Keep the
# same directory depth as app/ for its relative imports into tests/fixtures/.
build_app="$(mktemp -d "$here/.app-build.XXXXXX")"
cleanup() {
  rm -rf -- "$build_app"
  [[ ${ZERO_WP_KEEP:-0} == 1 ]] || "$here/harness.sh" down
}
trap cleanup EXIT
rsync -a --exclude '/zero/' --exclude '/.zero/' --exclude '/zero.gen.ts' "$here/app/" "$build_app/"
"$zero" build "$build_app" --target wp --quiet >/dev/null
# The client integration tests import this stable path; leave existing fixture migrations alone.
mkdir -p "$here/app/zero/client"
rsync -a --delete "$build_app/zero/client/" "$here/app/zero/client/"
# Stage into a stable dir: the build replaces its output dir, which would orphan a bind mount.
mkdir -p tests/wp/.wp-content
rsync -a --delete "$build_app/.zero/wp-content/" tests/wp/.wp-content/

"$here/harness.sh" down
# Relative to the repo root (run.sh's working directory): harness.sh resolves it against the caller.
"$here/harness.sh" up --wp-content tests/wp/.wp-content > "$here/.harness.json"
cat "$here/.harness.json"

node --test --test-concurrency=1 "$here"/*.test.ts
# Lane A: the admin plugin on a WordPress installed below the origin root.
"$here/admin/subdir-run.sh"
# Lane M: an original Zero 0.8 site migrated in place, on a fresh stack running the migrated app.
"$here/legacy/run.sh"
# Lane M2: its app users into an `auth: true` collection.
"$here/legacy/users-run.sh"
