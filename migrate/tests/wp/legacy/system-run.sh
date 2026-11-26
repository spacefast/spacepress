#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
wp="$repo/tests/wp"
source "$repo/migrate/tests/wp/helpers.sh"
cd "$repo"
export SP_WP_PROJECT="${SP_WP_PROJECT:-spacepress-wp-import-system}"
export SP_WP_PORT="${SP_WP_PORT:-8809}"
cargo build --workspace --locked -q
dir="$(mktemp -d)"
cleanup() { "$wp/harness.sh" down; rm -rf "$dir"; }
trap cleanup EXIT
export SP_WP_CONTENT="$dir/content"
mkdir -p "$SP_WP_CONTENT/plugins"
export SP_WP_HARNESS="$dir/harness.json"
"$wp/harness.sh" down
"$wp/harness.sh" up --wp-content "$SP_WP_CONTENT" --bare > "$SP_WP_HARNESS"
stage_import
"$wp/harness.sh" compose cp "$here/site.json" cli:/tmp/spacepress-legacy-site.json
"$wp/harness.sh" compose cp "$here/replay.php" cli:/tmp/spacepress-legacy-replay.php
"$wp/harness.sh" wp eval-file /tmp/spacepress-legacy-replay.php /tmp/spacepress-legacy-site.json >/dev/null
export SP_MIGRATE_BIN="${CARGO_TARGET_DIR:-$repo/target}/debug/spacepress-migrate"
node --test "$here/system.test.ts"
