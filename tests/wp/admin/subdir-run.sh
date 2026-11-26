#!/usr/bin/env bash
# Lane A, run by ../run.sh after the main suites on the same stack: the spacepress-admin plugin on a
# WordPress installed below the origin root (http://host/blog/), where every URL the plugin
# derives (its mount, wp-admin, login) carries the sub-path. Until `spacepress build` emits the plugin,
# this lane stages its PHP next to the built app the way the binary will, substituting the same
# header placeholders. Needs ../run.sh's build in ../.wp-content.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
version="$(sed -n 's/^version = "\(.*\)"/\1/p' "$repo/Cargo.toml" | head -1)"
read -r wp_floor php_floor < <(python3 -c 'import json;p=json.load(open("'"$repo"'/tests/fixtures/platform.json"));print(p["wordpress"],p["php"])')

content="$wp/.wp-content-admin"
mkdir -p "$content"
rsync -a --delete --exclude 'plugins/spacepress-admin' "$wp/.wp-content/" "$content/"
plugin="$content/plugins/spacepress-admin"
rm -rf "$plugin"; mkdir -p "$plugin"
for f in spacepress-admin.php routes.js classic-screen.js LICENSE NOTICE readme.txt; do cp "$repo/runtime/admin/$f" "$plugin/$f"; done
cp -r "$repo/runtime/admin/lib" "$plugin/lib"
cp -r "$repo/runtime/admin/build" "$plugin/build"
sed -i "s/{{spVersion}}/$version/g; s/{{wpVersion}}/$wp_floor/g; s/{{phpVersion}}/$php_floor/g" "$plugin/spacepress-admin.php"

"$wp/harness.sh" down
"$wp/harness.sh" up --wp-content "$content" --path blog > "$wp/.harness-admin.json"
"$wp/harness.sh" wp plugin activate spacepress-admin >/dev/null
# Polylang sends the first wp-admin page load after its activation to its setup wizard; the suite
# below is that first load, and it wants the page it asked for.
"$wp/harness.sh" wp transient delete pll_activation_redirect >/dev/null
SP_WP_HARNESS="$wp/.harness-admin.json" node --test --test-concurrency=1 "$here/subdir.test.ts"

SP_WP_HARNESS="$wp/.harness-admin.json" \
SP_ADMIN_BROWSER_OUTPUT="${SP_ADMIN_BROWSER_OUTPUT:+$SP_ADMIN_BROWSER_OUTPUT/subdirectory}" \
SP_ADMIN_BROWSER_RUN=subdirectory \
"$wp/admin/browser-run.sh"
