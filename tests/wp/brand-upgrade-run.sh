#!/usr/bin/env bash
# A Pantry site deployed before the rename, upgraded on WordPress + MariaDB (tests/wp/harness.sh).
#
#   tests/wp/brand-upgrade-run.sh [path/to/spacepress]
#   SP_WP_DB=mysql:8.4 tests/wp/brand-upgrade-run.sh ...   the same on MySQL instead of MariaDB 11.4
#
# Builds the example with the compiler of LEGACY_COMMIT (tests/php/brand_upgrade_test.php), boots it,
# writes data through that site's own REST API, then copies in this checkout's build and switches the
# plugins with WP-CLI as a site owner would. Checks that every row, hash, revision, scheduled action
# and foreign key is there under the current names, that the app reads it back, that another
# plugin's look-alike option is untouched, and that loading the site again changes nothing.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
current=$(realpath -- "${1:-$repo/target/debug/spacepress}")
legacy=$(sed -n "s/^const LEGACY_COMMIT = '\([0-9a-f]*\)';/\1/p" "$repo/tests/php/brand_upgrade_test.php")
work=$(mktemp -d)
export SP_WP_PROJECT="${SP_WP_PROJECT:-spacepress-wp-brand-upgrade}" SP_WP_PORT="${SP_WP_PORT:-8911}"
old="${legacy:0:10}"
cleanup() {
	(cd "$work/legacy" 2>/dev/null && TP_WP_PROJECT=$SP_WP_PROJECT TP_WP_PORT=$SP_WP_PORT tests/wp/harness.sh down >/dev/null 2>&1) || true
	rm -rf -- "$work"
}
[[ ${SP_WP_KEEP:-0} == 1 ]] || trap cleanup EXIT

# The site as the earlier release built and ran it: its compiler, its harness.
git -C "$repo" archive "$legacy" | (mkdir "$work/legacy" && tar -x -C "$work/legacy")
mkdir -p "$work/legacy/tests/wp/cache"
if [[ -n ${SP_WP_DB:-} ]]; then
	# Another server in this throwaway copy of the earlier harness: its compose file and its SQL client.
	sed -i -e "s#image: mariadb:11.4#image: $SP_WP_DB#" -e 's#MARIADB_#MYSQL_#' \
		-e 's#\["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"\]#["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-ptypedpress-test-root"]#' "$work/legacy/tests/wp/compose.yml"
	sed -i 's#exec -T db mariadb #exec -T db mysql #' "$work/legacy/tests/wp/harness.sh"
fi
cp -n "$repo"/tests/wp/cache/*.zip "$work/legacy/tests/wp/cache/" 2>/dev/null || true
(cd "$work/legacy" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$repo/target}/legacy-$old" cargo build -q --locked --bin "typedpress")
first="${CARGO_TARGET_DIR:-$repo/target}/legacy-$old/debug/typedpress"
"$first" build "$work/legacy/examples/pantry" --out "$work/site" --quiet
cd "$work/legacy"
export TP_WP_PROJECT=$SP_WP_PROJECT TP_WP_PORT=$SP_WP_PORT
receipt=$(tests/wp/harness.sh up --wp-content "$work/site" | tail -1)
admin="admin:$(jq -r .users.admin.appPassword <<<"$receipt")"
url=$(jq -r .url <<<"$receipt")
h() { tests/wp/harness.sh "$@"; }
api() { local method=$1 path=$2; shift 2; curl -sf -u "$admin" -X "$method" -H 'content-type: application/json' "$url/wp-json/$path" "$@"; }

api POST typedpress/v1/locations -d '{"name":"Fridge","kind":"fridge"}' >/dev/null
api POST typedpress/v1/items -d '{"name":"Milk","slug":"milk","quantity":2,"locationId":1,"tags":[]}' >/dev/null
api PATCH typedpress/v1/items/1 -d '{"quantity":3}' >/dev/null
h wp option add tp_unrelated_plugin_setting 'not ours' >/dev/null
q() { h sql "$1" | tail -n +2; }
ledger_before=$(q 'SELECT app, id, kind, `sql` FROM wp_tp__migrations ORDER BY id')
revisions_before=$(q 'SELECT collection, pk, version, op FROM wp_tp__revisions ORDER BY id')
actions_before=$(q 'SELECT a.action_id, a.status FROM wp_actionscheduler_actions a ORDER BY a.action_id')

# This checkout's build beside the earlier one, then the plugins switched without loading the old code.
"$current" build "$repo/examples/pantry" --out "$work/new" --quiet
for slug in spacepress-runtime spacepress-identity spacepress-admin spacepress-app-pantry; do
	cp -r "$work/new/plugins/$slug" "$work/site/plugins/"
done
old_plugins=typedpress-runtime,typedpress-identity,typedpress-app-pantry,typedpress-admin
# A first attempt that stopped part way, as a request killed mid-move leaves it: the marker says
# started, the tables and the runtime's options are moved, and one foreign key has its new copy but
# still its old one. The next request has to finish from there.
h sql "UPDATE wp_options SET option_name = 'sp_runtime_tables' WHERE option_name = 'tp_runtime_tables'" >/dev/null
h sql "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('sp_brand_upgrade', 'started', 'on')" >/dev/null
h sql "RENAME TABLE $(q "SHOW TABLES LIKE 'wp\_tp\_%'" | sed 's/.*/`&` TO `&`/; s/`wp_tp_\([^`]*\)`$/`wp_sp_\1`/' | paste -sd,)" >/dev/null
rules=$(q "SELECT CONCAT('ON DELETE ', DELETE_RULE, ' ON UPDATE ', UPDATE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'tp_items_locationId_fk'")
h sql "ALTER TABLE wp_sp_items ADD CONSTRAINT sp_items_locationId_fk FOREIGN KEY (locationId) REFERENCES wp_sp_locations (id) $rules" >/dev/null
h wp plugin activate spacepress-runtime spacepress-identity spacepress-app-pantry spacepress-admin --skip-plugins="$old_plugins" >/dev/null
# The earlier plugins go inactive; WP-CLI reports any it can't deactivate.
read -r -a old_list <<<"${old_plugins//,/ }"
h wp plugin deactivate "${old_list[@]}" --skip-plugins="$old_plugins" >/dev/null

echo "on $(q 'SELECT VERSION()')"
fail=0
check() { if [[ "$2" == "$3" ]]; then echo "ok    $1"; else echo "FAIL  $1"; echo "      expected: $3"; echo "      actual:   $2"; fail=1; fi; }
check 'the upgrade is recorded' "$(q "SELECT option_value FROM wp_options WHERE option_name = 'sp_brand_upgrade'")" 1
check 'no table keeps the earlier name' "$(q "SHOW TABLES LIKE 'wp\\_tp\\_%'")" ''
check 'the ledger keeps each file and its SHA-256' "$(q "SELECT app, id, kind, \`sql\` FROM wp_sp__migrations WHERE kind = 'schema' ORDER BY id")" "$ledger_before"
check '… and records the move once' "$(q "SELECT id, actor FROM wp_sp__migrations WHERE kind = 'data'")" "$(printf 'brand-upgrade-v1\tspacepress')"
check 'the revisions keep their chain' "$(q 'SELECT collection, pk, version, op FROM wp_sp__revisions ORDER BY id')" "$revisions_before"
check 'every scheduled action is kept' "$(q 'SELECT a.action_id, a.status FROM wp_actionscheduler_actions a WHERE a.action_id IN (SELECT action_id FROM wp_actionscheduler_actions) ORDER BY a.action_id' | head -n "$(wc -l <<<"$actions_before")")" "$actions_before"
check '… under the current hooks and groups' "$(q "SELECT COUNT(*) FROM wp_actionscheduler_actions a JOIN wp_actionscheduler_groups g USING (group_id) WHERE a.hook LIKE 'tp\\_%' OR a.hook LIKE 'typedpress.%' OR g.slug LIKE 'typedpress%'")" 0
check 'foreign keys keep their targets under the current names' "$(q "SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY CONSTRAINT_NAME")" \
	"$(printf 'sp_items_locationId_fk\twp_sp_items\twp_sp_locations\tSET NULL\nsp_shopping_list_itemId_fk\twp_sp_shopping_list\twp_sp_items\tCASCADE')"
check 'exactly the current plugins are active, each once' "$(h wp option get active_plugins --format=json --skip-plugins | jq -c 'sort')" \
	'["action-scheduler/action-scheduler.php","mcp-adapter/mcp-adapter.php","secure-custom-fields/secure-custom-fields.php","spacepress-admin/spacepress-admin.php","spacepress-app-pantry/spacepress-app-pantry.php","spacepress-identity/spacepress-identity.php","spacepress-runtime/spacepress-runtime.php","two-factor/two-factor.php"]'
check 'another plugin'"'"'s option is untouched' "$(q "SELECT option_value FROM wp_options WHERE option_name = 'tp_unrelated_plugin_setting'")" 'not ours'
check 'the app reads its row back' "$(api GET spacepress/v1/items/1 | jq -c '[.data.name, .data.quantity, .data.locationId]')" '["Milk",3,1]'
check 'a foreign key still acts: deleting the location empties the reference' "$(api DELETE spacepress/v1/locations/1 >/dev/null; q 'SELECT IFNULL(locationId, "null") FROM wp_sp_items WHERE id = 1')" null
check 'nothing is pending to migrate' "$(h wp eval 'echo json_encode(\SpacePress\Wp\Runtime::plugin()->pendingMigrations());')" '[]'
# Loaded once more (a page and the CLI) before the snapshot: what any request writes (the install
# marker, a theme's first mods) is written, so what follows compares the upgrade alone.
curl -sf "$url/" >/dev/null || true
snapshot() { q 'SELECT option_name, option_value FROM wp_options WHERE option_name NOT IN ("cron", "sp_installed") AND option_name NOT LIKE "\_transient%" AND option_name NOT LIKE "\_site\_transient%" ORDER BY option_name'; q 'SHOW TABLES'; q 'SELECT * FROM wp_sp__migrations ORDER BY id'; }
before_again=$(snapshot)
curl -sf "$url/" >/dev/null || true
h wp eval 'var_export(\SpacePress\Wp\BrandUpgrade::ensure(\SpacePress\Wp\Runtime::plugin()->schema));' >/dev/null
check 'a second load and ensure change nothing' "$(snapshot)" "$before_again"
# A foreign key's current name taken by another table in the database (MySQL names constraints per
# database) stops a move before any change.
h sql 'CREATE TABLE wp_tp_probe_a (id INT PRIMARY KEY) ENGINE=InnoDB; CREATE TABLE wp_tp_probe_b (a INT, CONSTRAINT tp_probe_fk FOREIGN KEY (a) REFERENCES wp_tp_probe_a (id)) ENGINE=InnoDB; CREATE TABLE wp_other_probe (a INT, CONSTRAINT sp_probe_fk FOREIGN KEY (a) REFERENCES wp_tp_probe_a (id)) ENGINE=InnoDB' >/dev/null
check 'a foreign key name taken elsewhere in the database is a conflict' "$(h wp eval 'echo json_encode(\SpacePress\Wp\BrandUpgrade::conflicts(new \SpacePress\Wp\Connection($GLOBALS["wpdb"]), ["tables" => ["wp_tp_probe_b" => "wp_sp_probe_b"], "options" => [], "meta" => [], "sitemeta" => [], "postTypes" => [], "taxonomies" => [], "private" => null, "renamedApp" => []]));')" \
	'["foreign key sp_probe_fk on wp_other_probe (wanted by wp_tp_probe_b)"]'
h sql 'DROP TABLE wp_other_probe, wp_tp_probe_b, wp_tp_probe_a' >/dev/null
exit $fail
