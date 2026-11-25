#!/usr/bin/env bash
# Forward-only schema changes through successive builds and a real WordPress/MariaDB site.
#   SP_WP_PROJECT=spacepress-wp-schema-check SP_WP_PORT=8902 tests/wp/schema-check/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
export SP_WP_PROJECT="${SP_WP_PROJECT:-spacepress-wp-schema-check}"
export SP_WP_PORT="${SP_WP_PORT:-8902}"
work="$(mktemp -d)"
cleanup() { "$wp/harness.sh" down >/dev/null; rm -rf "$work"; }
trap cleanup EXIT
mkdir -p "$work/app" "$work/content" "$work/live"

write_config() { node "$here/steps.mjs" "$1" > "$work/app/spacepress.config.ts"; }
build() { "$target/debug/spacepress" build "$work/app" --quiet; }
stage() {
  write_config "$1"
  build >/dev/null
  rsync -a "$work/app/sp/dist/wp-content/" "$work/content/$1/"
}
refuses() {
  write_config "$1"
  if build > "$work/build.log" 2>&1 || ! grep -Fq "$2" "$work/build.log"; then
    cat "$work/build.log" >&2
    echo "not ok: $1 should be refused with: $2" >&2
    exit 1
  fi
  echo "ok: compiler refuses $1"
}

stage initial
stage additive
refuses required 'cannot add required column `notes.reviewer` without a literal default'
refuses tighten 'making `notes.body` required without a literal default'
refuses narrow 'narrowing `notes.body`'
refuses toBoolean 'narrowing `notes.flag`'
refuses toInteger 'narrowing `notes.count`'
refuses toReal 'narrowing `notes.ratio`'
refuses integerToReal 'narrowing `notes.total`'
refuses toRef 'narrowing `notes.count`'
refuses renameColumn 'forward-only migrations never rename columns in place'
refuses renameTable 'forward-only migrations never rename SQL tables in place'
stage renamed
stage retired

rsync -a "$work/content/initial/" "$work/live/"
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/live" --bare > "$work/bare.json"
"$wp/harness.sh" sql "CREATE TABLE wp_external_tasks (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, title LONGTEXT NOT NULL, note LONGTEXT, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
"$wp/harness.sh" sql "INSERT INTO wp_external_tasks (title, note) VALUES ('kept', 'existing row'), ('also kept', NULL)"
"$wp/harness.sh" up --wp-content "$work/live" > "$work/harness.json"
SP_WP_HARNESS="$work/harness.json" SP_SCHEMA_CHECK_CONTENT="$work/content" SP_SCHEMA_CHECK_LIVE="$work/live" \
  node --test "$here/schema-check.test.ts"
