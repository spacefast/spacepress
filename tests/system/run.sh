#!/usr/bin/env bash
# The system suite: examples/site end to end. Boots a fresh WordPress that has users and nothing
# else; tests/system/wp.test.ts installs the `typedpress build` artifact into it as a site
# owner would and walks the whole journey and plugin lifecycle. The tests build their own copies of
# the example under tests/system/.work, so the committed example is never rewritten. Then a second fresh WordPress
# holds an original Zero 0.8 site, and legacy.test.ts moves it onto TypedPress as the migration
# guide says (one TypedPress app per site, so it gets its own). A third holds examples/blog, whose
# committed Markdown posts sync in.
#
# TP_WP_PROJECT (default typedpress-system) and TP_WP_PORT (default 8809) pick the stack;
# TP_WP_KEEP=1 leaves it up afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cd "$repo"
export TP_WP_PROJECT="${TP_WP_PROJECT:-typedpress-system}" TP_WP_PORT="${TP_WP_PORT:-8809}"
# Every build of the example shares one checksum-verified download cache for the platform plugins.
export TP_WP_PLUGIN_CACHE="${TP_WP_PLUGIN_CACHE:-$repo/.tp/cache/plugins}"

cargo build -q
# The committed client and migrations must be what this compiler produces: the journey imports them.
"${CARGO_TARGET_DIR:-target}/debug/typedpress" build examples/site --out "$here/.work/check" --quiet >/dev/null
if [[ -n $(git status --porcelain -- examples/site) ]]; then
  git status --short -- examples/site >&2
  echo 'examples/site is stale: commit the output of `typedpress build examples/site`' >&2
  exit 1
fi

harness="$repo/tests/wp/harness.sh"
cleanup() { [[ ${TP_WP_KEEP:-0} == 1 ]] || "$harness" down; }
trap cleanup EXIT
"$harness" down
rm -rf "$here/.wp-content" && mkdir -p "$here/.wp-content/plugins"
"$harness" up --wp-content "$here/.wp-content" --bare > "$here/.harness.json"
cat "$here/.harness.json"

node --test --test-concurrency=1 "$here"/wp.test.ts

# The original site: a fresh WordPress holding the rows the original kernel wrote
# (tests/wp/legacy/site.json). legacy.test.ts builds and installs the new app's plugins.
"$harness" down
rm -rf "$here/.wp-content-legacy" && mkdir -p "$here/.wp-content-legacy/plugins"
"$harness" up --wp-content "$here/.wp-content-legacy" --bare > "$here/.harness-legacy.json"
legacy="$repo/tests/wp/legacy"
"$harness" wp eval "file_put_contents('/tmp/typedpress-legacy-site.json', stream_get_contents(STDIN));" < "$legacy/site.json"
"$harness" wp eval "file_put_contents('/tmp/typedpress-legacy-replay.php', stream_get_contents(STDIN));" < "$legacy/replay.php"
"$harness" wp eval-file /tmp/typedpress-legacy-replay.php /tmp/typedpress-legacy-site.json >/dev/null
node --test --test-concurrency=1 "$here"/legacy.test.ts

# The blog example on its own fresh WordPress: its committed Markdown posts sync in (§5.8).
"$harness" down
rm -rf "$here/.wp-content-blog" && mkdir -p "$here/.wp-content-blog/plugins"
"$harness" up --wp-content "$here/.wp-content-blog" --bare > "$here/.harness-blog.json"
node --test --test-concurrency=1 "$here"/blog.test.ts
