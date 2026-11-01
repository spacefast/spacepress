#!/usr/bin/env bash
# The legacy migration lane, run by ../run.sh after the main suites on the same stack: build the app
# `zero migrate config --from zero` makes from capsule.ts, boot WordPress with it, seed the site the
# way ORIGINAL Zero stored it, then run legacy.test.ts (which drives `zero migrate site`).
#
# Seeding: with ZERO_ORIGINAL (a checkout of the original monorepo) the original kernel itself runs
# in the stack and writes the content (stage.sh); ZERO_UPDATE_FIXTURES=1 then refreshes site.json.
# Without it (CI: that repository is private) replay.php loads site.json, the rows that run captured.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-target}"
[[ $target == /* ]] || target="$repo/$target"
zero="$target/debug/zero"

app="$(mktemp -d)"
trap 'rm -rf "$app"' EXIT
"$zero" migrate config --from zero "$here/capsule.ts" --out "$app/zero.config.ts" >/dev/null
# Step 2 of docs/migrating-from-zero.md, as an owner would do it: open access to editors, and make
# project titles unique (something the original app didn't enforce), so the suite proves the
# migration honours the new app's rules.
sed -i 's/"create":false,"update":false,"delete":false/"create":"editor","update":"editor","delete":"editor"/g' "$app/zero.config.ts"
sed -i 's/  "title": text().notNull().max(120.0),/  "title": text().notNull().max(120.0).unique(),/' "$app/zero.config.ts"
# A column the original app never had, with a default the migration fills (a timezone-bearing
# timestamp, normalized to UTC), and project covers restricted to images.
sed -i 's|  "kickoff": timestamp(),|&\n  "reviewedAt": timestamp().default("2026-03-01T12:00:00+02:00"),|' "$app/zero.config.ts"
sed -i 's|  "cover": media(),|  "cover": media({ accept: "image" }),|' "$app/zero.config.ts"
# A compiled validator on a migrated field that reads the rest of the row: published task notes
# must not shout (drafts may).
sed -i 's|  "notes": text({ multiline: true }),|  "notes": text({ multiline: true }).validate((value, ctx) => value === null \|\| ctx.data.status !== "published" \|\| value !== value.toUpperCase() \|\| "Don'"'"'t shout"),|' "$app/zero.config.ts"
"$zero" build "$app" --quiet >/dev/null
mkdir -p "$wp/.wp-content-legacy"
rsync -a --delete "$app/.zero/wp-content/" "$wp/.wp-content-legacy/"

"$wp/harness.sh" down
"$wp/harness.sh" up --wp-content "$wp/.wp-content-legacy" > "$wp/.harness-legacy.json"
if [[ -n ${ZERO_ORIGINAL:-} ]]; then
  "$here/stage.sh" > "$wp/.legacy-site.json"
  docker compose -p "${ZERO_WP_PROJECT:-zero-wp-test}" exec -T cli rm -f /var/www/html/wp-content/mu-plugins/zero-legacy-kernel.php
  [[ ${ZERO_UPDATE_FIXTURES:-0} == 1 ]] && cp "$wp/.legacy-site.json" "$here/site.json"
else
  docker compose -p "${ZERO_WP_PROJECT:-zero-wp-test}" cp "$here/site.json" cli:/tmp/zero-legacy-site.json >/dev/null 2>&1
  docker compose -p "${ZERO_WP_PROJECT:-zero-wp-test}" cp "$here/replay.php" cli:/tmp/zero-legacy-replay.php >/dev/null 2>&1
  "$wp/harness.sh" wp eval-file /tmp/zero-legacy-replay.php /tmp/zero-legacy-site.json >/dev/null
  cp "$here/site.json" "$wp/.legacy-site.json"
fi
# The release, inside the container, for tests that plan against a variant of the new schema.
docker compose -p "${ZERO_WP_PROJECT:-zero-wp-test}" cp "$here/content-model.php" cli:/tmp/zero-legacy-release.php >/dev/null 2>&1
ZERO_WP_HARNESS="$wp/.harness-legacy.json" ZERO_LEGACY_SITE="$wp/.legacy-site.json" ZERO_BIN="$zero" \
  node --test --test-concurrency=1 "$here/legacy.test.ts"
