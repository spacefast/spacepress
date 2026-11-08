#!/usr/bin/env bash
# The opinionated WordPress (spec.md §6) on real WordPress/MariaDB: each hardening switch while the app
# is active, and the same WordPress as shipped once it isn't.
#   ZERO_WP_PROJECT=zero-wp-hardening ZERO_WP_PORT=8896 tests/wp/hardening/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
export ZERO_WP_PROJECT="${ZERO_WP_PROJECT:-zero-wp-hardening}"
export ZERO_WP_PORT="${ZERO_WP_PORT:-8896}"
work="$(mktemp -d)"
cleanup() { "$wp/harness.sh" down >/dev/null; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/app"
cp "$here/zero.config.ts" "$work/app/"
"$target/debug/zero" build "$work/app" --quiet >/dev/null
"$wp/harness.sh" up --wp-content "$work/app/.zero/wp-content" > "$work/harness.json"
ZERO_WP_HARNESS="$work/harness.json" node --test --test-concurrency=1 "$here/hardening.test.ts"
