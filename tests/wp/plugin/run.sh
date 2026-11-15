#!/usr/bin/env bash
# The First plugin on a stock WordPress, the way a site owner and a developer use it:
#   wp-admin: upload first.zip, activate it, press "Install what is missing" on the First screen
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
  # wp-admin wrote the uploaded plugins as the web server's user; hand them back before removing.
  "$harness" compose exec -T wordpress chown -R "$(id -u):$(id -g)" /var/www/html/wp-content/plugins >/dev/null 2>&1 || true
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
[[ $(wp plugin list --status=active --field=name) == first ]] || fail "uploading and activating first.zip leaves exactly the First plugin active"
ok "first.zip uploads and activates through wp-admin's Upload Plugin"

screen=$(browser screen 'admin.php?page=first-setup' '<div class="wrap"><h1>First')
[[ $screen == *"No First app is deployed to this site yet."* && $screen == *"Secure Custom Fields | 6.9.7 or newer | missing | Not installed"* ]] || fail "the First screen lists what is missing: $screen"
[[ $(status "$url/") == 200 && $(status "$url/__first/api/v1") == 404 ]] || fail "before a deployment WordPress serves and First's API doesn't"
# Until the site has what First needs, other wp-admin screens point at the First screen.
[[ $(browser screen 'index.php' 'wpbody-content') == *"needs a few plugins before an app can be deployed here"* ]] || fail "wp-admin points an administrator at the First screen"

pressed=$(browser press 'admin.php?page=first-setup' 'name="install"' install=1)
[[ $(json url <<< "$pressed") == *"page=first-setup" ]] || fail "the install button returns to the First screen: $pressed"
active=$(wp plugin list --status=active --field=name | sort | tr '\n' ' ')
[[ $active == "action-scheduler first mcp-adapter secure-custom-fields two-factor " ]] || fail "the install button installs and activates the four pinned plugins: $active"
screen=$(browser screen 'admin.php?page=first-setup' '<div class="wrap"><h1>First')
[[ $screen != *"Not installed"* && $screen == *"first login $url"* ]] || fail "the First screen is ready and shows the commands: $screen"
ok "the First screen installs the pinned plugins from wordpress.org and shows the deploy commands"

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
if out=$(push); then fail "pushed to a site missing a plugin the build needs: $out"; fi
[[ $out == *"is missing plugins this app needs: two-factor 0.17.0 (found 0.17.0, inactive)"*"first push --install"* ]] || fail "push names the plugin the build needs: $out"
out=$(push --install) || fail "push --install: $out"
[[ $out == *"installed Two Factor 0.17.0 on the site"* && $(wp plugin is-active two-factor && echo active) == active ]] || fail "push --install brings the plugin back: $out"
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
"$harness" compose exec -T wordpress sh -c "! find /var/www/html/wp-content -name escaped.php | grep -q ." || fail "nothing was written outside the store"
# The deployment's token only selects code on that deployment's own routes, for an administrator.
[[ $(curl -s -H "X-First-Deployment: $id:$token" "$url/__first/api/v1" | json data.name) == pluginlane && $(status -H "X-First-Deployment: $id:$token" "$url/__first/api/v1/tasks") == 200 ]] || fail "a deployment token on another URL still gets the live build"
[[ $(status -u "$editor" -H "X-First-Deployment: $id:$token" "$api/deployments/$id/plan") == 403 ]] || fail "the token alone does not open the plan"
[[ $(status -u "$admin" -H "X-First-Deployment: $id:$(printf 'f%.0s' {1..64})" "$api/deployments/$id/plan") == 409 ]] || fail "a wrong token mounts nothing"
[[ $(status -u "$admin" -X POST -H "X-First-Deployment: $id:$token" -H 'X-First-Mount: activate' "$api/deployments/$id/activate") == 409 ]] || fail "a deployment whose trees never arrived can't go live"
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
ok "with an app live, the receiver installs a pinned plugin by checksum and nothing else"

# ---- first logout --------------------------------------------------------------------------------
"$first" logout "$url" >/dev/null
if out=$(push); then fail "pushed after first logout: $out"; fi
[[ $out == *"not signed in to $url"* ]] || fail "after first logout a push asks to sign in: $out"
ok "first logout forgets the credential on this machine"
echo "plugin lane: all checks passed"
