#!/usr/bin/env bash
# Sealed mode (docs/sealed.md) on real WordPress/MariaDB: the hardening lane's app built with
# `sealed: true` and one declared plugin, on its own stack.
#   FIRST_WP_PROJECT=first-wp-sealed FIRST_WP_PORT=8895 tests/wp/hardening/sealed-run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
export FIRST_WP_PROJECT="${FIRST_WP_PROJECT:-first-wp-sealed}"
export FIRST_WP_PORT="${FIRST_WP_PORT:-8895}"
work="$(mktemp -d)"
cleanup() { "$wp/harness.sh" down >/dev/null; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/app"
# The same app, sealed, declaring Hello Dolly. WordPress's image also ships Akismet and the
# single-file hello.php, which nobody declares.
sed 's/^  globals: { banner },$/  globals: { banner },\n  sealed: true,\n  plugins: { "hello-dolly": "1.7.2" },/' "$here/first.config.ts" > "$work/app/first.config.ts"
grep -q 'sealed: true' "$work/app/first.config.ts"
"$target/debug/first" build "$work/app" --quiet >/dev/null 2>&1
# First's admin, installed but not part of this build (no `admin: true`): staged as the admin lane
# stages it, with the header placeholders the binary substitutes.
admin="$work/app/first/dist/wp-content/plugins/first-admin"
mkdir -p "$admin"
for f in first-admin.php routes.js LICENSE NOTICE readme.txt; do cp "$repo/runtime/admin/$f" "$admin/$f"; done
cp -r "$repo/runtime/admin/lib" "$repo/runtime/admin/build" "$admin/"
version="$(sed -n 's/^version = "\(.*\)"/\1/p' "$repo/Cargo.toml" | head -1)"
read -r wp_floor php_floor < <(python3 -c 'import json,sys;p=json.load(open(sys.argv[1]));print(p["wordpress"],p["php"])' "$repo/tests/fixtures/platform.json")
sed -i "s/{{firstVersion}}/$version/g; s/{{wpVersion}}/$wp_floor/g; s/{{phpVersion}}/$php_floor/g" "$admin/first-admin.php"
"$wp/harness.sh" up --wp-content "$work/app/first/dist/wp-content" > "$work/harness.json"
# What a host has beside the plugins: the build's manifest (its allow-list) and the build loader.
"$wp/harness.sh" wp eval "file_put_contents(WP_CONTENT_DIR . '/first-manifest.json', base64_decode('$(base64 -w0 < "$work/app/first/dist/wp-content/first-manifest.json")'));
  file_put_contents(WP_CONTENT_DIR . '/first-loader.php', base64_decode('$(base64 -w0 < "$repo/runtime/wp-plugin/first-loader.php")'));
  file_put_contents(WP_CONTENT_DIR . '/first-sealed-host.php', base64_decode('$(base64 -w0 < "$here/sealed-host.php")'));" >/dev/null
FIRST_WP_HARNESS="$work/harness.json" FIRST_BIN="$target/debug/first" FIRST_SEALED_APP="$work/app" \
  FIRST_SEALED_HOST=/var/www/html/wp-content/first-sealed-host.php \
  node --test --test-concurrency=1 "$here/sealed.test.ts"
