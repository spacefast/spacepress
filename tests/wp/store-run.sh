#!/usr/bin/env bash
# Real WordPress/MariaDB proof of the build store (docs/decisions/2026-11-07-build-store.md):
# two builds of one app whose action code differs, both installed in one store. A test-only host
# (tests/wp/store/host.php) selects the build per request. Each build initializes once, each answers
# its own action while both are installed, selecting the older build again serves it on the newer
# schema (rollback), and garbage collection removes only what the host's kept builds do not reference.
# Assertions are on HTTP answers, receipts and the store's directories, never on source text.
#
#   ZERO_WP_PROJECT=zero-wp-store ZERO_WP_PORT=8901 tests/wp/store-run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
zero="$target/debug/zero"
export ZERO_WP_PROJECT="${ZERO_WP_PROJECT:-zero-wp-store}"
export ZERO_WP_PORT="${ZERO_WP_PORT:-8901}"
work="$(mktemp -d)"
cleanup() { "$here/harness.sh" down; rm -rf "$work"; }
trap cleanup EXIT
fail() { echo "not ok: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }
wp() { "$here/harness.sh" wp "$@"; }
json() { python3 -c 'import json,sys; v=json.load(sys.stdin)
for k in sys.argv[1].split("."): v=v[int(k)] if isinstance(v,list) else v[k]
print(v if not isinstance(v,(dict,list,bool)) and v is not None else json.dumps(v))' "$1"; }

# The same app, two builds: only the action's returned label differs.
for label in one two; do
  rsync -a --exclude host.php "$here/store/" "$work/$label/storelane/"
  sed -i.bak "s/BUILD_LABEL/$label/" "$work/$label/storelane/zero.config.ts" && rm "$work/$label/storelane/zero.config.ts.bak"
  "$zero" sources "$work/$label/storelane" --out "$work/$label/sources"
done
# The harness installs the pinned platform plugins from a native build's lock; it never serves the build.
"$zero" build "$work/one/storelane" --quiet >/dev/null
mkdir -p "$work/content/plugins"
cp "$here/store/host.php" "$work/content/plugins/zero-store-host.php"
cp "$work/one/storelane/zero/dist/wp-content/zero-manifest.json" "$work/content/"
# The store lives in the bind-mounted plugins directory so the container sees it; ZERO_BUILD_STORE points at it.
store="$work/content/plugins/zero-store"
start=$(date +%s%N)
first=$("$zero" compile-to-store "$work/one/sources" "$store" "$work/one/sources" | json build)
mid=$(date +%s%N)
second=$("$zero" compile-to-store "$work/two/sources" "$store" "$work/two/sources" "$first" | json build)
end=$(date +%s%N)
echo "compile: first $(( (mid - start) / 1000000 )) ms, second $(( (end - mid) / 1000000 )) ms"
[[ $first != "$second" ]] || fail "different action code gives different builds"
[[ $(ls "$store/runtime" | wc -l) -eq 1 ]] || fail "both builds share one runtime tree"
[[ $(ls "$store/app" | wc -l) -eq 2 ]] || fail "each build has its own app tree"
ok "two builds, one runtime tree, two app trees"
runtime=$(ls "$store/runtime")

# Only the platform plugins are installed and activated; the runtime and app come from the store
# through the must-use loader, not as WordPress plugins.
"$here/harness.sh" up --wp-content "$work/content" --platform > "$work/harness.json"
url=$(json url < "$work/harness.json")
"$here/harness.sh" compose exec -T wordpress sh -c "mkdir -p /var/www/html/wp-content/mu-plugins && cp /var/www/html/wp-content/plugins/zero-store-host.php /var/www/html/wp-content/mu-plugins/zero-store-host.php"

action() { curl -sS -X POST -H 'Content-Type: application/json' -H "X-Zero-Build: $1" --data '{}' "$url/wp-json/zero/v1/actions/which"; }
# WP-CLI as the host: select the build before WordPress loads, then call the loader.
host() { local build="$1"; shift; wp --exec="define('ZERO_TEST_BUILD', '$build');" eval "$@"; }
root=/var/www/html/wp-content/plugins/zero-store
initialize() { host "$1" "echo json_encode(Zero\\Loader\\Loader::initialize('$root', '$1'));"; }
gc() { host "$1" "echo json_encode(Zero\\Loader\\Store::gc('$root', json_decode('$2'), $3));"; }

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Zero-Build: $first" --data '{}' "$url/wp-json/zero/v1/actions/which")
[[ $status == 404 ]] || fail "an uninitialized build is not served, got $status"
ok "a build is not served before it initializes"

receipt=$(initialize "$first")
[[ $(json migrations.0 <<< "$receipt") == 0001_init ]] || fail "the first build applies the init migration: $receipt"
[[ $(json seed.notes.created <<< "$receipt") == 1 ]] || fail "the first build seeds one note: $receipt"
[[ $(action "$first" | json data.build) == one ]] || fail "build one answers"
[[ $(action "$first" | json data.notes) == 1 ]] || fail "build one reads the seeded note"
ok "initialize migrates, seeds and marks build one ready"

again=$(initialize "$first")
[[ $again == "$receipt" ]] || fail "a ready build returns its stored receipt: $again"
[[ $(action "$first" | json data.notes) == 1 ]] || fail "a second initialize does not seed twice"
ok "a ready build initializes once"

receipt=$(initialize "$second")
[[ $(json migrations <<< "$receipt") == '[]' ]] || fail "the second build has no new migration: $receipt"
[[ $(json seed.notes.unchanged <<< "$receipt") == 1 ]] || fail "the second seed finds the note unchanged: $receipt"
[[ $(action "$second" | json data.build) == two ]] || fail "build two answers"
[[ $(action "$first" | json data.build) == one ]] || fail "build one still answers its own action"
[[ $(action "$second" | json data.build) == two ]] || fail "build two answers again"
ok "both builds installed, each answers its own action"

# Rollback is the host selecting the older build again: no migrations, same data.
[[ $(action "$first" | json data.notes) == 1 ]] || fail "the older build reads the newer schema's data"
ok "the older build serves after the newer one initialized"

# The host keeps the builds of every version it still serves; here both versions exist.
[[ $(gc "$first" "[\"$first\",\"$second\"]" true) == '[]' ]] || fail "gc keeping both builds removes nothing"
dry=$(gc "$first" "[\"$first\"]" true)
python3 - "$dry" "$second" <<'PY' || fail "dry gc lists build two's manifest, ready marker and app tree: $dry"
import json,sys
removed=json.loads(sys.argv[1]); build=sys.argv[2]
assert sorted(p.split('/')[-2] for p in removed)==['app','build','ready'], removed
assert any(p.endswith(build+'.json') for p in removed)
PY
[[ $(ls "$store/app" | wc -l) -eq 2 ]] || fail "dry gc removes nothing"
[[ $(gc "$first" "[\"$first\"]" false) == "$dry" ]] || fail "gc removes what the dry run listed"
[[ $(ls "$store/app" | wc -l) -eq 1 && $(ls "$store/build" | wc -l) -eq 1 && $(ls "$store/runtime" | wc -l) -eq 1 ]] || fail "gc keeps the kept build's runtime and app"
[[ $(action "$first" | json data.build) == one ]] || fail "the kept build still answers after gc"
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Zero-Build: $second" --data '{}' "$url/wp-json/zero/v1/actions/which")
[[ $status == 404 ]] || fail "a collected build is gone, got $status"
ok "gc removes only what the kept builds do not reference"
