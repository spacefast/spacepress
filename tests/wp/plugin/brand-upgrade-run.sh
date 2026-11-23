#!/usr/bin/env bash
# A site deployed with the pre-release deploy plugin and `push`, taken over by this checkout:
# the new plugin is installed beside the old one (the one manual step the upgrade guide names), the
# old one deactivated, and `spacepress push` deploys the renamed project. The site keeps its build
# store, deploy history and data, the push plans no new migration, and the old build stays a record.
#
#   tests/wp/plugin/brand-upgrade-run.sh [path/to/spacepress]
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
current=$(realpath -- "${1:-$repo/target/debug/spacepress}")
legacy=$(sed -n "s/^const LEGACY_COMMIT = '\([0-9a-f]*\)';/\1/p" "$repo/tests/php/brand_upgrade_test.php")
export SP_WP_PROJECT="${SP_WP_PROJECT:-spacepress-wp-plugin-upgrade}" SP_WP_PORT="${SP_WP_PORT:-8912}"
work=$(mktemp -d)
cleanup() {
	[[ ${SP_WP_KEEP:-0} == 1 ]] && { echo "kept $work" >&2; return; }
	(cd "$work/legacy" 2>/dev/null && TP_WP_PROJECT=$SP_WP_PROJECT TP_WP_PORT=$SP_WP_PORT tests/wp/harness.sh compose exec -T wordpress chown -R "$(id -u):$(id -g)" /var/www/html/wp-content >/dev/null 2>&1; TP_WP_PROJECT=$SP_WP_PROJECT TP_WP_PORT=$SP_WP_PORT tests/wp/harness.sh down >/dev/null 2>&1) || true
	[[ ${SP_WP_KEEP:-0} == 1 ]] && { echo "kept $work" >&2; return; }
	rm -rf -- "$work"
}
trap cleanup EXIT
fail() { echo "FAIL  $*" >&2; exit 1; }
ok() { echo "ok    $*"; }

git -C "$repo" archive "$legacy" | (mkdir "$work/legacy" && tar -x -C "$work/legacy")
mkdir -p "$work/legacy/tests/wp/cache" "$work/content/plugins"
cp -n "$repo"/tests/wp/cache/*.zip "$work/legacy/tests/wp/cache/" 2>/dev/null || true
old_bin="${CARGO_TARGET_DIR:-$repo/target}/legacy-${legacy:0:10}/debug/typedpress"
[[ -x $old_bin ]] || (cd "$work/legacy" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$repo/target}/legacy-${legacy:0:10}" cargo build -q --locked --bin typedpress)
cd "$work/legacy"
export TP_WP_PROJECT=$SP_WP_PROJECT TP_WP_PORT=$SP_WP_PORT
h() { tests/wp/harness.sh "$@"; }
q() { h sql "$1" | tail -n +2; }
receipt=$(h up --bare --wp-content "$work/content" | tail -1)
url=$(jq -r .url <<<"$receipt")
admin="admin:$(jq -r .users.admin.appPassword <<<"$receipt")"
h wp config set FS_METHOD direct >/dev/null

# The pre-release plugin, installed and activated as its guide said, then a push of Pantry.
"$old_bin" plugin --out "$work/old.zip" >/dev/null
h compose cp "$work/old.zip" cli:/tmp/old.zip >/dev/null 2>&1
h wp plugin install /tmp/old.zip --activate >/dev/null
mkdir -p "$work/old" && cp -r examples/pantry "$work/old/pantry"
(cd "$work/old/pantry" && TP_APP_PASSWORD="$admin" "$old_bin" push --site "$url" >/dev/null) || fail "the pre-release push"
curl -sf -u "$admin" -H 'content-type: application/json' -d '{"name":"Milk","slug":"milk","quantity":2,"tags":[]}' "$url/wp-json/typedpress/v1/items" >/dev/null || fail "the pre-release app takes a row"
old_live=$(q "SELECT option_value FROM wp_options WHERE option_name = 'tp_live_build'")
old_history=$(q "SELECT option_value FROM wp_options WHERE option_name = 'tp_deployments'")
ledger=$(q 'SELECT app, id, `sql` FROM wp_tp__migrations ORDER BY id')
[[ -n $old_live && -n $ledger ]] || fail "the pre-release site is deployed"
ok "a site deployed by the pre-release plugin and push"

# The new plugin by hand, the earlier one deactivated (the guide's step), then a push of the renamed project.
"$current" plugin --out "$work/spacepress.zip" >/dev/null
h compose cp "$work/spacepress.zip" cli:/tmp/spacepress.zip >/dev/null 2>&1
h wp plugin install /tmp/spacepress.zip --activate >/dev/null
h wp plugin deactivate typedpress >/dev/null
site=$(curl -sf -u "$admin" "$url/wp-json/spacepress-deploy/v1/site") || fail "the new receiver answers /site"
[[ $(jq -r .live.build <<<"$site") == "$old_live" ]] || fail "the new receiver reads the live build the earlier one stored: $site"
[[ $(jq -r .baseline <<<"$site") == "$old_live" ]] || fail "… and serves it as the baseline"
ok "the new receiver finds the stored builds and history"

mkdir -p "$work/new" && cp -r "$repo/examples/pantry" "$work/new/pantry"
out=$(cd "$work/new/pantry" && SP_APP_PASSWORD="$admin" "$current" push --site "$url" 2>&1) || fail "spacepress push: $out"
new_live=$(q "SELECT option_value FROM wp_options WHERE option_name = 'sp_live_build'")
[[ -n $new_live && $new_live != "$old_live" ]] || fail "push made the new build live: $out"
[[ $(q "SELECT COUNT(*) FROM wp_sp__migrations WHERE kind = 'schema'") == $(wc -l <<<"$ledger") ]] || fail "push applied no new migration: $(q 'SELECT id, kind FROM wp_sp__migrations')"
[[ $(q 'SELECT app, id, `sql` FROM wp_sp__migrations WHERE kind = '"'schema'"' ORDER BY id') == "$ledger" ]] || fail "the ledger keeps every id and SHA-256"
[[ $(curl -sf -u "$admin" "$url/wp-json/spacepress/v1/items" | jq -c '[.data[] | .name]') == '["Milk"]' ]] || fail "the app reads the row the pre-release app wrote"
history=$(q "SELECT option_value FROM wp_options WHERE option_name = 'sp_deployments'")
php -r '$h = unserialize($argv[1]); $o = unserialize($argv[2]); exit(array_slice($h, 0, count($o)) == $o && count($h) === count($o) + 1 ? 0 : 1);' "$history" "$old_history" || fail "the deploy history keeps every earlier entry and adds this push"
[[ -z $(q "SELECT option_name FROM wp_options WHERE option_name IN ('tp_store_key', 'tp_live_build', 'tp_deployments', 'tp_pending_deployments')") ]] || fail "the deploy plugin's earlier options are moved"
ok "spacepress push deploys the renamed project onto the site's own store, ledger and data"

refused=$(curl -s -u "$admin" -H 'content-type: application/json' -d "{\"build\":\"$old_live\"}" "$url/wp-json/spacepress-deploy/v1/live")
[[ $refused == *"pre-release"* ]] || fail "making the pre-release build live again is refused with the reason: $refused"
ok "the pre-release build stays a record and is never mounted"
