#!/usr/bin/env bash
# The TypedPress plugin on a WordPress network (subdirectory multisite): TypedPress is activated for the whole
# network, and each site of the network gets its own app, pushed to that site's own address. One
# site's builds, live app, deployment history and tables are its own; the scripts and styles of
# identical trees are shared. Only the network's super admins deploy.
# Assertions are on HTTP answers, the database and what the commands print and exit with.
#
#   TP_WP_PROJECT=typedpress-wp-plugin-ms TP_WP_PORT=8907 tests/wp/plugin/multisite-run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
harness="$here/../harness.sh"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
first="$target/debug/typedpress"
export TP_WP_PROJECT="${TP_WP_PROJECT:-typedpress-wp-plugin-ms}"
export TP_WP_PORT="${TP_WP_PORT:-8907}"
work="$(mktemp -d)"
cleanup() {
  # The web server wrote the plugins and the build stores as its own user; hand them back before removing.
  "$harness" compose exec -T wordpress chown -R "$(id -u):$(id -g)" /var/www/html/wp-content >/dev/null 2>&1 || true
  if [[ ${TP_WP_KEEP:-0} == 1 ]]; then echo "kept: $work" >&2; return; fi
  "$harness" down
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "not ok: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }
wp() { "$harness" wp "$@"; }
json() { python3 -c 'import json,sys; v=json.load(sys.stdin)
for k in sys.argv[1].split("."): v=v[int(k)] if isinstance(v,list) else v[k]
print(v if not isinstance(v,(dict,list,bool)) and v is not None else json.dumps(v))' "$1"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
export TP_CONFIG_DIR="$work/config"
unset TP_TOKEN
# One app per site: the same shape, another name and another table, so nothing can pass by reading
# the other site's data.
app() {
  mkdir -p "$work/$1"
  cat > "$work/$1/typedpress.config.ts" <<TS
import { defineConfig, table, text } from "typedpress";
export const $2 = table({ title: text() }, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export default defineConfig({ name: "$1" });
TS
}
push() { (cd "$work/$1" && TP_APP_PASSWORD="$2" "$first" push --site "$3" 2>&1); }

mkdir -p "$work/content/plugins"
"$harness" down
"$harness" up --bare --wp-content "$work/content" > "$work/harness.json"
url=$(json url < "$work/harness.json")
wp config set FS_METHOD direct >/dev/null
# A subdirectory network, with core's own rewrite rules for one, and two more sites on it.
wp core multisite-convert --title="TypedPress Network" >/dev/null
"$harness" compose exec -T wordpress sh -c 'cat > /var/www/html/.htaccess' <<'HTACCESS'
RewriteEngine On
RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
RewriteBase /
RewriteRule ^index\.php$ - [L]
RewriteRule ^([_0-9a-zA-Z-]+/)?wp-admin$ $1wp-admin/ [R=301,L]
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]
RewriteRule ^([_0-9a-zA-Z-]+/)?(wp-(content|admin|includes).*) $2 [L]
RewriteRule ^([_0-9a-zA-Z-]+/)?(.*\.php)$ $2 [L]
RewriteRule . index.php [L]
HTACCESS
wp site create --slug=news --title=News >/dev/null
wp site create --slug=shop --title=Shop >/dev/null
news="$url/news" shop="$url/shop"
# A subsite's own administrator, who is not a super admin of the network.
wp user create newsadmin newsadmin@example.test --role=subscriber >/dev/null
wp --url="$news" user set-role newsadmin administrator >/dev/null
super="admin:$(wp user application-password create admin lane --porcelain)"
local_admin="newsadmin:$(wp user application-password create newsadmin lane --porcelain)"

# ---- one plugin, activated for the network ----------------------------------------------------
"$first" plugin --out "$work/typedpress.zip" >/dev/null
docker cp "$work/typedpress.zip" "$("$harness" compose ps -q cli)":/tmp/typedpress.zip >/dev/null
wp plugin install /tmp/typedpress.zip --activate-network >/dev/null
network=$(wp plugin list --status=active-network --field=name | sort | tr '\n' ' ')
[[ $network == "action-scheduler mcp-adapter secure-custom-fields two-factor typedpress " ]] || fail "activating TypedPress for the network activates what it depends on for the network: $network"
for site in "$url" "$news" "$shop"; do
  [[ $(curl -s -u "$super" "$site/wp-json/typedpress-deploy/v1/site" | json ready) == true ]] || fail "$site is ready for a deployment"
done
ok "activating TypedPress for a network installs its plugins and readies every site"

# ---- each site gets its own app ----------------------------------------------------------------
app newsapp stories
app shopapp products
out=$(push newsapp "$super" "$news") || fail "the push to /news: $out"
[[ $out == *"live: $news now runs newsapp"* ]] || fail "the push to /news goes live there: $out"
[[ $(curl -s "$news/wp-json/typedpress/v1" | json data.name) == newsapp ]] || fail "/news runs its app"
[[ $(status "$shop/wp-json/typedpress/v1") == 404 && $(status "$url/wp-json/typedpress/v1") == 404 ]] || fail "a push to one site leaves the others without an app"
out=$(push shopapp "$super" "$shop") || fail "the push to /shop: $out"
# Each site has its own store, so the runtime goes up once per site.
[[ $out == *"uploading the runtime tree"* && $out == *"live: $shop now runs shopapp"* ]] || fail "the push to /shop uploads into that site's own store: $out"
[[ $(curl -s "$shop/wp-json/typedpress/v1" | json data.name) == shopapp && $(curl -s "$news/wp-json/typedpress/v1" | json data.name) == newsapp ]] || fail "each site runs its own app"
[[ $(status "$url/wp-json/typedpress/v1") == 404 ]] || fail "the network's main site still has no app"
ok "each site of the network takes its own app, pushed to its own address"

# ---- what belongs to one site ------------------------------------------------------------------
news_id=$(wp --url="$news" eval 'echo get_current_blog_id();'); shop_id=$(wp --url="$shop" eval 'echo get_current_blog_id();')
[[ $news_id != "$shop_id" && $news_id != 1 && $shop_id != 1 ]] || fail "the two sites are two sites of the network: $news_id $shop_id"
tables=$("$harness" sql "SHOW TABLES LIKE '%tp\_%'" | tail -n +2 | sort | tr '\n' ' ')
[[ $tables == *"wp_${news_id}_tp_stories"* && $tables == *"wp_${shop_id}_tp_products"* ]] || fail "each app's table is under its own site's prefix: $tables"
[[ $tables != *"wp_${news_id}_tp_products"* && $tables != *"wp_${shop_id}_tp_stories"* && $tables != *"wp_tp_stories"* ]] || fail "no site holds another site's table: $tables"
news_build=$(wp --url="$news" option get tp_live_build); shop_build=$(wp --url="$shop" option get tp_live_build)
[[ $news_build != "$shop_build" && -z $(wp option get tp_live_build 2>/dev/null) ]] || fail "the live build is recorded per site"
news_key=$(wp --url="$news" option get tp_store_key); shop_key=$(wp --url="$shop" option get tp_store_key)
[[ $news_key != "$shop_key" ]] || fail "each site keeps its builds in its own store"
"$harness" compose exec -T wordpress sh -c "test -f /var/www/html/wp-content/typedpress-store-$news_key/build/$news_build.json && ! test -e /var/www/html/wp-content/typedpress-store-$news_key/build/$shop_build.json" || fail "a site's store holds its own builds only"
[[ $(wp --url="$news" option get tp_deployments --format=json | json 0.name) == newsapp && $(wp --url="$shop" option get tp_deployments --format=json | json 0.name) == shopapp ]] || fail "the deployment history is per site"
# Content written on one site is that site's.
wp --url="$news" typedpress insert stories '{"title":"On the news site"}' >/dev/null
[[ $(curl -s "$news/wp-json/typedpress/v1/stories" | json data.0.title) == "On the news site" && $(status "$shop/wp-json/typedpress/v1/stories") == 404 ]] || fail "one site's content is not another's"
ok "tables, builds, the live build and the history belong to one site"

# ---- who may deploy ----------------------------------------------------------------------------
[[ $(status -u "$local_admin" "$news/wp-json/typedpress-deploy/v1/site") == 403 ]] || fail "a subsite's own administrator can't read the receiver"
if out=$(push newsapp "$local_admin" "$news"); then fail "a subsite's administrator deployed: $out"; fi
[[ $out == *"needs an administrator of the network"* ]] || fail "a subsite's administrator is told who may deploy: $out"
ok "on a network, only its super admins deploy"

# ---- a second version on one site leaves the other alone ----------------------------------------
cat > "$work/newsapp/typedpress.config.ts" <<'TS'
import { defineConfig, table, text } from "typedpress";
export const stories = table({ title: text(), section: text().default("front") }, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });
export default defineConfig({ name: "newsapp" });
TS
out=$(push newsapp "$super" "$news") || fail "the second push to /news: $out"
[[ $out =~ "run migration "[0-9]{14}_[0-9a-hjkmnp-tv-z]{6}_add_stories_section && $(curl -s "$news/wp-json/typedpress/v1/stories" | json data.0.section) == front ]] || fail "the second push migrates /news: $out"
[[ $(wp --url="$shop" option get tp_live_build) == "$shop_build" && $(curl -s "$shop/wp-json/typedpress/v1" | json data.name) == shopapp ]] || fail "the other site keeps its build"
ok "a deployment to one site changes nothing on another"

# ---- one configured store directory for the whole network ---------------------------------------
# TP_STORE_DIR is one constant for every site. Each site still keeps its own builds and its own
# record of which it has initialized: the same app pushed to a second site is installed there too.
# (Under wp-content only because that is the directory the lane's web and WP-CLI containers share.)
configured=/var/www/html/wp-content/configured-store
"$harness" compose exec -T wordpress sh -c "mkdir -p $configured && chown www-data:www-data $configured"
wp config set TP_STORE_DIR "$configured" >/dev/null
wp site create --slug=journal --title=Journal >/dev/null
wp site create --slug=wiki --title=Wiki >/dev/null
app sharedapp pages
# The two fresh deployments compile independently against empty baselines.
export TYPEDPRESS_MIGRATION_TIME=20261122000000
for site in journal wiki; do
  out=$(push sharedapp "$super" "$url/$site") || fail "the push to /$site with a configured store: $out"
  [[ $out =~ "applied migration "[0-9]{14}_[0-9a-hjkmnp-tv-z]{6}_init && $out == *"live: $url/$site now runs sharedapp"* ]] || fail "/$site installs the build itself: $out"
done
journal_id=$(wp --url="$url/journal" eval 'echo get_current_blog_id();'); wiki_id=$(wp --url="$url/wiki" eval 'echo get_current_blog_id();')
tables=$("$harness" sql "SHOW TABLES LIKE '%tp\_pages'" | tail -n +2 | sort | tr '\n' ' ')
[[ $tables == *"wp_${journal_id}_tp_pages"* && $tables == *"wp_${wiki_id}_tp_pages"* ]] || fail "both sites have the app's table: $tables"
[[ $(wp --url="$url/journal" option get tp_live_build) == "$(wp --url="$url/wiki" option get tp_live_build)" ]] || fail "the two sites run the same build"
"$harness" compose exec -T wordpress sh -c "test -d $configured/site-$journal_id/ready && test -d $configured/site-$wiki_id/ready && ! test -e $configured/ready" || fail "each site's store is its own directory under the configured one"
wp --url="$url/journal" typedpress insert pages '{"title":"In the journal"}' >/dev/null
[[ $(curl -s "$url/journal/wp-json/typedpress/v1/pages" | json data.0.title) == "In the journal" && $(curl -s "$url/wiki/wp-json/typedpress/v1/pages" | json data) == "[]" ]] || fail "the same app on two sites keeps two sets of rows"
ok "with one TP_STORE_DIR, each site installs and keeps its own builds"
echo "plugin multisite lane: all checks passed"
