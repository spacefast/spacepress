#!/usr/bin/env bash
# WordPress from TypeScript on real WordPress/MariaDB: pull a third-party ability from a booted site,
# build an app that calls it, and call it over HTTP; wp-hooks/ filters change a rendered post.
#   ZERO_WP_PROJECT=zero-wp-wordpress ZERO_WP_PORT=8898 tests/wp/wordpress/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
zero="$target/debug/zero"
export ZERO_WP_PROJECT="${ZERO_WP_PROJECT:-zero-wp-wordpress}"
export ZERO_WP_PORT="${ZERO_WP_PORT:-8898}"
work="$(mktemp -d)"
cleanup() { "$wp/harness.sh" down >/dev/null; rm -rf "$work"; }
trap cleanup EXIT
# Boot the site with an app that does not call the ability yet: the lock comes from this site.
mkdir "$work/app"
cat > "$work/app/zero.config.ts" <<'TS'
import { defineConfig } from "zero";
export default defineConfig({ name: "abilities-lane" });
TS
"$zero" build "$work/app" --quiet >/dev/null
"$wp/harness.sh" up --wp-content "$work/app/zero/dist/wp-content" > "$work/harness.json"
"$wp/harness.sh" compose cp "$here/mu-plugin.php" wordpress:/var/www/html/wp-content/mu-plugins/zero-abilities-lane.php >/dev/null 2>&1
url=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["url"])' "$work/harness.json")
password=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["users"]["admin"]["appPassword"])' "$work/harness.json")
# The pull lists the site's abilities as an administrator, from the environment only.
ZERO_APP_PASSWORD="admin:$password" "$zero" abilities pull "$work/app" --site "$url" --only 'acme/*'
python3 - "$work/app/zero/abilities.json" <<'PY'
import json, sys
lock = json.load(open(sys.argv[1]))
assert [a["name"] for a in lock["abilities"]] == ["acme/word-count"], lock
assert lock["abilities"][0]["input_schema"]["required"] == ["text"], lock
PY
# Build the calling app against the lock alone, and replace the running app plugin with it.
cp "$here/zero.config.ts" "$work/app/zero.config.ts"
cp -r "$here/wp-hooks" "$work/app/wp-hooks"
"$zero" build "$work/app" --out "$work/next" --quiet >/dev/null
rsync -a --delete "$work/next/plugins/zero-app-abilities-lane/" "$work/app/zero/dist/wp-content/plugins/zero-app-abilities-lane/"
grep -q '"acme/word-count": { input: { text: string; unit?: "words" | "letters" }; output: { count: number; by: string } }' "$work/app/zero.gen.ts"
# Doctor reports the lock as satisfied, then the change once the site's schema moves.
ZERO_APP_PASSWORD="admin:$password" "$zero" doctor "$work/app" --out "$work/next" --site "$url" > "$work/doctor.txt" || true
grep -q '✓ locked abilities: all present and unchanged' "$work/doctor.txt" || { cat "$work/doctor.txt" >&2; exit 1; }
post=$("$wp/harness.sh" wp post create --post_title='Hooked' --post_content='Lane body' --post_status=publish --porcelain)
ZERO_WP_HARNESS="$work/harness.json" ZERO_HOOKS_POST="$post" node --test "$here/wordpress.test.ts"
"$wp/harness.sh" compose exec -T wordpress sed -i "s/'letters'\]/'letters', 'bytes']/" /var/www/html/wp-content/mu-plugins/zero-abilities-lane.php
ZERO_APP_PASSWORD="admin:$password" "$zero" doctor "$work/app" --out "$work/next" --site "$url" > "$work/doctor.txt" || true
grep -q '✗ locked abilities: acme/word-count: schema changed since the pull' "$work/doctor.txt" || { cat "$work/doctor.txt" >&2; exit 1; }
echo "wordpress lane: ok"
