#!/usr/bin/env bash
# Sealed mode (docs/sealed.md) on real WordPress/MariaDB: the hardening lane's app built with
# `sealed: true` and one declared plugin, on its own stack.
#   TP_WP_PROJECT=typedpress-wp-sealed TP_WP_PORT=8895 tests/wp/hardening/sealed-run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
export TP_WP_PROJECT="${TP_WP_PROJECT:-first-wp-sealed}"
export TP_WP_PORT="${TP_WP_PORT:-8895}"
work="$(mktemp -d)"
cleanup() { "$wp/harness.sh" down >/dev/null; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/app"
# The same app, sealed, declaring Hello Dolly. WordPress's image also ships Akismet and the
# single-file hello.php, which nobody declares.
# `admin: false`: TypedPress Admin is on by default, and this run installs it beside the build instead.
sed 's/^  name: "hardening-lane",$/  name: "hardening-lane",\n  sealed: true,\n  admin: false,\n  plugins: { "hello-dolly": "1.7.2" },/' "$here/typedpress.config.ts" > "$work/app/typedpress.config.ts"
grep -q 'sealed: true' "$work/app/typedpress.config.ts"
grep -q 'admin: false' "$work/app/typedpress.config.ts"
"$target/debug/typedpress" build "$work/app" --quiet >/dev/null 2>&1
# TypedPress's admin, installed but not part of this build (`admin: false`): staged as the admin lane
# stages it, with the header placeholders the binary substitutes.
admin="$work/app/tp/dist/wp-content/plugins/typedpress-admin"
mkdir -p "$admin"
for f in typedpress-admin.php routes.js LICENSE NOTICE readme.txt; do cp "$repo/runtime/admin/$f" "$admin/$f"; done
cp -r "$repo/runtime/admin/lib" "$repo/runtime/admin/build" "$admin/"
version="$(sed -n 's/^version = "\(.*\)"/\1/p' "$repo/Cargo.toml" | head -1)"
read -r wp_floor php_floor < <(python3 -c 'import json,sys;p=json.load(open(sys.argv[1]));print(p["wordpress"],p["php"])' "$repo/tests/fixtures/platform.json")
sed -i "s/{{tpVersion}}/$version/g; s/{{wpVersion}}/$wp_floor/g; s/{{phpVersion}}/$php_floor/g" "$admin/typedpress-admin.php"
# A plugin in the directory a sealed site never runs, with a route that answers a post's stored
# content after an item-level check only, as the Block Data API does.
denied="$work/app/tp/dist/wp-content/plugins/vip-block-data-api"
mkdir -p "$denied"
cp "$here/sealed-denied.php" "$denied/vip-block-data-api.php"
"$wp/harness.sh" up --wp-content "$work/app/tp/dist/wp-content" > "$work/harness.json"
# What a host has beside the plugins: the build's manifest (its allow-list) and the build loader.
"$wp/harness.sh" wp eval "file_put_contents(WP_CONTENT_DIR . '/typedpress-manifest.json', base64_decode('$(base64 -w0 < "$work/app/tp/dist/wp-content/typedpress-manifest.json")'));
  file_put_contents(WP_CONTENT_DIR . '/typedpress-loader.php', base64_decode('$(base64 -w0 < "$repo/runtime/wp-plugin/typedpress-loader.php")'));
  file_put_contents(WP_CONTENT_DIR . '/typedpress-sealed-host.php', base64_decode('$(base64 -w0 < "$here/sealed-host.php")'));" >/dev/null
TP_WP_HARNESS="$work/harness.json" TP_BIN="$target/debug/typedpress" TP_SEALED_APP="$work/app" \
  TP_SEALED_HOST=/var/www/html/wp-content/typedpress-sealed-host.php \
  node --test --test-concurrency=1 "$here/sealed.test.ts"
