#!/usr/bin/env bash
# In-place adoption on disposable WordPress/MariaDB. No production connections.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
cd "$repo"
export ZERO_WP_PROJECT="${ZERO_WP_APP_MIGRATE_PROJECT:-zero-wp-app-migrate}"
export ZERO_WP_PORT="${ZERO_WP_APP_MIGRATE_PORT:-8798}"
export ZERO_WP_PLUGIN_CACHE="${ZERO_WP_PLUGIN_CACHE:-$wp/cache}"
work="$(mktemp -d "$here/.run.XXXXXX")"
cleanup() {
  "$wp/harness.sh" down >/dev/null
  rm -rf -- "$work"
}
trap cleanup EXIT
cargo build -q
zero="${CARGO_TARGET_DIR:-target}/debug/zero"
"$zero" migrate app --from zero-0.8 tests/fixtures/app-migrate/board --out "$work/app" --space spc_migrate_test > "$work/report.json"
"$zero" build "$work/app" --quiet >/dev/null
"$wp/harness.sh" up --wp-content "$work/app/.zero/wp-content" --bare > "$work/bare.json"
docker compose -p "$ZERO_WP_PROJECT" cp "$here/seed.php" cli:/tmp/zero-app-migrate-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/zero-app-migrate-seed.php > "$work/before.json"
"$wp/harness.sh" up --wp-content "$work/app/.zero/wp-content" > "$work/harness.json"
ZERO_WP_HARNESS="$work/harness.json" ZERO_APP_ADOPTION_BEFORE="$work/before.json" \
  node --test "$here/adoption.test.ts"
# Keep the original adoption requirements while building a later unique-index removal.
mkdir "$work/indexes"
cp "$here/indexes.config.ts" "$work/indexes/zero.config.ts"
"$zero" build "$work/indexes" --quiet >/dev/null
sed -e 's/\.unique()//' -e 's/\.references(() => contacts.id, { onDelete: "set null" })//' "$here/indexes.config.ts" > "$work/indexes/zero.config.ts"
"$zero" build "$work/indexes" --quiet >/dev/null
docker compose -p "$ZERO_WP_PROJECT" cp "$work/indexes/.zero/wp-content/plugins/zero-app-adoption-indexes" cli:/tmp/zero-app-migrate-indexes >/dev/null 2>&1
docker compose -p "$ZERO_WP_PROJECT" cp "$here/indexes.php" cli:/tmp/zero-app-migrate-indexes.php >/dev/null 2>&1
docker compose -p "$ZERO_WP_PROJECT" exec -T db mariadb -uroot -pzero-test-root -e \
  "CREATE DATABASE zero_adopt_other; GRANT ALL ON zero_adopt_other.* TO 'wordpress'@'%';"
"$wp/harness.sh" wp eval-file /tmp/zero-app-migrate-indexes.php
# A separate source candidate proves the portable zero-identity gate on a fresh site.
"$zero" migrate app --from zero-0.8 tests/fixtures/app-migrate/content --out "$work/content" > "$work/content-report.json"
"$zero" build "$work/content" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/content/.zero/wp-content" > "$work/content-harness.json"
ZERO_WP_HARNESS="$work/content-harness.json" node --test "$here/identity.test.ts"
# ctx.email.send through the migrated app: queued with the write, sent after commit.
"$zero" migrate app --from zero-0.8 tests/fixtures/app-migrate/email --out "$work/email" --space spc_migrate_test > "$work/email-report.json"
"$zero" build "$work/email" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/email/.zero/wp-content" --bare > "$work/email-bare.json"
docker compose -p "$ZERO_WP_PROJECT" cp "$here/email-seed.php" cli:/tmp/zero-app-migrate-email-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/zero-app-migrate-email-seed.php >/dev/null
"$wp/harness.sh" up --wp-content "$work/email/.zero/wp-content" > "$work/email-harness.json"
ZERO_WP_HARNESS="$work/email-harness.json" ZERO_SIGNUPS_HASH="$(python3 -c 'import hashlib; print(hashlib.sha256(b"spc_migrate_test\0signups").hexdigest()[:10])')" \
  node --test "$here/email.test.ts"
