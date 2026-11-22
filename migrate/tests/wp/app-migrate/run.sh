#!/usr/bin/env bash
# In-place adoption on disposable WordPress/MariaDB. No production connections.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
wp="$repo/tests/wp"
source "$repo/migrate/tests/wp/helpers.sh"
cd "$repo"
export TP_WP_PROJECT="${TP_WP_PROJECT:-typedpress-wp-app-migrate}"
export TP_WP_PORT="${TP_WP_PORT:-8798}"
export TP_WP_PLUGIN_CACHE="${TP_WP_PLUGIN_CACHE:-$wp/cache}"
work="$(mktemp -d "$here/.run.XXXXXX")"
cleanup() {
  "$wp/harness.sh" down >/dev/null
  rm -rf -- "$work"
}
trap cleanup EXIT
cargo build --locked --workspace -q
first="${CARGO_TARGET_DIR:-target}/debug/typedpress"
migrator="${CARGO_TARGET_DIR:-target}/debug/typedpress-migrate"
"$migrator" --from zero app migrate/tests/app-migrate/board --out "$work/app" --space spc_migrate_test > "$work/report.json"
"$first" build "$work/app" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/app/tp/dist/wp-content" --bare > "$work/bare.json"
"$wp/harness.sh" compose cp "$here/seed.php" cli:/tmp/typedpress-app-migrate-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/typedpress-app-migrate-seed.php > "$work/before.json"
import_tables "$work/app" >/dev/null
"$wp/harness.sh" up --wp-content "$work/app/tp/dist/wp-content" > "$work/harness.json"
TP_WP_HARNESS="$work/harness.json" TP_APP_ADOPTION_BEFORE="$work/before.json" \
  node --test "$here/adoption.test.ts"
"$wp/harness.sh" compose cp "$here/storage.php" cli:/tmp/typedpress-app-migrate-storage.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/typedpress-app-migrate-storage.php
# Keep the original adoption requirements while building a later unique-index removal.
mkdir "$work/indexes"
cp "$here/indexes.config.ts" "$work/indexes/typedpress.config.ts"
"$first" build "$work/indexes" --quiet >/dev/null
sed 's/\.unique()//' "$here/indexes.config.ts" > "$work/indexes/typedpress.config.ts"
"$first" build "$work/indexes" --quiet >/dev/null
"$wp/harness.sh" compose cp "$work/indexes/tp/dist/wp-content/plugins/typedpress-app-adoption-indexes" cli:/tmp/typedpress-app-migrate-indexes >/dev/null 2>&1
"$wp/harness.sh" compose cp "$here/indexes.php" cli:/tmp/typedpress-app-migrate-indexes.php >/dev/null 2>&1
"$wp/harness.sh" compose exec -T db mariadb -uroot -ptypedpress-test-root -e \
  "CREATE DATABASE tp_adopt_other; GRANT ALL ON tp_adopt_other.* TO 'wordpress'@'%';"
"$wp/harness.sh" wp eval-file /tmp/typedpress-app-migrate-indexes.php
# A separate source candidate proves the portable typedpress-identity gate on a fresh site. Its connector
# roles travel in the candidate's sf.jsonc, which WordPress never reads.
"$migrator" --from zero app migrate/tests/app-migrate/content --out "$work/content" > "$work/content-report.json"
"$first" build "$work/content" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/content/tp/dist/wp-content" > "$work/content-harness.json"
TP_WP_HARNESS="$work/content-harness.json" node --test "$here/identity.test.ts"
# Paginated reads over retained rows, walked page by page through the migrated actions.
"$migrator" --from zero app migrate/tests/app-migrate/feed --out "$work/feed" --space spc_migrate_test > "$work/feed-report.json"
"$first" build "$work/feed" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/feed/tp/dist/wp-content" --bare > "$work/feed-bare.json"
"$wp/harness.sh" compose cp "$here/feed-seed.php" cli:/tmp/typedpress-app-migrate-feed-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/typedpress-app-migrate-feed-seed.php >/dev/null
import_tables "$work/feed" >/dev/null
"$wp/harness.sh" up --wp-content "$work/feed/tp/dist/wp-content" > "$work/feed-harness.json"
TP_WP_HARNESS="$work/feed-harness.json" node --test "$here/feed.test.ts"
# 0.8 endpoints served as v2 routes at their original paths, over retained rows.
"$migrator" --from zero app migrate/tests/app-migrate/endpoints --out "$work/endpoints" --space spc_migrate_test --users > "$work/endpoints-report.json"
"$first" build "$work/endpoints" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/endpoints/tp/dist/wp-content" --bare > "$work/endpoints-bare.json"
"$wp/harness.sh" compose cp "$here/endpoints-seed.php" cli:/tmp/typedpress-app-migrate-endpoints-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/typedpress-app-migrate-endpoints-seed.php >/dev/null
import_tables "$work/endpoints" >/dev/null
"$wp/harness.sh" up --wp-content "$work/endpoints/tp/dist/wp-content" > "$work/endpoints-harness.json"
"$wp/harness.sh" wp config set LEGACY_BANNER "from wp-config" >/dev/null
TP_WP_HARNESS="$work/endpoints-harness.json" node --test "$here/endpoints.test.ts"
# Converted static pages, published through the hosted path: capture with `typedpress sources`, delete
# the project, and install only `typedpress compile-sources` output, whose app plugin renders tp/app/.
"$migrator" --from zero app migrate/tests/app-migrate/site --out "$work/site" --space spc_migrate_test > "$work/site-report.json"
"$first" build "$work/site" --quiet >/dev/null
"$first" sources "$work/site" --out "$work/site-source"
mkdir -p "$work/site-content/plugins"
cp "$work/site/tp/dist/wp-content/typedpress-manifest.json" "$work/site-content/"
"$first" compile-sources "$work/site-source" "$work/site-compiled" "$work/site-source"
rsync -a "$work/site-compiled/plugins/" "$work/site-content/plugins/"
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/site-content" --bare > "$work/site-bare.json"
"$wp/harness.sh" compose cp "$here/site-seed.php" cli:/tmp/typedpress-app-migrate-site-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/typedpress-app-migrate-site-seed.php >/dev/null
import_tables "$work/site" >/dev/null
"$wp/harness.sh" up --wp-content "$work/site-content" > "$work/site-harness.json"
"$wp/harness.sh" wp typedpress migrate >/dev/null
TP_WP_HARNESS="$work/site-harness.json" node --test "$here/site.test.ts"
# ctx.crypto through the migrated app, with the secret as a padded wp-config constant.
"$migrator" --from zero app migrate/tests/app-migrate/crypto --out "$work/crypto" > "$work/crypto-report.json"
"$first" build "$work/crypto" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/crypto/tp/dist/wp-content" > "$work/crypto-harness.json"
"$wp/harness.sh" wp config set WEBHOOK_SECRET "  lane-secret  " --type=constant >/dev/null
TP_WP_HARNESS="$work/crypto-harness.json" node --test "$here/crypto.test.ts"
# ctx.email.send through the migrated app: queued with the write, sent after commit.
"$migrator" --from zero app migrate/tests/app-migrate/email --out "$work/email" --space spc_migrate_test > "$work/email-report.json"
"$first" build "$work/email" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/email/tp/dist/wp-content" --bare > "$work/email-bare.json"
"$wp/harness.sh" compose cp "$here/email-seed.php" cli:/tmp/typedpress-app-migrate-email-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/typedpress-app-migrate-email-seed.php >/dev/null
import_tables "$work/email" >/dev/null
"$wp/harness.sh" up --wp-content "$work/email/tp/dist/wp-content" > "$work/email-harness.json"
TP_WP_HARNESS="$work/email-harness.json" TP_SIGNUPS_HASH="$(python3 -c 'import hashlib; print(hashlib.sha256(b"spc_migrate_test\0signups").hexdigest()[:20])')" \
  node --test "$here/email.test.ts"
