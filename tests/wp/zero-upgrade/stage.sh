#!/usr/bin/env bash
# Regenerates fixture/ (the database, private files and seed receipt of a site that ran the 0.3.0
# app in zero.config.ts) with the real 0.3.0 runtime. Needs a checkout of commit 61c22fc2 with its
# binary built (`git worktree add --detach <dir> 61c22fc2 && cargo build --bin zero` there):
#
#   ZERO_03=<that checkout> tests/wp/zero-upgrade/stage.sh
#
# It runs that checkout's own WordPress harness on a disposable stack, seeds the site through its
# HTTP API (seed.sh), then dumps it. The credentials in the dump (users, application passwords,
# identity signing keys, the session cookie in seeded.json) belong to that throwaway stack only.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${ZERO_03:?set ZERO_03 to a checkout of 61c22fc2 with target/debug/zero built}"
[[ $(git -C "$ZERO_03" rev-parse HEAD) == 61c22fc2* ]] || { echo "ZERO_03 must be at 61c22fc2" >&2; exit 2; }
export ZERO_WP_PROJECT="${ZERO_WP_PROJECT:-zero-upgrade-stage}" ZERO_WP_PORT="${ZERO_WP_PORT:-8979}"
work="$(mktemp -d)"
harness="$ZERO_03/tests/wp/harness.sh"
trap '"$harness" down; rm -rf "$work"' EXIT
mkdir -p "$work/app" && cp "$here/zero.config.ts" "$work/app/"
"$ZERO_03/target/debug/zero" build "$work/app" --quiet >/dev/null
"$harness" up --wp-content "$work/app/.zero/wp-content" > "$work/up.json"
# The harness publishes WordPress on a host port the container can't reach: probe the private files
# through the web server's in-network name (the filter hosts use for the same reason).
"$harness" wp eval 'wp_mkdir_p(WPMU_PLUGIN_DIR); file_put_contents(WPMU_PLUGIN_DIR . "/test-probe-route.php", "<?php\nforeach ([\"zero_private_probe_url\", \"first_private_probe_url\"] as \$f) { add_filter(\$f, fn (\$u) => str_replace(home_url(), \"http://wordpress\", \$u)); }\n");'
[[ $("$harness" wp eval 'echo Zero\Wp\WpFiles::probe() ? "ok" : "exposed";') == ok ]]
editor=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["users"]["editor"]["appPassword"])' "$work/up.json")
"$here/seed.sh" "http://127.0.0.1:$ZERO_WP_PORT" "$editor" > "$work/seeded.json"
rm -rf "$here/fixture" && mkdir -p "$here/fixture/uploads"
"$harness" compose exec -T db mariadb-dump -uroot -pzero-test-root --skip-dump-date --skip-extended-insert --order-by-primary wordpress > "$here/fixture/site.sql"
"$harness" compose exec -T wordpress tar -C /var/www/html/wp-content/uploads -cf - zero-private | tar -C "$here/fixture/uploads" -xf -
cp "$work/seeded.json" "$here/fixture/seeded.json"
# The ledger the 0.3.0 build committed: the port in first.config.ts builds on it (run.sh).
mkdir -p "$here/fixture/migrations" && cp "$work/app/zero/migrations/"* "$here/fixture/migrations/"
echo "staged $here/fixture"
