#!/usr/bin/env bash
# Runs WP-CLI against the test WordPress: tests/wp/wp.sh plugin list
set -euo pipefail
cd "$(dirname "$0")"
export ZERO_WP_PLUGIN_DIR="${ZERO_WP_PLUGIN_DIR:-$PWD/empty-plugin}"
exec docker compose run --rm -T cli wp "$@" 2> >(grep -v "^ Container " >&2)
