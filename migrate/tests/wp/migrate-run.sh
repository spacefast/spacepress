#!/usr/bin/env bash
# Run the source, content and user import tests on disposable WordPress sites.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
cd "$repo"
trap '"$repo/tests/wp/harness.sh" down' EXIT
cargo build --locked --workspace -q
"$here/legacy/run.sh"
"$here/legacy/users-run.sh"
"$here/app-migrate/run.sh"
