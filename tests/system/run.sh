#!/usr/bin/env bash
# The system suite: examples/site end to end. Boots a fresh WordPress that has users and nothing
# else; tests/system/wp.test.ts installs the `spacepress build` artifact into it as a site
# owner would and walks the whole journey and plugin lifecycle. The tests build their own copies of
# the example under tests/system/.work. A second site serves examples/blog with its Markdown posts.
#
# SP_WP_PROJECT (default spacepress-system) and SP_WP_PORT (default 8809) pick the stack;
# SP_WP_KEEP=1 leaves it up afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cd "$repo"
export SP_WP_PROJECT="${SP_WP_PROJECT:-spacepress-system}" SP_WP_PORT="${SP_WP_PORT:-8809}"
# Every build of the example shares one checksum-verified download cache for the platform plugins.
export SP_WP_PLUGIN_CACHE="${SP_WP_PLUGIN_CACHE:-$repo/.sp/cache/plugins}"

cargo build -q
# The committed client and migrations must be what this compiler produces: the journey imports them.
"${CARGO_TARGET_DIR:-target}/debug/spacepress" build examples/site --out "$here/.work/check" --quiet >/dev/null
if [[ -n $(git status --porcelain -- examples/site) ]]; then
  git status --short -- examples/site >&2
  echo 'examples/site is stale: commit the output of `spacepress build examples/site`' >&2
  exit 1
fi

harness="$repo/tests/wp/harness.sh"
cleanup() { [[ ${SP_WP_KEEP:-0} == 1 ]] || "$harness" down; }
trap cleanup EXIT
"$harness" down
rm -rf "$here/.wp-content" && mkdir -p "$here/.wp-content/plugins"
"$harness" up --wp-content "$here/.wp-content" --bare > "$here/.harness.json"
cat "$here/.harness.json"

node --test --test-concurrency=1 "$here"/wp.test.ts

# The blog example on its own fresh WordPress: its committed Markdown posts sync in (§5.8).
"$harness" down
rm -rf "$here/.wp-content-blog" && mkdir -p "$here/.wp-content-blog/plugins"
"$harness" up --wp-content "$here/.wp-content-blog" --bare > "$here/.harness-blog.json"
node --test --test-concurrency=1 "$here"/blog.test.ts
