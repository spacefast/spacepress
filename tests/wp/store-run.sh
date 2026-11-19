#!/usr/bin/env bash
# Real WordPress/MariaDB proof of the build store (docs/decisions/2026-11-07-build-store.md):
# two builds of one app whose action code differs, both installed in one store. A test-only host
# (tests/wp/store/host.php) selects the build per request. Each build initializes once, each answers
# its own action while both are installed, selecting the older build again serves it on the newer
# schema (rollback), and garbage collection removes only what the host's kept builds do not reference.
# Assertions are on HTTP answers, receipts and the store's directories, never on source text.
#
#   TP_WP_PROJECT=typedpress-wp-store TP_WP_PORT=8901 tests/wp/store-run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
bin="$target/debug/typedpress"
export TP_WP_PROJECT="${TP_WP_PROJECT:-typedpress-wp-store}"
export TP_WP_PORT="${TP_WP_PORT:-8901}"
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
  mkdir -p "$work/$label/storelane"
  rsync -a --exclude host.php --exclude contract-host.php "$here/store/" "$work/$label/storelane/"
  sed -i.bak "s/BUILD_LABEL/$label/" "$work/$label/storelane/typedpress.config.ts" && rm "$work/$label/storelane/typedpress.config.ts.bak"
  "$bin" sources "$work/$label/storelane" --out "$work/$label/sources"
done
# The harness installs the pinned platform plugins from a native build's lock; it never serves the build.
"$bin" build "$work/one/storelane" --quiet >/dev/null
mkdir -p "$work/content/plugins"
cp "$here/store/host.php" "$work/content/plugins/typedpress-store-host.php"
cp "$here/store/contract-host.php" "$work/content/plugins/typedpress-store-contract-host.php"
cp "$work/one/storelane/tp/dist/wp-content/typedpress-manifest.json" "$work/content/"
# The store lives in the bind-mounted plugins directory so the container sees it; TP_BUILD_STORE points at it.
store="$work/content/plugins/typedpress-store"
start=$(date +%s%N)
first=$("$bin" compile-to-store "$work/one/sources" "$store" "$work/one/sources" | json build)
mid=$(date +%s%N)
second=$("$bin" compile-to-store "$work/two/sources" "$store" "$work/two/sources" "$first" | json build)
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
"$here/harness.sh" compose exec -T wordpress sh -c "mkdir -p /var/www/html/wp-content/mu-plugins && cp /var/www/html/wp-content/plugins/typedpress-store-host.php /var/www/html/wp-content/mu-plugins/typedpress-store-host.php && cp /var/www/html/wp-content/plugins/typedpress-store-contract-host.php /var/www/html/wp-content/mu-plugins/typedpress-store-contract-host.php"

action() { curl -sS -X POST -H 'Content-Type: application/json' -H "X-TypedPress-Build: $1" --data '{}' "$url/wp-json/typedpress/v1/actions/which"; }
# WP-CLI as the host: select the build before WordPress loads, then call the loader.
host() { local build="$1"; shift; wp --exec="define('TP_TEST_BUILD', '$build');" eval "$@"; }
root=/var/www/html/wp-content/plugins/typedpress-store
inspect() { wp --exec="define('TP_TEST_BUILD', '$1'); define('TP_TEST_INSPECT', true);" eval "echo json_encode(TypedPress\\Loader\\Loader::inspect('$root', '$1')$2);"; }
initialize() { host "$1" "echo json_encode(TypedPress\\Loader\\Loader::initialize('$root', '$1'));"; }
gc() { host "$1" "echo json_encode(TypedPress\\Loader\\Store::gc('$root', json_decode('$2'), $3));"; }

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-TypedPress-Build: $first" --data '{}' "$url/wp-json/typedpress/v1/actions/which")
[[ $status == 404 ]] || fail "an uninitialized build is not served, got $status"
ok "a build is not served before it initializes"

# Everything inspection could touch: tables and their columns, options (roles and rewrite rules
# among them; not the test host's own call log, which every boot writes, nor Action Scheduler's
# queue-runner lock, which serving takes), the ledger, posts and meta,
# and scheduled events.
site() {
  local q
  for q in "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY 1, 2" \
    "SELECT option_name, MD5(option_value) FROM wp_options WHERE option_name NOT LIKE '\\_transient%' AND option_name NOT LIKE '\\_site\\_transient%' AND option_name <> 'tp_test_contract' AND option_name NOT LIKE 'action\\_scheduler\\_lock\\_%' ORDER BY 1" \
    "SELECT * FROM wp_tp__migrations ORDER BY app, id" "SELECT (SELECT COUNT(*) FROM wp_posts), (SELECT MAX(post_modified_gmt) FROM wp_posts), (SELECT COUNT(*) FROM wp_postmeta), (SELECT COUNT(*) FROM wp_usermeta)" "SELECT * FROM wp_tp_notes ORDER BY id"; do
    "$here/harness.sh" sql "$q" 2>/dev/null || echo "missing: $q"
  done
  wp cron event list --fields=hook,next_run_gmt --format=csv 2>/dev/null | sort
}
# A managed boot installs nothing: WordPress with build one mounted from WP-CLI, before it
# initialized, leaves the site as it was. (The test host serves HTTP only for initialized builds.)
fresh=$(site)
host "$first" "echo 'booted';" >/dev/null
booted=$(site)
[[ $fresh == "$booted" ]] || { diff <(echo "$fresh") <(echo "$booted") >&2; fail "a managed boot before initialize changed the site"; }
ok "a managed boot before initialize writes nothing"

# Before the first initialize: inspection plans every system table, the init migration and the
# seed, and writes none of them.
fresh=$(site)
plan=$(inspect "$first" "")
python3 - "$plan" <<'PY' || fail "a fresh site's plan: $plan"
import json,sys
out=json.loads(sys.argv[1])
assert out['refusals']==[], out['refusals']
assert [(m['id'], m['statements']) for m in out['migrations']]==[('0001_init', [1, 2])], out['migrations']
# A site no runtime ran on yet still has the stored-name check from before the rename to run.
assert out['legacyNames'] is True, out
assert len(out['migrations'][0]['sql'])==64
steps=out['systemTables']['steps']
assert '__tp_jobs' in steps and steps['__tp_staged_status']==['step@1'], steps
assert out['seed'] is True and out['manifest']['baseline'] is None, out
PY
[[ $fresh == "$(site)" ]] || { diff <(echo "$fresh") <(site) >&2; fail "inspecting a fresh site changed it"; }
ok "inspecting a build on a fresh site plans its tables, migration and seed, and writes nothing"

receipt=$(initialize "$first")
[[ $(json migrations.0 <<< "$receipt") == 0001_init ]] || fail "the first build applies the init migration: $receipt"
[[ $(json seed.notes.created <<< "$receipt") == 1 ]] || fail "the first build seeds one note: $receipt"
[[ $(action "$first" | json data.build) == one ]] || fail "build one answers"
[[ $(action "$first" | json data.notes) == 1 ]] || fail "build one reads the seeded note"
[[ $(wp option get tp_identity_schema_version) == 4 && -n $(wp option get tp_identity_dummy_password_hash) ]] || fail "initialize installs identity's schema and password-check material"
[[ -n $(wp cron event list --hook=tp_identity_password_inventory --field=hook) ]] || fail "initialize schedules identity's password inventory"
ok "initialize migrates, installs identity, seeds and marks build one ready"


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
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-TypedPress-Build: $second" --data '{}' "$url/wp-json/typedpress/v1/actions/which")
[[ $status == 404 ]] || fail "a collected build is gone, got $status"
ok "gc removes only what the kept builds do not reference"

# Inspecting a candidate changes nothing (docs/decisions/2026-11-07-build-store.md). Build three adds
# a required field with no default to notes, which holds rows: its schema check refuses. Loading it
# and inspecting it reports the refusal and the plan, and leaves every table, option and ledger row
# as it was.
mkdir -p "$work/three/storelane"
rsync -a --exclude host.php --exclude contract-host.php "$here/store/" "$work/three/storelane/"
sed -i.bak -e "s/BUILD_LABEL/three/" -e 's/table({ title: text() }/table({ title: text(), rating: text() }/' -e 's/values({ title })/values({ title, rating: "5" })/' "$work/three/storelane/typedpress.config.ts" && rm "$work/three/storelane/typedpress.config.ts.bak"
"$bin" sources "$work/three/storelane" --out "$work/three/sources"
third=$("$bin" compile-to-store "$work/three/sources" "$store" "$work/three/sources" "$first" | json build)
[[ -f "$store/baseline/$third/migrations/0002_update.sql" ]] || fail "build three's baseline holds its new migration"
before=$(site)
inspected=$(inspect "$third" "")
python3 - "$inspected" <<'PY' || fail "inspection reports the refusal and the plan: $inspected"
import json,sys
out=json.loads(sys.argv[1])
codes=[r['code'] for r in out['refusals']]
assert codes==['required_field_missing'], codes
assert [m['id'] for m in out['migrations']]==[], out['migrations']
assert out['systemTables'] is None and out['identitySchema'] is None and out['legacyNames'] is False, out
assert out['seed'] is True and out['manifest']['baseline'], out
PY
after=$(site)
[[ $before == "$after" ]] || { diff <(echo "$before") <(echo "$after") >&2; fail "inspecting a refused candidate changed the site"; }
ok "inspecting a refused candidate reports why and changes nothing"
planned=$(inspect "$first" "")
[[ $(json refusals <<< "$planned") == '[]' && $(json migrations <<< "$planned") == '[]' ]] || fail "an initialized build plans nothing: $planned"
[[ $before == "$(site)" ]] || fail "inspecting an initialized build changed the site"
ok "inspecting a build that already initialized plans nothing"

# The host contract (docs/host-contract.md): every hook it lists is called by the runtime, and one
# `wp typedpress jobs tick` runs the queued job, whose mail goes through the host's transport.
contract() { wp eval "echo wp_json_encode(get_option('tp_test_contract', []));"; }
added=$(curl -sS -X POST -H 'Content-Type: application/json' -H "X-TypedPress-Build: $first" --data '{"title":"Contract"}' "$url/wp-json/typedpress/v1/actions/add")
[[ $(json data.added <<< "$added") == Contract ]] || fail "the add action answers: $added"
seen=$(contract)
[[ $(json tp_runtime_loaded <<< "$seen") == true ]] || fail "tp_runtime_loaded fired: $seen"
[[ $(json tp_realtime_changes <<< "$seen") == '["notes"]' ]] || fail "tp_realtime_changes carried the write: $seen"
[[ $(json 'TypedPress\Realtime\Publisher' <<< "$seen") == 1 ]] || fail "the host's Publisher got the notice: $seen"
tick=$(host "$first" "WP_CLI::runcommand('typedpress jobs tick --limit=10');")
[[ $(json data.processed <<< "$tick") -ge 1 && $(json data.failures <<< "$tick") == 0 && $(json data.remaining <<< "$tick") == false ]] || fail "a tick runs the queued job: $tick"
[[ $(json tp_mail_transport <<< "$(contract)") == 'Added Contract' ]] || fail "the job's mail went through tp_mail_transport: $(contract)"
ok "the runtime calls the host's hooks, its Publisher, and one jobs tick runs the queue"
