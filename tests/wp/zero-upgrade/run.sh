#!/usr/bin/env bash
# Upgrading a site that ran a build from before the rename to First (compiler and runtime 0.3.0),
# on real WordPress/MariaDB. fixture/ is that site as the 0.3.0 runtime left it: its database and
# private files, written by the real 0.3.0 code (stage.sh says how). This lane loads it into a fresh
# stack, installs the same app built by this compiler, activates it as a site owner would, and runs
# upgrade.test.ts. No production connections.
#
#   FIRST_WP_PROJECT=first-wp-zero-upgrade FIRST_WP_PORT=8797 tests/wp/zero-upgrade/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
cd "$repo"
export FIRST_WP_PROJECT="${FIRST_WP_ZERO_UPGRADE_PROJECT:-first-wp-zero-upgrade}"
export FIRST_WP_PORT="${FIRST_WP_ZERO_UPGRADE_PORT:-8797}"
work="$(mktemp -d "$here/.run.XXXXXX")"
cleanup() {
  [[ ${FIRST_WP_KEEP:-0} == 1 ]] || "$wp/harness.sh" down >/dev/null
  rm -rf -- "$work"
}
trap cleanup EXIT
cargo build -q
first="${CARGO_TARGET_DIR:-target}/debug/first"
[[ $first == /* ]] || first="$repo/$first"
# The same app, ported as its owner would (first.config.ts), on the ledger the 0.3.0 build left.
mkdir -p "$work/app/first/_generated/migrations"
cp "$here/first.config.ts" "$work/app/first.config.ts"
cp "$here/fixture/migrations/"* "$work/app/first/_generated/migrations/"
"$first" build "$work/app" --quiet >/dev/null
[[ $(ls "$work/app/first/_generated/migrations" | tr '\n' ' ') == "0001_init.sql snapshot.json " ]] || { echo "the port plans a new migration" >&2; exit 1; }
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/app/first/dist/wp-content" --bare > "$work/harness.json"
url=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["url"])' "$work/harness.json")
# The 0.3.0 site replaces the fresh one: its database (users, plugins, content) and private files.
# It ran on another port; only home/siteurl move, as when a site changes address.
"$wp/harness.sh" compose exec -T db mariadb -uroot -pfirst-test-root wordpress < "$here/fixture/site.sql"
"$wp/harness.sh" wp option update home "$url" >/dev/null
"$wp/harness.sh" wp option update siteurl "$url" >/dev/null
# The 0.3.0 session in the dump lived for a day from when stage.sh ran; a browser signed in on the
# 0.3.0 site still holds it today, so it is dated now, as if the visitor had just signed in.
"$wp/harness.sh" compose exec -T db mariadb -uroot -pfirst-test-root wordpress -e \
  "UPDATE wp_zero_identity_sessions SET created_at = UNIX_TIMESTAMP(), verified_at = UNIX_TIMESTAMP(), expires_at = UNIX_TIMESTAMP() + 86400"
tar -C "$here/fixture/uploads" -cf - zero-private | "$wp/harness.sh" compose exec -T wordpress sh -c \
  "mkdir -p /var/www/html/wp-content/uploads && tar -C /var/www/html/wp-content/uploads -xf - && chown -R $(id -u):$(id -g) /var/www/html/wp-content/uploads"
# The private-files probe goes to the web server's in-network name, as on the 0.3.0 site.
"$wp/harness.sh" wp eval 'wp_mkdir_p(WPMU_PLUGIN_DIR); file_put_contents(WPMU_PLUGIN_DIR . "/test-probe-route.php", "<?php\nadd_filter(\"first_private_probe_url\", fn (\$u) => str_replace(home_url(), \"http://wordpress\", \$u));\n");' >/dev/null
# The fixture's users came with the 0.3.0 stack's application passwords; make fresh ones for the suite.
users=""
for role in admin editor subscriber; do
  id=$("$wp/harness.sh" wp user get "$role" --field=ID)
  pass=$("$wp/harness.sh" wp user application-password create "$role" "zero-upgrade-$(date +%s%N)" --porcelain)
  users+="${users:+,}\"$role\":{\"id\":$id,\"appPassword\":\"$pass\"}"
done
python3 - "$url" "{$users}" "$here/fixture/seeded.json" > "$work/receipt.json" <<'PY'
import json,sys
print(json.dumps({"url":sys.argv[1],"wp":"","scf":"","plugin":"first-app-carry","users":json.loads(sys.argv[2]),"seeded":json.load(open(sys.argv[3]))}))
PY
FIRST_WP_HARNESS="$work/receipt.json" FIRST_ZERO_UPGRADE_APP="$work/app/first/dist/wp-content" \
  FIRST_ZERO_UPGRADE_CLIENT="$work/app/first/_generated/client/client.js" \
  node --test --test-concurrency=1 "$here/upgrade.test.ts"
