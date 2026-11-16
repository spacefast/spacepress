#!/usr/bin/env bash
# WordPress from TypeScript on real WordPress/MariaDB: pull a third-party ability from a booted site,
# build an app that calls it, and call it over HTTP; wp-hooks/ filters change a rendered post.
#   TP_WP_PROJECT=typedpress-wp-wordpress TP_WP_PORT=8898 tests/wp/wordpress/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
first="$target/debug/typedpress"
export TP_WP_PROJECT="${TP_WP_PROJECT:-typedpress-wp-wordpress}"
export TP_WP_PORT="${TP_WP_PORT:-8898}"
work="$(mktemp -d)"
cleanup() { "$wp/harness.sh" down >/dev/null; rm -rf "$work"; }
trap cleanup EXIT
# Boot the site with an app that does not call the ability yet: the lock comes from this site.
mkdir "$work/app"
cat > "$work/app/typedpress.config.ts" <<'TS'
import { defineConfig } from "typedpress";
export default defineConfig({ name: "abilities-lane" });
TS
"$first" build "$work/app" --quiet >/dev/null
"$wp/harness.sh" up --wp-content "$work/app/tp/dist/wp-content" > "$work/harness.json"
"$wp/harness.sh" compose cp "$here/mu-plugin.php" wordpress:/var/www/html/wp-content/mu-plugins/typedpress-abilities-lane.php >/dev/null 2>&1
url=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["url"])' "$work/harness.json")
password=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["users"]["admin"]["appPassword"])' "$work/harness.json")
# The pull lists the site's abilities as an administrator, from the environment only.
TP_APP_PASSWORD="admin:$password" "$first" abilities pull "$work/app" --site "$url" --only 'acme/*'
python3 - "$work/app/tp/_generated/abilities.json" <<'PY'
import json, sys
lock = json.load(open(sys.argv[1]))
assert [a["name"] for a in lock["abilities"]] == ["acme/word-count"], lock
assert lock["abilities"][0]["input_schema"]["required"] == ["text"], lock
PY
# Build the calling app against the lock alone, and replace the running app plugin with it.
cp "$here/typedpress.config.ts" "$work/app/typedpress.config.ts"
mkdir -p "$work/app/tp" && cp -r "$here/tp/wp-hooks" "$work/app/tp/wp-hooks"
"$first" build "$work/app" --out "$work/next" --quiet >/dev/null
rsync -a --delete "$work/next/plugins/typedpress-app-abilities-lane/" "$work/app/tp/dist/wp-content/plugins/typedpress-app-abilities-lane/"
grep -q '"acme/word-count": { input: { text: string; unit?: "words" | "letters" }; output: { count: number; by: string } }' "$work/app/tp/_generated/db.d.ts"
# Doctor reports the lock as satisfied, then the change once the site's schema moves.
TP_APP_PASSWORD="admin:$password" "$first" doctor "$work/app" --out "$work/next" --site "$url" > "$work/doctor.txt" || true
grep -q '✓ locked abilities: all present and unchanged' "$work/doctor.txt" || { cat "$work/doctor.txt" >&2; exit 1; }
post=$("$wp/harness.sh" wp post create --post_title='Hooked' --post_content='Lane body' --post_status=publish --porcelain)
TP_WP_HARNESS="$work/harness.json" TP_HOOKS_POST="$post" node --test "$here/wordpress.test.ts"
"$wp/harness.sh" compose exec -T wordpress sed -i "s/'letters'\]/'letters', 'bytes']/" /var/www/html/wp-content/mu-plugins/typedpress-abilities-lane.php
TP_APP_PASSWORD="admin:$password" "$first" doctor "$work/app" --out "$work/next" --site "$url" > "$work/doctor.txt" || true
grep -q '✗ locked abilities: acme/word-count: schema changed since the pull' "$work/doctor.txt" || { cat "$work/doctor.txt" >&2; exit 1; }
echo "wordpress lane: ok"
