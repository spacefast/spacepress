#!/usr/bin/env bash
# Real WordPress/MariaDB proof that a hosted compile serves a complete site: examples/full-site is
# captured with `zero sources`, the project is removed, and only `zero compile-sources` output is
# installed. TSX pages render, the island hydrates and calls its action in Chromium, and the custom
# HTTP routes answer outside /wp-json (tests/wp/hosted-pages.test.mjs).
#
#   ZERO_WP_PROJECT=zero-wp-pages ZERO_WP_PORT=8873 tests/wp/hosted-pages-run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
export ZERO_WP_PROJECT="${ZERO_WP_PROJECT:-zero-wp-pages}"
export ZERO_WP_PORT="${ZERO_WP_PORT:-8873}"
app="$(mktemp -d)"
cleanup() { "$here/harness.sh" down; rm -rf "$app"; }
trap cleanup EXIT
rsync -a --exclude .zero --exclude node_modules "$repo/examples/full-site/" "$app/project/"
# Probes beyond the example: undefined optional fields and once() keyed to the request body.
python3 "$here/hosted-pages-probes.py" "$app/project/zero.config.ts"
"$target/debug/zero" sources "$app/project" --out "$app/source"
# The harness installs the pinned platform plugins from a native build's lock; it never serves them.
"$target/debug/zero" build "$app/project" --quiet >/dev/null
mkdir -p "$app/content/plugins"
cp "$app/project/.zero/wp-content/zero-manifest.json" "$app/content/"
rm -rf "$app/project"
"$target/debug/zero" compile-sources "$app/source" "$app/compiled" "$app/source"
rsync -a "$app/compiled/plugins/" "$app/content/plugins/"
"$here/harness.sh" up --wp-content "$app/content" > "$app/harness.json"
"$here/harness.sh" wp zero migrate > /dev/null
"$here/harness.sh" wp plugin activate zero-pages-fullsite > /dev/null
# The signed route reads its secret like any `env()` value: a wp-config constant on this site.
"$here/harness.sh" wp config set FULLSITE_WEBHOOK_SECRET hosted-pages-secret --type=constant > /dev/null
ZERO_HOSTED_APP="$app" ZERO_HOSTED_HARNESS="$here/harness.sh" node --test "$here/hosted-pages.test.mjs"
