#!/usr/bin/env bash
# `zero dev --wp` from an installed binary: a release build made from a throwaway copy of the source,
# which is deleted before the binary runs, so nothing can reach this checkout. The binary runs in a
# temp project with a fresh HOME and no ZERO_WP_HARNESS; it must write its embedded harness to the
# cache dir, boot WordPress with the app, and serve the app's REST API.
#
# Not part of run.sh (a release build per run would tax every local loop); CI runs it as its own job.
# ZERO_WP_PROJECT (default zero-installed) and ZERO_WP_PORT (default 8810) pick the stack.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
export ZERO_WP_PROJECT="${ZERO_WP_PROJECT:-zero-installed}" ZERO_WP_PORT="${ZERO_WP_PORT:-8810}"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"

work="$(mktemp -d)"
home="$work/home" project="$work/project" bin="$work/bin"
down() {
  local script="$home/.cache/zero/wp-harness/wp/harness.sh"
  [[ ! -f $script ]] || bash "$script" down || true
  rm -rf "$work"
}
trap down EXIT

# The source, built where it will be gone by the time the binary runs.
src="$work/src"
mkdir -p "$src/tests" "$bin"
rsync -a --exclude node_modules --exclude target "$repo"/{build.rs,Cargo.toml,Cargo.lock,rust-toolchain,src,runtime} "$src/"
rsync -a --exclude cache --exclude '.*' "$repo/tests/wp" "$src/tests/"
CARGO_TARGET_DIR="$target" cargo build -q --release --locked --manifest-path "$src/Cargo.toml"
cp "$target/release/zero" "$bin/zero"
rm -rf "$src"

mkdir -p "$home" "$project"
cp -R "$repo/examples/pantry/." "$project/"
rm -rf "$project/.zero"
cd "$project"
out="$(env -u ZERO_WP_HARNESS HOME="$home" XDG_CACHE_HOME= \
  ZERO_WP_PLUGIN_CACHE="${ZERO_WP_PLUGIN_CACHE:-$repo/.zero/cache/plugins}" \
  "$bin/zero" dev --wp --port "$ZERO_WP_PORT" 2>&1)" || { echo "$out" >&2; echo 'FAIL: zero dev --wp exited non-zero' >&2; exit 1; }
echo "$out"
grep -q "WordPress is up on http://127.0.0.1:$ZERO_WP_PORT" <<< "$out" || { echo 'FAIL: no "WordPress is up" line' >&2; exit 1; }

# This app (named after its directory) answers, and its collections are public to read: an empty list.
api="http://127.0.0.1:$ZERO_WP_PORT/wp-json/zero/v1"
for path in _schema locations; do
  status=$(curl -s -o "$work/$path.json" -w '%{http_code}' "$api/$path")
  [[ $status == 200 ]] || { cat "$work/$path.json" >&2; echo "FAIL: GET /$path answered $status" >&2; exit 1; }
done
python3 - "$work" <<'CHECK'
import json, sys
schema = json.load(open(sys.argv[1] + "/_schema.json"))["data"]
assert schema["name"] == "project" and schema["target"] == "wp", schema
assert json.load(open(sys.argv[1] + "/locations.json"))["data"] == []
CHECK
echo 'ok - an installed zero binary boots `zero dev --wp` from its embedded harness'
