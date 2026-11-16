#!/usr/bin/env bash
# The migration lanes, each on a fresh stack running its own migrated app. tests/wp/run.sh runs
# them after the main suites; CI runs them in the wp-migrate job so no job nears its time limit.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cd "$repo"
cargo build -q
# Lane M: an original Zero 0.8 site migrated in place, on a fresh stack running the migrated app.
"$here/legacy/run.sh"
# Lane M2: its app users into an user projection.
"$here/legacy/users-run.sh"
# Lane M3: generated application handlers over retained Zero 0.8 SQL tables.
"$here/app-migrate/run.sh"
# Lane M4: a site that ran a 0.3.0 build (before the rename to TypedPress) upgraded to TypedPress in place.
"$here/zero-upgrade/run.sh"
# Lane M5: the same 0.3.0 site served by a build from the store: booting moves no name, inspection lists
# the two upgrades, and initialize runs them.
"$here/zero-upgrade/managed-run.sh"
