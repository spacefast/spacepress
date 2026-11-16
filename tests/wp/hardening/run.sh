#!/usr/bin/env bash
# The opinionated WordPress (spec.md §6) on real WordPress/MariaDB: each hardening switch while the app
# is active, and the same WordPress as shipped once it isn't.
#   TP_WP_PROJECT=typedpress-wp-hardening TP_WP_PORT=8896 tests/wp/hardening/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
export TP_WP_PROJECT="${TP_WP_PROJECT:-typedpress-wp-hardening}"
export TP_WP_PORT="${TP_WP_PORT:-8896}"
work="$(mktemp -d)"
cleanup() { "$wp/harness.sh" down >/dev/null; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/app"
cp "$here/typedpress.config.ts" "$work/app/"
"$target/debug/typedpress" build "$work/app" --quiet >/dev/null
"$wp/harness.sh" up --wp-content "$work/app/tp/dist/wp-content" > "$work/harness.json"
# Jetpack, as a site that gets Akismet through it would run: the xmlrpc switch's one exception is its
# connection. Pinned and checked like the platform plugins, into the harness's shared cache.
jetpack="$wp/cache/jetpack.16.4.zip"
if [[ ! -f $jetpack ]]; then
  curl -sSfL -o "$jetpack.$$" https://downloads.wordpress.org/plugin/jetpack.16.4.zip
  printf '%s  %s\n' 7252ef239f6763b6d09bdd5cbbaf6ed52e6e30044e1a48ae8fd10d16b075c9f2 "$jetpack.$$" | sha256sum -c --quiet || { rm -f "$jetpack.$$"; exit 1; }
  mv -f "$jetpack.$$" "$jetpack"
fi
printf '%s  %s\n' 7252ef239f6763b6d09bdd5cbbaf6ed52e6e30044e1a48ae8fd10d16b075c9f2 "$jetpack" | sha256sum -c --quiet
"$wp/harness.sh" wp plugin install /typedpress-cache/jetpack.16.4.zip --activate >/dev/null
# Two runs, in this order: hardening.test.ts ends by deactivating the app.
TP_WP_HARNESS="$work/harness.json" node --test --test-concurrency=1 "$here/schema-lock.test.ts"
TP_WP_HARNESS="$work/harness.json" node --test --test-concurrency=1 "$here/agent-scope.test.ts"
TP_WP_HARNESS="$work/harness.json" node --test --test-concurrency=1 "$here/authors.test.ts"
TP_WP_HARNESS="$work/harness.json" node --test --test-concurrency=1 "$here/hardening.test.ts"
