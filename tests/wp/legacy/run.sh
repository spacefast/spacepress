#!/usr/bin/env bash
# The legacy migration lane, run by ../run.sh after the main suites on the same stack: build the app
# `typedpress migrate config --from zero` makes from capsule.ts, boot WordPress with it, seed the site the
# way ORIGINAL Zero stored it, then run legacy.test.ts (which drives `wp typedpress migrate-legacy`).
#
# Seeding: with ZERO_ORIGINAL (a checkout of the original monorepo) the original kernel itself runs
# in the stack and writes the content (stage.sh); TP_UPDATE_FIXTURES=1 then refreshes site.json.
# Without it (CI: that repository is private) replay.php loads site.json, the rows that run captured.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-target}"
[[ $target == /* ]] || target="$repo/$target"
first="$target/debug/typedpress"

app="$(mktemp -d)"
trap 'rm -rf "$app"' EXIT
"$first" migrate config --from zero "$here/capsule.ts" --out "$app/typedpress.config.ts" >/dev/null
# Step 2 of docs/migrating-from-zero.md, as an owner would do it: open access to editors, and make
# project titles unique (something the original app didn't enforce), so the suite proves the
# migration honours the new app's rules.
sed -i 's/"create":false,"update":false,"delete":false/"create":"editor","update":"editor","delete":"editor"/g' "$app/typedpress.config.ts"
sed -i 's/  "title": text().max(120.0),/  "title": text().max(120.0).unique(),/' "$app/typedpress.config.ts"
# A column the original app never had, with a default the migration fills (a timezone-bearing
# timestamp, normalized to UTC), and project covers restricted to images.
sed -i 's|  "kickoff": timestamp().optional(),|&\n  "reviewedAt": timestamp().default("2026-03-01T12:00:00+02:00").optional(),|' "$app/typedpress.config.ts"
sed -i 's|  "cover": media().optional(),|  "cover": media({ accept: "image" }).optional(),|' "$app/typedpress.config.ts"
# A compiled validator on a migrated field that reads the rest of the row: published task notes
# must not shout (drafts may).
sed -i 's|  "notes": text({ multiline: true }).optional(),|  "notes": text({ multiline: true }).optional().validate((value, ctx) => value === null \|\| ctx.data.status !== "published" \|\| value !== value.toUpperCase() \|\| "Don'"'"'t shout"),|' "$app/typedpress.config.ts"
"$first" build "$app" --quiet >/dev/null
mkdir -p "$wp/.wp-content-legacy"
rsync -a --delete "$app/tp/dist/wp-content/" "$wp/.wp-content-legacy/"

"$wp/harness.sh" down
"$wp/harness.sh" up --wp-content "$wp/.wp-content-legacy" > "$wp/.harness-legacy.json"
if [[ -n ${ZERO_ORIGINAL:-} ]]; then
  "$here/stage.sh" > "$wp/.legacy-site.json"
  docker compose -p "${TP_WP_PROJECT:-first-wp-test}" exec -T cli rm -f /var/www/html/wp-content/mu-plugins/typedpress-legacy-kernel.php
  [[ ${TP_UPDATE_FIXTURES:-0} == 1 ]] && cp "$wp/.legacy-site.json" "$here/site.json"
else
  docker compose -p "${TP_WP_PROJECT:-first-wp-test}" cp "$here/site.json" cli:/tmp/typedpress-legacy-site.json >/dev/null 2>&1
  docker compose -p "${TP_WP_PROJECT:-first-wp-test}" cp "$here/replay.php" cli:/tmp/typedpress-legacy-replay.php >/dev/null 2>&1
  "$wp/harness.sh" wp eval-file /tmp/typedpress-legacy-replay.php /tmp/typedpress-legacy-site.json >/dev/null
  cp "$here/site.json" "$wp/.legacy-site.json"
fi
# The release, inside the container, for tests that plan against a variant of the new schema.
docker compose -p "${TP_WP_PROJECT:-first-wp-test}" cp "$here/content-model.php" cli:/tmp/typedpress-legacy-release.php >/dev/null 2>&1
TP_WP_HARNESS="$wp/.harness-legacy.json" ZERO_LEGACY_SITE="$wp/.legacy-site.json" TP_BIN="$first" \
  node --test --test-concurrency=1 "$here/legacy.test.ts"
# Native posts are adopted only for the named Space, retaining IDs and their native body.
mkdir -p "$app/native/server"
cat > "$app/native/server/index.ts" <<'TS'
import { capsule } from '@spacefast/zero/server';
export default capsule({collections:{posts:{publicRead:true}}});
TS
"$first" migrate app --from zero-0.8 "$app/native" --out "$app/native-out" >/dev/null
"$first" build "$app/native-out" --quiet >/dev/null
docker compose -p "${TP_WP_PROJECT:-first-wp-test}" cp "$app/native-out/tp/dist/wp-content/plugins/typedpress-app-migrated-app/tp/app/schema.php" cli:/tmp/typedpress-native-posts-schema.php >/dev/null 2>&1
docker compose -p "${TP_WP_PROJECT:-first-wp-test}" cp "$here/native.php" cli:/tmp/typedpress-native-posts-proof.php >/dev/null 2>&1
"$wp/harness.sh" wp eval-file /tmp/typedpress-native-posts-proof.php
