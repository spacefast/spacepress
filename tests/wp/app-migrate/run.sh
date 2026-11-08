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
"$wp/harness.sh" up --wp-content "$work/app/zero/dist/wp-content" --bare > "$work/bare.json"
docker compose -p "$ZERO_WP_PROJECT" cp "$here/seed.php" cli:/tmp/zero-app-migrate-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/zero-app-migrate-seed.php > "$work/before.json"
"$wp/harness.sh" up --wp-content "$work/app/zero/dist/wp-content" > "$work/harness.json"
ZERO_WP_HARNESS="$work/harness.json" ZERO_APP_ADOPTION_BEFORE="$work/before.json" \
  node --test "$here/adoption.test.ts"
# Keep the original adoption requirements while building a later unique-index removal.
mkdir "$work/indexes"
cp "$here/indexes.config.ts" "$work/indexes/zero.config.ts"
"$zero" build "$work/indexes" --quiet >/dev/null
sed -e 's/\.unique()//' -e 's/\.references(() => contacts.id, { onDelete: "set null" })//' "$here/indexes.config.ts" > "$work/indexes/zero.config.ts"
"$zero" build "$work/indexes" --quiet >/dev/null
docker compose -p "$ZERO_WP_PROJECT" cp "$work/indexes/zero/dist/wp-content/plugins/zero-app-adoption-indexes" cli:/tmp/zero-app-migrate-indexes >/dev/null 2>&1
docker compose -p "$ZERO_WP_PROJECT" cp "$here/indexes.php" cli:/tmp/zero-app-migrate-indexes.php >/dev/null 2>&1
docker compose -p "$ZERO_WP_PROJECT" exec -T db mariadb -uroot -pzero-test-root -e \
  "CREATE DATABASE zero_adopt_other; GRANT ALL ON zero_adopt_other.* TO 'wordpress'@'%';"
"$wp/harness.sh" wp eval-file /tmp/zero-app-migrate-indexes.php
# A separate source candidate proves the portable zero-identity gate on a fresh site.
"$zero" migrate app --from zero-0.8 tests/fixtures/app-migrate/content --out "$work/content" > "$work/content-report.json"
"$zero" build "$work/content" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/content/zero/dist/wp-content" > "$work/content-harness.json"
ZERO_WP_HARNESS="$work/content-harness.json" node --test "$here/identity.test.ts"
# Paginated reads over retained rows, walked page by page through the migrated actions.
"$zero" migrate app --from zero-0.8 tests/fixtures/app-migrate/feed --out "$work/feed" --space spc_migrate_test > "$work/feed-report.json"
"$zero" build "$work/feed" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/feed/zero/dist/wp-content" --bare > "$work/feed-bare.json"
docker compose -p "$ZERO_WP_PROJECT" cp "$here/feed-seed.php" cli:/tmp/zero-app-migrate-feed-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/zero-app-migrate-feed-seed.php >/dev/null
"$wp/harness.sh" up --wp-content "$work/feed/zero/dist/wp-content" > "$work/feed-harness.json"
ZERO_WP_HARNESS="$work/feed-harness.json" node --test "$here/feed.test.ts"
# 0.8 endpoints served as v2 routes at their original paths, over retained rows.
"$zero" migrate app --from zero-0.8 tests/fixtures/app-migrate/endpoints --out "$work/endpoints" --space spc_migrate_test --users > "$work/endpoints-report.json"
"$zero" build "$work/endpoints" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/endpoints/zero/dist/wp-content" --bare > "$work/endpoints-bare.json"
docker compose -p "$ZERO_WP_PROJECT" cp "$here/endpoints-seed.php" cli:/tmp/zero-app-migrate-endpoints-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/zero-app-migrate-endpoints-seed.php >/dev/null
"$wp/harness.sh" up --wp-content "$work/endpoints/zero/dist/wp-content" > "$work/endpoints-harness.json"
"$wp/harness.sh" wp config set LEGACY_BANNER "from wp-config" >/dev/null
ZERO_WP_HARNESS="$work/endpoints-harness.json" node --test "$here/endpoints.test.ts"
# Converted static pages, published through the hosted path: zero-pages render, capture with
# `zero sources`, delete the project, and install only `zero compile-sources` output. The pages
# renderer is the repo's own package, built here so the lane does not depend on CI step order.
if [[ ! -f "$repo/packages/blocks/dist/index.js" || ! -f "$repo/packages/pages/dist/cli.js" ]]; then
  (cd "$repo/packages/blocks" && pnpm install --frozen-lockfile >/dev/null && pnpm build >/dev/null)
  (cd "$repo/packages/pages" && pnpm install --frozen-lockfile >/dev/null && pnpm build >/dev/null)
fi
"$zero" migrate app --from zero-0.8 tests/fixtures/app-migrate/site --out "$work/site" --space spc_migrate_test > "$work/site-report.json"
sed -e "s|\"\.\./\.\./|\"$repo/|g" -e "s|\"\./islands/interactivity\.d\.ts\"|\"$repo/examples/full-site/islands/interactivity.d.ts\"|" "$repo/examples/full-site/tsconfig.json" > "$work/site/tsconfig.json"
"$zero" build "$work/site" --quiet >/dev/null
node "$repo/packages/pages/bin/zero-pages.mjs" build "$work/site" >/dev/null
"$zero" sources "$work/site" --out "$work/site-source"
mkdir -p "$work/site-content/plugins"
cp "$work/site/zero/dist/wp-content/zero-manifest.json" "$work/site-content/"
"$zero" compile-sources "$work/site-source" "$work/site-compiled" "$work/site-source"
rsync -a "$work/site-compiled/plugins/" "$work/site-content/plugins/"
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/site-content" --bare > "$work/site-bare.json"
docker compose -p "$ZERO_WP_PROJECT" cp "$here/site-seed.php" cli:/tmp/zero-app-migrate-site-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/zero-app-migrate-site-seed.php >/dev/null
"$wp/harness.sh" up --wp-content "$work/site-content" > "$work/site-harness.json"
"$wp/harness.sh" wp zero migrate >/dev/null
"$wp/harness.sh" wp plugin activate zero-pages-legacy-site >/dev/null
ZERO_WP_HARNESS="$work/site-harness.json" node --test "$here/site.test.ts"
# ctx.crypto through the migrated app, with the secret as a padded wp-config constant.
"$zero" migrate app --from zero-0.8 tests/fixtures/app-migrate/crypto --out "$work/crypto" > "$work/crypto-report.json"
"$zero" build "$work/crypto" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/crypto/zero/dist/wp-content" > "$work/crypto-harness.json"
"$wp/harness.sh" wp config set WEBHOOK_SECRET "  lane-secret  " --type=constant >/dev/null
ZERO_WP_HARNESS="$work/crypto-harness.json" node --test "$here/crypto.test.ts"
# ctx.email.send through the migrated app: queued with the write, sent after commit.
"$zero" migrate app --from zero-0.8 tests/fixtures/app-migrate/email --out "$work/email" --space spc_migrate_test > "$work/email-report.json"
"$zero" build "$work/email" --quiet >/dev/null
"$wp/harness.sh" down >/dev/null
"$wp/harness.sh" up --wp-content "$work/email/zero/dist/wp-content" --bare > "$work/email-bare.json"
docker compose -p "$ZERO_WP_PROJECT" cp "$here/email-seed.php" cli:/tmp/zero-app-migrate-email-seed.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/zero-app-migrate-email-seed.php >/dev/null
"$wp/harness.sh" up --wp-content "$work/email/zero/dist/wp-content" > "$work/email-harness.json"
ZERO_WP_HARNESS="$work/email-harness.json" ZERO_SIGNUPS_HASH="$(python3 -c 'import hashlib; print(hashlib.sha256(b"spc_migrate_test\0signups").hexdigest()[:10])')" \
  node --test "$here/email.test.ts"
