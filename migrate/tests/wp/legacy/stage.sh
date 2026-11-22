#!/usr/bin/env bash
# Seed the running harness stack the way ORIGINAL Zero stored content: copy its kernel (from a
# monorepo checkout, ZERO_ORIGINAL) and the captured release into the container, then create
# content through that kernel (seed.php). Prints seed.php's JSON. Needs TP_WP_PROJECT like harness.sh.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${ZERO_ORIGINAL:?set ZERO_ORIGINAL to the original monorepo checkout}"
compose() { "$wp/harness.sh" compose "$@"; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$ZERO_ORIGINAL" archive --format=tar HEAD runtime/engine/wordpress runtime/engine/shared | tar -x -C "$work"
# The original runtime stored a release under its revision, with the artifact's file digest beside it.
revision="$(php -r '$m = require $argv[1]; echo $m["revision"];' "$here/content-model.php")"
mkdir -p "$work/release" && cp "$here/content-model.php" "$work/release/"
echo "sha256:$(sha256sum "$here/content-model.php" | cut -d' ' -f1)" > "$work/release/content-model.sha256"
content=/var/www/html/wp-content
release="$content/.stattic/storage/spaces/legacy-space/content-model/releases/${revision#sha256:}"
compose exec -T cli sh -c "rm -rf $content/legacy-engine $content/.stattic && mkdir -p $content/mu-plugins $(dirname "$release")"
compose cp "$work/runtime/engine" "cli:$content/legacy-engine" >/dev/null 2>&1
compose cp "$work/release" "cli:$release" >/dev/null 2>&1
compose cp "$here/kernel.php" "cli:$content/mu-plugins/typedpress-legacy-kernel.php" >/dev/null 2>&1
compose cp "$here/seed.php" cli:/tmp/typedpress-legacy-seed.php >/dev/null 2>&1
compose exec -T -e "ZERO_LEGACY_RELEASE=$release" cli wp eval-file /tmp/typedpress-legacy-seed.php
