#!/usr/bin/env bash
# In-place adoption on disposable WordPress/MariaDB. No production connections.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
cd "$repo"
export FIRST_WP_PROJECT="${FIRST_WP_APP_MIGRATE_PROJECT:-first-wp-app-migrate}"
export FIRST_WP_PORT="${FIRST_WP_APP_MIGRATE_PORT:-8798}"
export FIRST_WP_PLUGIN_CACHE="${FIRST_WP_PLUGIN_CACHE:-$wp/cache}"
work="$(mktemp -d "$here/.run.XXXXXX")"
cleanup() {
  "$wp/harness.sh" down >/dev/null
  rm -rf -- "$work"
}
trap cleanup EXIT
cargo build -q
first="${CARGO_TARGET_DIR:-target}/debug/first"
"$first" migrate app --from zero-0.8 tests/fixtures/app-migrate/board --out "$work/app" --space spc_migrate_test > "$work/report.json"
"$first" build "$work/app" --quiet >/dev/null
"$wp/harness.sh" up --wp-content "$work/app/first/dist/wp-content" --bare > "$work/bare.json"
docker compose -p "$FIRST_WP_PROJECT" cp "$here/seed.php" cli:/tmp/first-app-migrate-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/first-app-migrate-seed.php > "$work/before.json"
"$wp/harness.sh" up --wp-content "$work/app/first/dist/wp-content" > "$work/harness.json"
FIRST_WP_HARNESS="$work/harness.json" FIRST_APP_ADOPTION_BEFORE="$work/before.json" \
  node --test "$here/adoption.test.ts"
# Keep the original adoption requirements while building a later unique-index removal.
mkdir "$work/indexes"
cp "$here/indexes.config.ts" "$work/indexes/first.config.ts"
"$first" build "$work/indexes" --quiet >/dev/null
sed -e 's/\.unique()//' -e 's/\.references(() => contacts.id, { onDelete: "set null" })//' "$here/indexes.config.ts" > "$work/indexes/first.config.ts"
"$first" build "$work/indexes" --quiet >/dev/null
docker compose -p "$FIRST_WP_PROJECT" cp "$work/indexes/first/dist/wp-content/plugins/first-app-adoption-indexes" cli:/tmp/first-app-migrate-indexes >/dev/null 2>&1
docker compose -p "$FIRST_WP_PROJECT" cp "$here/indexes.php" cli:/tmp/first-app-migrate-indexes.php >/dev/null 2>&1
docker compose -p "$FIRST_WP_PROJECT" exec -T db mariadb -uroot -pfirst-test-root -e \
  "CREATE DATABASE first_adopt_other; GRANT ALL ON first_adopt_other.* TO 'wordpress'@'%';"
"$wp/harness.sh" wp eval-file /tmp/first-app-migrate-indexes.php
# A separate source candidate proves the portable first-identity gate on a fresh site. The fixture's
# connector roles are refused (their credentials and grants don't migrate), so this lane converts a
# copy without them, as tests/app_migrate.rs does.
cp -R tests/fixtures/app-migrate/content "$work/content-source"
python3 - "$work/content-source/server/index.ts" <<'PY'
import sys
path = sys.argv[1]
source = open(path).read()
start = source.index("  connectors: {")
end = start + source[start:].index("  },\n") + len("  },\n")
open(path, "w").write(source[:start] + source[end:])
PY
"$first" migrate app --from zero-0.8 "$work/content-source" --out "$work/content" > "$work/content-report.json"
"$first" build "$work/content" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/content/first/dist/wp-content" > "$work/content-harness.json"
FIRST_WP_HARNESS="$work/content-harness.json" node --test "$here/identity.test.ts"
# Paginated reads over retained rows, walked page by page through the migrated actions.
"$first" migrate app --from zero-0.8 tests/fixtures/app-migrate/feed --out "$work/feed" --space spc_migrate_test > "$work/feed-report.json"
"$first" build "$work/feed" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/feed/first/dist/wp-content" --bare > "$work/feed-bare.json"
docker compose -p "$FIRST_WP_PROJECT" cp "$here/feed-seed.php" cli:/tmp/first-app-migrate-feed-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/first-app-migrate-feed-seed.php >/dev/null
"$wp/harness.sh" up --wp-content "$work/feed/first/dist/wp-content" > "$work/feed-harness.json"
FIRST_WP_HARNESS="$work/feed-harness.json" node --test "$here/feed.test.ts"
# 0.8 endpoints served as v2 routes at their original paths, over retained rows.
"$first" migrate app --from zero-0.8 tests/fixtures/app-migrate/endpoints --out "$work/endpoints" --space spc_migrate_test --users > "$work/endpoints-report.json"
"$first" build "$work/endpoints" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/endpoints/first/dist/wp-content" --bare > "$work/endpoints-bare.json"
docker compose -p "$FIRST_WP_PROJECT" cp "$here/endpoints-seed.php" cli:/tmp/first-app-migrate-endpoints-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/first-app-migrate-endpoints-seed.php >/dev/null
"$wp/harness.sh" up --wp-content "$work/endpoints/first/dist/wp-content" > "$work/endpoints-harness.json"
"$wp/harness.sh" wp config set LEGACY_BANNER "from wp-config" >/dev/null
FIRST_WP_HARNESS="$work/endpoints-harness.json" node --test "$here/endpoints.test.ts"
# Converted static pages, published through the hosted path: capture with `first sources`, delete
# the project, and install only `first compile-sources` output, whose app plugin renders first/app/.
"$first" migrate app --from zero-0.8 tests/fixtures/app-migrate/site --out "$work/site" --space spc_migrate_test > "$work/site-report.json"
"$first" build "$work/site" --quiet >/dev/null
"$first" sources "$work/site" --out "$work/site-source"
mkdir -p "$work/site-content/plugins"
cp "$work/site/first/dist/wp-content/first-manifest.json" "$work/site-content/"
"$first" compile-sources "$work/site-source" "$work/site-compiled" "$work/site-source"
rsync -a "$work/site-compiled/plugins/" "$work/site-content/plugins/"
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/site-content" --bare > "$work/site-bare.json"
docker compose -p "$FIRST_WP_PROJECT" cp "$here/site-seed.php" cli:/tmp/first-app-migrate-site-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/first-app-migrate-site-seed.php >/dev/null
"$wp/harness.sh" up --wp-content "$work/site-content" > "$work/site-harness.json"
"$wp/harness.sh" wp first migrate >/dev/null
FIRST_WP_HARNESS="$work/site-harness.json" node --test "$here/site.test.ts"
# ctx.crypto through the migrated app, with the secret as a padded wp-config constant.
"$first" migrate app --from zero-0.8 tests/fixtures/app-migrate/crypto --out "$work/crypto" > "$work/crypto-report.json"
"$first" build "$work/crypto" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/crypto/first/dist/wp-content" > "$work/crypto-harness.json"
"$wp/harness.sh" wp config set WEBHOOK_SECRET "  lane-secret  " --type=constant >/dev/null
FIRST_WP_HARNESS="$work/crypto-harness.json" node --test "$here/crypto.test.ts"
# ctx.email.send through the migrated app: queued with the write, sent after commit.
"$first" migrate app --from zero-0.8 tests/fixtures/app-migrate/email --out "$work/email" --space spc_migrate_test > "$work/email-report.json"
"$first" build "$work/email" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/email/first/dist/wp-content" --bare > "$work/email-bare.json"
docker compose -p "$FIRST_WP_PROJECT" cp "$here/email-seed.php" cli:/tmp/first-app-migrate-email-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/first-app-migrate-email-seed.php >/dev/null
"$wp/harness.sh" up --wp-content "$work/email/first/dist/wp-content" > "$work/email-harness.json"
FIRST_WP_HARNESS="$work/email-harness.json" FIRST_SIGNUPS_HASH="$(python3 -c 'import hashlib; print(hashlib.sha256(b"spc_migrate_test\0signups").hexdigest()[:10])')" \
  node --test "$here/email.test.ts"
