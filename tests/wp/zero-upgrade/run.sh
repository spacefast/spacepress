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
# The same app, ported as its owner would: First's config name and module, the committed ledger.
mkdir -p "$work/app/first/_generated/migrations"
sed 's/from "zero"/from "first"/' "$here/zero.config.ts" > "$work/app/first.config.ts"
"$first" build "$work/app" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/app/first/dist/wp-content" --bare > "$work/harness.json"
url=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["url"])' "$work/harness.json")
# The 0.3.0 site replaces the fresh one: its database (users, plugins, content) and private files.
# It ran on another port; only home/siteurl move, as when a site changes address.
"$wp/harness.sh" compose exec -T db mariadb -uroot -pfirst-test-root wordpress < "$here/fixture/site.sql"
"$wp/harness.sh" wp option update home "$url" >/dev/null
"$wp/harness.sh" wp option update siteurl "$url" >/dev/null
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
  node --test --test-concurrency=1 "$here/upgrade.test.ts"
