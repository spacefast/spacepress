#!/usr/bin/env bash
# Build the app from capsule.ts, boot WordPress, replay Zero's stored content, and exercise the
# standalone content importer in legacy.test.ts.
#
# Seeding: with ZERO_ORIGINAL (a checkout of the original monorepo) the original kernel itself runs
# in the stack and writes the content (stage.sh); SP_UPDATE_FIXTURES=1 then refreshes site.json.
# Without it (CI: that repository is private) replay.php loads site.json, the rows that run captured.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
wp="$repo/tests/wp"
source "$repo/migrate/tests/wp/helpers.sh"
target="${CARGO_TARGET_DIR:-target}"
[[ $target == /* ]] || target="$repo/$target"
first="$target/debug/spacepress"
migrator="$target/debug/spacepress-migrate"

app="$(mktemp -d)"
trap 'rm -rf "$app"' EXIT
"$migrator" --from zero config "$here/capsule.ts" --out "$app/spacepress.config.ts" >/dev/null
# Step 2 of docs/migrating-from-zero.md, as an owner would do it: open access to editors, and make
# project titles unique (something the original app didn't enforce), so the suite proves the
# migration honours the new app's rules.
sed -i 's/"create":false,"update":false,"delete":false/"create":"editor","update":"editor","delete":"editor"/g' "$app/spacepress.config.ts"
sed -i 's/  "title": text().max(120.0),/  "title": text().max(120.0).unique(),/' "$app/spacepress.config.ts"
# A column the original app never had, with a default the migration fills (a timezone-bearing
# timestamp, normalized to UTC), and project covers restricted to images.
sed -i 's|  "kickoff": timestamp().optional(),|&\n  "reviewedAt": timestamp().default("2026-03-01T12:00:00+02:00").optional(),|' "$app/spacepress.config.ts"
sed -i 's|  "cover": media().optional(),|  "cover": media({ accept: "image" }).optional(),|' "$app/spacepress.config.ts"
# A compiled validator on a migrated field that reads the rest of the row: published task notes
# must not shout (drafts may).
sed -i 's|  "notes": text({ multiline: true }).optional(),|  "notes": text({ multiline: true }).optional().validate((value, ctx) => value === null \|\| ctx.data.status !== "published" \|\| value !== value.toUpperCase() \|\| "Don'"'"'t shout"),|' "$app/spacepress.config.ts"
"$first" build "$app" --quiet >/dev/null
mkdir -p "$wp/.wp-content-legacy"
rsync -a --delete "$app/sp/dist/wp-content/" "$wp/.wp-content-legacy/"

"$wp/harness.sh" down
"$wp/harness.sh" up --wp-content "$wp/.wp-content-legacy" > "$wp/.harness-legacy.json"
if [[ -n ${ZERO_ORIGINAL:-} ]]; then
  "$here/stage.sh" > "$wp/.legacy-site.json"
  "$wp/harness.sh" compose exec -T cli rm -f /var/www/html/wp-content/mu-plugins/spacepress-legacy-kernel.php
  [[ ${SP_UPDATE_FIXTURES:-0} == 1 ]] && cp "$wp/.legacy-site.json" "$here/site.json"
else
  "$wp/harness.sh" compose cp "$here/site.json" cli:/tmp/spacepress-legacy-site.json >/dev/null 2>&1
  "$wp/harness.sh" compose cp "$here/replay.php" cli:/tmp/spacepress-legacy-replay.php >/dev/null 2>&1
  "$wp/harness.sh" wp eval-file /tmp/spacepress-legacy-replay.php /tmp/spacepress-legacy-site.json >/dev/null
  cp "$here/site.json" "$wp/.legacy-site.json"
fi
# The release, inside the container, for tests that plan against a variant of the new schema.
"$wp/harness.sh" compose cp "$here/content-model.php" cli:/tmp/spacepress-legacy-release.php >/dev/null 2>&1
stage_import
SP_WP_HARNESS="$wp/.harness-legacy.json" ZERO_LEGACY_SITE="$wp/.legacy-site.json" SP_BIN="$first" \
  node --test --test-concurrency=1 "$here/legacy.test.ts"
# Native posts are adopted only for the named Space, retaining IDs and their native body.
mkdir -p "$app/native/server"
cat > "$app/native/server/index.ts" <<'TS'
import { capsule } from '@spacefast/zero/server';
export default capsule({collections:{posts:{publicRead:true}}});
TS
"$migrator" --from zero app "$app/native" --out "$app/native-out" >/dev/null
"$first" build "$app/native-out" --quiet >/dev/null
"$wp/harness.sh" compose cp "$app/native-out/sp/dist/wp-content/plugins/spacepress-app-migrated-app/sp/app/schema.php" cli:/tmp/spacepress-native-posts-schema.php >/dev/null 2>&1
"$wp/harness.sh" compose cp "$here/native.php" cli:/tmp/spacepress-native-posts-proof.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/spacepress-native-posts-proof.php
