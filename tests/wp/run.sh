#!/usr/bin/env bash
# The WordPress lane (design §9.2): build the test app (tests/wp/app = examples/blog + test hooks) and
# the blog's typed client, boot a fresh WordPress with the plugin, run every tests/wp/*.test.ts, tear
# down. `cargo test` never depends on this. ZERO_WP_PORT (default 8790) picks the port;
# ZERO_WP_KEEP=1 leaves the stack up afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cd "$repo"

cargo build -q
zero=target/debug/zero
"$zero" build examples/blog --target wp --quiet >/dev/null       # the typed client the scenario uses
"$zero" build tests/wp/app --target wp --quiet >/dev/null
# Stage into a stable dir: the build replaces its output dir, which would orphan a bind mount.
mkdir -p tests/wp/.plugin/zero-blog
rsync -a --delete tests/wp/app/.zero/wp/zero-blog/ tests/wp/.plugin/zero-blog/

cleanup() { [[ ${ZERO_WP_KEEP:-0} == 1 ]] || "$here/harness.sh" down; }
trap cleanup EXIT
"$here/harness.sh" down
"$here/harness.sh" up --plugin "$here/.plugin/zero-blog" > "$here/.harness.json"
cat "$here/.harness.json"

node --test --test-concurrency=1 "$here"/*.test.ts
