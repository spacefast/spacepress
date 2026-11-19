#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
wp="$repo/tests/wp"
source "$repo/migrate/tests/wp/helpers.sh"
cd "$repo"
export TP_WP_PROJECT="${TP_WP_PROJECT:-typedpress-wp-import-system}"
export TP_WP_PORT="${TP_WP_PORT:-8809}"
cargo build --workspace --locked -q
dir="$(mktemp -d)"
cleanup() { "$wp/harness.sh" down; rm -rf "$dir"; }
trap cleanup EXIT
export TP_WP_CONTENT="$dir/content"
mkdir -p "$TP_WP_CONTENT/plugins"
export TP_WP_HARNESS="$dir/harness.json"
"$wp/harness.sh" down
"$wp/harness.sh" up --wp-content "$TP_WP_CONTENT" --bare > "$TP_WP_HARNESS"
stage_import
"$wp/harness.sh" compose cp "$here/site.json" cli:/tmp/typedpress-legacy-site.json
"$wp/harness.sh" compose cp "$here/replay.php" cli:/tmp/typedpress-legacy-replay.php
"$wp/harness.sh" wp eval-file /tmp/typedpress-legacy-replay.php /tmp/typedpress-legacy-site.json >/dev/null
export TP_MIGRATE_BIN="${CARGO_TARGET_DIR:-$repo/target}/debug/typedpress-migrate"
node --test "$here/system.test.ts"
