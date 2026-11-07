#!/usr/bin/env bash
# Real WordPress/MariaDB proof of the build store (docs/decisions/2026-11-07-build-store.md):
# two builds of one app whose action code differs, both installed in one store under wp-content.
# Each answers its own action while both are present; deploy and rollback move the current build;
# garbage collection keeps only what the kept builds reference. Assertions are on HTTP answers,
# WP-CLI receipts and the store's directories, never on source text.
#
#   ZERO_WP_PROJECT=zero-wp-store ZERO_WP_PORT=8899 tests/wp/store-run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
zero="$target/debug/zero"
export ZERO_WP_PROJECT="${ZERO_WP_PROJECT:-zero-wp-store}"
export ZERO_WP_PORT="${ZERO_WP_PORT:-8899}"
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
  rsync -a "$here/store/" "$work/$label/storelane/"
  sed -i.bak "s/BUILD_LABEL/$label/" "$work/$label/storelane/zero.config.ts" && rm "$work/$label/storelane/zero.config.ts.bak"
  "$zero" sources "$work/$label/storelane" --out "$work/$label/sources"
done
# The harness installs the pinned platform plugins from a native build's lock; it never serves the build.
"$zero" build "$work/one/storelane" --quiet >/dev/null
mkdir -p "$work/content/plugins" "$work/content/zero"
cp "$work/one/storelane/.zero/wp-content/zero-manifest.json" "$work/content/"
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

"$here/harness.sh" up --wp-content "$work/content" --bare > "$work/harness.json"
url=$(json url < "$work/harness.json")
# Platform plugins only; the runtime and app are not WordPress plugins here.
for slug in secure-custom-fields action-scheduler mcp-adapter; do
  zip=$(ls "$here/cache/$slug".*.zip | head -1)
  wp plugin install "/zero-cache/$(basename "$zip")" --activate >/dev/null
done
wp config set ZERO_BUILD_STORE /var/www/html/wp-content/plugins/zero-store --type=constant >/dev/null
wp eval 'wp_mkdir_p(WPMU_PLUGIN_DIR);' >/dev/null
"$here/harness.sh" compose exec -T wordpress sh -c "cp /var/www/html/wp-content/plugins/zero-store/runtime/$runtime/zero-loader.php /var/www/html/wp-content/mu-plugins/zero-loader.php"

action() { curl -sS -X POST -H 'Content-Type: application/json' --data '{}' "$url/wp-json/zero/v1/actions/which"; }

# Nothing deployed: WordPress serves without an app.
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' "$url/wp-json/zero/v1/actions/which")
[[ $status == 404 ]] || fail "no build deployed answers 404, got $status"
ok "an empty store mounts nothing"

deploy=$(wp zero deploy "$first")
[[ $(json data.build <<< "$deploy") == "$first" ]] || fail "deploy receipt names the build: $deploy"
[[ $(json data.migrations.0 <<< "$deploy") == 0001_init ]] || fail "first deploy applies the init migration: $deploy"
[[ $(json data.seed.notes.created <<< "$deploy") == 1 ]] || fail "first deploy seeds one note: $deploy"
[[ $(action | json data.build) == one ]] || fail "build one answers after deploy"
[[ $(action | json data.notes) == 1 ]] || fail "build one reads the seeded note"
ok "deploy initializes, seeds and serves build one"

# Initializing again returns the stored receipt without seeding twice.
again=$(wp zero deploy "$first")
[[ $(json data.seed.notes.created <<< "$again") == 1 ]] || fail "a repeated deploy returns the stored receipt: $again"
[[ $(action | json data.notes) == 1 ]] || fail "a repeated deploy does not seed twice"
ok "a ready build initializes once"

deploy=$(wp zero deploy "$second")
[[ $(json data.migrations <<< "$deploy") == '[]' ]] || fail "the second build has no new migration: $deploy"
[[ $(json data.seed.notes.unchanged <<< "$deploy") == 1 ]] || fail "the second seed finds the note unchanged: $deploy"
[[ $(action | json data.build) == two ]] || fail "build two answers after deploy"
ok "deploy moves the site to build two"

# Both builds are installed; each request mounts exactly the one it names.
wp config set ZERO_BUILD "$first" --type=constant >/dev/null
[[ $(action | json data.build) == one ]] || fail "build one still answers its own action while two is current"
wp config delete ZERO_BUILD --type=constant >/dev/null
[[ $(action | json data.build) == two ]] || fail "build two answers again"
ok "both builds installed, each answers its own action"

rollback=$(wp zero rollback)
[[ $(json data.build <<< "$rollback") == "$first" ]] || fail "rollback returns to build one: $rollback"
[[ $(action | json data.build) == one ]] || fail "build one answers after rollback"
[[ $(action | json data.notes) == 1 ]] || fail "rollback keeps the data"
ok "rollback serves build one without migrating"

dry=$(wp zero gc --history=0 --dry-run)
[[ $(json data.removed <<< "$dry" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))') == 2 ]] || fail "dry gc lists build two's manifest, ready marker and app: $dry"
[[ $(ls "$store/app" | wc -l) -eq 2 ]] || fail "dry gc removes nothing"
gc=$(wp zero gc --history=0)
removed=$(json data.removed <<< "$gc")
python3 - "$removed" "$second" <<'PY' || fail "gc removes build two's manifest, ready marker and app tree: $removed"
import json,sys
removed=json.loads(sys.argv[1]); build=sys.argv[2]
kinds=sorted(p.split('/')[-2] for p in removed)
assert kinds==['app','build','ready'], kinds
assert any(p.endswith(build+'.json') for p in removed)
PY
[[ $(ls "$store/app" | wc -l) -eq 1 && $(ls "$store/build" | wc -l) -eq 1 && $(ls "$store/runtime" | wc -l) -eq 1 ]] || fail "gc keeps the current build's runtime and app"
[[ $(action | json data.build) == one ]] || fail "the current build still answers after gc"
ok "gc removes only what the kept builds do not reference"
