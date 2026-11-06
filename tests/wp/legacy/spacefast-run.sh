#!/usr/bin/env bash
# Real WordPress/MariaDB proof for cross-prefix data and imported-session continuity.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
export ZERO_WP_PROJECT="${ZERO_WP_PROJECT:-zero-wp-spacefast}"
export ZERO_WP_PORT="${ZERO_WP_PORT:-8892}"
app="$(mktemp -d)"
cleanup() { "$wp/harness.sh" down; rm -rf "$app"; }
trap cleanup EXIT
mkdir -p "$app/source/server" "$app/source/content/posts"
cat > "$app/source/server/index.ts" <<'TS'
import { capsule } from '@spacefast/zero/server';
export default capsule({
  auth: true,
  collections: {
    posts: { publicRead: true },
    projects: {
      publicRead: true,
      fields: {
        title: { kind: 'text', required: true },
        budget: { kind: 'number' },
        active: { kind: 'boolean' },
      },
    },
  },
});
TS
"$target/debug/zero" migrate app --from zero-0.8 "$app/source" --out "$app/converted" >/dev/null
"$target/debug/zero" build "$app/converted" --quiet >/dev/null
mkdir -p "$wp/.wp-content-spacefast"
rsync -a --delete "$app/converted/.zero/wp-content/" "$wp/.wp-content-spacefast/"
"$wp/harness.sh" down
"$wp/harness.sh" up --wp-content "$wp/.wp-content-spacefast" > "$app/harness.json"
"$wp/harness.sh" wp zero migrate >/dev/null
for file in spacefast.php spacefast-scope.php; do
  "$wp/harness.sh" compose cp "$here/$file" "cli:/tmp/$file" >/dev/null 2>&1
done
"$wp/harness.sh" wp eval-file /tmp/spacefast.php seed
"$wp/harness.sh" compose exec -T cli cp /tmp/spacefast-scope.php /var/www/html/wp-content/mu-plugins/zero-spacefast-scope.php
"$wp/harness.sh" wp zero migrate >/dev/null
prefix="$(python3 -c 'import hashlib; print("sfz_"+hashlib.sha256(b"imported-space").hexdigest()[:24]+"_")')"
command=(zero migrate-spacefast --space=imported-space --source-prefix=wp_ --target-prefix="$prefix")
"$wp/harness.sh" wp "${command[@]}" --verify > "$app/missing.json" && { echo 'Expected missing receipts to refuse verify' >&2; exit 1; }
"$wp/harness.sh" wp eval-file /tmp/spacefast.php comments
for mode in --dry-run ''; do
  if "$wp/harness.sh" wp "${command[@]}" $mode > "$app/comments.json"; then
    echo 'Expected comments to refuse migration' >&2; exit 1
  fi
done
"$wp/harness.sh" wp eval-file /tmp/spacefast.php dry
"$wp/harness.sh" wp eval-file /tmp/spacefast.php clear-comments
"$wp/harness.sh" wp eval-file /tmp/spacefast.php nested
"$wp/harness.sh" wp "${command[@]}" --dry-run > "$app/dry.json"
"$wp/harness.sh" wp eval-file /tmp/spacefast.php dry
# A conflict rolls back the entire posts group; no receipt is written.
"$wp/harness.sh" wp eval-file /tmp/spacefast.php conflict
if "$wp/harness.sh" wp "${command[@]}" > "$app/conflict.json"; then
  echo 'Expected conflicting post ID to refuse migration' >&2; exit 1
fi
"$wp/harness.sh" wp eval-file /tmp/spacefast.php rollback
"$wp/harness.sh" wp "${command[@]}" > "$app/first.json"
"$wp/harness.sh" wp "${command[@]}" --verify > "$app/verify.json"
"$wp/harness.sh" wp eval-file /tmp/spacefast.php copied
"$wp/harness.sh" wp "${command[@]}" > "$app/second.json"
python3 - "$app" <<'CHECK'
import json,sys
from pathlib import Path
p=Path(sys.argv[1])
assert all(g['status']=='missing' and g['stored'] is None for g in json.loads((p/'missing.json').read_text())['error']['groups'].values())
assert json.loads((p/'missing.json').read_text())['error']['code']=='zero_spacefast_drift'
assert json.loads((p/'comments.json').read_text())['error']['code']=='zero_spacefast_unsupported_comments'
assert json.loads((p/'comments.json').read_text())['error']['pointer']=='/comments'
assert all(g['status']=='verified' and g['stored']==g['current'] for g in json.loads((p/'verify.json').read_text())['data']['groups'].values())
assert json.loads((p/'conflict.json').read_text())['error']['code']=='zero_spacefast_conflict'
assert all(g['status']=='dry-run' for g in json.loads((p/'dry.json').read_text())['data']['groups'].values())
assert all(g['status']=='copied' and g['copied']>0 for g in json.loads((p/'first.json').read_text())['data']['groups'].values())
assert all(g=={'copied':0,'status':'already-migrated'} for g in json.loads((p/'second.json').read_text())['data']['groups'].values())
CHECK
"$wp/harness.sh" wp eval-file /tmp/spacefast.php storage-failure
"$wp/harness.sh" wp eval-file /tmp/spacefast.php upgrade-failure
ZERO_SPACEFAST_HARNESS="$app/harness.json" node --test "$here/spacefast.test.mjs"
"$wp/harness.sh" wp eval-file /tmp/spacefast.php authenticated
# Receipts must also protect upgraded hashes and revoked sessions on later retries.
"$wp/harness.sh" wp "${command[@]}" > "$app/after-auth.json"
python3 - "$app/after-auth.json" <<'CHECK'
import json,sys
assert all(g=={'copied':0,'status':'already-migrated'} for g in json.load(open(sys.argv[1]))['data']['groups'].values())
CHECK
"$wp/harness.sh" wp eval-file /tmp/spacefast.php authenticated

"$wp/harness.sh" wp eval-file /tmp/spacefast.php drift
if "$wp/harness.sh" wp "${command[@]}" --verify > "$app/drift.json"; then
  echo 'Expected source post change to refuse verify' >&2; exit 1
fi
python3 - "$app/drift.json" <<'CHECK'
import json,sys
error=json.load(open(sys.argv[1]))['error']
assert error['status']==409 and error['code']=='zero_spacefast_drift'
assert error['groups']['posts']['status']=='drifted'
assert error['groups']['posts']['stored']!=error['groups']['posts']['current']
assert all(error['groups'][g]['status']=='verified' for g in ['users','sessions'])
CHECK
