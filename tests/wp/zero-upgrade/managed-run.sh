#!/usr/bin/env bash
# The 0.3 stored-name upgrade on a MANAGED site (a build mounted from the store): the same database a
# 0.3.0 site left (fixture/site.sql, as run.sh uses it), the same app built with this compiler.
# Booting the managed build moves no name; `Loader::inspect()` lists the two upgrades as pending
# `names` steps and writes nothing; an upgrade interrupted between two renames shows as `started`;
# `Loader::initialize` runs both before migrations and the site serves TypedPress's API.
# Assertions are on the database and HTTP answers, never on source text.
#
#   TP_WP_PROJECT=typedpress-wp-zero-managed TP_WP_PORT=8905 tests/wp/zero-upgrade/managed-run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
cd "$repo"
export TP_WP_PROJECT="${TP_WP_PROJECT:-typedpress-wp-zero-managed}"
export TP_WP_PORT="${TP_WP_PORT:-8905}"
work="$(mktemp -d)"
cleanup() { [[ ${TP_WP_KEEP:-0} == 1 ]] || "$wp/harness.sh" down >/dev/null; rm -rf -- "$work"; }
trap cleanup EXIT
fail() { echo "not ok: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }
cargo build -q
first="${CARGO_TARGET_DIR:-target}/debug/typedpress"
[[ $first == /* ]] || first="$repo/$first"
json() { python3 -c 'import json,sys; v=json.load(sys.stdin)
for k in sys.argv[1].split("."): v=v[int(k)] if isinstance(v,list) else v[k]
print(v if not isinstance(v,(dict,list,bool)) and v is not None else json.dumps(v))' "$1"; }

# The ported app, with the 0.3.0 ledger, captured and compiled into a store.
mkdir -p "$work/carry/tp/_generated/migrations"
cp "$here/typedpress.config.ts" "$work/carry/typedpress.config.ts"
cp "$here/fixture/migrations/"* "$work/carry/tp/_generated/migrations/"
"$first" build "$work/carry" --quiet >/dev/null
"$first" sources "$work/carry" --out "$work/sources"
mkdir -p "$work/content/plugins"
cp "$wp/store/host.php" "$work/content/plugins/typedpress-store-host.php"
cp "$work/carry/tp/dist/wp-content/typedpress-manifest.json" "$work/content/"
store="$work/content/plugins/typedpress-store"
build=$("$first" compile-to-store "$work/sources" "$store" "$work/sources" | json build)
root=/var/www/html/wp-content/plugins/typedpress-store

"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/content" --platform > "$work/harness.json"
url=$(json url < "$work/harness.json")
"$wp/harness.sh" compose exec -T db mariadb -uroot -pfirst-test-root wordpress < "$here/fixture/site.sql"
"$wp/harness.sh" wp option update home "$url" >/dev/null
"$wp/harness.sh" wp option update siteurl "$url" >/dev/null
# The dump's plugin list names 0.3's plugins; this site serves the build from the store only.
"$wp/harness.sh" wp option update active_plugins '["action-scheduler/action-scheduler.php","secure-custom-fields/secure-custom-fields.php","mcp-adapter/mcp-adapter.php","two-factor/two-factor.php"]' --format=json >/dev/null
"$wp/harness.sh" compose exec -T wordpress sh -c "mkdir -p /var/www/html/wp-content/mu-plugins && cp /var/www/html/wp-content/plugins/typedpress-store-host.php /var/www/html/wp-content/mu-plugins/"
"$wp/harness.sh" wp eval 'file_put_contents(WPMU_PLUGIN_DIR . "/test-probe-route.php", "<?php\nadd_filter(\"tp_private_probe_url\", fn (\$u) => str_replace(home_url(), \"http://wordpress\", \$u));\n");' >/dev/null

names() { "$wp/harness.sh" sql "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY 1; SELECT option_name FROM wp_options WHERE option_name LIKE 'zero%' OR option_name LIKE 'typedpress%' ORDER BY 1"; }
host() { "$wp/harness.sh" wp --exec="define('TP_TEST_BUILD', '$build');" eval "$@"; }
inspect() { "$wp/harness.sh" wp --exec="define('TP_TEST_BUILD', '$build'); define('TP_TEST_INSPECT', true);" eval "echo json_encode(TypedPress\\Loader\\Loader::inspect('$root', '$build')['steps']);"; }

before=$(names)
host "echo 'booted';" >/dev/null
[[ $before == "$(names)" ]] || { diff <(echo "$before") <(names) >&2; fail "booting the managed build moved stored names"; }
ok "booting a managed build on a 0.3 site moves no name"

steps=$(inspect)
python3 - "$steps" <<'PY' || fail "inspection lists both name upgrades as pending: $steps"
import json,sys
names=[s for s in json.loads(sys.argv[1]) if s['kind']=='names']
assert [(s['id'], s['state']) for s in names]==[('names:identity','pending'),('names:runtime','pending')], names
PY
[[ $before == "$(names)" ]] || fail "inspecting moved stored names"
ok "inspection lists the identity and runtime name upgrades as pending, and writes nothing"

# Interrupted between two renames: one 0.3 table moved by hand, as a run that died after its first
# RENAME TABLE leaves it. The step shows as started, not finished; nothing else moved.
"$wp/harness.sh" sql "RENAME TABLE wp_zero_notes TO wp_tp_notes"
steps=$(inspect)
python3 - "$steps" <<'PY' || fail "an interrupted upgrade shows as started: $steps"
import json,sys
names={s['id']: s['state'] for s in json.loads(sys.argv[1]) if s['kind']=='names'}
assert names=={'names:identity':'pending','names:runtime':'started'}, names
PY
ok "an upgrade interrupted between two renames shows as started, not finished"

receipt=$(host "echo json_encode(TypedPress\\Loader\\Loader::initialize('$root', '$build'));")
[[ $(json migrations <<< "$receipt") == '[]' ]] || fail "the ported app plans no migration on the 0.3 ledger: $receipt"
[[ $("$wp/harness.sh" sql "SHOW TABLES LIKE 'wp\\_zero\\_%'" | wc -l) -eq 0 ]] || fail "initialize moved every 0.3 table"
[[ -n $("$wp/harness.sh" wp option get tp_zero_names --format=json) && -n $("$wp/harness.sh" wp option get tp_identity_zero_names --format=json) ]] || fail "both upgrades recorded that they ran"
[[ $(inspect) == '[]' ]] || fail "after initialize nothing is left: $(inspect)"
titles=$(curl -s -H "X-TypedPress-Build: $build" "$url/__tp/api/v1/notes" | python3 -c 'import json,sys; print(sorted(n["title"] for n in json.load(sys.stdin)["data"]))')
[[ $titles == "['Kept note', 'Second note']" ]] || fail "the site serves the 0.3 site's notes through TypedPress: $titles"
ok "initialize runs both upgrades, resuming the interrupted one, and the site serves the 0.3 data"
