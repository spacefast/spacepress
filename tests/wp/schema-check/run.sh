#!/usr/bin/env bash
# The deploy-time schema check on real WordPress/MariaDB (spec §2.9): successive deploys of one
# app, each checked against live rows by `wp zero migrate [--drop name=rows]`.
#   ZERO_WP_PROJECT=zero-wp-schema-check ZERO_WP_PORT=8902 tests/wp/schema-check/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
export ZERO_WP_PROJECT="${ZERO_WP_PROJECT:-zero-wp-schema-check}"
export ZERO_WP_PORT="${ZERO_WP_PORT:-8902}"
work="$(mktemp -d)"
cleanup() { "$wp/harness.sh" down >/dev/null; rm -rf "$work"; }
trap cleanup EXIT
mkdir -p "$work/app" "$work/content"
# Each step is built into the same project in order, so its migration is planned against the
# previous step's ledger, then staged as its own wp-content for the test to install.
for step in initial additive required tighten rename drop adoptedField adoptedKind narrow retype retyped requiredNarrow; do
  node "$here/steps.mjs" "$step" > "$work/app/zero.config.ts"
  "$target/debug/zero" build "$work/app" --quiet >/dev/null
  rsync -a --delete "$work/app/.zero/wp-content/" "$work/content/$step/"
done
# The stack mounts one plugins directory; the test swaps each step's app plugin into it.
mkdir -p "$work/live"
rsync -a --delete "$work/content/initial/" "$work/live/"
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/live" --bare > "$work/bare.json"
# A table the app didn't create, with rows, as a migrated 0.8 Space has before its first v2 deploy.
"$wp/harness.sh" sql "CREATE TABLE sf_spc_schema_check_tasks_0123456789 (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, title LONGTEXT NOT NULL, note LONGTEXT, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
"$wp/harness.sh" sql "INSERT INTO sf_spc_schema_check_tasks_0123456789 (title, note) VALUES ('kept', 'from 0.8'), ('also kept', NULL)"
"$wp/harness.sh" up --wp-content "$work/live" > "$work/harness.json"
ZERO_WP_HARNESS="$work/harness.json" ZERO_SCHEMA_CHECK_CONTENT="$work/content" ZERO_SCHEMA_CHECK_LIVE="$work/live" \
  node --test "$here/schema-check.test.ts"
