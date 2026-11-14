#!/usr/bin/env bash
# Real WordPress/MariaDB proof that a build mounted from the store installs nothing until the host
# initializes it, and that initialize installs what a plugin-installed site installs on boot. The app
# (tests/wp/store/install) has one of every thing First installs: members (guest role, identity
# client, member defaults), a private files bucket, a kind with a URL pattern and searchable text,
# runtime schema changes (the administrator's capability), a page and a Markdown page (route and
# content Pages), and First Admin. The same app is also built as plugins, on a second fresh site, so
# the two sites can be compared after their first requests.
# Assertions are on the database and the store, never on source text.
#
#   FIRST_WP_PROJECT=first-wp-store-install FIRST_WP_PORT=8903 tests/wp/store-install-run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
bin="$target/debug/first"
export FIRST_WP_PROJECT="${FIRST_WP_PROJECT:-first-wp-store-install}"
export FIRST_WP_PORT="${FIRST_WP_PORT:-8903}"
work="$(mktemp -d)"
cleanup() { "$here/harness.sh" down; rm -rf "$work"; }
trap cleanup EXIT
fail() { echo "not ok: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }
wp() { "$here/harness.sh" wp "$@"; }
json() { python3 -c 'import json,sys; v=json.load(sys.stdin)
for k in sys.argv[1].split("."): v=v[int(k)] if isinstance(v,list) else v[k]
print(v if not isinstance(v,(dict,list,bool)) and v is not None else json.dumps(v))' "$1"; }

mkdir -p "$work/installlane"
rsync -a "$here/store/install/" "$work/installlane/"
"$bin" sources "$work/installlane" --out "$work/sources"
"$bin" build "$work/installlane" --quiet >/dev/null
mkdir -p "$work/content/plugins"
cp "$here/store/host.php" "$work/content/plugins/first-store-host.php"
cp "$work/installlane/first/dist/wp-content/first-manifest.json" "$work/content/"
store="$work/content/plugins/first-store"
build=$("$bin" compile-to-store "$work/sources" "$store" "$work/sources" | json build)
root=/var/www/html/wp-content/plugins/first-store

# What installing could touch: every table and column, every option (roles, rewrite rules and
# First's markers among them) except the test host's call log and Action Scheduler's queue-runner
# lock, the migration ledger, posts and their meta, users' meta, Action Scheduler's pending actions
# and WordPress's cron events, and the private files directory.
site() {
  local q
  for q in "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY 1, 2" \
    "SELECT option_name, MD5(option_value) FROM wp_options WHERE option_name NOT LIKE '\\_transient%' AND option_name NOT LIKE '\\_site\\_transient%' AND option_name <> 'first_test_contract' AND option_name NOT LIKE 'action\\_scheduler\\_lock\\_%' ORDER BY 1" \
    "SELECT * FROM wp_first__migrations ORDER BY app, id" "SELECT ID, post_type, post_status, post_name FROM wp_posts ORDER BY ID" \
    "SELECT post_id, meta_key, MD5(meta_value) FROM wp_postmeta ORDER BY 1, 2" "SELECT user_id, meta_key, MD5(meta_value) FROM wp_usermeta ORDER BY 1, 2" \
    "SELECT hook, status, \`group_id\` FROM wp_actionscheduler_actions WHERE status = 'pending' ORDER BY 1"; do
    "$here/harness.sh" sql "$q" 2>/dev/null || echo "missing: $q"
  done
  wp cron event list --fields=hook --format=csv 2>/dev/null | sort
  "$here/harness.sh" compose exec -T wordpress sh -c 'find /var/www/html/wp-content/uploads/first-private 2>/dev/null | sort' || true
}
host() { wp --exec="define('FIRST_TEST_BUILD', '$build');" eval "$@"; }

"$here/harness.sh" up --wp-content "$work/content" --platform > "$work/harness.json"
url=$(json url < "$work/harness.json")
"$here/harness.sh" compose exec -T wordpress sh -c "mkdir -p /var/www/html/wp-content/mu-plugins && cp /var/www/html/wp-content/plugins/first-store-host.php /var/www/html/wp-content/mu-plugins/"

fresh=$(site)
host "echo 'booted';" >/dev/null
booted=$(site)
[[ $fresh == "$booted" ]] || { diff <(echo "$fresh") <(echo "$booted") >&2; fail "a managed boot before initialize changed the site"; }
ok "a managed boot before initialize installs nothing"

receipt=$(host "echo json_encode(First\\Loader\\Loader::initialize('$root', '$build'));")
[[ $(json migrations.0 <<< "$receipt") == 0001_init ]] || fail "initialize applies the init migration: $receipt"
initialized=$(site)
# Requests to the initialized build (a page, wp-admin, sign-in, the API, WP-CLI) install nothing more:
# initialize installed it all.
for path in / /about /colophon /wp-admin/ /wp-login.php /__first/api/v1/kinds/notes; do
  curl -s -o /dev/null -H "X-First-Build: $build" "$url$path" || true
done
host "echo 'booted';" >/dev/null
served=$(site)
[[ $initialized == "$served" ]] || { diff <(echo "$initialized") <(echo "$served") >&2; fail "requests after initialize installed more"; }
ok "requests to an initialized managed build install nothing more"
echo "$initialized" > "$work/managed.txt"

# The same app installed as plugins on a fresh site, after its first requests: what initialize
# installed is what a plugin-installed site installs on boot.
"$here/harness.sh" down >/dev/null
rm -rf "$work/plugins-content" && mkdir -p "$work/plugins-content"
rsync -a "$work/installlane/first/dist/wp-content/" "$work/plugins-content/"
"$here/harness.sh" up --wp-content "$work/plugins-content" > "$work/plugins.json"
url=$(json url < "$work/plugins.json")
for path in / /about /colophon /wp-admin/ /wp-login.php /__first/api/v1/kinds/notes; do
  curl -s -o /dev/null "$url$path" || true
done
wp eval "echo 'booted';" >/dev/null
python3 - "$work/managed.txt" <(site) <<'PY' || fail "initialize installs what a plugin-installed site installs"
import sys
managed=open(sys.argv[1]).read().splitlines(); plugins=open(sys.argv[2]).read().splitlines()
# Names, not values: ids, timestamps, secrets and hashes differ between two sites.
def names(lines):
    out=set()
    for l in lines:
        parts=l.split('\t')
        out.add(parts[0] if len(parts)>1 else l)
    return out
missing=sorted(n for n in names(plugins)-names(managed) if not n.startswith(('_site_transient','active_plugins','recently_activated','first-','missing:')))
assert not missing, missing
PY
ok "initialize installs what a plugin-installed site installs on its first requests"
