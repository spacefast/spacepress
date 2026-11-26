#!/usr/bin/env bash
# Real WordPress/MariaDB proof that a hosted compile serves a complete site: examples/full-site is
# captured with `spacepress sources`, the project is removed, and only `spacepress compile-sources` output is
# installed. Its sp/app/ pages render with their stylesheets and images, its "use client" components
# hydrate and call the action in Chromium, and its route.ts handlers answer outside /wp-json
# (tests/wp/hosted-pages.test.mjs).
#
#   SP_WP_PROJECT=spacepress-wp-pages SP_WP_PORT=8873 tests/wp/hosted-pages-run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
export SP_WP_PROJECT="${SP_WP_PROJECT:-spacepress-wp-pages}"
export SP_WP_PORT="${SP_WP_PORT:-8873}"
app="$(mktemp -d)"
cleanup() { "$here/harness.sh" down; rm -rf "$app"; }
trap cleanup EXIT
rsync -a --exclude .sp --exclude node_modules "$repo/examples/full-site/" "$app/project/"
# Probes beyond the example: undefined optional fields and once() keyed to the request body.
python3 "$here/hosted-pages-probes.py" "$app/project"
"$target/debug/spacepress" sources "$app/project" --out "$app/source"
# The harness installs the pinned platform plugins from a native build's lock; it never serves them.
"$target/debug/spacepress" build "$app/project" --quiet >/dev/null
mkdir -p "$app/content/plugins"
cp "$app/project/sp/dist/wp-content/spacepress-manifest.json" "$app/content/"
rm -rf "$app/project"
"$target/debug/spacepress" compile-sources "$app/source" "$app/compiled" "$app/source"
rsync -a "$app/compiled/plugins/" "$app/content/plugins/"
"$here/harness.sh" up --wp-content "$app/content" > "$app/harness.json"
"$here/harness.sh" wp spacepress migrate > /dev/null
# The signed route reads its secret like any `env()` value: a wp-config constant on this site.
"$here/harness.sh" wp config set FULLSITE_WEBHOOK_SECRET hosted-pages-secret --type=constant > /dev/null
SP_HOSTED_APP="$app" SP_HOSTED_HARNESS="$here/harness.sh" node --test "$here/hosted-pages.test.mjs"
