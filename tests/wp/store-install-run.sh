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
cleanup() { [[ ${FIRST_WP_KEEP:-0} == 1 ]] || "$here/harness.sh" down; rm -rf "$work"; }
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
    "SELECT option_name, MD5(option_value) FROM wp_options WHERE option_name NOT LIKE '\\_transient%' AND option_name NOT LIKE '\\_site\\_transient%' AND option_name NOT IN ('first_test_contract', 'installlane_hook_ran') AND option_name NOT LIKE 'action\\_scheduler\\_lock\\_%' ORDER BY 1" \
    "SELECT * FROM wp_first__migrations ORDER BY app, id" "SELECT ID, post_type, post_status, post_name FROM wp_posts ORDER BY ID" \
    "SELECT post_id, meta_key, MD5(meta_value) FROM wp_postmeta ORDER BY 1, 2" "SELECT user_id, meta_key, MD5(meta_value) FROM wp_usermeta ORDER BY 1, 2" \
    "SELECT hook, status, \`group_id\` FROM wp_actionscheduler_actions WHERE status = 'pending' ORDER BY 1"; do
    "$here/harness.sh" sql "$q" 2>/dev/null || echo "missing: $q"
  done
  wp cron event list --fields=hook --format=csv 2>/dev/null | sort
  "$here/harness.sh" compose exec -T wordpress sh -c 'find /var/www/html/wp-content/uploads/first-private 2>/dev/null | sort' || true
}
host() { wp --exec="define('FIRST_TEST_BUILD', '$build');" eval "$@"; }
inspect() { wp --exec="define('FIRST_TEST_BUILD', '$1'); define('FIRST_TEST_INSPECT', true);" eval "echo json_encode(First\\Loader\\Loader::inspect('$root', '$1')$2);"; }

"$here/harness.sh" up --wp-content "$work/content" --platform > "$work/harness.json"
url=$(json url < "$work/harness.json")
"$here/harness.sh" compose exec -T wordpress sh -c "mkdir -p /var/www/html/wp-content/mu-plugins && cp /var/www/html/wp-content/plugins/first-store-host.php /var/www/html/wp-content/mu-plugins/"
# The private-files probe fetches a URL from inside the stack: route it to the web server's name, as a
# host does with this filter (docs/host-contract.md).
probe_route() { wp eval 'wp_mkdir_p(WPMU_PLUGIN_DIR); file_put_contents(WPMU_PLUGIN_DIR . "/test-probe-route.php", "<?php\nadd_filter(\"first_private_probe_url\", fn (\$u) => str_replace(home_url(), \"http://wordpress\", \$u));\n");' >/dev/null; }
probe_route

# A boot runs the app's own `init` hook (tests/wp/store/install/first/wp-hooks/init), which writes an
# option: that is the app serving, not First installing. So the boot checks here leave that one
# option out, and the hook gets its own checks.
fresh=$(site)
inspect "$build" "['install']" >/dev/null
[[ $(wp option get installlane_hook_ran 2>/dev/null) == "" ]] || fail "inspecting ran the app's compiled WordPress hook"
host "echo 'booted';" >/dev/null
[[ $(wp option get installlane_hook_ran) == yes ]] || fail "a managed boot runs the app's compiled WordPress hooks"
wp option delete installlane_hook_ran >/dev/null
booted=$(site)
[[ $fresh == "$booted" ]] || { diff <(echo "$fresh") <(echo "$booted") >&2; fail "a managed boot before initialize changed the site"; }
ok "a managed boot before initialize installs nothing; inspecting runs none of the app's hooks"

plan=$(inspect "$build" "['install']")
python3 - "$plan" <<'PY' || fail "a fresh site's install plan: $plan"
import json,sys
plan=json.loads(sys.argv[1])
# Every step: a kind, an id unique in the plan, and its state (pending until a deployment runs it).
assert all(set(s) >= {'kind','id','state'} and s['state']=='pending' for s in plan), plan
assert len({s['id'] for s in plan})==len(plan), plan
kinds=sorted(s['kind'] for s in plan)
assert kinds==['page.create','page.create','rewrite-rules','search-shape'], kinds
PY
[[ $fresh == "$(site)" ]] || fail "inspecting changed the site"
ok "inspection plans the Pages and one rewrite rebuild, and writes nothing"

receipt=$(host "echo json_encode(First\\Loader\\Loader::initialize('$root', '$build'));")
[[ $(json migrations.0 <<< "$receipt") == 0001_init ]] || fail "initialize applies the init migration: $receipt"
initialized=$(site)
[[ $(inspect "$build" "['install']") == '[]' ]] || fail "after initialize nothing is left to install"
# Initialize from WP-CLI set up private files: the secret, the deny rules and a passing probe.
[[ $(wp option get first_runtime_private_ok) == 1 && -n $(wp option get first_runtime_secret) ]] || fail "initialize set up and probed private files"
"$here/harness.sh" compose exec -T wordpress sh -c 'test -f /var/www/html/wp-content/uploads/first-private/.htaccess' || fail "initialize wrote the private files' deny rules"
[[ -n $(wp option get first_search_shape --format=json) ]] || fail "initialize recorded the search shape"
# Initialize ran from WP-CLI and no web request has reached the build yet: the first request to
# First Admin's mount and to a kind URL already answer. Apache serves /wp-admin/new/ from the rule
# initialize wrote into .htaccess.
"$here/harness.sh" compose exec -T wordpress sh -c 'grep -q "wp-admin/new" /var/www/html/.htaccess' || fail "initialize wrote First Admin's rule into .htaccess"
note=$(wp --exec="define('FIRST_TEST_BUILD', '$build');" first insert notes '{"title":"Hello"}')
id=$(python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print((d[0] if isinstance(d,list) else d)["id"])' <<< "$note")
status=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H "X-First-Build: $build" "$url/wp-admin/new/")
[[ $status == "302 $url/wp-login.php?"* ]] || fail "the first request to /wp-admin/new/ asks to sign in: $status"
status=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H "X-First-Build: $build" "$url/notes/$id/")
[[ $status == 200* ]] || fail "the first request to a kind URL answers: $status"
wp --exec="define('FIRST_TEST_BUILD', '$build');" first insert topics '{"name":"Gardening"}' >/dev/null
status=$(curl -s -o /dev/null -w '%{http_code}' -H "X-First-Build: $build" "$url/topics/gardening/")
[[ $status == 200 ]] || fail "the first request to a taxonomy URL answers: $status"
status=$(curl -s -o /dev/null -w '%{http_code}' -H "X-First-Build: $build" "$url/topics/no-such-topic/")
[[ $status == 404 ]] || fail "a taxonomy URL with no term is a 404: $status"
ok "after initialize from WP-CLI, the first requests to /wp-admin/new/, a kind URL and a taxonomy URL answer"
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

# WordPress rebuilding its rules itself (permalink settings saved, another plugin flushing) is serving:
# it rebuilds them on that request with the build's rules, so every kind URL and the admin still answer.
wp --exec="define('FIRST_TEST_BUILD', '$build');" rewrite flush --hard >/dev/null 2>&1 || true
host "delete_option('rewrite_rules');" >/dev/null
for path in "/notes/$id/" /topics/gardening/ /wp-admin/new/; do
  status=$(curl -s -o /dev/null -w '%{http_code}' -H "X-First-Build: $build" "$url$path")
  [[ $status == 200 || $status == 302 ]] || fail "$path answers after WordPress rebuilt its rules: $status"
done
[[ $(host "echo json_encode(\\First\\Wp\\Hardening::rulesCurrent());") == true ]] || fail "the rebuilt rules carry First's fingerprint"
ok "rules WordPress rebuilds itself keep every kind URL and /wp-admin/new/ working"

# Inspecting a candidate that changes only a URL pattern plans exactly one step; the same build plans none.
sed -i.bak 's#url: "/notes/:id"#url: "/memos/:id"#' "$work/installlane/first.config.ts" && rm "$work/installlane/first.config.ts.bak"
"$bin" sources "$work/installlane" --out "$work/sources-url"
moved=$("$bin" compile-to-store "$work/sources-url" "$store" "$work/sources-url" "$build" | json build)
before=$(site)
steps=$(inspect "$moved" "['install']")
[[ $steps == '[{"kind":"rewrite-rules","id":"rewrite-rules","state":"pending"}]' ]] || fail "a URL-pattern change plans one step: $steps"
[[ $(inspect "$build" "['install']") == '[]' ]] || fail "the initialized build plans no step"
# The whole plan (system tables, identity, migrations and install steps together) says the same.
[[ $(inspect "$moved" "['steps']") == '[{"kind":"rewrite-rules","id":"rewrite-rules","state":"pending"}]' ]] || fail "the URL-pattern candidate's whole plan is one step"
[[ $(inspect "$build" "['steps']") == '[]' ]] || fail "the initialized build's whole plan is empty"
[[ $before == "$(site)" ]] || fail "inspecting the candidates changed the site"
ok "a candidate that changes only a URL pattern plans one step; the initialized build plans none"

# The same for a taxonomy's pattern alone: its rule is part of what initialize flushes.
sed -i.bak 's#url: "/memos/:id"#url: "/notes/:id"#' "$work/installlane/first.config.ts" && rm "$work/installlane/first.config.ts.bak"
sed -i.bak 's#url: "/topics/:slug"#url: "/subjects/:slug"#' "$work/installlane/first/topics.ts" && rm "$work/installlane/first/topics.ts.bak"
"$bin" sources "$work/installlane" --out "$work/sources-term-url"
moved=$("$bin" compile-to-store "$work/sources-term-url" "$store" "$work/sources-term-url" "$build" | json build)
steps=$(wp --exec="define('FIRST_TEST_BUILD', '$moved');" eval "echo json_encode(First\\Loader\\Loader::inspect('$root', '$moved')['install']);")
[[ $steps == '[{"kind":"rewrite-rules","id":"rewrite-rules","state":"pending"}]' ]] || fail "a taxonomy URL-pattern change plans one step: $steps"
[[ $before == "$(site)" ]] || fail "inspecting the taxonomy candidate changed the site"
ok "a candidate that changes only a taxonomy URL pattern plans one step"

# A site whose recorded digest was written before taxonomies existed (kind patterns only) and whose app
# has no taxonomy plans no step: with no taxonomy the digest's input is the kind patterns alone, so a
# deployment of this runtime to such a site needs no rewrite rebuild.
rm "$work/installlane/first/topics.ts"
"$bin" sources "$work/installlane" --out "$work/sources-no-term"
plain=$("$bin" compile-to-store "$work/sources-no-term" "$store" "$work/sources-no-term" "$build" | json build)
host "update_option('first_kind_urls', md5((string) json_encode(['/notes/:id'])), true);" >/dev/null
steps=$(wp --exec="define('FIRST_TEST_BUILD', '$plain');" eval "echo json_encode(First\\Loader\\Loader::inspect('$root', '$plain')['install']);")
[[ $steps == '[]' ]] || fail "an app without taxonomies, on a digest recorded from kind patterns alone, plans no step: $steps"
ok "an app without taxonomies keeps the digest recorded from its kind patterns alone"

# The same app installed as plugins on a fresh site, after its first requests: what initialize
# installed is what a plugin-installed site installs on boot.
"$here/harness.sh" down >/dev/null
rm -rf "$work/plugins-content" && mkdir -p "$work/plugins-content"
rsync -a "$work/installlane/first/dist/wp-content/" "$work/plugins-content/"
"$here/harness.sh" up --wp-content "$work/plugins-content" > "$work/plugins.json"
probe_route
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
