#!/usr/bin/env bash
# The First plugin on a stock WordPress, the way a site owner and a developer use it:
#   wp-admin: upload first.zip and activate it, which installs the plugins First depends on
#   CLI:      first login <url> (approved in the browser), first push, again with a schema change
# then what the site refuses, making an earlier build live again from the screen, and what the
# plugin supplies as the host (the app's variables, mail). Nothing is installed by the harness: the
# site starts with WordPress and its users only (`up --bare`). Assertions are on HTTP answers, the
# database and what the commands print and exit with, never on source text.
#
#   FIRST_WP_PROJECT=first-wp-plugin FIRST_WP_PORT=8905 tests/wp/plugin/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
harness="$here/../harness.sh"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
first="$target/debug/first"
export FIRST_WP_PROJECT="${FIRST_WP_PROJECT:-first-wp-plugin}"
export FIRST_WP_PORT="${FIRST_WP_PORT:-8905}"
work="$(mktemp -d)"
cleanup() {
  # The web server wrote the plugins and the build store as its own user; hand them back before removing.
  "$harness" compose exec -T wordpress chown -R "$(id -u):$(id -g)" /var/www/html/wp-content >/dev/null 2>&1 || true
  # The stack's plugins directory is under $work, so a kept stack keeps it too.
  if [[ ${FIRST_WP_KEEP:-0} == 1 ]]; then echo "kept: $work" >&2; return; fi
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
export FIRST_CONFIG_DIR="$work/config"
unset FIRST_APP_PASSWORD FIRST_TOKEN
project="$work/project"
step() { node "$here/steps.mjs" "$1" > "$project/first.config.ts"; }
push() { (cd "$project" && "$first" push "$@" 2>&1); }

mkdir -p "$work/content/plugins" "$project/first/app/about" "$project/public"
"$harness" down
"$harness" up --bare --wp-content "$work/content" > "$work/harness.json"
url=$(json url < "$work/harness.json")
api="$url/wp-json/first-deploy/v1"
admin="admin:$(json users.admin.appPassword < "$work/harness.json")"
editor="editor:$(json users.editor.appPassword < "$work/harness.json")"
# The disposable stack's web server doesn't own WordPress's files, so core would ask for FTP details.
wp config set FS_METHOD direct >/dev/null
# What a site owner puts in wp-config.php for the app's `process.env.GREETING`.
wp config set FIRST_VARIABLES "['GREETING' => 'hello from wp-config']" --raw >/dev/null

# ---- wp-admin: one plugin, uploaded and activated ---------------------------------------------
"$first" plugin --out "$work/first.zip" >/dev/null
[[ $(wp plugin list --status=active --format=count) == 0 ]] || fail "the site starts with no active plugin"
[[ $("$first" login "$url" --no-browser 2>&1) == *"does not have the First plugin active"* ]] || fail "first login names the missing plugin on a site without it"
browser login admin first-test-admin
browser upload-plugin "$work/first.zip"
wp plugin is-active first || fail "uploading and activating first.zip activates the First plugin"
ok "first.zip uploads and activates through wp-admin's Upload Plugin"

# Activating First installed and activated what it depends on, each pinned by checksum.
active=$(wp plugin list --status=active --field=name | sort | tr '\n' ' ')
[[ $active == "action-scheduler first mcp-adapter secure-custom-fields two-factor " ]] || fail "activating First installs and activates the four pinned plugins: $active"
screen=$(browser screen 'admin.php?page=first-setup' '<div class="wrap"><h1>First')
[[ $screen == *"First installed and activated the plugins it needs: Secure Custom Fields 6.9.7, Action Scheduler 4.2.0, MCP Adapter 0.7.1, Two Factor 0.17.0."* ]] || fail "the First screen says what activation installed: $screen"
[[ $screen == *"No First app is deployed to this site yet."* && $screen != *"Not installed"* && $screen == *"first login $url"* ]] || fail "the First screen is ready and shows the commands: $screen"
[[ $(status "$url/") == 200 && $(status "$url/__first/api/v1") == 404 ]] || fail "before a deployment WordPress serves and First's API doesn't"
# A dependency that goes missing later is named on the screen and on other wp-admin screens, and the
# screen's button brings it back.
wp plugin deactivate two-factor >/dev/null
[[ $(browser screen 'index.php' 'wpbody-content') == *"needs a few plugins before an app can be deployed here"* ]] || fail "wp-admin points an administrator at the First screen"
[[ $(browser screen 'admin.php?page=first-setup' '<div class="wrap"><h1>First') == *"Two Factor | 0.17.0 or newer | 0.17.0 (inactive) | Not installed"* ]] || fail "the First screen names the inactive plugin"
pressed=$(browser press 'admin.php?page=first-setup' 'name="install"' install=1)
[[ $(json url <<< "$pressed") == *"page=first-setup" && $(wp plugin is-active two-factor && echo active) == active ]] || fail "the screen's button activates it again: $pressed"
ok "activating First installs the pinned plugins from wordpress.org; the screen shows the commands and repairs a missing plugin"

# ---- the command line: first login, approved in the browser --------------------------------------
step initial
cat > "$project/first/app/about/page.tsx" <<'TSX'
import mark from "./mark.svg";

export default function About() {
  return <main><h1>About this app</h1><img src={mark} alt="" width={16} height={16} /></main>;
}
TSX
echo '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7"/></svg>' > "$project/first/app/about/mark.svg"
echo 'served from public/' > "$project/public/hello.txt"
[[ $(push) == *"no site to deploy to"* ]] || fail "first push before first login says how to pick a site"
(cd "$project" && "$first" login "$url" --no-browser > "$work/login.out" 2>&1; echo "exit $?" >> "$work/login.out") &
for _ in $(seq 1 100); do grep -q 'authorize-application' "$work/login.out" 2>/dev/null && break; sleep 0.1; done
approve=$(grep -o "$url/wp-admin/authorize-application.php[^ ]*" "$work/login.out") || fail "first login prints the approval link: $(cat "$work/login.out")"
callback=$(browser approve "$approve")
[[ $callback == http://127.0.0.1:*"/callback?"* ]] || fail "WordPress sends the browser back to the command line on 127.0.0.1"
[[ $(curl -s "$callback") == *"Signed in."* ]] || fail "the command line's callback answers the browser"
wait
[[ $(cat "$work/login.out") == *"signed in to $url as admin"*"exit 0" ]] || fail "first login finishes: $(cat "$work/login.out")"
[[ $(stat -c %a "$work/config/sites.json") == 600 ]] || fail "the stored credential is readable by its owner only"
[[ $(wp user application-password list admin --field=name | grep -c '^First CLI') == 1 ]] || fail "the approval created one application password named for the command line"
ok "first login gets an application password through WordPress's Authorize Application screen"

# ---- first push ----------------------------------------------------------------------------------
out=$(push --dry-run) || fail "a dry run: $out"
[[ $out == *"run migration 0001_init"* && $out == *"--dry-run"* ]] || fail "a dry run uploads and prints the plan: $out"
[[ $(status "$url/__first/api/v1") == 404 && -z $(wp option get first_live_build 2>/dev/null) ]] || fail "a dry run makes nothing live"
out=$(push) || fail "the first deploy: $out"
[[ $out == *"the site already has this runtime tree"* && $out == *"applied migration 0001_init"* && $out == *"live: $url now runs pluginlane"* ]] || fail "the first deploy reuses the uploaded trees and goes live: $out"
first_build=$(wp option get first_live_build)
[[ $(curl -s "$url/__first/api/v1" | json data.name) == pluginlane ]] || fail "First's API answers for the deployed app"
curl -s "$url/about" > "$work/about.html"
[[ $(cat "$work/about.html") == *"<h1>About this app</h1>"* ]] || fail "a first/app/ page renders"
# The image the page imports is the app's own file: its URL is under the public copy, and answers.
image=$(grep -o -m1 "$url/wp-content/first-assets/app/[^\"' ]*\.svg" "$work/about.html" || true)
[[ -n $image && $(curl -s "$image") == *"<circle"* ]] || fail "the page's imported image is served from wp-content/first-assets: ${image:-not on the page}"
[[ $(curl -s "$url/hello.txt") == "served from public/" ]] || fail "public/ is served at the site root"
note=$(curl -s -u "$editor" -H 'Content-Type: application/json' -d '{"title":"Written before the second deploy"}' "$url/__first/api/v1/notes")
[[ $(json data.title <<< "$note") == "Written before the second deploy" ]] || fail "an editor writes through the API: $note"
wp first insert entries '{"body":"a row before the second deploy"}' >/dev/null
ok "first push compiles, uploads, shows the plan and makes the app live"

# What the plugin supplies as the host: the app's variables and mail delivery.
[[ $(curl -s -X POST -H 'Content-Type: application/json' -d '{}' "$url/__first/api/v1/actions/greeting" | json data.greeting) == "hello from wp-config" ]] || fail "process.env reads FIRST_VARIABLES from wp-config.php"
curl -s -u "$editor" -H 'Content-Type: application/json' -d '{"to":"reader@example.test"}' "$url/__first/api/v1/actions/welcome" | json data.id >/dev/null || fail "the app queues a message"
wp first jobs tick >/dev/null
[[ $("$harness" compose exec -T wordpress cat /var/www/html/wp-content/first-test-mail/reader@example.test.txt) == "Sent by the deployed app." ]] || fail "the app's mail leaves through wp_mail"
ok "the app reads its variables from wp-config.php and sends mail through WordPress"

# First Admin's page names its scripts under the public copy, and they answer; the store itself is
# never served.
key=$(wp option get first_store_key)
browser get 'admin.php?page=first-admin' > "$work/admin.html"
asset=$(grep -o -m1 "$url/wp-content/first-assets/runtime/[^\"'? ]*\.js" "$work/admin.html" || true)
asset=${asset%%$'\n'*}
[[ -n $asset && $(status "$asset") == 200 ]] || fail "First Admin loads a script from wp-content/first-assets: ${asset:-none on the page}"
leaked=$("$harness" compose exec -T wordpress sh -c "find /var/www/html/wp-content/first-assets -type f \( -name '*.php' -o -name '*.sql' -o -name '*.json' \) | wc -l")
[[ $leaked == 0 ]] || fail "the public copy holds no PHP, SQL or JSON"
[[ $(status "$url/wp-content/first-store-$key/build/$first_build.json") == 403 ]] || fail "the build store is not served"
ok "browser files are served from first-assets; the build store is private"

# ---- a second version: a migration, and the content written before it ---------------------------
step additive
out=$(push) || fail "the second deploy: $out"
[[ $out == *"the site already has this runtime tree"* && $out == *"uploading the app tree"* && $out == *"run migration 0002"* && $out == *"live:"* ]] || fail "the second deploy sends only the app tree and migrates: $out"
second_build=$(wp option get first_live_build)
[[ $second_build != "$first_build" ]] || fail "the second deploy is a new build"
[[ $(curl -s "$url/__first/api/v1/notes" | json data.0.title) == "Written before the second deploy" && $(status "$url/__first/api/v1/tasks") == 200 ]] || fail "content is kept and the new kind answers"
[[ $(wp first find entries | json data.0.state) == open ]] || fail "the migration gave the existing row the new column's default"
[[ $(push) == *"already runs this code; nothing to deploy"* ]] || fail "pushing the same source again deploys nothing"
[[ $(wp option get first_live_build) == "$second_build" ]] || fail "pushing the same source leaves the live build"
ok "a second push applies only the new migration and keeps content"

# ---- push keeps the site's plugin and the build's plugins current --------------------------------
# A live First app turns off plugin installs in wp-admin, so the command line does both. The site's
# plugin is made another one here by changing the hash it reports; push replaces it with its own.
"$harness" compose exec -T wordpress sed -i "s/define('FIRST_PLUGIN_HASH', '[0-9a-f]*')/define('FIRST_PLUGIN_HASH', '$(printf '0%.0s' {1..64})')/" /var/www/html/wp-content/plugins/first/first.php
[[ $(curl -s -u "$admin" "$api/site" | json pluginHash) == 0000* ]] || fail "the site reports the changed plugin"
out=$(push) || fail "a push to a site with another First plugin: $out"
[[ $out == *"updated the First plugin on the site"* && $(curl -s -u "$admin" "$api/site" | json pluginHash) != 0000* ]] || fail "push replaces the site's plugin with the one it carries: $out"
[[ $(curl -s "$url/__first/api/v1" | json data.name) == pluginlane ]] || fail "the app keeps running across the plugin update"
wp plugin deactivate two-factor >/dev/null
out=$(push) || fail "a push to a site missing a plugin the build needs: $out"
[[ $out == *"the site is missing plugins this app needs: two-factor 0.17.0 (found 0.17.0, inactive)"*"installed Two Factor 0.17.0 on the site"* && $(wp plugin is-active two-factor && echo active) == active ]] || fail "push names the plugin the build needs and brings it back: $out"
ok "push updates the site's First plugin and installs the plugins a build needs, with an app live"

# ---- a sealed app ---------------------------------------------------------------------------------
# A sealed app lets only listed plugins run. The First plugin is one of First's own: it is on every
# sealed list, so the site that was deployed to reports nothing unlisted and keeps taking deploys.
step sealed
out=$(push) || fail "deploying the sealed app: $out"
sealed=$(curl -s -u "$admin" "$url/__first/api/v1" | json data.runtime.wp.sealed.plugins)
[[ $sealed == "[]" ]] || fail "a sealed site deployed through the plugin reports no unlisted plugin: $sealed"
if wp plugin activate hello >/dev/null 2>&1; then fail "a sealed site activated a plugin that is not on its list"; fi
step additive
out=$(push) || fail "deploying to the sealed site: $out"
[[ $out == *"live:"* && $(wp plugin activate hello >/dev/null 2>&1 && echo yes) == yes ]] || fail "the sealed site takes the next deployment, which unseals it: $out"
wp plugin deactivate hello >/dev/null
# The build the rest of the lane compares with: the one that is live now.
second_build=$(wp option get first_live_build)
ok "a sealed app lists the First plugin, and the sealed site keeps taking deployments"

# ---- what the site refuses -----------------------------------------------------------------------
step required
if out=$(push); then fail "a required field on a kind with rows was deployed: $out"; fi
[[ $out == *"refuses this build; nothing changed there"*"entries.author is required, and 1 rows have no value for it"*"Change first.config.ts and push again"* ]] || fail "the schema check's refusal names the field and the rows: $out"
[[ $(wp option get first_live_build) == "$second_build" ]] || fail "a refused build is not made live"
[[ $(status "$url/__first/api/v1/tasks") == 200 ]] || fail "the live app keeps serving after a refused deploy"
step additive
ok "a build the schema check refuses is not installed, and the live build stays"

if out=$(cd "$project" && FIRST_APP_PASSWORD="$editor" "$first" push 2>&1); then fail "an editor deployed: $out"; fi
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

# Pushes that open a deployment at the same moment each keep theirs. The manifest is the last
# compiled build's (the refused `required` step, compiled against the live build).
latest=$(python3 -c 'import glob,json,os,sys; p=max(glob.glob(sys.argv[1]+"/build/*.json"), key=os.path.getmtime); print(json.dumps({"manifest": open(p).read()}))' "$project/.first/store")
for n in 1 2 3 4 5 6; do curl -s -u "$admin" -H 'Content-Type: application/json' -d "$latest" "$api/deployments" > "$work/open-$n.json" & done
wait
for n in 1 2 3 4 5 6; do
  opened=$(json deployment < "$work/open-$n.json") || fail "deployment $n opened: $(cat "$work/open-$n.json")"
  [[ $(curl -s -u "$admin" "$api/deployments/$opened/plan" | json code) == first_not_mounted ]] || fail "deployment $n of six opened at once is still open"
done

# The receiver directly: a deployment's trees must be the ones its manifest names.
store="$project/.first/store"
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
[[ $(curl -s -o "$work/answer.json" -w '%{http_code}' -u "$admin" -H 'Content-Type: application/json' -d "$stale" "$api/deployments") == 409 && $(json code < "$work/answer.json") == first_stale ]] || fail "a build compiled against another baseline is refused: $(cat "$work/answer.json")"
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
[[ $(curl -s -H "X-First-Deployment: $id:$token" "$url/__first/api/v1" | json data.name) == pluginlane && $(status -H "X-First-Deployment: $id:$token" "$url/__first/api/v1/tasks") == 200 ]] || fail "a deployment token on another URL still gets the live build"
# Naming the deployment's route in the query string of another URL is not being on that route.
[[ $(status -H "X-First-Deployment: $id:$token" "$url/__first/api/v1/tasks?rest_route=/first-deploy/v1/deployments/$id/plan") == 200 ]] || fail "a deployment token with its route named in another URL's query still gets the live build"
# Nor does it make an application password sign anyone in outside the REST API.
[[ $(curl -s -u "$admin" -d 'action=heartbeat' "$url/wp-admin/admin-ajax.php?rest_route=/first-deploy/v1/site") == *'"wp-auth-check":false'* ]] || fail "an application password signs nobody in on admin-ajax.php"
[[ $(status -u "$editor" -H "X-First-Deployment: $id:$token" "$api/deployments/$id/plan") == 403 ]] || fail "the token alone does not open the plan"
[[ $(status -u "$admin" -H "X-First-Deployment: $id:$(printf 'f%.0s' {1..64})" "$api/deployments/$id/plan") == 409 ]] || fail "a wrong token mounts nothing"
[[ $(status -u "$admin" -X POST -H "X-First-Deployment: $id:$token" "$api/deployments/$id/activate") == 409 ]] || fail "a deployment whose trees never arrived can't go live"

# Mounting a deployment loads PHP it uploaded, so nobody but a person who may deploy gets it loaded.
# This candidate is complete, and its app writes a marker file the moment its code is read: the
# compiled app with one line added, uploaded under the hash of the changed tree.
marker=/var/www/html/wp-content/uploads/first-candidate-ran
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
schema = next(p for p in files if p.endswith("/first/app/schema.php"))
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
mine=(-H "X-First-Deployment: $mid:$mtoken")
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
[[ $(browser rest GET "$api/deployments/$mid/plan" "" "" "X-First-Deployment: $mid:$mtoken" | sed -n 1p) == 401 ]] || fail "a cookie without a nonce is signed out on the REST API"
[[ $(browser rest GET "$api/deployments/$mid/plan" "0000000000" "" "X-First-Deployment: $mid:$mtoken" | sed -n 1p) == 403 ]] || fail "a cookie with a wrong nonce is refused"
[[ $(browser rest GET "$api/deployments/$mid/plan" "$nonce" "" "X-First-Deployment: $mid:$mtoken" | sed -n 1p) == 409 ]] || fail "a browser session reaches the route and gets no build mounted"
[[ $(browser rest GET "$api/site" "$nonce" "" | sed -n 1p) == 200 ]] || fail "the same session may read the receiver"
if ran; then fail "a deployment's uploaded code ran for a request that may not deploy, or on a route that isn't its own"; fi
# The administrator's plan mounts it to inspect: the schema is read, so the marker is there now.
[[ $(status -u "$admin" "${mine[@]}" "$api/deployments/$mid/plan") == 200 ]] || fail "the administrator reads the plan"
ran || fail "the marker shows the candidate's code is read when an administrator inspects it"
"$harness" compose exec -T wordpress rm -f "$marker"
[[ $(curl -s "$url/__first/api/v1" | json data.name) == pluginlane ]] || fail "the live app serves"
if ran; then fail "the live build is not the candidate"; fi
[[ $(wp option get first_live_build) == "$second_build" ]] || fail "the refused requests left the live build"
ok "the receiver refuses other people, other trees, unsafe archives and tokens used elsewhere"

# ---- an earlier build, made live again from the screen -------------------------------------------
screen=$(browser screen 'admin.php?page=first-setup' '<div class="wrap"><h1>First')
[[ $screen == *"${second_build:0:12} | admin | Deployed | Live"* && $screen == *"${first_build:0:12} | admin | Deployed |"* ]] || fail "the First screen lists the live deployment and the first one: $screen"
browser press 'admin.php?page=first-setup' "value=\"$first_build\"" "live=$first_build" >/dev/null
[[ $(wp option get first_live_build) == "$first_build" && $(status "$url/__first/api/v1/tasks") == 404 ]] || fail "the earlier build's code is live again"
[[ $(curl -s "$url/__first/api/v1/notes" | json data.0.title) == "Written before the second deploy" ]] || fail "making an earlier build live keeps content"
# The history is appended to, never rewritten: its last entry is the switch, to the first build.
last=$(wp option get first_deployments --format=json | python3 -c 'import json,sys; h=json.load(sys.stdin); print(len(h), h[-1]["kind"], h[-1]["build"], h[0]["build"])')
[[ $last == "5 rollback $first_build $first_build" ]] || fail "the history records the switch after the four deployments: $last"
# The next push is compared with what the database holds (the last deployment), so nothing migrates twice.
out=$(push) || fail "a push after making an earlier build live: $out"
[[ $out != *"run migration"* && $out == *"live:"* && $(status "$url/__first/api/v1/tasks") == 200 ]] || fail "it deploys the code without running a migration again: $out"
ok "an earlier build is made live again from the First screen, and the next push migrates nothing twice"

# ---- the site keeps serving when the app can't run -----------------------------------------------
wp plugin deactivate action-scheduler >/dev/null
[[ $(status "$url/") == 200 && $(status "$url/__first/api/v1") == 404 ]] || fail "without a plugin the app needs, WordPress serves and the app does not"
[[ $(browser screen 'admin.php?page=first-setup' '<div class="wrap"><h1>First') == *"The app is not running."* ]] || fail "the First screen says the app is not running"
wp plugin activate action-scheduler >/dev/null
[[ $(curl -s "$url/__first/api/v1" | json data.name) == pluginlane ]] || fail "the app runs again once the plugin is back"
ok "a build that can't mount leaves WordPress serving and is reported on the First screen"

# ---- a plugin a build needs, installed while an app is live ---------------------------------------
# A live app refuses plugin installs in wp-admin (its hardening), and the receiver still installs
# what First pins: Polylang, which only an app with `locales` needs, at its pinned checksum.
pins() { curl -s -o "$work/answer.json" -w '%{http_code}' -u "$admin" -H 'Content-Type: application/json' -d "$1" "$api/requirements"; }
polylang=$(python3 -c 'import json,sys; p=json.load(open(sys.argv[1]))["plugins"]["polylang"]; print(json.dumps({"pins":{"polylang":p}}))' "$repo/tests/fixtures/platform.json")
browser screen 'plugin-install.php' '<body' > "$work/installer.txt"
[[ $(sed -n 1p "$work/installer.txt") == 403 ]] || fail "with an app live, wp-admin's plugin installer is refused: $(sed -n 1,3p "$work/installer.txt")"
[[ $(pins "${polylang/\"sha256\": \"/\"sha256\": \"0}") != 200 ]] || fail "a pin with a malformed checksum is refused"
wrong=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); d["pins"]["polylang"]["sha256"]="0"*64; print(json.dumps(d))' "$polylang")
[[ $(pins "$wrong") == 502 && $(json message < "$work/answer.json") == *"is not the file First pins; nothing was installed"* ]] || fail "a download with another checksum is not installed: $(cat "$work/answer.json")"
[[ $(wp plugin is-installed polylang && echo yes || echo no) == no ]] || fail "the refused download left nothing behind"
[[ $(pins '{"pins":{"hello-dolly":{"version":"1.7.2","sha256":"'"$(printf '0%.0s' {1..64})"'"}}}') == 502 && $(json message < "$work/answer.json") == *"is not a plugin First installs"* ]] || fail "only the plugins First depends on can be installed: $(cat "$work/answer.json")"
[[ $(pins "$polylang") == 200 && $(wp plugin get polylang --field=status) == active ]] || fail "the receiver installs and activates a pinned plugin: $(cat "$work/answer.json")"
[[ $(curl -s "$url/__first/api/v1" | json data.name) == pluginlane ]] || fail "the app keeps running after the install"
# Polylang would send the next wp-admin page to its setup wizard; the owner's next page is their own.
[[ $(browser screen 'admin.php?page=first-setup' '<div class="wrap"><h1>First') == *"Deployments"* ]] || fail "a plugin First installed doesn't send wp-admin to its own setup wizard"
ok "with an app live, the receiver installs a pinned plugin by checksum and nothing else"

# ---- the site names code as live and can't run it -------------------------------------------------
# The live build's runtime tree goes missing from the store. The same source is then not "already
# running": push sends the tree again and the app comes back.
live_build=$(wp option get first_live_build)
key=$(wp option get first_store_key)
runtime_tree=$("$harness" compose exec -T wordpress sh -c "sed -n 's/.*\"runtime\": *\"\([0-9a-f]*\)\".*/\1/p' /var/www/html/wp-content/first-store-$key/build/$live_build.json")
[[ ${#runtime_tree} == 64 ]] || fail "the live build names its runtime tree: $runtime_tree"
"$harness" compose exec -T wordpress mv "/var/www/html/wp-content/first-store-$key/runtime/$runtime_tree" "/var/www/html/wp-content/first-store-$key/.tmp/lost"
[[ $(status "$url/") == 200 && $(status "$url/__first/api/v1") == 404 ]] || fail "without its runtime tree the app does not run and WordPress serves"
out=$(push) || fail "a push to a site that lost a tree: $out"
[[ $out == *"has this code and is not running it"*"uploading the runtime tree"*"live:"* ]] || fail "push sends the missing tree again: $out"
[[ $(curl -s "$url/__first/api/v1" | json data.name) == pluginlane && $(curl -s "$url/__first/api/v1/notes" | json data.0.title) == "Written before the second deploy" ]] || fail "the app runs again with its content"
# The last deployment's manifest goes missing: the site still names that build as the baseline (the
# database is at its schema) and says its files are gone. It never offers an older build instead.
base=$(curl -s -u "$admin" "$api/site" | json baseline)
[[ $base == "$(wp option get first_live_build)" ]] || fail "the last deployment is the baseline: $base"
"$harness" compose exec -T wordpress mv "/var/www/html/wp-content/first-store-$key/build/$base.json" "/var/www/html/wp-content/first-store-$key/.tmp/held.json"
[[ $(curl -s -u "$admin" "$api/site" | json baseline) == "$base" ]] || fail "a baseline whose manifest is gone is still the baseline"
[[ $(curl -s -o "$work/answer.json" -w '%{http_code}' -u "$admin" "$api/builds/$base/baseline") == 404 && $(json message < "$work/answer.json") == *"no longer in its build store"* ]] || fail "the site says the baseline's files are gone: $(cat "$work/answer.json")"
if out=$(push); then fail "a push compiled against something other than the last deployment: $out"; fi
[[ $out == *"no longer in its build store"* ]] || fail "push stops and says why: $out"
"$harness" compose exec -T wordpress mv "/var/www/html/wp-content/first-store-$key/.tmp/held.json" "/var/www/html/wp-content/first-store-$key/build/$base.json"
[[ $(curl -s "$url/__first/api/v1" | json data.name) == pluginlane ]] || fail "the app runs again once the manifest is back"
ok "a site that lost a stored tree gets it again from the next push, and a lost baseline is reported, not replaced"

# ---- first logout, and signing in again with an app live ------------------------------------------
"$first" logout "$url" >/dev/null
if out=$(push); then fail "pushed after first logout: $out"; fi
[[ $out == *"not signed in to $url"* ]] || fail "after first logout a push asks to sign in: $out"
ok "first logout forgets the credential on this machine"

# A running app scopes the application passwords approved in wp-admin for agents (read-only), and a
# scoped one can't deploy. The command line's own approval is left unscoped, so signing in again
# works; any other approval on the same screen is still scoped.
(cd "$project" && "$first" login "$url" --no-browser > "$work/login2.out" 2>&1; echo "exit $?" >> "$work/login2.out") &
for _ in $(seq 1 100); do grep -q 'authorize-application' "$work/login2.out" 2>/dev/null && break; sleep 0.1; done
approve=$(grep -o "$url/wp-admin/authorize-application.php[^ ]*" "$work/login2.out") || fail "first login prints the approval link: $(cat "$work/login2.out")"
page=$(browser get "${approve#"$url/wp-admin/"}")
[[ $page == *"This is the First command line"* && $page != *"first-scope-write"* ]] || fail "the approval screen says what the command line gets and offers no agent scope"
curl -s "$(browser approve "$approve")" >/dev/null
wait
[[ $(cat "$work/login2.out") == *"signed in to $url as admin"*"exit 0" ]] || fail "first login works with an app live: $(cat "$work/login2.out")"
out=$(push) || fail "a push with the new credential: $out"
[[ $out == *"already runs this code; nothing to deploy"* ]] || fail "the credential approved with an app live deploys: $out"
# A real browser approves through the screen's script: core's REST route, with the session's cookie
# and nonce. That is the path the running app scopes. The command line's own approval stays unscoped
# there, and any other application's is scoped as before.
nonce=$(browser nonce)
passwords="$url/wp-json/wp/v2/users/me/application-passwords"
made=$(browser rest POST "$passwords" "$nonce" '{"name":"First CLI (script)","app_id":"0d1f6c5e-3b55-4f0e-9c2a-6a1e5f1b7a10"}')
[[ $(sed -n 1p <<< "$made") == 201 && $(sed 1d <<< "$made" | json first_scope) == null ]] || fail "the command line's approval through the screen's script is unscoped: $made"
[[ $(status -u "admin:$(sed 1d <<< "$made" | json password)" "$api/site") == 200 ]] || fail "that credential deploys"
made=$(browser rest POST "$passwords" "$nonce" '{"name":"Some agent","app_id":"11111111-2222-4333-8444-555555555555"}')
[[ $(sed -n 1p <<< "$made") == 201 && $(sed 1d <<< "$made" | json first_scope.write) == false ]] || fail "another application's approval is scoped read-only: $made"
[[ $(status -u "admin:$(sed 1d <<< "$made" | json password)" "$api/site") == 403 ]] || fail "a scoped credential can't deploy"
other=$(browser get "authorize-application.php?app_name=Agent&app_id=11111111-2222-4333-8444-555555555555&success_url=http%3A%2F%2F127.0.0.1%3A9%2Fcallback")
[[ $other == *"first-scope-write"* && $other != *"This is the First command line"* ]] || fail "another application's approval keeps the agent scope form"
elsewhere=$(browser get "authorize-application.php?app_name=First&app_id=0d1f6c5e-3b55-4f0e-9c2a-6a1e5f1b7a10&success_url=https%3A%2F%2Fexample.test%2Fcallback")
[[ $elsewhere == *"first-scope-write"* && $elsewhere != *"This is the First command line"* ]] || fail "the command line's name with a callback that isn't this machine keeps the scope form"
ok "first login works again while an app is live, and other approvals stay scoped"
echo "plugin lane: all checks passed"
