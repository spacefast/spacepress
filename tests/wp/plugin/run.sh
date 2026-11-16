#!/usr/bin/env bash
# The TypedPress plugin on a stock WordPress, the way a site owner and a developer use it:
#   wp-admin: upload typedpress.zip and activate it, which installs the plugins TypedPress depends on
#   CLI:      typedpress login <url> (approved in the browser), typedpress push, again with a schema change
# then what the site refuses, making an earlier build live again from the screen, and what the
# plugin supplies as the host (the app's variables, mail). Nothing is installed by the harness: the
# site starts with WordPress and its users only (`up --bare`). Assertions are on HTTP answers, the
# database and what the commands print and exit with, never on source text.
#
#   TP_WP_PROJECT=typedpress-wp-plugin TP_WP_PORT=8905 tests/wp/plugin/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
harness="$here/../harness.sh"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
first="$target/debug/typedpress"
export TP_WP_PROJECT="${TP_WP_PROJECT:-typedpress-wp-plugin}"
export TP_WP_PORT="${TP_WP_PORT:-8905}"
work="$(mktemp -d)"
cleanup() {
  # The web server wrote the plugins and the build store as its own user; hand them back before removing.
  "$harness" compose exec -T wordpress chown -R "$(id -u):$(id -g)" /var/www/html/wp-content >/dev/null 2>&1 || true
  # The stack's plugins directory is under $work, so a kept stack keeps it too.
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
browser() { python3 "$here/browser.py" "$work/cookies" "$url" "$@"; }
# The command line as a developer has it: its own config directory, no credential in the environment.
export TP_CONFIG_DIR="$work/config"
unset TP_APP_PASSWORD TP_TOKEN
project="$work/project"
step() { node "$here/steps.mjs" "$1" > "$project/typedpress.config.ts"; }
push() { (cd "$project" && "$first" push "$@" 2>&1); }
# An option read in the database itself: WP-CLI boots WordPress, which runs the live app.
option() { "$harness" sql "SELECT option_value FROM wp_options WHERE option_name='$1'" | tail -n +2; }

mkdir -p "$work/content/plugins" "$project/tp/app/about" "$project/public"
"$harness" down
"$harness" up --bare --wp-content "$work/content" > "$work/harness.json"
url=$(json url < "$work/harness.json")
api="$url/wp-json/typedpress-deploy/v1"
admin="admin:$(json users.admin.appPassword < "$work/harness.json")"
editor="editor:$(json users.editor.appPassword < "$work/harness.json")"
"$harness" sql "SELECT 1" >/dev/null || fail "the lane reads the database directly"
# The disposable stack's web server doesn't own WordPress's files, so core would ask for FTP details.
wp config set FS_METHOD direct >/dev/null
# What a site owner puts in wp-config.php for the app's `process.env.GREETING`.
wp config set TP_VARIABLES "['GREETING' => 'hello from wp-config']" --raw >/dev/null

# ---- wp-admin: one plugin, uploaded and activated ---------------------------------------------
"$first" plugin --out "$work/typedpress.zip" >/dev/null
[[ $(wp plugin list --status=active --format=count) == 0 ]] || fail "the site starts with no active plugin"
[[ $("$first" login "$url" --no-browser 2>&1) == *"does not have the TypedPress plugin active"* ]] || fail "typedpress login names the missing plugin on a site without it"
browser login admin typedpress-test-admin
browser upload-plugin "$work/typedpress.zip"
wp plugin is-active typedpress || fail "uploading and activating typedpress.zip activates the TypedPress plugin"
ok "typedpress.zip uploads and activates through wp-admin's Upload Plugin"

# Activating TypedPress installed and activated what it depends on, each pinned by checksum.
active=$(wp plugin list --status=active --field=name | sort | tr '\n' ' ')
[[ $active == "action-scheduler mcp-adapter secure-custom-fields two-factor typedpress " ]] || fail "activating TypedPress installs and activates the four pinned plugins: $active"
screen=$(browser screen 'admin.php?page=typedpress-setup' '<div class="wrap"><h1>TypedPress')
[[ $screen == *"TypedPress installed and activated the plugins it needs: Secure Custom Fields 6.9.7, Action Scheduler 4.2.0, MCP Adapter 0.7.1, Two Factor 0.17.0."* ]] || fail "the TypedPress screen says what activation installed: $screen"
[[ $screen == *"No TypedPress app is deployed to this site yet."* && $screen != *"Not installed"* && $screen == *"typedpress login $url"* ]] || fail "the TypedPress screen is ready and shows the commands: $screen"
# What WordPress's installer wrote (Hello world, the sample page, the privacy draft) is not the
# owner's content. Something the owner wrote is, and the screen says so before an app is deployed.
[[ $screen != *"already has content"* ]] || fail "a fresh install is not a site with content: $screen"
wp post create --post_type=post --post_status=publish --post_title='Written by the owner' --porcelain > "$work/owner-post"
wp post create --post_type=page --post_status=draft --post_title='A draft page' --porcelain > "$work/owner-page"
screen=$(browser screen 'admin.php?page=typedpress-setup' '<div class="wrap"><h1>TypedPress')
[[ $screen == *"This site already has content (1 post, 1 page). Deploying an app keeps it, and changes how WordPress serves it"*"Try the app on a copy of this site first."* ]] || fail "the TypedPress screen warns about the site's own content: $screen"
wp post delete "$(cat "$work/owner-post")" "$(cat "$work/owner-page")" --force >/dev/null
[[ $(browser screen 'admin.php?page=typedpress-setup' '<div class="wrap"><h1>TypedPress') != *"already has content"* ]] || fail "without it the warning is gone"
# The sample page, rewritten by its owner, is the owner's content.
sample=$(wp post list --post_type=page --name=sample-page --field=ID)
"$harness" sql "UPDATE wp_posts SET post_title = 'About us', post_modified_gmt = post_date_gmt + INTERVAL 1 DAY WHERE ID = $sample" >/dev/null
[[ $(browser screen 'admin.php?page=typedpress-setup' '<div class="wrap"><h1>TypedPress') == *"already has content (1 page)"* ]] || fail "an edited sample page counts as the site's content"
"$harness" sql "UPDATE wp_posts SET post_title = 'Sample Page', post_modified_gmt = post_date_gmt WHERE ID = $sample" >/dev/null
[[ $(status "$url/") == 200 && $(status "$url/__tp/api/v1") == 404 ]] || fail "before a deployment WordPress serves and TypedPress's API doesn't"
# A dependency that goes missing later is named on the screen and on other wp-admin screens, and the
# screen's button brings it back.
wp plugin deactivate two-factor >/dev/null
[[ $(browser screen 'index.php' 'wpbody-content') == *"needs a few plugins before an app can be deployed here"* ]] || fail "wp-admin points an administrator at the TypedPress screen"
[[ $(browser screen 'admin.php?page=typedpress-setup' '<div class="wrap"><h1>TypedPress') == *"Two Factor | 0.17.0 or newer | 0.17.0 (inactive) | Not installed"* ]] || fail "the TypedPress screen names the inactive plugin"
pressed=$(browser press 'admin.php?page=typedpress-setup' 'name="install"' install=1)
[[ $(json url <<< "$pressed") == *"page=typedpress-setup" && $(wp plugin is-active two-factor && echo active) == active ]] || fail "the screen's button activates it again: $pressed"
ok "activating TypedPress installs the pinned plugins from wordpress.org; the screen shows the commands and repairs a missing plugin"

# ---- the command line: typedpress login, approved in the browser --------------------------------------
step initial
cat > "$project/tp/app/about/page.tsx" <<'TSX'
import mark from "./mark.svg";

// Prebuilt: the live app keeps its prebuilt pages' state in options, which a dry run must not write.
export const prerender = true;

export default function About() {
  return <main><h1>About this app</h1><img src={mark} alt="" width={16} height={16} /></main>;
}
TSX
echo '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7"/></svg>' > "$project/tp/app/about/mark.svg"
echo 'served from public/' > "$project/public/hello.txt"
# The app's own WordPress hook, which writes: it runs on the live app's requests, and never on the
# deploy receiver's.
mkdir -p "$project/tp/wp-hooks/init"
cat > "$project/tp/wp-hooks/init/mark.ts" <<'TS'
import { update_option } from "php/wordpress";

export default function () {
  update_option("pluginlane_hook_ran", "yes");
}
TS
[[ $(push) == *"no site to deploy to"* ]] || fail "typedpress push before typedpress login says how to pick a site"
(cd "$project" && "$first" login "$url" --no-browser > "$work/login.out" 2>&1; echo "exit $?" >> "$work/login.out") &
for _ in $(seq 1 100); do grep -q 'authorize-application' "$work/login.out" 2>/dev/null && break; sleep 0.1; done
approve=$(grep -o "$url/wp-admin/authorize-application.php[^ ]*" "$work/login.out") || fail "typedpress login prints the approval link: $(cat "$work/login.out")"
callback=$(browser approve "$approve")
[[ $callback == http://127.0.0.1:*"/callback?"* ]] || fail "WordPress sends the browser back to the command line on 127.0.0.1"
[[ $(curl -s "$callback") == *"Signed in."* ]] || fail "the command line's callback answers the browser"
wait
[[ $(cat "$work/login.out") == *"signed in to $url as admin"*"exit 0" ]] || fail "typedpress login finishes: $(cat "$work/login.out")"
[[ $(stat -c %a "$work/config/sites.json") == 600 ]] || fail "the stored credential is readable by its owner only"
[[ $(wp user application-password list admin --field=name | grep -c '^TypedPress CLI') == 1 ]] || fail "the approval created one application password named for the command line"
ok "typedpress login gets an application password through WordPress's Authorize Application screen"

# ---- typedpress push ----------------------------------------------------------------------------------
# Asking a site what it is writes nothing to it: the store gets its name with the first upload.
curl -s -u "$admin" "$api/site" > "$work/answer.json"
[[ $(json live < "$work/answer.json") == null && -z $(option tp_store_key) ]] || fail "reading a fresh site names no build store: $(cat "$work/answer.json")"
out=$(push --dry-run) || fail "a dry run: $out"
[[ $out == *"run migration 0001_init"* && $out == *"--dry-run"* ]] || fail "a dry run uploads and prints the plan: $out"
[[ $(status "$url/__tp/api/v1") == 404 && -z $(wp option get tp_live_build 2>/dev/null) ]] || fail "a dry run makes nothing live"
[[ -n $(option tp_store_key) ]] || fail "the first upload names the build store"
# The uploaded build's browser files stay private until it is made live.
candidate=$(python3 -c '
import glob, json, os, sys
store = sys.argv[1]
app = json.load(open(max(glob.glob(store + "/build/*.json"), key=os.path.getmtime)))["app"]
image = glob.glob(f"{store}/app/{app}/plugins/**/*.svg", recursive=True)[0]
print(f"app/{app}/plugins/" + os.path.relpath(image, f"{store}/app/{app}/plugins"))' "$project/.tp/store")
[[ $(status "$url/wp-content/typedpress-assets/$candidate") == 404 ]] || fail "a dry run makes none of the build's files public: $candidate"
"$harness" compose exec -T wordpress test ! -e /var/www/html/wp-content/typedpress-assets || fail "a dry run creates no public directory"
out=$(push) || fail "the first deploy: $out"
[[ $out == *"the site already has this runtime tree"* && $out == *"applied migration 0001_init"* && $out == *"live: $url now runs pluginlane"* ]] || fail "the first deploy reuses the uploaded trees and goes live: $out"
tp_build=$(wp option get tp_live_build)
[[ $(curl -s "$url/__tp/api/v1" | json data.name) == pluginlane ]] || fail "TypedPress's API answers for the deployed app"
curl -s "$url/about" > "$work/about.html"
[[ $(cat "$work/about.html") == *"<h1>About this app</h1>"* ]] || fail "a tp/app/ page renders"
# The image the page imports is the app's own file: its URL is under the public copy, and answers.
image=$(grep -o -m1 "$url/wp-content/typedpress-assets/app/[^\"' ]*\.svg" "$work/about.html" || true)
[[ -n $image && $(curl -s "$image") == *"<circle"* ]] || fail "the page's imported image is served from wp-content/typedpress-assets: ${image:-not on the page}"
[[ $(curl -s "$url/wp-content/typedpress-assets/$candidate") == *"<circle"* ]] || fail "making the uploaded build live makes its files public: $candidate"
[[ $(option pluginlane_hook_ran) == yes ]] || fail "the live app runs its own WordPress hooks"
[[ $(curl -s "$url/hello.txt") == "served from public/" ]] || fail "public/ is served at the site root"
note=$(curl -s -u "$editor" -H 'Content-Type: application/json' -d '{"title":"Written before the second deploy"}' "$url/__tp/api/v1/notes")
[[ $(json data.title <<< "$note") == "Written before the second deploy" ]] || fail "an editor writes through the API: $note"
wp typedpress insert entries '{"body":"a row before the second deploy"}' >/dev/null
ok "typedpress push compiles, uploads, shows the plan and makes the app live"

# What the plugin supplies as the host: the app's variables and mail delivery.
[[ $(curl -s -X POST -H 'Content-Type: application/json' -d '{}' "$url/__tp/api/v1/actions/greeting" | json data.greeting) == "hello from wp-config" ]] || fail "process.env reads TP_VARIABLES from wp-config.php"
curl -s -u "$editor" -H 'Content-Type: application/json' -d '{"to":"reader@example.test"}' "$url/__tp/api/v1/actions/welcome" | json data.id >/dev/null || fail "the app queues a message"
wp typedpress jobs tick >/dev/null
[[ $("$harness" compose exec -T wordpress cat /var/www/html/wp-content/typedpress-test-mail/reader@example.test.txt) == "Sent by the deployed app." ]] || fail "the app's mail leaves through wp_mail"
ok "the app reads its variables from wp-config.php and sends mail through WordPress"

# TypedPress Admin's page names its scripts under the public copy, and they answer; the store itself is
# never served.
key=$(wp option get tp_store_key)
browser get 'admin.php?page=typedpress-admin' > "$work/admin.html"
asset=$(grep -o -m1 "$url/wp-content/typedpress-assets/runtime/[^\"'? ]*\.js" "$work/admin.html" || true)
asset=${asset%%$'\n'*}
[[ -n $asset && $(status "$asset") == 200 ]] || fail "TypedPress Admin loads a script from wp-content/typedpress-assets: ${asset:-none on the page}"
leaked=$("$harness" compose exec -T wordpress sh -c "find /var/www/html/wp-content/typedpress-assets -type f \( -name '*.php' -o -name '*.sql' -o -name '*.json' \) | wc -l")
[[ $leaked == 0 ]] || fail "the public copy holds no PHP, SQL or JSON"
[[ $(status "$url/wp-content/typedpress-store-$key/build/$tp_build.json") == 403 ]] || fail "the build store is not served"
# Where the store is, and whether the site's owner is warned. This lane's server is Apache, which
# reads the store's .htaccess, so there is nothing to warn about; a server that is not known to read
# it gets the warning on the TypedPress screen and from typedpress push.
[[ $(curl -s -u "$admin" "$api/site" | json warnings) == "[]" ]] || fail "on Apache the store in wp-content needs no warning"
"$harness" compose exec -T wordpress sh -c 'cat > /var/www/html/wp-content/mu-plugins/lane-server.php' <<'PHP'
<?php
$_SERVER['SERVER_SOFTWARE'] = 'nginx/1.27.0';
PHP
warned=$(curl -s -u "$admin" "$api/site" | json warnings.0)
[[ $warned == *"inside the folder the web server serves"*"nginx/1.27.0"*"TP_STORE_DIR"* ]] || fail "a server that may not read .htaccess gets the warning: $warned"
[[ $(browser screen 'admin.php?page=typedpress-setup' '<div class="wrap"><h1>TypedPress') == *"only the folder's random name keeps those files private"* ]] || fail "the TypedPress screen shows the warning"
out=$(push) || fail "a push to a site with a warning: $out"
[[ $out == *"warning: TypedPress keeps this site's builds"* && $out == *"already runs this code"* ]] || fail "typedpress push prints the site's warning and carries on: $out"
"$harness" compose exec -T wordpress rm /var/www/html/wp-content/mu-plugins/lane-server.php
[[ $(curl -s -u "$admin" "$api/site" | json warnings) == "[]" ]] || fail "without it the warning is gone"
ok "browser files are served from typedpress-assets; the build store is private, and a server that may not block it is warned about"

# ---- a second version: a migration, and the content written before it ---------------------------
step additive
out=$(push) || fail "the second deploy: $out"
[[ $out == *"the site already has this runtime tree"* && $out == *"uploading the app tree"* && $out == *"run migration 0002"* && $out == *"live:"* ]] || fail "the second deploy sends only the app tree and migrates: $out"
second_build=$(wp option get tp_live_build)
[[ $second_build != "$tp_build" ]] || fail "the second deploy is a new build"
[[ $(curl -s "$url/__tp/api/v1/notes" | json data.0.title) == "Written before the second deploy" && $(status "$url/__tp/api/v1/tasks") == 200 ]] || fail "content is kept and the new kind answers"
[[ $(wp typedpress find entries | json data.0.state) == open ]] || fail "the migration gave the existing row the new column's default"
[[ $(push) == *"already runs this code; nothing to deploy"* ]] || fail "pushing the same source again deploys nothing"
[[ $(wp option get tp_live_build) == "$second_build" ]] || fail "pushing the same source leaves the live build"
ok "a second push applies only the new migration and keeps content"

# ---- push keeps the site's plugin and the build's plugins current --------------------------------
# A live TypedPress app turns off plugin installs in wp-admin, so the command line does both. The site's
# plugin is made another one here by changing the hash it reports; push replaces it with its own.
"$harness" compose exec -T wordpress sed -i "s/define('TP_PLUGIN_HASH', '[0-9a-f]*')/define('TP_PLUGIN_HASH', '$(printf '0%.0s' {1..64})')/" /var/www/html/wp-content/plugins/typedpress/typedpress.php
[[ $(curl -s -u "$admin" "$api/site" | json pluginHash) == 0000* ]] || fail "the site reports the changed plugin"
# The dry run plans new code (the sealed step) against the plugin the site has. None of the live
# app's own code runs on the receiver's requests: its hook would write the option again.
[[ -n $(option tp_prebuilt_id) ]] || fail "the live app records its prebuilt pages' state"
"$harness" sql "DELETE FROM wp_options WHERE option_name='pluginlane_hook_ran' OR option_name LIKE 'tp\_prebuilt\_%'" >/dev/null
step sealed
out=$(push --dry-run) || fail "a dry run to a site with another TypedPress plugin: $out"
step additive
[[ $out == *"--dry-run: a push would update the TypedPress plugin"*"uploading the app tree"*"--dry-run: the build is uploaded and not live"* && $(curl -s -u "$admin" "$api/site" | json pluginHash) == 0000* ]] || fail "a dry run uploads and plans against the site's plugin and leaves it alone: $out"
[[ -z $(option pluginlane_hook_ran) ]] || fail "a dry run runs none of the live app's WordPress hooks"
[[ -z $("$harness" sql "SELECT option_name FROM wp_options WHERE option_name LIKE 'tp\_prebuilt\_%'" | tail -n +2) ]] || fail "a dry run records and schedules no prebuilt pages"
# A plugin from before dry runs kept uploads private says nothing about it, and a dry run sends it nothing.
"$harness" compose exec -T wordpress sed -i "/'dryRun' => true,/d" /var/www/html/wp-content/plugins/typedpress/src/Receiver.php
[[ $(curl -s -u "$admin" "$api/site" | json dryRun 2>/dev/null || true) != true ]] || fail "the older plugin doesn't say it takes dry runs"
step sealed
out=$(push --dry-run) || fail "a dry run to a site with an older TypedPress plugin: $out"
step additive
[[ $out == *"can't take a dry run without changing the site, so nothing was uploaded"* && $out != *"uploading"* ]] || fail "a dry run sends an older plugin nothing: $out"
out=$(push) || fail "a push to a site with another TypedPress plugin: $out"
[[ $out == *"updated the TypedPress plugin on the site"* && $(curl -s -u "$admin" "$api/site" | json pluginHash) != 0000* ]] || fail "push replaces the site's plugin with the one it carries: $out"
[[ $(curl -s "$url/__tp/api/v1" | json data.name) == pluginlane ]] || fail "the app keeps running across the plugin update"
wp plugin deactivate two-factor >/dev/null
out=$(push --dry-run) || fail "a dry run to a site missing a plugin the build needs: $out"
[[ $out == *"--dry-run: a push would install them"*"nothing changed"* && $(wp plugin is-active two-factor || echo inactive) == inactive ]] || fail "a dry run installs nothing: $out"
out=$(push) || fail "a push to a site missing a plugin the build needs: $out"
[[ $out == *"the site is missing plugins this app needs: two-factor 0.17.0 (found 0.17.0, inactive)"*"installed Two Factor 0.17.0 on the site"* && $(wp plugin is-active two-factor && echo active) == active ]] || fail "push names the plugin the build needs and brings it back: $out"
ok "push updates the site's TypedPress plugin and installs the plugins a build needs, with an app live; a dry run does neither"

# ---- a sealed app ---------------------------------------------------------------------------------
# A sealed app lets only listed plugins run. The TypedPress plugin is one of TypedPress's own: it is on every
# sealed list, so the site that was deployed to reports nothing unlisted and keeps taking deploys.
step sealed
out=$(push) || fail "deploying the sealed app: $out"
sealed=$(curl -s -u "$admin" "$url/__tp/api/v1" | json data.runtime.wp.sealed.plugins)
[[ $sealed == "[]" ]] || fail "a sealed site deployed through the plugin reports no unlisted plugin: $sealed"
if wp plugin activate hello >/dev/null 2>&1; then fail "a sealed site activated a plugin that is not on its list"; fi
step additive
out=$(push) || fail "deploying to the sealed site: $out"
[[ $out == *"live:"* && $(wp plugin activate hello >/dev/null 2>&1 && echo yes) == yes ]] || fail "the sealed site takes the next deployment, which unseals it: $out"
wp plugin deactivate hello >/dev/null
# The build the rest of the lane compares with: the one that is live now.
second_build=$(wp option get tp_live_build)
ok "a sealed app lists the TypedPress plugin, and the sealed site keeps taking deployments"

# ---- what the site refuses -----------------------------------------------------------------------
step required
if out=$(push); then fail "a required field on a kind with rows was deployed: $out"; fi
[[ $out == *"refuses this build; nothing changed there"*"entries.author is required, and 1 rows have no value for it"*"Change typedpress.config.ts and push again"* ]] || fail "the schema check's refusal names the field and the rows: $out"
[[ $(wp option get tp_live_build) == "$second_build" ]] || fail "a refused build is not made live"
[[ $(status "$url/__tp/api/v1/tasks") == 200 ]] || fail "the live app keeps serving after a refused deploy"
step additive
ok "a build the schema check refuses is not installed, and the live build stays"

if out=$(cd "$project" && TP_APP_PASSWORD="$editor" "$first" push 2>&1); then fail "an editor deployed: $out"; fi
[[ $out == *"needs an administrator"* ]] || fail "an editor is told deploying needs an administrator: $out"
[[ $(status "$api/site") == 401 && $(status -u "$editor" "$api/site") == 403 && $(status -u "$admin" "$api/site") == 200 ]] || fail "the deploy receiver answers administrators only"
# Deploying installs PHP. A role that may switch installed plugins on and off, and may not install
# one, does not deploy.
wp role create support Support --clone=editor >/dev/null
wp cap add support activate_plugins >/dev/null
wp user create support support@example.test --role=support >/dev/null
support="support:$(wp user application-password create support lane --porcelain)"
[[ $(status -u "$support" "$url/wp-json/wp/v2/plugins") == 200 ]] || fail "the support role manages installed plugins"
[[ $(status -u "$support" "$api/site") == 403 && $(curl -s -o /dev/null -w '%{http_code}' -u "$support" -H 'Content-Type: application/json' -d '{"manifest":"{}"}' "$api/deployments") == 403 ]] || fail "being allowed to activate plugins is not being allowed to deploy"

# A plugin that takes `install_plugins` from someone takes deploying from them, and one that grants
# it gives it: here a must-use plugin that does both, by user login.
"$harness" compose exec -T wordpress sh -c 'cat > /var/www/html/wp-content/mu-plugins/lane-caps.php' <<'PHP'
<?php
add_filter('user_has_cap', static function (array $all, array $caps, array $args, WP_User $user): array {
    $rule = get_option('lane_install_plugins', []);
    if (is_array($rule) && array_key_exists($user->user_login, $rule)) {
        $all['install_plugins'] = (bool) $rule[$user->user_login];
    }
    return $all;
}, 10, 4);
PHP
wp option update lane_install_plugins '{"admin":false,"support":true}' --format=json >/dev/null
[[ $(status -u "$admin" "$api/site") == 403 && $(status -u "$support" "$api/site") == 200 ]] || fail "a user_has_cap filter decides who may install plugins, and so who may deploy"
wp option delete lane_install_plugins >/dev/null
"$harness" compose exec -T wordpress rm /var/www/html/wp-content/mu-plugins/lane-caps.php
[[ $(status -u "$admin" "$api/site") == 200 && $(status -u "$support" "$api/site") == 403 ]] || fail "without the filter the roles decide again"
# A site whose own code says no file may change takes no deployment, with an app live or not: the
# policy is WordPress's (`file_mod_allowed`), and the app's own hardening is not what is asked.
[[ $(curl -s -u "$admin" "$api/site" | json closed) == null ]] || fail "a site with a live app is open for deployments"
"$harness" compose exec -T wordpress sh -c 'cat > /var/www/html/wp-content/mu-plugins/lane-no-file-mods.php' <<'PHP'
<?php
add_filter('file_mod_allowed', '__return_false');
PHP
[[ $(curl -s -u "$admin" "$api/site" | json closed) == *"does not allow file changes"* ]] || fail "the site says it is closed for deployments"
[[ $(curl -s -o "$work/answer.json" -w '%{http_code}' -u "$admin" -H 'Content-Type: application/json' -d '{"manifest":"{}"}' "$api/deployments") == 403 && $(json code < "$work/answer.json") == tp_closed ]] || fail "a site that allows no file changes takes no deployment: $(cat "$work/answer.json")"
"$harness" compose exec -T wordpress rm /var/www/html/wp-content/mu-plugins/lane-no-file-mods.php
[[ $(curl -s -u "$admin" "$api/site" | json closed) == null ]] || fail "without the filter the site is open again"

# Pushes that open a deployment at the same moment each keep theirs. The manifest is the last
# compiled build's (the refused `required` step, compiled against the live build).
latest=$(python3 -c 'import glob,json,os,sys; p=max(glob.glob(sys.argv[1]+"/build/*.json"), key=os.path.getmtime); print(json.dumps({"manifest": open(p).read()}))' "$project/.tp/store")
for n in 1 2 3 4 5 6; do curl -s -u "$admin" -H 'Content-Type: application/json' -d "$latest" "$api/deployments" > "$work/open-$n.json" & done
wait
for n in 1 2 3 4 5 6; do
  opened=$(json deployment < "$work/open-$n.json") || fail "deployment $n opened: $(cat "$work/open-$n.json")"
  [[ $(curl -s -u "$admin" "$api/deployments/$opened/plan" | json code) == tp_not_mounted ]] || fail "deployment $n of six opened at once is still open"
done

# The receiver directly: a deployment's trees must be the ones its manifest names.
store="$project/.tp/store"
manifest=$(python3 - "$store" <<'PY'
import glob, json, sys
# A build compiled against the live one (the refused `required` step), pointing at an app tree
# nobody has.
path = max(glob.glob(sys.argv[1] + "/build/*.json"), key=lambda p: __import__("os").path.getmtime(p))
manifest = json.load(open(path))
manifest["app"] = "0" * 63 + "1"
print(json.dumps({"manifest": json.dumps(manifest)}))
PY
)
created=$(curl -s -u "$admin" -H 'Content-Type: application/json' -d "$manifest" "$api/deployments")
id=$(json deployment <<< "$created"); token=$(json token <<< "$created")
# A build compiled against anything but the last deployment is refused before it is stored.
stale=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); m=json.loads(d["manifest"]); m["baseline"]=None; print(json.dumps({"manifest": json.dumps(m)}))' "$manifest")
[[ $(curl -s -o "$work/answer.json" -w '%{http_code}' -u "$admin" -H 'Content-Type: application/json' -d "$stale" "$api/deployments") == 409 && $(json code < "$work/answer.json") == tp_stale ]] || fail "a build compiled against another baseline is refused: $(cat "$work/answer.json")"
[[ $(json need.app <<< "$created") == true ]] || fail "the site asks for a tree it doesn't hold: $created"
python3 - "$store" "$work" <<'PY'
import glob, os, sys, zipfile
store, work = sys.argv[1:]
tree = max(glob.glob(store + "/app/*"), key=os.path.getmtime)
with zipfile.ZipFile(work + "/other-tree.zip", "w") as z:
    for root, _, files in os.walk(tree):
        for name in files:
            z.write(os.path.join(root, name), os.path.relpath(os.path.join(root, name), tree))
with zipfile.ZipFile(work + "/escape.zip", "w") as z:
    z.writestr("../escaped.php", "<?php")
PY
send() { curl -s -o "$work/answer.json" -w '%{http_code}' -u "$admin" -H 'Content-Type: application/octet-stream' --data-binary "@$1" "$api/deployments/$id/trees/app?index=0&total=1&sha256=$(sha256sum "$1" | cut -d' ' -f1)"; }
[[ $(send "$work/other-tree.zip") == 422 && $(json message < "$work/answer.json") == *"is not the one the build names"* ]] || fail "a tree with other contents is refused: $(cat "$work/answer.json")"
[[ $(send "$work/escape.zip") == 422 && $(json message < "$work/answer.json") == *"unsafe path"* ]] || fail "an archive that names a path outside the tree is refused: $(cat "$work/answer.json")"
# A small upload that unpacks to far more than a tree holds is refused before anything is unpacked.
python3 - "$work" <<'PY'
import sys, zipfile
work = sys.argv[1]
with zipfile.ZipFile(work + "/many.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for i in range(20001):
        z.writestr(f"f/{i}", b"")
with zipfile.ZipFile(work + "/huge.zip", "w", zipfile.ZIP_DEFLATED) as z:
    with z.open("zeros.bin", "w", force_zip64=True) as out:
        for _ in range(600):
            out.write(bytes(1 << 20))
PY
# The same archive with every declared size rewritten to one byte: what comes out is counted, not
# what the archive says of itself.
python3 - "$work" <<'PY'
import struct, sys
work = sys.argv[1]
data = bytearray(open(work + "/huge.zip", "rb").read())
def patch(signature, offset, zip64_tag=True):
    at = data.find(signature)
    while at >= 0:
        struct.pack_into("<I", data, at + offset, 1)          # uncompressed size
        at = data.find(signature, at + 4)
patch(b"PK\x03\x04", 22)   # local file header
patch(b"PK\x01\x02", 24)   # central directory header
# The ZIP64 extra field (tag 0x0001) repeats the uncompressed size as 8 bytes right after its header.
at = data.find(b"\x01\x00")
while at >= 0:
    size = struct.unpack_from("<H", data, at + 2)[0]
    if size in (16, 20, 24, 28) and at + 12 <= len(data) and struct.unpack_from("<Q", data, at + 4)[0] == 600 * (1 << 20):
        struct.pack_into("<Q", data, at + 4, 1)
    at = data.find(b"\x01\x00", at + 2)
open(work + "/lying.zip", "wb").write(data)
PY
[[ $(send "$work/lying.zip") == 422 && $(json message < "$work/answer.json") == *"unpacks to more than a tree may hold"* ]] || fail "an archive that understates its unpacked size is stopped at the same bound: $(cat "$work/answer.json")"
"$harness" compose exec -T wordpress sh -c "! find /var/www/html/wp-content -name zeros.bin | grep -q ." || fail "the understated archive left nothing unpacked"
[[ $(send "$work/many.zip") == 422 && $(json message < "$work/answer.json") == *"more files than a tree may hold"* ]] || fail "an archive with too many entries is refused: $(cat "$work/answer.json")"
[[ $(send "$work/huge.zip") == 422 && $(json message < "$work/answer.json") == *"unpacks to more than a tree may hold"* ]] || fail "an archive that unpacks to too much is refused: $(cat "$work/answer.json")"
"$harness" compose exec -T wordpress sh -c "! find /var/www/html/wp-content -name zeros.bin | grep -q ." || fail "the oversized archive was not unpacked"
"$harness" compose exec -T wordpress sh -c "! find /var/www/html/wp-content -name escaped.php | grep -q ." || fail "nothing was written outside the store"
# The deployment's token only selects code on that deployment's own routes, for an administrator.
[[ $(curl -s -H "X-TypedPress-Deployment: $id:$token" "$url/__tp/api/v1" | json data.name) == pluginlane && $(status -H "X-TypedPress-Deployment: $id:$token" "$url/__tp/api/v1/tasks") == 200 ]] || fail "a deployment token on another URL still gets the live build"
# Naming the deployment's route in the query string of another URL is not being on that route.
[[ $(status -H "X-TypedPress-Deployment: $id:$token" "$url/__tp/api/v1/tasks?rest_route=/typedpress-deploy/v1/deployments/$id/plan") == 200 ]] || fail "a deployment token with its route named in another URL's query still gets the live build"
# Nor does it make an application password sign anyone in outside the REST API.
[[ $(curl -s -u "$admin" -d 'action=heartbeat' "$url/wp-admin/admin-ajax.php?rest_route=/typedpress-deploy/v1/site") == *'"wp-auth-check":false'* ]] || fail "an application password signs nobody in on admin-ajax.php"
[[ $(status -u "$editor" -H "X-TypedPress-Deployment: $id:$token" "$api/deployments/$id/plan") == 403 ]] || fail "the token alone does not open the plan"
[[ $(status -u "$admin" -H "X-TypedPress-Deployment: $id:$(printf 'f%.0s' {1..64})" "$api/deployments/$id/plan") == 409 ]] || fail "a wrong token mounts nothing"
[[ $(status -u "$admin" -X POST -H "X-TypedPress-Deployment: $id:$token" "$api/deployments/$id/activate") == 409 ]] || fail "a deployment whose trees never arrived can't go live"

# Mounting a deployment loads PHP it uploaded, so nobody but a person who may deploy gets it loaded.
# This candidate is complete, and its app writes a marker file the moment its code is read: the
# compiled app with one line added, uploaded under the hash of the changed tree.
marker=/var/www/html/wp-content/uploads/typedpress-candidate-ran
marked=$(python3 - "$store" "$work" "$marker" <<'PY'
import glob, hashlib, json, os, struct, sys, zipfile
store, work, marker = sys.argv[1:]
path = max(glob.glob(store + "/build/*.json"), key=os.path.getmtime)
manifest = json.load(open(path))
tree = f"{store}/app/{manifest['app']}"
files = {}
for root, _, names in os.walk(tree):
    for name in names:
        full = os.path.join(root, name)
        files[os.path.relpath(full, tree)] = open(full, "rb").read()
schema = next(p for p in files if p.endswith("/tp/app/schema.php"))
# After the strict_types declaration, which PHP requires to be the file's first statement.
declared = b"declare(strict_types=1);"
assert files[schema].count(declared) == 1, "the compiled schema declares strict types once"
files[schema] = files[schema].replace(declared, declared + b" @file_put_contents(" + json.dumps(marker).encode() + b", 'ran');")
digest = hashlib.sha256()
for name in sorted(files, key=lambda p: p.encode()):
    digest.update(name.encode() + b"\0" + struct.pack(">Q", len(files[name])) + files[name])
manifest["app"] = digest.hexdigest()
with zipfile.ZipFile(work + "/marked.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in files.items():
        z.writestr(name, data)
print(json.dumps({"manifest": json.dumps(manifest)}))
PY
)
created=$(curl -s -u "$admin" -H 'Content-Type: application/json' -d "$marked" "$api/deployments")
mid=$(json deployment <<< "$created"); mtoken=$(json token <<< "$created")
[[ $(json need.app <<< "$created") == true && $(json need.runtime <<< "$created") == false ]] || fail "the marked build needs its app tree only: $created"
[[ $(curl -s -o "$work/answer.json" -w '%{http_code}' -u "$admin" -H 'Content-Type: application/octet-stream' --data-binary "@$work/marked.zip" "$api/deployments/$mid/trees/app?index=0&total=1&sha256=$(sha256sum "$work/marked.zip" | cut -d' ' -f1)") == 200 ]] || fail "the marked tree uploads: $(cat "$work/answer.json")"
ran() { "$harness" compose exec -T wordpress test -e "$marker"; }
mine=(-H "X-TypedPress-Deployment: $mid:$mtoken")
# With the token and nothing else, with the token as someone who may not deploy, on a route that
# does not exist, with the wrong method, and asking to mount it to run: its code is never read.
[[ $(status "${mine[@]}" "$api/deployments/$mid/plan") == 401 ]] || fail "the token alone is signed out"
[[ $(status "${mine[@]}" -X POST "$api/deployments/$mid/activate") == 401 ]] || fail "the token alone can't activate"
[[ $(status -u "$editor" "${mine[@]}" "$api/deployments/$mid/plan") == 403 && $(status -u "$editor" "${mine[@]}" -X POST "$api/deployments/$mid/activate") == 403 ]] || fail "an editor with the token is refused"
[[ $(status -u "$admin" "${mine[@]}" "$api/deployments/$mid/nothing-here") == 404 ]] || fail "a route the receiver doesn't have is not found"
[[ $(status -u "$admin" "${mine[@]}" -X POST "$api/deployments/$mid/plan") == 404 && $(status -u "$admin" "${mine[@]}" "$api/deployments/$mid/activate") == 404 ]] || fail "the plan is read and the activation is posted"
# A request WordPress dispatches somewhere else is not this deployment's request: its path names the
# plan and its `rest_route` or method override names something else.
[[ $(status -u "$admin" "${mine[@]}" "$api/deployments/$mid/plan?rest_route=/wp/v2/types") == 200 ]] || fail "WordPress serves the route named in the query"
[[ $(status -u "$admin" "${mine[@]}" -X POST "$api/deployments/$mid/activate?_method=DELETE") == 404 && $(status -u "$admin" "${mine[@]}" -H 'X-HTTP-Method-Override: DELETE' -X POST "$api/deployments/$mid/activate") == 404 ]] || fail "an overridden method is not the activation"
# An administrator's browser session is not enough either: the cookie alone, the cookie with a wrong
# nonce, and the cookie with the right one. Only an application password gets the build loaded.
nonce=$(browser nonce)
[[ ${#nonce} == 10 ]] || fail "wp-admin gives the session a REST nonce: $nonce"
[[ $(browser rest GET "$api/deployments/$mid/plan" "" "" "X-TypedPress-Deployment: $mid:$mtoken" | sed -n 1p) == 401 ]] || fail "a cookie without a nonce is signed out on the REST API"
[[ $(browser rest GET "$api/deployments/$mid/plan" "0000000000" "" "X-TypedPress-Deployment: $mid:$mtoken" | sed -n 1p) == 403 ]] || fail "a cookie with a wrong nonce is refused"
[[ $(browser rest GET "$api/deployments/$mid/plan" "$nonce" "" "X-TypedPress-Deployment: $mid:$mtoken" | sed -n 1p) == 409 ]] || fail "a browser session reaches the route and gets no build mounted"
[[ $(browser rest GET "$api/site" "$nonce" "" | sed -n 1p) == 200 ]] || fail "the same session may read the receiver"
if ran; then fail "a deployment's uploaded code ran for a request that may not deploy, or on a route that isn't its own"; fi
# The administrator's plan mounts it to inspect: the schema is read, so the marker is there now.
# A suspended account is refused on every sign-in by TypedPress Identity, which a build loads. The
# deployment's code is chosen before that, so the plugin reads the account itself: suspended, the
# administrator's token loads nothing, and the routes refuse the request. This app has no users kind,
# so identity's accounts table stands in here, with the columns the plugin reads.
accounts=wp_tp_identity_accounts
admin_id=$(wp user get admin --field=ID)
"$harness" sql "CREATE TABLE IF NOT EXISTS $accounts (wp_user_id bigint unsigned NOT NULL, status varchar(20) NOT NULL DEFAULT 'active', created_at bigint NOT NULL, PRIMARY KEY (wp_user_id))" >/dev/null
"$harness" sql "REPLACE INTO $accounts (wp_user_id, status, created_at) VALUES ($admin_id, 'suspended', 0)" >/dev/null
[[ $(status -u "$admin" "${mine[@]}" "$api/deployments/$mid/plan") == 409 ]] || fail "a suspended administrator's token mounts nothing"
if ran; then fail "a suspended account got a deployment's uploaded code loaded"; fi
"$harness" sql "UPDATE $accounts SET status = 'active' WHERE wp_user_id = $admin_id" >/dev/null
[[ $(status -u "$admin" "${mine[@]}" "$api/deployments/$mid/plan") == 200 ]] || fail "an active account in identity's table may inspect"
"$harness" compose exec -T wordpress rm -f "$marker"
"$harness" sql "DROP TABLE $accounts" >/dev/null
[[ $(status -u "$admin" "${mine[@]}" "$api/deployments/$mid/plan") == 200 ]] || fail "the administrator reads the plan"
ran || fail "the marker shows the candidate's code is read when an administrator inspects it"
"$harness" compose exec -T wordpress rm -f "$marker"
[[ $(curl -s "$url/__tp/api/v1" | json data.name) == pluginlane ]] || fail "the live app serves"
if ran; then fail "the live build is not the candidate"; fi
[[ $(wp option get tp_live_build) == "$second_build" ]] || fail "the refused requests left the live build"
ok "the receiver refuses other people, other trees, unsafe archives and tokens used elsewhere"

# ---- an earlier build, made live again from the screen -------------------------------------------
screen=$(browser screen 'admin.php?page=typedpress-setup' '<div class="wrap"><h1>TypedPress')
[[ $screen == *"${second_build:0:12} | admin | Deployed | Live"* && $screen == *"${tp_build:0:12} | admin | Deployed |"* ]] || fail "the TypedPress screen lists the live deployment and the first one: $screen"
browser press 'admin.php?page=typedpress-setup' "value=\"$tp_build\"" "live=$tp_build" >/dev/null
[[ $(wp option get tp_live_build) == "$tp_build" && $(status "$url/__tp/api/v1/tasks") == 404 ]] || fail "the earlier build's code is live again"
[[ $(curl -s "$url/__tp/api/v1/notes" | json data.0.title) == "Written before the second deploy" ]] || fail "making an earlier build live keeps content"
# The history is appended to, never rewritten: its last entry is the switch, to the first build.
last=$(wp option get tp_deployments --format=json | python3 -c 'import json,sys; h=json.load(sys.stdin); print(len(h), h[-1]["kind"], h[-1]["build"], h[0]["build"])')
[[ $last == "5 rollback $tp_build $tp_build" ]] || fail "the history records the switch after the four deployments: $last"
# The same list is a screen in TypedPress Admin, the admin a TypedPress app ships by default: its declaration,
# the list it reads and the action it runs are served to people who may deploy and nobody else.
nonce=$(browser nonce)
screen=$(browser rest GET "$url/wp-json/typedpress-admin/v1/screens/typedpress-deployments" "$nonce" "")
[[ $(sed -n 1p <<< "$screen") == 200 && $(sed 1d <<< "$screen" | json title) == Deployments && $(sed 1d <<< "$screen" | json actions.0.ability) == tp/deployments-live ]] || fail "TypedPress Admin has a Deployments screen with Make live: $screen"
[[ $(browser get 'admin.php?page=typedpress-admin') == *'screens/typedpress-deployments'* ]] || fail "TypedPress Admin's sidebar lists the Deployments screen"
abilities="$url/wp-json/wp-abilities/v1/abilities"
rows=$(curl -s -u "$admin" "$abilities/tp/deployments/run")
[[ $(json deployments.0.how <<< "$rows") == "Made live again" && $(json deployments.0.state <<< "$rows") == Live && $(json deployments.0.build <<< "$rows") == "$tp_build" && $(json deployments.1.state <<< "$rows") == Stored && $(json deployments.0.by <<< "$rows") == admin ]] || fail "the list is the history, newest first, with what each build is now: $rows"
[[ $(status -u "$editor" "$abilities/tp/deployments/run") == 403 && $(status -u "$editor" "$url/wp-json/typedpress-admin/v1/screens/typedpress-deployments") == 403 ]] || fail "the list and its screen are for people who may deploy"
[[ $(status -u "$editor" -X POST -H 'Content-Type: application/json' -d "{\"input\":{\"build\":\"$second_build\"}}" "$abilities/tp/deployments-live/run") == 403 && $(wp option get tp_live_build) == "$tp_build" ]] || fail "an editor can't make a build live"
# Made live from TypedPress Admin's action, then back, so the rest of the lane continues from the same state.
[[ $(curl -s -u "$admin" -X POST -H 'Content-Type: application/json' -d "{\"input\":{\"build\":\"$second_build\"}}" "$abilities/tp/deployments-live/run" | json live) == "$second_build" && $(wp option get tp_live_build) == "$second_build" && $(status "$url/__tp/api/v1/tasks") == 200 ]] || fail "Make live in TypedPress Admin switches the code"
[[ $(curl -s -u "$admin" -X POST -H 'Content-Type: application/json' -d "{\"input\":{\"build\":\"$(printf 'a%.0s' {1..64})\"}}" "$abilities/tp/deployments-live/run" | json code) == tp_unknown_build ]] || fail "a build that was never live here can't be made live"
[[ $(curl -s -u "$admin" -X POST -H 'Content-Type: application/json' -d "{\"input\":{\"build\":\"$tp_build\"}}" "$abilities/tp/deployments-live/run" | json live) == "$tp_build" && $(status "$url/__tp/api/v1/tasks") == 404 ]] || fail "and back to the first build"
[[ $(wp option get tp_deployments --format=json | python3 -c 'import json,sys; h=json.load(sys.stdin); print(len(h), h[-1]["kind"])') == "7 rollback" ]] || fail "each switch is in the history"
# Neither ability is offered to agents.
[[ $(curl -s -u "$admin" "$url/wp-json/wp-abilities/v1/abilities?per_page=100" | python3 -c 'import json,sys; print(sorted(a["name"] for a in json.load(sys.stdin) if a["name"].startswith("tp/")))') == "['tp/deployments', 'tp/deployments-live']" ]] || fail "the two abilities are registered"
# The next push is compared with what the database holds (the last deployment), so nothing migrates twice.
out=$(push) || fail "a push after making an earlier build live: $out"
[[ $out != *"run migration"* && $out == *"live:"* && $(status "$url/__tp/api/v1/tasks") == 200 ]] || fail "it deploys the code without running a migration again: $out"
ok "an earlier build is made live again from the TypedPress screen and from TypedPress Admin, and the next push migrates nothing twice"

# ---- the site keeps serving when the app can't run -----------------------------------------------
wp plugin deactivate action-scheduler >/dev/null
[[ $(status "$url/") == 200 && $(status "$url/__tp/api/v1") == 404 ]] || fail "without a plugin the app needs, WordPress serves and the app does not"
[[ $(browser screen 'admin.php?page=typedpress-setup' '<div class="wrap"><h1>TypedPress') == *"The app is not running."* ]] || fail "the TypedPress screen says the app is not running"
wp plugin activate action-scheduler >/dev/null
[[ $(curl -s "$url/__tp/api/v1" | json data.name) == pluginlane ]] || fail "the app runs again once the plugin is back"
ok "a build that can't mount leaves WordPress serving and is reported on the TypedPress screen"

# ---- a plugin a build needs, installed while an app is live ---------------------------------------
# A live app refuses plugin installs in wp-admin (its hardening), and the receiver still installs
# what TypedPress pins: Polylang, which only an app with `locales` needs, at its pinned checksum.
pins() { curl -s -o "$work/answer.json" -w '%{http_code}' -u "$admin" -H 'Content-Type: application/json' -d "$1" "$api/requirements"; }
polylang=$(python3 -c 'import json,sys; p=json.load(open(sys.argv[1]))["plugins"]["polylang"]; print(json.dumps({"pins":{"polylang":p}}))' "$repo/tests/fixtures/platform.json")
browser screen 'plugin-install.php' '<body' > "$work/installer.txt"
[[ $(sed -n 1p "$work/installer.txt") == 403 ]] || fail "with an app live, wp-admin's plugin installer is refused: $(sed -n 1,3p "$work/installer.txt")"
[[ $(pins "${polylang/\"sha256\": \"/\"sha256\": \"0}") != 200 ]] || fail "a pin with a malformed checksum is refused"
wrong=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); d["pins"]["polylang"]["sha256"]="0"*64; print(json.dumps(d))' "$polylang")
[[ $(pins "$wrong") == 502 && $(json message < "$work/answer.json") == *"is not the file TypedPress pins; nothing was installed"* ]] || fail "a download with another checksum is not installed: $(cat "$work/answer.json")"
[[ $(wp plugin is-installed polylang && echo yes || echo no) == no ]] || fail "the refused download left nothing behind"
[[ $(pins '{"pins":{"hello-dolly":{"version":"1.7.2","sha256":"'"$(printf '0%.0s' {1..64})"'"}}}') == 502 && $(json message < "$work/answer.json") == *"is not a plugin TypedPress installs"* ]] || fail "only the plugins TypedPress depends on can be installed: $(cat "$work/answer.json")"
[[ $(pins "$polylang") == 200 && $(wp plugin get polylang --field=status) == active ]] || fail "the receiver installs and activates a pinned plugin: $(cat "$work/answer.json")"
[[ $(curl -s "$url/__tp/api/v1" | json data.name) == pluginlane ]] || fail "the app keeps running after the install"
# Polylang would send the next wp-admin page to its setup wizard; the owner's next page is their own.
[[ $(browser screen 'admin.php?page=typedpress-setup' '<div class="wrap"><h1>TypedPress') == *"Deployments"* ]] || fail "a plugin TypedPress installed doesn't send wp-admin to its own setup wizard"
ok "with an app live, the receiver installs a pinned plugin by checksum and nothing else"

# ---- the site names code as live and can't run it -------------------------------------------------
# The live build's runtime tree goes missing from the store. The same source is then not "already
# running": push sends the tree again and the app comes back.
live_build=$(wp option get tp_live_build)
key=$(wp option get tp_store_key)
runtime_tree=$("$harness" compose exec -T wordpress sh -c "sed -n 's/.*\"runtime\": *\"\([0-9a-f]*\)\".*/\1/p' /var/www/html/wp-content/typedpress-store-$key/build/$live_build.json")
[[ ${#runtime_tree} == 64 ]] || fail "the live build names its runtime tree: $runtime_tree"
"$harness" compose exec -T wordpress mv "/var/www/html/wp-content/typedpress-store-$key/runtime/$runtime_tree" "/var/www/html/wp-content/typedpress-store-$key/.tmp/lost"
[[ $(status "$url/") == 200 && $(status "$url/__tp/api/v1") == 404 ]] || fail "without its runtime tree the app does not run and WordPress serves"
# Storing that tree would run the live build again with no deployment, so a dry run doesn't send it.
out=$(push --dry-run) || fail "a dry run to a site that lost a tree: $out"
[[ $out == *"has lost the runtime tree its live build runs"*"nothing was uploaded"* && $out != *"uploading the runtime tree"* ]] || fail "a dry run stops before restoring the live build's tree: $out"
"$harness" compose exec -T wordpress test ! -e "/var/www/html/wp-content/typedpress-store-$key/runtime/$runtime_tree" || fail "a dry run leaves the live build's tree missing"
[[ $(status "$url/__tp/api/v1") == 404 ]] || fail "after a dry run the live build still does not run"
out=$(push) || fail "a push to a site that lost a tree: $out"
[[ $out == *"has this code and is not running it"*"uploading the runtime tree"*"live:"* ]] || fail "push sends the missing tree again: $out"
[[ $(curl -s "$url/__tp/api/v1" | json data.name) == pluginlane && $(curl -s "$url/__tp/api/v1/notes" | json data.0.title) == "Written before the second deploy" ]] || fail "the app runs again with its content"
# The last deployment's manifest goes missing: the site still names that build as the baseline (the
# database is at its schema) and says its files are gone. It never offers an older build instead.
base=$(curl -s -u "$admin" "$api/site" | json baseline)
[[ $base == "$(wp option get tp_live_build)" ]] || fail "the last deployment is the baseline: $base"
"$harness" compose exec -T wordpress mv "/var/www/html/wp-content/typedpress-store-$key/build/$base.json" "/var/www/html/wp-content/typedpress-store-$key/.tmp/held.json"
[[ $(curl -s -u "$admin" "$api/site" | json baseline) == "$base" ]] || fail "a baseline whose manifest is gone is still the baseline"
[[ $(curl -s -o "$work/answer.json" -w '%{http_code}' -u "$admin" "$api/builds/$base/baseline") == 404 && $(json message < "$work/answer.json") == *"no longer in its build store"* ]] || fail "the site says the baseline's files are gone: $(cat "$work/answer.json")"
if out=$(push); then fail "a push compiled against something other than the last deployment: $out"; fi
[[ $out == *"no longer in its build store"* ]] || fail "push stops and says why: $out"
"$harness" compose exec -T wordpress mv "/var/www/html/wp-content/typedpress-store-$key/.tmp/held.json" "/var/www/html/wp-content/typedpress-store-$key/build/$base.json"
[[ $(curl -s "$url/__tp/api/v1" | json data.name) == pluginlane ]] || fail "the app runs again once the manifest is back"
ok "a site that lost a stored tree gets it again from the next push, and a lost baseline is reported, not replaced"

# ---- typedpress logout, and signing in again with an app live ------------------------------------------
"$first" logout "$url" >/dev/null
if out=$(push); then fail "pushed after typedpress logout: $out"; fi
[[ $out == *"not signed in to $url"* ]] || fail "after typedpress logout a push asks to sign in: $out"
ok "typedpress logout forgets the credential on this machine"

# A running app scopes the application passwords approved in wp-admin for agents (read-only), and a
# scoped one can't deploy. The command line's own approval is left unscoped, so signing in again
# works; any other approval on the same screen is still scoped.
(cd "$project" && "$first" login "$url" --no-browser > "$work/login2.out" 2>&1; echo "exit $?" >> "$work/login2.out") &
for _ in $(seq 1 100); do grep -q 'authorize-application' "$work/login2.out" 2>/dev/null && break; sleep 0.1; done
approve=$(grep -o "$url/wp-admin/authorize-application.php[^ ]*" "$work/login2.out") || fail "typedpress login prints the approval link: $(cat "$work/login2.out")"
page=$(browser get "${approve#"$url/wp-admin/"}")
[[ $page == *"This is the TypedPress command line"* && $page != *"typedpress-scope-write"* ]] || fail "the approval screen says what the command line gets and offers no agent scope"
curl -s "$(browser approve "$approve")" >/dev/null
wait
[[ $(cat "$work/login2.out") == *"signed in to $url as admin"*"exit 0" ]] || fail "typedpress login works with an app live: $(cat "$work/login2.out")"
out=$(push) || fail "a push with the new credential: $out"
[[ $out == *"already runs this code; nothing to deploy"* ]] || fail "the credential approved with an app live deploys: $out"
# A real browser approves through the screen's script: core's REST route, with the session's cookie
# and nonce. That is the path the running app scopes. The command line's own approval stays unscoped
# there, and any other application's is scoped as before.
nonce=$(browser nonce)
passwords="$url/wp-json/wp/v2/users/me/application-passwords"
made=$(browser rest POST "$passwords" "$nonce" '{"name":"TypedPress CLI (script)","app_id":"0d1f6c5e-3b55-4f0e-9c2a-6a1e5f1b7a10"}')
[[ $(sed -n 1p <<< "$made") == 201 && $(sed 1d <<< "$made" | json tp_scope) == null ]] || fail "the command line's approval through the screen's script is unscoped: $made"
[[ $(status -u "admin:$(sed 1d <<< "$made" | json password)" "$api/site") == 200 ]] || fail "that credential deploys"
made=$(browser rest POST "$passwords" "$nonce" '{"name":"Some agent","app_id":"11111111-2222-4333-8444-555555555555"}')
[[ $(sed -n 1p <<< "$made") == 201 && $(sed 1d <<< "$made" | json tp_scope.write) == false ]] || fail "another application's approval is scoped read-only: $made"
[[ $(status -u "admin:$(sed 1d <<< "$made" | json password)" "$api/site") == 403 ]] || fail "a scoped credential can't deploy"
other=$(browser get "authorize-application.php?app_name=Agent&app_id=11111111-2222-4333-8444-555555555555&success_url=http%3A%2F%2F127.0.0.1%3A9%2Fcallback")
[[ $other == *"typedpress-scope-write"* && $other != *"This is the TypedPress command line"* ]] || fail "another application's approval keeps the agent scope form"
elsewhere=$(browser get "authorize-application.php?app_name=TypedPress&app_id=0d1f6c5e-3b55-4f0e-9c2a-6a1e5f1b7a10&success_url=https%3A%2F%2Fexample.test%2Fcallback")
[[ $elsewhere == *"typedpress-scope-write"* && $elsewhere != *"This is the TypedPress command line"* ]] || fail "the command line's name with a callback that isn't this machine keeps the scope form"
ok "typedpress login works again while an app is live, and other approvals stay scoped"
echo "plugin lane: all checks passed"
