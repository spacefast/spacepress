#!/usr/bin/env bash
# Lane M2 (legacy app users), run by ../run.sh after legacy/run.sh: boot WordPress with a members
# app (user projection, design §6.2), seed app users the way the ORIGINAL Space stored them, run
# users.test.ts. With ZERO_ORIGINAL the original identity plugin (from that checkout's
# runtime/identity/spacefast-identity.zip) creates them; TP_UPDATE_FIXTURES=1 refreshes users.json.
# Otherwise replay-users.php loads users.json.

set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-target}"
[[ $target == /* ]] || target="$repo/$target"
first="$target/debug/typedpress"
compose() { docker compose -p "${TP_WP_PROJECT:-typedpress-wp-test}" "$@"; }

"$first" build "$here/members" --quiet >/dev/null
mkdir -p "$wp/.wp-content-members"
rsync -a --delete "$here/members/tp/dist/wp-content/" "$wp/.wp-content-members/"
"$wp/harness.sh" down
"$wp/harness.sh" up --wp-content "$wp/.wp-content-members" > "$wp/.harness-members.json"
if [[ -n ${ZERO_ORIGINAL:-} ]]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  git -C "$ZERO_ORIGINAL" show HEAD:runtime/identity/spacefast-identity.zip > "$work/sfi.zip"
  compose cp "$work/sfi.zip" cli:/tmp/spacefast-identity.zip >/dev/null 2>&1
  # The original platform: its identity plugin, and not the new app (whose hooks would fill defaults).
  "$wp/harness.sh" wp plugin deactivate typedpress-app-members typedpress-identity >/dev/null
  "$wp/harness.sh" wp plugin install /tmp/spacefast-identity.zip --activate >/dev/null
  compose cp "$here/users-seed.php" cli:/tmp/typedpress-legacy-users-seed.php >/dev/null 2>&1
  "$wp/harness.sh" wp eval-file /tmp/typedpress-legacy-users-seed.php > "$wp/.legacy-users.json"
  "$wp/harness.sh" wp plugin deactivate spacefast-identity >/dev/null
  "$wp/harness.sh" wp plugin activate typedpress-identity typedpress-app-members >/dev/null
  [[ ${TP_UPDATE_FIXTURES:-0} == 1 ]] && cp "$wp/.legacy-users.json" "$here/users.json"
else
  compose cp "$here/users.json" cli:/tmp/typedpress-legacy-users.json >/dev/null 2>&1
  compose cp "$here/replay-users.php" cli:/tmp/typedpress-legacy-replay-users.php >/dev/null 2>&1
  "$wp/harness.sh" wp eval-file /tmp/typedpress-legacy-replay-users.php /tmp/typedpress-legacy-users.json >/dev/null --skip-plugins=typedpress-app-members
  cp "$here/users.json" "$wp/.legacy-users.json"
fi
TP_WP_HARNESS="$wp/.harness-members.json" ZERO_LEGACY_USERS="$wp/.legacy-users.json" \
  node --test --test-concurrency=1 "$here"/users.test.ts
