#!/usr/bin/env bash
# WP-CLI inside the test WordPress: tests/wp/wp.sh plugin list
exec "$(dirname "$0")/harness.sh" wp "$@"
